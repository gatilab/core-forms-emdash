/**
 * Global settings document `cfg:settings` (architecture §7.1; spec 01 §1.5, spec 04 §3.2). The top level is the WP
 * `cf_settings` option verbatim (unknown keys preserved); EmDash-only keys live under `emdash`. Secret leaves are
 * SealedSecret at rest and SECRET_MASK in admin responses.
 */
import type { GatewayId } from "./commerce.js";
import type { SealedSecret, WpValue } from "./primitives.js";

/** A secret leaf: sealed at rest, plaintext only inside the server, the mask in admin responses. */
export type SecretLeaf = string | SealedSecret;

export interface EmdashSettings {
	/** Imported from WP timezone_string/gmt_offset (D-018). Default "UTC". */
	timezone?: string;
	/** Default "F j, Y". */
	date_format?: string;
	/** Default "g:i a". */
	time_format?: string;
	/** Default true (D-085). */
	store_ip?: boolean;
	mail?: {
		transport?: "emdash" | "resend" | "emailit" | (string & {});
		from_email?: string;
		from_name?: string;
		resend_api_key?: SecretLeaf;
	};
	hcaptcha?: { site_key?: string; secret_key?: SecretLeaf };
	akismet?: { api_key?: SecretLeaf };
	/** Default 0.5 (D-080). */
	recaptcha_min_score?: number;
	analytics?: { raw_retention_days?: number; retention_days?: number };
	/** Default 90; 0 keeps forever (DV-34). */
	action_log_retention_days?: number;
	access?: { default?: "admins" | (string & {}) };
	[key: string]: WpValue | SealedSecret | undefined | object;
}

export interface PaymentsSettings {
	mode?: "test" | "live";
	/** Default {USD: ["stripe","paypal","polar"], INR: ["razorpay"]}; first entry = default gateway. */
	currency_gateways?: Record<string, GatewayId[]>;
	stripe?: Record<string, SecretLeaf>;
	paypal?: Record<string, SecretLeaf>;
	razorpay?: Record<string, SecretLeaf>;
	polar?: Record<string, SecretLeaf>;
	[key: string]: WpValue | SealedSecret | undefined | object;
}

export interface GlobalSettingsDocument {
	enable_nonce?: 0 | 1;
	enable_analytics?: 0 | 1;
	load_stylesheet?: 0 | 1;
	load_form_theme?: 0 | 1;
	delete_data_on_uninstall?: 0 | 1;
	/** Informational on EmDash: the base path is build-time (D-052, DV-51). */
	standalone_base_slug?: string;
	wrapper_tag?: "p" | "div" | "span";
	reply_from_email?: string;
	akismet_whitelist?: string;
	google_recaptcha?: { site_key?: string; secret_key?: SecretLeaf };
	cloudflare_turnstile?: { site_key?: string; secret_key?: SecretLeaf };
	emailit?: { api_key?: SecretLeaf };
	whatsapp_cloud?: { access_token?: SecretLeaf; phone_number_id?: string; business_account_id?: string };
	whatsapp_inbound?: { meta_verify_token?: SecretLeaf; meta_app_secret?: SecretLeaf; twilio_auth_token?: SecretLeaf };
	headless?: { api_key?: SecretLeaf; allowed_origins?: string };
	payments?: PaymentsSettings;
	/** Preserved when not posted (WP class-admin.php:283-337). */
	license_server?: { enabled?: 0 | 1 | boolean | string; support_url?: string; [key: string]: WpValue | undefined };
	emdash?: EmdashSettings;
	[key: string]: WpValue | SealedSecret | undefined | object;
}
