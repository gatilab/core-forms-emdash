/**
 * Form authoring routes (P1.7, using P1.5/P1.6/P1.16/P1.18 through interfaces; spec 01 §3.16–3.18,
 * spec 04 §1.3; D-061–D-069b).
 */
import type { A11yReport } from "../a11y.js";
import type { DefinitionSnapshot, FormStatus, WpFormSettings } from "../forms.js";
import type { IsoDateTime, NumericId, WpValue } from "../primitives.js";
import type { FormRevisionRecord } from "../records.js";
import type { AssetUrls } from "../render.js";
import type { FormSchemaJson } from "../schema.js";
import type { FormTemplate, FormTemplateSummary } from "../templates.js";
import { defineRouteSpecs, type RouteContract } from "./contract.js";

/** Editor tabs (spec 04 §1.3.3). Later phases add theirs through `registerEditorTab`. */
export type EditorTab = "fields" | "messages" | "settings" | "actions" | "payment" | "headless" | "submissions" | "analytics" | "revisions";

/** The draft definition as the admin edits it. Secret leaves are SECRET_MASK (architecture §7.1). */
export interface FormDTO {
	id: NumericId;
	slug: string;
	title: string;
	status: FormStatus;
	markup: string;
	/** Raw `_cf_settings` with secrets masked; unknown keys preserved. */
	settings: WpFormSettings;
	/** `cf_message_*` overrides only. */
	messages: Record<string, string>;
	schema: FormSchemaJson | null;
	/** Other meta (`_cf_hidden_columns`, `_cf_headless`, provenance, unknown keys). */
	meta: Record<string, WpValue>;
	a11y: A11yReport | null;
	publishing: {
		/** Draft publishing is on (a live snapshot exists). */
		enabled: boolean;
		liveSlug: string | null;
		/** The draft differs from the live snapshot. */
		dirty: boolean;
	};
	publicSlug: string;
	standalone: boolean;
	headless: boolean;
	/** `[cf_form slug="…"]`. */
	shortcode: string;
	/** `<site>/<standaloneBase>/<publicSlug>/` when standalone, else null. */
	standaloneUrl: string | null;
	fingerprint: string;
	version: number;
	authorId: string | null;
	createdAt: IsoDateTime;
	updatedAt: IsoDateTime;
	trashedAt: IsoDateTime | null;
}

/** Defaults the editor needs (the admin cannot import core/settings). */
export interface FormDefaults {
	/** Core defaults ⊕ module defaults (spec 01 §1.3). */
	settings: Record<string, WpValue>;
	/** Default message texts (spec 01 §1.4). */
	messages: Record<string, string>;
}

export interface FormListItem {
	id: NumericId;
	title: string;
	slug: string;
	status: FormStatus;
	/** "" in Trash. */
	shortcode: string;
	/** All rows for the form, spam included. */
	submissions: number;
	/** Submissions with status "new" (the "N New" pill). */
	unseen: number;
	/** null in Trash. */
	a11y: A11yReport | null;
	standalone: boolean;
	updatedAt: IsoDateTime;
	trashedAt: IsoDateTime | null;
}

export interface FormsListInput {
	view: "all" | "trash";
	search?: string;
	orderby?: "title" | "submissions" | "accessibility" | "date" | "id";
	order?: "asc" | "desc";
	/** 1-based; 50 per page. */
	page?: number;
}

export interface FormsListOutput {
	items: FormListItem[];
	total: number;
	counts: { all: number; trash: number };
	/** Stats strip (spec 04 §1.3.1); not team-scoped. */
	stats: { activeForms: number; totalSubmissions: number; submissionsToday: number; caughtAsSpam: number };
}

export interface FormsCreateInput {
	title?: string;
	slug?: string;
	templateId?: string;
	duplicateOf?: NumericId;
	markup?: string;
	schema?: FormSchemaJson | null;
	settings?: WpFormSettings;
	messages?: Record<string, string>;
}

export interface FormsUpdateInput {
	id: NumericId;
	/** Required: 409 cf_version_required when missing, cf_edit_conflict when stale (D-062). */
	fingerprint: string;
	title?: string;
	slug?: string;
	status?: FormStatus;
	markup?: string;
	/** The complete settings object (WP replaces `actions` wholesale; sentinel secrets keep their stored value). */
	settings?: WpFormSettings;
	/** The complete `cf_message_*` override set; keys not present are removed. */
	messages?: Record<string, string>;
}

export interface BulkIdsOutput {
	done: NumericId[];
	refused: { id: NumericId; reason: string }[];
}

