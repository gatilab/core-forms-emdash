/**
 * Fields tab: title, slug, status, the HTML editor with field snippets, and a
 * live preview rendered by `forms/preview` in a sandboxed iframe.
 */

import { Button, Input, Loader, Select } from "@cloudflare/kumo";
import * as React from "react";

import type { FormStatus } from "../../core/types.js";
import { isAbortError, previewForm } from "../api.js";
import {
	buildPreviewDocument,
	draftSnapshot,
	draftToPayload,
	errorMessage,
	fieldSnippet,
	insertBlock,
	SNIPPETS,
	type DraftErrors,
	type FormDraft,
	type SnippetKind,
} from "../helpers.js";

const STATUS_ITEMS = [
	{ value: "publish", label: "Published" },
	{ value: "draft", label: "Draft" },
];

const PREVIEW_DELAY = 400;

export function FieldsTab({
	draft,
	errors,
	fieldNames,
	onTitle,
	onSlug,
	onStatus,
	onMarkup,
	announce,
}: {
	draft: FormDraft;
	errors: Pick<DraftErrors, "title" | "slug" | "markup">;
	fieldNames: string[];
	onTitle: (title: string) => void;
	onSlug: (slug: string) => void;
	onStatus: (status: FormStatus) => void;
	onMarkup: (markup: string) => void;
	announce: (text: string) => void;
}) {
	const editor = React.useRef<HTMLTextAreaElement>(null);
	const caretPlaced = React.useRef(false);

	const insert = (kind: SnippetKind, label: string) => {
		const el = editor.current;
		const useCaret = el !== null && caretPlaced.current;
		const start = useCaret ? el.selectionStart : draft.markup.length;
		const end = useCaret ? el.selectionEnd : draft.markup.length;
		const { value, caret } = insertBlock(draft.markup, fieldSnippet(kind, fieldNames), start, end);
		onMarkup(value);
		caretPlaced.current = true;
		window.requestAnimationFrame(() => {
			if (!el) return;
			el.focus();
			el.setSelectionRange(caret, caret);
		});
		announce(`Inserted a ${label.toLowerCase()} field.`);
	};

	const markupDescribedBy = ["cfa-markup-help", errors.markup ? "cfa-markup-error" : null].filter(Boolean).join(" ");

	return (
		<div className="cfa-editor-grid">
			<div className="cfa-stack">
				<div className="cfa-card cfa-stack">
					<Input
						id="cfa-field-title"
						label="Title"
						required
						value={draft.title}
						placeholder="Contact form"
						error={errors.title}
						onChange={(event) => onTitle(event.target.value)}
					/>
					<div className="cfa-grid-2">
						<Input
							id="cfa-field-slug"
							label="Slug"
							required
							value={draft.slug}
							placeholder="contact"
							description="Lowercase letters, numbers and hyphens. The shortcode uses it."
							error={errors.slug}
							spellCheck={false}
							autoCapitalize="off"
							onChange={(event) => onSlug(event.target.value)}
						/>
						<Select
							label="Status"
							value={draft.status}
							items={STATUS_ITEMS}
							description="Draft forms don't render on the site."
							onValueChange={(value) => onStatus(value === "draft" ? "draft" : "publish")}
						/>
					</div>
				</div>

				<div className="cfa-card cfa-stack">
					<div className="cfa-stack-xs">
						<label htmlFor="cfa-field-markup" className="cfa-label">
							Form HTML <span aria-hidden="true">*</span>
						</label>
						<p id="cfa-markup-help" className="cfa-help">
							Write the fields as plain HTML. Every input, select and textarea needs a name attribute. Core Forms
							adds the &lt;form&gt; tag, hidden fields, honeypot and CAPTCHA for you. Prefill a value from the page address with{" "}
							<code className="cfa-mono">{"{{url_params.utm_source || direct}}"}</code>.
						</p>
					</div>
					<div className="cfa-row" role="group" aria-label="Insert a field at the cursor">
						<span className="cfa-help" aria-hidden="true">
							Insert:
						</span>
						{SNIPPETS.map((snippet) => (
							<Button
								key={snippet.kind}
								size="sm"
								variant="secondary"
								aria-label={`Insert ${snippet.label.toLowerCase()} field`}
								onClick={() => insert(snippet.kind, snippet.label)}
							>
								{snippet.label}
							</Button>
						))}
					</div>
					<textarea
						id="cfa-field-markup"
						ref={editor}
						className="cfa-code"
						value={draft.markup}
						rows={22}
						wrap="off"
						spellCheck={false}
						autoCapitalize="off"
						autoCorrect="off"
						autoComplete="off"
						aria-required="true"
						aria-invalid={errors.markup ? true : undefined}
						aria-describedby={markupDescribedBy}
						onFocus={() => {
							caretPlaced.current = true;
						}}
						onChange={(event) => onMarkup(event.target.value)}
					/>
					{errors.markup ? (
						<p id="cfa-markup-error" className="cfa-error-text">
							{errors.markup}
						</p>
					) : null}
					<div className="cfa-stack-xs">
						<p className="cfa-help">
							{fieldNames.length
								? `${fieldNames.length === 1 ? "1 field" : `${fieldNames.length} fields`} detected:`
								: "No named fields yet. Give each input, select and textarea a name attribute."}
						</p>
						{fieldNames.length ? (
							<ul className="cfa-chips" aria-label="Detected field names">
								{fieldNames.map((name) => (
									<li key={name}>
										<span className="cfa-chip">{name}</span>
									</li>
								))}
							</ul>
						) : null}
					</div>
				</div>
			</div>

			<FormPreview draft={draft} />
		</div>
	);
}

