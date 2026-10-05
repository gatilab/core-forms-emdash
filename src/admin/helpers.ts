/**
 * Pure helpers for the admin UI. No React and no DOM, so they run under
 * vitest in Node. Parsing and defaults come from `../core` so the admin and
 * the server agree on which fields a form declares.
 */

import { DEFAULT_MESSAGES, DEFAULT_SETTINGS } from "../core/defaults.js";
import { dataFieldNames, parseFields } from "../core/markup.js";
import { slugify } from "../core/normalize.js";
import type {
	AutoresponderAction,
	EmailAction,
	FieldValue,
	FormAction,
	FormDefinition,
	FormMessages,
	FormSettings,
	FormStatus,
	MessageKey,
	SubmissionStatus,
	WebhookAction,
} from "../core/types.js";

export { DEFAULT_MESSAGES, DEFAULT_SETTINGS, slugify };

// =============================================================================
// Drafts
// =============================================================================

export const SLUG_PATTERN = /^[a-z0-9-]+$/;

/** The editable copy of a form held by the editor. */
export interface FormDraft {
	id?: string;
	title: string;
	slug: string;
	status: FormStatus;
	markup: string;
	settings: FormSettings;
	messages: FormMessages;
}

/** What `forms/save` accepts. */
export type FormPayload = Partial<FormDefinition> & Pick<FormDefinition, "title" | "markup">;

export const STARTER_MARKUP = `<p>
	<label for="cf-name">Name</label>
	<input type="text" id="cf-name" name="name" autocomplete="name" required>
</p>
<p>
	<label for="cf-email">Email</label>
	<input type="email" id="cf-email" name="email" autocomplete="email" required>
</p>
<p>
	<label for="cf-message">Message</label>
	<textarea id="cf-message" name="message" rows="5" required></textarea>
</p>
<p>
	<button type="submit">Send</button>
</p>
`;

export function newDraft(): FormDraft {
	return {
		title: "",
		slug: "",
		status: "publish",
		markup: STARTER_MARKUP,
		settings: { actions: [] },
		messages: {},
	};
}

export function draftFromForm(form: FormDefinition): FormDraft {
	return {
		id: form.id,
		title: form.title,
		slug: form.slug,
		status: form.status,
		markup: form.markup,
		settings: { ...form.settings, actions: ensureActionIds(form.settings?.actions ?? []) },
		messages: { ...form.messages },
	};
}

/** The `forms/save` / `forms/preview` body for a draft. Empty messages fall back to the defaults. */
export function draftToPayload(draft: FormDraft): FormPayload {
	const messages: FormMessages = {};
	for (const [key, value] of Object.entries(draft.messages)) {
		if (typeof value === "string" && value.trim()) messages[key] = value;
	}
	const settings: FormSettings = {};
	for (const [key, value] of Object.entries(draft.settings) as [keyof FormSettings, unknown][]) {
		if (value === undefined || value === "") continue;
		(settings as Record<string, unknown>)[key] = value;
	}
	return {
		...(draft.id ? { id: draft.id } : {}),
		title: draft.title.trim(),
		slug: draft.slug.trim(),
		status: draft.status,
		markup: draft.markup,
		settings,
		messages,
	};
}

