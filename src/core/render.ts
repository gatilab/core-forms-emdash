/**
 * Server-side form HTML. The wrapper matches Core Forms for WordPress
 * (`.cf-form-{id}`, `_cf_h{id}` honeypot, `.cf-messages`, `.cf-fields-wrap`,
 * data-message-* attributes), so existing CSS and custom JS keep working.
 */
import { DEFAULT_MESSAGES, message } from "./defaults.js";
import { hasFileInput, parseAttributes } from "./markup.js";
import { escapeHtml, fillMarkupTags, type MarkupContext } from "./template.js";
import type { FormDefinition, SubmitResponse } from "./types.js";

export const SUBMIT_PATH = "/_emdash/api/plugins/core-forms/submit";

export interface RenderOptions extends MarkupContext {
	/** Absolute URL of the page the form is on, for the no-JS round trip. */
	sourceUrl?: string;
	/** A reply to show inline (the no-JS Post/Redirect/Get result). */
	response?: SubmitResponse | null;
	/** Site key for the form's CAPTCHA, when one is configured. */
	captchaSiteKey?: string;
	/** Override "now" for schedule checks. */
	now?: Date;
	/** Prefix for generated element ids; must be unique per page. */
	idPrefix?: string;
}

const attr = (v: string | number | boolean) => escapeHtml(String(v));

export function isOpen(form: FormDefinition, now = new Date()): boolean {
	const { schedule_open, schedule_close } = form.settings;
	if (schedule_open && now < new Date(schedule_open)) return false;
	if (schedule_close && now > new Date(schedule_close)) return false;
	return true;
}

