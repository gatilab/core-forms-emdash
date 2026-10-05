/**
 * Event bus (architecture §5.8). Listeners are isolated: errors are logged and never break the emitter.
 */
import type { ActionConfig, ActionOutcome } from "./actions.js";
import type { ResolvedForm } from "./forms.js";
import type { IsoDateTime, NumericId } from "./primitives.js";
import type { EphemeralSubmission, SubmissionRecord, WriteContext } from "./submissions.js";

export interface CoreFormsEvents {
	"submission.written": { ids: NumericId[]; context: WriteContext; submission?: SubmissionRecord; form?: ResolvedForm };
	"submission.inserted": { submission: SubmissionRecord; form: ResolvedForm };
	"submission.insertFailed": { submission: Omit<SubmissionRecord, "id" | "n">; form: ResolvedForm; error: string };
	"submission.blocked": { form: ResolvedForm; reason: string };
	"form.success": {
		submission: SubmissionRecord | EphemeralSubmission;
		form: ResolvedForm;
		origin: "submit" | "replay" | "fulfillment";
	};
	"form.response": { form: ResolvedForm; submission: SubmissionRecord | EphemeralSubmission | null; code: string };
	"action.skipped": {
		form: ResolvedForm;
		action: ActionConfig;
		submission: SubmissionRecord | EphemeralSubmission;
		reason: string;
	};
	"action.finished": { runKey: string; outcome: ActionOutcome; form: ResolvedForm; submissionId: NumericId | null };
	"webhook.response": { form: ResolvedForm; action: ActionConfig; status: number };
	"delivery.reconciled": { runKey: string; outcome: "delivered" | "not_delivered"; evidence: string };
	"whatsapp.replyReceived": { submissionId: NumericId; provider: "meta" | "twilio"; text: string };
	"poll.voted": { pollId: NumericId; options: number[]; other: string; voterHash: string };
	"payment.completed": { submission: SubmissionRecord; form: ResolvedForm };
	"payment.refunded": { submission: SubmissionRecord; partial: boolean };
	"license.orderFulfilled": { orderId: NumericId; licenseIds: NumericId[]; submission: SubmissionRecord };
	"license.renewed": { licenseId: NumericId; expiresAt: IsoDateTime; submission: SubmissionRecord };
	"license.orderRefunded": { orderIds: NumericId[]; submission: SubmissionRecord };
}

export type CoreFormsEventName = keyof CoreFormsEvents;

export interface EventBus {
	emit<E extends keyof CoreFormsEvents>(e: E, p: CoreFormsEvents[E]): Promise<void>;
}
