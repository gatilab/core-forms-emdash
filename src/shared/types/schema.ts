/**
 * Form schema (`_cf_form_schema`, spec 01 §2; architecture §5.2). Normative.
 */
import type { WpScalar, WpValue } from "./primitives.js";
import type { SubmissionData, SubmissionValue } from "./submissions.js";

export interface FormSchemaJson {
	version: 1;
	/** ORDER MATTERS for rendering. */
	fields: FieldDef[];
	layout: { type: "single" | "multi-step" | "conversational"; steps?: StepDef[] };
	form_settings?: Record<string, WpValue>;
}

export type StepDef = { id: string; label?: string; title?: string };

export type NativeInputType =
	| "text"
	| "email"
	| "url"
	| "tel"
	| "number"
	| "date"
	| "time"
	| "datetime-local"
	| "password"
	| "color"
	| "range"
	| "hidden"
	| "file"
	| "search"
	| "month"
	| "week";

export type BuiltinFieldType =
	| NativeInputType
	| "textarea"
	| "select"
	| "radio"
	| "checkbox"
	| "name"
	| "address"
	| "consent"
	| "rating"
	| "container"
	| "fieldset"
	| "heading"
	| "paragraph"
	| "divider"
	| "html"
	| "submit"
	| "button"
	| "reset";

export type FieldValidationKey = "min" | "max" | "minlength" | "maxlength" | "pattern" | "step";

export interface FieldDef {
	name: string;
	/** Custom types are registered through extensions (`CustomFieldType`). */
	type: BuiltinFieldType | (string & {});
	label: string;
	placeholder: string;
	required: boolean;
	position: number;
	default_value?: string;
	default_values?: string[];
	checked?: true;
	css_class?: string;
	description?: string;
	options?: FieldOption[];
	validation?: Partial<Record<FieldValidationKey, string | number>>;
	conditions?: FieldCondition[];
	wrapper_attributes?: Record<string, WpScalar>;
	/**
	 * Includes parent, cols_*, gap (duplicated at top level), calculation | data-calculation, data-counter,
	 * data-resize, level, id, and allow-listed HTML attributes.
	 */
	attributes?: Record<string, WpScalar>;
	group?: string;
	parent?: string | null;
	cols_desktop?: number | string;
	cols_tablet?: number | string;
	cols_mobile?: number | string;
	gap?: string;
	/** Unknown keys are preserved. */
	[key: string]: WpValue | FieldOption[] | FieldCondition[] | undefined;
}

export type FieldOption = {
	value: string;
	label: string;
	disabled?: boolean;
	group?: string;
	id?: string;
	css_class?: string;
	attributes?: Record<string, WpScalar>;
};

/** Client and server rule grammar (spec 03 §1.1): name ( (":"|"=") v1 ("|" v2)* )?, where "*" means non-empty. */
export type FieldCondition = { action: "show" | "hide"; rule: string };

/** `cf_register_field_type` (spec 01 §2.12 / §6). Registered through `CoreFormsExtension.fieldTypes`. */
export interface CustomFieldType {
	/** /^[a-z][a-z0-9_-]{2,60}$/, not built-in. */
	type: string;
	label: string;
	description?: string;
	nativeType: "text" | "email" | "url" | "tel" | "number" | "date" | "textarea" | "select";
	defaults?: Partial<FieldDef>;
	/** Output is KSES-sanitized. */
	render(field: FieldDef, id: string): string;
	/** Return an error message, `true`/"" for valid (WP semantics). */
	validate(value: SubmissionValue | undefined, field: FieldDef, data: SubmissionData): string | true | "";
	/** Asset URL emitted when the type renders. */
	script?: string;
}