/** JSON with sorted keys, so two drafts with the same content compare equal. */
export function stableStringify(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

/** A comparable fingerprint of what would be saved, for dirty-state tracking. */
export function draftSnapshot(draft: FormDraft): string {
	return stableStringify(draftToPayload(draft));
}

/** Fill an empty slug from the title, the way a new form gets its slug. */
export function withDefaultSlug(draft: FormDraft): FormDraft {
	if (draft.slug.trim()) return draft;
	return { ...draft, slug: slugify(draft.title) };
}

// =============================================================================
// Validation
// =============================================================================

export type ActionFieldErrors = Partial<Record<string, string>>;

export interface DraftErrors {
	title?: string;
	slug?: string;
	markup?: string;
	redirect_url?: string;
	schedule?: string;
	/** Keyed by action id, then by action field. */
	actions?: Record<string, ActionFieldErrors>;
}

export type EditorTab = "fields" | "settings" | "messages" | "actions" | "submissions";

const HTTP_URL = /^https?:\/\/[^\s/$.?#][^\s]*$/i;

/** Same rule the server applies to `redirect_url`: a same-site path or an http(s) URL. */
export function isValidRedirect(url: string): boolean {
	const u = url.trim();
	return /^\/(?!\/)/.test(u) || HTTP_URL.test(u);
}

export function validateDraft(draft: FormDraft): DraftErrors {
	const errors: DraftErrors = {};
	if (!draft.title.trim()) errors.title = "Give the form a title.";

	const slug = draft.slug.trim();
	if (!slug) errors.slug = "Add a slug. Use lowercase letters, numbers and hyphens.";
	else if (!SLUG_PATTERN.test(slug)) errors.slug = "Use only lowercase letters (a-z), numbers and hyphens.";

	if (!draft.markup.trim()) errors.markup = "Add the form's fields as HTML.";

	const s = draft.settings;
	if (s.redirect_url?.trim() && !isValidRedirect(s.redirect_url)) {
		errors.redirect_url = "Use a path on this site, like /thank-you, or a full http(s) URL.";
	}

	const open = s.schedule_open ? Date.parse(s.schedule_open) : undefined;
	const close = s.schedule_close ? Date.parse(s.schedule_close) : undefined;
	if ((open !== undefined && Number.isNaN(open)) || (close !== undefined && Number.isNaN(close))) {
		errors.schedule = "Enter a valid date and time.";
	} else if (open !== undefined && close !== undefined && close <= open) {
		errors.schedule = "The closing time must be after the opening time.";
	}

	const actionErrors: Record<string, ActionFieldErrors> = {};
	(s.actions ?? []).forEach((action, index) => {
		if (action.enabled === false || !isKnownAction(action)) return;
		const found = validateAction(action);
		if (Object.keys(found).length) actionErrors[action.id ?? `#${index}`] = found;
	});
	if (Object.keys(actionErrors).length) errors.actions = actionErrors;

	return errors;
}

export function validateAction(action: KnownAction): ActionFieldErrors {
	const errors: ActionFieldErrors = {};
	const blank = (v: string | undefined) => !v || !v.trim();
	switch (action.type) {
		case "email":
			if (blank(action.to)) errors.to = "Add at least one recipient.";
			if (blank(action.subject)) errors.subject = "Add a subject.";
			if (blank(action.message)) errors.message = "Add a message.";
			break;
		case "autoresponder":
			if (blank(action.email_field)) errors.email_field = "Choose the field that holds the visitor's email address.";
			if (blank(action.subject)) errors.subject = "Add a subject.";
			if (blank(action.message)) errors.message = "Add a message.";
			break;
		case "webhook":
			if (blank(action.url)) errors.url = "Add the URL to send submissions to.";
			else if (!HTTP_URL.test(action.url.trim())) errors.url = "Use a full http(s) URL.";
			break;
	}
	return errors;
}

export function hasErrors(errors: DraftErrors): boolean {
	return Object.values(errors).some((v) => v !== undefined);
}

/** The editor tab that shows the first error, in tab order. */
export function firstTabWithErrors(errors: DraftErrors): EditorTab | null {
	if (errors.title || errors.slug || errors.markup) return "fields";
	if (errors.redirect_url || errors.schedule) return "settings";
	if (errors.actions) return "actions";
	return null;
}

// =============================================================================
// Markup
// =============================================================================

/**
 * Field names declared by the markup, in document order: the names a submission
 * can carry and the `[field]` tokens actions can use. Buttons and names that
 * start with "_" (dropped by the server) are left out; "[]" is stripped.
 */
export function detectFieldNames(markup: string): string[] {
	return dataFieldNames(parseFields(markup)).filter((name) => !name.startsWith("_"));
}

export function uniqueFieldName(base: string, existing: readonly string[]): string {
	if (!existing.includes(base)) return base;
	for (let i = 2; ; i++) {
		const candidate = `${base}_${i}`;
		if (!existing.includes(candidate)) return candidate;
	}
}

export type SnippetKind = "text" | "email" | "tel" | "textarea" | "select" | "checkbox" | "radio" | "submit";

export const SNIPPETS: readonly { kind: SnippetKind; label: string }[] = [
	{ kind: "text", label: "Text" },
	{ kind: "email", label: "Email" },
	{ kind: "tel", label: "Phone" },
	{ kind: "textarea", label: "Textarea" },
	{ kind: "select", label: "Select" },
	{ kind: "checkbox", label: "Checkbox" },
	{ kind: "radio", label: "Radio" },
	{ kind: "submit", label: "Submit button" },
];

/** HTML for a common field, with a name that doesn't clash with `existing`. */
export function fieldSnippet(kind: SnippetKind, existing: readonly string[]): string {
	const input = (base: string, type: string, label: string, extra = "") => {
		const name = uniqueFieldName(base, existing);
		return `<p>\n\t<label for="cf-${name}">${label}</label>\n\t<input type="${type}" id="cf-${name}" name="${name}"${extra}>\n</p>`;
	};
	switch (kind) {
		case "text":
			return input("text", "text", "Text");
		case "email":
			return input("email", "email", "Email", ' autocomplete="email"');
		case "tel":
			return input("phone", "tel", "Phone", ' autocomplete="tel"');
		case "textarea": {
			const name = uniqueFieldName("message", existing);
			return `<p>\n\t<label for="cf-${name}">Message</label>\n\t<textarea id="cf-${name}" name="${name}" rows="5"></textarea>\n</p>`;
		}
		case "select": {
			const name = uniqueFieldName("choice", existing);
			return [
				"<p>",
				`\t<label for="cf-${name}">Choose one</label>`,
				`\t<select id="cf-${name}" name="${name}">`,
				'\t\t<option value="">Select…</option>',
				'\t\t<option value="Option one">Option one</option>',
				'\t\t<option value="Option two">Option two</option>',
				"\t</select>",
				"</p>",
			].join("\n");
		}
		case "checkbox": {
			const name = uniqueFieldName("consent", existing);
			return `<p>\n\t<label><input type="checkbox" name="${name}" value="yes"> I agree to be contacted</label>\n</p>`;
		}
		case "radio": {
			const name = uniqueFieldName("option", existing);
			return [
				"<fieldset>",
				"\t<legend>Pick one</legend>",
				`\t<label><input type="radio" name="${name}" value="Option one"> Option one</label>`,
				`\t<label><input type="radio" name="${name}" value="Option two"> Option two</label>`,
				"</fieldset>",
			].join("\n");
		}
		case "submit":
			return "<p>\n\t<button type=\"submit\">Submit</button>\n</p>";
	}
}

/** Replace `start..end` of `source` with `text`. Returns the new value and the caret after the insert. */
export function insertText(source: string, text: string, start = source.length, end = start): { value: string; caret: number } {
	const from = clamp(start, 0, source.length);
	const to = clamp(Math.max(end, from), 0, source.length);
	return { value: source.slice(0, from) + text + source.slice(to), caret: from + text.length };
}

/** Insert a block of HTML on its own lines at `start..end` (default: the end). */
export function insertBlock(source: string, block: string, start = source.length, end = start): { value: string; caret: number } {
	const from = clamp(start, 0, source.length);
	const before = source.slice(0, from);
	const after = source.slice(clamp(Math.max(end, from), 0, source.length));
	const lead = before === "" || before.endsWith("\n") ? "" : "\n";
	const trail = after === "" || after.startsWith("\n") ? "" : "\n";
	return insertText(source, `${lead}${block}${trail}`, start, end);
}

function clamp(n: number, min: number, max: number): number {
	return Math.min(Math.max(n, min), max);
}

const PREVIEW_CSS = [
	":root{color-scheme:light}",
	'body{margin:0;padding:20px;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1f2328;background:#fff}',
	"p{margin:0 0 16px}",
	"label{font-weight:500}",
	"input:not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=hidden]),select,textarea{display:block;box-sizing:border-box;width:100%;max-width:36rem;margin-top:4px;padding:8px 10px;border:1px solid #c6cbd1;border-radius:6px;font:inherit;color:inherit;background:#fff}",
	"textarea{min-height:6rem}",
	"fieldset{margin:0 0 16px;padding:12px 16px;border:1px solid #d0d7de;border-radius:6px}",
	"fieldset label{display:block;font-weight:400}",
	"button,input[type=submit]{font:inherit;padding:8px 16px;border:1px solid #1f2328;border-radius:6px;background:#1f2328;color:#fff}",
	".cf-message{padding:10px 12px;border-radius:6px;background:#f6f8fa}",
	".cf-message-error{background:#ffebe9;color:#82071e}",
].join("");

/**
 * A standalone document for the preview iframe. The iframe is sandboxed with
 * no permissions; the CSP is a second lock so no script or request runs.
 */
export function buildPreviewDocument(html: string): string {
	return [
		"<!doctype html>",
		'<html lang="en"><head><meta charset="utf-8">',
		"<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:\">",
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		`<style>${PREVIEW_CSS}</style>`,
		`</head><body>${html}</body></html>`,
	].join("");
}

// =============================================================================
// Actions
// =============================================================================

export type KnownAction = EmailAction | AutoresponderAction | WebhookAction;
export type KnownActionType = KnownAction["type"];

export const ACTION_LABELS: Record<KnownActionType, string> = {
	email: "Email notification",
	autoresponder: "Autoresponder",
	webhook: "Webhook",
};

export const ACTION_DESCRIPTIONS: Record<KnownActionType, string> = {
	email: "Email the submission to you or your team.",
	autoresponder: "Send a confirmation email to the person who submitted.",
	webhook: "POST each submission to another service.",
};

export function isKnownAction(action: FormAction): action is KnownAction {
	return action.type === "email" || action.type === "autoresponder" || action.type === "webhook";
}

export function newActionId(): string {
	const random =
		typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
			? crypto.randomUUID().slice(0, 8)
			: Math.random().toString(36).slice(2, 10);
	return `action-${random}`;
}

export function ensureActionIds(actions: readonly FormAction[]): FormAction[] {
	const seen = new Set<string>();
	return actions.map((action) => {
		let id = typeof action.id === "string" && action.id ? action.id : newActionId();
		while (seen.has(id)) id = newActionId();
		seen.add(id);
		return id === action.id ? action : { ...action, id };
	});
}

export function createAction(type: KnownActionType, fieldNames: readonly string[]): KnownAction {
	const id = newActionId();
	switch (type) {
		case "email":
			return {
				id,
				type,
				enabled: true,
				to: "",
				subject: "New submission: [CF_FORM_TITLE]",
				message: "[all:label]",
				content_type: "text/html",
			};
		case "autoresponder":
			return {
				id,
				type,
				enabled: true,
				email_field: fieldNames.includes("email") ? "email" : (fieldNames[0] ?? ""),
				subject: "Thanks for getting in touch",
				message: "Thanks for your message. We will get back to you soon.",
				content_type: "text/html",
			};
		case "webhook":
			return { id, type, enabled: true, url: "", content_type: "json" };
	}
}

/** Move the item at `from` by `delta` places. Out-of-range moves return the array unchanged. */
export function moveItem<T>(items: readonly T[], from: number, delta: number): T[] {
	const to = from + delta;
	if (from < 0 || from >= items.length || to < 0 || to >= items.length) return [...items];
	const next = [...items];
	const [item] = next.splice(from, 1);
	next.splice(to, 0, item as T);
	return next;
}

export const DATA_VARIABLES: readonly { token: string; description: string }[] = [
	{ token: "[all]", description: "Every field as name: value" },
	{ token: "[all:label]", description: "Every field with its label" },
	{ token: "[CF_FORM_TITLE]", description: "The form's title" },
	{ token: "[CF_SUBMISSION_ID]", description: "The submission's id" },
	{ token: "[CF_TIMESTAMP]", description: "When it was submitted (ISO 8601)" },
	{ token: "[CF_IP_ADDRESS]", description: "The visitor's IP address" },
	{ token: "[CF_USER_AGENT]", description: "The visitor's browser" },
	{ token: "[CF_REFERRER_URL]", description: "The page the form was submitted from" },
];

// =============================================================================
// Messages
// =============================================================================

export interface MessageField {
	key: MessageKey;
	label: string;
	help: string;
}

export const MESSAGE_GROUPS: readonly { title: string; description: string; fields: readonly MessageField[] }[] = [
	{
		title: "Submission outcomes",
		description: "Shown right after someone submits the form.",
		fields: [
			{ key: "success", label: "Success", help: "Shown after a successful submission." },
			{ key: "invalid_email", label: "Invalid email address", help: "Shown when an email field fails validation." },
			{ key: "required_field_missing", label: "Required field missing", help: "Shown when a required field is empty." },
			{ key: "too_long", label: "Answer too long", help: "Shown when an answer is longer than its field allows." },
			{ key: "error", label: "General error", help: "Shown for any other failure." },
		],
	},
	{
		title: "Protection and limits",
		description: "Shown when spam protection, limits or the schedule stop a submission.",
		fields: [
			{ key: "spam", label: "Flagged as spam", help: "Shown when the honeypot, CAPTCHA or duplicate check rejects a submission." },
			{ key: "rate_limited", label: "Too many submissions", help: "Shown when a visitor goes over the hourly rate limit." },
			{ key: "submission_limit_reached", label: "Submission limit reached", help: "Shown once the form has accepted its maximum number of submissions." },
			{ key: "form_closed", label: "Form closed", help: "Shown outside the form's schedule." },
		],
	},
	{
		title: "File uploads",
		description: "Only used when the form has a file input.",
		fields: [
			{ key: "file_too_large", label: "File too large", help: "Shown when an uploaded file is over the size limit." },
			{ key: "file_upload_error", label: "Upload failed", help: "Shown when a file upload fails." },
		],
	},
];

// =============================================================================
// Submissions
// =============================================================================

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
	new: "Unread",
	read: "Read",
	spam: "Spam",
	trash: "Trash",
};

export function formatFieldValue(value: FieldValue | null | undefined): string {
	if (value === undefined || value === null) return "";
	return Array.isArray(value) ? value.join(", ") : String(value);
}

/** One-line summary of a submission: its first non-empty field, collapsed and truncated. */
export function submissionPreview(data: Record<string, FieldValue> | null | undefined, max = 80): string {
	for (const value of Object.values(data ?? {})) {
		const text = formatFieldValue(value).replace(/\s+/g, " ").trim();
		if (text) return text.length > max ? `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…` : text;
	}
	return "";
}

/** Fallback CSV download name; matches what `submissions/export` sends. */
export function csvFilename(slug: string | undefined, date: Date = new Date()): string {
	const safe = (slug ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "form";
	return `${safe}-submissions-${date.toISOString().slice(0, 10)}.csv`;
}

/** The filename from a Content-Disposition header (RFC 6266, including `filename*`). */
export function filenameFromContentDisposition(header: string | null | undefined): string | null {
	if (!header) return null;
	const clean = (name: string) => {
		const base = name.replace(/[\\/]/g, "_").replace(/[\u0000-\u001f]/g, "").trim();
		return base && base !== "." && base !== ".." ? base : null;
	};
	const extended = /filename\*\s*=\s*([^;]+)/i.exec(header);
	if (extended?.[1]) {
		let value = extended[1].trim().replace(/^"(.*)"$/, "$1");
		const encoded = /^[\w!#$%&+^`{}~-]+'[^']*'(.*)$/.exec(value);
		if (encoded) value = encoded[1] ?? "";
		try {
			const decoded = clean(decodeURIComponent(value));
			if (decoded) return decoded;
		} catch {
			// malformed percent-encoding: fall through to the plain parameter
		}
	}
	const plain = /(?:^|;)\s*filename\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]+))/i.exec(header);
	if (plain) return clean((plain[1] ?? plain[2] ?? "").replace(/\\(.)/g, "$1"));
	return null;
}

