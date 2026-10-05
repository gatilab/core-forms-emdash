/**
 * Extension points (architecture §15; D-107). Exported to sites as `@gatilab/emdash-core-forms/extend`
 * (src/server/extensions/public.ts). Internal modules register through the same registry, which is how validator
 * priorities and the markup filter order are kept.
 */
import type { ActionConfig, ActionModule } from "./actions.js";
import type { GatewayId, ProductRecord } from "./commerce.js";
import type { ResolvedForm } from "./forms.js";
import type { MailMessage } from "./mail.js";
import type { CfContext, CoreFormsEvents } from "./ports.js";
import type { WpValue } from "./primitives.js";
import type { AssetManifest } from "./render.js";
import type { FormEntry, RequestMeta } from "./request.js";
import type { CustomFieldType, FormSchemaJson } from "./schema.js";
import type { EphemeralSubmission, SubmissionData, SubmissionRecord } from "./submissions.js";
import type { FormTemplate } from "./templates.js";

/** What a `cf_validate_form` validator sees (architecture §9.2 step 14). */
export interface ValidateContext {
	form: ResolvedForm;
	/** Collected, allow-listed data (WP $_POST semantics). */
	data: SubmissionData;
	/** Raw posted entries: CAPTCHA tokens, honeypot, math answer, file parts. */
	entries: readonly FormEntry[];
	request: RequestMeta;
	/**
	 * Error code produced by earlier validators ("" = valid so far). WP passes the incoming error through: a
	 * validator that receives a non-empty error must return it unchanged.
	 */
	error: string;
	/** Rehearsal (`forms/rehearsal`): no external calls, no single-use token consumption. */
	rehearsal: boolean;
	cx: CfContext;
}

export interface FormValidator {
	/** WP priorities: 5 schedule · 10 reCAPTCHA · 10 Turnstile · 10 hCaptcha · 10 files · 15 math · 20 Akismet. */
	priority: number;
	name: string;
	/** Returns the error code, or "" when valid. */
	validate(c: ValidateContext): Promise<string>;
}

export type CoreFormsEventListener<E extends keyof CoreFormsEvents> = (
	payload: CoreFormsEvents[E],
	cx: CfContext,
) => void | Promise<void>;

/** The curated filter set (WP filter names in comments). Filters run synchronously in the render/submit path. */
export interface CoreFormsFilters {
	/** cf_form_redirect_url */
	redirectUrl(
		url: string,
		c: { form: ResolvedForm; data: SubmissionData; submission: SubmissionRecord | EphemeralSubmission },
	): string;
	/** cf_allowed_field_names */
	allowedFieldNames(names: string[], c: { form: ResolvedForm; data: SubmissionData }): string[];
	/** cf_ignored_field_names */
	ignoredFieldNames(names: string[]): string[];
	/** cf_form_markup (priority via markupFilters) */
	formMarkup(html: string, form: ResolvedForm): string;
	/** cf_schema_markup */
	schemaMarkup(html: string, schema: FormSchemaJson, form: ResolvedForm): string;
	/** cf_form_html */
	formHtml(html: string, form: ResolvedForm): string;
	/** cf_form_element_data_attributes */
	formDataAttributes(attrs: [string, string][], form: ResolvedForm): [string, string][];
	/** cf_form_element_class_attr */
	formClass(cls: string, form: ResolvedForm): string;
	/** cf_form_asset_requirements */
	assetRequirements(m: AssetManifest, form: ResolvedForm): AssetManifest;
	/** cf_template_tags */
	templateTags(
		tags: Record<string, string | ((param: string) => string)>,
	): Record<string, string | ((param: string) => string)>;
	/** cf_form_field_length_limits */
	fieldLengthLimits(l: Record<string, number>, form: ResolvedForm): Record<string, number>;
	/** cf_max_submission_bytes */
	maxSubmissionBytes(n: number, form: ResolvedForm): number;
	/** cf_submit_rate_limit */
	submitRateLimit(n: number, form: ResolvedForm): number;
	/** cf_duplicate_window_seconds */
	duplicateWindowSeconds(n: number, form: ResolvedForm): number;
	/** cf_webhook_request_args */
	webhookRequest(
		init: { url: string; headers: Record<string, string>; body: string },
		c: { action: ActionConfig; form: ResolvedForm },
	): { url: string; headers: Record<string, string>; body: string };
	/** cf_action_email_* (combined) */
	emailMessage(m: MailMessage, c: { action: ActionConfig; form: ResolvedForm }): MailMessage;
	/** cf_should_track_analytics (consent) */
	shouldTrackAnalytics(enabled: boolean, form: ResolvedForm): boolean;
	/** cf_upload_max_filesize */
	uploadMaxFilesize(bytes: number): number;
	/** cf_akismet_data */
	akismetData(d: Record<string, string>): Record<string, string>;
	/** cf_payment_gateways_for_currency */
	gatewaysForCurrency(ids: GatewayId[], currency: string): GatewayId[];
	/** cf_storefront_product */
	storefrontProduct(p: WpValue, product: ProductRecord): WpValue;
}

export type CoreFormsFilterName = keyof CoreFormsFilters;

export interface CoreFormsExtension {
	/** Registration is idempotent by name. */
	name: string;
	/** cf_register_field_type */
	fieldTypes?: CustomFieldType[];
	/** cf_process_form_action_{type} */
	actions?: ActionModule[];
	/** cf_validate_form */
	validators?: FormValidator[];
	/** cf_form_templates */
	templates?: FormTemplate[];
	on?: { [E in keyof CoreFormsEvents]?: CoreFormsEventListener<E> };
	filters?: Partial<CoreFormsFilters>;
}
