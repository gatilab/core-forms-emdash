# 12 · Build plan

This plan turns `10-architecture.md` and `11-decisions.md` into work packages that several implementation agents can run in parallel. It is organized in four phases:
1. forms platform (engine, smart forms, admin, data)
2. workflows and integrations
3. analytics
4. payments, licensing and portal

Every package names the directories it owns. Two packages that run at the same time never own the same path.

---

## 0. Rules for every work package

### 0.1 Ownership and shared seams

- **Ownership.** A package edits only the paths it owns, plus its own tests (`tests/<module>/`) and e2e specs (`e2e/specs/<module>/`). Unowned files are read-only.
- **Pre-wired seams.** Registries that many packages contribute to are created up front with stubs, by P1.0a, or by the phase's contract package (P2.0, P3.0, P4.0). A package fills in **its own stub file** and never edits the registry list. The seams are:
  - route registry `src/server/routes/registry.ts`
  - collections `src/server/storage/collections.ts`
  - job kinds `src/server/jobs/kinds.ts`
  - maintenance tasks `src/server/jobs/maintenance.ts`
  - admin pages `src/admin/index.tsx` and `src/server/admin-config.ts`
  - companion routes `src/site/routes.ts`
  - action modules `src/core/actions/registry.ts`
  - io mappers `src/core/io/mappers/<dataset>.ts`
  - API contracts `src/shared/types/api/<module>.ts`
- **UI slots.** These are created in Phase 1 so later phases plug in without editing Phase 1 files:
  - editor tabs: `registerEditorTab`, from P1.17
  - settings sections: `registerSettingsSection`, from P1.17
  - submission detail cards: `registerSubmissionPanel`, from P1.19b
  - action card extras: `registerActionCardExtra`, from P1.17
  - markup filters and HTML filters (P1.5)
  - HTML expanders for shortcodes (P1.14)
  - submit branches (the payment step, P1.6)

### 0.2 Branches and merging

| Branch | Role |
|---|---|
| `main` | Stays at the last cutover-ready tag (`v0.1.0` now). This is what `emdash-next` links. |
| `next` | Integration branch. |
| `pkg/<id>` | One branch and one git worktree per package, all under one sibling folder: `git worktree add ../core-forms-emdash-wt/<id> -b pkg/<id> next`. Each worktree runs its own `pnpm install`. |

The repo has no remote. A package is merged into `next` locally by the coordinator after review, once `pnpm verify` passes in its worktree. Phase gates fast-forward `main` (D-008). The main checkout (`~/Development/core-forms-emdash`) always stays on `main`, because `emdash-next` links that directory.

### 0.3 Definition of done, sizes and parallelism

**Definition of done** for every package:
- `pnpm verify` is green: typecheck (strict), lint with import boundaries, unit tests, parity tests, asset budgets, `astro check`.
- Acceptance checks are written as automated tests wherever possible.
- New public behaviour is listed in the package's merge commit message with its D/DV ids.
- **No unlisted deviation from WP.** If you find one you can't avoid, add a DV entry to `11-decisions.md` in the same PR. That file is the only cross-package doc any package may append to.

**Sizes** (rough, including tests): S < 1k LOC, M 1–3k, L 3–7k, XL > 7k.

**Parallel marks:** ⇉ runs in parallel with the other packages of its wave; → is sequential.

**Hard rules for agents:**
- Never contact gatilab.com or any production WordPress. WordPress behaviour comes only from the offline WP oracle (P1.1) and the specs.
- Never run concurrent write loads against a Cloudflare dev worker (local-dev gotcha). E2E runs serially.
- Never change stored-data shapes or route contracts without updating `src/shared/types` in a contract package.

---

## Phase 1: Forms platform (engine, smart forms, admin, data)

**Goal.** Ship everything Gatilab and any WP 4.11.1 forms user needs, excluding workflows beyond email, autoresponder and webhook; analytics; and commerce. Phase 1 ends as **v1.0.0**.

### Waves

```
Wave 0  → P1.0a Contracts & skeleton            ⇉ P1.1 WP oracle & golden corpus
Wave 1  ⇉ P1.0b Server infrastructure  ⇉ P1.0c Platform spikes & e2e site  ⇉ P1.2 Primitives
        ⇉ P1.3 HTML toolkit  ⇉ P1.12 Client core  ⇉ P1.13 Client smart & fullscreen
        ⇉ P1.16 Templates (needs P1.1 dumps)  ⇉ P1.17 Admin shell/forms/settings/theme (UI on contracts + mocks)
        ⇉ P1.19b Submissions admin UI (on contracts + mocks)
Wave 2  ⇉ P1.4 Schema system  ⇉ P1.7 Form store & authoring  ⇉ P1.8 Smart forms server
        ⇉ P1.9 Spam & privacy  ⇉ P1.10 Files & uploads  ⇉ P1.11 Action runtime core & mail
        ⇉ P1.14 Astro & companion  ⇉ P1.15 Polls  ⇉ P1.20 Data portability & ops
Wave 3  ⇉ P1.5 Render pipeline  ⇉ P1.6 Submission pipeline  ⇉ P1.18 Visual builder & audit
        ⇉ P1.19a Submissions server  ⇉ P1.21 Competitor importers (non-gating)
Gate G1a (Gatilab cutover) → P1.22 [emdash-next] Gatilab integration & cutover
Gate G1  → P1.23 Docs & release 1.0.0
```

The critical path runs P1.0a → P1.0b → P1.3 → P1.4 → P1.5 and P1.6 → P1.14 integration → G1a. Expect 8–10 agents active in waves 1–3.

---

### P1.0a Contracts & skeleton (M) · Wave 0 · sequential, blocks everything

**Goal.** Create the v1 skeleton so every other package can code against stable contracts.

**Owns**
- `package.json` (exports per architecture §2.1, scripts `verify`, `build:assets`, `oracle:*`, `e2e`)
- `tsconfig.json`, `tsconfig.client.json`, `vitest.config.ts`, `eslint.config.js` (import-boundary rules, architecture §4)
- `AGENTS.md`
- `scripts/build-assets.mjs` (esbuild IIFE, CSS minify, manifest, brotli budgets)
- `scripts/gen-routes.mjs`, which generates `ROUTES.md`
- `src/index.ts`, `src/runtime.ts`
- `src/shared/types/**`: all of architecture §5, plus `api/*.ts` for every Phase 1 route in §8.2
- the registry files listed in §0.1, with stub entries for every Phase 1 module and every collection of **all phases** (architecture §6.2)
- stub files: every module file in the architecture §3 tree, exporting typed signatures that throw `NotImplemented`
- `src/admin/lib/**`: v0.1.0's `api.ts`, `navigation.tsx`, `ui.tsx` and `styles.tsx` carried over, with `callRoute` made generic over the API contracts

**Steps**
1. Tag `v0.1.0` on `main`.
2. On `next`, remove v0.1.0's `src/` (kept in history).

**Provides.** Every interface in architecture §5, route contract types, and the registries.

**Acceptance**
- `pnpm verify` passes on stubs.
- `gen-routes` lists every Phase 1 route with its kind and permission.
- A test asserts that `collections.ts` matches architecture §6.2 exactly: names, indexes, phases.
- The boundary lint fails on a deliberate bad import (fixture test).
- `build:assets` emits an empty manifest without errors.

---

### P1.1 WP oracle & golden corpus (L) · Wave 0 · ⇉ P1.0a

**Goal.** Make WP 4.11.1 behaviour checkable offline (D-170).

**Owns:** `tools/wp-oracle/**`, `tests/golden/**`, `tests/fixtures/**`, `tests/golden/normalize.ts`.

**Approach**
- WordPress Playground CLI (php-wasm) with `.reference/core-forms-wp` mounted as a plugin.
- A blueprint seeds forms from `tests/fixtures/gatilab/core-forms.json`: a copy of `emdash-next:migration/data/core-forms.json`, plus the extended export once P1.22 provides it. It also seeds global settings, theme tokens and synthetic corpora.
- PHP scripts call real WP functions and write JSON goldens.
- Determinism: freeze time (`pre_option`, a `current_time` override), reset `wp_unique_id`, and stub `wp_rand`/`random_bytes` through filters where WP allows. Anything left nondeterministic is normalized and documented.
- **Fallback** if php-wasm lacks the DOM/libxml extension: `@wordpress/env` (Docker) running the same scripts. Mark the run environment and libxml version in `tests/golden/meta.json`.

