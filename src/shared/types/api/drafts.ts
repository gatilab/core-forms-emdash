/**
 * Save & resume (P1.8; spec 03 §1.3; DV-19, DV-20). Public raw routes answering WP's `wp_send_json_*` envelopes.
 */
import { defineRouteSpecs, type FormDataBody, type RouteContract } from "./contract.js";

/** `{success: false, data: {message}}` with WP status codes (403, 400, 404, 429, 413, 500). */
export interface DraftError {
	success: false;
	data: { message: string };
}

/** drafts/save fields: `_cf_form_id`, `_cf_draft_token?`, `_cf_current_step`, plus the form fields. */
export type DraftSaveOutput =
	| { success: true; data: { draft_token: string; resume_url: string } }
	| DraftError;

/**
 * drafts/load: `_cf_draft_token` (form-data or JSON body). `data` is `[]` when empty (PHP json_encode of an empty
 * array).
 */
export type DraftLoadOutput =
	| {
			success: true;
			data: {
				form_id: number;
				data: Record<string, string | string[]> | [];
				current_step: number;
				draft_token: string;
			};
	  }
	| DraftError;

export interface DraftsApi {
	"drafts/save": RouteContract<FormDataBody, DraftSaveOutput>;
	/** Raw body: urlencoded, multipart or JSON. */
	"drafts/load": RouteContract<Uint8Array, DraftLoadOutput>;
}

export const draftsRoutes = defineRouteSpecs<DraftsApi>()({
	"drafts/save": {
		kind: "public",
		body: "form-data",
		response: "raw",
		phase: 1,
		owner: "P1.8",
		module: "drafts",
		summary: "cf_save_draft (also the partial-entry beacon).",
		spec: "03 §1.3.2; DV-19",
		rateLimit: "30 new drafts per 60 s per hashed IP+form, sliding (rl:draft:*)",
	},
	"drafts/load": {
		kind: "public",
		body: "bytes",
		response: "raw",
		headers: ["content-type"],
		phase: 1,
		owner: "P1.8",
		module: "drafts",
		summary: "cf_load_draft: resume a draft by token.",
		spec: "03 §1.3.3; DV-20",
	},
});
