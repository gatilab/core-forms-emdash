/**
 * Headless REST (P1.6; spec 01 §5.3; D-059d). Public raw routes; the companion serves the WP-compatible
 * `/wp-json/core-forms/v1/forms/*` paths with CORS and `OPTIONS`.
 */
import type { FieldOption } from "../schema.js";
import type { SubmitResponse } from "../submissions.js";
import { defineRouteSpecs, type QueryInput, type RouteContract } from "./contract.js";

/** WP_Error REST body. */
export interface WpRestError {
	code: string;
	message: string;
	data: { status: number };
}

export interface HeadlessField {
	/** `[]` stripped; `_`-prefixed names excluded. */
	name: string;
	type: string;
	required: boolean;
	/** label || name. */
	label: string;
	options: FieldOption[];
}

/** GET forms/{ref} (live definition). */
export interface HeadlessFormResponse {
	id: number;
	slug: string;
	title: string;
	html: string;
	fields: HeadlessField[];
	/** Effective messages (defaults ⊕ saved). */
	messages: Record<string, string>;
	/** WP: rest_url('core-forms/v1/forms/{ID}/submit'); the companion compat URL when wpCompat, else the plugin route. */
	submit_url: string;
	/** Global reCAPTCHA or Turnstile site key set. */
	requires_captcha: boolean;
}

/**
 * Errors: 404 cf_unknown_form "Form not found." · 403 cf_headless_disabled · (submit) 503 cf_missing_api_key ·
 * 401 cf_invalid_api_key · 500 cf_processor_no_response. A submit with `error: true` answers 422.
 */
export type HeadlessFormOutput = HeadlessFormResponse | WpRestError;
export type HeadlessSubmitOutput = SubmitResponse | WpRestError;

/** `headless/submit` body: JSON or form params (`name[]` keys merged); `_cf_page_url` becomes the referer. Raw bytes. */
export type HeadlessSubmitInput = Uint8Array;

export interface HeadlessApi {
	"headless/form": RouteContract<QueryInput & { ref?: string }, HeadlessFormOutput>;
	"headless/submit": RouteContract<HeadlessSubmitInput, HeadlessSubmitOutput>;
}

export const headlessRoutes = defineRouteSpecs<HeadlessApi>()({
	"headless/form": {
		kind: "public",
		methods: ["GET"],
		body: "none",
		response: "raw",
		phase: 1,
		owner: "P1.6",
		module: "headless",
		summary: "core-forms/v1/forms/{ref}: live form HTML, fields and messages (?ref=<id|slug>).",
		spec: "01 §5.3; D-059d",
	},
	"headless/submit": {
		kind: "public",
		body: "bytes",
		response: "raw",
		maxBytes: 1024 * 1024,
		headers: ["x-core-forms-key", "content-type", "origin"],
		phase: 1,
		owner: "P1.6",
		module: "headless",
		summary: "Headless submit (?ref=, X-Core-Forms-Key): SubmitResponse 200, or 422 on error.",
		spec: "01 §5.3; D-020, D-059d",
		rateLimit: "same as submit",
	},
});