**Golden sets**

| Set | Contents |
|---|---|
| `render` | `get_html()` for the 54 Gatilab forms, 63 templates and a schema corpus; standalone documents |
| `a11y` | `cf_enhance_accessibility` output for ≥300 fragments |
| `parse` | `MarkupParser::parse` and `repair_legacy_schema` |
| `validate` | `FieldValidator` error codes |
| `vars` | `cf_replace_data_variables` and `cf_template` (≥120 tokens) |
| `pipeline` | `Forms::process` scenario matrix: response, status, stored row, captured `wp_mail` and `pre_http_request` |
| `actions` | email, autoresponder, webhook (json/form/arrays/files/signed) |
| `csv` | global and per-form exports |
| `theme` | `FormTheme::css` and the sanitizer |
| `calc` | evaluate and process (≥300 expressions) |
| `php` | `sanitize_title`, `esc_url_raw`, `sanitize_text_field`, `is_email`, `http_build_query`, `number_format`, `round`, `json_encode`, `date()` formats |
| `schedule` | `is_open` matrix |
| `templates` | JSON dump of all 63 templates |
| `audit` | `AccessibilityTester` reports and autofix |
| `summary` | `SubmissionPresentation` titles and previews |
| `io` | a `core-forms-data` export of a seeded site |

Phases 2 and 4 add scripts under `tools/wp-oracle/scripts/<area>/`. Those paths are owned by their packages.

**Acceptance**
- `pnpm oracle:all` regenerates every golden byte-identically twice in a row.
- Corpus counts are as listed.
- `normalize.ts` handles only DV-14, DV-15, DV-16 and nonce/instance-counter differences, with a unit test per rule.
- It makes no network calls after the first WordPress download, which is cached.

---

### P1.0b Server infrastructure (L) · Wave 1 · ⇉

**Goal.** Build the EmDash adapter core that every server package runs on.

**Owns**
- `src/server/{plugin.ts, context.ts, platform/**, storage/**}` (not `collections.ts`)
- `src/server/{settings,secrets,events,extensions,jobs,http}/**` (not the registry lists)
- `src/server/routes/framework.ts`
- `src/core/settings/**`
- `tests/harness/**`

**Depends on:** P1.0a.

**Provides**
- `CfContext` builder
- base repositories, `IdService` (KV sequences), `UniqueIndex`, `EphemeralStore` (sliding `bump`), `LockService`, `CounterStore`
- the global settings document (WP deep-merge rules, `emdash` subtree, secret sealing via `encryptPluginSetting`, plaintext fallback with a warning)
- `FormSettingsView` with the default and message tables (spec 01 §1.3–1.4), plus the module-defaults registry
- the event bus and extension registry (`registerCoreFormsExtension`)
- `HttpClient` (`ctx.http` + timeouts + WP SSRF pre-checks)
- the job queue: enqueue, kick, claim, outcomes, stale recovery, `tick`, `ensureCron`, the maintenance scheduler, and the `ephemeral-sweep`/`jobs-sweep` tasks
- the route framework (public/internal/workspace/admin kinds, access grants and scopes, rate-limit helper, error mapping, raw responses)
- `plugin.ts`, which assembles `definePlugin` from the registries

**Harness:** `FakeStorage` (AND-only, index-declared fields only, limit ≤ 100, cursors, count, CAS, `updateIf` delta and guards, `getMany` ≤ 50), `FakeKV`, `FakeCron`, `FakeEmail`, `FakeHttp`, `FakeR2`, `FakeMedia`, a clock, `after()` capture, `runRoute`, `runTick`.

**Acceptance**
- **Storage and primitives.**
  - The fakes reject OR, undeclared fields and `limit > 100`.
  - 100 concurrent `ids.next()` return unique, increasing ids.
  - `ephemeral.bump` slides the TTL on each bump.
  - A lock busy past `waitMs` throws `LockBusy`.
- **Jobs.**
  - The tick claims at most 25 jobs within budget.
  - Stale running jobs are recovered per `onStale`.
  - Backoff and maxAttempts are honoured.
  - `ensureCron` schedules once per isolate and per flag version.
- **Settings and routes.**
  - The settings merge matches WP for each provider and keeps unposted providers.
  - Secrets round-trip with and without `EMDASH_ENCRYPTION_KEY`.
  - Access matrix tests cover each route kind, including the per-id scope check on bulk input.
  - The `plugin.ts` route names equal `ROUTES.md`.

---

### P1.0c Platform spikes & e2e fixture site (M) · Wave 1 · ⇉

**Goal.** Prove the EmDash and Astro assumptions the architecture relies on, and stand up the e2e site.

**Owns:** `e2e/site/**`, `e2e/playwright.config.ts`, `e2e/specs/spikes/**`, `docs/port/13-spike-results.md`.

**Spikes**, each a Playwright or vitest check with a written result:
1. `locals.emdash.handlePluginApiRoute` invoking a **private** route without a user, from an Astro page and from an injected endpoint.
2. Cron in `astro dev` (NodeCronScheduler) runs our `tick`.
3. `?url` imports of `dist/assets/*` work in components **and** in plugin server code (for preview asset lists).
4. `form-data` routes accept `sendBeacon` urlencoded bodies; `bytes` routes accept GET with a query (license API, D-150).
5. A raw 303 `location` same-origin response from a public route.
6. `encryptPluginSetting` is importable and works.
7. `cloudflare:workers` env bindings (R2) resolve in dev and in the build.
8. `injectRoute` patterns outrank the site's catch-all.
9. `content:afterSave` fires for imported entries.

The e2e site is Astro + EmDash on Node with local SQLite if EmDash supports it; otherwise `@astrojs/cloudflare` with wrangler local and `--concurrency 1`. It links this package and seeds three forms.

**Acceptance**
- Every spike is recorded as pass, or fail with a workaround.
- Any fail that changes the architecture is raised as a DV or D update before the dependent package starts.
- `pnpm e2e` boots the site and passes a smoke test.

---

### P1.2 Primitives (M) · Wave 1 · ⇉

**Goal.** PHP and WordPress-compatible building blocks, plus money and time.

**Owns:** `src/shared/{php,money,time,crypto,csv}/**`.

**Provides**

| Area | Functions |
|---|---|
| Truthiness | `phpEmpty`, `phpTruthy` |
| Sanitizers | `sanitizeTitle`, `escUrlRaw`, `sanitizeTextField`, `sanitizeTextareaField`, `sanitizeKey`, `sanitizeEmail`, `isEmail` |
| Encoding | `httpBuildQuery`, `rawurlencode`, `jsonEncodePhp` |
| Formatting and strings | `numberFormat`, `phpRound`, `ucfirst`, `ucwords`, `mbSubstr`, `strlenBytes`, `nl2br`, `wpautop` (replies only) |
| Escaping | `escHtml`, `escAttr`, `escTextarea` |
| Money | the ISO-4217 table, `parseDecimalAmount`, `toMinor`, `toMajor`, `formatMoney` |
| Time | `toWpDateTime`, `fromWpDateTime`, `wpDate(format, instant, tz)`, tz helpers |
| Crypto | `sha256`, `hmacSha256`, `hmacSha1`, `md5` (WebCrypto in Workers, `node:crypto` in tests), `base64url`, `ulid` |
| CSV | `cfCsvRow` |

**Acceptance**
- Every function equals the `php` goldens. Corpus: ≥200 `sanitize_title` inputs including Unicode and accents; nested, boolean, null and Unicode `http_build_query` cases; PHP `round` half-away cases with precision; PHP `date()` formats used by WP defaults.
- Money: every ISO currency's exponent, and the `parse_decimal_amount` cases from spec 06 §2.3.
- Pure, with no platform imports (lint).

---

### P1.3 HTML toolkit (L) · Wave 1 · ⇉

**Goal.** A libxml2-compatible HTML layer that runs on Workers (D-017).

**Owns:** `src/core/html/**`.

