/**
 * v0.1.0 → v1 data migration (P1.20; architecture §17.4; D-135). Admin only.
 */
import { defineRouteSpecs, type RouteContract } from "./contract.js";

export interface MigrationStatus {
	/** Data schema version from `state:schema` (null = never migrated). */
	schema: number | null;
	pending: boolean;
	detected: { forms: number; submissions: number };
	jobId: string | null;
	progress: { done: number; total: number } | null;
}

export interface MigrateApi {
	"migrate/status": RouteContract<Record<string, never>, MigrationStatus>;
	"migrate/run": RouteContract<{ scope?: "all" | "submissions" }, MigrationStatus>;
}

const MIGRATE = { phase: 1, owner: "P1.20", module: "migrate", kind: "admin", spec: "architecture §17.4; D-135" } as const;

export const migrateRoutes = defineRouteSpecs<MigrateApi>()({
	"migrate/status": { ...MIGRATE, summary: "v0.1.0 data detection and migration progress." },
	"migrate/run": { ...MIGRATE, summary: "Start the v0.1.0 → v1 migration job." },
});
