/**
 * @gatilab/emdash-core-forms
 *
 * Core Forms for EmDash: HTML-first forms. Write the fields as plain HTML;
 * the plugin adds the wrapper, spam protection (honeypot, rate limit,
 * duplicate check, Turnstile / reCAPTCHA / hCaptcha), AJAX submission with a
 * no-JavaScript fallback, a submissions inbox with CSV export, and email,
 * autoresponder and webhook actions. Ported from Core Forms for WordPress,
 * whose exports import directly.
 *
 * @example
 * ```js
 * // astro.config.mjs
 * import { coreForms } from "@gatilab/emdash-core-forms";
 * emdash({ plugins: [coreForms()] })
 * ```
 */
import { definePlugin } from "emdash";
import type { PluginDescriptor, PluginStorageConfig, ResolvedPlugin, RouteContext } from "emdash";

import { adminRoutes, renderRoute, submitRoute } from "./routes.js";

export const PLUGIN_ID = "core-forms";
export const PLUGIN_VERSION = "0.1.0";
export const PACKAGE_NAME = "@gatilab/emdash-core-forms";

export type CoreFormsOptions = Record<string, never>;

/** Descriptor factory for the `plugins` array of the emdash() integration. */
export function coreForms(options: CoreFormsOptions = {}): PluginDescriptor<CoreFormsOptions> {
	return {
		id: PLUGIN_ID,
		version: PLUGIN_VERSION,
		format: "native",
		entrypoint: PACKAGE_NAME,
		componentsEntry: `${PACKAGE_NAME}/astro`,
		adminEntry: `${PACKAGE_NAME}/admin`,
		options,
	};
}

export const STORAGE: PluginStorageConfig = {
	forms: {
		indexes: ["status", "updatedAt"],
		uniqueIndexes: ["slug"],
	},
	submissions: {
		indexes: ["formId", "status", "submittedAt", ["formId", "submittedAt"], ["status", "submittedAt"], ["formId", "status"]],
	},
};

const admin = (handler: (ctx: RouteContext<unknown>) => unknown) => ({
	request: { body: "json" as const },
	handler,
});

export function createPlugin(_options: CoreFormsOptions = {}): ResolvedPlugin {
	return definePlugin({
		id: PLUGIN_ID,
		version: PLUGIN_VERSION,
		// webhooks go to operator-supplied URLs; CAPTCHA checks to the provider
		capabilities: ["email:send", "network:request:unrestricted"],
		storage: STORAGE,
		routes: {
			submit: {
				public: true,
				methods: ["POST"],
				request: { body: "form-data", maxBytes: 1_000_000 },
				response: "raw",
				handler: submitRoute,
			},
			render: {
				public: true,
				methods: ["POST"],
				request: { body: "json" },
				handler: renderRoute,
			},
			...Object.fromEntries(Object.entries(adminRoutes).map(([name, fn]) => [name, admin(fn)])),
			"submissions/export": {
				request: { body: "json" },
				response: "raw",
				handler: adminRoutes["submissions/export"],
			},
		},
		admin: {
			entry: `${PACKAGE_NAME}/admin`,
			settingsSchema: {
				turnstileSiteKey: { type: "string", label: "Cloudflare Turnstile site key" },
				turnstileSecretKey: { type: "secret", label: "Cloudflare Turnstile secret key" },
				recaptchaSiteKey: { type: "string", label: "Google reCAPTCHA v3 site key" },
				recaptchaSecretKey: { type: "secret", label: "Google reCAPTCHA v3 secret key" },
				hcaptchaSiteKey: { type: "string", label: "hCaptcha site key" },
				hcaptchaSecretKey: { type: "secret", label: "hCaptcha secret key" },
				storeIp: {
					type: "boolean",
					label: "Store IP addresses with submissions",
					description: "Rate limiting works either way; this only controls what is saved.",
					default: true,
				},
			},
			pages: [
				{ path: "/", label: "Forms", icon: "list" },
				{ path: "/submissions", label: "Submissions", icon: "tray" },
			],
			widgets: [{ id: "recent-submissions", title: "Recent form submissions", size: "half" }],
			portableTextBlocks: [
				{
					type: "form",
					label: "Form",
					icon: "form",
					category: "Forms",
					description: "Embed a Core Forms form",
					fields: [
						{ type: "select", action_id: "formId", label: "Form", options: [], optionsRoute: "forms/options" },
					],
				},
			],
		},
	});
}

export default createPlugin;

export * from "./core/index.js";
