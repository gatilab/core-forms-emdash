/**
 * Job queue tools (P1.20 over the P1.0b queue; architecture §10). Admin only.
 */
import type { Job, JobKind, JobStatus } from "../jobs.js";
import { defineRouteSpecs, type RouteContract } from "./contract.js";

export interface JobsStats {
	byStatus: Record<JobStatus, number>;
	byKind: Partial<Record<JobKind, Partial<Record<JobStatus, number>>>>;
	lastTickAt: string | null;
}

export interface JobsApi {
	"jobs/stats": RouteContract<Record<string, never>, JobsStats>;
	"jobs/process-now": RouteContract<{ limit?: number }, { claimed: number; done: number; failed: number }>;
	"jobs/retry": RouteContract<{ ids: string[] }, { retried: string[] }>;
	"jobs/cancel": RouteContract<{ ids: string[] }, { cancelled: string[] }>;
}

export type JobListItem = Omit<Job, "payload">;

const JOBS = { phase: 1, owner: "P1.20", module: "jobs", kind: "admin", spec: "architecture §10" } as const;

export const jobsRoutes = defineRouteSpecs<JobsApi>()({
	"jobs/stats": { ...JOBS, summary: "Queue counts by status and kind." },
	"jobs/process-now": { ...JOBS, summary: "Drain due jobs now (tick budget)." },
	"jobs/retry": { ...JOBS, summary: "Retry failed or paused jobs." },
	"jobs/cancel": { ...JOBS, summary: "Cancel pending or paused jobs." },
});
