/**
 * Payments and commerce (architecture §5.7). Phase 4 contracts, declared now so storage is created early
 * (D-016). P4.0 completes this file: it writes the remaining record types (orderItems, activations, packages,
 * subscriptions, downloads, commerceEvents, customerSessions, fulfillment, reversals, paymentEvents) field for
 * field from spec 06 §3.2, and refines `PaymentsConfigView` and `GatewayContext`.
 */
import type { HttpClient, Logger } from "./ports.js";
import type { IsoDateTime, NumericId, WpValue } from "./primitives.js";

export type GatewayId = "stripe" | "paypal" | "razorpay" | "polar";
export type PaymentMode = "test" | "live";

export interface CheckoutInput {
	submissionId: NumericId;
	formId: NumericId | "0";
	amountMinor: number;
	/** ISO-4217 upper case. */
	currency: string;
	description: string;
	customerEmail?: string;
	returnUrls: { success: string; cancel: string };
	/** sha256("cf-<gateway>-<kind>-<sid>"). */
	idempotencyKey: string;
	mode: PaymentMode;
	polarProductId?: string;
}

export interface CheckoutSession {
	paymentId: string;
	redirectUrl: string;
}

export interface InlineIntent {
	paymentId: string;
	clientSecret: string;
	publishableKey: string;
	returnUrl: string;
}

export interface RawWebhookRequest {
	body: Uint8Array;
	text: string;
	headers: Headers;
	url: string;
	receivedAt: Date;
}

export interface VerifiedWebhook {
	provider: GatewayId;
	eventId: string;
	type: string;
	payload: WpValue;
}

export interface NormalizedPaymentEvent {
	provider: GatewayId;
	eventId: string;
	type: string;
	/** Matches submissions.paymentId. */
	paymentId: string;
	/** From metadata when available. */
	submissionId?: NumericId;
	status: "pending" | "paid" | "failed" | "refunded" | "partially_refunded";
	amountMinor?: number;
	refundedMinor?: number;
	currency?: string;
	/** PayPal CHECKOUT.ORDER.APPROVED. */
	needsCapture?: boolean;
}

/** Read-only view over the `payments` settings subtree. Refined by P4.0. */
export interface PaymentsConfigView {
	mode(): PaymentMode;
	/** Non-secret value at a path inside `payments`, e.g. "stripe.publishable_key_test". */
	get(path: string): WpValue | undefined;
	/** Decrypted secret at a path inside `payments`; "" when unset. */
	secret(path: string): Promise<string>;
	/** `currency_gateways` routing (first entry is the default gateway). */
	gatewaysFor(currency: string): GatewayId[];
}

/** What a gateway may use. Refined by P4.0. */
export interface GatewayContext {
	config: PaymentsConfigView;
	mode: PaymentMode;
	http: HttpClient;
	log: Logger;
	now(): Date;
}

export interface PaymentGateway {
	id: GatewayId;
	label: string;
	isConfigured(cfg: PaymentsConfigView, mode: PaymentMode): boolean;
	supportsInline: boolean;
	createCheckout(input: CheckoutInput, gx: GatewayContext): Promise<CheckoutSession>;
	createInlineIntent?(input: CheckoutInput, gx: GatewayContext): Promise<InlineIntent>;
	/** null ⇒ 401 invalid_signature; throw ⇒ 503 (provider retries). */
	verifyWebhook(req: RawWebhookRequest, gx: GatewayContext): Promise<VerifiedWebhook | null>;
	/** `{ ignored: true }` ⇒ 200 {received:true, ignored:true} (DV-07). */
	normalize(ev: VerifiedWebhook, gx: GatewayContext): Promise<NormalizedPaymentEvent | { ignored: true }>;
	capture?(
		paymentId: string,
		expected: { amountMinor: number; currency: string },
		gx: GatewayContext,
	): Promise<NormalizedPaymentEvent | null>;
}

export type ProductType = "plugin" | "theme" | "digital" | "service" | "event";

export interface ProductRecord {
	id: NumericId;
	n: number;
	slug: string;
	name: string;
	version: string;
	type: ProductType;
	activationLimit: number;
	status: "active" | "archived";
	description: string;
	/** Spec 06 §3.3. */
	details: Record<string, WpValue>;
	iconMediaId: string | null;
	galleryMediaIds: string[];
	/** WP "content connection" post ids, mapped. */
	checkoutFormId: NumericId | null;
	renewalFormId: NumericId | null;
	legacy?: { iconAttachmentId?: number; galleryIds?: number[]; checkoutPostId?: number; renewalPostId?: number };
	createdAt: IsoDateTime;
	updatedAt: IsoDateTime;
}

export interface PlanRecord {
	id: NumericId;
	n: number;
	productId: NumericId;
	slug: string;
	name: string;
	priceMinor: number;
	currency: string;
	billingPeriod: "day" | "week" | "month" | "year" | "lifetime";
	billingInterval: number;
	activationLimit: number;
	licenseDurationDays: number;
	trialDays: number;
	status: "active" | "archived";
	checkoutUrl: string | null;
	createdAt: IsoDateTime;
	updatedAt: IsoDateTime;
}

export interface OrderRecord {
	id: NumericId;
	n: number;
	orderNumber: string;
	sourceKey: string;
	submissionId: NumericId | null;
	formId: NumericId | null;
	customerId: string | null;
	legacyUserId: number | null;
	customerEmail: string;
	customerEmailKey: string;
	customerName: string;
	status: "paid" | "refunded" | "pending" | "failed";
	currency: string;
	subtotalMinor: number;
	totalMinor: number;
	refundedMinor: number;
	paymentProvider: string | null;
	paymentId: string | null;
	createdAt: IsoDateTime;
	paidAt: IsoDateTime | null;
}

export interface LicenseRecord {
	id: NumericId;
	n: number;
	productId: NumericId;
	submissionId: NumericId | null;
	orderItemId: NumericId | null;
	/** Plaintext, byte-exact, case-sensitive (spec 06 §5.4). */
	licenseKey: string;
	customerEmail: string;
	customerEmailKey: string;
	customerId: string | null;
	legacyUserId: number | null;
	status: "active" | "disabled" | "expired";
	activationLimit: number;
	/** Maintained with updateIf guards (D-152). */
	activeSites: number;
	/** null = lifetime. */
	expiresAt: IsoDateTime | null;
	createdAt: IsoDateTime;
	updatedAt: IsoDateTime;
}

export interface CustomerRecord {
	/** "cus_<ulid>". */
	id: string;
	email: string;
	emailKey: string;
	firstName: string;
	lastName: string;
	displayName: string;
	billing: {
		phone?: string;
		company?: string;
		taxId?: string;
		address1?: string;
		address2?: string;
		city?: string;
		state?: string;
		postcode?: string;
		country?: string;
	};
	siteUrl: string | null;
	legacyWpUserId: number | null;
	createdAt: IsoDateTime;
	updatedAt: IsoDateTime;
}

/**
 * Placeholder for the commerce records P4.0 writes out in full (WP `cf_license_*`, `cf_fulfillment`,
 * `cf_payment_reversals` columns in camelCase, plus `n` and `emailKey` where WP compares LOWER(TRIM(email))).
 * Only the fields that `collections.ts` indexes are typed here.
 */
export interface CommerceRowBase {
	id: string;
	[key: string]: WpValue | undefined;
}
