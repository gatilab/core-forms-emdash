/**
 * Submissions (architecture §5.3; spec 01 §1.8, spec 04 §2.1). Normative.
 */
import type { IsoDateTime, NumericId } from "./primitives.js";

export type SubmissionStatus =
	// inbox workflow
	| "new"
	| "read"
	| "replied"
	| "archived"
	// save & resume ("partial" is never written; imported only)
	| "draft"
	| "partial"
	// payments (written to both status and paymentStatus, spec 04 §2.1)
	| "pending_payment"
	| "paid"
	| "payment_failed"
	| "refunded";

/** Statuses an inbox write (`submissions/status`) may set (spec 04 §2.1). */
export type InboxStatus = "new" | "read" | "replied" | "archived";

export type PaymentStatus = "pending_payment" | "paid" | "payment_failed" | "refunded";

/** Derived on every write: isSpam ? "spam" : status === "archived" ? "archived" : "inbox" (D-071). */
export type SubmissionBucket = "inbox" | "archived" | "spam";

/**
 * Stored file reference. WP keys kept; `dir` is never stored or sent (DV-27).
 * Declared as a type alias so it nests inside `WpValue`.
 */
export type FileDescriptor = {
	/** Stored filename. */
	name: string;
	original_name: string;
	/** Client MIME. */
	type: string;
	size: number;
	/** Download route for private files; WP URL for legacy imports. */
	url: string;
	/** `files` collection id; "legacy:<attachment_id|name>" for imported WP files (§17.2). */
	file_id: string;
	private?: true;
	/** Legacy WP attachment, imports only. */
	attachment_id?: number;
};

/** The literal a retired attachment is replaced with (spec 04 §2.11). */
export type RetiredFile = "Attachment removed by retention";
export const RETIRED_FILE: RetiredFile = "Attachment removed by retention";

export type SubmissionValue = string | number | string[] | FileDescriptor | FileDescriptor[] | RetiredFile;
export type SubmissionData = Record<string, SubmissionValue>;

export type SubmissionOrigin = "submit" | "headless" | "draft" | "import" | "checkout" | "admin" | "migrate";

/** Stored submission (`submissions` collection, architecture §6.2). */
export interface SubmissionRecord {
	id: NumericId;
	n: number;
	/** "0" = Core Commerce native checkout. */
	formId: NumericId | "0";
	/** Spec 01 §1.8 shapes; may hold server-owned "_cf_license_checkout". */
	data: SubmissionData;
	userAgent: string | null;
	/** null when settings.emdash.store_ip is false. */
	ipAddress: string | null;
	refererUrl: string | null;
	/** EmDash extension (requestMeta.geo). */
	country: string | null;
	/** Orthogonal to status (spec 04 §2.1). */
	isSpam: boolean;
	status: SubmissionStatus;
	bucket: SubmissionBucket;
	/** 64 hex. */
	draftToken: string | null;
	currentStep: number;
	paymentStatus: PaymentStatus | null;
	paymentProvider: string | null;
	paymentId: string | null;
	/** Minor units. */
	paymentAmount: number | null;
	paymentCurrency: string | null;
	/** Partial-refund tracking (DV-03). */
	paymentRefundedMinor: number | null;
	submittedAt: IsoDateTime;
	/** UTC (DV-30). */
	modifiedAt: IsoDateTime | null;
	/** Lowercased first valid email in data (search, GDPR). */
	emailKey: string | null;
	origin: SubmissionOrigin;
	/** v0.1.0 uuid after migration. */
	legacyId?: string;
}

/** For save_submissions = 0 runs: never stored as a submission; travels inside the dispatch job and is scrubbed afterwards (DV-37). */
export interface EphemeralSubmission extends Omit<SubmissionRecord, "id" | "n"> {
	id: "";
	executionId: string;
}

export type WriteContext =
	| "submit"
	| "admin_edit"
	| "draft"
	| "delete"
	| "status"
	| "spam"
	| "payment"
	| "gdpr"
	| "rest_update"
	| "cli"
	| "import"
	| "data_management"
	| "team"
	| "erase"
	| "attachment_retention"
	| "license_commerce"
	| "fulfillment"
	| "refund_reconciliation"
	| "migrate";

/** Exact AJAX/headless response contract (spec 01 §4.4, spec 02 §2.1). `text` is HTML. Additive keys are allowed (D-020b). */
export interface SubmitResponse {
	message: { type: "success" | "error" | "warning"; text: string };
	error?: true;
	hide_form?: boolean;
	redirect_url?: string;
	payment?: {
		provider: string;
		mode: "test" | "live";
		flow?: "inline" | "hosted";
		payment_id?: string;
		client_secret?: string;
		publishable_key?: string;
		return_url?: string;
	};
}
