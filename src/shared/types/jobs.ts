/**
 * Durable job queue (architecture §5.4, §10). Normative.
 */
import type { CfContext } from "./ports.js";
import type { IsoDateTime, NumericId, WpValue } from "./primitives.js";

export type JobKind =
	/** Fan out a successful submission's actions (one per submission run). */
	| "dispatch"
	/** One action execution (WP cf_action_queue row equivalent). */
	| "action"
	/** Paid outbox (P4). */
	| "fulfillment"
	/** Refund outbox (P4). */
	| "reversal"
	/** Apply a verified provider webhook event (P4). */
	| "payment-event"
	/** System mail: team reminders, license/portal mails, replies retry. */
	| "mail"
	/** payload.task names the maintenance task (§10.4). */
	| "maintenance"
	/** Coordinated delete of one submission (files, cascades). */
	| "erase"
	/** Rename/delete a data column across a form's submissions. */
	| "column-rewrite"
	/** Form-usage index backfill. */
	| "usage-scan"
	/** v0.1.0 → v1 data migration batches. */
	| "migrate"
	/** Copy legacy WP upload files into R2. */
	| "import-files"
	/** Resend delivery event / WhatsApp inbound (P2). */
	| "inbound-event";

export type JobStatus = "pending" | "running" | "done" | "failed" | "cancelled" | "paused";

export type JobRefType = "submission" | "order" | "form" | "license" | "poll";

export interface Job<P extends WpValue = WpValue> {
	/** Deterministic idempotency key ("dispatch:1058462:submit", "action:<runKey>"). */
	id: string;
	kind: JobKind;
	status: JobStatus;
	/** Lower first; WP default 10. */
	priority: number;
	runAt: IsoDateTime;
	attempts: number;
	maxAttempts: number;
	payload: P;
	refType: JobRefType | null;
	refId: string | null;
	formId: NumericId | null;
	/** Set while running. */
	claimId: string | null;
	lockedAt: IsoDateTime | null;
	/** Redacted, ≤ 1000 chars. */
	lastError: string | null;
	result: WpValue | null;
	createdAt: IsoDateTime;
	updatedAt: IsoDateTime;
	completedAt: IsoDateTime | null;
}

export type JobOutcome =
	| { status: "done"; result?: WpValue }
	/** attempts+1, runAt = now + delay. */
	| { status: "retry"; error: string; delayMs: number }
	/** Terminal. */
	| { status: "failed"; error: string }
	/** Needs an admin (e.g. uncertain delivery). */
	| { status: "paused"; error: string };

export interface JobHandler<P extends WpValue = WpValue> {
	kind: JobKind;
	/** ≤ 20 000 (cron budget) unless the handler checkpoints. */
	timeoutMs: number;
	maxAttempts: number;
	/** A lock older than 10 min is treated as a crashed run. */
	onStale: "retry" | "pause";
	run(job: Job<P>, cx: CfContext): Promise<JobOutcome>;
}

export type NewJob<P extends WpValue> = Pick<Job<P>, "id" | "kind" | "payload"> &
	Partial<Pick<Job<P>, "priority" | "runAt" | "maxAttempts" | "refType" | "refId" | "formId">>;

export interface JobQueue {
	/** Create-only (compareAndSet null). Returns false if the id already exists. */
	enqueue<P extends WpValue>(job: NewJob<P>): Promise<boolean>;
	/** Best-effort immediate run of these ids in after(); safe if cron also claims them. */
	kick(ids: string[]): void;
	get(id: string): Promise<Job | null>;
	cancel(id: string): Promise<boolean>;
	retry(id: string, patch?: Partial<Pick<Job, "payload" | "runAt">>): Promise<boolean>;
}

/** Maintenance task names (architecture §10.4). Phase 2–4 names are added by their contract packages. */
export type MaintenanceTaskName =
	| "ephemeral-sweep"
	| "jobs-sweep"
	| "uploads-sweep"
	| "drafts-cleanup"
	| "retention"
	| "team-reminders"
	| "usage-rescan"
	| "poll-status"
	| "action-log-retention"
	| "analytics-retention"
	| "license-maintenance"
	| "portal-sessions-sweep";

export type MaintenanceCadence = "hourly" | "daily" | "weekly";

/**
 * A recurring task run by the `maintenance` job kind (architecture §10.2 step 2, §10.4). The tick enqueues
 * "maintenance:<task>:<periodKey>" when `state:maint:<task>.nextAt ≤ now`, so a task runs at most once per period.
 * Tasks must be idempotent and must checkpoint (return `retry` with a cursor in the job payload) when they cannot
 * finish within `timeoutMs`.
 */
export interface MaintenanceTask {
	name: MaintenanceTaskName;
	cadence: MaintenanceCadence;
	/** Work package that owns the implementation (12-plan.md). */
	owner: string;
	timeoutMs: number;
	run(job: Job<MaintenancePayload>, cx: CfContext): Promise<JobOutcome>;
}

/** Payload of a `maintenance` job. `cursor` is the task's own checkpoint. */
export type MaintenancePayload = { task: MaintenanceTaskName; periodKey: string; cursor?: WpValue };