**Provides**
- `parseFragment()`: an htmlparser2 tokenizer with libxml2 HTML tree-building rules (`htmlStartClose` auto-close table, implied end tags, void elements, comments, CDATA-like script and style)
- `serializeHtml()`: libxml `saveHTML` per node (attribute quoting, minimized booleans, entity output, `<?xml encoding>` hack equivalence)
- a query helper covering the XPath subset WP uses
- `TagProcessor` (a `WP_HTML_Tag_Processor` subset that preserves bytes)
- `ksesPost`, `sanitizeMarkup` (the `Admin::sanitize_markup` allowlist), and the builder's client-side paragraph and html allowlist

**Acceptance**
- Serialization of `parseFragment(x)` equals the DOMDocument round trip golden, byte for byte, for ≥300 fragments. The corpus covers all 54 Gatilab markups, 63 template markups, the 3 legacy generator families, and adversarial cases (`<p><div>`, unclosed tags, entities, Unicode, boolean attributes, comments, nested labels).
- KSES output equals WP for the corpus.
- The module is ≤ 40 KB minified with no Node built-ins.

---

### P1.12 Client core runtime (M) · Wave 1 · ⇉

**Goal.** Port `forms.js` + `accessibility.js` and the CAPTCHA clients exactly (spec 02 §2.1–2.2, §2.6).

**Owns**
- `src/client/core/**`, `src/client/captcha/**`
- `src/styles/{forms.css, form-theme.css, standalone.css}`: WP verbatim plus a GPL header

**Depends on:** P1.0a, and P1.4's `src/shared/conditions` (stub until delivered; the grammar is fixed in spec 02 §2.1).

**Provides**
- the delegated submit/click/keyup/change handlers
- the conditional engine (fixpoint, bookkeeping attributes, `_was_required[]`)
- URL prefill and required checkbox groups
- the loader (first submit button; restores the original disabled state, DV-18)
- `innerHTML` messages, the `cf-*` events and the `window.core_forms` API
- `cf_js_vars`, the `swup`/Astro re-init hooks
- the a11y behaviours (message focus, touched gating, `invalid` decoration appending `aria-describedby`, assertive announce, button `aria-busy`)
- a pre-submit hook chain used by the CAPTCHA modules and later by Stripe inline (DV-21)
- the CAPTCHA clients: reCAPTCHA (`core_forms_submit`, capture flow, reset on `cf-error`), Turnstile (explicit render, `cf_turnstile_reset`, `cf_form_reset`), hCaptcha

**Acceptance**
- DOM tests (happy-dom) assert event order and `detail` shapes, API listener signatures `(form, detail)`, the conditional fixpoint on nested and chained rules, and prefill rules (`[]` keys, dates, multi-select).
- Bundle `core.js` ≤ 3.4 KB brotli.
- CSS files are byte-equal to the WP sources apart from the header.

---

### P1.13 Client smart & fullscreen (M) · Wave 1 · ⇉

**Goal.** Port `smart-forms.js` and `fullscreen.js` (spec 02 §2.3–2.4).

**Owns:** `src/client/smart/**`, `src/client/fullscreen/**`, `src/styles/{smart-forms.css, multi-step.css, fullscreen.css}`.

**Depends on:** P1.0a, and P1.8's `src/shared/expr` (stub until delivered).

**Provides**
- multi-step navigation, validation, progress and `form._cfGoToStep`
- inline validation
- drafts: 5 s autosave, resume dispatching `input`/`change` (DV-20), the partial beacon
- calculations through the shared evaluator (no `new Function`)
- counters, with a recount on reset (D-054)
- the fullscreen overlay, keyboard handling and submit, with escaped attributes (DV-22)

**Acceptance**
- DOM tests reproduce the step and progress state machine and the counter texts.
- Calculation results equal the server goldens for the `calc` corpus.
- The fullscreen DOM matches the spec 02 §2.4 structure.
- Budgets: `smart.js` ≤ 3.6 KB br, `fullscreen.js` ≤ 4.4 KB br.

---

### P1.16 Templates registry (S) · Wave 1 · ⇉

**Goal.** Provide all 63 templates as data, plus the presets logic (D-068).

**Owns:** `src/core/templates/**`.

**Depends on:** P1.1 (the `templates` dump).

**Acceptance**
- The data equals the oracle dump.
- Multistep variant derivation equals WP for every eligible template.
- `templateSettings`, `templateMessages` and `templateSchema` match WP.
- The default email action is added to non-blank templates without actions.
- License and payment templates produce no catalog side effects.

---

### P1.17 Admin: shell, forms, editor shell, settings, theme (L) · Wave 1 → finishes in Wave 3 · ⇉

**Goal.** The admin workspace, minus the builder and the submissions UI.

**Owns:** `src/admin/{lib,forms,editor,actions,settings,theme,shell}/**` (`lib` taken over from P1.0a).

**Depends on:** P1.0a contracts. Real routes come from P1.7 and P1.6; build against mocks until they land.

**Provides**
- the forms list (spec 04 §1.3.1: stats, views, search with `/` and `s` shortcuts, shortcode copy, a11y column, sorting, bulk actions, trash)
- the template gallery `/new`
- the editor shell (tabs, fingerprint conflict dialog, Cmd/Ctrl+S, standalone URL bar)
- the Messages, Settings (all Phase 1 settings, spec 01 §1.3) and Headless tabs
- the Revisions tab (list, preview, restore, publishing controls)
- the Actions tab, with generic cards rendered from `ActionModule.fields`:
  - conditions editor and recipient routes
  - unavailable cards that preserve unknown keys
  - `async` toggle and secret masking
- the global Settings page (sections: General, Spam, Email (transport and From note, DV-02), Headless key generate/copy, Files status)
- the theme customizer (tokens, presets, preview iframe at 720/390 px, contrast audit, copy CSS, reset)
- the UI slots `registerEditorTab`, `registerSettingsSection` and `registerActionCardExtra`

**Acceptance**
- Playwright admin flows for each page.
- The axe scan has no serious or critical issues.
- Editing Gatilab's imported email actions round-trips with no key loss (snapshot test over the 41 fixtures).
- The settings page writes only through `settings/save` and shows secrets masked.

---

### P1.19b Submissions admin UI (L) · Wave 1 → Wave 3 · ⇉

**Goal.** The inbox UI (spec 04 §2.3–2.10).

**Owns:** `src/admin/{submissions,email-logs}/**`.

**Depends on:** P1.0a contracts. Uses mocks until P1.19a and P1.11 land.

**Provides**
- views with counts, filters, date range with the timezone label, saved views
- the selection bar and bulk actions with confirmations
- the detail panel: fields, info, payment, raw, edit, replies with send, team card, logs slot
- the per-form tab with the Summary and All-fields layouts and the column menu
- the email logs page
- `registerSubmissionPanel`
- the `recent-submissions` and `assigned-to-me` widgets

**Acceptance**
- Playwright flows: view switching, bulk spam/unspam, delete refusal messaging, CSV download of a selection, reply send, team save conflict (409).
- axe clean.

---

### P1.4 Schema system (L) · Wave 2 · ⇉

**Goal.** The FormSchema model and everything that reads it (spec 01 §2).

**Owns:** `src/core/schema/**`, `src/shared/conditions/**`.

**Depends on:** P1.3 (parsing), P1.2.

**Provides**
- `FormSchema` from/to array, including `repair_wrapper_collisions` and the duplicated layout keys
- `SchemaRenderer` (every type, containers with grid variables, choice groups, descriptions, conditions) and `normalize_ids`
- `MultiStep.render`
- `MarkupParser` and `repair_legacy_schema`
- `FieldValidator`: url, color, measure, step math, pattern, minlength, option allowlists
- conditional activity: `is_active`, `matches_rule`, dependencies
- the custom field type registry, and field-group normalization and limits
- the shared rule grammar used by the client

**Acceptance**
- SchemaRenderer output equals the `render` goldens for every template schema and the schema corpus (before the a11y pass).
- MarkupParser JSON equals the `parse` goldens for the 54 Gatilab forms, the templates and the generator corpora.
- FieldValidator codes equal the `validate` goldens (≥150 cases, including time, week and month steps).
- The rule grammar has one shared test table used by both client and server.

---

### P1.7 Form store & authoring services (L) · Wave 2 · ⇉

**Goal.** Form persistence and authoring semantics (spec 01 §3.16, §2.12; spec 04 §1.3).

**Owns**
- `src/server/forms/**`
- `src/server/routes/{forms,field-groups,settings,theme}.ts`
- the `usage-rescan` maintenance task and the `usage-scan` job