/** Give every id/for/aria reference a per-render prefix so two copies of a form can share a page. */
function prefixIds(markup: string, prefix: string): string {
	if (!prefix) return markup;
	return markup.replace(/(?<![\w-])(id|for|aria-labelledby|aria-describedby|aria-controls|list)=(["'])([^"']+)\2/gi, (_m, name: string, q: string, value: string) => {
		const ids = value.split(/\s+/).map((v) => (v ? `${prefix}${v}` : v));
		return `${name}=${q}${ids.join(" ")}${q}`;
	});
}

const NO_AUTOCOMPLETE = new Set(["hidden", "submit", "button", "reset", "image", "checkbox", "radio", "file", "password"]);
const BY_TYPE: Record<string, string> = { email: "email", tel: "tel", url: "url" };
const BY_LAST_WORD: Record<string, string> = {
	email: "email", phone: "tel", tel: "tel", mobile: "tel", whatsapp: "tel",
	website: "url", url: "url", site: "url",
	firstname: "given-name", fname: "given-name", lastname: "family-name", lname: "family-name", surname: "family-name",
	company: "organization", organization: "organization", organisation: "organization",
	address: "street-address", street: "street-address", city: "address-level2", town: "address-level2",
	state: "address-level1", province: "address-level1", zip: "postal-code", zipcode: "postal-code",
	postcode: "postal-code", pincode: "postal-code", postal: "postal-code", country: "country-name",
};

/**
 * Autofill hint for a field, from its type or the last word of its name, so
 * `website_type` gets none while `your_website` gets "url". Core Forms for
 * WordPress adds the same hints with a looser substring match.
 */
export function autocompleteFor(name: string, type = ""): string | undefined {
	if (NO_AUTOCOMPLETE.has(type)) return undefined;
	if (BY_TYPE[type]) return BY_TYPE[type];
	const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
	const last = words.at(-1);
	if (!last) return undefined;
	if (last === "name") {
		const before = words.at(-2);
		if (before === "first" || before === "given") return "given-name";
		if (before === "last" || before === "family") return "family-name";
		if (before === "company" || before === "business" || before === "organization") return "organization";
		return "name";
	}
	return BY_LAST_WORD[last];
}

/**
 * What Core Forms for WordPress does to markup before output: every field
 * gets an id (from its name), a label with no `for` points at the field that
 * follows it, and common fields get autocomplete hints. Author-set values
 * always win.
 */
export function enhanceFields(markup: string): string {
	const used = new Set([...markup.matchAll(/\bid=["']([^"']+)["']/gi)].map((m) => m[1]!));
	let html = markup.replace(/<(input|select|textarea)\b([^>]*?)(\s*\/?)>/gi, (tag, el: string, rest: string, close: string) => {
		const a = parseAttributes(rest);
		const type = el.toLowerCase() === "input" ? (a.type ?? "text").toLowerCase() : el.toLowerCase();
		if (type === "hidden" || type === "submit" || !a.name) return tag;
		let extra = "";
		if (!("id" in a)) {
			const base = a.name.replace(/[^a-z0-9_-]/gi, "_");
			let id = base;
			for (let n = 1; used.has(id); n++) id = `${base}_${n}`;
			used.add(id);
			extra += ` id="${id}"`;
		}
		const hint = "autocomplete" in a ? undefined : autocompleteFor(a.name, type);
		if (hint) extra += ` autocomplete="${hint}"`;
		return extra ? `<${el}${rest}${extra}${close}>` : tag;
	});
	// <label>Text</label> <input id="x"> → <label for="x">; wrapping labels already work
	html = html.replace(/<label\b(?![^>]*\bfor=)([^>]*)>([\s\S]*?)<\/label>/gi, (whole, attrs: string, inner: string, offset: number, all: string) => {
		if (/<(input|select|textarea)\b/i.test(inner)) return whole;
		const after = all.slice(offset + whole.length);
		const next = after.match(/<label\b|<(?:input|select|textarea)\b[^>]*?\bid=["']([^"']+)["']/i);
		return next?.[1] ? `<label for="${next[1]}"${attrs}>${inner}</label>` : whole;
	});
	return html;
}

function captchaWidget(form: FormDefinition, siteKey?: string): string {
	if (!siteKey) return "";
	switch (form.settings.captcha) {
		case "turnstile":
			return `<div class="cf-turnstile cf-captcha" data-sitekey="${attr(siteKey)}"></div>`;
		case "hcaptcha":
			return `<div class="h-captcha cf-captcha" data-sitekey="${attr(siteKey)}"></div>`;
		case "recaptcha":
			return `<input type="hidden" name="g-recaptcha-response" value="" data-recaptcha-sitekey="${attr(siteKey)}">`;
		default:
			return "";
	}
}

export function renderForm(form: FormDefinition, options: RenderOptions = {}): string {
	const s = form.settings;
	const id = form.id;
	const ajax = s.ajax_submit !== false;
	const open = isOpen(form, options.now);

	let fields = fillMarkupTags(form.markup, options);
	fields = enhanceFields(fields);
	fields = prefixIds(fields, options.idPrefix ?? "");
	// RFC 5321 caps addresses at 254 characters; WordPress enforces the same
	fields = fields.replace(/<input\b(?=[^>]*\btype=["']?email\b)(?![^>]*\bmaxlength=)/gi, '<input maxlength="254"');
	if (!/type=["']?submit\b|<button\b(?![^>]*type=["']?(?:button|reset)\b)/i.test(fields)) {
		fields += `\n<p><button type="submit">${escapeHtml(s.submit_button_text || "Submit")}</button></p>`;
	}

	const dataAttrs: Record<string, string | number | boolean> = {
		id,
		title: form.title,
		slug: form.slug,
		ajax: ajax ? 1 : 0,
		"hide-after-success": s.hide_after_success ? 1 : 0,
		"success-scroll": s.success_scroll === false ? 0 : 1,
	};
	if (s.loading_text) dataAttrs["loading-text"] = s.loading_text;
	if (s.captcha && s.captcha !== "none") dataAttrs.captcha = s.captcha;
	for (const key of Object.keys(DEFAULT_MESSAGES) as (keyof typeof DEFAULT_MESSAGES)[]) {
		dataAttrs[`message-${key.replace(/_/g, "-")}`] = message(form.messages, key);
	}

	const classes = [
		"cf-form",
		`cf-form-${id}`,
		...(s.load_form_theme ? ["cf-theme"] : []),
		...(s.form_class ?? "").split(/\s+/).filter((c) => /^[\w-]+$/.test(c)),
	];
	const enctype = hasFileInput(fields) ? ' enctype="multipart/form-data"' : "";
	const novalidate = ajax ? " novalidate" : "";

	let inline = "";
	let hideFields = !open;
	const reply = options.response;
	if (reply?.message?.text) {
		const type = reply.message.type === "error" ? "error" : "success";
		inline = `<p class="cf-message cf-message-${type}" role="${type === "error" ? "alert" : "status"}">${escapeHtml(reply.message.text)}</p>`;
		hideFields ||= type === "success" && !!reply.hide_form;
	} else if (!open) {
		inline = `<p class="cf-message cf-message-error" role="alert">${escapeHtml(message(form.messages, "form_closed"))}</p>`;
	}

	let html = `<form method="post" action="${SUBMIT_PATH}" class="${attr(classes.join(" "))}" ${Object.entries(dataAttrs)
		.map(([k, v]) => `data-${k}="${attr(v)}"`)
		.join(" ")} aria-label="${attr(form.title)}"${novalidate}${enctype}>`;
	html += `<input type="hidden" name="_cf_form_id" value="${attr(id)}">`;
	if (options.sourceUrl) html += `<input type="hidden" name="_cf_source_url" value="${attr(options.sourceUrl)}">`;
	html += `<div style="display:none" aria-hidden="true"><input type="text" name="_cf_h${attr(id)}" value="" tabindex="-1" autocomplete="off"></div>`;
	html += `<div class="cf-messages" role="status" aria-live="polite" aria-atomic="true">${inline}</div>`;
	html += `<div class="cf-fields-wrap"${hideFields ? " hidden" : ""}>${fields}${captchaWidget(form, options.captchaSiteKey)}</div>`;
	html += "</form>";

	if (s.custom_css) {
		const css = s.custom_css
			.replace(/<\/?style[^>]*>/gi, "")
			.replace(/expression\s*\(|javascript\s*:|@import|behavior\s*:/gi, "/* blocked */")
			.replace(/</g, "");
		html += `<style>.cf-form-${attr(id)} { ${css} }</style>`;
	}
	if (s.custom_js) {
		const js = s.custom_js.replace(/<\/script/gi, "<\\/script");
		html += `<script>(function(){var form=document.querySelector(".cf-form-${attr(id)}");if(form){${js}}})()</script>`;
	}
	return html;
}
