/**
 * Retention preview (P1.9; spec 04 §2.11; D-084).
 */
import type { NumericId } from "../primitives.js";
import { defineRouteSpecs, type RouteContract } from "./contract.js";

export interface RetentionPreview {
	/** Ordered by id, ≤ 100. */
	entry_ids: NumericId[];
	attachment_entry_ids: NumericId[];
	limit: 100;
}

export interface RetentionApi {
	"retention/preview": RouteContract<{ formId: NumericId }, RetentionPreview>;
}

export const retentionRoutes = defineRouteSpecs<RetentionApi>()({
	"retention/preview": {
		kind: "workspace",
		phase: 1,
		owner: "P1.9",
		module: "retention",
		scope: { by: "formId" },
		summary: "Which entries and attachments the retention job would remove next.",
		spec: "04 §2.11; D-084",
	},
});