**Depends on:** P1.0b. Uses P1.5, P1.6, P1.16 and P1.18 through interfaces (stubs until ready).

**Provides**
- `FormRepo`:
  - get, resolve live/draft/revision (slug rules from spec 01 §3.2)
  - create (template, duplicate)
  - update with the `version` CAS and fingerprint
  - slug claims through `uniques`
  - trash, restore and permanent delete
- publishing start/publish/discard with live-slug reservation
- revisions: snapshot on save and restore, keep 50
- preview: `{html, assets}`
- rehearsal route wiring
- the usage index (`content:afterSave`/`afterDelete` hooks plus the backfill job)
- field groups with the KV version CAS
- the settings and theme routes

**Acceptance**
- 409 `cf_edit_conflict` and `cf_version_required`, and `cf_slug_conflict` on publish.
- A revision restore deletes absent `cf_message_*` keys (spec 01 §3.16).
- Create-from-template equals WP's `process_create_form` for 5 templates.
- The usage index finds every `[cf_form id|slug]` and every `form`/`core-form` PT block in the Gatilab content fixtures (`tests/fixtures/gatilab/entries/*.json`, copied from `emdash-next:migration/data`).
- `forms/list` counts and sort orders match spec 04 §1.3.1.

---

### P1.8 Smart forms server (M) · Wave 2 (`shared/expr` can start in Wave 1) · ⇉

**Goal.** Calculations and drafts (spec 03 §1.2–1.3).

**Owns**
- `src/shared/expr/**`, `src/core/{calc,drafts}/**`, `src/server/drafts/**`
- `src/server/routes/drafts.ts`
- the `drafts-cleanup` maintenance task

**Depends on:** P1.0b, P1.4 (conditions and activity).

**Acceptance**
- The evaluator equals the PHP evaluator on ≥300 `calc` expressions, including `round` precision, the `1.0E+25` failure, division by zero, unknown references and whitespace.
- `FieldCalculator.process` equals the goldens: inactive fields stripped, dependency order, cycle failure → 422 text.
- `drafts/save` and `drafts/load` responses (status, text, envelope) equal spec 03 §1.3, including the sliding 30/min limit for new drafts, token rules and expiry.
- Newlines are preserved (DV-19).
- The cleanup job deletes only expired `draft`/`partial` rows, per form TTL.

---

### P1.9 Spam & privacy (M) · Wave 2 · ⇉

**Goal.** Every spam validator, plus retention and GDPR (spec 03 §4).

**Owns**
- `src/core/{spam,privacy}/**`, `src/server/{spam,privacy}/**`
- `src/server/routes/{privacy,retention}.ts`
- the `retention` maintenance task and the `erase` job

**Depends on:** P1.0b, P1.3 (math captcha markup insertion).

**Provides**
- validators registered with WP priorities (10 reCAPTCHA, 10 Turnstile, 10 hCaptcha, 15 math, 20 Akismet)
- the Turnstile container and math captcha markup filters (WP placement rules)
- single-use tokens (DV-06) and the hardened math captcha (DV-05)
- Akismet REST with the WP request builder and whitelist
- GDPR find/export/erase
- retention candidates and attachment retirement
- coordinated erase: refusal rules, cascade order, files checked first

**Acceptance**
- Siteverify request bodies (mocked fetch) equal WP's.
- Error codes match spec 03 §4.4–4.8.
- Reusing a token fails.
- Math markup equals the WP golden apart from the hash value.
- The Akismet payload equals the `build_akismet_data` golden for 20 submissions.
- Retention skips held, draft, payment and pending-work rows.
- An erase interrupted at any step can be resumed by re-running the job, and completes.

---

### P1.10 Files & uploads (M) · Wave 2 · ⇉

**Goal.** Private uploads end to end (architecture §12).

**Owns**
- `src/core/uploads/**`, `src/server/files/**`
- `src/site/endpoints/files/**`
- `src/client/upload/**`
- `src/server/routes/files.ts` (internal routes)
- the `uploads-sweep` maintenance task and the `import-files` job

**Depends on:** P1.0b. P1.0c spike 7.

**Provides**
- normalization of `$_FILES`-equivalent entries
- WP extension rules, magic-byte sniffing (D-114) and the size filter
- R2 adapter with the media fallback (D-112)
- register, attach, authorize and retire
- the companion upload, submit-forwarder and download endpoints
- the `upload.js` pre-upload client
- descriptors without `dir` (DV-27)

**Acceptance**
- Validation matrix equals spec 03 §3.1 codes, including double extensions, the blocked list and CSV/DOCX handling.
- In e2e, a 5 MB PDF uploads through the JS path and the no-JS path, appears as a descriptor, and downloads only with an admin session.
- With the bucket unbound, PDFs go to media and ZIPs get `file_upload_error`.
- The orphan sweep removes pending files older than 24 h.
- `upload.js` ≤ 1.0 KB br.

---

### P1.11 Action runtime core & mail (L) · Wave 2 · ⇉

**Goal.** Durable, WP-exact execution of email, autoresponder and webhook actions, plus the Mailer (architecture §10–11).

**Owns**
- `src/core/actions/{runtime,core}/**`
- `src/server/{actions,mail}/**`
- `src/server/routes/email-logs.ts`
- the `dispatch` and `action` job handlers

**Depends on:** P1.0b, P1.2 (`httpBuildQuery`, `jsonEncodePhp`), the P1.6 data-variable renderer (interface; stub until ready).

**Provides**
- conditions evaluation and the run key
- the ledger FSM (`actionLogs`)
- outcome normalization, `accepted()`/`json()` classification, redaction, the signer
- `dispatch` fan-out in list order; action jobs with WP backoff; the inline-phase hook (redirect producers)
- the core modules `email` (recipient routes, header rendering), `autoresponder` and `webhook` (byte-compatible payloads, signing, SSRF pre-check)
- the Mailer with the EmDash, Resend and Emailit transports (split planning, DV-01, `dropped`)
- email logs and their routes

**Acceptance**
- Webhook request URL, method, headers and body equal the `actions` goldens for 12 fixtures (json/form, arrays, file values, auth header, signed/unsigned, key id).
- Email and autoresponder `MailMessage`s equal the captured `wp_mail` args (to, subject, body, headers) for 20 fixtures, html and plain.
- A Bcc address never appears in `to`/`cc` of any EmDash-transport send.
- Ledger tests: busy, stale → uncertain, reclaim keeping steps.
- Backoff schedule; inline-failure re-entry `max(120, RA)`; conditions re-checked at run time.
- An ephemeral run is scrubbed after completion.

---

### P1.14 Astro components & companion integration (L) · Wave 2 → Wave 3 · ⇉

**Goal.** Rendering on sites, and every companion route for Phase 1 (architecture §8.3, §13.1).

**Owns**
- `src/astro/**` (not `polls/`, `commerce/`)
- `src/site/**` (not `endpoints/files`, `endpoints/inbound`, `commerce`)
- `src/client/embed/**`
- `e2e/specs/astro/**`

**Depends on:** P1.0b, P1.0c. Uses P1.5 and P1.6 internal routes (stubs until ready).

**Provides**
- `CoreForm` (props and PT node; WP block wrapper and attributes)
- `FormAssets`: request-scoped manifest union, loading order, inline globals, theme CSS, `nonce` prop
- `blockComponents` (`core-form` and the legacy `form`)
- `renderCoreFormsInHtml` (alias `renderFormsInHtml`) with the expander registry
- `loadForm`
- `coreFormsSite()`: standalone page (WP shell, headers, robots, canonical, fullscreen external assets), `go` handoff, middleware (`?cf-form`), `wpCompat` headless routes with the CORS allowlist and `OPTIONS`, `embed.js`
- the `globalThis.__CORE_FORMS_SITE__` publication

**Acceptance**
- In the e2e site:
  - Gatilab fixture forms render through the legacy `form` block and through HTML shortcodes.
  - Assets are emitted once for 3 forms on one page.
  - The standalone document equals the oracle standalone golden after normalization, with headers per spec 01 §3.14.
  - `?cf-form=` works.
  - The headless CORS matrix (allowlist, empty list, mismatch) equals WP.
  - `embed.js` mounts and submits.
  - No-JS PRG works, including an off-site redirect via `go`.
- Default embed ≤ 7.5 KB br.

