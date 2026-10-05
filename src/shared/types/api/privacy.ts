/**
 * GDPR tools (P1.9; spec 03 §4.9, spec 04 §2.11; D-083, DV-53). Admin only; matching by email (emailKey index).
 */
import type { IsoDateTime, NumericId } from "../primitives.js";
import type { SubmissionStatus } from "../submissions.js";
import { defineRouteSpecs, type RouteContract } from "./contract.js";

/** WP personal-data exporter item. */
export interface GdprExportItem {
	group_id: "core_forms_submissions";
	group_label: "Form submissions";
	/** "core-forms-submission-{id}". */
	item_id: string;
	data: { name: string; value: string }[];
}

export interface PrivacyMatch {
	id: NumericId;
	formId: NumericId | "0";
	formTitle: string | null;
	submittedAt: IsoDateTime;
	status: SubmissionStatus;
	isSpam: boolean;
}

export interface PrivacyApi {
	"privacy/find": RouteContract<{ email: string; cursor?: string }, { items: PrivacyMatch[]; nextCursor?: string }>;
	"privacy/export": RouteContract<{ email: string; cursor?: string }, { data: GdprExportItem[]; done: boolean; nextCursor?: string }>;
	/** Coordinated erase; rows needed for pending payment or fulfillment are retained. */
	"privacy/erase": RouteContract<
		{ email: string },
		{ items_removed: boolean; items_retained: boolean; messages: string[]; done: boolean; jobIds: string[] }
	>;
}

const PRIVACY = { phase: 1, owner: "P1.9", module: "privacy", kind: "admin", spec: "03 §4.9; 04 §2.11; D-083, DV-53" } as const;

export const privacyRoutes = defineRouteSpecs<PrivacyApi>()({
	"privacy/find": { ...PRIVACY, summary: "Find submissions by email." },
	"privacy/export": { ...PRIVACY, summary: "Personal data export pages (WP exporter shape)." },
	"privacy/erase": { ...PRIVACY, summary: "Erase a person's submissions (coordinated erase)." },
});
