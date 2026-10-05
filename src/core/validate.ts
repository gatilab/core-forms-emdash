import { LIMITS } from "./defaults.js";
import { dataFieldNames, normalizeFieldName, type FieldInfo } from "./markup.js";
import type { FieldValue, FormDefinition, MessageKey } from "./types.js";

export interface RawEntry {
	name: string;
	value: string;
}

export interface CollectedData {
	data: Record<string, FieldValue>;
	/** Every raw key, including `_` control fields, for the pipeline's own reads. */
	control: Record<string, string>;
}

/** Group raw entries into form data: `_` keys are control fields, `name[]` becomes an array. */
export function collect(entries: RawEntry[], fields: FieldInfo[]): CollectedData {
	const allowed = new Set(dataFieldNames(fields));
	const multi = new Set(fields.filter((f) => f.multiple || f.type === "checkbox").map((f) => f.name));
	const data: Record<string, FieldValue> = {};
	const control: Record<string, string> = {};
	for (const { name: rawName, value } of entries) {
		if (rawName.startsWith("_") || rawName === "action") {
			control[rawName] = value;
			continue;
		}
		if (/^(cf-turnstile-response|g-recaptcha-response|h-captcha-response)$/.test(rawName)) {
			control[rawName] = value;
			continue;
		}
		const name = normalizeFieldName(rawName);
		// Only fields the markup declares are kept, so nobody can stuff extra
		// keys into stored submissions, emails, or webhooks.
		if (allowed.size > 0 && !allowed.has(name)) continue;
		const v = value.replace(/\r\n/g, "\n").trim();
		const existing = data[name];
		if (existing === undefined) data[name] = multi.has(name) || rawName.endsWith("[]") ? [v] : v;
		else data[name] = Array.isArray(existing) ? [...existing, v] : [existing, v];
	}
	// drop empty values from multi-value fields (unchecked placeholders)
	for (const [k, v] of Object.entries(data)) if (Array.isArray(v)) data[k] = v.filter((x) => x !== "");
	return { data, control };
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export function isEmail(value: string): boolean {
	return value.length <= 254 && EMAIL_RE.test(value);
}

const list = (csv?: string) =>
	(csv ?? "")
		.split(",")
		.map((s) => normalizeFieldName(s))
		.filter(Boolean);

const isEmpty = (v: FieldValue | undefined) => v === undefined || (Array.isArray(v) ? v.length === 0 : v === "");

export interface ValidationResult {
	error?: MessageKey;
	fields?: string[];
}

/** Size limits, required fields, then email fields, in Core Forms' order. */
export function validate(form: FormDefinition, fields: FieldInfo[], data: Record<string, FieldValue>): ValidationResult {
	const byName = new Map(fields.map((f) => [f.name, f]));

	let total = 0;
	const tooLong: string[] = [];
	const values = Object.entries(data);
	if (values.length > LIMITS.fields) return { error: "too_long" };
	for (const [name, value] of values) {
		const max = byName.get(name)?.maxlength;
		for (const v of Array.isArray(value) ? value : [value]) {
			const bytes = new TextEncoder().encode(v).length;
			total += bytes;
			if (bytes > LIMITS.fieldBytes || (max !== undefined && [...v].length > max)) tooLong.push(name);
		}
	}
	if (total > LIMITS.submissionBytes || tooLong.length) return { error: "too_long", fields: [...new Set(tooLong)] };

	const required = new Set([...list(form.settings.required_fields), ...fields.filter((f) => f.required).map((f) => f.name)]);
	const missing = [...required].filter((name) => isEmpty(data[name]));
	if (missing.length) return { error: "required_field_missing", fields: missing };

	const emailFields = new Set([...list(form.settings.email_fields), ...fields.filter((f) => f.type === "email").map((f) => f.name)]);
	const invalid = [...emailFields].filter((name) => {
		const v = data[name];
		return !isEmpty(v) && !(Array.isArray(v) ? v : [v ?? ""]).every((x) => isEmail(x));
	});
	if (invalid.length) return { error: "invalid_email", fields: invalid };

	return {};
}