---

### P1.15 Polls (L) · Wave 2 · ⇉

**Goal.** The whole polls feature (spec 03 §5).

**Owns**
- `src/core/polls/**`, `src/server/polls/**`
- `src/server/routes/polls.ts`
- `src/client/poll/**`, `src/styles/poll-frontend.css`
- `src/astro/polls/**`, `src/site/endpoints/polls/**`, `src/admin/polls/**`
- `src/core/io/mappers/polls.ts`
- the `poll-status` maintenance task

**Depends on:** P1.0b, P1.3, the P1.14 expander registry.

**Acceptance**
- Form, results, scheduled and closed markup equals the oracle goldens.
- The vote matrix (vote limits none/ip/cookie/user, change window, single/multiple, Other with DV-24, honeypot, 12/min) returns WP messages.
- Tallies stay exact under 50 concurrent votes (harness).
- `polls/results` and REST shapes match.
- CSV columns and order match.
- The voter cookie is HttpOnly via the companion (DV-60).
- The admin 5-tab editor works end to end, axe clean.
- `poll.js` ≤ 1.3 KB br.

---

### P1.20 Data portability, migration & operations (L) · Wave 2 → Wave 3 · ⇉

**Goal.** Import, export, the v0.1.0 migration, doctor and the CLI (architecture §17, §19).

**Owns**
- `src/core/io/**` (not `importers/`, nor the mapper files owned by others)
- `src/server/{io,migrate,doctor}/**`
- `src/server/routes/{data,migrate,doctor,jobs,maintenance,danger}.ts`
- `src/admin/tools/**` (not `importers/`)
- `wordpress/export-core-forms.php`, `bin/core-forms.mjs`
- the `migrate` job

**Depends on:** P1.0b, P1.7 (FormRepo), P1.11 (log rows), P1.15 (poll mapper).

**Acceptance**
- Importing the `io` golden export (seeded WP) yields the expected records for every dataset. Re-import changes nothing (DV-32).
- An EmDash export imports into the WP oracle without errors, and forms round-trip with equal meta.
- `schema:1` and v0.1.0 array imports work.
- The v0.1.0 storage fixture migrates per architecture §17.4.
- Batches stay ≤ 200 rows; credentials are opt-in both ways (DV-58).
- `doctor` checks run against the harness.
- The CLI commands (list, export, import, submissions, bulk-status, cleanup, doctor) work against a harness server.
- The PHP exporter lints and runs inside the oracle against seeded WP, and its output validates.

---

### P1.5 Render pipeline (L) · Wave 3 · ⇉

**Goal.** `Form::get_html()` byte parity (architecture §9.1).

**Owns:** `src/core/{render,a11y,theme}/**`, `src/core/policy/schedule.ts`.

**Depends on:** P1.3, P1.4, P1.2, P1.0b (settings views).

**Provides**
- `renderForm`, giving `{html, manifest}`
- markup filters and HTML filters (registries with WP priorities)
- `cf_enhance_accessibility` (DV-17)
- the email maxlength pass
- the wrapper: data attributes, hidden inputs, honeypot, messages, PRG flash, custom CSS/JS
- closed, limit and login replacements
- the asset manifest (`AssetRequirements`)
- instance prefixing (DV-16)
- the block wrapper, the standalone document model and the headless DTO
- the theme sanitizer, CSS generator and contrast checks
- `is_open`

**Acceptance**
- **All 54 Gatilab forms** render byte-identical to the `render` goldens after the documented normalizer (DV-14, DV-15, DV-16, instance counter), using the Gatilab global settings fixture. The 63 templates do too.
- Manifest flags equal WP for the corpus.
- Theme CSS is byte-identical for 4 presets and 50 random valid token sets.
- The schedule matrix (≥80 cases: overnight windows, weekdays, timezones, invalid dates ignored) equals the goldens.

---

### P1.6 Submission pipeline & public form routes (L) · Wave 3 · ⇉

**Goal.** `Forms::process` parity (architecture §9.2).

**Owns**
- `src/core/{pipeline,templating}/**`
- `src/core/policy/{availability,capacity}.ts`
- `src/server/submit/**`
- `src/server/routes/{submit,render,headless}.ts` (render and standalone are internal routes)

**Depends on:** P1.4, P1.5, P1.8, P1.0b. Uses P1.9 and P1.10 through the validator and upload interfaces.

**Provides**
- steps 1–20 with WP order, codes, literals and statuses
- the capacity lock and unsaved capacity counter
- rate limiting and duplicates
- data collection with WP `$_POST` semantics
- the allowlist, length and size limits
- `{{tags}}` (D-021) and `[data variables]`, `cf_field_value`, all-fields formatting
- spam storage
- the success branch (inline actions, dispatch enqueue and kick)
- the submit-branch seam for payments
- the PRG token and flash
- headless submit
- rehearsal planning (minus the action plan, which P1.11 and P2.1 fill in)
- the `submission.*` and `form.*` events

**Acceptance**
- The `pipeline` scenario matrix (≥60 scenarios) is identical: response JSON, HTTP status, stored row, blocked counters.
- `vars` goldens are identical (≥120 tokens, html/plain/header escapes).
- The PRG round trip works in the harness and e2e.
- Headless key, 401/403/503 and 422 mapping.
- A typical successful submit does ≤ 6 storage writes, asserted in the harness.

---

### P1.18 Visual builder & accessibility audit (XL) · Wave 3 · ⇉

**Goal.** Rebuild the React builder (spec 02 §5) and the server audit.

**Owns:** `src/admin/builder/**`, `src/core/a11y-audit/**`.

**Depends on:** P1.4 (types, parser), P1.7 routes, the P1.17 editor-tab slot.

**Provides**
- the inserter (24 base types, 37 presets, custom types)
- the canvas with containers (one visual level) and multi-step step editing
- `@dnd-kit` drag and drop with keyboard sensors and announcements
- the inspector with every WP section
- renames that rewrite condition rules and `{name}` calc tokens
- duplicate, delete, and field groups (insert and save)
- the templates picker with a confirm before replacing (D-066)
- Code mode (CodeMirror 6, lazy, live MarkupParser with parse-error state; keeps step `group` by name)
- the preview dialog (desktop/mobile) with rehearsal through `postMessage`
- the audit panel ("Run audit", "Fix safe issues")
- `AccessibilityTester` rules and autofix

**Acceptance**
- Audit reports and autofix equal the `audit` goldens.
- A schema saved from the builder re-renders server-side to markup equal to the WP builder post-pass (`cf-field-` ids) for 10 fixtures.
- Playwright: every type and preset can be added and saved; drag and drop works by keyboard; renames rewrite references; a template replace asks for confirmation.
- axe clean.
- The builder chunk loads lazily; CodeMirror is not in the initial admin chunk.

---

### P1.19a Submissions server (L) · Wave 3 · ⇉

**Goal.** Inbox server behaviour (spec 04 §2).

**Owns**
- `src/core/submissions/**`, `src/server/submissions/**`
- `src/server/routes/{submissions,replies,team,users}.ts`
- the `team-reminders` maintenance task and the `column-rewrite` job

**Depends on:** P1.0b, P1.9 (erase), P1.11 (mail and logs), P1.6 (replay dispatch).

**Acceptance**
- **Views and search:** view filters and counts equal spec 04 §2.2–2.4 on a seeded set; date filters honour the site timezone; bounded search reports `truncated`.
- **Presentation and CSV:** summaries equal the `summary` goldens; global and per-form CSV equals the `csv` goldens byte for byte.
- **Mutations:** un-spam replays actions with conditions and logs skips; delete refuses pending payment or pending work, after checking all ids; `update-data` keeps files and splits arrays (DV-29); reply send sets `replied`.
- **Team:** saves check the version (409) and the limits; saved views cap at 30; access grants and scopes are enforced per id; reminders run at most once per 24 h; column rename and delete fix DV-28.

---

### P1.21 Competitor importers (M) · Wave 3 · ⇉ · non-gating

**Goal.** File-based importers (D-130).

**Owns:** `src/core/io/importers/**`, `wordpress/lib/competitors.php`, `src/admin/tools/importers/**`.

**Depends on:** the P1.20 io types and envelope.

