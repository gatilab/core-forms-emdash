/**
 * Mail transport (architecture §5.6, §11). Normative.
 */
import type { CfContext } from "./ports.js";
import type { NumericId } from "./primitives.js";

export interface MailAddress {
	email: string;
	name?: string;
}

export interface MailAttachment {
	filename: string;
	contentType: string;
	content: Uint8Array;
}

export interface MailMessage {
	/** WP: comma list, every address a To recipient. */
	to: MailAddress[];
	cc?: MailAddress[];
	bcc?: MailAddress[];
	/** Honoured only by transports with capabilities.from. */
	from?: MailAddress;
	replyTo?: MailAddress[];
	subject: string;
	/** Required by EmDash. */
	text: string;
	html?: string;
	headers?: Record<string, string>;
	attachments?: MailAttachment[];
	idempotencyKey?: string;
	meta: { formId?: NumericId; submissionId?: NumericId; actionType: string; runKey?: string };
}

export interface TransportCapabilities {
	from: boolean;
	cc: boolean;
	bcc: boolean;
	multipleTo: boolean;
	attachments: boolean;
	headers: boolean;
	idempotency: boolean;
}

export type TransportMessage = Omit<MailMessage, "meta">;

export interface TransportSendResult {
	ok: boolean;
	providerMessageId?: string;
	error?: string;
	retryable?: boolean;
	retryAfterS?: number;
}

export interface MailTransport {
	id: "emdash" | "resend" | "emailit" | (string & {});
	label: string;
	capabilities: TransportCapabilities;
	isAvailable(cx: CfContext): Promise<true | string>;
	/** One provider call. The Mailer plans splits; transports never see a message they can't express. */
	send(m: TransportMessage, cx: CfContext): Promise<TransportSendResult>;
}

export type MailDropped = "from" | "headers" | "attachments";

export interface MailDelivery {
	to: string[];
	cc: string[];
	ok: boolean;
	providerMessageId?: string;
	error?: string;
}

export interface MailResult {
	/** Every planned send succeeded. */
	ok: boolean;
	deliveries: MailDelivery[];
	dropped: MailDropped[];
	/** emailLogs row. */
	logId: string;
	transport: string;
}

export interface Mailer {
	send(m: MailMessage, opts?: { log?: boolean }): Promise<MailResult>;
}
