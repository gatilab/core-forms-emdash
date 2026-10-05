/**
 * Ports: the services core modules receive (architecture §4 "Ports", §5.8). The server builds one `CfContext`
 * per request or job (src/server/context.ts, P1.0b); tests build the same thing from tests/harness.
 *
 * Implementations (12-plan.md): P1.0b provides the context, ids, ephemeral, locks, uniques, counters, settings,
 * secrets, theme store, events, extensions, http, jobs and the SubmissionRepo; P1.7 the FormRepo; P1.10 the
 * FileStore/FileReader; P1.11 the Mailer; P1.19a the ReplyStore.
 */
import type { ActionConfig, ActionModule, ActionOutcome } from "./actions.js";
import type { CoreFormsEventListener, CoreFormsExtension, CoreFormsFilters, FormValidator } from "./extensions.js";
import type { DefinitionSnapshot, FormRecord, FormRef, FormStatus, ResolvedForm, WpFormSettings } from "./forms.js";
import type { JobQueue } from "./jobs.js";
import type { Mailer } from "./mail.js";
import type { CoreFormsSiteOptions } from "./options.js";
import type { IsoDateTime, NumericId, SealedSecret, WpValue } from "./primitives.js";
import type { FileRecord, ReplyRecord } from "./records.js";
import type { RequestMeta } from "./request.js";
import type { CustomFieldType, FormSchemaJson } from "./schema.js";
import type { Page, PageQuery } from "./storage.js";
import type {
	EphemeralSubmission,
	FileDescriptor,
	PaymentStatus,
	SubmissionBucket,
	SubmissionRecord,
	SubmissionStatus,
	WriteContext,
} from "./submissions.js";
import type { FormTemplate } from "./templates.js";

export type { CoreFormsEvents, EventBus } from "./events.js";
import type { CoreFormsEvents, EventBus } from "./events.js";

// ---------------------------------------------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------------------------------------------

/** The authenticated EmDash user of a private route or admin job (role: SUBSCRIBER 10 … ADMIN 50). */
export interface CfUser {
	id: string;
	email: string;
	role: number;
}

export interface CfSite {
	name: string;
	url: string;
	adminEmail: string;
	locale: string;
	/** The companion options passed to `coreForms({ site })`; null without the companion (D-005). */
	companion: CoreFormsSiteOptions | null;
}

export interface CfContext {
	now(): Date;
	/** next(entity) → NumericId; ulid(prefix?). */
	ids: IdService;
	forms: FormRepo;
	submissions: SubmissionRepo;
	files: FileStore;
	jobs: JobQueue;
	mail: Mailer;
	ephemeral: EphemeralStore;
	locks: LockService;
	uniques: UniqueIndex;
	counters: CounterStore;
	settings: GlobalSettingsView;
	secrets: SecretService;
	theme: ThemeStore;
	events: EventBus;
	extensions: ExtensionRegistry;
	/** ctx.http + timeouts + SSRF pre-check. */
	http: HttpClient;
	site: CfSite;
	request?: RequestMeta;
	user?: CfUser | null;
	log: Logger;
	/** after() with a budget tracker. */
	afterResponse(fn: () => Promise<void>): void;
}

// ---------------------------------------------------------------------------------------------------------------
// Primitives (P1.0b)
// ---------------------------------------------------------------------------------------------------------------

export type IdEntity =
	| "form"
	| "submission"
	| "poll"
	| "product"
	| "plan"
	| "order"
	| "orderItem"
	| "license"
	| "activation"
	| "package"
	| "subscription"
	| "download"
	| "commerceEvent";

/** Monotonic numeric ids from the KV sequence `seq:<entity>` (D-010). */
export interface IdService {
	next(entity: IdEntity): Promise<NumericId>;
	/** After imports: make sure the next id is greater than `n`. */
	ensureAtLeast(entity: IdEntity, n: number): Promise<void>;
	/** "<prefix>_<ulid>" or a bare ulid. */
	ulid(prefix?: string): string;
}

/** TTL data in the `ephemeral` collection (D-014, architecture §6.4). */
export interface EphemeralStore {
	get<T extends WpValue>(key: string): Promise<{ value: T; exp: number } | null>;
	/** Create-only; false if a live entry exists. */
	add(key: string, value: WpValue, ttlMs: number): Promise<boolean>;
	set(key: string, value: WpValue, ttlMs: number): Promise<void>;
	/** Sliding counter: count+1 and exp = now+ttl, atomically (updateIf + CAS create). */
	bump(key: string, ttlMs: number): Promise<number>;
	/** Current live count, 0 if absent/expired. */
	peek(key: string): Promise<number>;
	/** Read and delete (single use). */
	take<T extends WpValue>(key: string): Promise<T | null>;
	delete(key: string): Promise<void>;
}

