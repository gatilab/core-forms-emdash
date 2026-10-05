/**
 * Polls (spec 03 §5, §10.1). Poll settings are a WP JSON blob, stored verbatim with WP keys (D-012).
 */
import type { IsoDateTime, NumericId } from "./primitives.js";

export type PollVoteLimit = "none" | "ip" | "cookie" | "user";
export type PollDisplayStyle = "bar" | "columns" | "percent";
export type PollCloseBehavior = "show_results" | "hide" | "redirect";

/** `cf_polls.settings` (WP keys and defaults). */
export type PollSettings = {
	/** Legacy; false. */
	allow_multiple?: boolean;
	/** false. */
	show_results_before_vote: boolean;
	/** "ip". */
	vote_limit: PollVoteLimit;
	/** 1. */
	honeypot: 0 | 1;
	/** "bar". */
	display_style: PollDisplayStyle;
};

/** `polls`, id = WP `cf_polls.id`. Post fields come from the WP `core-poll` post. */
export interface PollRecord {
	id: NumericId;
	n: number;
	postId: NumericId | null;
	slug: string;
	title: string;
	postStatus: "publish" | "draft" | "pending" | "private" | (string & {});
	question: string;
	options: string[];
	settings: PollSettings;
	type: "single" | "multiple";
	allowOther: boolean;
	postCloseBehavior: PollCloseBehavior;
	redirectUrl: string | null;
	enableLiveResults: boolean;
	/** Minutes; 0 = off. */
	changeVoteWindow: number;
	/** WP accepts any string; "active" | "closed" in practice. */
	status: "active" | "closed" | (string & {});
	/** UTC instants (D-058). */
	startsAt: IsoDateTime | null;
	endsAt: IsoDateTime | null;
	createdAt: IsoDateTime;
	updatedAt: IsoDateTime;
}

/** `pollVotes` (WP `cf_poll_votes`, one row per chosen option). Ids: `wp-<id>` | `vote_<ulid>`. */
export interface PollVoteRecord {
	id: string;
	pollId: NumericId;
	optionIndex: number;
	optionValue: string | null;
	ipAddress: string | null;
	userId: string | null;
	cookieHash: string | null;
	voterHash: string | null;
	referrer: string | null;
	votedAt: IsoDateTime;
}

/** `pollTallies`, id `<pollId>:<optionIndex>` or `<pollId>:_total`. */
export interface PollTallyRecord {
	pollId: NumericId;
	/** -1 for the `_total` row. */
	optionIndex: number;
	votes: number;
	uniques: number;
}
