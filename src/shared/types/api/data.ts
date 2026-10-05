/**
 * Import and export (P1.20; spec 04 §4; architecture §17; D-131–D-134, DV-32, DV-58). Admin only.
 */
import type { WpValue } from "../primitives.js";
import { defineRouteSpecs, type RouteContract } from "./contract.js";

export type Dataset = "forms" | "submissions" | "polls" | "settings" | "activity" | "commerce";
export type ImportPolicy = "create" | "update" | "skip";

/** One row in WP row shape (MySQL strings; JSON columns encoded), or a post row with `meta`. */
export type WpRow = Record<string, WpValue>;

export interface DataApi {
	"data/export-manifest": RouteContract<
		{ datasets: Dataset[]; formIds?: string[]; includeSecrets?: boolean },
		{ counts: Record<string, Record<string, number>>; references: WpValue }
	>;
	"data/export-page": RouteContract<
		{ dataset: Dataset; table: string; cursor?: string; formIds?: string[]; includeSecrets?: boolean },
		{ rows: WpRow[]; nextCursor?: string }
	>;
	"data/import-plan": RouteContract<
		{ format: string; forms: { id: string; slug: string }[]; datasets: Dataset[] },
		{ importId: string; conflicts: { id: string; slug: string; match: "id" | "slug"; outcome: string }[]; idMap: Record<string, string> }
	>;
	"data/import-batch": RouteContract<
		{ importId: string; dataset: Dataset; table: string; rows: WpRow[]; policy: ImportPolicy; options?: { importCredentials?: boolean } },
		{ created: number; updated: number; skipped: number; warnings: string[]; idMap: Record<string, string> }
	>;
	"data/import-finalize": RouteContract<{ importId: string }, { jobIds: string[]; warnings: string[] }>;
}

const DATA = { phase: 1, owner: "P1.20", module: "data", kind: "admin", spec: "04 §4; architecture §17" } as const;

export const dataRoutes = defineRouteSpecs<DataApi>()({
	"data/export-manifest": { ...DATA, summary: "Row counts per dataset and table for an export." },
	"data/export-page": {
		...DATA,
		summary: "One page of rows in WP row shape.",
		mcp: { tool: "forms_export", description: "Export Core Forms data pages (core-forms-data rows).", destructive: false },
	},
	"data/import-plan": { ...DATA, summary: "Conflicts and id map preview for an import." },
	"data/import-batch": { ...DATA, secretWrite: true, summary: "Import ≤ 200 rows of one table." },
	"data/import-finalize": { ...DATA, summary: "Bump sequences, regenerate theme CSS, rebuild the usage index." },
});
