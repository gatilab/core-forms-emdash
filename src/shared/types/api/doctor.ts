/**
 * Health checks (P1.20; architecture §19; D-094, DV-57). Admin only; also an MCP tool and the CLI `doctor`.
 */
import { defineRouteSpecs, type RouteContract } from "./contract.js";

export interface DoctorCheck {
	check: string;
	status: "ok" | "warn" | "fail";
	detail: string;
}

export interface DoctorApi {
	doctor: RouteContract<Record<string, never>, DoctorCheck[]>;
}

export const doctorRoutes = defineRouteSpecs<DoctorApi>()({
	doctor: {
		kind: "admin",
		phase: 1,
		owner: "P1.20",
		module: "doctor",
		summary: "Platform, bindings, queue and data health checks.",
		spec: "architecture §19",
		mcp: { tool: "doctor", description: "Run Core Forms health checks.", destructive: false },
	},
});