function FormPreview({ draft }: { draft: FormDraft }) {
	const [html, setHtml] = React.useState<string | null>(null);
	const [loading, setLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);
	// Refetch only when the content that would be sent changes, not on every new draft object.
	const key = React.useMemo(() => draftSnapshot(draft), [draft]);
	const [retry, setRetry] = React.useState(0);

	React.useEffect(() => {
		const payload = draftToPayload(draft);
		const controller = new AbortController();
		setLoading(true);
		const timer = window.setTimeout(() => {
			previewForm(payload, { signal: controller.signal })
				.then(({ html: next }) => {
					setHtml(next);
					setError(null);
				})
				.catch((cause: unknown) => {
					if (isAbortError(cause)) return;
					setError(errorMessage(cause, "Could not render the preview."));
				})
				.finally(() => {
					if (!controller.signal.aborted) setLoading(false);
				});
		}, PREVIEW_DELAY);
		return () => {
			window.clearTimeout(timer);
			controller.abort();
		};
		// `draft` is fresh whenever `key` changes; same-content drafts don't need a new preview.
	}, [key, retry]);

	const doc = React.useMemo(() => (html === null ? null : buildPreviewDocument(html)), [html]);

	return (
		<section className="cfa-card cfa-stack cfa-sticky" aria-labelledby="cfa-preview-title">
			<div className="cfa-row cfa-between">
				<h2 id="cfa-preview-title" className="cfa-section-title">
					Preview
				</h2>
				{loading ? <Loader size="sm" aria-label="Updating preview" /> : null}
			</div>
			<div className="cfa-preview-wrap" aria-busy={loading}>
				{doc !== null ? (
					<iframe title="Form preview" className="cfa-preview-frame" sandbox="" srcDoc={doc} referrerPolicy="no-referrer" />
				) : error ? null : (
					<div className="cfa-preview-frame" aria-hidden="true" />
				)}
			</div>
			{error ? (
				<div className="cfa-row" role="alert">
					<p className="cfa-error-text cfa-grow">{error}</p>
					<Button size="sm" variant="secondary" onClick={() => setRetry((n) => n + 1)}>
						Retry
					</Button>
				</div>
			) : null}
			<p className="cfa-help">
				The preview uses neutral styles, and scripts, CAPTCHA widgets and custom JavaScript don't run here. Submitting
				is disabled.
			</p>
		</section>
	);
}
