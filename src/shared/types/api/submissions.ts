/**
 * Submissions workspace (P1.19a; spec 04 §2.2–2.7, §2.11; D-019, D-071–D-074, DV-28, DV-29, DV-72, DV-73).
 */
import type { IsoDateTime, NumericId } from "../primitives.js";
import type { ActionLogRecord, EmailLogRecord, FileRecord, ReplyRecord, TeamRecord } from "../records.js";
import type { InboxStatus, PaymentStatus, SubmissionRecord, SubmissionStatus, SubmissionValue } from "../submissions.js";
import { defineRouteSpecs, type RouteContract } from "./contract.js";

export type SubmissionView = "inbox" | "new" | "archived" | "spam" | "all";

/** Shared filters of list, counts and export (spec 04 §2.2). Each count applies the other active filters. */
export interface SubmissionFilters {
	formId?: NumericId;
	view: SubmissionView;
	/** Exact status. With a status filter the inbox view also shows archived rows. */
	status?: SubmissionStatus;
	/** Bounded value scan (D-019): stops at 50 matches or 2 000 scanned rows. */
	search?: string;
	/** "Y-m-d" in the site timezone (00:00:00 / 23:59:59 local → UTC). Invalid dates are ignored. */
	dateFrom?: string;
	dateTo?: string;
	/** EmDash user id. */
	assignee?: string;
	/** team.dueAt < now. */
	overdue?: boolean;
	/** Saved view key (16 hex); its params fill only absent filters. */
	savedView?: string;
}

/** `SubmissionPresentation::summary` (spec 04 §2.5). */
export interface SubmissionSummary {
	title: string;
	/** "" when it equals the title. */
	email: string;
	/** ≤ 2 parts joined " · ". */
	preview: string;
}

export interface SubmissionListItem {
	id: NumericId;
	formId: NumericId | "0";
	/** null → "Deleted form". */
	formTitle: string | null;
	summary: SubmissionSummary;
	submittedAt: IsoDateTime;
	status: SubmissionStatus;
	isSpam: boolean;
	paymentStatus: PaymentStatus | null;
	assignee: string | null;
	dueAt: IsoDateTime | null;
	/** layout "fields": `field_html` per data key (files through cf_field_value, others plain text ≤ 120 chars). */
	fields?: Record<string, string>;
}

export interface SubmissionsListInput extends SubmissionFilters {
	layout?: "summary" | "fields";
	orderby?: "submitted_at" | "form_id" | "id";
	order?: "asc" | "desc";
	cursor?: string;
	/** Default 25, max 100. */
	limit?: number;
}

export interface SubmissionsListOutput {
	items: SubmissionListItem[];
	nextCursor?: string;
	/** Rows examined by a search scan. */
	scanned?: number;
	/** The search stopped at its bound (D-019). */
	truncated?: boolean;
	/** layout "fields": the data keys of this page minus control names, with hidden columns removed. */
	columns?: { key: string; label: string }[];
}

export interface SubmissionCounts {
	inbox: number;
	new: number;
	archived: number;
	spam: number;
	all: number;
}

export interface SubmissionDetailField {
	key: string;
	/** str_replace('_', ' ', ucfirst(strtolower(key))). */
	label: string;
	value: SubmissionValue;
}

export interface SubmissionDetail {
	/** Secrets never appear here; `data` minus nothing (the raw view shows it all). */
	submission: SubmissionRecord;
	form: { id: NumericId; title: string; slug: string } | null;
	fields: SubmissionDetailField[];
	replies: ReplyRecord[];
	team: TeamRecord;
	emailLogs: EmailLogRecord[];
	actionLogs: ActionLogRecord[];
	files: FileRecord[];
	/** Labels for the detail header. */
	summary: SubmissionSummary;
}

export interface DeleteRefusal {
	id: NumericId;
	/**
	 * "pending_payment" | "pending_work" (fulfillment, queue or reversal not finished) | "busy" (lock) |
	 * "file_erase_failed" | "not_found" | "forbidden". Message text: "An entry is still needed for unfinished
	 * payment or fulfillment." for the first two.
	 */
	reason: string;
	message: string;
}

