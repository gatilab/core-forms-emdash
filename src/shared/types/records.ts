/**
 * Stored record shapes for the Phase 1 collections whose contents are not a §5 type (architecture §6.2).
 * Field names are camelCase (D-012); WP-shaped JSON blobs are stored verbatim. `src/core/io/mappers` owns the
 * mapping to WP column names.
 */
import type { DefinitionSnapshot } from "./forms.js";
import type { MailDelivery, MailDropped } from "./mail.js";
import type { IsoDateTime, NumericId, WpValue } from "./primitives.js";
import type { FieldDef } from "./schema.js";

/** `formRevisions`, id `rev_<ulid>`. 50 kept per form (D-062). */
export interface FormRevisionRecord {
	id: string;
	formId: NumericId;
	snapshot: DefinitionSnapshot;
	kind: "save" | "restore" | "publish" | "discard" | "import";
	authorId: string | null;
	createdAt: IsoDateTime;
}

/** `formUsage`, id `<collection>:<entryId>:<kind>:<ref>` (DV-52). */
export interface FormUsageRecord {
	id: string;
	kind: "form" | "poll" | "commerce";
	/** Form/poll id or slug as written in the content, or a commerce reference. */
	ref: string;
	collection: string;
	entryId: string;
	title: string;
	path: string;
	status: string;
	updatedAt: IsoDateTime;
}

/** `fieldGroups`, id 16 hex (spec 01 §2.12; D-069). Limits: 100 groups, 1..100 fields, 60 KB, label ≤ 100. */
export interface FieldGroupRecord {
	id: string;
	label: string;
	fields: FieldDef[];
	/** EmDash user id. */
	owner: string;
	shared: boolean;
	createdAt: IsoDateTime;
	updatedAt: IsoDateTime;
}

/** `replies` (WP `cf_submission_replies`, spec 04 §2.8). Ids: `wp-<id>` | `msg:<provider>:<providerMessageId>` | `rep_<ulid>`. */
export interface ReplyRecord {
	id: string;
	submissionId: NumericId;
	/** WP default "outbound"; WhatsApp inbound writes other values. */
	direction: "outbound" | "inbound" | (string & {});
	/** WP default "email". */
	channel: "email" | "whatsapp" | (string & {});
	/** null (never "") when unknown, so the WP unique key (provider, provider_message_id) holds. */
	provider: string | null;
	providerMessageId: string | null;
	/** WP default "received", even for admin email replies. */
	status: string;
	fromEmail: string | null;
	toEmail: string;
	subject: string | null;
	/** KSES-sanitized HTML. */
	message: string;
	payload: string | null;
	userId: string | null;
	sentAt: IsoDateTime;
}

/** A team note (append-only, ≤ 10 000 chars, ≤ 1 000 per entry). */
export interface TeamNote {
	/** EmDash user id (WP int id for imported notes, as a string). */
	author: string;
	at: IsoDateTime;
	text: string;
}

/** `team`, id = submission id (spec 04 §2.9; D-076). Default when absent: unassigned, version 0. */
export interface TeamRecord {
	id: NumericId;
	formId: NumericId;
	/** EmDash user id; null = unassigned (WP 0). */
	assignee: string | null;
	dueAt: IsoDateTime | null;
	hold: boolean;
	notes: TeamNote[];
	version: number;
	remindedAt: IsoDateTime | null;
}

export type EmailLogStatus = "pending" | "sent" | "failed";

/** `emailLogs` (WP `cf_email_logs` + transport extensions; spec 04 §2.10). Ids: `wp-<id>` | `eml_<ulid>`. */
export interface EmailLogRecord {
	id: string;
	formId: NumericId | "0";
	submissionId: NumericId | null;
	/** Phone numbers for whatsapp_* action types. */
	toEmail: string;
	fromEmail: string | null;
	subject: string | null;
	message: string | null;
	/** "\n"-joined header lines. */
	headers: string | null;
	status: EmailLogStatus;
	errorMessage: string | null;
	/** "email" | "autoresponder" | "emailit" | "whatsapp_cloud" | "twilio_whatsapp" | … (WP default "email"). */
	actionType: string;
	sentAt: IsoDateTime;
	transport: string | null;
	deliveries: MailDelivery[];
	dropped: MailDropped[];
	/** Set on rows written by `email-logs/resend`: the id of the original row (DV-33). */
	resendOf: string | null;
}

export type FileStatus = "pending" | "attached" | "retired" | "deleted";

/** `files`, id `f_<ulid>` (architecture §12). */
export interface FileRecord {
	id: string;
	formId: NumericId;
	submissionId: NumericId | null;
	field: string;
	status: FileStatus;
	storage: "r2" | "media" | "legacy";
	/** R2 object key, or the media key. */
	key: string;
	mediaId: string | null;
	storedName: string;
	originalName: string;
	type: string;
	size: number;
	sha256: string | null;
	private: boolean;
	uploader: "public" | "admin";
	createdAt: IsoDateTime;
	attachedAt: IsoDateTime | null;
}

/** Ledger statuses (spec 05 §2.1) plus Resend delivery event statuses. */
export type ActionLogStatus =
	| "processing"
	| "success"
	| "failed"
	| "skipped"
	| "unverified"
	| "uncertain"
	| "sent"
	| "delivered"
	| "delayed"
	| (string & {});

/**
 * `actionLogs` (WP `cf_action_logs`, spec 05 §2.3). Ledger rows have id `run:<runKey>` and `runKey` set; event rows
 * have id `alog_<ulid>` (or `wp-<id>` when imported) and `runKey` null, like WP.
 */
export interface ActionLogRecord {
	id: string;
	runKey: string | null;
	jobId: string | null;
	formId: NumericId | "0";
	submissionId: NumericId | "0";
	/** Includes WP pseudo-types (cf_form_success, resend_event, …). */
	actionType: string;
	actionId: string | null;
	status: ActionLogStatus;
	/** Ledger lease uuid while `processing`. */
	lease: string | null;
	message: string | null;
	meta: { steps?: Record<string, WpValue>; [key: string]: WpValue | undefined };
	createdAt: IsoDateTime;
	updatedAt: IsoDateTime;
}

/** `counters`, id = name (e.g. `blocked:<formId>:honeypot_filled`, `capacity:<formId>`). */
export interface CounterRecord {
	name: string;
	formId: NumericId | null;
	n: number;
}

/** `uniques`, id `<ns>:<value>` (D-013). */
export interface UniqueClaimRecord {
	ns: string;
	ref: string;
	createdAt: IsoDateTime;
}

/** `ephemeral`, id = key (D-014). `exp` is epoch ms; `n` the sliding counter; `v` the stored value. */
export interface EphemeralRecord {
	exp: number;
	n: number;
	v: WpValue;
}
