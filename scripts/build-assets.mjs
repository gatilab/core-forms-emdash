#!/usr/bin/env node
/**
 * Build the browser assets into dist/assets (docs/port/10-architecture.md §13, D-041).
 *
 *   - every `src/client/<dir>/<name>.entry.ts` → `<name>.js` (esbuild IIFE, es2019, minified)
 *   - every `src/styles/<name>.css`            → `<name>.css` (minified, `/*!` headers kept)
 *   - `manifest.json`: { version, files: { "<name>": { file, kind, bytes, brotli, sha256, budget } } }
 *
 * Every output is checked against its brotli budget (scripts/asset-budgets.mjs) and so is the default
 * embed total. Any violation, unknown entry or build error exits 1. With no entries yet the manifest
 * is simply empty.
 *
 * Usage: node scripts/build-assets.mjs [--out <dir>] [--quiet]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { brotliCompressSync, constants as zlib } from "node:zlib";

import { build, transform } from "esbuild";

import { BROTLI_QUALITY, BUNDLES, DEFAULT_EMBED, MANIFEST_VERSION, STYLES } from "./asset-budgets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, predicate, out = []) {
	if (!existsSync(dir)) return out;
	for (const name of readdirSync(dir)) {
		const full = path.join(dir, name);
		if (statSync(full).isDirectory()) walk(full, predicate, out);
		else if (predicate(full)) out.push(full);
	}
	return out;
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");

export function brotliSize(bytes) {
	return brotliCompressSync(bytes, { params: { [zlib.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY } }).length;
}

function describe(name, kind, bytes, budget) {
	return {
		file: name,
		kind,
		bytes: bytes.length,
		brotli: brotliSize(bytes),
		sha256: createHash("sha256").update(bytes).digest("hex"),
		budget,
	};
}

/**
 * Build every asset and return the manifest plus problems. Writes to `outDir` unless `write` is false.
 * @param {{ outDir?: string; write?: boolean }} [options]
 */
export async function buildAssets({ outDir = path.join(ROOT, "dist/assets"), write = true } = {}) {
	const problems = [];
	/** @type {Record<string, ReturnType<typeof describe>>} */
	const files = {};
	const outputs = [];

	const entries = walk(path.join(ROOT, "src/client"), (f) => f.endsWith(".entry.ts"));
	for (const entry of entries.sort()) {
		const source = rel(entry);
		const spec = BUNDLES.find((b) => b.source === source);
		if (!spec) {
			problems.push(`${source}: unknown bundle entry. Add it to scripts/asset-budgets.mjs (a contract change) first.`);
			continue;
		}
		try {
			const result = await build({
				entryPoints: [entry],
				bundle: true,
				format: "iife",
				target: "es2019",
				platform: "browser",
				minify: true,
				legalComments: "inline",
				charset: "utf8",
				write: false,
				logLevel: "silent",
			});
			const bytes = Buffer.from(result.outputFiles[0].contents);
			files[spec.name] = describe(spec.name, "js", bytes, spec.budget);
			outputs.push([spec.name, bytes]);
		} catch (error) {
			problems.push(`${source}: build failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	const sheets = walk(path.join(ROOT, "src/styles"), (f) => f.endsWith(".css"));
	for (const sheet of sheets.sort()) {
		const source = rel(sheet);
		const spec = STYLES.find((s) => s.source === source);
		if (!spec) {
			problems.push(`${source}: unknown stylesheet. Add it to scripts/asset-budgets.mjs (a contract change) first.`);
			continue;
		}
		try {
			const result = await transform(readFileSync(sheet, "utf8"), {
				loader: "css",
				minify: true,
				legalComments: "inline",
				charset: "utf8",
				logLevel: "silent",
			});
			const bytes = Buffer.from(result.code, "utf8");
			files[spec.name] = describe(spec.name, "css", bytes, spec.budget);
			outputs.push([spec.name, bytes]);
		} catch (error) {
			problems.push(`${source}: CSS minify failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	for (const info of Object.values(files)) {
		if (info.brotli > info.budget) {
			problems.push(`${info.file}: ${info.brotli} B br exceeds its budget of ${info.budget} B.`);
		}
	}
	const embedPresent = DEFAULT_EMBED.files.filter((f) => files[f]);
	const embedTotal = embedPresent.reduce((sum, f) => sum + files[f].brotli, 0);
	if (embedTotal > DEFAULT_EMBED.budget) {
		problems.push(`default embed (${embedPresent.join(" + ")}): ${embedTotal} B br exceeds ${DEFAULT_EMBED.budget} B.`);
	}

	const manifest = {
		version: MANIFEST_VERSION,
		defaultEmbed: { files: embedPresent, brotli: embedTotal, budget: DEFAULT_EMBED.budget },
		files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
	};

	if (write) {
		rmSync(outDir, { recursive: true, force: true });
		mkdirSync(outDir, { recursive: true });
		for (const [name, bytes] of outputs) writeFileSync(path.join(outDir, name), bytes);
		writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
	}
	return { manifest, problems };
}

async function main() {
	const args = process.argv.slice(2);
	const outIndex = args.indexOf("--out");
	const outDir = outIndex >= 0 ? path.resolve(args[outIndex + 1] ?? "") : undefined;
	const quiet = args.includes("--quiet");
	const { manifest, problems } = await buildAssets({ outDir });
	if (!quiet) {
		const rows = Object.values(manifest.files);
		if (rows.length === 0) console.log("build:assets: no client entries or stylesheets yet; wrote an empty manifest.");
		for (const r of rows) console.log(`${r.file.padEnd(22)} ${String(r.bytes).padStart(7)} B  ${String(r.brotli).padStart(6)} B br  (budget ${r.budget})`);
		if (rows.length > 0) console.log(`default embed: ${manifest.defaultEmbed.brotli} B br (budget ${manifest.defaultEmbed.budget})`);
	}
	if (problems.length > 0) {
		for (const p of problems) console.error(`build:assets: ${p}`);
		process.exit(1);
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	main().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
