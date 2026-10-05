// @ts-check
/**
 * Lint configuration. The import-boundary rule (scripts/import-boundaries.mjs) enforces the
 * layer matrix of docs/port/10-architecture.md §4; tests/contracts/boundaries.test.ts proves that a
 * deliberate bad import fails.
 */
import js from "@eslint/js";
import tseslint from "typescript-eslint";

import { boundariesPlugin, RESTRICTED_GLOBALS } from "./scripts/import-boundaries.mjs";

const restrictGlobals = (/** @type {string[]} */ names, /** @type {string} */ why) =>
	names.map((name) => ({ name, message: `${name} is not available here: ${why}` }));

export default tseslint.config(
	{
		ignores: [
			"node_modules/",
			"dist/",
			"coverage/",
			".astro/",
			"**/.astro/",
			"e2e/site/.astro/",
			"tests/golden/",
			"tools/wp-oracle/cache/",
			"tools/wp-oracle/.cache/",
			".reference/",
		],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["**/*.{ts,tsx,mts,cts,js,mjs,cjs}"],
		plugins: { "core-forms": boundariesPlugin },
		languageOptions: { ecmaVersion: 2023, sourceType: "module" },
		rules: {
			"core-forms/import-boundaries": "error",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ args: "none", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true },
			],
			"@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
			"@typescript-eslint/no-explicit-any": "error",
			"no-console": ["error", { allow: ["warn", "error"] }],
			eqeqeq: ["error", "smart"],
		},
	},
	{
		// Node tooling: scripts, tests, oracle, e2e.
		files: ["scripts/**", "tests/**", "tools/**", "e2e/**", "bin/**", "*.config.{js,ts,mjs}"],
		languageOptions: {
			globals: { process: "readonly", console: "readonly", URL: "readonly", Buffer: "readonly" },
		},
		rules: { "no-console": "off" },
	},
	{
		// Pure layers: no DOM, no Node globals.
		files: ["src/shared/**", "src/core/**"],
		rules: {
			"no-restricted-globals": [
				"error",
				...restrictGlobals(RESTRICTED_GLOBALS.dom, "shared/ and core/ are pure (architecture §4)."),
				...restrictGlobals(RESTRICTED_GLOBALS.node, "shared/ and core/ run on Workers and in browsers."),
			],
		},
	},
	{
		// Workers server code (platform/ may use bindings, but still no Node globals).
		files: ["src/server/**"],
		rules: {
			"no-restricted-globals": [
				"error",
				...restrictGlobals(RESTRICTED_GLOBALS.dom, "server code runs in a Workers isolate."),
				...restrictGlobals(RESTRICTED_GLOBALS.node, "server code runs in a Workers isolate; use src/server/platform for env."),
			],
		},
	},
	{
		// Browser bundles: no Node globals.
		files: ["src/client/**"],
		rules: {
			"no-restricted-globals": [
				"error",
				...restrictGlobals(RESTRICTED_GLOBALS.node, "client bundles run in the browser."),
			],
		},
	},
);
