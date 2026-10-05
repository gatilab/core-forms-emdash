/**
 * Data model. Setting, action and message keys deliberately match Core Forms
 * for WordPress, so a WordPress export imports without translation. Values are
 * normalised: booleans are booleans and numbers are numbers, where WordPress
 * stored "1" / "0" / "" strings.
 */

export type FormStatus = "publish" | "draft";

export interface FormDefinition {
	/** Stable id. Forms imported from WordPress keep their post id ("1050302"). */
	id: string;
	slug: string;
	title: string;
	status: FormStatus;
	/** The form's fields, as HTML. Rendered inside the plugin's <form> wrapper. */
	markup: string;
	settings: FormSettings;
	messages: FormMessages;
	createdAt: string;
	updatedAt: string;
}

export type CaptchaProvider = "none" | "turnstile" | "recaptcha" | "hcaptcha";

export interface FormSettings {
	/** Comma-separated field names that must be filled, in addition to `required` attributes in the markup. */
	required_fields?: string;
	/** Comma-separated field names that must hold a valid email address (plus every type="email" input). */
	email_fields?: string;
	save_submissions?: boolean;
	hide_after_success?: boolean;
	/** Send visitors here after a successful submission. Same-site paths only. */
	redirect_url?: string;
	enable_honeypot?: boolean;
	/** Submissions allowed per IP address per hour. 0 = unlimited. */
	rate_limit?: number;
	/** Reject an identical submission from the same IP within 10 minutes. */
	prevent_duplicates?: boolean;
	/** Total submissions accepted. 0 = unlimited. */
	submission_limit?: number;
	/** Accept submissions only between these moments (ISO 8601). */
	schedule_open?: string;
	schedule_close?: string;
	captcha?: CaptchaProvider;
	/** Submit with fetch() and show the reply inline. When false, the form posts natively (Post/Redirect/Get). */
	ajax_submit?: boolean;
	submit_button_text?: string;
	loading_text?: string;
	/** Scroll the success message into view. */
	success_scroll?: boolean;
	load_form_theme?: boolean;
	form_class?: string;
	/** Scoped to `.cf-form-{id}`. */
	custom_css?: string;
	/** Runs with `form` bound to the form element. Admin-authored, trusted. */
	custom_js?: string;
	actions?: FormAction[];
}

export type FormAction = EmailAction | AutoresponderAction | WebhookAction | UnsupportedAction;

interface ActionBase {
	/** Optional stable id for editing in the admin. */
	id?: string;
	enabled?: boolean;
}

/** Notification to the site owner. `to`, `subject` and `message` accept [field] tokens. */
export interface EmailAction extends ActionBase {
	type: "email";
	to: string;
	from?: string;
	subject: string;
	message: string;
	content_type?: "text/html" | "text/plain";
	/** Extra headers, one "Name: value" per line. Only Reply-To, Cc and Bcc are honoured. */
	headers?: string;
}

/** Confirmation email to the person who submitted. */
export interface AutoresponderAction extends ActionBase {
	type: "autoresponder";
	/** The field that holds the visitor's address. */
	email_field: string;
	from_name?: string;
	from_email?: string;
	reply_to?: string;
	subject: string;
	message: string;
	content_type?: "text/html" | "text/plain";
}

export interface WebhookAction extends ActionBase {
	type: "webhook";
	url: string;
	content_type?: "json" | "form";
}

/** Kept from imports (e.g. `create_comment`) so nothing is lost; not run. */
export interface UnsupportedAction extends ActionBase {
	type: string;
	[key: string]: unknown;
}

export type MessageKey =
	| "success"
	| "invalid_email"
	| "required_field_missing"
	| "error"
	| "spam"
	| "file_too_large"
	| "file_upload_error"
	| "submission_limit_reached"
	| "form_closed"
	| "rate_limited"
	| "too_long";

export type FormMessages = Partial<Record<MessageKey | (string & {}), string>>;

export type SubmissionStatus = "new" | "read" | "spam" | "trash";

export type FieldValue = string | string[];

export interface Submission {
	id: string;
	formId: string;
	data: Record<string, FieldValue>;
	status: SubmissionStatus;
	submittedAt: string;
	ip?: string | null;
	userAgent?: string | null;
	refererUrl?: string | null;
	country?: string | null;
}

/** JSON reply to an AJAX submission (same shape as Core Forms for WordPress). */
export interface SubmitResponse {
	error?: boolean;
	message: { type: "success" | "error"; text: string };
	hide_form?: boolean;
	redirect_url?: string;
	/** Field names that failed validation, for highlighting. */
	fields?: string[];
}

/** Summary row for the admin forms list. */
export interface FormSummary {
	id: string;
	slug: string;
	title: string;
	status: FormStatus;
	updatedAt: string;
	submissions: number;
	unread: number;
}

/** Plugin settings (admin → Core Forms → Settings). */
export interface GlobalSettings {
	turnstileSiteKey?: string;
	turnstileSecretKey?: string;
	recaptchaSiteKey?: string;
	recaptchaSecretKey?: string;
	hcaptchaSiteKey?: string;
	hcaptchaSecretKey?: string;
	/** Default From address for notifications. */
	defaultFrom?: string;
	/** Store the submitter's IP address with each submission. Default true. */
	storeIp?: boolean;
}
