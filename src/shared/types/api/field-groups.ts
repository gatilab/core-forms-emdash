/**
 * Reusable field groups (P1.7; spec 01 §2.12; D-069). Limits: 100 groups, 1..100 fields, 60 KB JSON, label ≤ 100.
 * Errors: 409 cf_group_conflict, 400 cf_invalid_group, 403 cf_group_forbidden.
 */
import type { FieldDef } from "../schema.js";
import { defineRouteSpecs, type RouteContract } from "./contract.js";

export interface FieldGroupDTO {
	id: string;
	label: string;
	fields: FieldDef[];
	/** EmDash user id. */
	owner: string;
	shared: boolean;
	/** Owner or admin. */
	can_remove: boolean;
}

export interface FieldGroupsList {
	/** Visible to the user: own, shared, or all for admins. */
	groups: FieldGroupDTO[];
	/** Opaque CAS token (`cfg:field-groups-version`). */
	version: string;
}

export interface FieldGroupsApi {
	"field-groups/list": RouteContract<Record<string, never>, FieldGroupsList>;
	/** Creates a new group (WP has no update). */
	"field-groups/save": RouteContract<{ version: string; label: string; fields: FieldDef[]; shared?: boolean }, FieldGroupsList>;
	"field-groups/delete": RouteContract<{ id: string; version: string }, FieldGroupsList>;
}

const FG = {
	phase: 1,
	owner: "P1.7",
	module: "field-groups",
	kind: "workspace",
	scope: { by: "none", reason: "field groups are not form data" },
	spec: "01 §2.12; D-069",
} as const;

export const fieldGroupsRoutes = defineRouteSpecs<FieldGroupsApi>()({
	"field-groups/list": { ...FG, summary: "Field groups visible to the user, with the CAS version." },
	"field-groups/save": { ...FG, summary: "Create a field group (409 cf_group_conflict on a stale version)." },
	"field-groups/delete": { ...FG, summary: "Remove a field group (owner or admin)." },
});