export interface SubmissionsExportInput {
	format: "global" | "form";
	formId?: NumericId;
	/** Export a selection (bulk "Export CSV"). */
	ids?: NumericId[];
	filters?: SubmissionFilters;
	cursor?: string;
}

/** CSV assembled in the browser from pages (DV-72); header and cell values already pass cf_csv_row (no BOM). */
export interface SubmissionsExportOutput {
	header: string[];
	rows: string[][];
	nextCursor?: string;
	/** Suggested filename. */
	filename: string;
}

export interface SubmissionsApi {
	"submissions/list": RouteContract<SubmissionsListInput, SubmissionsListOutput>;
	"submissions/counts": RouteContract<SubmissionFilters, SubmissionCounts>;
	/** `markRead` flips `new` → `read`, as WP does on open. */
	"submissions/get": RouteContract<{ id: NumericId; markRead?: true }, SubmissionDetail>;
	"submissions/status": RouteContract<{ ids: NumericId[]; status: InboxStatus }, { updated: NumericId[] }>;
	/** Un-spamming replays form.success and the actions (conditions re-checked, skips logged). */
	"submissions/spam": RouteContract<{ ids: NumericId[]; spam: boolean }, { updated: NumericId[]; replayed: NumericId[] }>;
	/** Files are kept from storage; arrays split on "\n" (DV-29). */
	"submissions/update-data": RouteContract<{ id: NumericId; data: Record<string, string | string[]> }, { submission: SubmissionRecord }>;
	/** Coordinated erase: every id is checked before any delete. */
	"submissions/delete": RouteContract<{ ids: NumericId[] }, { deleted: NumericId[]; refused: DeleteRefusal[]; jobIds: string[] }>;
	"submissions/export": RouteContract<SubmissionsExportInput, SubmissionsExportOutput>;
	/** CLI parity (`wp core-forms submission bulk-status`). */
	"submissions/bulk-status": RouteContract<
		{ status: SubmissionStatus; setStatus: InboxStatus; formId?: NumericId; before?: string; dryRun: boolean },
		{ matched: number; updated: number }
	>;
}

const SUBS = { phase: 1, owner: "P1.19a", module: "submissions", kind: "workspace" } as const;

export const submissionsRoutes = defineRouteSpecs<SubmissionsApi>()({
	"submissions/list": {
		...SUBS,
		scope: { by: "formId" },
		summary: "Inbox list with views, filters, search and layouts.",
		spec: "04 §2.2–2.4; D-019, D-074",
		mcp: { tool: "submissions_list", description: "List Core Forms submissions with filters.", destructive: false },
	},
	"submissions/counts": { ...SUBS, scope: { by: "formId" }, summary: "View counts for the current filters.", spec: "04 §2.2–2.3" },
	"submissions/get": { ...SUBS, scope: { by: "id" }, summary: "Submission detail with replies, team, logs and files.", spec: "04 §2.6" },
	"submissions/status": { ...SUBS, scope: { by: "ids" }, summary: "Set new/read/replied/archived.", spec: "04 §2.3" },
	"submissions/spam": { ...SUBS, scope: { by: "ids" }, summary: "Mark or unmark spam (un-spam replays actions).", spec: "04 §2.3; D-072" },
	"submissions/update-data": { ...SUBS, scope: { by: "id" }, summary: "Edit submission values.", spec: "04 §2.7; DV-29" },
	"submissions/delete": { ...SUBS, scope: { by: "ids" }, summary: "Coordinated erase with refusals.", spec: "04 §2.11; DV-78" },
	"submissions/export": { ...SUBS, scope: { by: "formId" }, summary: "CSV pages (global or per form).", spec: "04 §2.3.1; D-073, DV-72" },
	"submissions/bulk-status": {
		...SUBS,
		kind: "admin",
		summary: "Bulk status change by filter (CLI parity).",
		spec: "04 §5; D-094",
		mcp: { tool: "submissions_bulk_status", description: "Change the status of many submissions at once.", destructive: true },
	},
});

