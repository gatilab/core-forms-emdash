/**
 * Assignable users (P1.19a; spec 04 §2.9; D-091). Uses `ctx.users` (capability users:read).
 */
import type { NumericId } from "../primitives.js";
import { defineRouteSpecs, type RouteContract } from "./contract.js";

export interface AssignableUser {
	id: string;
	name: string;
	email: string;
	/** EmDash role level (SUBSCRIBER 10 … ADMIN 50). */
	role: number;
	/** Admin or granted access to the form in question. */
	hasAccess: boolean;
}

export interface UsersApi {
	/** With `formId`: only users with access to that form (WP assignee select, ≤ 200). */
	"users/list": RouteContract<{ formId?: NumericId; search?: string }, { items: AssignableUser[] }>;
}

export const usersRoutes = defineRouteSpecs<UsersApi>()({
	"users/list": {
		kind: "workspace",
		phase: 1,
		owner: "P1.19a",
		module: "users",
		scope: { by: "formId" },
		summary: "Users that can be assigned (≤ 200).",
		spec: "04 §2.9; D-091",
	},
});
