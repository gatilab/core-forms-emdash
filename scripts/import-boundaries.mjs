/**
 * Import boundaries between runtime layers (docs/port/10-architecture.md §4).
 *
 * One matrix, used three ways:
 *   - the ESLint rule `core-forms/import-boundaries` (eslint.config.js) for .ts/.tsx/.mjs files
 *   - `checkImport()` in tests (tests/contracts/boundaries.test.ts), which also scans `.astro`
 *     frontmatter because ESLint does not parse Astro components
 *   - documentation: AGENTS.md links here as the source of truth
 *
 * Relative specifiers are resolved against the importing file, so `../../server/x.js` is judged
 * by where it lands, not by how it is spelled. Type-only imports (`import type`, inline
 * `type` specifiers, `export type … from`, `import("…").T` in types) are erased at build time
 * and are allowed wherever the matrix says "types".
 */
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PACKAGE_NAME = "@gatilab/emdash-core-forms";

const NODE_BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

/** Self-reference subpaths (package.json "exports") → repository paths. */
const SELF_EXPORTS = [
	["", "src/index.ts"],
	["runtime", "src/runtime.ts"],
	["astro", "src/astro/index.ts"],
	["admin", "src/admin/index.tsx"],
	["core", "src/core/index.ts"],
	["extend", "src/server/extensions/public.ts"],
	["site/", "src/site/"],
	["assets/", "dist/assets/"],
	["styles/form-theme.css", "dist/assets/form-theme.css"],
];

/**
 * Areas a file can belong to. Order matters: the first matching prefix wins.
 * `null` area = outside the layered source tree (tests, scripts, tools, e2e): unrestricted.
 */
const AREAS = [
	["src/shared/conditions/", "shared"],
	["src/shared/expr/", "shared"],
	["src/shared/types/", "shared"],
	["src/shared/", "shared"],
	["src/core/", "core"],
	["src/server/platform/", "server"],
	["src/server/", "server"],
	["src/astro/", "astro"],
	["src/site/", "site"],
	["src/client/", "client"],
	["src/admin/", "admin"],
	["src/index.ts", "entry"],
	["src/runtime.ts", "runtime"],
	["dist/assets/", "assets"],
];

/** Repository path (posix, relative to ROOT) → layer name, or null. */
export function layerOf(repoPath) {
	for (const [prefix, layer] of AREAS) if (repoPath === prefix || repoPath.startsWith(prefix)) return layer;
	return null;
}

const ADMIN_PURE_CORE = ["src/core/schema/", "src/core/html/", "src/core/io/", "src/core/templates/"];
const CLIENT_SHARED = ["src/shared/conditions/", "src/shared/expr/"];

/**
 * Which repository areas each layer may import.
 * value: allowed for runtime imports; types: allowed for type-only imports.
 * Paths are prefixes of repository paths.
 */
const INTERNAL = {
	shared: { value: ["src/shared/"], types: ["src/shared/"] },
	core: { value: ["src/shared/", "src/core/"], types: ["src/shared/", "src/core/"] },
	server: {
		value: ["src/shared/", "src/core/", "src/server/", "dist/assets/"],
		types: ["src/shared/", "src/core/", "src/server/"],
	},
	astro: {
		value: ["src/shared/", "src/astro/", "dist/assets/"],
		types: ["src/shared/", "src/core/", "src/astro/"],
	},
	site: {
		value: ["src/shared/", "src/astro/", "src/site/", "dist/assets/"],
		types: ["src/shared/", "src/core/", "src/astro/", "src/site/"],
	},
	client: {
		value: [...CLIENT_SHARED, "src/client/"],
		types: [...CLIENT_SHARED, "src/shared/types/", "src/client/"],
	},
	admin: {
		value: ["src/shared/", ...ADMIN_PURE_CORE, "src/admin/"],
		types: ["src/shared/", "src/core/", "src/admin/"],
	},
	// src/index.ts is loaded by astro.config.mjs at config time: no runtime imports beyond
	// shared and the companion integration's config-time modules.
	entry: {
		value: ["src/shared/", "src/site/integration.ts", "src/site/routes.ts"],
		types: ["src/"],
	},
	runtime: { value: ["src/shared/", "src/server/"], types: ["src/"] },
};