export interface RevisionListItem {
	id: string;
	kind: FormRevisionRecord["kind"];
	authorId: string | null;
	/** Display name, or "Unknown". */
	authorName: string;
	createdAt: IsoDateTime;
	title: string;
	titleChanged: boolean;
	/** Characters added (+) or removed (-) in the markup versus the previous revision. */
	markupDelta: number;
}

/** WP rehearsal shape (spec 03 §7, spec 01 §3.17). */
export interface RehearsalOutput {
	availability: "" | "form_closed" | "require_user_logged_in" | "submission_limit_reached";
	valid: boolean;
	/** "" when valid; includes calculation_failed, payment_amount_invalid. */
	error: string;
	data: Record<string, WpValue>;
	actions: {
		index: number;
		type: string;
		outcome: "would_run" | "would_skip";
		handler_available: boolean;
		destination: Partial<
			Record<"to" | "email" | "recipient" | "recipients" | "url" | "webhook_url" | "chat_id" | "list_id" | "database_id" | "board_id", string>
		>;
	}[];
	payment: null | { provider: string; configured: boolean; amount_minor: number | null; currency: string };
	notice: string;
}

export interface FormUsageItem {
	kind: "form" | "poll" | "commerce";
	collection: string;
	entryId: string;
	title: string;
	path: string;
	status: string;
	updatedAt: IsoDateTime;
}

export interface FormsApi {
	"forms/list": RouteContract<FormsListInput, FormsListOutput>;
	"forms/get": RouteContract<{ id: NumericId }, { form: FormDTO; defaults: FormDefaults }>;
	"forms/create": RouteContract<FormsCreateInput, { form: FormDTO }>;
	"forms/update": RouteContract<FormsUpdateInput, { form: FormDTO; fingerprint: string }>;
	/** Builder save: re-renders the markup server-side (`cf-field-` ids) and re-runs the a11y audit (D-065). */
	"forms/editor-state": RouteContract<
		{ id: NumericId; fingerprint: string; markup: string; schema: FormSchemaJson | null; templateId?: string },
		{ saved: boolean; form: FormDTO; schema: FormSchemaJson | null; fingerprint: string }
	>;
	"forms/schema/generate": RouteContract<
		{ id: NumericId; fingerprint: string; save?: boolean },
		{ saved: boolean; schema: FormSchemaJson | null; fingerprint: string }
	>;
	"forms/trash": RouteContract<{ ids: NumericId[] }, BulkIdsOutput>;
	"forms/restore": RouteContract<{ ids: NumericId[] }, BulkIdsOutput>;
	/** Permanent; submissions are kept (WP). */
	"forms/delete": RouteContract<{ ids: NumericId[] }, BulkIdsOutput>;
	/** WP list-table duplicate: same title, publish, all meta but the a11y report. */
	"forms/duplicate": RouteContract<{ id: NumericId }, { form: FormDTO }>;
	/** 409 cf_slug_conflict; 400 cf_no_published_definition / cf_invalid_publish_action. */
	"forms/publishing": RouteContract<
		{ id: NumericId; action: "start" | "publish" | "discard"; fingerprint: string },
		{ fingerprint: string }
	>;
	"forms/revisions/list": RouteContract<
		{ id: NumericId; cursor?: string },
		{ items: RevisionListItem[]; current: { updatedAt: IsoDateTime; title: string }; nextCursor?: string }
	>;
	"forms/revisions/get": RouteContract<
		{ id: NumericId; revisionId: string },
		{ revision: { id: string; kind: FormRevisionRecord["kind"]; authorId: string | null; createdAt: IsoDateTime; snapshot: DefinitionSnapshot } }
	>;
	/** 404 cf_revision_missing. Restore deletes absent cf_message_* keys (spec 01 §3.16). */
	"forms/revisions/restore": RouteContract<
		{ id: NumericId; revisionId: string; fingerprint: string },
		{ restored: true; fingerprint: string; form: FormDTO }
	>;
	/** Previews the unsaved draft (DV-59). */
	"forms/preview": RouteContract<
		{ id?: NumericId; draft?: Partial<Pick<FormDTO, "title" | "slug" | "markup" | "settings" | "messages" | "schema">>; revisionId?: string },
		{ html: string; assets: AssetUrls }
	>;
	"forms/rehearsal": RouteContract<{ id: NumericId; data: Record<string, WpValue>; revisionId?: string }, RehearsalOutput>;
	/** PT block `optionsRoute` (the editor's form picker). */
	"forms/options": RouteContract<Record<string, never>, { items: { id: string; name: string }[] }>;
	"forms/usage": RouteContract<{ id: NumericId }, { items: FormUsageItem[] }>;
	"forms/a11y/audit": RouteContract<{ id: NumericId }, { report: A11yReport }>;
	"forms/a11y/fix": RouteContract<
		{ id: NumericId; fingerprint: string },
		{ report: A11yReport; fixed: number; saved: boolean; fingerprint: string }
	>;
	/** rename/delete run as `column-rewrite` jobs (DV-28, DV-71). */
	"forms/columns": RouteContract<
		{ id: NumericId; op: "hide" | "show" | "show_all" | "rename" | "delete"; column: string; newName?: string },
		{ jobId?: string; hiddenColumns: string[] }
	>;
	/** `{}` → catalog summaries; `{id}` → one full template (markup, schema, settings, messages). */
	"forms/templates": RouteContract<{ id?: string }, { items: FormTemplateSummary[]; template?: FormTemplate }>;
}

