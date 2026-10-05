import { defineConfig } from "vitest/config";

/**
 * Unit, parity, contract and budget tests. DOM tests opt in per file with
 * `// @vitest-environment happy-dom`. E2E specs run under Playwright (`pnpm e2e`).
 */
export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
		exclude: ["**/node_modules/**", "e2e/**", "dist/**"],
		environment: "node",
		testTimeout: 20_000,
	},
});
