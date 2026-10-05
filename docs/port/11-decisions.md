# 11 · Decision log

This log records every open question raised in specs 00–06 and how it was resolved. It also holds three lists: the intentional differences from WordPress 4.11.1 (§DEVIATIONS), the WordPress quirks kept on purpose (§KEPT), and the few product questions that need Gaurav (§QUESTIONS).

**How to read.**
- **Ids.** `D-…` is a decision and `DV-…` is a deviation. Architecture and plan documents cite these ids.
- **Sources.** "Source" names the spec section that raised the question: `01 §9 Q2` is spec 01, section 9, question 2.
- **Rule of thumb** (from the brief):
  - WP 4.11.1 **code** is the reference, not its docs.
  - Genuine bugs in four categories (security, data loss, money, privacy) are fixed, never replicated.
  - Everything else stays compatible.
  - Every difference from WP appears in §DEVIATIONS with a category:
    - `SEC` security
    - `DATA` data loss or corruption
    - `MONEY` money
    - `PRIV` privacy
    - `A11Y` accessibility (WCAG 2.2 AA is a stated quality bar)
    - `PLAT` forced by the EmDash or Workers platform
    - `ADD` additive and backward-compatible
    - `DOC` documented behaviour restored where the code never did it

---

## A. Product, packaging, platform

| ID | Question (source) | Resolution | Reason |
|---|---|---|---|
| D-001 | What is authoritative when docs and code disagree? (all specs) | WP 4.11.1 code. Doc claims are recorded as drift and ignored unless restored as `DOC` (DV-48). | Existing data and sites depend on what the code did. |
| D-002 | Native plugin or sandboxed; how to get pages, cookies, CORS and streaming? (00 §5, 01 F1–F3, 06 §7.12 Q2) | One native EmDash plugin plus the companion Astro integration `coreFormsSite()` from the same package. The companion owns every browser-visited page, cookie, streamed download, large upload, CORS response and legacy path. | Plugin routes can't do these (00 TL;DR 3–5), and admin React, PT blocks and bindings require native. |
| D-003 | Payments and licensing: same plugin id or a second id in the same package? (brief §6) | **Same id, `core-forms`**. Commerce is a feature module behind WP's `license_server.enabled` master switch. Its storage collections are declared from day one, and the admin shows an "Activate Core Commerce" screen while it's off. | The flows "submission → payment → fulfillment → license → email" cross collections. Storage is per plugin, so a second id would turn each step into a cross-plugin dispatch: no shared CAS, a second job queue, a second cron task competing for the 10/min site budget. WP is one plugin with a master switch, and importing `core-forms-data` across two namespaces would split one envelope. The cost is a slightly larger worker bundle; gateways use no SDKs. |
| D-004 | Package entry points (00 §14) | `.` is the light descriptor plus `coreFormsSite()` (safe in `astro.config.mjs`). `./runtime` is `createPlugin` (the descriptor `entrypoint`). Also `./astro`, `./admin`, `./site/*`, `./core`, `./extend`, `./assets/*`. `./client` is removed. | Keeps config-time imports cheap. Prebuilt assets get stable URLs. |
| D-005 | How does the plugin runtime know the companion exists and how it's configured? | `coreForms({ site: opts })` and `coreFormsSite(opts)` take the same options object. The plugin reads it from descriptor options (JSON). The companion also publishes `globalThis.__CORE_FORMS_SITE__`, and `doctor` flags any mismatch. | Build-time, explicit, no runtime handshake. One documented two-line pattern. |
| D-006 | Serve WP-compatible URLs (`/wp-json/...`, `?edd_action`, `?cf-form`) on EmDash? (06 §7.2, 01 §3.14) | Yes, `coreFormsSite({ wpCompat: true })` by default. The middleware short-circuits unless a known query key is present. | Shipped license clients, provider webhook URLs, headless embeds and emailed links keep working with zero configuration. Sites can turn it off. |
| D-007 | Should `render` be a public route (v0.1.0)? | No. Server-only operations (render, standalone, poll render, file authorize, go, portal, checkout, package authorize) are **internal** routes. They're private and reached only through `locals.emdash.handlePluginApiRoute`. | Smaller public surface. Drafts and unpublished definitions are not fetchable over HTTP. |
| D-008 | Development and release flow, given that Gatilab consumes the repo as a linked dependency | Work lands on integration branch `next`, with one git worktree and branch per work package. `main` stays at the last cutover-ready tag (`v0.1.0` today), which is what `emdash-next` links. Each phase gate fast-forwards `main` after the Gatilab checklist passes. Versions: `1.0.0` at the Phase 1 gate, then `1.1` workflows, `1.2` analytics, `1.3` commerce. | Gatilab never runs half-built code. Semver signals a complete forms product at 1.0. |
| D-009 | Capabilities (00 §1.3) | `email:send`, `network:request:unrestricted`, `users:read`, `content:read`, `schema:read`, `media:read`, `media:write`, `media:bytes:read` (architecture §2.3). | Webhooks and integrations need arbitrary hosts. The rest serve named features. |

## B. Data and storage

| ID | Question (source) | Resolution | Reason |
|---|---|---|---|
| D-010 | Ids for new forms and other records (01 §9 Q1, 06 §7.1, brief §5) | Numeric ids are stored as strings, with an `n` number mirror for ordering. They cover forms, submissions, polls, products, plans, orders, items, licenses, activations, packages, subscriptions, downloads and commerce events. Imports keep the WP id. New ids come from the KV sequence `seq:<entity>` (compareAndSet loop, max 8 tries with jitter), and `ensureAtLeast` runs after import. Internal records use `<prefix>_<ulid>` or deterministic keys (`wp-<id>`, `run:<key>`, `<provider>:<eventId>`). | Keeps `.cf-form-{ID}`, `_cf_h{ID}`, `[cf_form id]`, `item_id`, `cf_submission` metadata and exports WP-shaped. |
| D-011 | Timestamp format (01 §8.1) | `IsoDateTime` (UTC, ms) everywhere in storage. WP `Y-m-d H:i:s` is produced only at boundaries: tokens, exports, license API (`expires`), CSV. | One sortable format. Boundary helpers live in `src/shared/time`. |
| D-012 | Storage field naming | camelCase fields. WP JSON blobs (settings, schema, action configs, details, metadata) are stored verbatim. One mapper module (`src/core/io/mappers`) translates rows to and from WP. | Avoids two naming schemes in code while keeping exports byte-faithful. |
| D-013 | Unique constraints when `uniqueIndexes` only exist after a scheduler tick (00 §3.1) | Deterministic claim documents in `uniques` (`<ns>:<value>`, compareAndSet null). `uniqueIndexes` are still declared as defense in depth. | Correct from the first request after deploy. Also gives O(1) lookups (license key, slug). |
| D-014 | TTL data (rate limits, duplicates, PRG tokens, locks, nonces) | An `ephemeral` storage collection with an indexed `exp`, swept hourly. KV is used only for config, sequences and state. | KV has no TTL, and `kv.list` is an unbounded scan. Range deletes by `exp` are cheap. |
| D-015 | No multi-row transactions on D1 (00 §3.1, 06 §7.3) | Three patterns: (a) single-row `compareAndSet`/`updateIf` with guards; (b) **allocate-then-write**: reserve ids and record the plan in a checkpoint doc, then write rows create-only, then mark done; (c) job-driven idempotent steps. No Durable Objects. | Works within the plugin storage API. Every partial failure is resumable. |
| D-016 | When are collections and indexes declared? (00 §16.1.5) | All collections for all four phases are declared in P1.0a (architecture §6.2). | Indexes appear only after a scheduler tick in a fresh process, so declaring early avoids "index missing" gaps at phase launches. |
| D-017 | DOM work on Workers (01 §8.3, 02 §8.1) | `htmlparser2` tokenizer plus our own **libxml2-compatible** tree builder and serializer in `src/core/html`. It ports libxml2's HTML auto-close tables and its `saveHTML` serialization: attribute quoting, minimized boolean attributes, void elements, entity output. It is validated against PHP DOMDocument output from the WP oracle. | `cf_enhance_accessibility` re-serializes **every** form through DOMDocument, so byte parity needs libxml behaviour, not HTML5 tree building. |
| D-018 | Site timezone, date and time formats (01 F6, 03 §1.5) | Plugin settings `emdash.timezone` (default `UTC`), `emdash.date_format`, `emdash.time_format`, imported from WP `timezone_string`/`gmt_offset`, `date_format` and `time_format`. Used by: schedule `is_open`, `CF_DATE`/`CF_TIME`, `cf_field_value` date reformatting, inbox date filters and team due dates. | EmDash exposes no site timezone. Gatilab WP runs on UTC. |
| D-019 | Free-text search over submissions (04 §8.3) | A bounded server-side scan of newest-first cursor pages. It matches values (not keys or JSON escapes) case-insensitively and stops at 50 matches or 2,000 scanned rows, returning `truncated`. Plus an exact `emailKey` index for email lookups and GDPR. | Storage has no substring search. This matches WP's useful semantics on typical inbox sizes. |

