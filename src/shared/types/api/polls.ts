/**
 * Polls (P1.15; spec 03 §5; DV-24, DV-60).
 */
import type { NumericId } from "../primitives.js";
import type { PollCloseBehavior, PollDisplayStyle, PollSettings } from "../polls.js";
import type { AssetManifest } from "../render.js";
import { defineRouteSpecs, type FormDataBody, type QueryInput, type RouteContract } from "./contract.js";

/** `{success:false, data:{message}}`, HTTP 200 (spec 03 §5.4). */
export interface PollError {
	success: false;
	data: { message: string };
}

/**
 * PHP-encoded `{optionIndex: votes}` map: a JSON array when the keys are 0..n-1 contiguous, an object when they have
 * gaps, `[]` when empty (spec 03 §5.5).
 */
export type PollResultsMap = number[] | Record<string, number>;

/** polls/vote fields: poll_id, poll_action (vote|change), cf_poll_option / cf_poll_option[], cf_poll_other, cf_poll_hp. */
export type PollVoteOutput =
	| {
			success: true;
			data: { message: string; html: string; results?: PollResultsMap; total?: number };
	  }
	| PollError;

/** `?poll_id=` → the cf_poll_results AJAX envelope. */
export type PollResultsAjaxOutput = { success: true; data: { results: PollResultsMap; total: number; html: string } } | PollError;

/** `?id=` → the REST `/polls/{id}/results` shape. */
export interface PollResultsRestOutput {
	poll_id: number;
	total: number;
	uniques: number;
	closed: boolean;
	options: { index: number; label: string; votes: number }[];
}

export interface PollRenderInput {
	ref: { id?: NumericId; slug?: string };
	/** "results" = shortcode `results="1"` / PT block mode. */
	mode: "default" | "results";
	/** Value of the `cf_poll_voter` cookie, if any (DV-60). */
	voterCookie: string | null;
	page: { url: string; path: string };
	auth?: { user: { id: string; email: string; role: number } | null };
}

export interface PollRenderOutput {
	status: 200 | 404;
	/** `<p class="cf-poll-error">Poll not found.</p>` on 404. */
	html: string;
	manifest: AssetManifest | null;
	poll: { id: NumericId; slug: string } | null;
}

/** Admin list/get payload (WP REST GET /polls, spec 03 §5.6), plus the vote count shown in the list. */
export interface PollListItem {
	id: NumericId;
	post_id: NumericId | null;
	slug: string;
	title: string;
	question: string;
	type: "single" | "multiple";
	status: string;
	is_active: boolean;
	is_closed: boolean;
	allow_other: boolean;
	starts_at: string | null;
	ends_at: string | null;
	enable_live_results: boolean;
	change_vote_window: number;
	display_style: PollDisplayStyle;
	post_close_behavior: PollCloseBehavior;
	votes: number;
}

export interface PollDTO extends PollListItem {
	options: string[];
	settings: PollSettings;
	post_status: string;
	redirect_url: string | null;
	created_at: string;
}

/** Editable poll fields (WP admin save fields, spec 03 §5.6; partial merge with the stored poll). */
export interface PollInput {
	title?: string;
	slug?: string;
	post_status?: string;
	question?: string;
	type?: "single" | "multiple";
	options?: string[];
	allow_other?: boolean;
	settings?: Partial<PollSettings>;
	enable_live_results?: boolean;
	change_vote_window?: number;
	status?: string;
	starts_at?: string | null;
	ends_at?: string | null;
	post_close_behavior?: PollCloseBehavior;
	redirect_url?: string | null;
}

export interface PollsApi {
	"polls/vote": RouteContract<FormDataBody, PollVoteOutput>;
	"polls/results": RouteContract<QueryInput & { poll_id?: string; id?: string }, PollResultsAjaxOutput | PollResultsRestOutput>;
	"internal/poll-render": RouteContract<PollRenderInput, PollRenderOutput>;
	"polls/list": RouteContract<{ search?: string }, { items: PollListItem[] }>;
	"polls/get": RouteContract<{ id: NumericId }, { poll: PollDTO }>;
	"polls/save": RouteContract<{ id?: NumericId; poll: PollInput }, { poll: PollDTO }>;
	"polls/delete": RouteContract<{ ids: NumericId[] }, { deleted: NumericId[] }>;
	"polls/duplicate": RouteContract<{ id: NumericId }, { poll: PollDTO }>;
	/** CSV `poll-{id}-votes.csv` assembled in the browser: id, option_index, option_label, option_value, ip_address, user_id, voter_hash, voted_at, referrer. */
	"polls/export": RouteContract<{ id: NumericId; cursor?: string }, { filename: string; header: string[]; rows: string[][]; nextCursor?: string }>;
	"polls/analytics": RouteContract<
		{ id: NumericId; days?: number },
		{ poll_id: number; days: number; series: Record<string, number>; total: number; uniques: number }
	>;
}

const POLL = { phase: 1, owner: "P1.15", module: "polls" } as const;
const POLL_ADMIN = { ...POLL, kind: "workspace", scope: { by: "none", reason: "polls are not form-scoped" } } as const;

export const pollsRoutes = defineRouteSpecs<PollsApi>()({
	"polls/vote": {
		...POLL,
		kind: "public",
		body: "form-data",
		response: "raw",
		summary: "cf_poll_vote: record a vote or change it.",
		spec: "03 §5.4; DV-24, DV-60",
		rateLimit: "12 per 60 s per hashed IP, sliding (rl:poll:*)",
	},
	"polls/results": {
		...POLL,
		kind: "public",
		methods: ["GET"],
		body: "none",
		response: "raw",
		summary: "?poll_id= → cf_poll_results envelope; ?id= → REST /polls/{id}/results shape.",
		spec: "03 §5.5",
	},
	"internal/poll-render": {
		...POLL,
		kind: "internal",
		summary: "Poll HTML and manifest for <CorePoll>, the core-poll block and [cf_poll].",
		spec: "03 §5.3",
	},
	"polls/list": { ...POLL_ADMIN, summary: "Latest 100 polls.", spec: "03 §5.6" },
	"polls/get": { ...POLL_ADMIN, summary: "One poll with options and settings.", spec: "03 §5.6" },
	"polls/save": { ...POLL_ADMIN, summary: "Create or update a poll (partial merge).", spec: "03 §5.6" },
	"polls/delete": { ...POLL_ADMIN, summary: "Delete polls with their votes and tallies.", spec: "03 §5.6" },
	"polls/duplicate": { ...POLL_ADMIN, summary: "Copy a poll as a draft (\"{title} (Copy)\").", spec: "03 §5.6" },
	"polls/export": { ...POLL_ADMIN, summary: "Vote CSV rows, paged.", spec: "03 §5.8" },
	"polls/analytics": { ...POLL_ADMIN, summary: "Daily vote series (days clamped 1..365).", spec: "03 §5.7" },
});