**Acceptance**
- For CF7, Gravity, WPForms, Fluent, Ninja and Formidable, fixtures built from spec 04 §4.4 shapes (plus real native GF/WPForms/Fluent JSON samples) convert to the expected `core-forms-data` form rows: markup, settings, messages, actions, conditions.
- DV-31 fixes covered.
- The exporter section runs in the oracle when vendor tables are absent (it reports "not detected").

---

### P1.22 [emdash-next] Gatilab integration & cutover (M) · after Gate G1a readiness

**Goal.** Switch gatilab.com's EmDash site to v1 with no visible regression.

**Owns (in `emdash-next`)**
- `apps/gatilab/astro.config.mjs`
- `apps/gatilab/wrangler.jsonc`: add `r2_buckets` `CORE_FORMS_PRIVATE` → `gatilab-forms-private`; document the secrets `EMDASH_ENCRYPTION_KEY` and `CORE_FORMS_SECRET`
- `apps/gatilab/src/components/sections/HtmlSections.astro`: switch to `renderCoreFormsInHtml` and `<FormAssets/>` without props. Optional, since the old names keep working.
- `migration/scripts/php/export-core-forms.php` (synced copy of the package exporter) and the `migration/scripts/export-wordpress.sh` step
- `migration/import_core_forms.py`: batched import through `data/*` routes; replaces `import_forms.py`
- `migration/check_forms.py`: parity checker

**Precondition, done by the coordinator (not build agents):** run the **read-only** export over SSH (`export-wordpress.sh`) to refresh `migration/data/core-forms-data.json`, including `_cf_form_schema`, settings, theme tokens and submissions. Agents never contact production.

**Cutover procedure** (local first, then deploy when the site goes live):
1. Back up the local D1/R2 state (`.wrangler/state`).
2. `git -C ../core-forms-emdash switch next` (release candidate), then `pnpm build:assets`.
3. Start dev. Open Tools → Data upgrade (migrates the v0.1.0 test submissions) → Import the fresh export (forms update by id).
4. Run `check_forms.py`. It renders every page listed by the usage index (360+ embeds) and compares each form's HTML with the oracle golden for that form id after normalization. It submits each of the 54 forms once with fixture data, with mail in dev capture and webhooks pointed at a local capture server. It asserts the response JSON, the stored row, captured emails (recipients, subject, body) and webhook bytes.
5. If anything fails, switch back to `main` and restore the state backup.

**Acceptance:** the G1a checklist below.

---

### P1.23 Docs & release 1.0.0 (S) · after G1

**Owns:** `README.md`, `CHANGELOG.md`, `docs/guide/**` (install, site setup, companion options, email transports, private bucket, migration from WordPress, extension API, CLI and MCP).

**Acceptance**
- The README install snippet works in the e2e site.
- The CHANGELOG lists every DV that applies to users.
- `npm publish --dry-run` passes, with `dist/assets` in the tarball.

---

### Gate G1a: Gatilab cutover (subset of Phase 1)

**Required packages:** P1.0a–c, 1.1–1.7, 1.9 (validators), 1.10, 1.11, 1.12, 1.14, 1.16, 1.17 (forms list, editor shell, Actions tab, Settings), 1.19a + 1.19b (inbox basics), 1.20 (import and migration).

The builder (P1.18) may still be in progress. The Fields tab falls back to Code mode until it lands.

**Checklist**
- [ ] `pnpm verify` is green on `next`, and the parity suites cover all 54 Gatilab forms.
- [ ] `check_forms.py` passes: every Gatilab page with a form renders the expected form markup, and all 54 forms accept a test submission with the correct response, stored data and side effects.
- [ ] The 41 email, 14 autoresponder and 6 webhook actions send byte-identical payloads to the oracle captures. The `create_comment` action logs `skipped/wp_only`.
- [ ] The CSS and JS budget holds on a Gatilab page with a form (≤ 7.5 KB br default embed). No console errors.
- [ ] Conditional, fullscreen and standalone forms work (Gatilab has 1 fullscreen and 1 standalone form, plus 2 file-upload forms with the private bucket).
- [ ] The admin can list, edit and save each imported form without key loss. Inbox, export and spam toggles work.
- [ ] The cron `tick` runs in dev, a deliberately failed webhook retries on the WP schedule, and `doctor` reports no `fail`.
- [ ] axe: no serious or critical issues on a Gatilab form page or the standalone page.
- [ ] Rollback was rehearsed once: switch back to `main`, restore the state, the site works.

### Gate G1: Phase 1 complete → `main` = `v1.0.0`

**Checklist**
- [ ] Every Phase 1 acceptance criterion is green, including P1.15 polls, P1.18 builder and P1.21 importers. P1.21 may ship in 1.0.x if late.
- [ ] Full e2e suite and axe pass on: standalone, multi-step, fullscreen, poll, admin pages (forms, editor, builder, settings, theme, submissions, tools).
- [ ] Round trip: EmDash export → WP oracle import → WP export → EmDash import yields identical forms and submissions.
- [ ] Docs published (P1.23). `npm publish` of 1.0.0 with Gaurav's go-ahead (U-3).

---

## Phase 2: Workflows and integrations (→ v1.1.0)

**Goal.** All 29 in-scope action types with WP-identical requests; the delivery ledger, recovery and inbound endpoints (spec 05).

### Waves

```
Wave 0  → P2.0 Contracts & integration helpers
Wave 1  ⇉ P2.1 Runtime completion & routes  ⇉ P2.2 Integrations A  ⇉ P2.3 Integrations B
        ⇉ P2.4 Integrations C  ⇉ P2.5 Messaging & inbound  ⇉ P2.6 Admin workflows UI
Gate G2
```

### P2.0 Contracts & integration helpers (M) · sequential

**Owns**
- `src/shared/types/api/workflows.ts`
- `src/core/actions/registry.ts`: all 26 integration modules as stubs, plus the WP-only type table (D-104)
- `src/core/actions/runtime/{payload,mapping,destination}.ts`: `ActionPayload` text/required/email/field/json/selected/event/api; `FieldMapping` match/resolve/tags/validate/samples; `DestinationFields` mapping, Notion/Airtable conversions and schema cache
- registry entries for the Phase 2 routes, the companion inbound routes and the recovery page
- `tools/wp-oracle/scripts/actions/**`: integration goldens, built by running each WP action's `process()` with `pre_http_request` capture and fixture settings

**Acceptance**
- Payload and mapping functions equal the oracle goldens (typed `json()` leaves, file reduction, `[]` vs `{}`).
- One golden request set exists per in-scope integration.

### P2.1 Runtime completion & routes (M) · ⇉

**Owns**
- `src/server/actions/{test,copy,recovery,logs,queue}/**`
- `src/server/routes/{actions,action-logs,action-queue,recovery}.ts`
- `src/core/actions/runtime/rehearsal.ts`
- the `action-log-retention` maintenance task

**Acceptance**
- `actions/test` returns WP's shape (`manage_options` → Admin).
- Copy prepare validates fingerprints, assigns new uuids and strips run keys.
- Reconcile evidence validation and its regex.
- Queue retry refreshes from the current form by `_cf_action_id`.
- Rehearsal destinations equal WP (URL reduction).
- Log retention deletes event rows only (DV-34).

### P2.2 Integrations A (M) · ⇉

slack, discord, telegram (with `actions/telegram-setup` and the chat-id migration rewrite through a CAS on form version), google_sheets, zapier, make, n8n (auth modes, `webhook-test` rule), whatsapp_redirect (inline phase, `rawurlencode`), surecontact.

**Owns:** `src/core/actions/integrations/{slack,discord,telegram,google-sheets,zapier,make,n8n,whatsapp-redirect,surecontact}.ts`.

**Acceptance**
- Requests (URL, method, headers, body bytes) equal the oracle goldens for each module.
- Response classification tests: 2xx with `ok:false`, 429 with Retry-After, Telegram migration, Sheets confirmation.
- `whatsapp_redirect` sets `redirect_url` before the response.

### P2.3 Integrations B (L) · ⇉

hubspot, convertkit, activecampaign (steps), brevo, drip, mailerlite, mailchimp_api, emailit_subscribe (409 paths), pipedrive (steps, search and update).

**Owns:** the matching files in `src/core/actions/integrations/`.

**Acceptance**
- Golden requests equal per module, including step checkpoint resume after a mid-sequence failure.
- An endpoint liveness note per module (D-106), with sandbox checks run by Gaurav or with his test keys where he provides them. Any migration becomes a DV entry.