## C. Rendering and submission parity

| ID | Question (source) | Resolution | Reason |
|---|---|---|---|
| D-020 | HTTP status for business errors (01 §9 Q3) | Mirror WP: 200 for validation and business errors (with `error:true`); 403 availability; 404 missing form; 422 calculation failure; 503 capacity-busy or unsaved-capacity; headless maps any error to 422. | `forms.js` and headless clients depend on it. |
| D-021 | `{{tag}}` semantics (01 §9 Q2, §3.10) | Both, with WP's regex and allowlists. **Submit time:** submitted values (WP code). **Render time:** `{{url_params.X}}` from the page query and `{{post.X}}` from the page context, HTML-escaped (DV-48). `{{user.X}}` resolves to `''` on public renders and submits (DV-47). | The submit-time path keeps stored data identical. Render-time makes the documented feature actually work: WP's AJAX submit sees no page query or post. |
| D-022 | Honeypot matches the first `_cf_h*` key (01 Q-a) | Match `_cf_h{formId}` exactly (DV-12). | WP's prefix match silently fake-succeeds legitimate headless posts (`_cf_headless`). |
| D-024 | `enable_honeypot` is ignored (01 Q-c, 03 Q1) | Keep WP: always rendered, always enforced; the setting is kept and inert. v0.1.0's honouring of it is reverted. | Fidelity; not a bug category. |
| D-025 | Autocomplete and type-coercion quirks (01 Q-d) | Keep WP's substring map and the `text` → `email`/`tel`/`url` coercion, including `hotel` → `tel`. Exception: `first_name`/`last_name` are checked before `name` (DV-17). | Markup parity, except where WCAG 1.3.5 (identify input purpose) is violated. |
| D-026 | `nl2br` in plain-text data variables (01 Q-e) | Keep. The email action removes `<br />` in plain mode and the autoresponder converts it to `\n`, exactly as WP does. | The per-action compensation is part of the observed output. |
| D-027 | Industry template `min`/`step`/`maxlength` placed in `attributes` are ignored (01 Q-f) | Keep (ignored). | Imported schemas must behave identically. |
| D-028 | Schedule replaces the HTML while submit returns `form_closed`; `prevent_duplicates` is inert without storage (01 Q-g, Q-h) | Keep both. | Fidelity. |
| D-029 | `turnstile_failed` has no default message (01 Q-i) | The default key list is unchanged, so the `data-message-*` set stays identical. When the message resolves to `''`, the error response uses "Verification failed. Please try again." The same applies to `hcaptcha_failed` (DV-55). | Avoids an empty error without changing markup. |
| D-023 | Off-site `redirect_url` (01 §9 Q5) | AJAX responses return any `redirect_url` (the client navigates), as WP does. No-JS submits: a same-origin target gets a direct 303; an off-site target goes through the companion handoff `/_core-forms/go?t=` (DV-49). Without the companion, the success message is shown (v0.1.0 behaviour). | Public plugin routes can only redirect same-origin (00 §4.3). |
| D-061 | Which definition do public paths use? (01 Q-b, §3.2) | Public render, standalone, headless, AJAX **and native** submits all use the live definition. The draft is used only in admin preview and rehearsal (DV-13). | WP's `admin-post.php` quirk validates no-JS posts against unpublished drafts. |
| D-027b | Render legacy markup through parse→render, or keep WP's split? (01 §9 Q9) | Keep the split: raw markup goes through the markup filters and the a11y pass; schema forms go through SchemaRenderer. MarkupParser is used for validation, labels, length limits and builder import. | Byte parity with live output. |
| D-020b | Response contract and client posting target (02 §2.1, §8.1) | Exact WP `SubmitResponse`. `window.cf_js_vars.ajax_url` = the submit route. The client posts to `form.getAttribute("action") \|\| cf_js_vars.ajax_url`. Additive keys are allowed. | Contract stability. |
| D-020c | Data attribute and class contract drift in v0.1.0 (brief §3) | Restore WP. `data-ajax-submit` with the six capability flags in WP order. `data-message-*` covers every message (defaults ⊕ saved, custom keys included). `.cf-form` theme selectors are unscoped (no `.cf-theme`). Message text uses `innerHTML` with server-sanitized HTML. The `<input name="action" value="cf_form_submit">` is emitted. Closed forms use the `.cf-form-closed` replacement. No auto-appended submit button. | Principle 3. |
| D-026b | Data shapes (01 §1.8, §7.2) | WP `$_POST` semantics. A repeated scalar name keeps the last value. A single checkbox is a string. `name[]` becomes an array. Values are `trim` + `stripslashes`-equivalent (a no-op, since there are no magic quotes). Size limits: per-field `maxlength`, email 254, total JSON 60 KiB. | Actions, CSV and imports must see WP-shaped data. |

## D. Settings and secrets

| ID | Question (source) | Resolution | Reason |
|---|---|---|---|
| D-025b | Settings storage model (01 §9 Q7, brief §4) | Forms: the raw `_cf_settings` verbatim, read through `FormSettingsView` (defaults merged at read, PHP truthiness, tri-states). Global: one KV document `cfg:settings` in WP `cf_settings` shape, with extensions under an `emdash` subtree. Unknown keys round-trip in both. | Lossless import and export, typed reads. |
| D-030 | Can secrets be encrypted outside `settingsSchema`? (04 §8.4 Q5, 00 §13) | Seal secret leaves with the exported `encryptPluginSetting`/`decodePluginSettingValue`, as `{ "$secret": "<envelope>" }`. This covers global secrets and per-action secret keys declared by each `ActionModule` (unknown or WP-only types: keys matching `/(secret\|token\|password\|api_key\|auth_header_value\|access_token)$/`). Without `EMDASH_ENCRYPTION_KEY`, values are stored `plain:` and admin shows a persistent warning. Exports unseal (opt-in only, DV-58). | Encryption at rest without giving up the WP shape. Not observable to WP-compatible consumers. |
| D-031 | `settingsSchema` (auto page) vs a custom page (04 §3.5) | No `settingsSchema`. A custom React Settings page writes `cfg:settings` through `settings/save` with WP merge semantics. | The auto page can't express nested providers, routing tables or test buttons, and two editors would mean two sources of truth. |
| D-032 | v0.1.0 `defaultFrom` setting (00 §16.4) | Removed. Replaced by `emdash.mail.from_email`/`from_name`, which apply only with a direct transport. | `EmailMessage` has no from. |
| D-033 | HMAC signing key | Env `CORE_FORMS_SECRET` when set; otherwise a generated 32-byte key, sealed in `state:secret:hmac`. It signs PRG/go tokens, math challenges, render auth tokens, return URLs, package and download links, and customer access tokens. Optional legacy WP `AUTH_KEY.AUTH_SALT` / `NONCE_KEY.NONCE_SALT` secrets are **verify-only** (D-163). | One rotation point. Keeps WP link compatibility optional. |
| D-034 | `standalone_base_slug` runtime setting vs build-time routes (01 §3.14) | See D-052. | |

## E. Background work and front-end delivery

