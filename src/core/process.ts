/**
 * The submission pipeline, ported from Core Forms for WordPress:
 * availability → honeypot → rate limit → field allowlist → validation →
 * CAPTCHA → duplicate check → store → actions. Storage, KV, CAPTCHA and
 * actions are injected, so the whole flow is unit-testable.
 */
import { message } from "./defaults.js";
import { parseFields, type FieldInfo } from "./markup.js";
import { isOpen } from "./render.js";
import type { DataContext } from "./template.js";
import type { CaptchaProvider, FieldValue, FormDefinition, Submission, SubmitResponse } from "./types.js";
import { collect, validate, type RawEntry } from "./validate.js";
import { TOKEN_FIELD } from "./captcha.js";

export type BlockReason = "honeypot" | "rateLimit" | "captcha" | "duplicate";

export interface ProcessDeps {
	now: () => Date;
	newId: () => string;
	/** Submissions stored for this form so far (for `submission_limit`). */
	countSubmissions: (formId: string) => Promise<number>;
	saveSubmission: (submission: Submission) => Promise<void>;
	/** Atomically add one to a counter in the current window; returns the new count. */
	incrementCounter: (key: string, windowMs: number) => Promise<number>;
	/** Remember a key for `ttlMs`; returns true if it was already remembered. */
	seen: (key: string, ttlMs: number) => Promise<boolean>;
	verifyCaptcha: (provider: Exclude<CaptchaProvider, "none">, token: string, ip?: string | null) => Promise<boolean>;
	/** Run after the response (email, webhooks). */
	afterSuccess: (ctx: DataContext) => void;
	recordBlocked?: (formId: string, reason: BlockReason) => void;
	hash: (value: string) => Promise<string>;
}

export interface RequestInfo {
	ip?: string | null;
	userAgent?: string | null;
	refererUrl?: string | null;
	country?: string | null;
	/** Store the IP with the submission (GlobalSettings.storeIp). */
	storeIp?: boolean;
}

export interface ProcessResult {
	status: number;
	response: SubmitResponse;
	submission?: Submission;
}

const HOUR = 3_600_000;
const DUPLICATE_WINDOW = 10 * 60_000;

function fail(form: FormDefinition, key: Parameters<typeof message>[1], status: number, fields?: string[]): ProcessResult {
	return { status, response: { error: true, message: { type: "error", text: message(form.messages, key) }, ...(fields?.length ? { fields } : {}) } };
}

function success(form: FormDefinition): SubmitResponse {
	return {
		message: { type: "success", text: message(form.messages, "success") },
		...(form.settings.hide_after_success ? { hide_form: true } : {}),
		...(safeRedirect(form.settings.redirect_url) ? { redirect_url: safeRedirect(form.settings.redirect_url) } : {}),
	};
}

/** Same-site redirects only: a path, or an absolute URL that the route layer re-checks against the origin. */
export function safeRedirect(url: string | undefined): string | undefined {
	const u = url?.trim();
	if (!u) return undefined;
	if (/^\/(?!\/)/.test(u)) return u;
	if (/^https?:\/\//i.test(u)) return u;
	return undefined;
}

function fingerprint(data: Record<string, FieldValue>): string {
	return JSON.stringify(Object.keys(data).sort().map((k) => [k, data[k]]));
}

export async function processSubmission(
	form: FormDefinition | null,
	entries: RawEntry[],
	request: RequestInfo,
	deps: ProcessDeps,
): Promise<ProcessResult> {
	if (!form || form.status !== "publish") {
		return { status: 404, response: { error: true, message: { type: "error", text: "This form is no longer available." } } };
	}
	const s = form.settings;
	const fields: FieldInfo[] = parseFields(form.markup);
	const { data, control } = collect(entries, fields);
	const now = deps.now();

	if (!isOpen(form, now)) return fail(form, "form_closed", 403);

	// Honeypot: missing (stripped by a cache/optimiser) or filled (a bot) both
	// get the generic success reply, so bots can't probe for the right payload.
	if (s.enable_honeypot !== false) {
		const hp = control[`_cf_h${form.id}`];
		if (hp === undefined || hp !== "") {
			deps.recordBlocked?.(form.id, "honeypot");
			return { status: 200, response: { message: { type: "success", text: message(form.messages, "success") } } };
		}
	}

	if (s.submission_limit && (await deps.countSubmissions(form.id)) >= s.submission_limit) {
		return fail(form, "submission_limit_reached", 403);
	}

	const ipKey = request.ip ? await deps.hash(`${request.ip}|${form.id}`) : null;
	if (s.rate_limit && ipKey) {
		const count = await deps.incrementCounter(`rl:${ipKey}`, HOUR);
		if (count > s.rate_limit) {
			deps.recordBlocked?.(form.id, "rateLimit");
			return fail(form, "rate_limited", 429);
		}
	}

	const invalid = validate(form, fields, data);
	if (invalid.error) return fail(form, invalid.error, 422, invalid.fields);

	if (s.captcha && s.captcha !== "none") {
		const ok = await deps.verifyCaptcha(s.captcha, control[TOKEN_FIELD[s.captcha]] ?? "", request.ip);
		if (!ok) {
			deps.recordBlocked?.(form.id, "captcha");
			return fail(form, "spam", 400);
		}
	}

	// A double click or a resubmitted page: answer success, store nothing new.
	if (s.prevent_duplicates) {
		const key = `dup:${await deps.hash(`${ipKey ?? ""}|${form.id}|${fingerprint(data)}`)}`;
		if (await deps.seen(key, DUPLICATE_WINDOW)) {
			deps.recordBlocked?.(form.id, "duplicate");
			return { status: 200, response: success(form) };
		}
	}

	const submission: Submission = {
		id: deps.newId(),
		formId: form.id,
		data,
		status: "new",
		submittedAt: now.toISOString(),
		ip: request.storeIp === false ? null : (request.ip ?? null),
		userAgent: request.userAgent?.slice(0, 500) ?? null,
		refererUrl: request.refererUrl?.slice(0, 2000) ?? null,
		country: request.country ?? null,
	};
	if (s.save_submissions !== false) await deps.saveSubmission(submission);
	deps.afterSuccess({ form, submission, fields });

	return { status: 200, response: success(form), submission };
}
