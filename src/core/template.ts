/**
 * Core Forms template syntax.
 *
 * - In emails and messages: `[field_name]`, `[all]`, `[all:label]` and the
 *   `[CF_*]` metadata tokens, filled from a submission.
 * - In form markup: `{{url_params.utm_source || direct}}`, `{{post.title}}`
 *   and `{{user.email}}`, filled when the form renders.
 */
import { fieldLabel, type FieldInfo } from "./markup.js";
import type { FieldValue, FormDefinition, Submission } from "./types.js";

export type Escape = (value: string) => string;

export const escapeHtml: Escape = (value) =>
	value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const identity: Escape = (v) => v;

export function fieldValueText(value: FieldValue | undefined): string {
	if (value === undefined || value === null) return "";
	return Array.isArray(value) ? value.join(", ") : String(value);
}

export interface DataContext {
	form: Pick<FormDefinition, "id" | "slug" | "title">;
	submission: Pick<Submission, "id" | "data" | "submittedAt" | "ip" | "userAgent" | "refererUrl">;
	fields: FieldInfo[];
	/** For `[CF_SITE_NAME]` / `[CF_SITE_URL]`. */
	site?: { name?: string; url?: string };
}

function hostOf(url: string | null | undefined): string {
	try {
		return url ? new URL(url).host : "";
	} catch {
		return "";
	}
}

function pathOf(url: string | null | undefined): string {
	try {
		return url ? new URL(url).pathname : "";
	} catch {
		return "";
	}
}

/** WordPress's MySQL datetime shape, "2026-10-05 04:03:41", in UTC. */
function mysqlTime(iso: string | null | undefined): string {
	return iso ? iso.replace("T", " ").replace(/\.\d+Z$|Z$/, "") : "";
}

function formatTime(iso: string | null | undefined, options: Intl.DateTimeFormatOptions): string {
	const date = iso ? new Date(iso) : null;
	return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options }).format(date) : "";
}

/**
 * Replace `[tokens]` in `template` the way Core Forms for WordPress does:
 * `[CF_*]` metadata, `[all]` / `[all:label]`, then a field value. As in
 * WordPress, any other bracketed key becomes the matching field or nothing,
 * so a misspelt tag such as `[CF_REFERER]` disappears instead of reaching the
 * recipient. Values are escaped with `escape` (HTML for HTML emails,
 * identity for plain text and subjects).
 */
export function replaceDataVariables(template: string, ctx: DataContext, escape: Escape = identity): string {
	const { submission, form, fields, site } = ctx;
	const byName = new Map(fields.map((f) => [f.name, f]));
	const html = escape !== identity;
	return template.replace(/\[([^\]\n]+?)\]/g, (_match, key: string) => {
		switch (key) {
			case "CF_FORM_ID":
				return escape(form.id);
			case "CF_FORM_SLUG":
				return escape(form.slug);
			case "CF_FORM_TITLE":
				return escape(form.title);
			case "CF_SUBMISSION_ID":
				return escape(submission.id ?? "");
			case "CF_TIMESTAMP":
				return escape(mysqlTime(submission.submittedAt));
			case "CF_DATE":
				return escape(formatTime(submission.submittedAt, { dateStyle: "long" }));
			case "CF_TIME":
				return escape(formatTime(submission.submittedAt, { timeStyle: "short" }));
			case "CF_IP_ADDRESS":
				return escape(submission.ip ?? "");
			case "CF_USER_AGENT":
				return escape(submission.userAgent ?? "");
			case "CF_REFERRER_URL":
			case "CF_POST_URL":
				return escape(submission.refererUrl ?? "");
			case "CF_REFERRER_HOST":
				return escape(hostOf(submission.refererUrl));
			case "CF_REFERRER_PATH":
				return escape(pathOf(submission.refererUrl));
			case "CF_SITE_NAME":
				return escape(site?.name ?? "");
			case "CF_SITE_URL":
				return escape(site?.url ?? "");
			case "all":
			case "all:label": {
				const rows = Object.entries(submission.data)
					.map(([name, value]) => ({ name, text: fieldValueText(value) }))
					.filter((r) => r.text !== "")
					.map((r) => ({ label: key === "all:label" ? fieldLabel(byName.get(r.name), r.name) : r.name, text: r.text }));
				if (!html) return rows.map((r) => `${r.label}: ${r.text}`).join("\n");
				return rows.map((r) => `<strong>${escape(r.label)}:</strong> ${escape(r.text).replace(/\n/g, "<br>")}`).join("<br />");
			}
		}
		// WordPress-only metadata (post ids, logged-in user, payments, admin
		// email) has no source here and renders empty, like a missing field.
		const name = key.replace(/ /g, "_");
		const text = Object.prototype.hasOwnProperty.call(submission.data, name) ? fieldValueText(submission.data[name]) : "";
		return html ? escape(text).replace(/\n/g, "<br>") : text;
	});
}

export interface MarkupContext {
	/** Query string of the page the form renders on. */
	urlParams?: URLSearchParams;
	post?: Record<string, string | undefined>;
	user?: Record<string, string | undefined>;
}

/** Fill `{{tag.param || default}}` placeholders in form markup. Values are HTML-escaped. */
export function fillMarkupTags(markup: string, ctx: MarkupContext = {}): string {
	if (!markup.includes("{{")) return markup;
	return markup.replace(/\{\{ *(\w+)(?:\.([.\w]+))? *(?:\|\| *([^}]*?))? *\}\}/g, (match, tag: string, param = "", fallback = "") => {
		let value: string | undefined;
		if (tag === "url_params") value = ctx.urlParams?.get(param) ?? undefined;
		else if (tag === "post") value = ctx.post?.[param];
		else if (tag === "user") value = ctx.user?.[param];
		else return match;
		return escapeHtml(value || fallback);
	});
}
