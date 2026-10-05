/**
 * Form editor (`/form?id=…`, or no id for a new form). Tabs follow the
 * WordPress plugin: Fields, Settings, Messages, Actions, Submissions.
 */

import { Button } from "@cloudflare/kumo";
import { ArrowLeft, FloppyDisk } from "@phosphor-icons/react";
import * as React from "react";

import type { FormAction, FormDefinition, FormMessages, FormSettings, MessageKey } from "../core/types.js";
import { getForm, isAbortError, saveForm } from "./api.js";
import { ActionsTab } from "./editor/ActionsTab.js";
import { FieldsTab } from "./editor/FieldsTab.js";
import { MessagesTab } from "./editor/MessagesTab.js";
import { SettingsTab } from "./editor/SettingsTab.js";
import {
	detectFieldNames,
	draftFromForm,
	draftSnapshot,
	draftToPayload,
	errorMessage,
	firstTabWithErrors,
	hasErrors,
	newDraft,
	slugify,
	validateDraft,
	withDefaultSlug,
	type DraftErrors,
	type EditorTab,
	type FormDraft,
} from "./helpers.js";
import { AdminLink, pluginHref, setSearchParams, useSearchParams } from "./navigation.js";
import { SubmissionsInbox } from "./SubmissionsInbox.js";
import {
	AdminPage,
	CopyButton,
	ErrorNotice,
	focusSoon,
	FormStatusBadge,
	LiveRegion,
	LoadingState,
	Notice,
	PageHeader,
	TabList,
	TabPanel,
	useAnnouncer,
	type TabItem,
} from "./ui.js";

const TAB_IDS: readonly EditorTab[] = ["fields", "settings", "messages", "actions", "submissions"];
const TAB_LABELS: Record<EditorTab, string> = {
	fields: "Fields",
	settings: "Settings",
	messages: "Messages",
	actions: "Actions",
	submissions: "Submissions",
};
const isTab = (value: string | null): value is EditorTab => TAB_IDS.includes(value as EditorTab);

/** Where the error summary sends focus for each error. */
const ERROR_TARGETS: { key: keyof Omit<DraftErrors, "actions">; label: string; tab: EditorTab; field: string }[] = [
	{ key: "title", label: "Title", tab: "fields", field: "cfa-field-title" },
	{ key: "slug", label: "Slug", tab: "fields", field: "cfa-field-slug" },
	{ key: "markup", label: "Form HTML", tab: "fields", field: "cfa-field-markup" },
	{ key: "redirect_url", label: "Redirect after success", tab: "settings", field: "cfa-setting-redirect_url" },
	{ key: "schedule", label: "Schedule", tab: "settings", field: "cfa-setting-schedule_close" },
];

type LoadState = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string };