### P2.4 Integrations C (M) · ⇉

notion (data source vs database versions), airtable (schema matching, metadata columns), zendesk (`external_id` recovery, attachments read from R2 through `FileReader`, limits), resend (Idempotency-Key, Svix inbound `inbound/resend`, an email-id index replacing the `LIKE` scan), emailit (send).

**Owns**
- the matching integration files
- `src/core/actions/inbound/resend.ts`
- `src/server/routes/inbound-resend.ts`

**Acceptance**
- Golden requests.
- Svix vectors: valid, stale and wrong signatures.
- 503 when an event arrives before its send record and is younger than 120 s.
- Event dedupe.
- Zendesk recovery finds the existing ticket.

### P2.5 Messaging & inbound (M) · ⇉

twilio_sms, twilio_whatsapp, whatsapp_cloud (with `actions/whatsapp-test`); the inbound Meta GET verify and POST (`X-Hub-Signature-256`) and Twilio (HMAC-SHA1 over the exact public URL); reply-thread writes; status `replied`; the `whatsapp.replyReceived` event.

**Owns**
- the matching integration files
- `src/core/actions/inbound/{whatsapp-meta,whatsapp-twilio}.ts`
- `src/server/routes/inbound-whatsapp.ts`
- `src/site/endpoints/inbound/**` (TwiML endpoint)

**Acceptance**
- Golden requests.
- Signature vectors.
- Dotted query names are read literally (`hub.mode`).
- Correlation by quoted message id, then by phone digits.
- TwiML `<Response></Response>` comes from the companion.

### P2.6 Admin workflows UI (L) · ⇉

**Owns:** `src/admin/workflows/**`.

**Provides**
- the "Add action" catalog: categories, availability, docs links
- generic card field types (remote selects such as Emailit audiences; json, lines and fields pickers)
- the per-card test panel and the copy-from-form dialog
- the rehearsal panel in the Actions tab
- the Telegram setup wizard
- Mailchimp MC4WP conversion (D-105)
- the Delivery recovery page
- action logs in the submission detail (slot) and queue stats in Tools
- the WhatsApp test button in the Settings Messaging section (slot)

**Acceptance:** Playwright flows for adding every type, test, copy, reconcile and retry; axe clean.

### Gate G2 → `v1.1.0`

- [ ] Every in-scope integration's golden requests are equal. Signature vectors pass.
- [ ] Ledger and retry e2e: a failing provider recovers on the WP schedule. An uncertain run blocks replay until reconciled.
- [ ] Gatilab: no regression in G1a checks. Its 6 webhooks are unchanged.
- [ ] Inbound endpoints work through the `wpCompat` paths, with no provider re-registration needed.

---

## Phase 3: Analytics (→ v1.2.0)

### Waves

```
Wave 0  → P3.0 Analytics server (contracts first; checkpoint after day 1)
Wave 1  ⇉ P3.1 Analytics client   ⇉ P3.2 Analytics admin   (against P3.0 contracts)
Gate G3
```

### P3.0 Analytics server (M)

**Owns**
- `src/shared/types/api/analytics.ts`
- `src/core/analytics/**`, `src/server/analytics/**`
- `src/server/routes/{track,analytics}.ts`
- `src/core/io/mappers/analytics.ts`
- the `analytics-retention` maintenance task
- the Analytics Engine adapter in `src/server/platform/analytics-engine.ts`

**Provides**
- the `track` route (validation, 30/min throttle, `event_id` dedupe)
- server events through `form.success` and `form.response` listeners (`submit`, `spam`, `blocked` with reasons)
- daily, all-time and dimension rollups through `updateIf` delta
- raw events (D1, 30 days) or Analytics Engine
- funnel, daily, field drop-off, attribution, spam trends, recommendations (server-formatted, DV-45), overview, blocked
- import of `cf_analytics` rows into rollups plus raw events

**Acceptance**
- Shapes and math equal spec 03 §6.7 for a seeded event set, including rate capping and rounding.
- Rollups stay exact under 100 concurrent events (harness).
- Retention deletes raw events after 30 days and aggregates after 365.
- Rate limits and dedupe behave as specified.

### P3.1 Analytics client (S)

**Owns:** `src/client/analytics/**`.

**Acceptance**
- View on IntersectionObserver, start, `field_interaction` on every blur, abandon by beacon; WP field names.
- `analytics.js` ≤ 0.7 KB br.
- The manifest flag honours the tri-state and the consent filter.

### P3.2 Analytics admin (M)

**Owns:** `src/admin/analytics/**`.

**Provides:** the per-form Analytics tab (editor-tab slot) and the overview page: range presets, funnel cards, accessible SVG charts with table fallbacks, field interactions, sources ("Source page host"), recommendations, blocked counts, spam trends.

**Acceptance:** Playwright plus axe; the numbers match the API.

### Gate G3 → `v1.2.0`

- [ ] Default embed with analytics stays ≤ 7.5 KB br.
- [ ] D1 writes per tracked event ≤ 4, asserted in the harness.
- [ ] Gatilab: its 14 forms with `analytics_enabled = 1` record events in dev; `doctor` shows analytics row counts.

---

## Phase 4: Payments, licensing, digital products, portal (→ v1.3.0)

### Waves

```
Wave 0  → P4.0 Commerce contracts & oracle scripts
Wave 1  ⇉ P4.1 Payments core  ⇉ P4.2a Stripe + Polar  ⇉ P4.2b PayPal + Razorpay  ⇉ P4.3 Licensing core & license API
        ⇉ P4.6 Commerce admin (against contracts)
Wave 2  ⇉ P4.4 Customers & portal  ⇉ P4.5 Storefront, checkout, product pages, blocks  ⇉ P4.7 Commerce import & verification
Gate G4
P4.8 [emdash-next] store cutover: deferred until U-2 is answered
```

### P4.0 Commerce contracts & oracle scripts (M) · sequential

**Owns**
- `src/shared/types/commerce.ts` (completed), `src/shared/types/api/{payments,commerce,portal,storefront,license}.ts`
- `src/shared/money/gateways.ts`
- the commerce stubs in the registries: routes, companion routes (`src/site/routes.ts` entries), PT blocks, admin pages, maintenance, job kinds
- `tools/wp-oracle/scripts/commerce/**`: the license server `dispatch` goldens (every action and error), `sanitize_title`/site-hash vectors, Stripe/Polar/Razorpay webhook signature vectors, gateway request captures, a fulfillment/renewal/refund outcome matrix on seeded data, storefront payloads

**Acceptance:** the goldens exist and are deterministic; the contracts compile; `ROUTES.md` lists the Phase 4 routes.

### P4.1 Payments core (L) · ⇉

**Owns**
- `src/core/commerce/payments/**`, `src/server/commerce/payments/**`
- `src/server/routes/{payments-webhook,payments-settings}.ts`
- `src/client/stripe/**`
- the `payment-event`, `fulfillment` and `reversal` jobs
- `src/site/commerce/return/**` (return middleware handler)

**Provides**
- the payment submit branch (spec 06 §2.5: response shapes and codes) through the P1.6 seam
- the Stripe product picker markup filter
- currency routing
- `mark_payment_status`/`try_mark_paid` as `updateIf` guards
- the fulfillment snapshot (`prepare`) and outbox
- reversals with full vs partial refunds (DV-03)
- the webhook receiver: verify → dedupe → match → enqueue (DV-07, DV-10, DV-43)
- the return handler
- recording of the last webhook per provider
- the inline Stripe client with DV-21
- `CF_PAYMENT_*` tokens

**Acceptance**
- The submit branch matrix equals the oracle (unsaved, misconfigured, currency mismatch, inline, hosted, provider error).
- A paid webhook runs `form.success`, the actions and `payment.completed` exactly once, even when delivered 3 times.
- A partial refund keeps `paid` and licenses. A full refund reverses them.
- Unhandled events return 200 ignored.
- `stripe-inline.js` ≤ 0.9 KB br, with no double submit.

### P4.2a Stripe + Polar (M) · ⇉ / P4.2b PayPal + Razorpay (M) · ⇉

**Owns:** `src/core/commerce/gateways/{stripe,polar}.ts` (P4.2a) and `{paypal,razorpay}.ts` (P4.2b).

