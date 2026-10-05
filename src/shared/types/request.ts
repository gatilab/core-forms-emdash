/**
 * Request-side shapes shared by the pipeline, validators and route adapters.
 */

/** Normalized request metadata (from EmDash `requestMeta`; IP from cf-connecting-ip, DV-77). */
export interface RequestMeta {
	ip: string | null;
	userAgent: string | null;
	referer: string | null;
	country: string | null;
	/** Full request URL. */
	url: string;
}

/**
 * One posted entry, in request order. Mirrors EmDash's `PluginFormData` entries so routes can pass them through
 * unchanged. WP `$_POST` semantics (D-026b) are applied by the pipeline, not here.
 */
export type FormEntry =
	| { name: string; kind: "text"; value: string }
	| { name: string; kind: "file"; filename: string; contentType: string; bytes: Uint8Array };
