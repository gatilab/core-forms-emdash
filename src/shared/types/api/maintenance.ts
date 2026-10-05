/**
 * Old-record cleanup (P1.20; spec 04 §5; D-094). Admin only; routed through the coordinated erase.
 */
import { defineRouteSpecs, type RouteContract } from "./contract.js";

export interface MaintenanceApi {
	"maintenance/cleanup": RouteContract<{ days: number; dryRun: boolean }, { matched: number; deleted: number; refused: number; jobIds: string[] }>;
}

export const maintenanceRoutes = defineRouteSpecs<MaintenanceApi>()({
	"maintenance/cleanup": {
		kind: "admin",
		phase: 1,
		owner: "P1.20",
		module: "maintenance",
		summary: "Delete submissions older than N days (CLI parity).",
		spec: "04 §5; D-094",
		mcp: { tool: "maintenance_cleanup", description: "Delete Core Forms submissions older than N days.", destructive: true },
	},
});
