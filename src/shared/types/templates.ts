/**
 * Form templates (spec 01 §3.18; D-068). The 63 WP templates are generated as data by the oracle (P1.16);
 * extensions add more through `CoreFormsExtension.templates`.
 */
import type { WpValue } from "./primitives.js";
import type { FormSchemaJson, StepDef } from "./schema.js";

/** Template categories used by WP 4.11.1 (base + industry). Open for extensions. */
export type TemplateCategory =
	| "starter"
	| "business"
	| "marketing"
	| "events"
	| "nonprofit"
	| "payment"
	| "license"
	| "engagement"
	| "real-estate"
	| "home-services"
	| "construction"
	| "professional-services"
	| "education"
	| "healthcare"
	| "legal"
	| "hospitality"
	| "food-and-events"
	| "automotive"
	| "travel"
	| "fitness"
	| "beauty"
	| "logistics"
	| "technology"
	| (string & {});

/** One template (WP key names). Multistep variants have id "<id>_multistep". */
export interface FormTemplate {
	id: string;
	/** WP calls it `label`, not `title`. */
	label: string;
	description: string;
	/** Dashicon name. */
	icon: string;
	field_count: number;
	category: TemplateCategory;
	markup: string;
	schema?: FormSchemaJson;
	layout?: { type: "single" | "multi-step" | "conversational"; steps?: StepDef[] };
	/** Preset `_cf_settings` (spec 01 §1.3 last paragraph). */
	settings?: Record<string, WpValue>;
	/** `cf_message_*` presets. */
	messages?: Record<string, string>;
	setup_note?: string;
}

/** Catalog entry sent to the admin gallery: everything but the heavy server-only parts. */
export type FormTemplateSummary = Omit<FormTemplate, "markup" | "schema" | "settings" | "messages">;
