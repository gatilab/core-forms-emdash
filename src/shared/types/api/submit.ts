/**
 * Submit routes (P1.6; spec 01 §4, spec 03 §4.0; architecture §9.2; D-020, D-023).
 */
import type { SubmitResponse } from "../submissions.js";
import { defineRouteSpecs, type FormDataBody, type RouteContract } from "./contract.js";

/** 8 MiB: the platform maximum (spec 00 §4; file parts ≤ 1 MiB each without the companion, DV-26). */
export const SUBMIT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * `submit` answers raw:
 * - AJAX (`X-Requested-With: XMLHttpRequest` or `_cf_ajax=1`): the WP JSON `SubmitResponse` with WP status codes (D-020:
 *   200 business errors, 403 availability, 404 missing form, 422 calculation failure, 503 capacity).
 * - no-JS: a 303 to the source page with `?cf_response=<token>` (PRG, spec 01 §3.7), a same-origin redirect target, or
 *   the companion `go` handoff for off-site targets (DV-49).
 * Pre-uploaded files arrive as `_cf_files[<field>][]=<token>` (architecture §12).
 */
export type SubmitOutput = SubmitResponse;

/** `internal/go`: take a `go:<token>` entry (120 s) for the companion's off-site redirect (DV-49). */
export interface GoInput {
	token: string;
}
export interface GoOutput {
	/** null when the token is unknown or expired. */
	url: string | null;
}

export interface SubmitApi {
	submit: RouteContract<FormDataBody, SubmitOutput>;
	"internal/go": RouteContract<GoInput, GoOutput>;
}

export const submitRoutes = defineRouteSpecs<SubmitApi>()({
	submit: {
		kind: "public",
		body: "form-data",
		response: "raw",
		maxBytes: SUBMIT_MAX_BYTES,
		headers: ["x-requested-with", "origin", "referer"],
		phase: 1,
		owner: "P1.6",
		module: "submit",
		summary: "Forms::process: AJAX JSON with WP status codes, or a 303 PRG redirect for no-JS posts.",
		spec: "01 §4.2, §4.4; 03 §4.0; D-020, D-023, DV-49",
		rateLimit: "per-form `rate_limit` setting per hashed IP, sliding 1 h (rl:submit:*); capacity lock 10 s",
	},
	"internal/go": {
		kind: "internal",
		phase: 1,
		owner: "P1.6",
		module: "submit",
		summary: "Take a single-use go: token and return the off-site redirect URL.",
		spec: "D-023, DV-49",
	},
});
