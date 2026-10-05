/**
 * Private upload routes (P1.10; architecture §12; D-110–D-114, DV-27). Internal: called by the companion's
 * `/_core-forms/upload`, `/_core-forms/submit` and `/_core-forms/file/[id]` endpoints.
 */
import type { NumericId } from "../primitives.js";
import { defineRouteSpecs, type RouteContract } from "./contract.js";

export interface RegisterFileInput {
	formId: NumericId;
	field: string;
	/** R2 key the companion streamed the object to (uploads/tmp/...). */
	key: string;
	name: string;
	type: string;
	size: number;
	sha256: string;
}

/** Failures use the WP upload codes: file_upload_error, file_invalid_extension, file_mime_mismatch, file_too_large. */
export type RegisterFileOutput =
	| { ok: true; token: string; fileId: string }
	| { ok: false; code: string; message: string };

export interface AuthorizeFileInput {
	fileId: string;
	/** The session user the companion resolved; null = anonymous (always refused). */
	user: { id: string; email: string; role: number } | null;
}

export type AuthorizeFileOutput =
	| { ok: true; key: string; filename: string; contentType: string; size: number; storage: "r2" | "media" }
	| { ok: false; status: 403 | 404 };

export interface FilesApi {
	"internal/files/register": RouteContract<RegisterFileInput, RegisterFileOutput>;
	"internal/files/authorize": RouteContract<AuthorizeFileInput, AuthorizeFileOutput>;
}

export const filesRoutes = defineRouteSpecs<FilesApi>()({
	"internal/files/register": {
		kind: "internal",
		phase: 1,
		owner: "P1.10",
		module: "files",
		summary: "Validate a streamed upload and create a pending files row → {token}.",
		spec: "03 §3.1; architecture §12; D-113, D-114",
	},
	"internal/files/authorize": {
		kind: "internal",
		phase: 1,
		owner: "P1.10",
		module: "files",
		summary: "Team access check for a private download → object key and headers.",
		spec: "architecture §12; D-111",
	},
});
