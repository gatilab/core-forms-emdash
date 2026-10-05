/**
 * Actions that run after a successful submission: notification email,
 * autoresponder and webhook.
 *
 * EmDash's email API has no From field (the active provider plugin owns the
 * sender), so Core Forms' `from` / `from_name` are not used; `reply_to` and
 * the notification's Reply-To header are.
 */
import type { FieldInfo } from "./markup.js";
import { escapeHtml, replaceDataVariables, type DataContext } from "./template.js";
import type { AutoresponderAction, EmailAction, FormAction, WebhookAction } from "./types.js";
import { isEmail } from "./validate.js";

export interface EmailMessage {
	to: string;
	cc?: string[];
	replyTo?: string;
	subject: string;
	text: string;
	html?: string;
}

export interface ActionDeps {
	sendEmail?: (message: EmailMessage) => Promise<void>;
	fetch?: (url: string, init?: RequestInit) => Promise<Response>;
	log?: { info(msg: string, data?: unknown): void; warn(msg: string, data?: unknown): void };
}

export interface ActionResult {
	type: string;
	ok: boolean;
	skipped?: string;
	error?: string;
}

const htmlToText = (html: string) =>
	html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|h\d|li|tr)>/gi, "\n")
		.replace(/<li\b[^>]*>/gi, "- ")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

const addresses = (value: string) =>
	value
		.split(/[,;]/)
		.map((s) => s.trim())
		.filter(isEmail);

/** Subject lines: tokens filled as plain text, newlines removed. */
const subjectLine = (template: string, ctx: DataContext) =>
	replaceDataVariables(template, ctx).replace(/[\r\n]+/g, " ").trim().slice(0, 300);

function body(template: string, contentType: string | undefined, ctx: DataContext): { text: string; html?: string } {
	if (contentType === "text/plain") return { text: replaceDataVariables(template, ctx) };
	const html = replaceDataVariables(template, ctx, escapeHtml);
	return { html, text: htmlToText(html) };
}

function headerValue(headers: string | undefined, name: string): string | undefined {
	for (const line of (headers ?? "").split(/\r?\n/)) {
		const m = line.match(/^\s*([\w-]+)\s*:\s*(.+)$/);
		if (m && m[1]!.toLowerCase() === name.toLowerCase()) return m[2]!.trim();
	}
	return undefined;
}

async function runEmail(action: EmailAction, ctx: DataContext, deps: ActionDeps): Promise<ActionResult> {
	if (!deps.sendEmail) return { type: "email", ok: false, skipped: "no email provider configured" };
	const to = addresses(replaceDataVariables(action.to ?? "", ctx));
	if (!to.length) return { type: "email", ok: false, skipped: "no valid recipient" };
	const replyTo = addresses(replaceDataVariables(headerValue(action.headers, "Reply-To") ?? "", ctx))[0];
	const cc = [...to.slice(1), ...addresses(headerValue(action.headers, "Cc") ?? ""), ...addresses(headerValue(action.headers, "Bcc") ?? "")];
	await deps.sendEmail({
		to: to[0]!,
		...(cc.length ? { cc } : {}),
		...(replyTo ? { replyTo } : {}),
		subject: subjectLine(action.subject ?? "", ctx),
		...body(action.message ?? "", action.content_type, ctx),
	});
	return { type: "email", ok: true };
}

async function runAutoresponder(action: AutoresponderAction, ctx: DataContext, deps: ActionDeps): Promise<ActionResult> {
	if (!deps.sendEmail) return { type: "autoresponder", ok: false, skipped: "no email provider configured" };
	const raw = ctx.submission.data[action.email_field?.replace(/^\[|\]$/g, "") ?? ""];
	const to = addresses(Array.isArray(raw) ? raw.join(",") : (raw ?? ""))[0];
	if (!to) return { type: "autoresponder", ok: false, skipped: "submission has no valid address" };
	const replyTo = addresses(action.reply_to ?? "")[0];
	await deps.sendEmail({
		to,
		...(replyTo ? { replyTo } : {}),
		subject: subjectLine(action.subject ?? "", ctx),
		...body(action.message ?? "", action.content_type, ctx),
	});
	return { type: "autoresponder", ok: true };
}

/** Webhook payload: the field data plus form and submission metadata. */
export function webhookPayload(ctx: DataContext) {
	return {
		form: { id: ctx.form.id, slug: ctx.form.slug, title: ctx.form.title },
		submission: { id: ctx.submission.id, submittedAt: ctx.submission.submittedAt, refererUrl: ctx.submission.refererUrl ?? null },
		data: ctx.submission.data,
	};
}

async function runWebhook(action: WebhookAction, ctx: DataContext, deps: ActionDeps): Promise<ActionResult> {
	if (!deps.fetch) return { type: "webhook", ok: false, skipped: "network access unavailable" };
	let url: URL;
	try {
		url = new URL(action.url);
		if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("bad protocol");
	} catch {
		return { type: "webhook", ok: false, error: "invalid URL" };
	}
	const payload = webhookPayload(ctx);
	const init: RequestInit =
		action.content_type === "form"
			? {
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams(
						Object.entries(payload.data).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [`${k}[]`, x]) : [[k, v]])),
					).toString(),
				}
			: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
	const res = await deps.fetch(url.toString(), init);
	return res.ok ? { type: "webhook", ok: true } : { type: "webhook", ok: false, error: `HTTP ${res.status}` };
}

/** Run every enabled action; one failing action never stops the others. */
export async function runActions(actions: FormAction[] | undefined, ctx: DataContext, deps: ActionDeps): Promise<ActionResult[]> {
	const results: ActionResult[] = [];
	for (const action of actions ?? []) {
		if (action.enabled === false) continue;
		try {
			switch (action.type) {
				case "email":
					results.push(await runEmail(action as EmailAction, ctx, deps));
					break;
				case "autoresponder":
					results.push(await runAutoresponder(action as AutoresponderAction, ctx, deps));
					break;
				case "webhook":
					results.push(await runWebhook(action as WebhookAction, ctx, deps));
					break;
				default:
					results.push({ type: action.type, ok: false, skipped: "action type not supported in EmDash" });
			}
		} catch (err) {
			results.push({ type: action.type, ok: false, error: err instanceof Error ? err.message : String(err) });
		}
	}
	for (const r of results) {
		if (r.error) deps.log?.warn(`Core Forms action failed: ${r.type}`, r);
		else if (r.skipped) deps.log?.info(`Core Forms action skipped: ${r.type}`, r);
	}
	return results;
}

export type { FieldInfo };
