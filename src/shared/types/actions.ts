/**
 * Form actions (architecture §5.5; spec 05 §1). Normative.
 */
import type { ResolvedForm } from "./forms.js";
import type { Mailer } from "./mail.js";
import type { FileReader, GlobalSettingsView, Logger, ReplyStore } from "./ports.js";
import type { SealedSecret, WpFlag, WpValue } from "./primitives.js";
import type { EphemeralSubmission, SubmissionRecord } from "./submissions.js";

/** One element of settings.actions (spec 05 §1.3). Stored verbatim, string-typed, unknown keys kept. */
export interface ActionConfig {
	type: string;
	/** "action-N" (0-based) or "action-<uuid>"; never renumbered (D-100). */
	_cf_action_id?: string;
	async?: WpFlag;
	conditions?: ActionCondition[];
	/** EmDash extension (default true); absent in WP data (DV-38). */
	enabled?: WpFlag;
	recipient_routes?: RecipientRoute[];
	[key: string]: WpValue | SealedSecret | ActionCondition[] | RecipientRoute[] | undefined;
}

/** Operators of `cf_evaluate_action_conditions` (spec 05 §1.5). An unknown operator makes the row fail. */
export type ConditionOperator = "equals" | "not_equals" | "contains" | "not_contains" | "empty" | "not_empty";

/** Unknown operator ⇒ row fails. Declared as a type alias so it nests inside `WpValue`. */
export type ActionCondition = { field: string; operator: string; value?: string };
export type RecipientRoute = { field: string; operator: string; value: string; recipient: string };

export type ActionStatus = "success" | "failed" | "queued" | "skipped" | "unverified" | "uncertain";

export interface ActionOutcome {
	status: ActionStatus;
	/** Redacted per spec 05 §1.8. */
	message: string;
	meta?: Record<string, WpValue>;
	retryable?: boolean;
	/** Clamped 0..3600. */
	retryAfterS?: number;
	/** Inline-phase actions only. */
	redirectUrl?: string;
}

export type ActionCategory =
	| "notifications"
	| "messaging"
	| "data"
	| "marketing"
	| "support"
	| "community"
	| "automation"
	| "commerce";

export interface ActionFieldSpec {
	key: string;
	label: string;
	type:
		| "text"
		| "textarea"
		| "password"
		| "email"
		| "url"
		| "number"
		| "select"
		| "checkbox"
		| "field"
		| "fields"
		| "json"
		| "lines"
		| "conditions"
		| "recipient_routes"
		| "remote_select";
	default?: string;
	required?: boolean;
	help?: string;
	options?: { value: string; label: string }[];
	/** Admin route returning options (e.g. "actions/emailit-audiences"). */
	remote?: string;
	secret?: boolean;
	showWhen?: { key: string; equals: string };
}

export interface ActionModule<S extends ActionConfig = ActionConfig> {
	type: string;
	label: string;
	category: ActionCategory;
	docsSlug: string;
	/** Exact WP keys and defaults (spec 05 §3). */
	defaults: Partial<S>;
	/** Drives the generic admin card (P1.17, P2.6). */
	fields: ActionFieldSpec[];
	/** Sealed at rest, masked in admin, redacted in logs. */
	secretKeys: readonly string[];
	/** ActionRunner::can_queue. */
	queueable: boolean;
	/** inline = must finish before the submit response (redirect producers). */
	phase: "inline" | "after";
	destinationKeys?: readonly string[];
	/** A string is the reason shown on the card. */
	available(g: GlobalSettingsView): true | string;
	/** Normalized like WP (spec 05 §1.8). */
	run(settings: S, rc: RunContext): Promise<ActionOutcome | boolean | number | null | void>;
}

/** Imported WordPress-only types: kept verbatim, never executed (D-104). */
export interface WpOnlyActionType {
	type: string;
	label: string;
	dependency: string;
}

/** Escape modes of `RunContext.render` (spec 05 §1.6). */
export type RenderEscape = "none" | "html" | "header" | "strip_tags" | "telegram";

export interface RunFetchInit extends RequestInit {
	timeoutMs: number;
	redirect?: "follow" | "manual";
	maxResponseBytes?: number;
}

export interface RunContext {
	form: ResolvedForm;
	submission: SubmissionRecord | EphemeralSubmission;
	/** sha256 per spec 05 §2.1. */
	runKey: string;
	actionId: string;
	index: number;
	testing: boolean;
	/** Admin for replay/test, null for public. */
	actor: { userId: string } | null;
	fetch(url: string, init: RunFetchInit): Promise<Response>;
	/** Ledger-checkpointed. */
	step<T extends WpValue>(name: string, fn: () => Promise<T>): Promise<T>;
	/** [data variables] */
	render(template: string, escape?: RenderEscape): string;
	mail: Mailer;
	replies: ReplyStore;
	files: FileReader;
	globals: GlobalSettingsView;
	secret(value: WpValue | SealedSecret | undefined): Promise<string>;
	/** Inline phase only. */
	setRedirect(url: string): void;
	log: Logger;
	now(): Date;
}
