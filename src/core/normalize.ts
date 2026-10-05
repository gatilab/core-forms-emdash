/**
 * Turn stored, admin-submitted or WordPress-exported forms into a clean
 * `FormDefinition`. WordPress stores flags as "1" / "0" / "" strings and the
 * schedule as separate date and time fields; both shapes are accepted.
 */
import type { CaptchaProvider, FormAction, FormDefinition, FormMessages, FormSettings, FormStatus } from "./types.js";

const BOOL_KEYS = [
	"save_submissions",
	"hide_after_success",
	"enable_honeypot",
	"prevent_duplicates",
	"ajax_submit",
	"success_scroll",
	"load_form_theme",
] as const;
const NUMBER_KEYS = ["rate_limit", "submission_limit"] as const;
const STRING_KEYS = [
	"required_fields",
	"email_fields",
	"redirect_url",
	"submit_button_text",
	"loading_text",
	"form_class",
	"custom_css",
	"custom_js",
	"schedule_open",
	"schedule_close",
] as const;
const CAPTCHAS: CaptchaProvider[] = ["none", "turnstile", "recaptcha", "hcaptcha"];

export function toBool(v: unknown): boolean | undefined {
	if (v === undefined || v === null || v === "") return undefined;
	if (typeof v === "boolean") return v;
	return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

export function toCount(v: unknown): number | undefined {
	if (v === undefined || v === null || v === "") return undefined;
	const n = Number.parseInt(String(v), 10);
	return Number.isFinite(n) && n > 0 ? n : 0;
}

/** WordPress "2026-10-05" + "09:00" (site time) → ISO; already-ISO values pass through. */
function scheduleMoment(date: unknown, time: unknown): string | undefined {
	if (!date) return undefined;
	const d = String(date).trim();
	if (/T/.test(d)) return d;
	const t = String(time ?? "00:00").trim() || "00:00";
	const iso = `${d}T${t.length === 5 ? `${t}:00` : t}Z`;
	return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}

export function normalizeSettings(raw: Record<string, unknown> | null | undefined): FormSettings {
	const src = raw ?? {};
	const out: FormSettings = {};
	for (const k of BOOL_KEYS) {
		const v = toBool(src[k]);
		if (v !== undefined) out[k] = v;
	}
	for (const k of NUMBER_KEYS) {
		const v = toCount(src[k]);
		if (v !== undefined) out[k] = v;
	}
	for (const k of STRING_KEYS) {
		const v = src[k];
		if (typeof v === "string" && v.trim()) out[k] = v.trim();
	}
	// WordPress schedule fields
	const scheduled = toBool(src.schedule_enabled) !== false;
	if (scheduled && !out.schedule_open) out.schedule_open = scheduleMoment(src.schedule_open_date, src.schedule_open_time);
	if (scheduled && !out.schedule_close) out.schedule_close = scheduleMoment(src.schedule_close_date, src.schedule_close_time);
	if (!out.schedule_open) delete out.schedule_open;
	if (!out.schedule_close) delete out.schedule_close;
	const captcha = String(src.captcha ?? "none") as CaptchaProvider;
	out.captcha = CAPTCHAS.includes(captcha) ? captcha : "none";
	// Forms built before AJAX became a setting submitted natively on WordPress;
	// every EmDash form gets AJAX with a no-JS fallback unless switched off.
	out.ajax_submit = toBool(src.ajax_submit) ?? true;
	out.actions = normalizeActions(src.actions);
	return out;
}

export function normalizeActions(raw: unknown): FormAction[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((a): a is Record<string, unknown> => !!a && typeof a === "object" && typeof (a as { type?: unknown }).type === "string")
		.map((a, i) => {
			const base = { ...a, id: typeof a.id === "string" ? a.id : `action-${i + 1}`, enabled: toBool(a.enabled) ?? true };
			switch (a.type) {
				case "email":
				case "autoresponder":
					return { ...base, content_type: a.content_type === "text/plain" ? "text/plain" : "text/html" } as FormAction;
				case "webhook":
					return { ...base, content_type: a.content_type === "form" ? "form" : "json" } as FormAction;
				default:
					return base as FormAction;
			}
		});
}

export function normalizeMessages(raw: unknown): FormMessages {
	const out: FormMessages = {};
	if (!raw || typeof raw !== "object") return out;
	for (const [k, v] of Object.entries(raw)) {
		if (typeof v === "string" && v.trim()) out[k] = v;
	}
	return out;
}

export function slugify(value: string): string {
	return value
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}

/**
 * Accepts a stored form, an admin save payload, or one record from a Core
 * Forms for WordPress export ({ id, slug, title, status, markup, settings,
 * messages, created, modified }).
 */
export function normalizeForm(raw: Record<string, unknown>, now = new Date().toISOString()): FormDefinition {
	const title = String(raw.title ?? "").trim() || "Untitled form";
	const status: FormStatus = raw.status === "draft" ? "draft" : "publish";
	const wpCreated = typeof raw.created === "string" && raw.created ? `${raw.created.replace(" ", "T")}Z` : undefined;
	const wpModified = typeof raw.modified === "string" && raw.modified ? `${raw.modified.replace(" ", "T")}Z` : undefined;
	return {
		id: String(raw.id ?? "").trim(),
		slug: slugify(String(raw.slug ?? "")) || slugify(title),
		title,
		status,
		markup: String(raw.markup ?? ""),
		settings: normalizeSettings(raw.settings as Record<string, unknown>),
		messages: normalizeMessages(raw.messages),
		createdAt: String(raw.createdAt ?? wpCreated ?? now),
		updatedAt: String(raw.updatedAt ?? wpModified ?? now),
	};
}
