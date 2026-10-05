/**
 * Server-side render routes (P1.6 wiring of the P1.5 pipeline; spec 01 §3; architecture §9.1; D-007, DV-50).
 * Internal: reached only through `locals.emdash.handlePluginApiRoute` from `<CoreForm>`, the HTML expander and the
 * companion's standalone page.
 */
import type { NumericId } from "../primitives.js";
import type { AssetManifest, FormBlockAttributes, RenderPage } from "../render.js";
import { defineRouteSpecs, type RouteContract } from "./contract.js";

export interface RenderInput {
	ref: { id?: NumericId; slug?: string };
	page: RenderPage;
	/** PT block attributes; when present the block wrapper is rendered (spec 01 §3.1.1). */
	block?: FormBlockAttributes;
	/** `?cf_response=` PRG token from the page URL (spec 01 §3.7). */
	responseToken?: string;
	/** The page's EmDash user (`Astro.locals.user`). A signed 2-hour token is embedded for login-required forms (DV-50). */
	auth?: { user: { id: string; email: string; role: number } | null };
}

export interface RenderOutput {
	status: 200 | 404;
	html: string;
	manifest: AssetManifest | null;
	form: { id: NumericId; slug: string; title: string } | null;
	/** True when the HTML embeds user-specific data (DV-50): the page must be served `private`. */
	private: boolean;
}

export interface StandaloneInput {
	slug: string;
	/** The page query (prefill, `cf_response`, legacy `cf-form`). */
	query: Record<string, string>;
	/** True when reached through the legacy `?cf-form=` middleware (fullscreen forms render even when not standalone). */
	legacy?: boolean;
	auth?: { user: { id: string; email: string; role: number } | null };
}

/**
 * Standalone document model (spec 01 §3.14). The companion page applies the WP shell, the headers
 * (no-store, X-Robots-Tag, nosniff) and the optional `layout`.
 */
export interface StandaloneOutput {
	status: 200 | 404;
	html: string;
	manifest: AssetManifest | null;
	/** standalone_page_title || fullscreen_page_title || form title ("Form not found" on 404). */
	title: string;
	/** "index, follow" | "noindex, nofollow". */
	robots: string;
	canonical: string | null;
	fullscreen: boolean;
	/** https URLs from fullscreen_external_css / fullscreen_external_js (fullscreen only). */
	externalAssets: { css: string[]; js: string[] };
}

export interface RenderApi {
	"internal/render": RouteContract<RenderInput, RenderOutput>;
	"internal/standalone": RouteContract<StandaloneInput, StandaloneOutput>;
}

export const renderRoutes = defineRouteSpecs<RenderApi>()({
	"internal/render": {
		kind: "internal",
		phase: 1,
		owner: "P1.6",
		module: "render",
		summary: "Render a live form (Form::get_html) with its asset manifest for <CoreForm> and the HTML expander.",
		spec: "01 §3; architecture §9.1; D-007, D-061, DV-16, DV-50",
	},
	"internal/standalone": {
		kind: "internal",
		phase: 1,
		owner: "P1.6",
		module: "render",
		summary: "Standalone form document model for /<standaloneBase>/<slug>/ and ?cf-form=.",
		spec: "01 §3.14; D-052, DV-51",
	},
});
