/**
 * Forms (architecture §5.2). Normative: field names, unions and optionality are binding.
 * Behaviour: spec 01 §1 (data model), §3.2 (resolution), §3.16 (definitions and revisions).
 */
import type { ActionConfig } from "./actions.js";
import type { IsoDateTime, NumericId, SealedSecret, TriState, WpDateTime, WpValue } from "./primitives.js";
import type { FormSchemaJson } from "./schema.js";

export type FormStatus = "publish" | "draft" | "pending" | "private";

/**
 * Raw `_cf_settings`, stored verbatim (keys, value types, unknown keys). Defaults are merged at read time
 * (`FormSettingsView`). Secret leaves inside `actions[i]` are SealedSecret (D-030). Spec 01 §1.3 lists every
 * known key.
 */
export interface WpFormSettings {
	actions?: ActionConfig[];
	[key: string]: WpValue | ActionConfig[] | SealedSecret | undefined;
}

/**
 * `FormDefinition::snapshot()` (spec 01 §3.16). `meta` holds `_cf_settings`, `_cf_form_schema`, `_cf_headless`,
 * `_cf_hidden_columns` and every `cf_message_*` key, ksorted.
 */
export interface DefinitionSnapshot {
	title: string;
	slug: string;
	status: FormStatus;
	markup: string;
	meta: Record<string, WpValue>;
}

/** Legacy WordPress post fields kept for round-trip exports. */
export interface FormWpFields {
	postAuthor?: number;
	postDate?: WpDateTime;
	postDateGmt?: WpDateTime;
	postExcerpt?: string;
	menuOrder?: number;
}

/** Stored form (`forms` collection, architecture §6.2). */
export interface FormRecord {
	id: NumericId;
	/** Number(id), for numeric ordering. */
	n: number;
	slug: string;
	title: string;
	status: FormStatus;
	/** post_content, without <form>. */
	markup: string;
	/** `_cf_settings`. */
	settings: WpFormSettings;
	/** `cf_message_{key}` overrides only. */
	messages: Record<string, string>;
	/** `_cf_form_schema`. */
	schema: FormSchemaJson | null;
	/** `_cf_live_definition`; draft publishing is on when non-null. */
	live: DefinitionSnapshot | null;
	/**
	 * Every other post meta key, verbatim: `_cf_hidden_columns`, `_cf_headless`, `_cf_a11y_report`,
	 * `_cf_*_source_id` provenance, `_cf_license_*` links, unknown keys.
	 */
	meta: Record<string, WpValue>;
	/** EmDash user id. */
	authorId: string | null;
	wp?: FormWpFields;
	createdAt: IsoDateTime;
	updatedAt: IsoDateTime;
	trashedAt: IsoDateTime | null;
	/** +1 on every definition write; the CAS guard (D-062). */
	version: number;
	// Denormalized for indexed lookups:
	/** `live.slug` when `live` is set. */
	liveSlug: string | null;
	/** sanitize_title(standalone_slug) || sanitize_title(slug). */
	publicSlug: string;
	/** phpTruthy(settings.standalone_enabled). */
	standalone: boolean;
	/** phpTruthy(settings.headless_enabled). */
	headless: boolean;
}

/** Typed, read-only view over effective settings = { ...defaults(registry), ...stored } (PHP array_merge). */
export interface FormSettingsView {
	readonly raw: Readonly<Record<string, WpValue>>;
	has(key: string): boolean;
	get(key: string): WpValue | undefined;
	/** PHP truthiness. */
	flag(key: string): boolean;
	/** (int) cast semantics. */
	int(key: string, fallback?: number): number;
	str(key: string): string;
	tri(key: "load_stylesheet" | "load_form_theme" | "analytics_enabled"): TriState;
	/** Comma list, trimmed, `[]` suffix stripped. */
	list(key: "required_fields" | "email_fields"): string[];
	/** `schedule_days`. */
	days(): string[];
	/** Never undefined. */
	actions(): ActionConfig[];
}

/** Which stored definition a resolution used. Public paths always use "live" (D-061). */
export type FormSource = "live" | "draft" | "revision";

/** What render and submit consume. */
export interface ResolvedForm {
	id: NumericId;
	slug: string;
	title: string;
	status: FormStatus;
	markup: string;
	settings: FormSettingsView;
	/** defaults ⊕ overrides (spec 01 §1.4). */
	messages: Record<string, string>;
	schema: FormSchemaJson | null;
	source: FormSource;
	version: number;
	/** Opaque concurrency token "v<version>.<hash>" (D-062). */
	fingerprint: string;
}

/** How callers identify a form: `[cf_form id|slug]`, PT block attributes, `?ref=`. */
export type FormRef = { id: NumericId; slug?: undefined } | { slug: string; id?: undefined };
