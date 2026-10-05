import type { FormMessages, FormSettings, MessageKey } from "./types.js";

/** Core Forms' default messages. */
export const DEFAULT_MESSAGES: Record<MessageKey, string> = {
	success: "Thank you! We will be in touch soon.",
	invalid_email: "Sorry, that email address looks invalid.",
	required_field_missing: "Please fill in the required fields.",
	error: "Oops. An error occurred.",
	spam: "Your submission was flagged as spam.",
	file_too_large: "Uploaded file is too large.",
	file_upload_error: "An upload error occurred. Please try again later.",
	submission_limit_reached: "The submission limit for this form has been reached.",
	form_closed: "This form is not accepting submissions right now.",
	rate_limited: "Too many submissions. Please try again in a moment.",
	too_long: "One of your answers is too long.",
};

export const DEFAULT_SETTINGS: Required<
	Pick<
		FormSettings,
		| "save_submissions"
		| "hide_after_success"
		| "enable_honeypot"
		| "rate_limit"
		| "prevent_duplicates"
		| "submission_limit"
		| "captcha"
		| "ajax_submit"
		| "load_form_theme"
	>
> = {
	save_submissions: true,
	hide_after_success: false,
	enable_honeypot: true,
	rate_limit: 0,
	prevent_duplicates: false,
	submission_limit: 0,
	captcha: "none",
	ajax_submit: true,
	load_form_theme: false,
};

export function message(messages: FormMessages | undefined, key: MessageKey): string {
	return messages?.[key]?.trim() || DEFAULT_MESSAGES[key];
}

/** Per-field and whole-submission size limits, against oversized payloads. */
export const LIMITS = {
	fieldBytes: 20_000,
	submissionBytes: 200_000,
	fields: 200,
} as const;