**Acceptance**
- Request captures equal the oracle, with the DV-08 Idempotency-Key and per-currency decimals (DV-04).
- Signature vectors: Stripe `t`/`v1` within 300 s; Polar Standard Webhooks with `whsec_` decoding; Razorpay HMAC hex; PayPal verify-API body with the raw event spliced in.
- Event mapping tables from spec 06 §2.10, including the Stripe legacy refund reconciliation and the PayPal capture amount check.
- A sandbox verification note per gateway (D-143 for Polar), with Gaurav-provided test keys.

### P4.3 Licensing core & license API (L) · ⇉

**Owns**
- `src/core/commerce/licensing/**`, `src/server/commerce/licensing/**`
- `src/server/routes/license.ts`
- `src/site/commerce/license/**`: `/_core-forms/package`, `/_core-forms/admin/package-upload`, the `?edd_action` middleware handler, the `/wp-json` license compat routes
- the `license-maintenance` task

**Provides**
- products, plans and the key policy (generate and validate)
- fulfill: selections, pricing, payment requirement, idempotent orders through `uniques`, the allocate-then-write plan (D-153), subscriptions
- renew (`renewal_terms`, guards)
- refund reversal (renewal entitlement replay)
- the license API dispatch: aliases, gates, the `activate` seat counter (D-152), `deactivate`, `check`, `version`
- the signed package URL and download; release publishing (streaming sha256, central-directory validation, D-154)
- events with scrubbed metadata
- maintenance with a seat recount

**Acceptance**
- License API responses equal the oracle goldens for ≥80 cases: every alias, invalid, expired, disabled, site inactive, limit reached, missing URL, lifetime and dated `expires`, `item_id` integer typing.
- The site hash equals the vectors.
- 20 concurrent activations never exceed the limit.
- The fulfillment, renewal and refund outcome matrix equals the oracle.
- Crash-resume at every fulfillment step completes exactly once.
- A 50 MB ZIP uploads and validates without exceeding CPU limits (e2e on a Cloudflare preview, run by Gaurav or an agent with his approval).

### P4.4 Customers & portal (L) · ⇉ (Wave 2)

**Owns**
- `src/core/commerce/portal/**`, `src/server/commerce/customers/**`
- `src/server/routes/{customer,portal-internal}.ts`
- `src/site/commerce/portal/**`
- `src/client/portal/**`, `src/styles/license-frontend.css`
- the `portal-sessions-sweep` task

**Provides**
- customers (create/update from purchases, DV-41)
- WP-compatible access tokens; legacy salt verification within its window (D-163)
- the `verify` → HttpOnly session → clean URL flow (DV-42)
- the portal tabs (overview, purchases, subscriptions, licenses, downloads, profile) with WP markup and classes
- deactivate site and cancel renewal
- profile editing (D-162)
- enumeration-safe access requests with throttling
- access and purchase emails through the Mailer (spec 06 §3.14 texts)
- the customer REST with field allowlists (DV-11)

**Acceptance**
- An access token generated by the WP oracle verifies with the imported legacy salt.
- The session cookie flags are correct.
- Portal markup equals the oracle for the seeded customer.
- The access request always redirects, with no enumeration.
- Customer REST shapes contain no `source_key` or `payment_id`.
- axe clean on the portal.

### P4.5 Storefront, native checkout, product pages, blocks (M) · ⇉ (Wave 2)

**Owns**
- `src/core/commerce/storefront/**`
- `src/server/routes/storefront.ts`
- `src/site/commerce/{checkout,product,storefront}/**`
- `src/astro/commerce/**`

**Provides**
- storefront routes (ETag/304, Cache-Control, compat CORS `*`, `X-WP-Total`)
- native checkout: synthetic form, Turnstile (DV-40), rate limit, 303 to the provider, free-plan flow, access-sent redirect
- the virtual product page through middleware
- the 8 PT blocks, 8 shortcodes (expander registry) and Astro components with `cf-license-*` markup

**Acceptance**
- Storefront payloads equal the oracle.
- Native checkout e2e with Stripe in test mode (Gaurav's test keys) and with a free plan.
- Shortcodes in imported HTML render the product cards.

### P4.6 Commerce admin & payment settings (L) · ⇉

**Owns:** `src/admin/commerce/**`. The editor Payment tab and the Settings Payments/Commerce sections are delivered through slots.

**Provides**
- the activation screen
- Overview with next-step tasks
- Products (editor, icon and gallery pickers, content connections, plans, releases upload, generate forms)
- Customers, Licenses (masked keys, reset activations, resend access), Orders and Storefront reference
- store settings and key policy (live preview)
- the payments settings: mode, currency routing table, per-gateway credentials with webhook URLs, test/live webhook secrets (DV-09)

**Acceptance:** Playwright for each workflow; axe clean; secrets are never rendered.

### P4.7 Commerce import & verification (M) · ⇉ (Wave 2)

**Owns:** `src/core/io/mappers/commerce.ts`, `src/server/commerce/import/**`, `src/admin/tools/commerce-verify/**`.

**Provides**
- the `data.commerce` mapping in dependency order (spec 06 §7.9)
- media references mapped to EmDash media
- package ZIPs copied from their public URLs into private R2, with a sha256 check that fails on mismatch
- open outbox rows imported
- the legacy salt option
- a verification report: row counts, every key retrievable, `(license, siteHash)` uniqueness, and sample `check_license` responses compared with the WP oracle loaded with the same export

**Acceptance:** importing the oracle's seeded commerce export matches every count and passes the sample checks; re-import is idempotent.

### Gate G4 → `v1.3.0`

- [ ] License API, storefront and webhook goldens are all equal. Concurrency tests (seats, paid webhooks, fulfillment crash-resume) are green.
- [ ] End to end on the e2e site: paid form (Stripe test) → webhook → license issued → portal login via email link → package download → refund → license disabled. A partial refund leaves the license active.
- [ ] Gatilab: G1a checks still pass. Commerce is inactive by default; no Gatilab data changes.
- [ ] U-2 answered before any store cutover (P4.8).

---

## Gatilab continuity summary

| Period | Gatilab runs | How it is protected |
|---|---|---|
| Phase 1 development | `main` = v0.1.0 (unchanged) | All work on `next` and worktrees. `emdash-next` links the main checkout only. |
| G1a cutover | `next` RC → `main` | `check_forms.py` parity run, state backup, rehearsed rollback (P1.22). |
| Phases 2–4 | `main` = last gate tag | Every gate re-runs the G1a checklist against Gatilab before fast-forwarding `main`. |
| Commerce | inactive | Master switch off. No store moves until U-2 and G4. |

---

## Risk register (owners in brackets)

| Risk | Mitigation |
|---|---|
| **libxml2 tree-building or serialization parity** turns out harder than expected (P1.3) | The corpus is weighted to the markup Gatilab and the templates actually use. If a long tail remains, the comparator may normalize only the specific libxml artifacts the DV list names, each with a test. Escalate before widening it. |
| **php-wasm lacks DOM/libxml**, or differs from production libxml (P1.1) | `wp-env` fallback. Record the libxml version. Spot-check against `emdash-next:migration/data/live/*.html` pages that contain forms. |
| A **private route through the trusted dispatcher** behaves differently from what spec 00 states (P1.0c) | Spike 1 first. Fallback: public `render` with a signed HMAC request parameter. |
| **`?url` asset imports** fail in plugin server code (P1.0c) | Fallback: the companion serves `dist/assets` under `/_core-forms/assets/*`. Preview builds its URL list from the manifest. |
| **KV sequence contention** on bursts (P1.0b) | Per-isolate block reservation (10 ids) for submissions behind a flag. Gaps are acceptable, as with MySQL auto-increment. |
| **D1 write volume** (analytics, rate limits) (P3.0) | Analytics Engine option, per-form tri-state, writes counted in tests. |
| **Provider API drift** (HubSpot v1, Polar ad-hoc checkout, Graph versions) (P2.3, P4.2a) | One endpoint constant per module. Sandbox checks with Gaurav's keys. A DV entry on change. |
| **Workers CPU on ZIP validation** (P4.3) | Central-directory-only ranged reads. Admin-side precheck. A 50 MB e2e test. |
| **Admin bundle weight** (P1.18) | Lazy builder and CodeMirror chunks; dnd-kit only in the builder chunk. |