/** Ephemeral leases. Throws `LockBusyError` (src/shared/errors.ts) when not acquired within `waitMs`. */
export interface LockService {
	withLock<T>(name: string, opts: { ttlMs: number; waitMs: number }, fn: () => Promise<T>): Promise<T>;
}

/** Deterministic claim documents in `uniques` (D-013). */
export interface UniqueIndex {
	claim(ns: string, value: string, ref: string): Promise<{ ok: true } | { ok: false; ref: string }>;
	release(ns: string, value: string, ref: string): Promise<void>;
	lookup(ns: string, value: string): Promise<string | null>;
}

/** Named counters in `counters` (blocked reasons, unsaved capacity; D-123). */
export interface CounterStore {
	/** Atomic `updateIf` delta; creates the row on first use. Returns the new value. */
	add(name: string, delta: number, formId?: NumericId | null): Promise<number>;
	get(name: string): Promise<number>;
	set(name: string, n: number, formId?: NumericId | null): Promise<void>;
	/** Every counter of one form (e.g. `blocked:<formId>:*` for exports). */
	listForForm(formId: NumericId): Promise<{ name: string; n: number }[]>;
}

/** Global settings: WP cf_settings shape + `emdash` extension subtree (architecture §7.1). Read once per request. */
export interface GlobalSettingsView {
	/** Secrets appear as SealedSecret. */
	raw(): Readonly<Record<string, WpValue>>;
	/** "google_recaptcha.site_key", "emdash.timezone". */
	get(path: string): WpValue | undefined;
	flag(path: string): boolean;
	str(path: string): string;
	/** Decrypts; "" when unset. */
	secret(path: string): Promise<string>;
	timezone(): string;
	dateFormat(): string;
	timeFormat(): string;
}

/** Secret sealing (D-030) and the plugin HMAC key (D-033). */
export interface SecretService {
	/** True when EMDASH_ENCRYPTION_KEY is configured; otherwise secrets are stored "plain:" (admin warns). */
	readonly encrypted: boolean;
	seal(plain: string): Promise<SealedSecret>;
	/** Plaintext of a sealed leaf; plain strings pass through; "" when unset. */
	open(value: WpValue | SealedSecret | undefined): Promise<string>;
	isSealed(value: unknown): value is SealedSecret;
	/** CORE_FORMS_SECRET, or the generated key sealed in `state:secret:hmac`. */
	hmacKey(): Promise<Uint8Array>;
	/** base64url(HMAC-SHA256(hmacKey, data)). */
	sign(data: string): Promise<string>;
	/** Constant-time check of `sign(data)`. */
	verify(data: string, signature: string): Promise<boolean>;
}

/** `cfg:theme-tokens` (raw WP option, overrides only) and the generated `cfg:theme-css` (architecture §7.3). */
export interface ThemeStore {
	get(): Promise<{ tokens: Record<string, string>; css: { css: string; hash16: string } | null }>;
	/** Stores sanitized tokens together with the CSS generated from them (P1.5 generator). */
	put(tokens: Record<string, string>, css: { css: string; hash16: string }): Promise<void>;
}

/** Isolate-global extension registry (architecture §15). */
export interface ExtensionRegistry {
	list(): readonly CoreFormsExtension[];
	fieldTypes(): readonly CustomFieldType[];
	actions(): readonly ActionModule[];
	/** Sorted by priority, then registration order. */
	validators(): readonly FormValidator[];
	templates(): readonly FormTemplate[];
	listeners<E extends keyof CoreFormsEvents>(event: E): readonly CoreFormsEventListener<E>[];
	/**
	 * Run one filter chain synchronously. A throwing filter is logged and skipped (its input passes on).
	 */
	applyFilter<F extends keyof CoreFormsFilters>(
		name: F,
		...args: Parameters<CoreFormsFilters[F]>
	): ReturnType<CoreFormsFilters[F]>;
}

export interface HttpRequestInit extends RequestInit {
	timeoutMs: number;
	redirect?: "follow" | "manual";
	maxResponseBytes?: number;
	/**
	 * Apply WP's pre-checks (scheme, localhost, IP literals; `allowUserinfo` for n8n) before EmDash's own SSRF
	 * check, so blocked URLs fail with WP-identical results. Default true.
	 */
	wpPreChecks?: boolean | { allowUserinfo?: boolean };
}

