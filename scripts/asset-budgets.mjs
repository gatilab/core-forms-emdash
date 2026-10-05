/**
 * Browser asset catalogue and brotli budgets (docs/port/10-architecture.md §13, D-041, D-172).
 *
 * Sizes are bytes after brotli at quality 11 (1 KB = 1000 bytes, which is how the WP 4.11.1
 * reference sizes in spec 02 were measured: forms.min.js = 2,235 B br).
 *
 * Bundles: every `src/client/<dir>/<name>.entry.ts` becomes `dist/assets/<name>.js` (IIFE,
 * es2019, minified). A new entry must be added here first (contract change), otherwise
 * `pnpm build:assets` fails.
 *
 * Stylesheets: every `src/styles/<name>.css` becomes `dist/assets/<name>.css` (minified). Budgets
 * are the WP 4.11.1 `assets/css/<name>.min.css` brotli size + 3 % (architecture §13 "WP sizes ±3 %").
 */

/** @typedef {{ name: string; source: string; budget: number; flag: string; owner: string }} BundleBudget */
/** @typedef {{ name: string; source: string; budget: number; wpBrotli: number; owner: string }} StyleBudget */

/** @type {readonly BundleBudget[]} */
export const BUNDLES = [
	{ name: "core.js", source: "src/client/core/core.entry.ts", budget: 3400, flag: "always (a form renders)", owner: "P1.12" },
	{ name: "smart.js", source: "src/client/smart/smart.entry.ts", budget: 3600, flag: "smart_script", owner: "P1.13" },
	{ name: "fullscreen.js", source: "src/client/fullscreen/fullscreen.entry.ts", budget: 4400, flag: "fullscreen", owner: "P1.13" },
	{ name: "analytics.js", source: "src/client/analytics/analytics.entry.ts", budget: 700, flag: "analytics", owner: "P3.1" },
	{ name: "recaptcha.js", source: "src/client/captcha/recaptcha.entry.ts", budget: 700, flag: "recaptcha", owner: "P1.12" },
	{ name: "turnstile.js", source: "src/client/captcha/turnstile.entry.ts", budget: 700, flag: "turnstile", owner: "P1.12" },
	{ name: "hcaptcha.js", source: "src/client/captcha/hcaptcha.entry.ts", budget: 700, flag: "hcaptcha", owner: "P1.12" },
	{ name: "upload.js", source: "src/client/upload/upload.entry.ts", budget: 1000, flag: "upload (file inputs + companion)", owner: "P1.10" },
	{ name: "stripe-inline.js", source: "src/client/stripe/stripe-inline.entry.ts", budget: 900, flag: "inline_payment", owner: "P4.1" },
	{ name: "poll.js", source: "src/client/poll/poll.entry.ts", budget: 1300, flag: "poll", owner: "P1.15" },
	{ name: "portal.js", source: "src/client/portal/portal.entry.ts", budget: 800, flag: "portal pages", owner: "P4.4" },
	{ name: "embed.js", source: "src/client/embed/embed.entry.ts", budget: 1500, flag: "/wp-json/core-forms/v1/embed.js", owner: "P1.14" },
];

/** @type {readonly StyleBudget[]} */
export const STYLES = [
	{ name: "forms.css", source: "src/styles/forms.css", wpBrotli: 1436, budget: 1480, owner: "P1.12" },
	{ name: "form-theme.css", source: "src/styles/form-theme.css", wpBrotli: 1973, budget: 2033, owner: "P1.12" },
	{ name: "standalone.css", source: "src/styles/standalone.css", wpBrotli: 319, budget: 329, owner: "P1.12" },
	{ name: "smart-forms.css", source: "src/styles/smart-forms.css", wpBrotli: 637, budget: 657, owner: "P1.13" },
	{ name: "multi-step.css", source: "src/styles/multi-step.css", wpBrotli: 1224, budget: 1261, owner: "P1.13" },
	{ name: "fullscreen.css", source: "src/styles/fullscreen.css", wpBrotli: 2812, budget: 2897, owner: "P1.13" },
	{ name: "poll-frontend.css", source: "src/styles/poll-frontend.css", wpBrotli: 1791, budget: 1845, owner: "P1.15" },
	{ name: "license-frontend.css", source: "src/styles/license-frontend.css", wpBrotli: 3582, budget: 3690, owner: "P4.4" },
];

/**
 * Default embed: what a page with one plain form loads (architecture §13). WP 4.11.1 = 7,097 B br
 * (forms.min.js 2,235 + accessibility.min.js 852 + analytics.min.js 601 + forms.min.css 1,436 +
 * form-theme.min.css 1,973). The inline theme <style> is site-specific and not part of this sum.
 */
export const DEFAULT_EMBED = {
	files: ["core.js", "analytics.js", "forms.css", "form-theme.css"],
	budget: 7500,
};

export const BROTLI_QUALITY = 11;
export const MANIFEST_VERSION = 1;
