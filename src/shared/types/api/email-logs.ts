/**
 * Email logs (P1.11; spec 04 §2.10; D-077, DV-33, DV-69).
 */
import type { NumericId } from "../primitives.js";
import type { EmailLogRecord, EmailLogStatus } from "../records.js";
import { defineRouteSpecs, type RouteContract } from "./contract.js";

export interface EmailLogsListInput {
	formId?: NumericId | "0";
	status?: EmailLogStatus;
	/** to_email or subject contains (bounded scan). */
	search?: string;
	dateFrom?: string;
	dateTo?: string;
	orderby?: "sent_at" | "status" | "id";
	order?: "asc" | "desc";
	cursor?: string;
	/** Default 20. */
	limit?: number;
}

/** List rows omit the message body; `email-logs/get` returns it (DV-69). */
export type EmailLogListItem = Omit<EmailLogRecord, "message">;

export interface EmailLogsApi {
	"email-logs/list": RouteContract<EmailLogsListInput, { items: EmailLogListItem[]; nextCursor?: string }>;
	"email-logs/get": RouteContract<{ id: string }, { log: EmailLogRecord }>;
	/** Team-scoped; ignores the list filters (WP). */
	"email-logs/stats": RouteContract<{ formId?: NumericId | "0" }, { total: number; sent: number; failed: number }>;
	/** Only failed rows of type email, autoresponder or emailit; writes a new row linked by `resendOf` (DV-33). */
	"email-logs/resend": RouteContract<{ id: string }, { log: EmailLogRecord }>;
	/** formId "0" rows: admins only. */
	"email-logs/delete": RouteContract<{ ids: string[] }, { deleted: string[] }>;
}

const LOGS = { phase: 1, owner: "P1.11", module: "email-logs", kind: "workspace", spec: "04 §2.10; D-077" } as const;

export const emailLogsRoutes = defineRouteSpecs<EmailLogsApi>()({
	"email-logs/list": { ...LOGS, scope: { by: "formId" }, summary: "Email log rows with filters." },
	"email-logs/get": { ...LOGS, scope: { by: "none", reason: "checked against the log row's formId" }, summary: "One email log with its message." },
	"email-logs/stats": { ...LOGS, scope: { by: "formId" }, summary: "Sent, failed and total counts." },
	"email-logs/resend": { ...LOGS, scope: { by: "none", reason: "checked against the log row's formId" }, summary: "Resend a failed email (new log row)." },
	"email-logs/delete": { ...LOGS, scope: { by: "none", reason: "checked against each log row's formId" }, summary: "Delete email log rows." },
});
