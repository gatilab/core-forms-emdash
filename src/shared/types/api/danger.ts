/**
 * Delete all Core Forms data (P1.20; DV-70). Admin only.
 */
import { defineRouteSpecs, type RouteContract } from "./contract.js";

export interface DangerApi {
	"danger/delete-all": RouteContract<{ confirm: "DELETE" }, { jobId: string }>;
}

export const dangerRoutes = defineRouteSpecs<DangerApi>()({
	"danger/delete-all": {
		kind: "admin",
		phase: 1,
		owner: "P1.20",
		module: "danger",
		summary: "Remove every collection row, KV key and owned R2 object.",
		spec: "DV-70",
	},
});
