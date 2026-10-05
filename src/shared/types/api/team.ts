/**
 * Team inbox (P1.19a; spec 04 §2.9; D-076, D-091).
 */
import type { NumericId } from "../primitives.js";
import type { TeamRecord } from "../records.js";
import { defineRouteSpecs, type RouteContract } from "./contract.js";

export interface TeamSaveInput {
	/** Submission id. */
	id: NumericId;
	/** 409 cf_team_conflict "This entry changed. Reload before saving." on mismatch. */
	version: number;
	/** EmDash user id; null = unassigned. The assignee needs access to the form. */
	assignee: string | null;
	/** "Y-m-d\\TH:i" in the site timezone, or "". */
	due: string;
	/** Appended as a note when non-empty (≤ 10 000 chars). */
	note: string;
	hold: boolean;
}

/** Saved view params (WP query arg names, all strings). */
export interface SavedViewParams {
	form_id?: string;
	assignee?: string;
	overdue?: string;
	submission_status?: string;
	spam_status?: string;
	s?: string;
	date_from?: string;
	date_to?: string;
}

export interface SavedView {
	/** sha256(name).slice(0, 16). */
	key: string;
	/** ≤ 80 chars. */
	name: string;
	params: SavedViewParams;
}

/** `user:<userId>:access` (D-091). `forms: null` = every form. */
export interface AccessGrant {
	userId: string;
	name: string;
	email: string;
	granted: boolean;
	forms: NumericId[] | null;
}

export interface TeamApi {
	"team/get": RouteContract<{ id: NumericId }, { team: TeamRecord; authors: Record<string, string> }>;
	"team/save": RouteContract<TeamSaveInput, { team: TeamRecord; authors: Record<string, string> }>;
	"team/views/list": RouteContract<Record<string, never>, { views: SavedView[] }>;
	/** ≤ 30 views; the same name replaces. */
	"team/views/save": RouteContract<{ name: string; params: SavedViewParams }, { views: SavedView[] }>;
	"team/views/delete": RouteContract<{ key: string }, { views: SavedView[] }>;
	"team/access/list": RouteContract<Record<string, never>, { grants: AccessGrant[] }>;
	"team/access/save": RouteContract<{ userId: string; granted: boolean; forms: NumericId[] | null }, { grants: AccessGrant[] }>;
}

const TEAM = { phase: 1, owner: "P1.19a", module: "team", spec: "04 §2.9; D-076, D-091" } as const;
const OWN = { by: "none", reason: "the caller's own saved views" } as const;

export const teamRoutes = defineRouteSpecs<TeamApi>()({
	"team/get": { ...TEAM, kind: "workspace", scope: { by: "id" }, summary: "Assignee, due date, hold and notes of an entry." },
	"team/save": { ...TEAM, kind: "workspace", scope: { by: "id" }, summary: "Version-checked team save (409 on conflict)." },
	"team/views/list": { ...TEAM, kind: "workspace", scope: OWN, summary: "The user's saved inbox views." },
	"team/views/save": { ...TEAM, kind: "workspace", scope: OWN, summary: "Save an inbox view (≤ 30)." },
	"team/views/delete": { ...TEAM, kind: "workspace", scope: OWN, summary: "Delete a saved inbox view." },
	"team/access/list": { ...TEAM, kind: "admin", summary: "Access grants and form scopes." },
	"team/access/save": { ...TEAM, kind: "admin", summary: "Grant, scope or revoke a user's access." },
});