// =============================================================================
// Dates
// =============================================================================

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO 8601 → the local `YYYY-MM-DDTHH:mm` value a datetime-local input expects. */
export function isoToLocalInput(iso: string | undefined): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A datetime-local value (local time) → ISO 8601 in UTC. */
export function localInputToIso(value: string): string | undefined {
	if (!value) return undefined;
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function formatDateTime(iso: string | undefined, locale?: string): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleString(locale, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatDate(iso: string | undefined, locale?: string): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
}

/** "just now", "5 minutes ago", "yesterday"; dates older than a week are shown in full. */
export function relativeTime(iso: string | undefined, now: number = Date.now(), locale?: string): string {
	if (!iso) return "";
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return iso;
	const seconds = Math.round((then - now) / 1000);
	const abs = Math.abs(seconds);
	if (abs < 45) return "just now";
	const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
	if (abs < 45 * 60) return rtf.format(Math.round(seconds / 60), "minute");
	if (abs < 22 * 3600) return rtf.format(Math.round(seconds / 3600), "hour");
	if (abs < 7 * 86400) return rtf.format(Math.round(seconds / 86400), "day");
	return formatDate(iso, locale);
}

/** The browser's time zone name, for the schedule hint. */
export function localTimeZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
	} catch {
		return "local time";
	}
}

// =============================================================================
// Misc
// =============================================================================

export function errorMessage(error: unknown, fallback = "Something went wrong."): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === "string" && error) return error;
	return fallback;
}

export function pluralize(count: number, one: string, many = `${one}s`): string {
	return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** Normalise an uploaded JSON export into the `forms/import` list. */
export function formsFromImportJson(parsed: unknown): unknown[] {
	if (Array.isArray(parsed)) return parsed;
	if (parsed && typeof parsed === "object") {
		const record = parsed as Record<string, unknown>;
		if (Array.isArray(record.forms)) return record.forms;
		return [parsed];
	}
	return [];
}
