/**
 * Primitive value types (architecture §5.1). Normative.
 */

/** Decimal digits, no leading zero. WordPress-compatible numeric id stored as a string ("1058461"). */
export type NumericId = string;

/** UTC ISO-8601 with milliseconds: "2026-10-05T04:03:41.000Z". The only storage format for instants. */
export type IsoDateTime = string;

/** UTC "YYYY-MM-DD HH:mm:ss". Produced only at WP-compatible boundaries (tokens, exports, license API). */
export type WpDateTime = string;

export type WpScalar = string | number | boolean | null;

/** Any JSON value WordPress could have stored (settings, meta, schema, action configs). */
export type WpValue = WpScalar | WpValue[] | { [key: string]: WpValue };

/** A flag as WordPress stored it ("1", "0", 1, true, "", "on", …). Read with phpTruthy()/phpEmpty(). */
export type WpFlag = WpScalar | undefined;

/** Per-form override of a global: "" inherit, "1" on, "0" off. */
export type TriState = "" | "1" | "0";

/**
 * Sealed secret leaf (D-030). Plaintext never leaves the server except in opted-in exports (DV-58).
 * `$secret` is the AES-GCM envelope from `encryptPluginSetting`, or "plain:<v>" when the site has
 * no EMDASH_ENCRYPTION_KEY.
 *
 * Declared as a type alias (not an interface) so it nests inside `WpValue`.
 */
export type SealedSecret = { $secret: string };

/** The mask admin responses put in place of every secret leaf (architecture §7.1). */
export const SECRET_MASK = "••••••••";
