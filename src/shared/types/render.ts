/**
 * Rendering contracts (architecture §9.1, §13; spec 01 §3; spec 02 §1).
 */
import type { NumericId } from "./primitives.js";

export type CaptchaProvider = "recaptcha" | "turnstile" | "hcaptcha";

/**
 * What a rendered form needs on the page. The first block is WP `AssetRequirements::for_form` with its exact keys
 * and order (spec 01 §3.12), which is also the shape the `assetRequirements` extension filter receives. The rest
 * is what WP enqueues elsewhere (captcha from `cf_form_html`, stylesheet/theme tri-states) plus port additions.
 * `<FormAssets>` maps a union of manifests to bundles (architecture §13.1).
 */
export interface AssetManifest {
	core: true;
	accessibility: true;
	/** Per-form `analytics_enabled` tri-state, else global `enable_analytics`; then `shouldTrackAnalytics`. */
	analytics: boolean;
	/** has_schema || smart_feature. */
	smart_script: boolean;
	/** smart_feature || resize || scheduled. */
	smart_style: boolean;
	/** display_mode === "fullscreen". */
	fullscreen: boolean;
	/** payment_enabled && provider === "stripe" && payment_flow === "inline". */
	inline_payment: boolean;
	multi_step: boolean;
	save_resume: boolean;
	partial_entries: boolean;
	calculations: boolean;
	counters: boolean;
	resize: boolean;
	scheduled: boolean;
	// ---- beyond for_form ----
	/** CAPTCHA widgets this form renders (provider script + our client). */
	captcha: { provider: CaptchaProvider; siteKey: string }[];
	/** forms.css (`load_stylesheet` tri-state over the global). */
	stylesheet: boolean;
	/** form-theme.css + the inline customizer CSS (`load_form_theme` tri-state over the global). */
	theme: boolean;
	/** upload.js: the form has file inputs and the companion is installed. */
	upload: boolean;
	/** poll.js + poll-frontend.css. */
	poll: boolean;
	/** Extra script URLs from custom field types (`CustomFieldType.script`). */
	scripts: string[];
}

/** Bundle and stylesheet URLs resolved from a manifest (for previews and the standalone document). */
export interface AssetUrls {
	css: string[];
	js: string[];
	/** Inline <script>/<style> bodies (globals such as cf_js_vars, the theme CSS). */
	inline: string[];
}

/** Page context a render needs (architecture §8.2 internal/render). */
export interface RenderPage {
	url: string;
	path: string;
	/** Per-request key used to count instances of a form on one page (DV-16). */
	instanceKey: string;
}

/** WP block attributes of the `core-form` / legacy `form` Portable Text blocks (spec 01 §3.1.1). */
export interface FormBlockAttributes {
	formId?: string;
	slug?: string;
	showTitle?: boolean;
	titleLevel?: number;
	loadTheme?: "" | "1" | "0";
	loadStylesheet?: "" | "1" | "0";
	alignment?: string;
	maxWidth?: string;
	anchorId?: string;
	className?: string;
}

/** Output of the render pipeline (`Form::get_html()` + manifest). */
export interface RenderedForm {
	html: string;
	manifest: AssetManifest;
	form: { id: NumericId; slug: string; title: string };
}