/** Package rules per layer. `allow` lists package names or prefixes ending in "/" or ":"; everything else is denied. */
const PACKAGES = {
	shared: { allow: [], types: [] },
	core: { allow: ["htmlparser2", "domhandler", "fflate"], types: [] },
	server: {
		allow: ["emdash", "emdash/", "zod", "htmlparser2", "domhandler", "fflate", "@emdash-cms/"],
		types: ["emdash", "emdash/", "@emdash-cms/"],
	},
	astro: { allow: ["astro", "astro:", "emdash/plugin-utils"], types: ["emdash", "emdash/", "astro", "astro/"] },
	site: { allow: ["astro", "astro:", "astro/", "emdash", "emdash/"], types: ["emdash", "emdash/", "astro", "astro/"] },
	client: { allow: [], types: [] },
	admin: {
		allow: [
			"react",
			"react/",
			"react-dom",
			"react-dom/",
			"@cloudflare/kumo",
			"@cloudflare/kumo/",
			"@phosphor-icons/react",
			"@phosphor-icons/react/",
			"@tanstack/react-query",
			"@dnd-kit/",
			"@codemirror/",
			"@lezer/",
		],
		types: ["emdash", "emdash/", "@emdash-cms/"],
	},
	entry: { allow: [], types: ["emdash", "emdash/", "astro", "astro/", "@emdash-cms/"] },
	runtime: { allow: ["emdash"], types: ["emdash", "emdash/", "@emdash-cms/"] },
};

/** File-specific exceptions on top of the layer rules. */
const EXCEPTIONS = [
	// cloudflare:workers only in src/server/platform (§4) and companion endpoint files.
	{ match: (f) => f.startsWith("src/server/platform/"), packages: ["cloudflare:workers"] },
	{ match: (f) => f.startsWith("src/site/") && f.includes("/endpoints/"), packages: ["cloudflare:workers"] },
	// The companion integration and its route table run in Node at config time.
	{ match: (f) => f === "src/site/integration.ts" || f === "src/site/routes.ts", packages: ["node:"] },
	// Only the admin's typed route caller talks to EmDash's fetch helpers (§4: "Calls routes only via
	// src/admin/lib/route.ts").
	{ match: (f) => f.startsWith("src/admin/lib/"), packages: ["emdash/plugin-utils"] },
];

function packageName(specifier) {
	if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
	return specifier.split("/")[0];
}

function matchesAllow(specifier, entries) {
	const name = packageName(specifier);
	return entries.some((entry) => {
		if (entry.endsWith(":")) return specifier.startsWith(entry);
		if (entry.endsWith("/")) return specifier.startsWith(entry) || name === entry.slice(0, -1);
		return specifier === entry || name === entry;
	});
}

function toPosix(p) {
	return p.split(path.sep).join("/");
}

/** Resolve a specifier to a repository path (posix), or null for a third-party package. */
export function resolveSpecifier(fromRepoPath, specifier) {
	const clean = specifier.split("?")[0];
	if (clean.startsWith(".") || clean.startsWith("/")) {
		const abs = clean.startsWith("/") ? clean : path.resolve(ROOT, path.dirname(fromRepoPath), clean);
		return toPosix(path.relative(ROOT, abs));
	}
	if (clean === PACKAGE_NAME || clean.startsWith(`${PACKAGE_NAME}/`)) {
		const sub = clean === PACKAGE_NAME ? "" : clean.slice(PACKAGE_NAME.length + 1);
		for (const [key, target] of SELF_EXPORTS) {
			if (key.endsWith("/") && sub.startsWith(key)) return target + sub.slice(key.length);
			if (sub === key) return target;
		}
		return `<unexported:${sub}>`;
	}
	return null;
}

function describe(repoPath) {
	return repoPath.startsWith("<") ? repoPath : repoPath.replace(/\.(m?[jt]sx?)$/, "");
}

/**
 * Check one import edge.
 * @param {{ file: string; specifier: string; typeOnly?: boolean }} edge `file` is a repository path
 *   (posix, relative to the repo root) or an absolute path.
 * @returns {string | null} a violation message, or null when the import is allowed.
 */