const FORMS = { phase: 1, owner: "P1.7", module: "forms", kind: "workspace" } as const;

export const formsRoutes = defineRouteSpecs<FormsApi>()({
	"forms/list": {
		...FORMS,
		scope: { by: "none", reason: "filtered to the user's form scope" },
		summary: "Forms list: views, search, sort, counts and the stats strip.",
		spec: "04 §1.3.1",
		mcp: { tool: "forms_list", description: "List Core Forms forms with submission counts.", destructive: false },
	},
	"forms/get": { ...FORMS, scope: { by: "id" }, summary: "Draft definition for the editor (secrets masked) and defaults.", spec: "01 §3.16; 04 §1.3.3" },
	"forms/create": {
		...FORMS,
		scope: { by: "none", reason: "creating requires access to all forms (unscoped grant) or admin" },
		summary: "Create from blank, a template or a duplicate.",
		spec: "04 §1.3.2; 01 §3.18",
	},
	"forms/update": { ...FORMS, scope: { by: "id" }, secretWrite: true, summary: "Fingerprint-guarded save.", spec: "01 §3.16; D-062" },
	"forms/editor-state": { ...FORMS, scope: { by: "id" }, summary: "Builder save: server re-render and a11y audit.", spec: "02 §5; D-065" },
	"forms/schema/generate": { ...FORMS, scope: { by: "id" }, summary: "MarkupParser → schema (optionally saved).", spec: "01 §2.7" },
	"forms/trash": { ...FORMS, scope: { by: "ids" }, summary: "Move forms to the trash.", spec: "04 §1.3.1; D-063" },
	"forms/restore": { ...FORMS, scope: { by: "ids" }, summary: "Restore forms from the trash.", spec: "04 §1.3.1; D-063" },
	"forms/delete": { ...FORMS, scope: { by: "ids" }, summary: "Delete forms permanently (submissions kept).", spec: "04 §1.3.1; D-063" },
	"forms/duplicate": { ...FORMS, scope: { by: "id" }, summary: "Duplicate a form (list-table action).", spec: "04 §1.3.1" },
	"forms/publishing": { ...FORMS, scope: { by: "id" }, summary: "Draft publishing: start, publish, discard.", spec: "01 §3.16" },
	"forms/revisions/list": { ...FORMS, scope: { by: "id" }, summary: "Revision history (50 kept).", spec: "01 §3.16" },
	"forms/revisions/get": { ...FORMS, scope: { by: "id" }, summary: "One revision snapshot.", spec: "01 §3.16" },
	"forms/revisions/restore": { ...FORMS, scope: { by: "id" }, summary: "Restore a revision.", spec: "01 §3.16" },
	"forms/preview": { ...FORMS, scope: { by: "id" }, summary: "Render an unsaved draft with its asset URLs.", spec: "DV-59" },
	"forms/rehearsal": { ...FORMS, scope: { by: "id" }, summary: "Dry-run the pipeline and action plan.", spec: "03 §7; 01 §3.17" },
	"forms/options": {
		...FORMS,
		scope: { by: "none", reason: "filtered to the user's form scope" },
		summary: "Form picker options for the core-form block.",
		spec: "architecture §14",
	},
	"forms/usage": { ...FORMS, scope: { by: "id" }, summary: "Where a form is embedded (usage index).", spec: "DV-52" },
	"forms/a11y/audit": { ...FORMS, scope: { by: "id" }, summary: "Run the accessibility audit.", spec: "02 §5.6; D-069b" },
	"forms/a11y/fix": { ...FORMS, scope: { by: "id" }, summary: "Apply safe accessibility fixes and save.", spec: "02 §5.6; D-069b" },
	"forms/columns": { ...FORMS, scope: { by: "id" }, summary: "Hide, show, rename or delete a data column.", spec: "04 §2.4; DV-28, DV-71" },
	"forms/templates": {
		...FORMS,
		scope: { by: "none", reason: "template data is not form data" },
		summary: "Template catalog, or one full template.",
		spec: "01 §3.18; D-068",
	},
});
