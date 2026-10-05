/**
 * Error types shared by every layer. Pure: no platform imports.
 *
 * - `NotImplementedError`: thrown by P1.0a stubs until the owning package lands.
 * - `CoreFormsError`: a domain error with a stable `code` and the HTTP status the route
 *   framework (src/server/routes/framework.ts) maps it to.
 * - `LockBusyError`: `LockService.withLock` could not acquire within `waitMs` (architecture §5.8).
 */

/** Thrown by stub implementations. `owner` is the work package that will implement it (12-plan.md). */
export class NotImplementedError extends Error {
	readonly code = "not_implemented";
	constructor(
		readonly feature: string,
		readonly owner: string,
	) {
		super(`${feature} is not implemented yet (owner: ${owner}).`);
		this.name = "NotImplementedError";
	}
}

/** Throw a NotImplementedError. Used as the body of every stub: `return notImplemented("x", "P1.4")`. */
export function notImplemented(feature: string, owner: string): never {
	throw new NotImplementedError(feature, owner);
}

/**
 * Well-known error codes. WP codes keep their WP spelling; route-level codes are ours.
 * The list is open (`string & {}`): modules may add codes, documented in their API contract.
 */
export type CoreFormsErrorCode =
	| "not_found"
	| "forbidden"
	| "unauthorized"
	| "invalid_input"
	| "rate_limited"
	| "unavailable"
	| "internal_only"
	| "encryption_key_required"
	| "cf_edit_conflict"
	| "cf_version_required"
	| "cf_slug_conflict"
	| "cf_group_conflict"
	| "cf_team_conflict"
	| "lock_busy"
	| (string & {});

export interface CoreFormsErrorOptions {
	/** HTTP status the route framework answers with. Default 400. */
	status?: number;
	/** Field errors or other structured detail, returned inside the envelope's `data`. */
	data?: unknown;
	cause?: unknown;
}

/** A domain error with a stable code. Route handlers throw it; the framework maps it to a response. */
export class CoreFormsError extends Error {
	readonly code: CoreFormsErrorCode;
	readonly status: number;
	readonly data: unknown;
	constructor(code: CoreFormsErrorCode, message: string, options: CoreFormsErrorOptions = {}) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = "CoreFormsError";
		this.code = code;
		this.status = options.status ?? 400;
		this.data = options.data;
	}
}

/** `LockService.withLock` gave up after `waitMs` (architecture §5.8, §9.2 step 3). */
export class LockBusyError extends CoreFormsError {
	constructor(readonly lock: string) {
		super("lock_busy", `Lock "${lock}" is busy.`, { status: 503 });
		this.name = "LockBusyError";
	}
}

export function isCoreFormsError(error: unknown): error is CoreFormsError {
	return error instanceof CoreFormsError;
}