export function checkImport({ file, specifier, typeOnly = false }) {
	const from = path.isAbsolute(file) ? toPosix(path.relative(ROOT, file)) : toPosix(file);
	const layer = layerOf(from);
	if (!layer || layer === "assets") return null;

	const target = resolveSpecifier(from, specifier);
	const exceptions = EXCEPTIONS.filter((e) => e.match(from)).flatMap((e) => e.packages);

	if (target !== null) {
		if (target.startsWith("<unexported:")) return `"${specifier}" is not an exported subpath of ${PACKAGE_NAME}.`;
		const targetLayer = layerOf(target);
		if (targetLayer === null) {
			// Outside the layered tree (tests/, scripts/, tools/ …): source code must never import it.
			return `src/${layer} must not import "${specifier}" (outside src/: ${describe(target)}).`;
		}
		const rules = INTERNAL[layer];
		const allowed = (typeOnly ? [...rules.value, ...rules.types] : rules.value).some(
			(prefix) => target === prefix || target.startsWith(prefix),
		);
		if (allowed) return null;
		const typesWouldPass = !typeOnly && rules.types.some((prefix) => target.startsWith(prefix));
		return (
			`${layer} layer (${from}) must not import ${describe(target)}` +
			(typesWouldPass ? " at runtime; use `import type` (types only are allowed here)." : ".") +
			" See docs/port/10-architecture.md §4."
		);
	}

	// Third-party / platform specifier.
	if (exceptions.some((entry) => matchesAllow(specifier, [entry]))) return null;
	if (specifier.startsWith("cloudflare:")) {
		return `"${specifier}" is only allowed in src/server/platform/ and src/site/**/endpoints/ (architecture §4).`;
	}
	if (NODE_BUILTINS.has(specifier) || specifier.startsWith("node:")) {
		return `${layer} code runs on Workers or in the browser: Node built-in "${specifier}" is not allowed.`;
	}
	const rules = PACKAGES[layer];
	if (matchesAllow(specifier, rules.allow)) return null;
	if (typeOnly && matchesAllow(specifier, rules.types)) return null;
	if (!typeOnly && matchesAllow(specifier, rules.types)) {
		return `${layer} layer (${from}) may import "${specifier}" for types only; use \`import type\`.`;
	}
	return `${layer} layer (${from}) must not import package "${specifier}" (architecture §4; ask the coordinator to extend scripts/import-boundaries.mjs if a new dependency is approved).`;
}

/** Globals that must not be referenced per layer (DOM in pure code, Node in Workers/browser code). */
export const RESTRICTED_GLOBALS = {
	dom: ["window", "document", "localStorage", "sessionStorage", "location", "history"],
	node: ["process", "Buffer", "__dirname", "__filename", "require", "module", "global"],
};

function isTypeOnlyImport(node) {
	if (node.importKind === "type") return true;
	const specifiers = node.specifiers ?? [];
	return specifiers.length > 0 && specifiers.every((s) => s.type === "ImportSpecifier" && s.importKind === "type");
}

function isTypeOnlyExport(node) {
	if (node.exportKind === "type") return true;
	const specifiers = node.specifiers ?? [];
	return specifiers.length > 0 && specifiers.every((s) => s.exportKind === "type");
}

/** ESLint rule implementing checkImport over every static, dynamic and type import. */
export const importBoundariesRule = {
	meta: {
		type: "problem",
		docs: { description: "Enforce the Core Forms layer import matrix (architecture §4)." },
		schema: [],
	},
	create(context) {
		const file = context.filename ?? context.getFilename();
		function report(node, source, typeOnly) {
			if (!source || typeof source.value !== "string") return;
			const message = checkImport({ file, specifier: source.value, typeOnly });
			if (message) context.report({ node: source, message });
		}
		return {
			ImportDeclaration(node) {
				report(node, node.source, isTypeOnlyImport(node));
			},
			ExportNamedDeclaration(node) {
				if (node.source) report(node, node.source, isTypeOnlyExport(node));
			},
			ExportAllDeclaration(node) {
				report(node, node.source, node.exportKind === "type");
			},
			ImportExpression(node) {
				if (node.source.type === "Literal") report(node, node.source, false);
			},
			TSImportType(node) {
				const arg = node.argument?.literal ?? node.argument;
				if (arg && arg.type === "Literal") report(node, arg, true);
			},
		};
	},
};

export const boundariesPlugin = {
	meta: { name: "core-forms" },
	rules: { "import-boundaries": importBoundariesRule },
};
