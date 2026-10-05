// WIP prototype (P1.1). Proves the oracle environment; not yet the full runner.
//
// Boots WordPress in php-wasm (PHP 8.3, libxml 2.9.10, DOM available) in THIS
// Node process (no worker threads), with:
//   - a virtual clock: Date.now() = base + tick * 1µs. PHP time()/gmdate()/
//     DateTime('now') see `base` (frozen to the second); microtime advances 1µs
//     per call so uniqid()'s "wait for the clock to move" loop terminates.
//     (Wrapping the sub-second part hangs the boot: something waits > 1 s.)
//   - a seeded xorshift PRNG behind crypto.getRandomValues, so random_bytes,
//     wp_rand, salts and password hashes are reproducible.
//   - a PHP→JS bridge: post_message_to_js(json_encode(['op'=>'clock','t'=>UNIX]))
//     resets the clock per golden case (needed for the schedule matrix).
// Verified: two consecutive runs print byte-identical output.
//
// Prereqs (not yet wired into package.json): npm deps @php-wasm/node,
// @wp-playground/wordpress (3.1.56) and the sqlite-database-integration.zip that
// ships inside @wp-playground/cli; the WordPress 7.1.2 zip (cached by
// Playground at ~/.wordpress-playground/7.1.2.zip, or downloads.wordpress.org).
import { loadNodeRuntime, createNodeFsMountHandler } from '@php-wasm/node';
import { bootRequestHandler, bootWordPress } from '@wp-playground/wordpress';
import fs from 'node:fs';

const WP_ZIP = process.env.CF_ORACLE_WP_ZIP ?? `${process.env.HOME}/.wordpress-playground/7.1.2.zip`;
const SQLITE_ZIP = process.env.CF_ORACLE_SQLITE_ZIP ?? 'node_modules/@wp-playground/cli/sqlite-database-integration.zip';

let base = Date.UTC(2026, 0, 15, 10, 30, 0);
let tick = 0;
Date.now = () => base + tick++ * 0.001;

let seed = 0x9e3779b9;
function rnd() { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed; }
globalThis.crypto.getRandomValues = (view) => {
  const u8 = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  for (let i = 0; i < u8.length; i++) u8[i] = rnd() & 0xff;
  return view;
};

const siteUrl = 'http://oracle.test';
const handler = await bootRequestHandler({
  siteUrl, phpVersion: '8.3', maxPhpInstances: 1, sapiName: 'cli', cookieStore: false,
  createPhpRuntime: async () => await loadNodeRuntime('8.3', { emscriptenOptions: { processId: 1 } }),
});
await bootWordPress(handler, {
  siteUrl, phpVersion: '8.3', wordpressInstallMode: 'download-and-install',
  wordPressZip: new File([fs.readFileSync(WP_ZIP)], 'wordpress.zip'),
  sqliteIntegrationPluginZip: new File([fs.readFileSync(SQLITE_ZIP)], 'sqlite.zip'),
  phpIniEntries: { allow_url_fopen: '0', disable_functions: '' },
});
const php = await handler.getPrimaryPhp();
php.onMessage(async (msg) => {
  const m = JSON.parse(msg);
  if (m.op === 'clock') { base = m.t * 1000; tick = 0; }
  if (m.op === 'seed') { seed = m.seed >>> 0 || 0x9e3779b9; }
  return 'ok';
});
await php.mount('/oracle', createNodeFsMountHandler(process.cwd()));
const r = await php.run({ code: `<?php
require '/wordpress/wp-load.php';
echo "WP ", get_bloginfo('version'), " PHP ", PHP_VERSION, " libxml ", LIBXML_DOTTED_VERSION, "\\n";
echo gmdate('c'), " ", uniqid(), " ", uniqid(), " ", wp_rand(1, 100), " ", bin2hex(random_bytes(4)), "\\n";
post_message_to_js(json_encode(['op' => 'clock', 't' => 1767225600]));
echo "after clock ", gmdate('c'), "\\n";
` });
process.stdout.write(r.text);