| ID | Question (source) | Resolution | Reason |
|---|---|---|---|
| D-040 | Background execution (05 §8 Q1, 04 §8.4 Q3, 00 §16.2) | One recurring cron task `tick` (`* * * * *`, 25 s timeout), ensured lazily (`ensureCron`). It recovers stale jobs, enqueues due maintenance tasks, and drains the storage-backed `jobs` collection within 20 s / 25 jobs. No one-shot cron tasks. Cloudflare Queues are documented as a future option, not built. | Uses 1 of the 10 site-wide cron executions per minute. Durable. Testable with the fake cron. |
| D-043 | Job model | Deterministic ids give idempotent enqueues (create-only). Claims use `updateIf(status: pending → running)`. Per-kind backoff and maxAttempts. A stale lock (> 10 min) retries or pauses per handler. Done jobs are swept after 7 days, failed after 90. | Spec 00 §16.2 pattern. |
| D-044 | When do form actions run? (05 §1.7, §6.5) | Inline-phase actions (redirect producers such as `whatsapp_redirect`) run before the response. All others are enqueued as one `dispatch` job written before the response and executed right away in `after()`; leftovers go to the next tick (DV-36). | Durable, keeps Workers responses fast, and preserves WP order and conditions. |
| D-045 | Granularity of action jobs | `dispatch` creates one `action:<runKey>` job per action in list order and runs them sequentially. Each action job carries WP's queue semantics: backoff, `MAX_RETRIES = 3`, condition re-check at run time. The ledger (`actionLogs` `run:<key>`) provides at-most-once claims and `uncertain` handling. | Mirrors WP's queue row per action plus the separate ledger. |
| D-041 | How are browser bundles built and loaded? (02 §8.1) | Prebuilt with esbuild into IIFE bundles and minified CSS in `dist/assets`, with a manifest and brotli budgets enforced in CI. Components emit `<link>`/`<script defer>` per a request-scoped union manifest. | Deterministic sizes (WP default embed is about 7 KB br). Stable URLs reused by standalone, embed.js and preview. Classic scripts keep WP global ordering. |
| D-042 | Calculations without `new Function` (02 §8.1, 03 §1.2) | One recursive-descent evaluator in `src/shared/expr`, used by server and client. It reproduces PHP's grammar, PHP `round()` (half away from zero with pre-rounding), and failure on `1.0E+25` stringification, division by zero and unknown references. | CSP without `unsafe-eval`; identical results on both sides. |
| D-046 | Re-initialization with view transitions (02 §7.2 #13) | Delegated listeners, plus re-init on `astro:page-load`, `astro:after-swap` and `swup:contentReplaced`, idempotent via `data-cf-ready`. | Astro sites commonly use view transitions. |

## F. Front end, smart forms, standalone, headless, polls

| ID | Question (source) | Resolution | Reason |
|---|---|---|---|
| D-050 | Theme scoping `.cf-form.cf-theme` (02 §9.3 Q1) | Revert to WP selectors (`.cf-form …`, specificity 0,1,x). Theme loading follows the tri-state settings per form and page. | Site CSS and customizer output must keep winning by order, as on WP. |
| D-051 | Raw-HTML id prefixing (02 §9.3 Q2) | Match WP for the first instance of a form on a page (no prefix). Prefix the second and later instances (`cf-form-{ID}-{n}-`) (DV-16). | Keeps `#id` CSS and JS working and fixes duplicate ids. |
| D-052 | Standalone URL base (01 §3.14) | Build-time `coreFormsSite({ standaloneBase })`, default `collect`. The imported `standalone_base_slug` is shown in Settings with a note when it differs. Legacy `?cf-form=` goes through middleware (DV-51). | Injected routes are fixed at build. |
| D-053 | The `accessibility.js` skip link is dead code (02 §2.2) | Not ported. | WP effectively never shows it; page-level bypass isn't the form's job. |
| D-054 | Character counter goes stale after reset (02 §9.2) | Recount on `reset`. | Trivial correctness fix with no data or markup impact (ADD). |
| D-055 | Portable Text block type (00 §16.4) | New type `core-form` with WP block attributes. `blockComponents` also maps the legacy `form` type, which Gatilab content uses, forever. | Block types are global; existing content must render. |
| D-056 | Fullscreen ignores conditionals and fires a non-bubbling `cf-success` only (02 §9.2) | Keep WP behaviour, apart from the escaping fix (DV-22). | Fidelity: listeners written for WP fullscreen expect this. The server strips inactive fields anyway. |
| D-057 | Calculation failures are strict (03 §11 Q2) | Keep strict (422). | Protects payment totals. |
| D-058 | Poll timestamps (03 §11 Q8) | Import as UTC instants. | Matches WP's voting checks and stored data. |
| D-059 | Draft polls accept votes; results are public (03 §11 Q9, Q11) | Keep both. | Fidelity; no bug category. |
| D-059b | Multi-step, drafts, scheduling semantics (03 §1.3–1.5) | WP exact: schedule dates are local midnight to 23:59:59, weekdays, overnight windows and the timezone. Drafts use the `draft` status, 64-hex token, expiry, sliding 30/min limit, and `retire` on success. v0.1.0's UTC-instant schedule is reverted. | Principle 3. |
| D-059c | reCAPTCHA action name (02 §9.3 Q6) | `core_forms_submit` (WP). | Keeps score analytics continuous. |
| D-059d | Headless REST, embed and CORS (01 §5.3) | Plugin routes `headless/form` and `headless/submit`. CORS, `OPTIONS` and `embed.js` come from the companion's `/wp-json/core-forms/v1/forms/*` compat routes, using WP's allowlist logic. | Plugin routes can't send CORS or serve JS. |

## G. Authoring: forms, builder, templates

| ID | Question (source) | Resolution | Reason |
|---|---|---|---|
| D-062 | Draft publishing, revisions and the concurrency protocol (01 §3.16) | Port the WP model: a `live` snapshot, publishing actions `start`/`publish`/`discard`, complete revision snapshots in `formRevisions` (keep 50 per form), slug reservation through `uniques`. The fingerprint is an opaque `v<version>.<hash>`. Mutations use `updateIf(where: {version})` + `delta: {version: +1}`. Mismatch returns 409 `cf_edit_conflict`; a missing fingerprint returns `cf_version_required`. No lock or `cf_edit_busy` (CAS replaces it). | Same contract to the editor, without DB locks. |
| D-063 | Forms trash (04 §7) | WP model: `trashedAt` marks a form as trashed, with All and Trash views, restore and permanent delete. Permanent delete keeps submissions (WP). | Fidelity; EmDash has no form trash of its own. |
| D-064 | Authoring REST `cf/v1/*` compat | Not exposed. The admin uses plugin routes with WP-shaped DTOs (DV-61). | Not a declared compatibility surface. Field-level routes are unneeded. |
| D-065 | Builder rendering source of truth (02 §5.1) | One TypeScript `SchemaRenderer` in `src/core`. `forms/editor-state` re-renders markup on the server, using `cf-field-` ids exactly as WP's builder post-pass does, and stores it alongside the schema. Client-generated HTML is never trusted. | No drift between preview, render and the audit. |
| D-066 | Builder features WP never shipped (undo/redo, condition and field pickers, formula editor, confirm before a template replaces fields) (02 §8.4) | Ship the confirm-before-replace dialog (prevents data loss) and keyboard-accessible drag and drop. Defer undo/redo and the pickers to a later minor release. They must still output the legacy rule grammar. | Keeps Phase 1 bounded. |
| D-067 | Code editor (02 §5.4) | CodeMirror 6 (`@codemirror/lang-html`), lazy-loaded, with a debounced live parse through the ported `MarkupParser`/`dr()` and a visible parse-error state. | It's what WP's docs promised. Admin-only weight. |
| D-068 | Template data (01 §3.18) | The WP oracle generates JSON for all 63 templates (markup, schema, layout, settings, messages, setup note) under `src/core/templates/data/`. License and payment templates no longer seed the sample catalog as a side effect; they show a setup note instead. | Byte-faithful without hand-porting 1,700 lines. Removes an unsolicited-write bug. |
| D-069 | Field groups storage (01 §2.12) | A `fieldGroups` collection, with optimistic concurrency through the KV counter `cfg:field-groups-version` (CAS). WP limits kept (100 groups, 100 fields, 60 KB, 100-char label, visibility rules). | 100 × 60 KB doesn't fit one D1 row. |
| D-069b | Accessibility audit (02 §5.6) | Port `AccessibilityTester` rules, messages and autofix exactly, over the libxml-compatible tree. Runs on save and on demand. Reports are stored in `meta._cf_a11y_report`. | Rule ids and texts must line up with docs and imported reports. |

## H. Submissions workspace

| ID | Question (source) | Resolution | Reason |
|---|---|---|---|
| D-071 | Status model (04 §7 P0, 03 §10.1) | WP model: the `status` union of 10 values, a separate `isSpam` flag, payment columns, no trash. A derived `bucket` (`inbox`/`archived`/`spam`) supports AND-only view queries. v0.1.0 `spam`/`trash` are migrated (architecture §17.4). | Inbox parity and imports. |
| D-072 | Summary line, views, filters, bulk actions (04 §2.3–2.5) | Port exactly: the `SubmissionPresentation::summary` algorithm, the five views, date filters in the site timezone, un-spam replaying actions, coordinated delete (refuses pending payment or pending work; checks all ids first). | Behaviours listed in 04 §8.5. |
| D-073 | CSV headers (04 §7) | Match WP exactly. Global: `id, form_id, submitted_at, status, is_spam (spam\|valid), ip_address, …keys`. Per form: `submitted_at, …keys, ip_address, user_agent, referer_url`. `cf_csv_row` `\t` guard including fullwidth `＝＋－＠`. No BOM. | People's spreadsheets depend on the WP headers. v0.1.0's format is dropped. |
| D-074 | Pagination | Cursor-based with server totals from `count()`. The UI shows "page N" plus Load more. | No offsets in storage. Totals keep the WP feel. |
| D-075 | Replies "From" (04 §8.4 Q1) | With a direct transport: `From: {site} <reply_from_email>`. With EmDash transport: Reply-To = `reply_from_email`, and the UI says From is set by the provider. History follows WP (failed sends store nothing; a successful one sets status `replied`). | Platform. |
| D-076 | Team inbox (04 §2.9) | Port fully in Phase 1: assignee, due date, append-only notes, hold, version, reminders (daily maintenance task, at most once per 24 h), saved views (≤30), access grants and scopes. | Part of the 4.11 workspace. Retention depends on `hold`. |
| D-077 | Email logs (04 §2.10) | Logged per `Mailer.send`. Detail is fetched by id (WP preloaded only 100). Resend writes a new log row (DV-33). Retention is the same as WP: none automatic. | Fidelity, minus WP's preload bug. |

## I. Spam and privacy

| ID | Question (source) | Resolution | Reason |
|---|---|---|---|
| D-080 | CAPTCHA model (01 §7.2, 03 §9) | WP flags. reCAPTCHA v3 applies to **all** forms when the global keys are set. `enable_turnstile` and `enable_math_captcha` are per form. They stack. Errors: `recaptcha_failed`, `recaptcha_low_score`, `turnstile_failed`, `math_captcha_failed` (not stored, not spam). `emdash.recaptcha_min_score` defaults to 0.5. v0.1.0's `captcha` key is migrated and removed. | Principle 3; imported forms keep their protection. |
| D-081 | hCaptcha (02 §9.3 Q7, 03 §11 Q7) | Kept as an EmDash extension: per-form `enable_hcaptcha`, global `emdash.hcaptcha.*`, error code `hcaptcha_failed` (DV-56). Import offers a checkbox, "This site used the hCaptcha plugin on all forms" (default off). | It can't be detected from Core Forms data. |
| D-082 | Akismet (03 §11 Q13, 04 §8.4 Q10) | Direct REST `comment-check` with `emdash.akismet.api_key`. Request building, whitelist and spam semantics are WP's. There is no editor bypass on public submits (no visitor identity) (DV-76). | No Akismet plugin on EmDash. |
| D-083 | GDPR exporter and eraser (04 §8.4 Q8) | Admin Tools → Privacy: find, export and erase by email, with WP's matching rule and coordinated erase (DV-53). | EmDash has no personal-data hooks. |
| D-084 | Retention (03 §4.9.2) | WP candidates and rules. Daily maintenance runs `erase` jobs and attachment retirement. `retention/preview` returns WP's shape. | Fidelity. |
| D-085 | IP storage | Keep v0.1.0's `emdash.store_ip` (default true). Rate limits use the hashed IP either way. The IP comes from `cf-connecting-ip` (`requestMeta.ip`). | Privacy option; Workers source of truth. |
| D-086 | Rate-limit windows (03 §11 Q15) | Sliding windows exactly as WP (the TTL resets on each bump) through `ephemeral.bump`. Counting only on storable outcomes, as WP does. | Possible with `updateIf` + set; no deviation needed. |
| D-087 | Dead code: `ConditionEvaluator`, `DraftManager::finalize/cleanup`, `partial` status (03 §11 Q14) | Not ported. `partial` stays in the status union for imported data. | Nothing references them. |

## J. Admin and access

| ID | Question (source) | Resolution | Reason |
|---|---|---|---|
| D-091 | Users, roles, `edit_forms`, team scope (04 §8.4 Q2) | Workspace routes declare `plugins:read` (Editor+). Inside, access is granted to EmDash Admins, or to users with an explicit grant (`user:<id>:access`), the equivalent of WP's per-user `edit_forms`. Form scopes restrict granted users; no scope means every form, as in WP. Admin-only (WP `manage_options`): settings, theme, import/export, privacy, team access, recovery, action tests, commerce, danger zone. Editing `custom_js` and unfiltered markup or messages requires an Admin (WP `unfiltered_html`). | WP grants Core Forms to admins plus explicitly granted users; EmDash roles map cleanly. |
| D-092 | Admin IA (04 §8.1) | Sidebar: Forms, Submissions, Polls, Analytics (P3), Commerce (P4), Settings, Tools. Hidden pages: editor, new, theme, email logs, poll editor, recovery (architecture §14). | Matches WP's subnav without overcrowding the EmDash sidebar. |
| D-093 | License & Updates screen (04 §1.3.10) | Not ported; distribution is npm. | No updater on EmDash. |
| D-094 | CLI (04 §5) | `bin/core-forms.mjs` (list, export, import, submissions, bulk-status, cleanup, doctor) over admin routes with an EmDash API token, plus MCP tools on the same routes (DV-57). | No plugin CLI extension point in EmDash. |
| D-095 | API-token auth on admin routes (04 §8.4 Q7) | Supported by EmDash (Bearer with admin scope). The CLI and import scripts use it, as `emdash-next:migration/import_forms.py` does today. | Already proven in v0.1.0. |
| D-096 | Admin libraries | kumo, phosphor, react-query from the host. `@dnd-kit/*`, CodeMirror 6 lazy. Admin CSS ships with the plugin. | 00 §11. |

## K. Actions, workflows, integrations

| ID | Question (source) | Resolution | Reason |
|---|---|---|---|
| D-100 | Action identity and order (05 §1.3–1.4) | Keep the stored list order, `_cf_action_id ??= "action-" + index` (0-based) on import, never renumbered. `enabled` is an EmDash extension that defaults to true (DV-38). | Ledger keys, Resend webhook URLs and retries depend on it. |
| D-101 | Conditions (05 §1.5) | Port `cf_evaluate_action_conditions` exactly, including "unknown operator ⇒ row fails". Evaluated at submit, replay, fulfillment and **again at job run time**. Recipient routes use the same evaluator. | Fidelity; v0.1.0 ignored conditions. |
| D-102 | Webhook payload, headers and defaults (05 §3.3, 03 §3.3) | WP byte-compatible: the flat `submission.data` as JSON (PHP `json_encode` escaping: `\/`, `\uXXXX`) or PHP `http_build_query` (`a[0]=x`, `+` for spaces); default `content_type` `form`; `Referer`, the auth header, `X-CF-Event-Id`, and the signature headers `X-CF-Signature`/`X-CF-Timestamp`/`X-CF-Key-Id`; 5 s timeout; `accepted()` classification. File values send public descriptors with no `dir` (DV-27). | Existing receivers verify bytes. |
| D-103 | Run key, ledger, retries (05 §2) | Port exactly: the run key formula (settings content excluded), lease, `uncertain` on a stale lease, reclaim of failed or skipped runs keeping `steps`, backoff `max(2^n·60, RA)`, `MAX_RETRIES = 3`, inline-failure re-entry `max(120, RA)` with attempts = 1. | At-least-once delivery semantics customers rely on. |
| D-104 | WP-only action types (05 §4, §8 Q2) | Import verbatim and render an "unavailable" card (dependency label) that preserves unknown keys on save. Execution logs `skipped` with reason `wp_only`, not `failed` (DV-35). | Keeps recovery views clean; nothing is lost. |
| D-105 | MC4WP `mailchimp` → `mailchimp_api` (05 §8 Q3) | A one-click "Convert" on the unavailable card. It asks for the API key; `list_id` carries over. | MC4WP's key isn't exported. |
| D-106 | Pinned provider endpoints (HubSpot v1, Kit v3 `api_key`, Graph v21.0) (05 §8 Q4) | Port as-is behind one per-module constant. P2.3 checks each endpoint in its provider's sandbox before release. A retired endpoint is migrated to the current API with the same settings shape, and a DV entry is added then. | Fidelity first, without shipping known-dead calls. |
| D-107 | Hook and filter parity (05 §8 Q5, 01 §6) | The typed extension registry (architecture §15): events, a curated filter set, validators with priorities, custom actions, field types and templates. Internal modules register through it. | No PHP hook bus. Gives developers a stable API. |
| D-108 | Queue snapshot secrets and file metadata (05 §8 Q6) | Job payloads store the action settings snapshot verbatim, as WP does, with secret leaves still sealed. Manual retry refreshes from the current form by `_cf_action_id`, as WP does. Payloads never carry `dir`. | Fidelity plus encryption at rest. |
| D-109 | Inbound route shape and public URL (05 §8 Q7) | Plugin routes take ids in the query (`inbound/resend?form=&action=`). With `wpCompat`, the old `/wp-json/cf/v1/resend/{form}/{action}` and `/wp-json/core-forms/v1/whatsapp/*` paths forward unchanged, so webhooks registered at providers keep working. Twilio's signature URL is the exact URL the provider called, passed through by the companion. | No path params; the Twilio signature covers the URL. |
| D-109b | WP quirks in integrations (05 §8 Q8) | Keep: Emailit 409 without audiences fails, Discord renders `"0"` as `"—"`, Slack shows entity text, Telegram migrates the chat id (rewrite with a CAS on form `version`). | Parity; none is in a bug category. |
| D-109c | Logs retention (05 §8 Q9) | Event rows are deleted after `emdash.action_log_retention_days` (default 90). Ledger rows are kept (DV-34). | D1 size; the ledger keeps idempotency. |

## L. Files and uploads

| ID | Question (source) | Resolution | Reason |
|---|---|---|---|
| D-110 | Storage for uploads and packages (brief §9, 03 §11 Q5) | A private R2 bucket binding (`CORE_FORMS_PRIVATE`) read through `cloudflare:workers` env in `src/server/platform`. Every upload is private by default; `protect_uploads` is kept but always true in effect (DV-27). | Privacy. 00 §6 workaround 1. |
| D-111 | Download access | Private uploads are served by `/_core-forms/file/<id>`, which requires an EmDash session with access to the form (WP `cf_private_download` rules). Email links point there. Packages and digital downloads use signed, expiring tokens. | WP parity: non-private links went to wp-admin too. |
| D-112 | No bucket bound (brief §9) | Uploads fall back to `ctx.media.upload`: only image, video, audio and PDF are accepted; others get `file_upload_error`. Fallback files are public by URL, and admin shows a banner. Digital packages are refused until a bucket is bound. | The only storage a plugin can write without a binding. |
| D-113 | Size limits and transport (00 §16.1.9, 03 §3.1) | WP limit 8,000,000 bytes per file (`uploadMaxFilesize` filter). JS forms pre-upload through the companion. No-JS file forms post to the companion's `/_core-forms/submit`. Without the companion, plugin multipart caps parts at 1 MiB (documented) (DV-26). | EmDash multipart limit; Workers request limit 100 MB. |
| D-114 | MIME sniffing without libmagic (03 §11 Q4) | Magic-byte sniffing for binary types. Text types (`txt`, `log`, `csv`) are accepted when the bytes are valid UTF-8 with no NUL. OOXML/ODF extensions are accepted when the file is a ZIP container. Blocked and double extensions are WP's lists (DV-25). | WP's libmagic results can't be reproduced. This applies WP's intent consistently (it rejected CSVs in practice). |

## M. Analytics

| ID | Question (source) | Resolution | Reason |
|---|---|---|---|
| D-120 | Ship analytics? storage? (02 §9.3 Q3, 03 §10.1, brief §11) | Phase 3. Per-day counter rows (`analyticsDaily`, plus a `day = "all"` row) and dimension rows (`analyticsDims`: fields, UTM, host, blocked reasons), maintained with `updateIf` delta. Raw events go to `analyticsEvents` for 30 days, or to Workers Analytics Engine when the `analyticsEngine` option is bound (no D1 raw rows then). Aggregates are kept 365 days (`cf_analytics_retention_days`). | Bounded storage; WP REST shapes come from aggregates. |
| D-121 | Default on? | Keep WP's default (`enable_analytics = 1`), with per-form tri-state and the consent filter `shouldTrackAnalytics`. See question U-6. | Fidelity; the decision is surfaced to Gaurav. |
| D-122 | "Referrers" and recommendation text (03 §11 Q12) | Keep the data, labelled "Source page host" in the UI. Recommendation messages are formatted server-side (DV-45). | WP shows a literal `%%`. |
| D-123 | Blocked accounting | Per-form counters `blocked:<formId>:<reason>` (WP `_cf_blocked_counts`, exported back into meta) plus `blocked` analytics events. | WP parity; the v0.1.0 global KV counters are dropped. |

## N. Import, export, migration

| ID | Question (source) | Resolution | Reason |
|---|---|---|---|
| D-130 | Competitor importers read live WP databases (brief, 04 §4.5) | **File-based, not deferred.** (1) The read-only exporter `wordpress/export-core-forms.php --competitors` dumps each detected plugin's raw definitions, notifications, confirmations and optional entries (WPForms Pro) into one envelope. PHP unserialization happens there. (2) The admin also accepts native **Gravity Forms**, **WPForms** and **Fluent Forms** JSON exports. CF7 WXR, Ninja `.nff` and Formidable XML are supported only through the dump envelope. All six converters are pure TypeScript and run in the browser, producing `core-forms-data` rows, with WP's importer bugs fixed (DV-31). They are built in Phase 1 as a low-priority lane (P1.21) that doesn't gate the Phase 1 milestone. | One PHP read path, one TS logic path, no guessing at vendor formats beyond three self-contained JSON exports. |
| D-131 | Required import formats (01 §9 Q8, 04 §4.6) | `core-forms-data` v1 (WP and EmDash), extended exporter output, WP-CLI `schema:1`, and the v0.1.0 array. Submissions keep WP ids when free or identical (idempotent). Every other row gets a deterministic `wp-<id>`. | Re-imports update instead of duplicating (DV-32). |
| D-132 | Import size (04 §8.4 Q6) | Client-side parsing. Batches of ≤200 rows (≤8 MiB declared body) to `data/import-batch`, followed by `data/import-finalize`. Export pages are assembled client-side. | Route body and response limits. |
| D-133 | Export format from EmDash | `core-forms-data` v1 with WP row shapes under `data`, so WP 4.11.1 can import it. EmDash-only data (files, team, revisions, field groups, customers) goes in a top-level `emdash` block, which WP ignores. Credentials are excluded unless opted in (DV-58). | Two-way portability. |
| D-134 | Data WP's native export omits (team, field groups, scopes, unsaved capacity, open outbox rows, key policy, timezone) (04 §4.6) | The extended exporter includes it under `emdash_extras`, with users mapped by email to EmDash users at import (`ctx.users.getByEmail`). Unmatched users are reported. | Lossless migration. |
| D-135 | v0.1.0 data on Gatilab (brief §3) | Re-import forms from a fresh extended export (they update in place by id), then run the `migrate` job for the few v0.1.0 test submissions (architecture §17.4). Best-effort reverse conversion when no export is available. | The v0.1.0 settings normalization was lossy; re-import restores WP truth. |
| D-136 | Uploaded files from WP | Descriptors keep their WP URLs (`legacy`). An optional `import-files` job copies public `uploads/core-forms/<slug>/` files into R2 and rewrites descriptors. Files in WP's private directory can't be fetched over HTTP and are reported. | Read-only access to the WP host. |

## O. Payments

| ID | Question (source) | Resolution | Reason |
|---|---|---|---|
| D-140 | Hosted checkout redirect (06 §7.12 Q1) | AJAX: `redirect_url` in JSON (client navigates). No-JS form submits: the `go` handoff (D-023). Native checkout: the companion endpoint issues a 303 to the provider directly. | Plugin routes can't redirect off-site. |
| D-141 | Webhook receiver (06 §2.8) | Plugin route `payments/webhook?provider=` (bytes) and the compat path `/wp-json/cf/v1/payments/{provider}/webhook`. Order: verify the signature, then dedupe the event id in `paymentEvents`, then match the submission, then enqueue `payment-event` and kick it, then return 200 fast (DV-07, DV-10). Status codes follow WP: 404, 401, 503 and 200 matched/unmatched. | Providers keep their configured URLs. |
| D-142 | WP payment bugs (06 §6) | Fix #1 (DV-07), #2 (DV-08), #4 (DV-04), #5 (DV-09), #6 (DV-03), #7 (record the last webhook per provider), #11 (DV-11), #12 (save the profile to the customer record, DV-41), #14 (D-068). Keep #3 (a return without a redirect passes through to the requested page, as WP does), #8, #9, #10 (dead keys stay inert; `payment_polar_product_id` is honoured), #13 (latest package by id; admin warns when replacing an older version). #15 is question U-4. | Bug categories only. |
| D-143 | Polar ad-hoc checkout shape (06 §7.12 Q7) | Implement WP's shape. P4.2a must verify it against the Polar sandbox and switch to a products-based checkout if the API rejects it, with the settings shape unchanged (logged as a DV). Needs a Polar sandbox token from Gaurav. | No external calls were made while writing the specs. |
| D-144 | Money | One ISO-4217 exponent table (0, 2 and 3 decimals) in `src/shared/money`, used everywhere: gateways, admin plan save, tokens, display. `parse_decimal_amount` ported exactly. Per-gateway formatting rules (PayPal integer currencies; Stripe three-decimal rounding to multiples of 10) live in `src/shared/money/gateways.ts` (DV-04). | Correct money. |
| D-145 | Atomic payment state (06 §2.6) | `updateIf` guards replace locks and transactions. Paid: `where paymentStatus ∉ {paid, refunded}`. Never downgrade. Refunds: full vs partial by amount (DV-03). | No transactions. |

## P. Licensing, products, portal

| ID | Question (source) | Resolution | Reason |
|---|---|---|---|
| D-150 | License API compatibility (06 §3.9, §7.10) | Byte-compatible shapes. HTTP 200 for every business result. Parameter aliases kept. `sanitize_title` and the `esc_url_raw` → lowercase → untrailingslash → sha256 site hash ported exactly. `item_id` is an integer. `expires` is WP datetime or `lifetime`. Served at plugin routes, `/wp-json/core-forms/v1/*` and `?edd_action=` (wpCompat). | Shipped clients. |
| D-151 | Order idempotency and natural keys | `uniques` claims: `order-source:<sha256>`, `order-number:<n>`, `license-key:<key>`, `product-slug`, `plan`, `package`, `subscription-license`, `activation`. | Correct from the first request (D-013). |
| D-152 | Seat-limit race (06 §5.6) | `licenses.activeSites` counter. Activation: claim `activation:<licenseId>:<siteHash>`, then `updateIf(license, {where: {status: active, activeSites: {lt: limit}}, delta: {activeSites: +1}})`, then write or reactivate the row, compensating if a later step fails. Deactivation decrements with a `gte: 1` guard. Daily maintenance recounts. | No `SELECT … FOR UPDATE`. |
| D-153 | Multi-row fulfillment, renewal, refund (06 §3.5–3.8) | The `fulfillment`/`reversals` documents hold the frozen snapshot and an allocate-then-write `plan` (ids, keys, rows). Steps are create-only puts. The order row is written last, and its unique claim marks completion. Renewal guards on the license's `expiresAt`. Purchased terms are never re-read from the catalog. | No transactions; exact WP outcomes. |
| D-154 | Package storage and validation (06 §7.4) | Admin uploads stream to R2 with a streaming SHA-256 (Workers `DigestStream`). A central-directory scan with ranged R2 reads (`fflate`) checks the entry count, path safety, the `Plugin Name:`/`Theme Name:` and `Version:` headers in the first 8 KB, and version equality. Downloads stream without re-hashing (DV-44). | CPU limits; private storage. |
| D-155 | Rate limiting and abuse (06 §5.7, Q8) | New per-IP limits on the license API, native checkout, access requests and the customer REST (DV-39). Turnstile on native checkout when configured (DV-40). | Security fixes. |
| D-160 | Customer identity (06 §7.7, brief §10) | Plugin-owned `customers` with magic links. WP-compatible stateless access tokens (`base64url(json).hmac`, 30 days) arrive in emails. `<portalBase>/verify` exchanges the token for an HttpOnly, Secure, SameSite=Lax `cf_portal` session cookie (30 days, sliding, stored hashed) and redirects to a clean URL (DV-42). | Plugins can't create EmDash users or set cookies. |
| D-161 | `create_user` on purchase | Creates or updates a customer record. Profile and billing fields from the purchase are saved (fixes WP #12). No WP-style account notification (DV-41). | No WP users. |
| D-162 | Portal profile editing | Allowed for verified sessions. See question U-5. | It's the only identity on EmDash. |
| D-163 | WP portal link and package link continuity (brief §10, 06 §7.6) | An import-time option: paste the legacy `AUTH_KEY.AUTH_SALT` (and optionally `NONCE_KEY.NONCE_SALT`). They are sealed and used **only to verify** tokens until 30 days after import, then deleted automatically. | Old emailed links keep working through the cutover window. |
| D-164 | Storefront, shortcodes, blocks, virtual product (06 §3.11–3.13) | Storefront at plugin routes (ETag, Cache-Control) plus compat paths (CORS `*`). Shortcodes are expanded by `renderCoreFormsInHtml`. 8 PT blocks. `?product=` and `?cf_product=` at the root through middleware. Product cards keep `cf-license-*` classes and `license-frontend.css`. | Theme and link compatibility. |
| D-165 | Abilities/MCP (06 §3.12) | Expose the commerce service methods as MCP tools on private routes, using the same 26 names where EmDash permits (`core_forms_<name>`). | EmDash has an MCP registry for plugins. |

## Q. Testing and quality

| ID | Question | Resolution | Reason |
|---|---|---|---|
| D-170 | How is parity proven? | The WP oracle: WordPress Playground (php-wasm) with the reference plugin, run offline. It generates golden fixtures for every compatibility surface. The comparator normalizes **only** documented deviations. | "Identical to live" must be checkable without touching production. |
| D-171 | E2E and accessibility | A fixture Astro + EmDash site on Node in `e2e/`, with Playwright and `@axe-core/playwright` (WCAG 2.2 AA) at phase gates. Run serially. | Real DOM, events and a11y; avoids the parallel-write wedge in Cloudflare local dev. |
| D-172 | Bundle size | CI brotli budgets per bundle and a default-embed total of ≤ 7.5 KB. | Brief §12. |

---

## DEVIATIONS

Every observable difference from WordPress 4.11.1 behaviour is listed here. Anything not listed must match WP. The golden comparator (`tests/golden/normalize.ts`) may normalize only the deviations marked **(norm)**.

### Bug fixes (security, data, money, privacy, accessibility)

| ID | Cat | WP 4.11.1 | Port | Reason |
|---|---|---|---|---|
| DV-01 | PRIV | `wp_mail` sends Bcc as Bcc; v0.1.0 sent Bcc as Cc | With the EmDash transport, every Bcc address gets a separate send with no Cc, so it is never exposed. Direct transports send a real Bcc. | Brief §2. |
| DV-03 | MONEY | Any `charge.refunded`, `PAYMENT.CAPTURE.REFUNDED` or `refund.*` marks the submission refunded and revokes licenses | Only a full refund (refunded amount ≥ captured amount) sets `refunded` and runs the reversal outbox. A partial refund records `paymentRefundedMinor` and an order and commerce event, and keeps `paid`. | Brief §2. |
| DV-04 | MONEY | Zero-decimal lists are inconsistent (MGA), the admin plan save ignores the exponent, there are no 3-decimal currencies, PayPal sends 2 decimals for JPY | One ISO-4217 table with per-gateway rules (D-144). Imported plan prices are kept as stored, with mismatches flagged in Health. | Brief §2. |
| DV-05 | SEC | The math captcha hash depends only on the answer and can be replayed forever across forms | `HMAC(formId\|answer\|exp\|nonce)` with a challenge TTL of 2 h, single-use through `math:<nonce>`. Same markup and field names. | Brief §2. |
| DV-06 | SEC | No server memory of solved tokens | reCAPTCHA, Turnstile and hCaptcha tokens are hashed into `captcha:<sha>` (15 min) and rejected on reuse. | Brief §2. |
| DV-07 | MONEY | A validly signed but unhandled event type returns 401, so providers retry and may disable the endpoint | 200 `{received:true, ignored:true}` after verification. | Brief §2. |
| DV-08 | MONEY | Stripe Checkout Session create has no `Idempotency-Key` | `Idempotency-Key: sha256("cf-stripe-session-{sid}")`. | Prevents duplicate sessions on retry. |
| DV-09 | SEC | One webhook secret shared by test and live | `webhook_secret_test` / `webhook_secret_live`, falling back to the legacy `webhook_secret`. | Mode-specific provider secrets. |
| DV-11 | PRIV | Customer REST and portal return `SELECT *` order rows, including `source_key` and `payment_id` | Explicit field allowlists. | Data leak. |
| DV-12 | DATA | The honeypot accepts the first `_cf_h*` key, so headless posts can hit `_cf_headless` and get a silent fake success | Exact `_cf_h{ID}`. | Lost submissions. |
| DV-13 | DATA | No-JS submits validate against the **draft** definition when draft publishing is on | The live definition. | Submissions accepted or rejected against unpublished fields. |
| DV-14 | DATA (norm) | AJAX forms have no `action` attribute and show a `<noscript>` "enable JavaScript" notice, so they can't be submitted without JS | The `action` attribute is always set and the notice is omitted; no-JS posts use PRG. | Lost leads; v0.1.0 behaviour kept. |
| DV-16 | A11Y (norm) | Raw-HTML forms are never prefixed, so two copies of one form on a page duplicate ids | First instance unchanged; later instances get the `cf-form-{ID}-{n}-` prefix with `for`/`aria-*` references remapped. | Broken label association (WCAG 1.3.1, 4.1.2). |
| DV-17 | A11Y | `cf_enhance_accessibility` assigns `autocomplete="name"` to `first_name`/`last_name` (substring order) | `first_name` → `given-name` and `last_name` → `family-name` are checked before `name`. All other mappings unchanged. | WCAG 1.3.5. |
| DV-18 | A11Y | `accessibility.js` **replaces** `aria-describedby` with the error id (losing the description), and re-enables a submit button that started disabled | Appends the error id and restores the original `disabled` state. Same classes, ids (`{id}_error`) and inline style. | WCAG 1.3.1. |
| DV-19 | DATA | Drafts run `sanitize_text_field`, which strips newlines and tags | Drafts store values like submissions (trimmed, raw) and escape on output. | Lost textarea content on resume. |
| DV-20 | DATA | Resume fills values without dispatching events, so conditionals and calculations stay stale | Dispatches `input`/`change` after filling, then jumps to the step. | Wrong totals and hidden fields. |
| DV-21 | MONEY/SEC | Inline Stripe: a second submit posts a second submission, and the capture-phase handler bypasses reCAPTCHA | Submit is locked once `data-cf-inline-ready="1"`. The CAPTCHA token is obtained through the shared pre-submit hook before the payment POST. | Duplicate charges and orders; CAPTCHA-protected forms failing. |
| DV-22 | SEC | `fullscreen.js` interpolates `placeholder`/`pattern` unescaped | Escaped. | Markup injection. |
| DV-24 | DATA | A poll "Other" with empty text fails **after** earlier option rows are written; the Other text is uncapped | Validate first, then write. 200-char server cap. | Partial votes. |
| DV-27 | PRIV | Non-protected uploads are public URLs; descriptors carry the server `dir`; webhook and Sheets payloads leak paths | Every upload is private (R2). Descriptors drop `dir` and add `file_id`. Links go to the admin download route. Payloads carry public descriptors (`name, original_name, size, type, url`). | Privacy. |
| DV-28 | DATA | Renaming a data column runs `str_replace('"old":','"new":')` over the JSON, which also rewrites matching text inside values | Renames the key only. | Corruption. |
| DV-29 | DATA | Editing an array field saves one `"a\nb"` string | Split on newlines back into an array when the stored value was an array. | Corruption. |
| DV-30 | DATA | `modified_at` is written in site-local time while `submitted_at` is UTC | Both UTC. | Wrong expiry and ordering. |
| DV-31 | DATA/PRIV | Competitor importer bugs: WPForms entry keys don't match field names; Fluent keeps only the last notification; GF imports inactive notifications as active; GF operators other than `is` are treated as `is` | Fixed. Inactive notifications import with `enabled: "0"`. Unsupported operators skip the condition, with a warning. | Wrong data, unexpected emails. |
| DV-32 | DATA | Re-importing duplicates submissions and replies | Deterministic ids, so a re-import updates. | Duplicates. |
| DV-39 | SEC | No rate limits on the license API, native checkout, access requests or customer REST | Per-IP sliding limits: license 60/min, checkout 10/min, access 5 per 5 min per email+IP (WP's throttle kept), customer REST 30/min. | Abuse. |
| DV-40 | SEC | Native free checkout is protected only by a honeypot and nonce | Turnstile is added when configured. | Spam records. |
| DV-42 | PRIV | The portal access token stays in URLs and hidden fields (Referer leakage) | Exchanged for an HttpOnly session, then redirect to a clean URL. The token format is unchanged. | Privacy. |
| DV-43 | SEC/MONEY | No event-id dedupe; Razorpay has no replay window | `paymentEvents` dedupe by provider event id (Polar `webhook-id`, Stripe `id`, PayPal `id`, Razorpay `x-razorpay-event-id`). | Replays. |
| DV-44 | SEC | Release ZIPs are public Media Library attachments | Private R2 with signed downloads; sha256 checked at upload. | Bypassable paywall. |

### Platform-forced changes

| ID | WP 4.11.1 | Port | Reason |
|---|---|---|---|
| DV-02 | Per-form and per-action `From:` via `wp_mail` | Honoured only by direct transports (Resend, Emailit). The EmDash transport uses provider From and moves From into Reply-To when none is set. The admin explains this. | `EmailMessage` has no from (brief §8). |
| DV-10 | Fulfillment runs synchronously inside the webhook request | The webhook returns 200 after recording; fulfillment runs as a kicked `payment-event`/`fulfillment` job. | Workers time limits; provider retries. |
| DV-15 (norm) | `_wpnonce`/`_wp_http_referer` emitted and verified when `enable_nonce` | Not emitted. The setting is imported and inert. CSRF comes from EmDash's Origin check. | No WP nonces; cache-safe. |
| DV-25 | `finfo` (libmagic) MIME detection | Magic-byte sniffing (D-114). CSV and TXT are accepted when the content is text; OOXML/ODF are accepted as ZIP containers. | No libmagic on Workers. |
| DV-26 | PHP accepts any upload size up to `cf_upload_max_filesize` (8 MB) | The same 8 MB with the companion (pre-upload or companion submit). Without it, 1 MiB per file. | EmDash multipart limit. |
| DV-34 | Action logs are never purged | Event rows are purged after 90 days (configurable; `0` keeps forever). Ledger rows are kept. | D1 size. |
| DV-35 | A WP-only action logs `failed` "No available handler…" | Logs `skipped` with reason `wp_only`. | WP integrations are skipped by design. |
| DV-36 | Actions run inline before the JSON response | Inline-phase actions run before it; the others run in a durable job kicked in `after()`. Order, conditions and ledger semantics are unchanged. | Workers latency and limits. Durable retries. |
| DV-37 | Unsaved-submission (`save_submissions = 0`) actions run inline, with no retry | One durable attempt per action through the job. The payload is scrubbed once the job ends. | Same, without storing the submission. |
| DV-41 | `create_user` creates a WP subscriber and sends WP's notification | Creates a plugin-owned customer; the portal access email is the login. | Plugins can't create EmDash users. |
| DV-47 | `CF_POST_ID`/`CF_POST_TITLE` via `url_to_postid`; `CF_USER_*` and `{{user.*}}` from the logged-in WP user | Resolved from the form-usage index by referer path (EmDash entry id and title). `CF_USER_*` and `{{user.*}}` are empty on public submits; on admin replay and test they use the acting admin. | No visitor identity in public routes. |
| DV-49 | No-JS submits `wp_redirect` to any host | Same-origin targets get a direct 303. Off-site targets go through the companion `go` handoff, or show the success message without the companion. | Public plugin routes can only redirect same-origin. |
| DV-50 | `require_user_logged_in` checks the WP session | `<CoreForm>` embeds a 2-hour signed token when `Astro.locals.user` exists, and marks the response private. The submit verifies it. | Public routes see no user. |
| DV-51 | `standalone_base_slug` is a runtime option with rewrite flush | Build-time `standaloneBase`; the setting is informational. | Injected routes are static. |
| DV-52 | FormUsage runs a `LIKE` scan of `post_content` (over-matches `"id":N`) | A usage index maintained by `content:afterSave`/`afterDelete` plus a weekly rescan. | No content search API. |
| DV-53 | WP privacy exporter and eraser | Admin Tools → Privacy (same matching and erase rules). | No EmDash privacy hooks. |
| DV-54 | Customizer CSS written to `uploads/core-forms/form-theme-custom.css` and enqueued as a file | The same CSS (byte-identical) inlined as `<style id="core-forms-theme-custom">` immediately after `form-theme.css`. | No writable uploads directory; same cascade. |
| DV-57 | WP-CLI commands | Node CLI plus MCP tools over admin routes; doctor checks adapted (architecture §19). | No plugin CLI hook. |
| DV-60 | `cf_poll_voter` cookie set server-side on page render (HttpOnly) | Set by the companion's poll vote endpoint (HttpOnly). Without the companion, `poll.js` sets a first-party cookie. | Plugin routes can't set cookies. |
| DV-61 | Authoring REST `cf/v1/*` and native `wp/v2/core-form` guards | Not exposed; the admin uses plugin routes. | Not a compat surface. |
| DV-62 | `edit_forms`/`manage_options`/`unfiltered_html` capabilities | EmDash Admin plus per-user grants and scopes (D-091). | No WP capabilities. |
| DV-63 | Twilio inbound returns TwiML from the WP REST route | TwiML comes from the companion endpoint; the plugin route returns 204. | Plugin routes can't return XML. |
| DV-64 | Inbound webhook URLs live under `/wp-json/...` | Same URLs with `wpCompat`; otherwise the new plugin route URLs must be registered at Resend, Meta and Twilio. | Path params. |
| DV-65 | Package links point at `admin-post.php?action=cf_license_package` | New signed path `/_core-forms/package` with the same signature scheme. Old links expire within 15 minutes anyway. | No admin-post. |
| DV-66 | License, storefront and customer REST under `/wp-json/core-forms/v1/*` only | Also at plugin routes. CORS only via the compat paths. | Platform. |
| DV-70 | Uninstall honours `delete_data_on_uninstall` | Config plugins never receive `plugin:uninstall`. Tools → Danger zone "Delete all Core Forms data" (and the hook, when fired) removes all collections' rows, KV keys and R2 objects, validating R2 ownership first. | 00 §2. |
| DV-71 | Column rename and delete run inline in the admin request | Run as `column-rewrite` jobs. | Request limits. |
| DV-72 | CSV streamed by PHP | CSV assembled in the browser from JSON pages; bytes identical. | 8 MiB raw limit. |
| DV-73 | Submission search is `data LIKE %term%` over raw JSON | A bounded value scan (D-019). | No substring search. |
| DV-76 | Akismet through the Akismet plugin, with a bypass for `edit_posts` users | Direct REST with its own API key; no bypass on public submits. | No Akismet plugin. |
| DV-77 | IPs from `REMOTE_ADDR` (and the Akismet header cascade) | `cf-connecting-ip` (`requestMeta.ip`). | Workers. |
| DV-78 | `delete_submission` uses a transaction plus `FOR UPDATE` | An `erase` job with ordered idempotent steps (files, then cascades, then the submission row last). Refusal rules are unchanged. | No transactions. |

### Additive, documented-behaviour and presentation changes

| ID | Cat | WP 4.11.1 | Port |
|---|---|---|---|
| DV-23 | ADD | The `loading_text` setting is never rendered | Emitted as `data-loading-text` on the first submit button when the button lacks it. |
| DV-33 | ADD | Email log resend writes no log | Writes a new log row linked to the original. |
| DV-38 | ADD | No per-action enable flag | `enabled` (default true; WP data has none, so behaviour is unchanged). |
| DV-45 | ADD | Recommendation messages contain literal `%%`; "referrers" are really page hosts | Formatted server-side; UI label "Source page host"; data unchanged. |
| DV-46 | PLAT/PRIV | `ip_hash = sha256(ip.AUTH_SALT.date)`; raw events kept 365 days | Keyed by the plugin HMAC key. Raw events kept 30 days (or in Analytics Engine); aggregates 365 days. |
| DV-48 | DOC | `{{url_params.*}}` and `{{post.*}}` only resolve at submit time, so hidden UTM fields always get their fallback | Also expanded at render time (escaped). Submit-time expansion is kept. |
| DV-55 | ADD | `turnstile_failed` resolves to an empty error message | Fallback text at response time; no new `data-message-*` key. |
| DV-56 | ADD | No native hCaptcha | `enable_hcaptcha` per form (EmDash extension). |
| DV-58 | SEC | The data export includes credentials; import replaces settings wholesale, secrets included | Credentials are excluded unless "Include credentials" is ticked. Credentials are imported only when "Import credentials" is ticked. |
| DV-59 | ADD | Preview shows the saved draft | Previews the unsaved draft (v0.1.0 behaviour). Rehearsal works from the preview iframe. |
| DV-68 | ADD | Portal profile editing only for logged-in WP users | Allowed for verified portal sessions (pending U-5). |
| DV-69 | ADD | The email-log detail modal works only for the latest 100 logs | Fetched by id. |

---

## KEPT (WordPress quirks deliberately replicated)

- `enable_honeypot` is inert; honeypot failures answer with the literal default success text (D-024).
- HTTP 200 for business errors; spam answers success (with `redirect_url`) and runs no actions (D-020).
- Rate limit counted only for storable outcomes, sliding TTL; the duplicate fingerprint is set only after a successful insert, so it is inert when submissions aren't saved (D-028, D-086).
- Substring autocomplete map and `text` → `tel`/`email`/`url` coercion (`hotel` → `tel`) (D-025).
- `nl2br` inside data variables, with per-action plain-text compensation (D-026).
- The schedule-closed HTML replacement vs the `form_closed` submit error; login wins over limit, which wins over schedule, at render (D-028).
- Industry template `attributes.min`/`step`/`maxlength` ignored (D-027).
- `forms.js` writes `form.dataset[fieldName]` for button rules. Fullscreen fires only a non-bubbling `cf-success` and ignores conditionals (D-056).
- Calculation failures reject with 422; `"1.0E+25"` fails (D-057).
- Run keys exclude settings content; delivery is at-least-once (D-103).
- Emailit 409 without audiences fails; Discord `"0"` → `"—"`; Slack entity text; Telegram chat-id rewrite (D-109b).
- Draft polls accept votes; poll results are public; misleading `vote_limit` semantics are kept as data, but **UI labels describe the real behaviour** (D-059).
- License API: `deactivate_license` always returns success; disabled licenses report `license: "expired"`; `get_version` ignores activation; "latest package" means the highest id (D-142).
- `payment_required` is inert; a payment return without a redirect renders the requested page (D-142).
- No email-log retention (D-077).
- `cf_field_value` date reformatting of 10-character date-looking strings with the site `date_format` (D-018).

---

## v0.1.0 drift being reverted (brief §3)

| v0.1.0 | Restored WP behaviour | Decision |
|---|---|---|
| `data-ajax`, `data-hide-after-success`, `data-success-scroll`, `data-captcha`, fixed message set | `data-ajax-submit` + the six flags + every `data-message-*` | D-020c |
| Message rendered with `textContent` | `innerHTML` of server-sanitized HTML | D-020c |
| Every raw-HTML id prefixed `cf{n}-` | No prefix on the first instance | D-051, DV-16 |
| `.cf-form.cf-theme` theme scoping and the `cf-theme` class | `.cf-form` selectors; theme loaded per tri-state | D-050 |
| Spam folded into `status` (`spam`, `trash`) | `isSpam` flag + the WP status union | D-071 |
| `normalizeSettings` dropping about 50 keys and typing values | Raw `_cf_settings` + `FormSettingsView` | D-025b |
| Schedule collapsed to UTC instants | WP dates, days, windows and timezone | D-059b |
| Webhook `{form, submission, data}` envelope; missing `content_type` → `json`; `k[]` arrays | Flat data; default `form`; `http_build_query` | D-102 |
| `captcha` per-form enum | WP flags + `enable_hcaptcha` | D-080, D-081 |
| Actions ignore `conditions`; Bcc sent as Cc; 1-based `action-N` ids | Conditions; Bcc private; 0-based `_cf_action_id` | D-101, DV-01, D-100 |
| Invented messages `rate_limited`, `too_long`; different `form_closed` text | WP's 21 messages + literals | D-020 |
| 4xx statuses (422/429/400) | WP statuses | D-020 |
| Duplicate = success after 10 min, IP-hash scope | `duplicate_submission` error, 1 h, user-or-IP scope | D-028 |
| Size limits 20 KB/200 KB/200 fields | WP `maxlength`/254/60 KiB | D-026b |
| Auto-appended submit button | Never added | D-020c |
| CSV columns and the `'` formula guard | WP headers and the `\t` guard | D-073 |
| Public `render` route | Internal route | D-007 |

---

## QUESTIONS (need Gaurav; product or business only)

Each question has a recommended default. Work proceeds on the default unless Gaurav says otherwise. None of them blocks Phase 1, except that U-1 is needed before the Gatilab cutover gate.

| ID | Question | Recommended default |
|---|---|---|
| U-1 | **Email delivery for gatilab.com** (41 forms send notifications, 14 send autoresponders). Use an EmDash email provider (Cloudflare Email: From is fixed by the provider, Bcc becomes separate sends), or a direct **Emailit** or **Resend** transport (per-form From, real Bcc)? Which sender domain? | **Emailit direct transport**, with the From address WordPress uses today. Core Forms already integrates Emailit, and per-form From keeps working. |
| U-2 | **Commerce cutover.** Will gatilab.com (SureCart today) and/or gauravtiwari.org (FluentCart today) move their stores and license servers to Core Commerce on EmDash, and in what order? This decides whether `/wp-json` license paths, legacy salts and provider webhook continuity must be production-ready on Gatilab at the Phase 4 gate. | Build the full compatibility layer in Phase 4. Move no store until Phase 4 passes. If one moves, the gauravtiwari.org Core Forms license server goes first, because its clients use the EDD-compatible API this port reproduces. |
| U-3 | **Public package identity and model.** Keep `@gatilab/emdash-core-forms`, GPL-2.0-or-later, fully free on npm (no Pro gate, no license check), with 1.0.0 at the Phase 1 gate? | Yes to all. GPL is inherited from the WordPress plugin. |
| U-4 | **Commerce behaviour beyond 4.11.1:** renewal reminder emails before `expires_at`, and auto-expiry of `pending_payment` submissions after N days (they never expire in WP). | Not in this port. Ship parity in Phase 4 and add both later as opt-in settings. |
| U-5 | **Customer portal profile editing.** In WP only logged-in WordPress users could edit name and billing details. On EmDash, customers sign in with magic links. Should verified portal sessions edit their profile and billing details? | Allow it. Changes are logged as commerce events. |
| U-6 | **Analytics default for new installs.** WP tracks views, starts, field interactions and abandonments by default (IP hashed daily). Keep it on by default for the public package, or default it off and let sites opt in? | Keep it on (WP parity). Gatilab's imported forms keep their per-form settings either way. |

### Answers (Gaurav, 2026-10-05)

| ID | Answer | Effect |
|---|---|---|
| U-1 | **Emailit direct transport** for gatilab.com. | The Gatilab cutover (P1.22) configures the Emailit transport with the sender WordPress uses today. Needs the Emailit API key and sender domain from `~/.env` or Gaurav at cutover. |
| U-2 | **No store will move.** Commerce stays a product feature for other EmDash users. | Phase 4 still ships the full WP compatibility layer (it serves other sites migrating from Core Forms for WordPress), but nothing needs to be production-ready on gatilab.com or gauravtiwari.org, and legacy-salt continuity (D-163) is only an import option. |
| U-3 | **Yes**: `@gatilab/emdash-core-forms`, GPL-2.0-or-later, free, 1.0.0 at the Phase 1 gate. | As planned. `npm publish` still waits for Gaurav's go-ahead. |
| U-4 | Default taken: not in this port. | Renewal reminders and pending-payment expiry are later opt-in features. |
| U-5 | Default taken: allowed. | Verified portal sessions can edit profile and billing details (DV-68). |
| U-6 | **On by default**, as in WordPress. | `enable_analytics = 1` default kept (D-121). |
