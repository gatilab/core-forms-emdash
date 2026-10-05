/**
 * Forms page (`/`): every form with its status and submission counts, plus
 * create, duplicate, delete and JSON import.
 */

import { Badge, Button } from "@cloudflare/kumo";
import { CopySimple, ListBullets, PencilSimple, Plus, Trash, UploadSimple } from "@phosphor-icons/react";
import * as React from "react";

import type { FormSummary } from "../core/types.js";
import { deleteForm, duplicateForm, importForms, isAbortError, listForms } from "./api.js";
import { errorMessage, formatDateTime, formsFromImportJson, pluralize, relativeTime } from "./helpers.js";
import { AdminLink, pluginHref } from "./navigation.js";
import {
	AdminLinkButton,
	AdminPage,
	CheckboxField,
	ConfirmDialog,
	EmptyState,
	ErrorNotice,
	FormStatusBadge,
	LiveRegion,
	LoadingState,
	Notice,
	PageHeader,
	useAnnouncer,
} from "./ui.js";

interface PageNotice {
	variant: "default" | "alert" | "error";
	title: string;
	text?: React.ReactNode;
}

const byRecentlyUpdated = (a: FormSummary, b: FormSummary) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");

export function FormsPage() {
	const [forms, setForms] = React.useState<FormSummary[] | null>(null);
	const [loadError, setLoadError] = React.useState<string | null>(null);
	const [busyId, setBusyId] = React.useState<string | null>(null);
	const [notice, setNotice] = React.useState<PageNotice | null>(null);
	const [announcement, announce] = useAnnouncer();

	const [deleteTarget, setDeleteTarget] = React.useState<FormSummary | null>(null);
	const [deleteSubmissions, setDeleteSubmissions] = React.useState(false);
	const [deleting, setDeleting] = React.useState(false);
	const [deleteError, setDeleteError] = React.useState<string | null>(null);

	const fileInput = React.useRef<HTMLInputElement>(null);
	const [importing, setImporting] = React.useState(false);

	const load = React.useCallback(async (signal?: AbortSignal) => {
		setLoadError(null);
		try {
			const { items } = await listForms({ signal });
			setForms([...items].sort(byRecentlyUpdated));
		} catch (error) {
			if (!isAbortError(error)) setLoadError(errorMessage(error, "Could not load forms."));
		}
	}, []);

	React.useEffect(() => {
		const controller = new AbortController();
		void load(controller.signal);
		return () => controller.abort();
	}, [load]);

	const onDuplicate = async (form: FormSummary) => {
		setBusyId(form.id);
		try {
			const { form: copy } = await duplicateForm(form.id);
			await load();
			setNotice({
				variant: "default",
				title: `Created “${copy.title}” as a draft.`,
				text: (
					<AdminLink href={pluginHref("/form", { id: copy.id })} className="cfa-link-accent">
						Edit the copy
					</AdminLink>
				),
			});
			announce(`Created ${copy.title} as a draft.`);
		} catch (error) {
			setNotice({ variant: "error", title: "Could not duplicate the form.", text: errorMessage(error) });
		} finally {
			setBusyId(null);
		}
	};

	const openDelete = (form: FormSummary) => {
		setDeleteTarget(form);
		setDeleteSubmissions(false);
		setDeleteError(null);
	};

	const confirmDelete = async () => {
		if (!deleteTarget) return;
		setDeleting(true);
		setDeleteError(null);
		try {
			await deleteForm(deleteTarget.id, deleteSubmissions);
			setForms((current) => current?.filter((f) => f.id !== deleteTarget.id) ?? null);
			announce(`Deleted ${deleteTarget.title}.`);
			setDeleteTarget(null);
		} catch (error) {
			setDeleteError(errorMessage(error, "Could not delete the form."));
		} finally {
			setDeleting(false);
		}
	};

	const onImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file) return;
		setImporting(true);
		setNotice(null);
		try {
			let parsed: unknown;
			try {
				parsed = JSON.parse(await file.text());
			} catch {
				throw new Error(`${file.name} isn't valid JSON.`);
			}
			const list = formsFromImportJson(parsed);
			if (!list.length) throw new Error(`${file.name} doesn't contain any forms.`);
			const result = await importForms(list);
			await load();
			const summary = `${pluralize(result.created, "form")} created, ${pluralize(result.updated, "form")} updated.`;
			setNotice({
				variant: result.skipped.length ? "alert" : "default",
				title: `Import finished: ${summary}`,
				text: result.skipped.length
					? `Skipped ${pluralize(result.skipped.length, "form")} without markup: ${result.skipped.join(", ")}.`
					: undefined,
			});
			announce(`Import finished. ${summary}`);
		} catch (error) {
			setNotice({ variant: "error", title: "Import failed.", text: errorMessage(error) });
		} finally {
			setImporting(false);
		}
	};

	const newFormButton = (
		<AdminLinkButton href={pluginHref("/form")} variant="primary" icon={<Plus aria-hidden="true" />}>
			New form
		</AdminLinkButton>
	);
	const importButton = (
		<Button
			variant="secondary"
			icon={<UploadSimple aria-hidden="true" />}
			loading={importing}
			disabled={importing}
			onClick={() => fileInput.current?.click()}
		>
			{importing ? "Importing…" : "Import"}
		</Button>
	);

	return (
		<AdminPage>
			<PageHeader
				title="Forms"
				description="HTML-first forms with spam protection, email actions and a submissions inbox."
				actions={
					<>
						{importButton}
						{newFormButton}
					</>
				}
			/>
			<input
				ref={fileInput}
				type="file"
				accept="application/json,.json"
				className="sr-only"
				tabIndex={-1}
				aria-hidden="true"
				onChange={(event) => void onImportFile(event)}
			/>
			<LiveRegion message={announcement} />

			{notice ? (
				<div role={notice.variant === "error" ? "alert" : undefined}>
					<Notice variant={notice.variant} title={notice.title} onDismiss={() => setNotice(null)}>
						{notice.text}
					</Notice>
				</div>
			) : null}

			{loadError ? (
				<ErrorNotice title="Could not load forms" message={loadError} onRetry={() => void load()} />
			) : forms === null ? (
				<LoadingState label="Loading forms…" />
			) : forms.length === 0 ? (
				<EmptyState
					icon={<ListBullets size={40} aria-hidden="true" />}
					title="No forms yet"
					description="Core Forms builds forms from plain HTML. Write your fields as input, select and textarea elements with name attributes; the plugin adds validation, spam protection, storage and email notifications. You can also import a Core Forms for WordPress export."
				>
					<div className="cfa-row" style={{ justifyContent: "center" }}>
						{newFormButton}
						{importButton}
					</div>
				</EmptyState>
			) : (
				<div className="cfa-table-wrap">
					<table className="cfa-table">
						<caption className="sr-only">Forms</caption>
						<thead>
							<tr>
								<th scope="col">Title</th>
								<th scope="col">Slug</th>
								<th scope="col">Status</th>
								<th scope="col" className="cfa-num">
									Submissions
								</th>
								<th scope="col">Updated</th>
								<th scope="col" className="cfa-actions-cell">
									<span className="sr-only">Actions</span>
								</th>
							</tr>
						</thead>
						<tbody>
							{forms.map((form) => (
								<tr key={form.id}>
									<td>
										<AdminLink href={pluginHref("/form", { id: form.id })} className="cfa-link cfa-unread">
											{form.title || "(untitled)"}
										</AdminLink>
									</td>
									<td>
										<code className="cfa-mono">{form.slug}</code>
									</td>
									<td>
										<FormStatusBadge status={form.status} />
									</td>
									<td className="cfa-num">
										<span className="cfa-row" style={{ justifyContent: "flex-end" }}>
											{form.unread > 0 ? (
												<AdminLink
													href={pluginHref("/submissions", { formId: form.id, status: "new" })}
													aria-label={`${pluralize(form.unread, "unread submission")} for ${form.title}`}
												>
													<Badge variant="info">{form.unread.toLocaleString()} unread</Badge>
												</AdminLink>
											) : null}
											<AdminLink
												href={pluginHref("/submissions", { formId: form.id })}
												className="cfa-link"
												aria-label={`${pluralize(form.submissions, "submission")} for ${form.title}`}
											>
												{form.submissions.toLocaleString()}
											</AdminLink>
										</span>
									</td>
									<td>
										<time dateTime={form.updatedAt} title={formatDateTime(form.updatedAt)}>
											{relativeTime(form.updatedAt)}
										</time>
									</td>
									<td className="cfa-actions-cell">
										<span className="cfa-row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
											<AdminLinkButton
												href={pluginHref("/form", { id: form.id })}
												variant="ghost"
												shape="square"
												aria-label={`Edit ${form.title}`}
												title={`Edit ${form.title}`}
												icon={<PencilSimple aria-hidden="true" />}
											/>
											<Button
												variant="ghost"
												shape="square"
												aria-label={`Duplicate ${form.title}`}
												loading={busyId === form.id}
												disabled={busyId !== null}
												icon={<CopySimple aria-hidden="true" />}
												onClick={() => void onDuplicate(form)}
											/>
											<Button
												variant="ghost"
												shape="square"
												aria-label={`Delete ${form.title}`}
												icon={<Trash aria-hidden="true" />}
												onClick={() => openDelete(form)}
											/>
										</span>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			<ConfirmDialog
				open={deleteTarget !== null}
				title={`Delete “${deleteTarget?.title ?? ""}”?`}
				description="Pages that embed this form will stop showing it. This can't be undone."
				confirmLabel="Delete form"
				pendingLabel="Deleting…"
				pending={deleting}
				error={deleteError}
				onConfirm={() => void confirmDelete()}
				onClose={() => setDeleteTarget(null)}
			>
				{deleteTarget && deleteTarget.submissions > 0 ? (
					<CheckboxField
						label={`Also delete its ${pluralize(deleteTarget.submissions, "submission")}`}
						checked={deleteSubmissions}
						onChange={setDeleteSubmissions}
					/>
				) : null}
			</ConfirmDialog>
		</AdminPage>
	);
}
