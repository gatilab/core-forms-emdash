/**
 * Read the fields a form's HTML declares. Runs in Workers, so no DOM: a small
 * tag scanner that understands the attributes forms care about.
 */

export interface FieldInfo {
	/** Field name with any trailing [] removed. */
	name: string;
	/** input type, or "select" / "textarea" / "button". */
	type: string;
	required: boolean;
	multiple: boolean;
	maxlength?: number;
	/** Text of the associated <label>, when one exists. */
	label?: string;
	/** For selects, radios and checkboxes: the allowed values. */
	options: string[];
}

const TAG_RE = /<(input|select|textarea|button|label|option)\b([^>]*)>|<\/(label|select)>/gi;
const ATTR_RE = /([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export function parseAttributes(source: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	for (const m of source.matchAll(ATTR_RE)) {
		const name = m[1]!.toLowerCase();
		if (!(name in attrs)) attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
	}
	return attrs;
}

function decodeEntities(s: string): string {
	return s
		.replace(/&quot;/g, '"')
		.replace(/&#0?39;|&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

const stripTags = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Strip "[]" and whitespace, as Core Forms does for field names. */
export function normalizeFieldName(name: string): string {
	return name.trim().replace(/\[\]$/, "");
}

/** Every field the markup declares, in document order, merged by name. */
export function parseFields(markup: string): FieldInfo[] {
	const fields = new Map<string, FieldInfo>();
	const labelsByFor = new Map<string, string>();
	const idToName = new Map<string, string>();

	// Labels: <label for="x">Text</label>, and labels that wrap their input.
	for (const m of markup.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)) {
		const attrs = parseAttributes(m[1]!);
		const text = stripTags(m[2]!.replace(/<(select|textarea)\b[\s\S]*?<\/\1>/gi, "")).replace(/\s*\*\s*$/, "").trim();
		if (attrs.for) labelsByFor.set(attrs.for, text);
		const inner = m[2]!.match(/<(?:input|select|textarea)\b([^>]*)>/i);
		if (inner) {
			const name = parseAttributes(inner[1]!).name;
			if (name && text) labelsByFor.set(`#name:${normalizeFieldName(name)}`, text);
		}
	}

	let currentSelect: FieldInfo | null = null;
	for (const m of markup.matchAll(TAG_RE)) {
		if (m[3]) {
			if (m[3].toLowerCase() === "select") currentSelect = null;
			continue;
		}
		const tag = m[1]!.toLowerCase();
		const attrs = parseAttributes(m[2]!);
		if (tag === "option") {
			if (currentSelect) currentSelect.options.push(attrs.value ?? "");
			continue;
		}
		if (tag === "label" || !attrs.name) {
			if (tag === "select") currentSelect = null;
			continue;
		}
		const name = normalizeFieldName(attrs.name);
		if (!name) continue;
		const type = tag === "input" ? (attrs.type || "text").toLowerCase() : tag;
		if (attrs.id) idToName.set(attrs.id, name);
		let field = fields.get(name);
		if (!field) {
			field = { name, type, required: false, multiple: false, options: [] };
			fields.set(name, field);
		}
		if ("required" in attrs) field.required = true;
		if (/\[\]$/.test(attrs.name) || "multiple" in attrs) field.multiple = true;
		if (attrs.maxlength && /^\d+$/.test(attrs.maxlength)) field.maxlength = Number(attrs.maxlength);
		if ((type === "radio" || type === "checkbox") && "value" in attrs) field.options.push(attrs.value!);
		if (tag === "select") currentSelect = field;
		if (attrs.id && labelsByFor.has(attrs.id)) field.label ??= labelsByFor.get(attrs.id);
		field.label ??= labelsByFor.get(`#name:${name}`) || attrs["aria-label"] || attrs.placeholder || undefined;
	}
	return [...fields.values()];
}

const NON_DATA_TYPES = new Set(["submit", "button", "reset", "image"]);

/** Names that may carry submitted data (excludes buttons). */
export function dataFieldNames(fields: FieldInfo[]): string[] {
	return fields.filter((f) => !NON_DATA_TYPES.has(f.type)).map((f) => f.name);
}

export function hasFileInput(markup: string): boolean {
	return /<input\b[^>]*\btype\s*=\s*["']?file\b/i.test(markup);
}

/** Field label for emails and CSV headers: the <label> text, else a humanised name. */
export function fieldLabel(field: FieldInfo | undefined, name: string): string {
	if (field?.label) return field.label;
	return name.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