/** Outbound HTTP only through here (architecture §16.4). */
export interface HttpClient {
	fetch(url: string, init: HttpRequestInit): Promise<Response>;
	/** The WP pre-check alone: `{ ok: false, reason }` uses WP's error text. */
	precheck(url: string, opts?: { allowUserinfo?: boolean }): { ok: true } | { ok: false; reason: string };
}

export interface Logger {
	debug(message: string, data?: Record<string, unknown>): void;
	info(message: string, data?: Record<string, unknown>): void;
	warn(message: string, data?: Record<string, unknown>): void;
	error(message: string, data?: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------------------------------------------

/** Who performed a write (null for public requests and system jobs). */
export type Actor = { userId: string } | null;

export interface NewFormInput {
	title: string;
	slug?: string;
	status?: FormStatus;
	markup: string;
	settings?: WpFormSettings;
	messages?: Record<string, string>;
	schema?: FormSchemaJson | null;
	meta?: Record<string, WpValue>;
	/** Keep a WP id (imports). Omit to take the next sequence value. */
	id?: NumericId;
}

export type FormPatch = Partial<Pick<FormRecord, "title" | "slug" | "status" | "markup" | "settings" | "messages" | "schema" | "meta">>;

export interface BulkResult {
	done: NumericId[];
	refused: { id: NumericId; reason: string }[];
}

/**
 * Form persistence and resolution (P1.7; spec 01 §3.2, §3.16; D-061, D-062). Fingerprint-guarded writes throw
 * CoreFormsError "cf_edit_conflict" / "cf_version_required" (409); slug clashes "cf_slug_conflict" (409).
 */
export interface FormRepo {
	get(id: NumericId): Promise<FormRecord | null>;
	/** ≤ 50 ids per call. */
	getMany(ids: readonly NumericId[]): Promise<FormRecord[]>;
	bySlug(slug: string): Promise<FormRecord | null>;
	byPublicSlug(publicSlug: string): Promise<FormRecord | null>;
	/**
	 * Resolve for render/submit/preview. By slug: publish + live-slug fallback; by id: any status except trashed.
	 * Public paths must pass "live" (D-061); "draft" and revisions are for admin preview and rehearsal.
	 */
	resolve(ref: FormRef, source?: "live" | "draft" | { revisionId: string }): Promise<ResolvedForm | null>;
	/** Raw pages by index (id order); views and sorting are route concerns. */
	list(query: { trashed: boolean; cursor?: string; limit?: number }): Promise<Page<FormRecord>>;
	create(input: NewFormInput, actor: Actor): Promise<FormRecord>;
	update(
		id: NumericId,
		patch: FormPatch,
		guard: { fingerprint: string | undefined },
		actor: Actor,
	): Promise<{ form: FormRecord; fingerprint: string }>;
	/** Opaque "v<version>.<hash>" (D-062). */
	fingerprint(form: FormRecord): Promise<string>;
	/** Snapshot of the draft definition (spec 01 §3.16). */
	snapshot(form: FormRecord): DefinitionSnapshot;
	trash(ids: readonly NumericId[], actor: Actor): Promise<BulkResult>;
	restore(ids: readonly NumericId[], actor: Actor): Promise<BulkResult>;
	/** Permanent delete; submissions are kept (WP). */
	deletePermanently(ids: readonly NumericId[], actor: Actor): Promise<BulkResult>;
	/** Import upsert keyed by WP id; every meta key kept (P1.20). */
	importRecord(record: FormRecord, policy: "create" | "update" | "skip"): Promise<"created" | "updated" | "skipped">;
}

/** Indexed submission fields usable in `where`/`orderBy` (architecture §6.2). */
export type SubmissionIndexFields = {
	formId: NumericId | "0";
	bucket: SubmissionBucket;
	isSpam: boolean;
	status: SubmissionStatus;
	submittedAt: IsoDateTime;
	modifiedAt: IsoDateTime;
	draftToken: string;
	paymentProvider: string;
	paymentId: string;
	emailKey: string;
};

export type NewSubmission = Omit<SubmissionRecord, "id" | "n" | "bucket" | "emailKey"> & {
	/** Keep a WP id (imports); omit to take `ids.next("submission")`. */
	id?: NumericId;
};

export type SubmissionPatch = Partial<
	Pick<
		SubmissionRecord,
		| "data"
		| "status"
		| "isSpam"
		| "draftToken"
		| "currentStep"
		| "paymentStatus"
		| "paymentProvider"
		| "paymentId"
		| "paymentAmount"
		| "paymentCurrency"
		| "paymentRefundedMinor"
		| "modifiedAt"
		| "userAgent"
		| "ipAddress"
		| "refererUrl"
	>
>;

/**
 * Submission storage (P1.0b). Every write derives `bucket` and `emailKey` and emits `submission.written`
 * (and `submission.inserted` on insert). No multi-row transactions: callers compose single-row guarded writes.
 */
export interface SubmissionRepo {
	get(id: NumericId): Promise<SubmissionRecord | null>;
	/** ≤ 50 ids per call. */
	getMany(ids: readonly NumericId[]): Promise<SubmissionRecord[]>;
	/** Create-only put. */
	insert(input: NewSubmission, context: WriteContext): Promise<SubmissionRecord>;
	/**
	 * Single-row patch, optionally guarded (`updateIf`). Returns null when the row is missing or the guard failed.
	 * `paymentStatusNotIn` implements the paid guard of D-145.
	 */
	update(
		id: NumericId,
		patch: SubmissionPatch,
		opts: {
			context: WriteContext;
			where?: Partial<Pick<SubmissionRecord, "status" | "isSpam" | "draftToken" | "paymentStatus">>;
			paymentStatusNotIn?: readonly (PaymentStatus | null)[];
		},
	): Promise<SubmissionRecord | null>;
	query(query: PageQuery<SubmissionIndexFields>): Promise<Page<SubmissionRecord>>;
	count(where: PageQuery<SubmissionIndexFields>["where"]): Promise<number>;
	byDraftToken(token: string): Promise<SubmissionRecord | null>;
	byPayment(provider: string, paymentId: string): Promise<SubmissionRecord | null>;
	/** Deletes the row only; cascades belong to the `erase` job (DV-78). */
	deleteRow(id: NumericId): Promise<boolean>;
}

export interface StoredObject {
	body: ReadableStream<Uint8Array>;
	size: number;
	contentType: string;
	metadata: Record<string, string>;
}

/** Input to register a pre-uploaded or in-request file (spec 03 §3.1, architecture §12). */
export interface RegisterFileInput {
	formId: NumericId;
	field: string;
	key: string;
	storage: FileRecord["storage"];
	mediaId?: string | null;
	storedName: string;
	originalName: string;
	type: string;
	size: number;
	sha256: string | null;
	uploader: FileRecord["uploader"];
}

/**
 * Private file storage (P1.10): R2 bucket `CORE_FORMS_PRIVATE`, or the public media fallback (D-110, D-112),
 * plus the `files` rows. Ownership is verified (row + object metadata) before any delete.
 */
export interface FileStore {
	/** "r2" when the private bucket is bound, else "media" (public by URL; admin shows a banner). */
	mode(): "r2" | "media";
	putObject(
		key: string,
		body: ReadableStream<Uint8Array> | Uint8Array,
		opts: { contentType: string; metadata: Record<string, string>; size?: number },
	): Promise<{ key: string; size: number }>;
	getObject(key: string): Promise<StoredObject | null>;
	/** Creates a `pending` row. */
	register(input: RegisterFileInput): Promise<FileRecord>;
	get(fileId: string): Promise<FileRecord | null>;
	listForSubmission(submissionId: NumericId): Promise<FileRecord[]>;
	/** Pending → attached; returns the public descriptors (DV-27) in input order. */
	attach(fileIds: readonly string[], to: { formId: NumericId; submissionId: NumericId; field: string }): Promise<FileDescriptor[]>;
	/** Retention: keep the row, delete the object, mark `retired`. */
	retire(fileId: string): Promise<boolean>;
	/** Erase: verify ownership, delete the object, mark `deleted`. */
	remove(fileId: string, expected: { submissionId: NumericId | null }): Promise<boolean>;
	descriptor(file: FileRecord): FileDescriptor;
}

/** Read access to stored submission files for actions (e.g. Zendesk attachments). */
export interface FileReader {
	read(
		descriptor: FileDescriptor,
		opts?: { maxBytes?: number },
	): Promise<{ bytes: Uint8Array; contentType: string; filename: string } | null>;
}

export type NewReply = Omit<ReplyRecord, "id"> & { id?: string };

/** Reply threads (P1.19a; spec 04 §2.8). Provider messages use deterministic ids, so adds dedupe. */
export interface ReplyStore {
	list(submissionId: NumericId): Promise<ReplyRecord[]>;
	/** Create-only; returns the existing row when the deterministic id already exists. */
	add(reply: NewReply): Promise<ReplyRecord>;
	byProviderMessage(provider: string, providerMessageId: string): Promise<ReplyRecord | null>;
}

// Re-exported for implementers that only import ports.
export type { ActionConfig, ActionOutcome, EphemeralSubmission };