export function FormEditorPage() {
	const params = useSearchParams();
	const id = params.get("id") ?? undefined;

	const [load, setLoad] = React.useState<LoadState>(id ? { kind: "loading" } : { kind: "ready" });
	const [draft, setDraft] = React.useState<FormDraft>(newDraft);
	const [savedSnapshot, setSavedSnapshot] = React.useState(() => draftSnapshot(newDraft()));
	const [saved, setSaved] = React.useState<FormDefinition | null>(null);
	const [slugTouched, setSlugTouched] = React.useState(false);
	const [showErrors, setShowErrors] = React.useState(false);
	const [saving, setSaving] = React.useState(false);
	const [saveError, setSaveError] = React.useState<string | null>(null);
	const [notice, setNotice] = React.useState<string | null>(null);
	const [tab, setTabState] = React.useState<EditorTab>(() => {
		const fromUrl = params.get("tab");
		return isTab(fromUrl) ? fromUrl : "fields";
	});
	const [announcement, announce] = useAnnouncer();
	const [reload, setReload] = React.useState(0);
	/** The form id whose data is in `draft`, so saving a new form doesn't reload it. */
	const loadedId = React.useRef<string | undefined>(undefined);

	// ---- load
	React.useEffect(() => {
		if (!id) {
			if (loadedId.current !== undefined) {
				loadedId.current = undefined;
				const fresh = newDraft();
				setDraft(fresh);
				setSavedSnapshot(draftSnapshot(fresh));
				setSaved(null);
				setSlugTouched(false);
				setShowErrors(false);
				setLoad({ kind: "ready" });
			}
			return;
		}
		if (id === loadedId.current) return;
		const controller = new AbortController();
		setLoad({ kind: "loading" });
		getForm(id, { signal: controller.signal })
			.then(({ form }) => {
				loadedId.current = form.id;
				const next = draftFromForm(form);
				setDraft(next);
				setSavedSnapshot(draftSnapshot(next));
				setSaved(form);
				setSlugTouched(true);
				setShowErrors(false);
				setLoad({ kind: "ready" });
			})
			.catch((error: unknown) => {
				if (!isAbortError(error)) setLoad({ kind: "error", message: errorMessage(error, "Could not load the form.") });
			});
		return () => controller.abort();
	}, [id, reload]);

	// ---- derived
	const snapshot = React.useMemo(() => draftSnapshot(draft), [draft]);
	const dirty = snapshot !== savedSnapshot;
	const fieldNames = React.useMemo(() => detectFieldNames(draft.markup), [draft.markup]);
	const errors = React.useMemo<DraftErrors>(() => (showErrors ? validateDraft(draft) : {}), [draft, showErrors]);
	const isNew = !draft.id;
	const inboxForm = React.useMemo(() => (saved ? { id: saved.id, title: saved.title, slug: saved.slug } : null), [saved]);

	// ---- edits
	const patch = React.useCallback((next: Partial<FormDraft>) => setDraft((d) => ({ ...d, ...next })), []);
	const patchSettings = React.useCallback(
		(next: Partial<FormSettings>) => setDraft((d) => ({ ...d, settings: { ...d.settings, ...next } })),
		[],
	);
	const setMessage = React.useCallback(
		(key: MessageKey, value: string | undefined) =>
			setDraft((d) => {
				const messages: FormMessages = { ...d.messages };
				if (value === undefined) delete messages[key];
				else messages[key] = value;
				return { ...d, messages };
			}),
		[],
	);
	const updateActions = React.useCallback(
		(update: (actions: FormAction[]) => FormAction[]) =>
			setDraft((d) => ({ ...d, settings: { ...d.settings, actions: update(d.settings.actions ?? []) } })),
		[],
	);
	const onTitle = (title: string) => patch(slugTouched ? { title } : { title, slug: slugify(title) });
	const onSlug = (slug: string) => {
		setSlugTouched(true);
		patch({ slug });
	};

	const setTab = (next: EditorTab) => {
		setTabState(next);
		setSearchParams({ tab: next === "fields" ? undefined : next });
	};

	// ---- save
	const save = async () => {
		if (saving) return;
		const prepared = withDefaultSlug(draft);
		if (prepared !== draft) setDraft(prepared);
		const found = validateDraft(prepared);
		setShowErrors(true);
		if (hasErrors(found)) {
			const target = firstTabWithErrors(found);
			if (target && target !== tab) setTab(target);
			setSaveError(null);
			announce("The form wasn't saved. Fix the errors listed at the top of the page.");
			focusSoon("cfa-error-summary");
			return;
		}
		setSaving(true);
		setSaveError(null);
		setNotice(null);
		const sent = draftSnapshot(prepared);
		try {
			const { form } = await saveForm(draftToPayload(prepared));
			const next = draftFromForm(form);
			loadedId.current = form.id;
			setSaved(form);
			setSavedSnapshot(draftSnapshot(next));
			// Keep edits made while the request was in flight.
			setDraft((current) =>
				draftSnapshot(current) === sent
					? next
					: { ...current, id: form.id, slug: current.slug === prepared.slug ? form.slug : current.slug },
			);
			setSlugTouched(true);
			setShowErrors(false);
			if (!id) setSearchParams({ id: form.id });
			if (form.slug !== prepared.slug.trim()) {
				setNotice(`The slug “${prepared.slug.trim()}” is taken, so this form uses “${form.slug}”.`);
			}
			announce(prepared.id ? "Changes saved." : "Form created.");
		} catch (error) {
			setSaveError(errorMessage(error, "Could not save the form."));
			announce("The form wasn't saved.");
		} finally {
			setSaving(false);
		}
	};
	const saveRef = React.useRef(save);
	React.useLayoutEffect(() => {
		saveRef.current = save;
	});

	// Cmd/Ctrl+S saves.
	React.useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "s") {
				event.preventDefault();
				void saveRef.current();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	// Warn before leaving with unsaved changes.
	React.useEffect(() => {
		if (!dirty) return;
		const onBeforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			// Older browsers need returnValue set to show the prompt.
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => window.removeEventListener("beforeunload", onBeforeUnload);
	}, [dirty]);

	const confirmLeave = (event: React.MouseEvent<HTMLAnchorElement>) => {
		if (dirty && !window.confirm("Leave without saving? Your changes will be lost.")) event.preventDefault();
	};

	// ---- render
	const backLink = (
		<AdminLink href={pluginHref("/")} className="cfa-back" onClick={confirmLeave}>
			<ArrowLeft size={14} aria-hidden="true" className="cfa-flip-rtl" />
			All forms
		</AdminLink>
	);

	if (load.kind === "loading") {
		return (
			<AdminPage>
				{backLink}
				<LoadingState label="Loading form…" />
			</AdminPage>
		);
	}

	if (load.kind === "error") {
		return (
			<AdminPage>
				{backLink}
				<ErrorNotice title="Could not load this form" message={load.message} onRetry={() => setReload((n) => n + 1)} />
			</AdminPage>
		);
	}

	const tabErrors: Partial<Record<EditorTab, boolean>> = {
		fields: !!(errors.title || errors.slug || errors.markup),
		settings: !!(errors.redirect_url || errors.schedule),
		actions: !!errors.actions,
	};
	const tabs: TabItem<EditorTab>[] = TAB_IDS.map((tabId) => ({
		id: tabId,
		label: TAB_LABELS[tabId],
		hasError: tabErrors[tabId] ?? false,
	}));
	const errorList = [
		...ERROR_TARGETS.filter((target) => errors[target.key]).map((target) => ({
			key: target.key,
			text: `${target.label}: ${errors[target.key]}`,
			tab: target.tab,
			field: target.field,
		})),
		...Object.entries(errors.actions ?? {}).flatMap(([actionId, fields]) =>
			Object.entries(fields).map(([field, text]) => ({
				key: `${actionId}-${field}`,
				text: `Action ${actionIndex(draft, actionId)}: ${text ?? ""}`,
				tab: "actions" as EditorTab,
				field: `cfa-action-${actionId}-${field}`,
			})),
		),
	];

	const statusText = saving ? "Saving…" : dirty ? "Unsaved changes" : saved ? "All changes saved" : "";
	const shortcode = saved ? `[cf_form slug="${saved.slug}"]` : null;

	return (
		<AdminPage>
			<PageHeader
				before={backLink}
				title={draft.title.trim() || (isNew ? "New form" : "Untitled form")}
				badge={saved ? <FormStatusBadge status={saved.status} /> : null}
				description={
					isNew
						? "Write the fields as HTML, then save. You can embed the form once it's saved."
						: "Edit the form's fields, settings, messages and actions."
				}
				actions={
					<>
						<span className="cfa-help" role="status" aria-live="polite">
							{statusText}
						</span>
						<Button
							variant="primary"
							icon={<FloppyDisk aria-hidden="true" />}
							loading={saving}
							disabled={saving}
							aria-keyshortcuts="Control+S Meta+S"
							onClick={() => void save()}
						>
							{isNew ? "Create form" : "Save"}
						</Button>
					</>
				}
			/>
			<LiveRegion message={announcement} />

			{errorList.length ? (
				<section
					id="cfa-error-summary"
					tabIndex={-1}
					aria-labelledby="cfa-error-summary-title"
					className="cfa-card cfa-error-summary"
				>
					<h2 id="cfa-error-summary-title" className="cfa-label">
						{errorList.length === 1 ? "Fix this error to save:" : `Fix these ${errorList.length} errors to save:`}
					</h2>
					<ul>
						{errorList.map((item) => (
							<li key={item.key}>
								<button
									type="button"
									className="cfa-link-button cfa-link-accent"
									onClick={() => {
										if (item.tab !== tab) setTab(item.tab);
										focusSoon(item.field);
									}}
								>
									{item.text}
								</button>
							</li>
						))}
					</ul>
				</section>
			) : null}

			{saveError ? <ErrorNotice title="The form wasn't saved" message={saveError} onRetry={() => void save()} /> : null}
			{notice ? (
				<Notice variant="alert" title="Slug changed" onDismiss={() => setNotice(null)}>
					{notice}
				</Notice>
			) : null}

			{shortcode ? (
				<section className="cfa-card cfa-stack-sm" aria-labelledby="cfa-embed-title">
					<h2 id="cfa-embed-title" className="cfa-section-title">
						Embed
					</h2>
					<div className="cfa-snippet">
						<code>{shortcode}</code>
						<CopyButton text={shortcode} label="Copy shortcode" />
					</div>
					<p className="cfa-help">
						In the editor, type / and choose the Form block. The shortcode works in HTML sections and in templates that call renderFormsInHtml().
						{draft.slug.trim() !== saved?.slug ? " Save to update the shortcode with the new slug." : ""}
					</p>
				</section>
			) : null}

			<div>
				<TabList tabs={tabs} active={tab} onChange={setTab} idBase="cfa-editor" label="Form editor sections" />
				<TabPanel idBase="cfa-editor" id="fields" active={tab}>
					{() => (
						<FieldsTab
							draft={draft}
							errors={errors}
							fieldNames={fieldNames}
							onTitle={onTitle}
							onSlug={onSlug}
							onStatus={(status) => patch({ status })}
							onMarkup={(markup) => patch({ markup })}
							announce={announce}
						/>
					)}
				</TabPanel>
				<TabPanel idBase="cfa-editor" id="settings" active={tab}>
					{() => <SettingsTab settings={draft.settings} errors={errors} formId={draft.id} onChange={patchSettings} />}
				</TabPanel>
				<TabPanel idBase="cfa-editor" id="messages" active={tab}>
					{() => <MessagesTab messages={draft.messages} onChange={setMessage} />}
				</TabPanel>
				<TabPanel idBase="cfa-editor" id="actions" active={tab}>
					{() => (
						<ActionsTab
							actions={draft.settings.actions ?? []}
							fieldNames={fieldNames}
							errors={errors.actions}
							onChange={updateActions}
							announce={announce}
						/>
					)}
				</TabPanel>
				<TabPanel idBase="cfa-editor" id="submissions" active={tab}>
					{() =>
						inboxForm ? (
							<SubmissionsInbox fixedForm={inboxForm} />
						) : (
							<p className="cfa-help">Save the form to start collecting submissions.</p>
						)
					}
				</TabPanel>
			</div>
		</AdminPage>
	);
}

function actionIndex(draft: FormDraft, actionId: string): number {
	const index = (draft.settings.actions ?? []).findIndex((action) => action.id === actionId);
	return index + 1;
}
