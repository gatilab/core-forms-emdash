/**
 * Replies to a submitter (P1.19a; spec 04 §2.8; D-075). Success stores the reply and sets status `replied`;
 * failures store nothing.
 */
import type { NumericId } from "../primitives.js";
import type { ReplyRecord } from "../records.js";
import { defineRouteSpecs, type RouteContract } from "./contract.js";

export interface RepliesSendInput {
	submissionId: NumericId;
	/** Defaults to reply_from_email || admin email (direct transports only; EmDash transport uses Reply-To). */
	from?: string;
	to: string;
	subject: string;
	/** HTML (wp_kses_post). */
	message: string;
}

export interface RepliesApi {
	"replies/send": RouteContract<RepliesSendInput, { reply: ReplyRecord }>;
}

export const repliesRoutes = defineRouteSpecs<RepliesApi>()({
	"replies/send": {
		kind: "workspace",
		phase: 1,
		owner: "P1.19a",
		module: "replies",
		scope: { by: "submissionId" },
		summary: "Email a reply to the submitter and record it.",
		spec: "04 §2.8; D-075",
	},
});
