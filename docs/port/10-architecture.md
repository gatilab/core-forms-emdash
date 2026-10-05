# 10 · Architecture: Core Forms for EmDash (full port of 4.11.1)

This is the target architecture for the full port. It turns specs 00–06 (same folder) into one system that several implementation agents can build in parallel. Decisions and their reasons live in `11-decisions.md` (ids `D-…`, deviations `DV-…`). The build order, work packages and acceptance checks live in `12-plan.md` (ids `P…`).

**Path convention.** Every path is relative to the root of the `core-forms-emdash` repo. Paths in `emdash-next` (the Gatilab site and its import tooling) are written `emdash-next:apps/gatilab/…`. WordPress source paths are written `WP:` and point into `.reference/core-forms-wp/`.

**Reading order.** §1–§4 give the shape. §5 holds the shared TypeScript contracts every agent codes against. §6–§8 define storage and routes. §9–§17 cover each subsystem. §18 covers testing.

---

## 1. The product in one page

- **One npm package**, `@gatilab/emdash-core-forms` (GPL-2.0-or-later), with these entry points:
  - the plugin descriptor `coreForms()`
  - the plugin runtime `createPlugin()`
  - a companion Astro integration, `coreFormsSite()`
  - Astro components
  - the React admin
  - prebuilt per-capability browser bundles and stylesheets
  - a pure engine (`./core`) for tests and advanced use
- **One EmDash plugin id, `core-forms`.** Forms, workflows, analytics, polls, payments and Core Commerce share one storage namespace, one job queue and one cron task. Commerce is a feature module behind the WordPress master switch `license_server.enabled` (D-003).
- **WordPress 4.11.1 code is the reference.** Anything existing data or external code depends on stays byte-compatible:
  - export formats
  - stored settings and meta shapes
  - the front-end DOM, events, JS API and CSS
  - webhook payloads and headers
  - template tags and data variables
  - the license API

  Genuine bugs are fixed, and every intentional difference is listed in `11-decisions.md` §DEVIATIONS.
- **Platform reality** (spec 00):
  - Plugin routes live only under `/_emdash/api/plugins/core-forms/<route>`. They can't return HTML, set cookies or stream.
  - Storage queries are AND-only, use indexed fields only and return at most 100 rows. There are no multi-row transactions.
  - Cron allows at most 10 executions per minute across the whole site.
  - `ctx.email` has no From, Bcc or attachments.

  Whatever the plugin can't do, the companion integration does: pages, cookies, streaming, CORS, large uploads, legacy URL paths.

```
                    ┌────────────────────────── Astro site (Workers) ───────────────────────────┐
 browser ──HTML──▶  │ site pages ─▶ <CoreForm>/<CorePoll>/commerce components (src/astro)        │
   │  ▲             │                     │ trusted dispatch (locals.emdash.handlePluginApiRoute)│
   │  │ assets      │ coreFormsSite(): injected pages, endpoints, middleware (src/site) ──┐       │
   │  └─────────────│   /collect/<slug>/, /_core-forms/*, /account/*, /wp-json/* compat   │       │
   │                │                                                                    ▼       │
   └─XHR/beacon────▶│ /_emdash/api/plugins/core-forms/<route>  ──▶ plugin runtime (src/server)   │
                    │      public · internal · workspace · admin routes      │                   │
                    │                                                        ▼                   │
                    │  pure engine (src/core) ◀── ports ── repos/jobs/mail/files (src/server)    │
                    │                                   │            │          │                │
                    │                         D1 plugin storage + KV │   R2 private bucket       │
                    │  cron "tick" (1/min) ──▶ job queue drain ──────┘   ctx.email / Resend /     │
                    │                                                    Emailit / ctx.http       │
                    └────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Packaging, identity and configuration

### 2.1 Package exports

| Export | File | Contents | Loaded by |
|---|---|---|---|
| `.` | `src/index.ts` | `coreForms()`, `coreFormsSite()`, public types. **Light**: no runtime imports, because `astro.config.mjs` loads it at config time. | site config |
| `./runtime` | `src/runtime.ts` | `createPlugin(options)`, the descriptor `entrypoint` | EmDash generated module |
| `./site/*` | `src/site/**` | injected Astro pages, endpoints and middleware (source) | Astro build |
| `./astro` | `src/astro/index.ts` | `CoreForm`, `FormAssets`, `CorePoll`, commerce components, `blockComponents`, `renderCoreFormsInHtml` (alias `renderFormsInHtml`), `loadForm` | `componentsEntry`, site templates |
| `./admin` | `src/admin/index.tsx` | `pages`, `widgets` | `adminEntry` |
| `./core` | `src/core/index.ts` | the pure engine, re-exported for tests and advanced users | optional |
| `./extend` | `src/server/extensions/public.ts` | `registerCoreFormsExtension()` and extension types | site extension module |
| `./assets/*` | `dist/assets/*` | prebuilt minified JS and CSS bundles plus `manifest.json` | components (`?url`), companion |
| `./styles/form-theme.css` | `dist/assets/form-theme.css` | kept for v0.1.0 compatibility | sites |

`./client` (a v0.1.0 TS export) is removed: the client is now prebuilt (D-041).

### 2.2 Factories

```ts
// src/index.ts
export interface CoreFormsSiteOptions {
  /** Standalone base path segment: /<standaloneBase>/<slug>/. Build-time (D-052). Default "collect". */
  standaloneBase?: string;
  /** Customer portal base. Default "/account". Migrated WP stores use "/license-dashboard". */
  portalBase?: string;
  /** Native checkout page path. Default "/core-checkout". */
  checkoutPath?: string;
  /** Serve WordPress-compatible paths: /wp-json/core-forms/v1/*, /wp-json/cf/v1/*, and the ?edd_action, ?cf-form,
   *  ?cf_payment_return, ?product, ?cf_license_access query handlers. Default true. */
  wpCompat?: boolean;
  /** R2 binding name for private files (uploads, packages, staged imports). Default "CORE_FORMS_PRIVATE". */
  privateBucket?: string;
  /** Optional Astro layout component (module path) that wraps standalone and portal pages. */
  layout?: string;
  /** Optional module path, imported once per isolate, that calls registerCoreFormsExtension(). */
  extensions?: string;
}

export interface CoreFormsOptions {
  /** Pass the SAME object given to coreFormsSite(). `false`/absent means no companion integration (D-005). */
  site?: CoreFormsSiteOptions | false;
  /** Overrides site.privateBucket for the plugin runtime. */
  privateBucket?: string;
  /** Optional Workers Analytics Engine binding for raw analytics events (D-120). */
  analyticsEngine?: string;
  /** Cron schedule for the single recurring task. Default "* * * * *". */
  tickSchedule?: string;
}

export function coreForms(options?: CoreFormsOptions): PluginDescriptor<CoreFormsOptions>;
export function coreFormsSite(options?: CoreFormsSiteOptions): AstroIntegration;
```

Site wiring (documented in the README; Gatilab: P1.22):

```js
// astro.config.mjs
import { coreForms, coreFormsSite } from "@gatilab/emdash-core-forms";
const cfSite = { standaloneBase: "collect" };
export default defineConfig({
  integrations: [emdash({ plugins: [coreForms({ site: cfSite })] }), coreFormsSite(cfSite)],
});
```

### 2.3 Capabilities

`email:send`, `network:request:unrestricted`, `users:read`, `content:read`, `schema:read`, `media:read`, `media:write`, `media:bytes:read`.

| Capability | Why it's needed |
|---|---|
| `network:request:unrestricted` | Webhooks and integrations call operator-supplied URLs. CAPTCHA, Akismet and payment providers need outbound calls too. |
| `users:read` | Team inbox assignee pickers and access grants. |
| `content:read` + `schema:read` | The form-usage index (`content:afterSave` hook plus the backfill scan). |
| `media:*` | Upload fallback when no private bucket is bound, plus product icons and gallery images. |
| `email:send` | The default mail transport. |

### 2.4 Required and optional site setup

| Item | Required for | Notes |
|---|---|---|
| Cron trigger + `scheduled: createScheduledHandler()` | jobs, maintenance, storage indexes | Gatilab already has both. |
| `EMDASH_ENCRYPTION_KEY` | encrypted secrets (D-030) | Without it, secrets are stored in plaintext and admin shows a warning. |
| `CORE_FORMS_SECRET` (env, optional) | HMAC signing key | Otherwise a 32-byte key is generated and stored as an encrypted setting. |
| Email: an EmDash provider **or** a direct transport key (Resend/Emailit) | notifications | §11 |
| R2 binding `CORE_FORMS_PRIVATE` | private uploads; required for digital packages | §12 |
| `coreFormsSite()` | standalone pages, portal, downloads, large uploads, no-JS off-site redirects, CORS, `/wp-json` compat, previews of uploads | §8.3 |
| `<EmDashHead>`/`<EmDashBodyEnd>` | nothing (page fragments are not used) | |

---

## 3. Repository layout and module ownership

Every directory has exactly one owning work package (`12-plan.md`). An agent edits only directories its package owns. The exceptions are the registry files that P1.0a and each phase's contract package (`P2.0`, `P3.0`, `P4.0`) pre-wire with stubs, so parallel packages never touch the same file.

```
core-forms-emdash/
├── package.json  tsconfig.json  tsconfig.client.json  vitest.config.ts  eslint.config.js   P1.0a
├── AGENTS.md                      rules for implementation agents (ownership, tests, fidelity)  P1.0a
├── README.md  CHANGELOG.md        P1.0a creates; release packages update                      P1.0a
├── ROUTES.md                      GENERATED from the route registry (scripts/gen-routes.mjs)  P1.0a
├── scripts/
│   ├── build-assets.mjs           esbuild IIFE bundles + CSS minify + manifest + budgets      P1.0a
│   └── gen-routes.mjs             route registry → ROUTES.md                                  P1.0a
├── bin/core-forms.mjs             Node CLI over admin routes (API token)                      P1.20
├── wordpress/
│   ├── export-core-forms.php      read-only exporter: core-forms-data v1 + extras             P1.20
│   └── lib/competitors.php        competitor dump section (required by the exporter)          P1.21
├── tools/wp-oracle/               WordPress Playground harness producing golden fixtures      P1.1
├── e2e/                           site/ + playwright config + spikes: P1.0c; specs/<module>/ by each module's owner
├── tests/
│   ├── harness/                   in-memory EmDash ctx fakes, route/job runners, clocks       P1.0b
│   ├── golden/                    oracle output (generated, committed)                        P1.1
│   ├── fixtures/                  Gatilab forms, settings, corpora                            P1.1
│   └── <module>/                  unit/parity tests, owned by the module's package
├── src/
│   ├── index.ts  runtime.ts       factories / runtime entry                                   P1.0a
│   ├── shared/                    ISOMORPHIC, pure: no DOM, Node, EmDash or Workers APIs
│   │   ├── types/                 all cross-module contracts (§5); api/ = route I/O types     P1.0a (+P2.0/P3.0/P4.0)
│   │   ├── php/                   PHP/WP compat: phpEmpty, sanitize_title, esc_url_raw,
│   │   │                          sanitize_text_field, http_build_query, rawurlencode,
│   │   │                          number_format, php round, ucwords, mb_substr, is_email, …   P1.2
│   │   ├── money/                 ISO-4217 exponents, parse_decimal_amount, minor↔major, fmt  P1.2 (gateway rules P4.0)
│   │   ├── time/                  ISO↔WP datetime, tz math (Intl), WP date_format renderer    P1.2
│   │   ├── crypto/                sha256/hmac/md5 (WebCrypto), base64url, ulid, random       P1.2
│   │   ├── csv/                   cf_csv_row (\t formula guard incl. fullwidth)               P1.2
│   │   ├── conditions/            field rule grammar (show/hide) + action conditions          P1.4
│   │   └── expr/                  calculation grammar (server + client)                       P1.8
│   ├── core/                      PURE server engine. Imports shared/ + core/. Ports injected.
│   │   ├── settings/              defaults, messages, FormSettingsView, global settings view  P1.0b
│   │   ├── html/                  tokenizer, libxml-compatible tree + serializer, KSES,
│   │   │                          tag processor (WP_HTML_Tag_Processor subset)                P1.3
│   │   ├── schema/                FormSchema, Field, SchemaRenderer, MultiStep, MarkupParser,
│   │   │                          FieldValidator, conditional activity, custom field types    P1.4
│   │   ├── render/                Form::get_html, data attrs, asset manifest, replacements,
│   │   │                          block wrapper, standalone document model, headless DTO      P1.5
│   │   ├── a11y/                  cf_enhance_accessibility                                    P1.5
│   │   ├── theme/                 token sanitizer, CSS generator, contrast                    P1.5
│   │   ├── policy/                schedule.ts (P1.5) · availability.ts, capacity.ts (P1.6)
│   │   ├── templating/            {{tags}}, [data vars], cf_field_value, all-fields format    P1.6
│   │   ├── pipeline/              Forms::process steps 1–20, response, PRG, rehearsal core    P1.6
│   │   ├── calc/                  FieldCalculator (uses shared/expr)                          P1.8
│   │   ├── drafts/                save/load/expiry logic                                      P1.8
│   │   ├── spam/                  reCAPTCHA, Turnstile, hCaptcha, math, Akismet validators    P1.9
│   │   ├── privacy/               retention candidates, erase plan, GDPR export format        P1.9
│   │   ├── uploads/               normalization, extension/MIME sniff rules, descriptors      P1.10
│   │   ├── polls/                 poll model, voter hash, render markup, results               P1.15
│   │   ├── templates/             63 templates as data (oracle-generated) + presets           P1.16
│   │   ├── a11y-audit/            AccessibilityTester rules + autofix                         P1.18
│   │   ├── submissions/           summary/presentation, filters, CSV builders                 P1.19a
│   │   ├── io/                    envelopes, validators, WP↔record mappers                    P1.20
│   │   │   ├── mappers/<dataset>.ts  one file per dataset; polls.ts P1.15, analytics.ts P3.0,
│   │   │   │                         commerce.ts P4.7, the rest P1.20 (stubs pre-wired by P1.20)
│   │   │   └── importers/         CF7, Gravity, WPForms, Fluent, Ninja, Formidable            P1.21
│   │   ├── actions/
│   │   │   ├── runtime/           conditions eval, run key, ledger FSM, normalize, http accept,
│   │   │   │                      redaction, signer, payload/mapping helpers                  P1.11 (P2.1 extends)
│   │   │   ├── core/              email, autoresponder, webhook                               P1.11
│   │   │   ├── integrations/      one file per action type                                    P2.2–P2.5
│   │   │   └── inbound/           resend, whatsapp-meta, whatsapp-twilio verifiers/parsers    P2.4, P2.5
│   │   ├── analytics/             rollup math, funnel, recommendations                        P3.0
│   │   └── commerce/              payments/ gateways/ licensing/ portal/ storefront/          P4.x
│   ├── server/                    EmDash ADAPTER (imports emdash; cloudflare:workers only in server/platform/)
│   │   ├── plugin.ts  context.ts  admin-config.ts                                             P1.0b (admin-config P1.0a)
│   │   ├── platform/              env bindings (R2, AE), after(), waitUntil budget            P1.0b
│   │   ├── storage/               collections.ts (P1.0a) · repos base, uniques, ephemeral,
│   │   │                          locks, counters, id sequences                               P1.0b
│   │   ├── settings/ secrets/ events/ extensions/ jobs/ http/                                 P1.0b
│   │   ├── routes/                framework.ts, registry.ts (P1.0a/P1.0b); one file per module,
│   │   │                          owned by that module's package                              (various)
│   │   ├── forms/                 FormRepo, publishing, revisions, slugs, usage index,
│   │   │                          field groups                                                P1.7
│   │   ├── submit/                submit/render/headless adapters, PRG tokens                 P1.6
│   │   ├── drafts/ (P1.8)  spam/ privacy/ (P1.9)  files/ (P1.10)  actions/ mail/ (P1.11)
│   │   ├── polls/ (P1.15)  submissions/ (P1.19a)  io/ migrate/ doctor/ (P1.20)
│   │   ├── analytics/ (P3.0)  commerce/ (P4.1–P4.7)
│   ├── astro/                     components, loader, HTML expander, request asset registry  P1.14 (polls/ P1.15, commerce/ P4.5)
│   ├── site/                      coreFormsSite(): integration, middleware, pages, endpoints  P1.14
│   │   ├── routes.ts              companion route registry (pre-wired by P1.0a / x.0)        P1.0a
│   │   ├── endpoints/files/       upload, download, no-JS multipart forwarder                P1.10
│   │   ├── endpoints/polls/       poll vote endpoint that sets the HttpOnly voter cookie     P1.15
│   │   ├── endpoints/inbound/     TwiML-returning Twilio endpoint                            P2.5
│   │   └── commerce/              return/ (P4.1), license/ (P4.3), portal/ (P4.4),
│   │                              checkout/ product/ storefront/ (P4.5)
│   ├── client/                    browser TS → dist/assets/*.js (IIFE)
│   │   ├── core/ captcha/ (P1.12)  smart/ fullscreen/ upload/ (P1.13)  poll/ (P1.15)
│   │   ├── analytics/ (P3.1)  stripe/ (P4.1)  portal/ (P4.4)  embed/ (P1.14)
│   ├── styles/                    WP CSS, verbatim + header (forms, form-theme, smart-forms,
│   │                              multi-step, fullscreen, standalone: P1.12/P1.13; poll: P1.15;
│   │                              license-frontend: P4.5)
│   └── admin/                     React (kumo + phosphor), compiled by the host
│       ├── index.tsx              page/widget registry with stubs                             P1.0a (+x.0)
│       ├── lib/                   typed route caller, navigation, ui kit, styles              P1.0a carries v0.1.0 lib; P1.17 owns after
│       ├── shell/ forms/ editor/ actions/ settings/ theme/   P1.17      builder/  P1.18
│       ├── submissions/ email-logs/  P1.19b             polls/  P1.15
│       ├── tools/  P1.20 (importers/ P1.21)             workflows/  P2.6
│       ├── analytics/  P3.2                             commerce/  P4.6
└── docs/port/                     specs 00–06, this architecture 10–12
```

---

## 4. Runtime layers and import rules

| Layer | Location | May import | Runs in | Notes |
|---|---|---|---|---|
| shared | `src/shared` | `src/shared` only | anywhere | Grammar, compat helpers, contracts. |
| core | `src/core` | shared, core | Workers, Node tests, admin browser (pure parts) | No `emdash`, no `cloudflare:workers`, no DOM. I/O goes through port interfaces (`src/shared/types/ports.ts`). |
| server | `src/server` | shared, core, `emdash`; `cloudflare:workers` **only** in `src/server/platform/` | Workers isolate | Implements the ports, routes, jobs, transports. |
| astro | `src/astro` | shared, core **types**, `emdash/plugin-utils` | Astro SSR | Never imports server. Calls plugin routes through the trusted dispatcher. |
| site | `src/site` | shared, core types, astro, `emdash`, `cloudflare:workers` (endpoint files only) | Astro build + SSR | Thin: authenticate/parse/stream, then dispatch to internal plugin routes. |
| client | `src/client` | `src/shared/conditions`, `src/shared/expr`, `src/client` | browser | Compiled to IIFE bundles. No framework. |
| admin | `src/admin` | shared, `src/shared/types/api`, `src/admin`, pure `src/core/{schema,html,io,templates}` | admin browser | Calls routes only via `src/admin/lib/route.ts`. |

These rules are enforced by `eslint.config.js` (`no-restricted-imports` per directory) in CI.

**Ports.** Core modules receive their dependencies explicitly. The server builds one `CfContext` per request or job (`src/server/context.ts`) that implements every port:
- repositories
- ephemeral store
- locks
- id sequences
- job queue
- mailer
- file store
- HTTP
- event bus
- settings views
- clock
- logger

Tests build the same thing from `tests/harness`.

---

## 5. Shared contracts (TypeScript)

These live in `src/shared/types/`. P1.0a writes them; later contract packages extend them. They are normative: field names, unions and optionality are binding. Comments cite the spec sections that define behaviour.

### 5.1 Primitives

```ts
// src/shared/types/primitives.ts
/** Decimal digits, no leading zero. WordPress-compatible numeric id stored as a string ("1058461"). */
export type NumericId = string;
/** UTC ISO-8601 with milliseconds: "2026-10-05T04:03:41.000Z". The only storage format for instants. */
export type IsoDateTime = string;
/** UTC "YYYY-MM-DD HH:mm:ss". Produced only at WP-compatible boundaries (tokens, exports, license API). */
export type WpDateTime = string;
export type WpScalar = string | number | boolean | null;
export type WpValue = WpScalar | WpValue[] | { [key: string]: WpValue };
/** A flag as WordPress stored it ("1", "0", 1, true, "", "on", …). Read with phpTruthy()/phpEmpty(). */
export type WpFlag = WpScalar | undefined;
/** Per-form override of a global: "" inherit, "1" on, "0" off. */
export type TriState = "" | "1" | "0";
/** Sealed secret leaf (D-030). Plaintext never leaves the server except in opted-in exports. */
export interface SealedSecret { $secret: string /* AES-GCM envelope from encryptPluginSetting, or "plain:<v>" without a key */ }
```

### 5.2 Forms and schema

```ts
// src/shared/types/forms.ts
export type FormStatus = "publish" | "draft" | "pending" | "private";

/** Raw `_cf_settings`, stored verbatim (keys, value types, unknown keys). Defaults are merged at read time.
 *  Secret leaves inside `actions[i]` are SealedSecret (D-030). Spec 01 §1.3 lists every known key. */
export interface WpFormSettings {
  actions?: ActionConfig[];
  [key: string]: WpValue | ActionConfig[] | SealedSecret | undefined;
}

/** FormDefinition::snapshot() (spec 01 §3.16). meta holds _cf_settings, _cf_form_schema, _cf_headless,
 *  _cf_hidden_columns and every cf_message_* key, ksorted. */
export interface DefinitionSnapshot {
  title: string; slug: string; status: FormStatus; markup: string;
  meta: Record<string, WpValue>;
}

export interface FormRecord {
  id: NumericId;
  n: number;                                 // Number(id), for numeric ordering
  slug: string;
  title: string;
  status: FormStatus;
  markup: string;                            // post_content, without <form>
  settings: WpFormSettings;                  // _cf_settings
  messages: Record<string, string>;          // cf_message_{key} overrides only
  schema: FormSchemaJson | null;             // _cf_form_schema
  live: DefinitionSnapshot | null;           // _cf_live_definition; draft publishing is on when non-null
  /** Every other post meta key, verbatim: _cf_hidden_columns, _cf_headless, _cf_a11y_report,
   *  _cf_*_source_id provenance, _cf_license_* links, unknown keys. */
  meta: Record<string, WpValue>;
  authorId: string | null;                   // EmDash user id
  wp?: { postAuthor?: number; postDate?: WpDateTime; postDateGmt?: WpDateTime; postExcerpt?: string; menuOrder?: number };
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  trashedAt: IsoDateTime | null;
  version: number;                           // +1 on every definition write; the CAS guard (D-062)
  // denormalized for indexed lookups
  liveSlug: string | null;                   // live.slug when live is set
  publicSlug: string;                        // sanitize_title(standalone_slug) || sanitize_title(slug)
  standalone: boolean;                       // phpTruthy(settings.standalone_enabled)
  headless: boolean;                         // phpTruthy(settings.headless_enabled)
}

/** Typed, read-only view over effective settings = { ...defaults(registry), ...stored } (array_merge). */
export interface FormSettingsView {
  readonly raw: Readonly<Record<string, WpValue>>;
  has(key: string): boolean;
  get(key: string): WpValue | undefined;
  flag(key: string): boolean;                          // PHP truthiness
  int(key: string, fallback?: number): number;         // (int) cast semantics
  str(key: string): string;
  tri(key: "load_stylesheet" | "load_form_theme" | "analytics_enabled"): TriState;
  list(key: "required_fields" | "email_fields"): string[]; // comma list, trimmed, [] suffix stripped
  days(): string[];                                    // schedule_days
  actions(): ActionConfig[];                           // never undefined
}

/** What render and submit consume. */
export interface ResolvedForm {
  id: NumericId; slug: string; title: string; status: FormStatus; markup: string;
  settings: FormSettingsView;
  messages: Record<string, string>;          // defaults ⊕ overrides (spec 01 §1.4)
  schema: FormSchemaJson | null;
  source: "live" | "draft" | "revision";     // public paths always use "live" (D-061)
  version: number;
  fingerprint: string;                       // opaque concurrency token (D-062)
}

// src/shared/types/schema.ts  (spec 01 §2)
export interface FormSchemaJson {
  version: 1;
  fields: FieldDef[];                        // ORDER MATTERS for rendering
  layout: { type: "single" | "multi-step" | "conversational"; steps?: StepDef[] };
  form_settings?: Record<string, WpValue>;
}
export interface StepDef { id: string; label?: string; title?: string }

export type NativeInputType =
  | "text" | "email" | "url" | "tel" | "number" | "date" | "time" | "datetime-local" | "password"
  | "color" | "range" | "hidden" | "file" | "search" | "month" | "week";
export type BuiltinFieldType =
  | NativeInputType | "textarea" | "select" | "radio" | "checkbox"
  | "name" | "address" | "consent" | "rating"
  | "container" | "fieldset" | "heading" | "paragraph" | "divider" | "html"
  | "submit" | "button" | "reset";

export interface FieldDef {
  name: string;
  type: BuiltinFieldType | (string & {});    // custom types registered via extensions
  label: string;
  placeholder: string;
  required: boolean;
  position: number;
  default_value?: string;
  default_values?: string[];
  checked?: true;
  css_class?: string;
  description?: string;
  options?: FieldOption[];
  validation?: Partial<Record<"min" | "max" | "minlength" | "maxlength" | "pattern" | "step", string | number>>;
  conditions?: FieldCondition[];
  wrapper_attributes?: Record<string, WpScalar>;
  /** Includes parent, cols_*, gap (duplicated at top level), calculation | data-calculation,
   *  data-counter, data-resize, level, id, and allow-listed HTML attributes. */
  attributes?: Record<string, WpScalar>;
  group?: string;
  parent?: string | null;
  cols_desktop?: number | string; cols_tablet?: number | string; cols_mobile?: number | string; gap?: string;
  [key: string]: WpValue | FieldOption[] | FieldCondition[] | undefined; // unknown keys preserved
}
export interface FieldOption {
  value: string; label: string; disabled?: boolean; group?: string; id?: string;
  css_class?: string; attributes?: Record<string, WpScalar>;
}
/** Client and server rule grammar (spec 03 §1.1): name ( (":"|"=") v1 ("|" v2)* )?, where "*" means non-empty. */
export interface FieldCondition { action: "show" | "hide"; rule: string }

export interface CustomFieldType {
  type: string;                              // /^[a-z][a-z0-9_-]{2,60}$/, not built-in
  label: string; description?: string;
  nativeType: "text" | "email" | "url" | "tel" | "number" | "date" | "textarea" | "select";
  defaults?: Partial<FieldDef>;
  render(field: FieldDef, id: string): string;          // output is KSES-sanitized
  validate(value: SubmissionValue | undefined, field: FieldDef, data: SubmissionData): string | true | "";
  script?: string;                                      // asset URL emitted when the type renders
}
```

### 5.3 Submissions

```ts
// src/shared/types/submissions.ts
export type SubmissionStatus =
  | "new" | "read" | "replied" | "archived"           // inbox workflow
  | "draft" | "partial"                               // save & resume ("partial" is never written; imported only)
  | "pending_payment" | "paid" | "payment_failed" | "refunded";
export type PaymentStatus = "pending_payment" | "paid" | "payment_failed" | "refunded";

/** Stored file reference. WP keys kept; `dir` is never stored or sent (DV-27). */
export interface FileDescriptor {
  name: string;                              // stored filename
  original_name: string;
  type: string;                              // client MIME
  size: number;
  url: string;                               // download route for private files; WP URL for legacy imports
  file_id: string;                           // files collection id
  private?: true;
  attachment_id?: number;                    // legacy WP attachment, imports only
}
export type RetiredFile = "Attachment removed by retention";
export type SubmissionValue = string | number | string[] | FileDescriptor | FileDescriptor[] | RetiredFile;
export type SubmissionData = Record<string, SubmissionValue>;

export interface SubmissionRecord {
  id: NumericId; n: number;
  formId: NumericId | "0";                   // "0" = Core Commerce native checkout
  data: SubmissionData;                      // spec 01 §1.8 shapes; may hold server-owned "_cf_license_checkout"
  userAgent: string | null;
  ipAddress: string | null;                  // null when settings.emdash.store_ip is false
  refererUrl: string | null;
  country: string | null;                    // EmDash extension (requestMeta.geo)
  isSpam: boolean;                           // orthogonal to status (spec 04 §2.1)
  status: SubmissionStatus;
  bucket: "inbox" | "archived" | "spam";     // derived on every write: isSpam ? spam : status==="archived" ? archived : inbox
  draftToken: string | null;                 // 64 hex
  currentStep: number;
  paymentStatus: PaymentStatus | null;
  paymentProvider: string | null;
  paymentId: string | null;
  paymentAmount: number | null;              // minor units
  paymentCurrency: string | null;
  paymentRefundedMinor: number | null;       // partial-refund tracking (DV-03)
  submittedAt: IsoDateTime;
  modifiedAt: IsoDateTime | null;            // UTC (DV-30)
  emailKey: string | null;                   // lowercased first valid email in data (search, GDPR)
  origin: "submit" | "headless" | "draft" | "import" | "checkout" | "admin" | "migrate";
  legacyId?: string;                         // v0.1.0 uuid after migration
}

/** For save_submissions = 0 runs: never stored as a submission; travels inside the dispatch job and is scrubbed afterwards. */
export interface EphemeralSubmission extends Omit<SubmissionRecord, "id" | "n"> { id: ""; executionId: string }

export type WriteContext =
  | "submit" | "admin_edit" | "draft" | "delete" | "status" | "spam" | "payment" | "gdpr" | "rest_update"
  | "cli" | "import" | "data_management" | "team" | "erase" | "attachment_retention" | "license_commerce"
  | "fulfillment" | "refund_reconciliation" | "migrate";

/** Exact AJAX/headless response contract (spec 01 §4.4, spec 02 §2.1). `text` is HTML. */
export interface SubmitResponse {
  message: { type: "success" | "error" | "warning"; text: string };
  error?: true;
  hide_form?: boolean;
  redirect_url?: string;
  payment?: {
    provider: string; mode: "test" | "live"; flow?: "inline" | "hosted";
    payment_id?: string; client_secret?: string; publishable_key?: string; return_url?: string;
  };
}
```

### 5.4 Jobs

```ts
// src/shared/types/jobs.ts
export type JobKind =
  | "dispatch"        // fan out a successful submission's actions (one per submission run)
  | "action"          // one action execution (WP cf_action_queue row equivalent)
  | "fulfillment"     // paid outbox (P4)
  | "reversal"        // refund outbox (P4)
  | "payment-event"   // apply a verified provider webhook event (P4)
  | "mail"            // system mail: team reminders, license/portal mails, replies retry
  | "maintenance"     // payload.task names the maintenance task (§10.4)
  | "erase"           // coordinated delete of one submission (files, cascades)
  | "column-rewrite"  // rename/delete a data column across a form's submissions
  | "usage-scan"      // form-usage index backfill
  | "migrate"         // v0.1.0 → v1 data migration batches
  | "import-files"    // copy legacy WP upload files into R2
  | "inbound-event";  // Resend delivery event / WhatsApp inbound (P2)

export type JobStatus = "pending" | "running" | "done" | "failed" | "cancelled" | "paused";

export interface Job<P extends WpValue = WpValue> {
  id: string;                      // deterministic idempotency key ("dispatch:1058462:submit", "action:<runKey>")
  kind: JobKind;
  status: JobStatus;
  priority: number;                // lower first; WP default 10
  runAt: IsoDateTime;
  attempts: number;
  maxAttempts: number;
  payload: P;
  refType: "submission" | "order" | "form" | "license" | "poll" | null;
  refId: string | null;
  formId: NumericId | null;
  claimId: string | null;          // set while running
  lockedAt: IsoDateTime | null;
  lastError: string | null;        // redacted, ≤1000 chars
  result: WpValue | null;
  createdAt: IsoDateTime; updatedAt: IsoDateTime; completedAt: IsoDateTime | null;
}

export type JobOutcome =
  | { status: "done"; result?: WpValue }
  | { status: "retry"; error: string; delayMs: number }        // attempts+1, runAt = now + delay
  | { status: "failed"; error: string }                        // terminal
  | { status: "paused"; error: string };                       // needs admin (e.g. uncertain delivery)

export interface JobHandler<P extends WpValue = WpValue> {
  kind: JobKind;
  timeoutMs: number;               // ≤ 20 000 (cron budget) unless the handler checkpoints
  maxAttempts: number;
  onStale: "retry" | "pause";      // a lock older than 10 min is treated as a crashed run
  run(job: Job<P>, cx: CfContext): Promise<JobOutcome>;
}

export interface JobQueue {
  /** Create-only (compareAndSet null). Returns false if the id already exists. */
  enqueue<P extends WpValue>(job: NewJob<P>): Promise<boolean>;
  /** Best-effort immediate run of these ids in after(); safe if cron also claims them. */
  kick(ids: string[]): void;
  get(id: string): Promise<Job | null>;
  cancel(id: string): Promise<boolean>;
  retry(id: string, patch?: Partial<Pick<Job, "payload" | "runAt">>): Promise<boolean>;
}
export type NewJob<P extends WpValue> = Pick<Job<P>, "id" | "kind" | "payload"> &
  Partial<Pick<Job<P>, "priority" | "runAt" | "maxAttempts" | "refType" | "refId" | "formId">>;
```

### 5.5 Actions

```ts
// src/shared/types/actions.ts
/** One element of settings.actions (spec 05 §1.3). Stored verbatim, string-typed, unknown keys kept. */
export interface ActionConfig {
  type: string;
  _cf_action_id?: string;          // "action-N" (0-based) or "action-<uuid>"; never renumbered
  async?: WpFlag;
  conditions?: ActionCondition[];
  enabled?: WpFlag;                // EmDash extension (default true); absent in WP data
  recipient_routes?: RecipientRoute[];
  [key: string]: WpValue | SealedSecret | ActionCondition[] | RecipientRoute[] | undefined;
}
export interface ActionCondition { field: string; operator: string; value?: string } // unknown operator ⇒ row fails
export interface RecipientRoute { field: string; operator: string; value: string; recipient: string }

export type ActionStatus = "success" | "failed" | "queued" | "skipped" | "unverified" | "uncertain";
export interface ActionOutcome {
  status: ActionStatus;
  message: string;                 // redacted per spec 05 §1.8
  meta?: Record<string, WpValue>;
  retryable?: boolean;
  retryAfterS?: number;            // clamped 0..3600
  redirectUrl?: string;            // inline-phase actions only
}

export interface ActionFieldSpec {
  key: string; label: string;
  type: "text" | "textarea" | "password" | "email" | "url" | "number" | "select" | "checkbox"
      | "field" | "fields" | "json" | "lines" | "conditions" | "recipient_routes" | "remote_select";
  default?: string; required?: boolean; help?: string;
  options?: { value: string; label: string }[];
  remote?: string;                 // admin route returning options (e.g. "actions/emailit-audiences")
  secret?: boolean;
  showWhen?: { key: string; equals: string };
}

export interface ActionModule<S extends ActionConfig = ActionConfig> {
  type: string;
  label: string;
  category: "notifications" | "messaging" | "data" | "marketing" | "support" | "community" | "automation" | "commerce";
  docsSlug: string;
  defaults: Partial<S>;            // exact WP keys and defaults (spec 05 §3)
  fields: ActionFieldSpec[];       // drives the generic admin card (P2.6)
  secretKeys: readonly string[];   // sealed at rest, masked in admin, redacted in logs
  queueable: boolean;              // ActionRunner::can_queue
  phase: "inline" | "after";       // inline = must finish before the submit response (redirect producers)
  destinationKeys?: readonly string[];
  available(g: GlobalSettingsView): true | string;   // string = reason shown on the card
  run(settings: S, rc: RunContext): Promise<ActionOutcome | boolean | number | null | void>; // normalized like WP
}

/** Imported WordPress-only types: kept verbatim, never executed (D-104). */
export interface WpOnlyActionType { type: string; label: string; dependency: string }

export interface RunContext {
  form: ResolvedForm;
  submission: SubmissionRecord | EphemeralSubmission;
  runKey: string;                  // sha256 per spec 05 §2.1
  actionId: string;
  index: number;
  testing: boolean;
  actor: { userId: string } | null; // admin for replay/test, null for public
  fetch(url: string, init: RequestInit & { timeoutMs: number; redirect?: "follow" | "manual"; maxResponseBytes?: number }): Promise<Response>;
  step<T extends WpValue>(name: string, fn: () => Promise<T>): Promise<T>; // ledger-checkpointed
  render(template: string, escape?: "none" | "html" | "header" | "strip_tags" | "telegram"): string; // [data variables]
  mail: Mailer;
  replies: ReplyStore;
  files: FileReader;
  globals: GlobalSettingsView;
  secret(value: WpValue | SealedSecret | undefined): Promise<string>;
  setRedirect(url: string): void;  // inline phase only
  log: Logger;
  now(): Date;
}
```

### 5.6 Mail transport

```ts
// src/shared/types/mail.ts
export interface MailAddress { email: string; name?: string }
export interface MailAttachment { filename: string; contentType: string; content: Uint8Array }
export interface MailMessage {
  to: MailAddress[];               // WP: comma list, every address a To recipient
  cc?: MailAddress[];
  bcc?: MailAddress[];
  from?: MailAddress;              // honoured only by transports with capabilities.from
  replyTo?: MailAddress[];
  subject: string;
  text: string;                    // required by EmDash
  html?: string;
  headers?: Record<string, string>;
  attachments?: MailAttachment[];
  idempotencyKey?: string;
  meta: { formId?: NumericId; submissionId?: NumericId; actionType: string; runKey?: string };
}
export interface TransportCapabilities {
  from: boolean; cc: boolean; bcc: boolean; multipleTo: boolean;
  attachments: boolean; headers: boolean; idempotency: boolean;
}
export interface MailTransport {
  id: "emdash" | "resend" | "emailit" | (string & {});
  label: string;
  capabilities: TransportCapabilities;
  isAvailable(cx: CfContext): Promise<true | string>;
  /** One provider call. The Mailer plans splits; transports never see a message they can't express. */
  send(m: TransportMessage, cx: CfContext): Promise<TransportSendResult>;
}
export type TransportMessage = Omit<MailMessage, "meta">;
export interface TransportSendResult { ok: boolean; providerMessageId?: string; error?: string; retryable?: boolean; retryAfterS?: number }
export interface MailResult {
  ok: boolean;                     // every planned send succeeded
  deliveries: { to: string[]; cc: string[]; ok: boolean; providerMessageId?: string; error?: string }[];
  dropped: ("from" | "headers" | "attachments")[];
  logId: string;                   // emailLogs row
  transport: string;
}
export interface Mailer { send(m: MailMessage, opts?: { log?: boolean }): Promise<MailResult> }
```

### 5.7 Payments and commerce (Phase 4 contracts, declared now so storage is created early)

```ts
// src/shared/types/commerce.ts
export type GatewayId = "stripe" | "paypal" | "razorpay" | "polar";
export type PaymentMode = "test" | "live";

export interface CheckoutInput {
  submissionId: NumericId; formId: NumericId | "0";
  amountMinor: number; currency: string;     // ISO-4217 upper case
  description: string; customerEmail?: string;
  returnUrls: { success: string; cancel: string };
  idempotencyKey: string;                     // sha256("cf-<gateway>-<kind>-<sid>")
  mode: PaymentMode;
  polarProductId?: string;
}
export interface CheckoutSession { paymentId: string; redirectUrl: string }
export interface InlineIntent { paymentId: string; clientSecret: string; publishableKey: string; returnUrl: string }

export interface RawWebhookRequest { body: Uint8Array; text: string; headers: Headers; url: string; receivedAt: Date }
export interface VerifiedWebhook { provider: GatewayId; eventId: string; type: string; payload: WpValue }
export interface NormalizedPaymentEvent {
  provider: GatewayId; eventId: string; type: string;
  paymentId: string;                          // matches submissions.paymentId
  submissionId?: NumericId;                   // from metadata when available
  status: "pending" | "paid" | "failed" | "refunded" | "partially_refunded";
  amountMinor?: number; refundedMinor?: number; currency?: string;
  needsCapture?: boolean;                     // PayPal CHECKOUT.ORDER.APPROVED
}

export interface PaymentGateway {
  id: GatewayId; label: string;
  isConfigured(cfg: PaymentsConfigView, mode: PaymentMode): boolean;
  supportsInline: boolean;
  createCheckout(input: CheckoutInput, gx: GatewayContext): Promise<CheckoutSession>;
  createInlineIntent?(input: CheckoutInput, gx: GatewayContext): Promise<InlineIntent>;
  /** null ⇒ 401 invalid_signature; throw ⇒ 503 (provider retries). */
  verifyWebhook(req: RawWebhookRequest, gx: GatewayContext): Promise<VerifiedWebhook | null>;
  /** `{ ignored: true }` ⇒ 200 {received:true, ignored:true} (DV-07). */
  normalize(ev: VerifiedWebhook, gx: GatewayContext): Promise<NormalizedPaymentEvent | { ignored: true }>;
  capture?(paymentId: string, expected: { amountMinor: number; currency: string }, gx: GatewayContext): Promise<NormalizedPaymentEvent | null>;
}

export type ProductType = "plugin" | "theme" | "digital" | "service" | "event";
export interface ProductRecord {
  id: NumericId; n: number; slug: string; name: string; version: string; type: ProductType;
  activationLimit: number; status: "active" | "archived"; description: string;
  details: Record<string, WpValue>;          // spec 06 §3.3
  iconMediaId: string | null; galleryMediaIds: string[];
  checkoutFormId: NumericId | null; renewalFormId: NumericId | null;  // WP "content connection" post ids, mapped
  legacy?: { iconAttachmentId?: number; galleryIds?: number[]; checkoutPostId?: number; renewalPostId?: number };
  createdAt: IsoDateTime; updatedAt: IsoDateTime;
}
export interface PlanRecord {
  id: NumericId; n: number; productId: NumericId; slug: string; name: string;
  priceMinor: number; currency: string;
  billingPeriod: "day" | "week" | "month" | "year" | "lifetime"; billingInterval: number;
  activationLimit: number; licenseDurationDays: number; trialDays: number;
  status: "active" | "archived"; checkoutUrl: string | null;
  createdAt: IsoDateTime; updatedAt: IsoDateTime;
}
export interface OrderRecord {
  id: NumericId; n: number; orderNumber: string; sourceKey: string;
  submissionId: NumericId | null; formId: NumericId | null; customerId: string | null; legacyUserId: number | null;
  customerEmail: string; customerEmailKey: string; customerName: string;
  status: "paid" | "refunded" | "pending" | "failed"; currency: string;
  subtotalMinor: number; totalMinor: number; refundedMinor: number;
  paymentProvider: string | null; paymentId: string | null;
  createdAt: IsoDateTime; paidAt: IsoDateTime | null;
}
export interface LicenseRecord {
  id: NumericId; n: number; productId: NumericId; submissionId: NumericId | null; orderItemId: NumericId | null;
  licenseKey: string;                        // plaintext, byte-exact, case-sensitive (spec 06 §5.4)
  customerEmail: string; customerEmailKey: string; customerId: string | null; legacyUserId: number | null;
  status: "active" | "disabled" | "expired";
  activationLimit: number;
  activeSites: number;                       // maintained with updateIf guards (D-152)
  expiresAt: IsoDateTime | null;             // null = lifetime
  createdAt: IsoDateTime; updatedAt: IsoDateTime;
}
export interface CustomerRecord {
  id: string;                                // "cus_<ulid>"
  email: string; emailKey: string;
  firstName: string; lastName: string; displayName: string;
  billing: { phone?: string; company?: string; taxId?: string; address1?: string; address2?: string;
             city?: string; state?: string; postcode?: string; country?: string };
  siteUrl: string | null; legacyWpUserId: number | null;
  createdAt: IsoDateTime; updatedAt: IsoDateTime;
}
```

The remaining commerce records (`orderItems`, `activations`, `packages`, `subscriptions`, `downloads`, `commerceEvents`, `customerSessions`, `fulfillment`, `reversals`, `paymentEvents`) mirror the WP tables in spec 06 §3.2 field-for-field in camelCase. They also carry `n` for numeric ids and an `emailKey` wherever WP compares `LOWER(TRIM(email))`. P4.0 writes them out in full in `src/shared/types/commerce.ts`. Their storage declaration is in §6.2.

### 5.8 Context, settings views, events

```ts
// src/shared/types/ports.ts (abridged; P1.0a writes the full file)
export interface CfContext {
  now(): Date;
  ids: IdService;                  // next(entity) → NumericId; ulid(prefix?)
  forms: FormRepo; submissions: SubmissionRepo; files: FileStore; jobs: JobQueue; mail: Mailer;
  ephemeral: EphemeralStore; locks: LockService; uniques: UniqueIndex; counters: CounterStore;
  settings: GlobalSettingsView; secrets: SecretService; theme: ThemeStore;
  events: EventBus; extensions: ExtensionRegistry;
  http: HttpClient;                // ctx.http + timeouts + SSRF pre-check
  site: { name: string; url: string; adminEmail: string; locale: string; companion: CoreFormsSiteOptions | null };
  request?: { ip: string | null; userAgent: string | null; referer: string | null; country: string | null; url: string };
  user?: { id: string; email: string; role: number } | null;
  log: Logger;
  afterResponse(fn: () => Promise<void>): void;  // after() with a budget tracker
}

export interface IdService { next(entity: IdEntity): Promise<NumericId>; ensureAtLeast(entity: IdEntity, n: number): Promise<void>; ulid(prefix?: string): string }
export type IdEntity = "form" | "submission" | "poll" | "product" | "plan" | "order" | "orderItem" | "license"
  | "activation" | "package" | "subscription" | "download" | "commerceEvent";

export interface EphemeralStore {
  get<T extends WpValue>(key: string): Promise<{ value: T; exp: number } | null>;
  /** Create-only; false if a live entry exists. */
  add(key: string, value: WpValue, ttlMs: number): Promise<boolean>;
  set(key: string, value: WpValue, ttlMs: number): Promise<void>;
  /** Sliding counter: count+1 and exp = now+ttl, atomically (updateIf + CAS create). */
  bump(key: string, ttlMs: number): Promise<number>;
  peek(key: string): Promise<number>;     // current live count, 0 if absent/expired
  take<T extends WpValue>(key: string): Promise<T | null>; // read and delete (single use)
  delete(key: string): Promise<void>;
}
export interface LockService { withLock<T>(name: string, opts: { ttlMs: number; waitMs: number }, fn: () => Promise<T>): Promise<T> } // throws LockBusy
export interface UniqueIndex { claim(ns: string, value: string, ref: string): Promise<{ ok: true } | { ok: false; ref: string }>; release(ns: string, value: string, ref: string): Promise<void>; lookup(ns: string, value: string): Promise<string | null> }

/** Global settings: WP cf_settings shape + `emdash` extension subtree (§7.1). */
export interface GlobalSettingsView {
  raw(): Readonly<Record<string, WpValue>>;   // secrets appear as SealedSecret
  get(path: string): WpValue | undefined;     // "google_recaptcha.site_key", "emdash.timezone"
  flag(path: string): boolean;
  str(path: string): string;
  secret(path: string): Promise<string>;      // decrypts; "" when unset
  timezone(): string; dateFormat(): string; timeFormat(): string;
}

export interface CoreFormsEvents {
  "submission.written": { ids: NumericId[]; context: WriteContext; submission?: SubmissionRecord; form?: ResolvedForm };
  "submission.inserted": { submission: SubmissionRecord; form: ResolvedForm };
  "submission.insertFailed": { submission: Omit<SubmissionRecord, "id" | "n">; form: ResolvedForm; error: string };
  "submission.blocked": { form: ResolvedForm; reason: string };
  "form.success": { submission: SubmissionRecord | EphemeralSubmission; form: ResolvedForm; origin: "submit" | "replay" | "fulfillment" };
  "form.response": { form: ResolvedForm; submission: SubmissionRecord | EphemeralSubmission | null; code: string };
  "action.skipped": { form: ResolvedForm; action: ActionConfig; submission: SubmissionRecord | EphemeralSubmission; reason: string };
  "action.finished": { runKey: string; outcome: ActionOutcome; form: ResolvedForm; submissionId: NumericId | null };
  "webhook.response": { form: ResolvedForm; action: ActionConfig; status: number };
  "delivery.reconciled": { runKey: string; outcome: "delivered" | "not_delivered"; evidence: string };
  "whatsapp.replyReceived": { submissionId: NumericId; provider: "meta" | "twilio"; text: string };
  "poll.voted": { pollId: NumericId; options: number[]; other: string; voterHash: string };
  "payment.completed": { submission: SubmissionRecord; form: ResolvedForm };
  "payment.refunded": { submission: SubmissionRecord; partial: boolean };
  "license.orderFulfilled": { orderId: NumericId; licenseIds: NumericId[]; submission: SubmissionRecord };
  "license.renewed": { licenseId: NumericId; expiresAt: IsoDateTime; submission: SubmissionRecord };
  "license.orderRefunded": { orderIds: NumericId[]; submission: SubmissionRecord };
}
export interface EventBus { emit<E extends keyof CoreFormsEvents>(e: E, p: CoreFormsEvents[E]): Promise<void> } // listeners isolated; errors logged
```

### 5.9 Route I/O contracts

Every route has an entry in `src/shared/types/api/<module>.ts`:

```ts
export interface RouteContract<I, O> { input: I; output: O }
export interface FormsApi {
  "forms/get": RouteContract<{ id: NumericId }, { form: FormDTO }>;
  // …
}
```

The admin calls routes only through the generic, typed caller `callRoute<K extends keyof AdminApi>(name: K, input: AdminApi[K]["input"])` in `src/admin/lib/route.ts`. Adding a route never requires editing a shared client file. P1.0a writes the Phase 1 contracts from §8 of this document. P2.0, P3.0 and P4.0 add theirs.

---

## 6. Data model

### 6.1 Conventions

- **Ids.** Records that WordPress, external clients or exports identify by number keep **numeric ids** (`NumericId`). That covers forms, submissions, polls, and every commerce entity except customers. Imported rows keep their WP id. New rows take the next value from a monotonic KV sequence (`seq:<entity>`, compareAndSet loop; D-010). Every numeric-id record also stores `n: number` so it can be ordered numerically. Internal records use ULIDs (`<prefix>_<ulid>`) or deterministic keys.
- **Timestamps** are stored as `IsoDateTime` (UTC). WordPress formats are produced at the boundaries by `src/shared/time`.
- **Field names are camelCase** in storage. `src/core/io/mappers` owns the single bidirectional mapping to WP column and meta names. WordPress-shaped JSON (settings, schema, action configs, details) is stored verbatim.
- **Uniqueness.** Uniqueness is never left to `uniqueIndexes`, which exist only after the first scheduler tick and throw on `put`. The `uniques` collection holds deterministic claim documents (`<ns>:<value>`) created with `compareAndSet(id, null, …)`. `uniqueIndexes` is still declared where WP has a unique key, as defense in depth.
- **Queries.**
  - Every `where`/`orderBy` field is declared in an index.
  - `limit ≤ 100`; `getMany`/`deleteMany` take ≤ 50 ids.
  - There is no OR. Inbox views use the derived `bucket` field so they need only equality (D-071).
- **Atomicity.** Single-row `compareAndSet`/`updateIf` only. Multi-row flows use one of two patterns:
  - **allocate-then-write**: reserve ids and record the plan in a checkpoint document (CAS), then write each row create-only, then mark done.
  - **job-driven steps**: idempotent steps run by a job.

  Counters use `updateIf` with `delta`. Locks are ephemeral leases (§6.4).
- **Size.** No document exceeds ~256 KB. File bytes go to R2. Logs and line items are separate rows.

### 6.2 Storage collections

Every collection is declared in `src/server/storage/collections.ts` in P1.0a, **including Phase 2–4 collections**, so their indexes exist long before the code that uses them (spec 00 §16.1.5).

| Collection | Id | Contents (§5 types) | Indexes | Unique claims (`uniques`) | Phase |
|---|---|---|---|---|---|
| `forms` | NumericId | `FormRecord` | `status`, `slug`, `liveSlug`, `publicSlug`, `trashedAt`, `["trashedAt","updatedAt"]`, `["trashedAt","n"]`, `["status","updatedAt"]` | `form-slug:<slug>`, `form-live-slug:<slug>`, `form-public:<publicSlug>` (when standalone) | 1 |
| `formRevisions` | `rev_<ulid>` | `{formId, snapshot: DefinitionSnapshot, kind: "save"\|"restore"\|"publish"\|"discard"\|"import", authorId, createdAt}` | `["formId","createdAt"]` | n/a | 1 |
| `formUsage` | `<collection>:<entryId>:<kind>:<ref>` | `{kind: "form"\|"poll"\|"commerce", ref, collection, entryId, title, path, status, updatedAt}` | `["kind","ref"]`, `["collection","entryId"]`, `path` | n/a | 1 |
| `fieldGroups` | 16 hex | `{label, fields: FieldDef[], owner, shared, createdAt, updatedAt}` | `owner`, `shared` | n/a (version CAS in KV) | 1 |
| `submissions` | NumericId | `SubmissionRecord` | `["formId","bucket","submittedAt"]`, `["bucket","submittedAt"]`, `["formId","isSpam","status","submittedAt"]`, `["isSpam","status","submittedAt"]`, `["formId","isSpam","submittedAt"]`, `["isSpam","submittedAt"]`, `["formId","submittedAt"]`, `submittedAt`, `["status","modifiedAt"]`, `draftToken`, `["paymentProvider","paymentId"]`, `emailKey` | n/a | 1 |
| `replies` | `wp-<id>` \| `msg:<provider>:<providerMessageId>` \| `rep_<ulid>` | WP `cf_submission_replies` columns in camelCase | `["submissionId","sentAt"]`, `["provider","providerMessageId"]` | the deterministic id dedupes provider messages | 1 |
| `team` | submission NumericId | `{formId, assignee, dueAt, hold, notes: {author, at, text}[], version, remindedAt}` | `["assignee","dueAt"]`, `dueAt`, `formId` | n/a | 1 |
| `emailLogs` | `wp-<id>` \| `eml_<ulid>` | WP `cf_email_logs` columns + `transport`, `deliveries`, `dropped` | `["status","sentAt"]`, `["formId","sentAt"]`, `submissionId`, `sentAt` | n/a | 1 |
| `files` | `f_<ulid>` | `{formId, submissionId, field, status: "pending"\|"attached"\|"retired"\|"deleted", storage: "r2"\|"media"\|"legacy", key, mediaId, storedName, originalName, type, size, sha256, private, uploader: "public"\|"admin", createdAt, attachedAt}` | `submissionId`, `["status","createdAt"]`, `formId` | n/a | 1 |
| `jobs` | deterministic | `Job` | `["status","runAt"]`, `["kind","status"]`, `["status","updatedAt"]`, `refId`, `["formId","kind"]` | the id is the idempotency key | 1 |
| `actionLogs` | `run:<runKey>` (ledger) \| `alog_<ulid>` (event) | WP `cf_action_logs`: `{runKey, jobId, formId, submissionId, actionType, actionId, status, lease, message, meta: {steps, …}, createdAt, updatedAt}` | `["formId","createdAt"]`, `["submissionId","createdAt"]`, `["status","updatedAt"]`, `["actionType","status"]`, `createdAt` | the ledger id is the run key | 1 |
| `polls` | NumericId | WP `cf_polls` + post fields (spec 03 §10.1) | `status`, `endsAt`, `updatedAt` | `poll-slug:<slug>` | 1 |
| `pollVotes` | `wp-<id>` \| `vote_<ulid>` | WP `cf_poll_votes` | `["pollId","voterHash"]`, `["pollId","votedAt"]` | n/a | 1 |
| `pollTallies` | `<pollId>:<optionIndex>` \| `<pollId>:_total` | `{pollId, optionIndex, votes, uniques}` | `pollId` | n/a | 1 |
| `counters` | `<name>` | `{name, formId, n}`, e.g. `blocked:<formId>:honeypot_filled`, `capacity:<formId>` | `formId` | n/a | 1 |
| `uniques` | `<ns>:<value>` | `{ns, ref, createdAt}` | `["ns","ref"]` | (itself) | 1 |
| `ephemeral` | key | `{exp: number (epoch ms), n, v}` | `exp` | n/a | 1 |
| `analyticsEvents` | `evt_<ulid>` | WP `cf_analytics` + `day`, `pageHost` | `["formId","day"]`, `["formId","eventType","day"]`, `createdAt` | n/a | 3 |
| `analyticsDaily` | `<formId>:<YYYY-MM-DD\|all>` | `{formId, day, view, start, submit, abandon, spam, blocked, fieldInteraction}` | `["formId","day"]`, `day` | n/a | 3 |
| `analyticsDims` | `<formId>:<day\|all>:<dim>:<sha1(key)>` | `{formId, day, dim: "field"\|"utm"\|"host"\|"blocked", key, n}` | `["formId","dim","day"]` | n/a | 3 |
| `products` | NumericId | `ProductRecord` | `status`, `type`, `["status","updatedAt"]`, `slug` | `product-slug:<slug>` | 4 |
| `plans` | NumericId | `PlanRecord` | `productId`, `["productId","status"]` | `plan:<productId>:<slug>` | 4 |
| `orders` | NumericId | `OrderRecord` | `customerEmailKey`, `submissionId`, `customerId`, `["status","createdAt"]`, `createdAt` | `order-number:<n>`, `order-source:<sourceKey>` | 4 |
| `orderItems` | NumericId | WP `cf_license_order_items` | `orderId`, `["productId","planId"]`, `licenseId` | n/a | 4 |
| `licenses` | NumericId | `LicenseRecord` | `productId`, `customerEmailKey`, `customerId`, `orderItemId`, `submissionId`, `["status","expiresAt"]` | `license-key:<key>` (also the lookup path) | 4 |
| `activations` | NumericId | WP `cf_license_activations` | `["licenseId","status"]`, `instanceId` | `activation:<licenseId>:<siteHash>` | 4 |
| `packages` | NumericId | `{productId, version, storageKey, filename, size, sha256, releaseNotes, legacyAttachmentId, createdAt, n}` | `["productId","n"]` | `package:<productId>:<version>` | 4 |
| `subscriptions` | NumericId | WP `cf_license_subscriptions` + `customerEmailKey` | `licenseId`, `["status","currentPeriodEnd"]`, `customerEmailKey` | `subscription-license:<licenseId>` | 4 |
| `downloads` | NumericId | WP `cf_license_downloads` | `licenseId`, `downloadedAt` | n/a | 4 |
| `commerceEvents` | NumericId | WP `cf_license_events` (scrubbed metadata) | `["licenseId","createdAt"]`, `["productId","createdAt"]`, `eventType`, `createdAt` | n/a | 4 |
| `customers` | `cus_<ulid>` | `CustomerRecord` | `emailKey` | `customer-email:<emailKey>` | 4 |
| `customerSessions` | sha256(token) | `{customerId, emailKey, createdAt, expiresAt, lastSeenAt}` | `expiresAt`, `customerId` | n/a | 4 |
| `fulfillment` | submission NumericId | WP `cf_fulfillment` + `plan` (allocated ids, step checkpoints) | `["status","nextAttemptAt"]` | n/a | 4 |
| `reversals` | submission NumericId | WP `cf_payment_reversals` + `plan` | `["status","nextAttemptAt"]` | n/a | 4 |
| `paymentEvents` | `<provider>:<eventId>` | `{provider, eventId, type, paymentId, submissionId, status: "received"\|"applied"\|"ignored"\|"unmatched", receivedAt}` | `["provider","receivedAt"]`, `submissionId` | the id dedupes provider events (DV-43) | 4 |

### 6.3 KV namespaces (`ctx.kv`; every write is a D1 write)

| Key | Value | Owner |
|---|---|---|
| `cfg:settings` | Global settings document: WP `cf_settings` shape + `emdash` subtree, secret leaves sealed (§7.1) | P1.0b |
| `cfg:theme-tokens` | WP `cf_form_theme_tokens` | P1.5 |
| `cfg:theme-css` | `{css, hash16}` generated on save | P1.5 |
| `cfg:wp-options` | lossless bag of other imported WP options (`cf_db_version`, `cf_retention_last_run`, `cf_commerce_key_policy`, …) | P1.20 |
| `cfg:field-groups-version` | integer guard for field-group writes (CAS) | P1.7 |
| `seq:<entity>` | last allocated numeric id | P1.0b |
| `state:cron` | `{v, at}`, the ensureCron flag | P1.0b |
| `state:schema` | data schema version (`1`) and migration progress | P1.20 |
| `state:maint:<task>` | `{nextAt, lastAt, lastResult}` | P1.0b |
| `state:secret:hmac` | sealed generated HMAC key (when `CORE_FORMS_SECRET` is absent) | P1.0b |
| `state:webhook-last:<provider>` | last verified webhook time | P4.1 |
| `user:<userId>:access` | `{granted: boolean, forms: NumericId[] \| null}` (D-091) | P1.19a |
| `user:<userId>:views` | saved inbox views (≤30) | P1.19a |

### 6.4 Ephemeral keys (`ephemeral` collection, swept hourly by `exp`)

| Key pattern | TTL | Meaning (spec) |
|---|---|---|
| `rl:submit:<h(ip\|formId)>` | 3600 s sliding | submit rate limit (01 §4.2 step 6/16) |
| `rl:draft:<h(ip\|formId)>` | 60 s sliding | new-draft limit 30 (03 §1.3.2) |
| `rl:track:<h(ip\|formId)>` | 60 s sliding | analytics 30/min (03 §6.5) |
| `rl:poll:<h(ip)>` | 60 s sliding | poll 12/min (03 §5.4) |
| `rl:license:<h(ip)>`, `rl:access:<h(email\|ip)>`, `rl:checkout:<h(ip)>` | 60 s / 300 s | commerce abuse controls (DV-39) |
| `dup:<md5(formId\|scope\|json)>` | 3600 s (filter) | duplicate fingerprint (01 §4.2 step 12) |
| `resp:<token32>` | 300 s | no-JS PRG response (01 §3.7) |
| `go:<token>` | 120 s | off-site redirect handoff (DV-49) |
| `lock:<name>` | lease | `capacity:<formId>`, `definition:<formId>`, `license:<id>`, `payment:<sid>`, `refund-order:<id>` |
| `captcha:<sha256(token)>` | 900 s | solved CAPTCHA tokens, never reused (DV-06) |
| `math:<nonce>` | challenge TTL | used math-captcha nonces (DV-05) |
| `evt:<formId>:<type>:<eventId>` | 300 s | analytics event dedupe |
| `cache:<h>` | 120–300 s | provider schema caches (Notion, Airtable), Emailit audiences, PayPal OAuth token |

### 6.5 R2 layout (private bucket, default binding `CORE_FORMS_PRIVATE`)

| Prefix | Object | Lifecycle |
|---|---|---|
| `uploads/tmp/<yyyy>/<mm>/<dd>/<fileId>` | pre-uploaded file awaiting a submission | swept after 24 h if still `pending` |
| `uploads/forms/<formId>/<submissionId>/<fileId>-<storedName>` | attached submission file | retention, erase |
| `uploads/legacy/<formSlug>/<storedName>` | file copied from WP uploads (`import-files` job) | as above |
| `packages/<productId>/<packageId>-<version>.zip` | licensed release ZIP | permanent; deleted only on release replace |
| `packages/tmp/<ulid>` | admin upload before validation | swept after 24 h |
| `staging/imports/<importId>/…` | optional staging of large import files | swept after 7 d |

Object custom metadata carries `formId`, `submissionId`, `fileId` and `sha256`. Ownership is verified against the `files` row before any delete (spec 03 §4.9.2 rule).

**No bucket bound (D-112).** Uploads fall back to `ctx.media.upload`. That accepts only image, video, audio and PDF types; other types fail with `file_upload_error`. Fallback files are public by URL, and admin shows a banner saying so. Digital packages are refused ("bind a private bucket").

---

## 7. Settings model

### 7.1 Global settings document (`cfg:settings`)

- **Shape.** It is the WP `cf_settings` option, verbatim. Unknown keys are preserved. Nested providers are deep-merged one level on read (spec 01 §1.5).
- **EmDash extension keys** live under one `emdash` subtree, so the top level stays WP-shaped for export:

  ```jsonc
  {
    "enable_nonce": 1, "enable_analytics": 1, "load_stylesheet": 0, "load_form_theme": 1, "wrapper_tag": "p",
    "standalone_base_slug": "collect", "delete_data_on_uninstall": 0, "reply_from_email": "",
    "akismet_whitelist": "", "google_recaptcha": { "site_key": "", "secret_key": {"$secret": "…"} },
    "cloudflare_turnstile": {…}, "emailit": {…}, "whatsapp_cloud": {…}, "whatsapp_inbound": {…},
    "headless": { "api_key": {"$secret": "…"}, "allowed_origins": "" },
    "payments": { "mode": "test", "currency_gateways": {…}, "stripe": {…}, "paypal": {…}, "razorpay": {…}, "polar": {…} },
    "license_server": { "enabled": 0, "support_url": "" },
    "emdash": {
      "timezone": "UTC", "date_format": "F j, Y", "time_format": "g:i a",   // imported from WP options
      "store_ip": true,
      "mail": { "transport": "emdash", "from_email": "", "from_name": "", "resend_api_key": {"$secret": "…"} },
      "hcaptcha": { "site_key": "", "secret_key": {"$secret": "…"} },
      "akismet": { "api_key": {"$secret": "…"} },
      "recaptcha_min_score": 0.5,
      "analytics": { "raw_retention_days": 30, "retention_days": 365 },
      "action_log_retention_days": 90,
      "access": { "default": "admins" }
    }
  }
  ```

- **Secret leaves** are a fixed path list in `src/core/settings/secret-paths.ts`: every `*secret*`, `*_key` that is a credential, every `access_token`, `api_key`, `webhook_secret`, `webhook_id` and `auth_token`. They are sealed with `encryptPluginSetting` (D-030). Reads go through `GlobalSettingsView.secret(path)`. Admin responses replace them with the sentinel `"••••••••"`. When the sentinel is saved back, the stored value is kept.
- **Single source of truth.** There is no `settingsSchema` (D-031): the auto-generated host page can't express nested settings. The React Settings page is the only editor. Writes go through `settings/save`, which deep-merges like WP (`class-admin.php:283-337`: providers that weren't posted keep their keys; `license_server` is preserved).
- **Per-request cache.** `GlobalSettingsView` reads the document once per request or job.

### 7.2 Form settings and messages

- `FormRecord.settings` is raw. `FormSettingsView` applies `{...DEFAULTS, ...stored}` (`array_merge`). Here `DEFAULTS` is the union of the core defaults (spec 01 §1.3) and module defaults registered by feature modules (payments, fullscreen, notifications, submission-limit, require-login, headless), matching WP's `cf_form_default_settings` filter.
- **Truthiness** follows PHP: `phpTruthy("0") === false`, `phpTruthy("") === false`, `phpTruthy([]) === false`.
- **Tri-states.** `load_stylesheet`: `""` inherits. `load_form_theme`: `"1"`/`"0"` force; anything else inherits. `analytics_enabled`: `""` inherits.
- **Admin saves** reproduce the WP sanitizer (`class-admin.php:1213-1411`): recursive replace, `actions` replaced wholesale, `display_mode` and tri-state validation, currency uppercased.
- **Messages.** `ResolvedForm.messages = {...DEFAULT_MESSAGES (21 keys, spec 01 §1.4), ...overrides}`. `turnstile_failed` and `hcaptcha_failed` have **no** default key, so the `data-message-*` set stays WP-identical. A fallback text is applied only when building an error response (DV-55).

### 7.3 Theme tokens

`cfg:theme-tokens` holds the raw WP option. Save runs the WP sanitizer (spec 02 §4.7), emits the `low_text_contrast`/`low_focus_contrast` warnings, and regenerates `cfg:theme-css` with `FormTheme::css`: fixed order, derived aliases, `%.2F` alpha, tab indent, header comment, trailing newline. The front end inlines it as `<style id="core-forms-theme-custom">` right after `form-theme.css` (DV-54).

---

## 8. Routes

### 8.1 Route kinds and conventions

All plugin routes are `/_emdash/api/plugins/core-forms/<name>`. The route framework (`src/server/routes/framework.ts`) turns each `RouteDef` into an EmDash route and applies the access rule, rate limits, `ensureCron`, error mapping and the per-request `CfContext`.

| Kind | EmDash declaration | Our check | Reached by |
|---|---|---|---|
| **public** | `public: true` | per-route rate limit | browsers, servers (webhooks, license clients) |
| **internal** | private, `permission: "plugins:manage"` | `internal: true` routes reject HTTP calls that lack the dispatcher marker `x-core-forms-internal` | our Astro components and companion endpoints, via `locals.emdash.handlePluginApiRoute` (trusted, auth-free). External HTTP gets 401/403. |
| **workspace** | private, `permission: "plugins:read"` (Editor+) | admin, or a user with an access grant (`user:<id>:access`, D-091). Form-scoped routes also check the form scope. | admin UI |
| **admin** | private, default `plugins:manage` | Admin only. Write routes with `secretWrite` also require `EMDASH_ENCRYPTION_KEY` or explicit plaintext acknowledgment. | admin UI, CLI token, MCP |

**Envelopes.**
- Admin and workspace routes use the EmDash JSON envelope `{success, data}`, with errors via `PluginRouteError`. Field errors go inside `data`.
- Public routes that WP clients or our ported client JS depend on are `response: "raw"` and return the exact WP body and status (submit, drafts, polls, track, license, storefront, webhooks, headless).

**Methods.** POST with JSON unless noted. GET routes take query params, because there are no path params.

### 8.2 Plugin routes by module

Phase 1: forms runtime (P1.6, P1.8, P1.10, P1.15)

| Route | Kind | Method / body | Purpose |
|---|---|---|---|
| `submit` | public | POST form-data (`maxBytes` 8 MiB, file parts ≤ 1 MiB) or urlencoded; raw | `Forms::process`. `X-Requested-With`/`_cf_ajax` ⇒ WP JSON with WP status codes (D-020); otherwise a 303 PRG. Pre-uploaded files arrive as `_cf_files[<field>][]=<token>`. |
| `drafts/save` | public | POST form-data/urlencoded (beacon); raw `{success,data}` | `cf_save_draft` (spec 03 §1.3.2) |
| `drafts/load` | public | POST form-data/json; raw | `cf_load_draft` |
| `polls/vote` | public | POST form-data; raw | `cf_poll_vote` (spec 03 §5.4) |
| `polls/results` | public | GET `?poll_id=` (also accepts `?id=`); raw | `cf_poll_results` and the REST `/results` shape |
| `headless/form` | public | GET `?ref=<id\|slug>`; raw | `core-forms/v1/forms/{ref}` (spec 01 §5.3) |
| `headless/submit` | public | POST json/form-data `?ref=`; header `X-Core-Forms-Key`; raw 200/422 | headless submit |
| `internal/render` | internal | json `{ref:{id?,slug?}, page:{url, path, instanceKey}, block?, responseToken?, auth?}` | `{status, html, manifest, form:{id,slug,title}}` for `<CoreForm>` and the HTML expander |
| `internal/standalone` | internal | json `{slug, query}` | `{status: 200\|404, html, manifest, title, robots, canonical, fullscreen, externalAssets}` |
| `internal/poll-render` | internal | json `{ref, mode, voterCookie}` | poll HTML and manifest |
| `internal/files/register` | internal | json `{formId, field, key, name, type, size, sha256}` | validate and create a `pending` files row → `{token}` |
| `internal/files/authorize` | internal | json `{fileId, user}` | team access check → `{key, filename, contentType, size}` |
| `internal/go` | internal | json `{token}` | takes the `go:` entry → `{url}` |

Phase 1: authoring (P1.7, P1.16, P1.18). All are `workspace` unless marked admin.

| Route | Input → output (abridged) |
|---|---|
| `forms/list` | `{view: "all"\|"trash", search?, orderby?: "title"\|"submissions"\|"accessibility"\|"date"\|"id", order?, page?}` → `{items: FormListItem[], total, counts:{all, trash}}` |
| `forms/get` | `{id}` → `{form: FormDTO}` (draft definition; secret leaves masked) |
| `forms/create` | `{title?, slug?, templateId?, duplicateOf?, markup?, schema?, settings?, messages?}` → `{form}` (spec 04 §1.3.2 semantics, default email action on non-blank templates) |
| `forms/update` | `{id, fingerprint, title?, slug?, status?, markup?, settings?, messages?}` → `{form, fingerprint}`; 409 `cf_edit_conflict` / `cf_version_required` |
| `forms/editor-state` | `{id, fingerprint, markup, schema, templateId?}` → `{saved, form, schema, fingerprint}` (re-renders markup server-side and re-runs the a11y audit) |
| `forms/schema/generate` | `{id, fingerprint, save?}` → `{saved, schema, fingerprint}` |
| `forms/trash` · `forms/restore` · `forms/delete` | `{ids}` → `{done, refused}` (delete is permanent; submissions are kept, as in WP) |
| `forms/duplicate` | `{id}` → `{form}` (WP list-table duplicate: same title, publish) |
| `forms/publishing` | `{id, action: "start"\|"publish"\|"discard", fingerprint}` → `{fingerprint}`; 409 `cf_slug_conflict` |
| `forms/revisions/list` · `forms/revisions/get` · `forms/revisions/restore` | revisions (spec 01 §3.16) |
| `forms/preview` | `{id?, draft?: Partial<FormDTO>, revisionId?}` → `{html, assets: {css: string[], js: string[], inline: string[]}}` |
| `forms/rehearsal` | `{id, data, revisionId?}` → the WP rehearsal shape (spec 03 §7) |
| `forms/options` | `{}` → `{items:[{id, name}]}` (PT block `optionsRoute`) |
| `forms/usage` | `{id}` → usage rows |
| `forms/a11y/audit` · `forms/a11y/fix` | `{id[, fingerprint]}` → report |
| `forms/columns` | `{id, op: "hide"\|"show"\|"show_all"\|"rename"\|"delete", column, newName?}` → `{jobId?}` (rewrites run as `column-rewrite` jobs) |
| `forms/templates` | `{}` → template catalog (spec 01 §3.18) |
| `field-groups/list` · `field-groups/save` · `field-groups/delete` | spec 01 §2.12 (409 `cf_group_conflict`) |
| `theme/get` · `theme/save` (admin) | tokens, warnings, presets |
| `settings/get` · `settings/save` (admin) | §7.1; secrets masked |
| `polls/list` · `polls/get` · `polls/save` · `polls/delete` · `polls/duplicate` · `polls/export` · `polls/analytics` | spec 03 §5.6–5.8 |

Phase 1: submissions workspace (P1.19a, P1.11, P1.9)

| Route | Input → output |
|---|---|
| `submissions/list` | `{formId?, view: "inbox"\|"new"\|"archived"\|"spam"\|"all", status?, search?, dateFrom?, dateTo?, assignee?, overdue?, savedView?, layout?: "summary"\|"fields", orderby?: "submitted_at"\|"form_id"\|"id", order?, cursor?, limit?}` → `{items: SubmissionListItem[], nextCursor?, scanned?, truncated?}` |
| `submissions/counts` | same filters → `{inbox, new, archived, spam, all}` |
| `submissions/get` | `{id, markRead?: true}` → `{submission, form, replies, team, emailLogs, actionLogs, files}` (marks `new` as `read`, as WP does) |
| `submissions/status` | `{ids, status: "new"\|"read"\|"replied"\|"archived"}` |
| `submissions/spam` | `{ids, spam: boolean}`. Un-spamming replays `form.success` and the actions, with conditions and skip logging. |
| `submissions/update-data` | `{id, data}` (files preserved, array fix; DV-29) |
| `submissions/delete` | `{ids}` → `{deleted, refused: [{id, reason}]}` (coordinated erase; all ids are checked before any delete) |
| `submissions/export` | `{format: "global"\|"form", formId?, ids?, filters?, cursor?}` → `{header, rows, nextCursor}` (chunked CSV assembled in the browser) |
| `submissions/bulk-status` (admin) | `{status, setStatus, formId?, before?, dryRun}` → `{matched, updated}` (CLI parity) |
| `replies/send` | `{submissionId, from?, to, subject, message}` |
| `team/get` · `team/save` | `{id, version, assignee, due, note, hold}` (409 on version mismatch) |
| `team/views/list` · `team/views/save` · `team/views/delete` | ≤30 views |
| `team/access/list` · `team/access/save` (admin) | grants and form scopes |
| `users/list` | users that can be assigned (`ctx.users`) |
| `email-logs/list` · `email-logs/get` · `email-logs/stats` · `email-logs/resend` · `email-logs/delete` | spec 04 §2.10 |
| `privacy/find` · `privacy/export` · `privacy/erase` (admin) | GDPR by email |
| `retention/preview` | `{formId}` → `{entry_ids, attachment_entry_ids, limit: 100}` |

Phase 1: data and operations (P1.20). All admin.

| Route | Purpose |
|---|---|
| `data/export-manifest` | `{datasets, formIds?, includeSecrets?}` → counts per table |
| `data/export-page` | `{dataset, table, cursor?, formIds?}` → `{rows (WP row shape), nextCursor}` |
| `data/import-plan` | `{format, forms: [{id, slug}], datasets}` → conflicts, id map preview |
| `data/import-batch` | `{importId, dataset, table, rows (≤200), policy: "create"\|"update"\|"skip", options}` → `{created, updated, skipped, warnings, idMap}` |
| `data/import-finalize` | `{importId}` → bump sequences, regenerate theme CSS, pause queued actions, rebuild the usage index |
| `migrate/status` · `migrate/run` | v0.1.0 → v1 migration (§17.4) |
| `doctor` | `[{check, status: "ok"\|"warn"\|"fail", detail}]` |
| `maintenance/cleanup` | `{days, dryRun}` (CLI parity, routed through coordinated erase) |
| `jobs/stats` · `jobs/process-now` · `jobs/retry` · `jobs/cancel` | queue tools |
| `danger/delete-all` | `{confirm: "DELETE"}`: honors `delete_data_on_uninstall` semantics manually (DV-70) |

The MCP tools (`mcp.tools` on these routes) are: `doctor`, `forms_list`, `forms_export`, `submissions_list`, `submissions_bulk_status` (destructive) and `maintenance_cleanup` (destructive).

Phase 2 (P2.1–P2.6)

| Route | Kind | Purpose |
|---|---|---|
| `actions/catalog` | workspace | modules, fields, availability, WP-only types |
| `actions/test` | admin | spec 05 §1.7.7 |
| `actions/copy/sources` · `actions/copy/source` · `actions/copy/prepare` | admin | spec 05 §1.4 |
| `actions/telegram-setup` · `actions/emailit-audiences` · `actions/whatsapp-test` | admin | provider helpers |
| `action-logs/list` · `action-logs/stats` · `action-logs/failures` | workspace | spec 05 §2.5 |
| `action-queue/stats` · `action-queue/retry` | workspace | |
| `recovery/list` · `recovery/reconcile` · `recovery/retry` | admin | spec 05 §2.4 |
| `inbound/resend` | public | POST bytes `?form=&action=` (Svix) |
| `inbound/whatsapp-meta` | public | GET verify (raw `text/plain`), POST bytes |
| `inbound/whatsapp-twilio` | public | POST bytes; returns 204 (TwiML is served by the companion endpoint) |

Phase 3 (P3.0)

| Route | Kind | Purpose |
|---|---|---|
| `track` | public | POST form-data/urlencoded (beacon); raw `{success}` |
| `analytics/funnel` · `daily` · `field-dropoff` · `attribution` · `spam-trends` · `recommendations` · `overview` · `blocked` | workspace | spec 03 §6.7–6.8 shapes |

Phase 4 (P4.1–P4.6)

| Route | Kind | Purpose |
|---|---|---|
| `payments/webhook` | public | POST bytes `?provider=`; raw; status table in spec 06 §2.8 with DV-07 |
| `license/check` · `license/activate` · `license/deactivate` · `license/version` | public | GET query / POST bytes (any content type); always 200 JSON (spec 06 §3.9) |
| `storefront` · `storefront/products` · `storefront/product` | public | GET; raw JSON with ETag/304 and Cache-Control |
| `customer/licenses` | public | GET `?access_token=` |
| `internal/payments/return` | internal | `{query}` → `{redirect: string \| null}` |
| `internal/checkout/start` | internal | native checkout POST |
| `internal/portal/*` | internal | `session/verify`, `session/data`, `deactivate-site`, `cancel-renewal`, `save-profile`, `request-access` |
| `internal/package/authorize` · `internal/download/authorize` | internal | signed URL checks → `{key, filename, sha256, size}` |
| `internal/product-page` | internal | virtual product page model |
| `commerce/*` | admin | spec 06 §3.12 surface: summary, products, plans, releases (publish from a staged R2 key), orders, licenses, activations, subscriptions, downloads, events, sample-products, currency-routes, gateways, key-policy, store-settings, generate-forms |
| `payments/settings/get` · `payments/settings/save` · `payments/gateway-status` | admin | settings subtree `payments` |

### 8.3 Companion integration (`coreFormsSite()`, `src/site/`)

The companion uses Astro's `injectRoute` and `addMiddleware`. Every endpoint is thin: authenticate or parse, then call an internal or public plugin route through `locals.emdash.handlePluginApiRoute`, then map the result (status, headers, cookies, streaming).

| Path | Method | Purpose | Phase |
|---|---|---|---|
| `/<standaloneBase>/[slug]/` | GET, HEAD | standalone form document (spec 01 §3.14): WP shell, robots/canonical, no-store headers; optional `layout` wrapper | 1 |
| `/_core-forms/go` | GET `?t=` | 303 to an external URL from a `go:` token (no-JS off-site redirects, hosted checkout) | 1 |
| `/_core-forms/upload` | POST (stream) | JS pre-upload of one file → R2 `uploads/tmp` → `internal/files/register` → `{token}` | 1 |
| `/_core-forms/submit` | POST multipart | no-JS forms that contain file inputs: streams files to R2, registers them, forwards the remaining fields plus tokens to `submit`, maps the 303 | 1 |
| `/_core-forms/file/[id]` | GET | admin-only download of a private upload (session user → `internal/files/authorize` → stream R2, `attachment`, `nosniff`) | 1 |
| `/_core-forms/inbound/twilio` | POST | forwards to `inbound/whatsapp-twilio`, responds `text/xml <Response></Response>` | 2 |
| `/_core-forms/package` | GET signed | license package stream (spec 06 §3.9 signature) | 4 |
| `/_core-forms/download/[token]` | GET | digital product download (counter guard) | 4 |
| `<portalBase>/…` | GET/POST | portal pages: login, verify (token → HttpOnly `cf_portal` cookie), dashboard tabs, actions, logout | 4 |
| `<checkoutPath>/` | GET/POST | native checkout page and POST (303 to the provider) | 4 |
| `/_core-forms/admin/package-upload` | POST (stream) | admin ZIP upload → R2 `packages/tmp` with streaming sha256 | 4 |
| `/wp-json/core-forms/v1/forms/[ref]` and `/submit`, `/embed.js` | GET/POST/OPTIONS | headless compat with the CORS allowlist; embed.js is a prebuilt asset | 1 (wpCompat) |
| `/wp-json/core-forms/v1/{check_license,activate_license,deactivate_license,get_version}` | GET/POST/OPTIONS | license API compat (optional CORS) | 4 |
| `/wp-json/core-forms/v1/storefront[/products[/slug]]`, `/customer/licenses` | GET/OPTIONS | storefront (`ACAO: *`), customer REST | 4 |
| `/wp-json/cf/v1/payments/[provider]/webhook` | POST | raw-body forward to `payments/webhook` | 4 |
| `/wp-json/cf/v1/resend/[form]/[action]` | POST | forward to `inbound/resend` | 2 |
| `/wp-json/core-forms/v1/whatsapp/{meta,twilio}` | GET/POST | forward (TwiML for twilio) | 2 |

**Middleware** (only when `wpCompat`). It checks `url.search` for these keys before doing any work, so it costs almost nothing per request:

| Query key | Applies | Action |
|---|---|---|
| `?cf-form=<slug>` | any path | renders the standalone form (legacy) |
| `?edd_action=<action>` | any path | license API dispatch (P4) |
| `?cf_payment_return=1` | any path | `internal/payments/return`, then redirect or pass through (P4) |
| `?product=` / `?cf_product=` | root path only | virtual product page (P4) |
| `?cf_license_access=` | any path | redirect to `<portalBase>/verify` (P4) |

**Configuration hand-off.** `coreForms({ site })` receives the same options object. The companion's middleware module also sets `globalThis.__CORE_FORMS_SITE__ = { version, options }` at load. The plugin compares the two in `doctor` and warns when they differ.

---

## 9. Processing pipelines

### 9.1 Render (`src/core/render`, spec 01 §3)

```
resolveForm(ref, "live") ── by slug: publish + live-slug fallback; by id: any status except trashed
  │
  ├─ markup = schema ? (MultiStep|SchemaRenderer)(schema, prefix) → filter schemaMarkup : post_content
  ├─ markupFilters (priority-ordered registry, same order as WP cf_form_markup):
  │     10 reCAPTCHA comment · 10 Turnstile container · 20 math captcha · 20 payment product picker
  │     · 100 cf_enhance_accessibility (libxml-compatible DOM round trip, DV-17)
  ├─ email maxlength pass (tag processor; lowers >254)
  ├─ wrapper (Form::get_html): data attributes in WP order, hidden inputs (action, _cf_form_id,
  │     [_cf_source_url], honeypot _cf_h{ID}), .cf-messages, PRG flash, .cf-fields-wrap, custom CSS/JS
  ├─ htmlFilters: 5 schedule closed → .cf-form-closed · 10 submission limit · 10 login required
  └─ AssetManifest (AssetRequirements::for_form + captcha + theme/stylesheet tri-states)
```

- **Id prefixes.** Schema forms use `cf-form-<ID>-<n>-`, where `n` counts instances of that form per page request. Raw-HTML forms are unprefixed on their first instance and prefixed from the second instance on (DV-16). The page instance counter is keyed by `page.instanceKey`, which `src/astro` derives from `Astro.locals` per request.
- **No-JS fallback.** The `action` attribute is always present, pointing at `submit` or at the companion `/_core-forms/submit` for file forms. The `<noscript>` notice is omitted (DV-14).
- **Block wrapper.** PT blocks `core-form` and the legacy `form` render `div.wp-block-core-forms-form` with the WP block attributes (spec 01 §3.1.1).

### 9.2 Submit (`src/core/pipeline`, spec 01 §4.2 and spec 03 §4.0)

The steps are WP's 1–20 with these port bindings:

| Step | Binding |
|---|---|
| 1 (nonce) | skipped (DV-15) |
| 3 (capacity lock) | `locks.withLock("capacity:<id>", {ttlMs: 10_000, waitMs: 5_000})` |
| 5 (honeypot) | exact `_cf_h<ID>` (DV-12) |
| 6/16 (rate limit) | `ephemeral.peek`/`bump` on `rl:submit:*` |
| 9 (calc) | `core/calc` |
| 12/17 (duplicate) | `ephemeral.add` on `dup:*`, only after a successful insert |
| 14 (validators) | the extension registry's validator chain with WP priorities: 5 schedule · 10 reCAPTCHA · 10 Turnstile · 10 hCaptcha · 10 files · 15 math · 20 Akismet. Each passes an incoming error through. |
| 15 (files) | attaches pre-registered upload tokens and in-request parts |
| 17 (insert) | `ids.next("submission")`, a create-only put, `events.emit("submission.inserted")` |
| 18 (payment branch) | Phase 4 |
| 19 (success) | inline-phase actions run now (redirect producers). A `dispatch:<sid>:submit` job is enqueued and kicked (§10). |
| 20 (response) | `form.response`, the WP JSON body and status |

`processSubmission(form, entries, request, ports)` stays pure: no EmDash imports. Rehearsal (`forms/rehearsal`) calls the same steps in plan mode.

---

## 10. Job queue and cron

### 10.1 One recurring task

- **The task.** `ctx.cron.schedule("tick", { schedule: options.tickSchedule ?? "* * * * *" })` is the only cron task the plugin ever creates (D-040). One-shot cron tasks are never used.
- **The hook.** `cron: { timeout: 25_000, handler }`.
- **`ensureCron(cx)`** runs from:
  - `plugin:activate`
  - every admin and workspace route (framework middleware)
  - the first public `submit` per isolate
  - the tick itself, daily

  It is idempotent: an isolate memo, then the KV flag `state:cron {v, at}`, then the schedule call (upsert). Re-asserted at most once per 24 h.

### 10.2 Tick algorithm (`src/server/jobs/tick.ts`)

```
budget = 20 s
1. recoverStale(): query {status:"running", lockedAt < now-10min} (index [status,updatedAt]) limit 50
     → handler.onStale === "retry" ? pending (attempts+1, runAt=now) or failed : paused
2. maintenance.enqueueDue(): for each registered task whose state:maint:<task>.nextAt ≤ now,
     enqueue job "maintenance:<task>:<periodKey>" (create-only) and advance nextAt
3. drain(): loop while budget remains and claimed < 25:
     query {status:"pending", runAt ≤ now} orderBy runAt asc (priority applied in-memory per page) limit 25
     for each: updateIf(id, {where:{status:"pending"}, set:{status:"running", claimId, lockedAt}})
       applied → run handler with min(handler.timeoutMs, remaining budget)
       outcome → done | retry(runAt, attempts+1, lastError) | failed | paused
```

### 10.3 Immediate execution

`jobs.kick(ids)` registers one `after()` callback per request. The callback claims and runs those ids, in order, within the remaining `waitUntil` budget (25 s). Anything it can't finish stays `pending` for the next tick. Claiming makes concurrent cron and `after()` runs safe.

### 10.4 Job kinds, retry policy and maintenance tasks

| Kind | Producer | Retry policy | Notes |
|---|---|---|---|
| `dispatch` | submit success, un-spam replay, fulfillment | 3 attempts, 60 s/120 s | Evaluates action conditions (submit-time data), then creates `action:<runKey>` jobs **in list order** and runs them sequentially. Ephemeral (unsaved) submissions: one attempt per action, and the payload is scrubbed when the job ends (DV-37). |
| `action` | dispatch, admin retry | WP: `max(2^attempts·60 s, Retry-After ≤ 3600)`, `MAX_RETRIES = 3`; inline-failure re-entry `max(120 s, RA)` with attempts = 1 | Re-checks conditions at run time. The ledger (`actionLogs` `run:<key>`) gives at-most-once claims; a stale lease becomes `uncertain`, which pauses the job (spec 05 §2.1). |
| `fulfillment`, `reversal` | payment webhook | +300 s, fail after 10 | outbox semantics (spec 06 §2.9) |
| `payment-event` | `payments/webhook` | 5 attempts, exponential | applies a verified, deduped event |
| `mail` | team reminders, commerce, portal | 3 attempts | system mail through the Mailer |
| `erase` | delete, retention, GDPR | 5 attempts | cascades and file deletes, idempotent |
| `column-rewrite`, `usage-scan`, `migrate`, `import-files` | admin | checkpointed cursor in the payload | resumable batch jobs |
| `inbound-event` | Resend/WhatsApp inbound | 5 attempts | dedupe by provider id |

Maintenance tasks are registered by their owning modules in `src/server/jobs/maintenance.ts` (registry pre-wired by P1.0a):

| Task | Cadence | Owner |
|---|---|---|
| `ephemeral-sweep` (exp < now, batches of 100) | hourly | P1.0b |
| `jobs-sweep` (done/cancelled > 7 d; failed > 90 d) | daily | P1.0b |
| `uploads-sweep` (pending files > 24 h; R2 tmp) | hourly | P1.10 |
| `drafts-cleanup` (spec 03 §1.3.6) | daily | P1.8 |
| `retention` (entries + attachments, spec 04 §2.11) | daily | P1.9 |
| `team-reminders` | daily | P1.19a |
| `usage-rescan` | weekly | P1.7 |
| `poll-status` (cosmetic close, spec 03 §5.7) | hourly | P1.15 |
| `action-log-retention` (event rows only, DV-34) | daily | P2.1 |
| `analytics-retention` (raw 30 d, aggregates 365 d) | daily | P3.0 |
| `license-maintenance` (spec 06 §3.15, plus seat recount) | daily | P4.3 |
| `portal-sessions-sweep` | daily | P4.4 |

**Throughput.** One tick per minute × ≤25 jobs, plus `after()` kicks, comfortably covers form traffic. Optional Cloudflare Queues support is a later extension: a `queue()` handler calling `jobs/process-now`. It is not built.

---

## 11. Email transport (`src/server/mail`)

### 11.1 Mailer

`Mailer.send(MailMessage)` runs in four steps:
1. **Pick a transport.** `settings.emdash.mail.transport` names it: `emdash` (default), `resend` or `emailit`. If the selected one is unavailable, fall back to `emdash`. If that is unavailable too, the send fails with "No email provider is configured".
2. **Plan sends** from `TransportCapabilities`:
   - **Full-capability transport** (Resend): one call with to, cc, bcc, from, reply-to, headers and attachments, and `Idempotency-Key: cf-<runKey>` when there's a run key.
   - **EmDash transport** (`ctx.email`: one `to`, `cc[]`, `replyTo`, no from or bcc):
     - Send A: `to = To[0]`, `cc = To[1..] ∪ Cc` (WP shows every To recipient to every other recipient anyway), `replyTo = ReplyTo[0]`.
     - Sends B…: one per Bcc address, with that address as `to` and no cc, so a Bcc address is never exposed (DV-01).
     - `from`, custom headers and attachments go into `dropped`.
   - **Emailit**: the capabilities are verified in P1.11 against the v2 API. Anything it lacks follows the EmDash split rules.
3. **Log.** One `emailLogs` row per `Mailer.send` (`pending` → `sent`/`failed`), with `deliveries[]`, `transport` and `dropped`. That is the WP "one log per action" granularity.
4. **Return `MailResult`.** Actions map `ok:false` and transport `retryable` to WP semantics: an email failure is non-retryable unless the action is queued.

### 11.2 From address

The From address (per-action `from`, autoresponder `from_name`/`from_email`, `reply_from_email`) applies only when the transport has `capabilities.from`. With the EmDash transport:
- the address set in WP's From goes into `replyTo` when no Reply-To was given
- the admin action card and the Settings page show "From is set by your EmDash email provider. Choose Resend or Emailit in Settings → Email to send from this address." (DV-02)

### 11.3 Transports

| Transport | Endpoint | Credentials |
|---|---|---|
| `emdash` | `ctx.email.send` | the site's selected EmDash provider |
| `resend` | `POST https://api.resend.com/emails` | `emdash.mail.resend_api_key` (sealed). Per-action Resend *actions* keep their own keys (spec 05 §3.19). |
| `emailit` | `POST https://api.emailit.com/v2/emails` | the WP global `emailit.api_key` |

The default sender for direct transports is `emdash.mail.from_email`/`from_name`, falling back to the site admin email and site name.

---

## 12. Files and private storage

| Flow | Path | Limits |
|---|---|---|
| **JS forms with file inputs** (companion installed) | `src/client/upload` intercepts file inputs on submit, before `forms.js` posts. It pre-uploads each file to `/_core-forms/upload` (streamed to R2 tmp), puts `_cf_files[field][]=<token>` into the FormData, and removes the file parts. | 8 MB per file (`cf_upload_max_filesize` default, D-113); configurable up to 100 MB by the Workers request limit |
| **No-JS forms with file inputs** (companion) | The form `action` is `/_core-forms/submit`. The endpoint streams the parts to R2 and forwards to `submit` with tokens. | same |
| **No companion** | Plain multipart to `submit`. | parts ≤ 1 MiB (EmDash), documented |
| **No private bucket** | `ctx.media.upload` | allowlisted types only; public by URL (D-112) |

- **Validation.** `src/core/uploads` implements WP's rules: blocked extensions, double extensions, extension↔MIME map and size. MIME sniffing uses magic bytes because Workers has no libmagic. It runs twice: at registration time (companion) and again at submit time (pipeline step 14, priority 10).
- **Descriptor.** `{name, original_name, type, size, url, file_id, private?: true}`. `url` is `/_core-forms/file/<fileId>` (admin-authenticated), or the public media URL in fallback mode. `cf_field_value` renders the WP link markup with that URL (DV-27).
- **Ownership.** The `files` row links `formId`, `submissionId` and `key`. Erase and retention verify the row and the object metadata before deleting (spec 04 §2.11 "validate, then delete, abort on failure").

---

## 13. Front-end client modules (`src/client`, `src/styles`, `dist/assets`)

`scripts/build-assets.mjs` bundles each entry with esbuild into an IIFE (`es2019`, minified). It copies and minifies the WP CSS files, then writes `dist/assets/manifest.json` (file, bytes, brotli bytes, sha256). `tests/budgets.test.ts` fails CI when a budget is exceeded.

| Bundle | Source | Load condition (manifest flag) | Brotli budget | WP reference |
|---|---|---|---|---|
| `core.js` | `client/core` (forms.js + accessibility.js merged, plus the `cf_js_vars` defaults) | every page that renders a form | ≤ 3.4 KB | 2.2 + 0.9 KB |
| `smart.js` | `client/smart` | `smart_script` | ≤ 3.6 KB | 3.3 KB |
| `fullscreen.js` | `client/fullscreen` | `fullscreen` | ≤ 4.4 KB | 4.1 KB |
| `analytics.js` | `client/analytics` | `analytics` | ≤ 0.7 KB | 0.6 KB |
| `recaptcha.js`, `turnstile.js`, `hcaptcha.js` | `client/captcha` | per provider | ≤ 0.7 KB each | 0.6 / 0.5 KB |
| `upload.js` | `client/upload` | form has file inputs and the companion is installed | ≤ 1.0 KB | none (new) |
| `stripe-inline.js` | `client/stripe` | `inline_payment` | ≤ 0.9 KB | 0.7 KB |
| `poll.js` | `client/poll` | a poll renders | ≤ 1.3 KB | 1.2 KB |
| `portal.js` | `client/portal` | portal pages | ≤ 0.8 KB | |
| `embed.js` | `client/embed` | served by `/wp-json/core-forms/v1/embed.js` | ≤ 1.5 KB | |
| CSS: `forms`, `form-theme`, `smart-forms`, `multi-step`, `fullscreen`, `standalone`, `poll-frontend`, `license-frontend` | `src/styles` (WP verbatim) | WP CSS matrix (spec 02 §1.1) | WP sizes ±3 % | |

**Default embed budget:** ≤ 7.5 KB brotli for `core.js` + `analytics.js` + `forms.css` + `form-theme.css` + the inline theme. WP's is 7.1 KB.

### 13.1 Loading rules (`src/astro/assets.ts`)

- **Manifest union.** `<CoreForm>` (and the HTML expander) adds each rendered form's `AssetManifest` to a request-scoped registry, a `WeakMap` keyed by `Astro.locals`.
- **Emission.** `<FormAssets/>` emits only what the request hasn't emitted yet, in this canonical order:
  1. inline globals `window.cf_js_vars = {ajax_url}`, `cf_recaptcha`, `cf_turnstile`, `cf_poll`
  2. CSS `<link rel="stylesheet">` per the WP matrix, then the inline theme `<style>`
  3. `<script defer src>` in the order core → smart → fullscreen → analytics → captcha (provider script + ours) → stripe → poll → upload

  Asset URLs come from `?url` imports of `dist/assets/*`. `<CoreForm>` calls `<FormAssets/>` itself, so sites don't have to. Including it again is harmless.
- **Re-init.** Handlers are delegated on `document`. `astro:page-load`, `astro:after-swap` and `swup:contentReplaced` re-run prefill, conditionals and per-form inits, which are idempotent via `data-cf-ready`.
- **Globals kept.** `window.core_forms` (`on/off/submit`), `window.cf_js_vars`, `window.CFFullscreenForm`, `window.cf_turnstile_reset`, `window.CoreFormsEmbed`.
- **CSP.** Calculations use the shared recursive-descent evaluator: no `eval`, no `new Function` (D-042). Inline `custom_js` and the inline globals need `'unsafe-inline'` or a nonce. The `nonce` prop of `<FormAssets>` is passed through when given.

---

## 14. Admin information architecture (`src/admin`)

Sidebar entries are `admin.pages` in `src/server/admin-config.ts`. Hidden pages are registered in `src/admin/index.tsx` and reached by links (`?query` params; plugin pages get no router props).

| Path | Sidebar | Page | Phase / package |
|---|---|---|---|
| `/` | Forms (`list`) | forms list: stats strip, All/Trash, search (`/` shortcut), shortcode copy, a11y column, sorting, bulk actions | P1.17 |
| `/new` | | template gallery (search, layout and category filters, preview, duplicate picker) | P1.17 |
| `/form?id=&tab=` | | editor shell: title, slug, shortcode copy, standalone URL bar, Save (Cmd/Ctrl+S), fingerprint conflicts. Tabs: Fields (P1.18), Messages, Settings, Actions (P1.17 basic → P2.6), Payment (P4.6), Headless, Submissions (only when saving), Analytics (P3.2), Revisions | P1.17 shell |
| `/submissions?…` | Submissions (`tray`) | inbox views and counts, filters, date range, team views, bulk actions, detail panel (fields, info, payment, raw, edit, replies, team, logs) | P1.19b |
| `/email-logs` | | email logs (stats, filters, detail by id, resend, delete) | P1.19b |
| `/polls`, `/poll?id=&tab=` | Polls (`chart`) | list and the 5-tab editor, analytics, CSV | P1.15 |
| `/analytics` | Analytics (`chart-line`) | overview, blocked counts, spam trends | P3.2 |
| `/commerce?tab=` | Commerce (`tag`) | activation screen when off; Overview, Products, Customers, Licenses, Orders, Storefront, Settings | P4.6 |
| `/settings?section=` | Settings (`settings`) | General, Spam, Email, Messaging, Headless, Files, Payments (P4.6), Commerce (P4.6); search, dirty bar | P1.17 |
| `/theme` | | form theme customizer (tokens, presets, preview iframe, contrast audit, copy CSS) | P1.17 |
| `/tools?section=` | Tools (`database`) | Import/Export, Importers (P1.21), Privacy (GDPR), Health (doctor), Jobs, Data upgrade, Danger zone | P1.20 |
| `/recovery` | | delivery recovery (uncertain runs, failed queue, fulfillment/refund) | P2.6 |

- **Widgets:** `recent-submissions` (spam excluded) and `assigned-to-me` (overdue items).
- **Portable Text blocks:** `core-form` (fields `formId` select via `forms/options`, `showTitle`, `titleLevel`, `loadTheme`, `loadStylesheet`, `alignment`, `maxWidth`, `anchorId`, `className`) and `core-poll` (`pollId`, `mode`). Phase 4 adds the 8 commerce blocks (`core-license-products`, …). `blockComponents` also maps the legacy type `form` (Gatilab content uses it).
- **Libraries:** kumo, phosphor and React from the host (peer deps). `@dnd-kit/core` + `@dnd-kit/sortable` (builder), and `@codemirror/*` loaded lazily for Code mode.
- **Accessibility:** WCAG 2.2 AA throughout. Keyboard-operable drag and drop with screen-reader announcements; labelled controls; focus management on dialogs; live regions for saves.

---

## 15. Extension points (developer API)

There is no PHP hook bus, so developers register through a typed registry. Internal modules use the same registry ("dogfooding"), which is how validator priorities and the markup filter order are kept.

```ts
// src/server/extensions/public.ts  (exported as "@gatilab/emdash-core-forms/extend")
export interface CoreFormsExtension {
  name: string;
  fieldTypes?: CustomFieldType[];                       // cf_register_field_type
  actions?: ActionModule[];                             // cf_process_form_action_{type}
  validators?: { priority: number; name: string; validate(c: ValidateContext): Promise<string> }[]; // cf_validate_form
  templates?: FormTemplate[];                           // cf_form_templates
  on?: { [E in keyof CoreFormsEvents]?: (p: CoreFormsEvents[E], cx: CfContext) => void | Promise<void> };
  filters?: Partial<CoreFormsFilters>;
}
export interface CoreFormsFilters {
  redirectUrl(url: string, c: { form: ResolvedForm; data: SubmissionData; submission: SubmissionRecord | EphemeralSubmission }): string;   // cf_form_redirect_url
  allowedFieldNames(names: string[], c: { form: ResolvedForm; data: SubmissionData }): string[];   // cf_allowed_field_names
  ignoredFieldNames(names: string[]): string[];                                                     // cf_ignored_field_names
  formMarkup(html: string, form: ResolvedForm): string;                                             // cf_form_markup (priority via markupFilters)
  schemaMarkup(html: string, schema: FormSchemaJson, form: ResolvedForm): string;                   // cf_schema_markup
  formHtml(html: string, form: ResolvedForm): string;                                               // cf_form_html
  formDataAttributes(attrs: [string, string][], form: ResolvedForm): [string, string][];           // cf_form_element_data_attributes
  formClass(cls: string, form: ResolvedForm): string;                                               // cf_form_element_class_attr
  assetRequirements(m: AssetManifest, form: ResolvedForm): AssetManifest;                           // cf_form_asset_requirements
  templateTags(tags: Record<string, string | ((param: string) => string)>): typeof tags;            // cf_template_tags
  fieldLengthLimits(l: Record<string, number>, form: ResolvedForm): Record<string, number>;         // cf_form_field_length_limits
  maxSubmissionBytes(n: number, form: ResolvedForm): number;                                        // cf_max_submission_bytes
  submitRateLimit(n: number, form: ResolvedForm): number;                                           // cf_submit_rate_limit
  duplicateWindowSeconds(n: number, form: ResolvedForm): number;                                    // cf_duplicate_window_seconds
  webhookRequest(init: { url: string; headers: Record<string, string>; body: string }, c: { action: ActionConfig; form: ResolvedForm }): typeof init; // cf_webhook_request_args
  emailMessage(m: MailMessage, c: { action: ActionConfig; form: ResolvedForm }): MailMessage;      // cf_action_email_* (combined)
  shouldTrackAnalytics(enabled: boolean, form: ResolvedForm): boolean;                              // cf_should_track_analytics (consent)
  uploadMaxFilesize(bytes: number): number;                                                         // cf_upload_max_filesize
  akismetData(d: Record<string, string>): Record<string, string>;                                  // cf_akismet_data
  gatewaysForCurrency(ids: GatewayId[], currency: string): GatewayId[];                             // cf_payment_gateways_for_currency
  storefrontProduct(p: WpValue, product: ProductRecord): WpValue;                                   // cf_storefront_product
}
export function registerCoreFormsExtension(ext: CoreFormsExtension): void; // idempotent by name; isolate-global registry
```

- **Loading.** `coreFormsSite({ extensions: "./src/core-forms.ts" })` imports that module from the companion middleware entry, so it runs once per isolate before any request. Without the companion, a site imports it from `src/worker.ts`.
- **Error isolation.** Filters run synchronously in the render path. Events and validators may be async. A failing listener is logged and never breaks a submission.
- **Not ported:** `cf_settings` (config is data), `cf_payments_orchestrator` (dependency injection), `cf_shortcode_form_identifier`, the standalone and fullscreen head/footer actions (use the `layout` option or Astro slots on `CoreForm`).

---

## 16. Security model

1. **CSRF.** EmDash rejects cross-origin, non-GET plugin-route requests that carry a foreign `Origin`. Same-origin forms and beacons pass. WP nonces are not emitted, and `enable_nonce` is imported but inert (DV-15). Companion POST endpoints check `Origin`/`Sec-Fetch-Site` the same way. Portal POSTs also use a per-session CSRF token.
2. **AuthZ.**
   - Route kinds (§8.1). Internal routes are unreachable over HTTP without admin rights.
   - Team access grants and form scopes are enforced inside workspace routes, including every id in bulk operations: all are checked before any mutation.
   - `custom_js`, unfiltered markup and unfiltered messages require an Admin (WP `unfiltered_html`). Other users' markup goes through the ported `sanitize_markup` KSES allowlist, and their messages through `wp_kses_post`.
3. **Secrets.**
   - Global and per-action secret leaves are sealed with AES-GCM (`encryptPluginSetting`, which needs `EMDASH_ENCRYPTION_KEY`).
   - They are masked in admin responses and never present in public responses.
   - Log messages are redacted with the WP rule: values ≥ 4 chars under keys matching `/key|token|secret|password|auth|url/i`.
   - Exports exclude credentials unless "Include credentials" is ticked (DV-58).
   - The HMAC signing key comes from `CORE_FORMS_SECRET` or a generated sealed key. WP legacy salts are an optional import-time secret, used for verification only and dropped after their TTL.
4. **Outbound HTTP.** Only through `ctx.http`, whose SSRF check resolves DNS. The WP pre-checks (scheme, localhost, IP literals, userinfo for n8n) are applied first for WP-identical error results. Each module sets explicit timeouts and redirect policy.
5. **Inbound signatures.** Constant-time comparison everywhere:
   - Stripe and Polar: HMAC with a 300 s window
   - Razorpay: HMAC plus event-id dedupe
   - PayPal: the verification API with the raw body spliced in
   - Svix (Resend): ±300 s
   - Meta: `X-Hub-Signature-256`
   - Twilio: HMAC-SHA1 over the exact public URL

   Event ids are deduped through `paymentEvents` and `inbound-event` jobs.
6. **Abuse.**
   - Existing WP limits are kept: submit rate per form, drafts 30/min, tracking 30/min, polls 12/min.
   - New limits: license API, native checkout, access requests (DV-39). Turnstile is offered on native checkout (DV-40).
   - Solved CAPTCHA tokens are single-use (DV-06). Math challenges are HMAC-bound to `formId|answer|exp|nonce` and single-use (DV-05).
7. **Files.** Private by default (R2, no public URL). Downloads require an admin session or a signed, expiring token. Ownership is checked before deletes, and no server paths appear in payloads.
8. **Privacy.**
   - IP storage can be switched off (`emdash.store_ip`).
   - Analytics stores only `sha256(ip + key + day)`.
   - GDPR find, export and erase run by email.
   - Retention jobs follow the per-form policy.
   - The portal drops the token from the URL after verification (DV-42).
   - Customer data responses use explicit allowlists: no `source_key` or `payment_id` (DV-11).
9. **Output.** All server HTML is built with escaping helpers that match WP's (`esc_attr`, `esc_html`, `esc_textarea`). Message HTML is sanitized on save for non-admins, then set with `innerHTML` on the client, as in WP. Fullscreen escapes interpolated attributes (DV-22).
10. **Supply chain.** Runtime dependencies are limited to `htmlparser2`/`domhandler` (server HTML), `@dnd-kit/*` and `@codemirror/*` (admin), `fflate` (central-directory ZIP checks, P4) and esbuild (dev). No payment SDKs.

---

## 17. Import, export and migration

### 17.1 Accepted inputs (`src/core/io`)

| Format | Detection | Handling |
|---|---|---|
| `core-forms-data` v1 from WP 4.11.1 | `format === "core-forms-data" && format_version === 1` | primary path; every dataset (forms, submissions, polls, settings, activity, commerce) |
| `core-forms-data` v1 from EmDash | same, plus a top-level `emdash` block | round trip; the `emdash` block carries files, team, revisions, field groups, usage, customers, sessions excluded |
| Extended exporter output (`wordpress/export-core-forms.php`) | `core-forms-data` + top-level `emdash_extras` | adds what WP's native export omits: `cf_submission_team`, `cf_field_groups`, user scopes and views (with user emails), `cf_unsaved_capacity_*`, `cf_fulfillment`/`cf_payment_reversals` rows not yet completed, `cf_commerce_key_policy`, the `timezone_string`/`gmt_offset`/`date_format`/`time_format` options, a files manifest, and the Gatilab block and shortcode inventory |
| WP-CLI `schema: 1` | `schema === 1 && Array.isArray(forms)` | creates new forms (no ids); messages from `definition.meta` |
| v0.1.0 array / `{forms: []}` | array of `{id, slug, title, markup, settings, messages}` | forms keep their ids; settings are taken raw |
| Competitor envelope (`competitors` section of the exporter) or GF/WPForms/Fluent JSON | `src/core/io/importers` | converted **in the browser** into `core-forms-data` form rows, then imported normally (D-130) |

### 17.2 Import protocol

1. The admin page reads the file in the browser, validates it with the shared validator (WP messages), and shows the datasets present.
2. `data/import-plan` reports conflicts by id, then by slug, and the policy outcome.
3. `data/import-batch` (≤ 200 rows per call) runs datasets in WP order: forms → form references → submissions/replies → polls/votes → settings → activity → commerce (spec 04 §4.2.2, spec 06 §7.9). Row rules:
   - **Forms** keep their WP id. Every meta key is stored verbatim; `_cf_settings` and `_cf_form_schema` map to fields. The 4.5.0 and 4.6.3 normalizations are applied to old data. `_cf_a11y_report` is recomputed.
   - **Submissions** keep their WP id when it's free, or when the existing row has the same `formId` and `submittedAt` (an idempotent update). Otherwise they get a new id, which is reported in `idMap`. Values are coerced from MySQL strings, `submitted_at` becomes ISO UTC, and `bucket` and `emailKey` are derived.
   - **Replies, email logs, action logs, analytics** get deterministic ids `wp-<id>`, so re-imports update instead of duplicating (DV-32).
   - **Queue rows** with status `pending`/`processing`/`retrying` become `failed` with WP's paused message (spec 04 §4.2.2.6).
   - **Settings** are merged into `cfg:settings`, with secrets imported only when "Import credentials" is ticked. Theme tokens go to `cfg:theme-tokens`.
   - **File descriptors** keep their WP `url`, with `file_id` = `legacy:<attachment_id|name>`. The optional `import-files` job copies public upload URLs into R2 and rewrites the descriptors.
4. `data/import-finalize`:
   - `ids.ensureAtLeast` for each entity
   - regenerate the theme CSS
   - enqueue `usage-scan`
   - write the `state:schema` version

### 17.3 Export

The admin page pulls `data/export-page` per dataset and table, then assembles the envelope in the browser and downloads it. That avoids the 8 MiB response limit.
- Rows are emitted in **WP row shape** (MySQL-style strings) under `data`, so WP 4.11.1 can import an EmDash export.
- EmDash-only data goes in the top-level `emdash` block, which WP ignores.
- Filename: `core-forms-<host>-<Y-m-d-His>.json`.

### 17.4 v0.1.0 → v1 data migration (`migrate/*`, P1.20)

**Detection.** `state:schema` is absent, and v0.1.0-shaped records exist: settings with typed booleans or a `captcha` key, UUID submission ids, or statuses `spam`/`trash`.

**Recommended path for Gatilab:** re-import forms from a fresh extended export. Forms update in place by id, so the lossy v0.1.0 normalization is fully reversed. Then run the migration for submissions only.

**Best-effort conversion** when no export is available:

| Item | Conversion |
|---|---|
| Form settings | booleans → `"1"`/`"0"`; numbers → strings |
| `schedule_open`/`schedule_close` ISO | split into date and time with `schedule_timezone: "UTC"` |
| `captcha` | `turnstile` → `enable_turnstile: "1"`; `hcaptcha` → `enable_hcaptcha: "1"`; `recaptcha` → nothing (global). The key is removed. |
| Action `id` `action-<i+1>` | `_cf_action_id: "action-<i>"` |
| `enabled` | kept |
| `load_form_theme: false` (lossy default) | `""` (inherit) |

| Submission field | Conversion |
|---|---|
| id | new numeric id; UUID → `legacyId` |
| status `spam` | `isSpam: true`, `status: "read"` |
| status `trash` | `"archived"` |
| `ip` | `ipAddress` |
| `bucket`, `emailKey` | derived |

The KV `stats:blocked:*` keys are dropped. `resp:*` keys expire on their own.

---

## 18. Testing architecture

- **Unit tests** (vitest) for all pure logic in `shared/` and `core/`, owned per module (`tests/<module>/`).
- **In-memory harness** (`tests/harness/`, P1.0b):
  - `FakeStorage` reproduces EmDash semantics: AND-only `where`, a **throw on undeclared index fields** (validated against `collections.ts`), `limit ≤ 100`, cursors, `count`, `compareAndSet`, `updateIf` with `delta`/guards, `getMany ≤ 50` assertions.
  - Also `FakeKV`, `FakeCron`, `FakeEmail`, `FakeHttp` (recorded fixtures), `FakeR2`, `FakeMedia`, a controllable clock and `after()` capture.
  - `runRoute(name, input, {user, request})` and `runTick()` exercise the real route framework and job runner.
- **WP oracle** (`tools/wp-oracle`, P1.1): WordPress Playground CLI (php-wasm) with `.reference/core-forms-wp` mounted, fed with Gatilab's exported forms and settings plus synthetic corpora. PHP scripts call the real WP functions and capture golden output into `tests/golden/<area>/*.json`:
  - `get_html()`, `MarkupParser::parse`, `SchemaRenderer`
  - `cf_enhance_accessibility`, `cf_replace_data_variables`
  - `Forms::process`, with `wp_mail` and `pre_http_request` captured
  - `FieldCalculator`, `WebhookSigner`, `http_build_query`, `sanitize_title`, `esc_url_raw`, `cf_csv_row`
  - `FormTheme::css`, `AccessibilityTester`, the templates registry
  - the license server `dispatch`, Data Migration export

  It runs offline and never contacts gatilab.com. Golden files are committed. A comparator normalizes only the documented deviations: nonce inputs, the noscript and action attributes, the instance counter.
- **Parity suites:**
  - `tests/parity/render-gatilab.test.ts`: all 54 Gatilab forms
  - `tests/parity/templates.test.ts`: 63 templates
  - pipeline scenario matrix
  - webhook bytes
  - data variables
  - CSV
  - license API (P4)
- **E2E** (`e2e/`, P1.14): a fixture Astro site using EmDash on Node with local SQLite and this package linked, driven by Playwright. It covers DOM events and the JS API, no-JS PRG, conditionals and calculations, multi-step, drafts resume, uploads, standalone pages, and polls. `@axe-core/playwright` gates WCAG 2.2 AA on standalone, multi-step, fullscreen and the admin pages. Run it serially: no parallel writes (local-dev gotcha).
- **Budgets and boundaries:** `tests/budgets.test.ts` (brotli sizes) and an ESLint import-boundary rule in CI.
- **CI** (`pnpm verify`): typecheck (strict, `noUncheckedIndexedAccess`), lint, unit, parity, budgets, `astro check`. E2E runs on demand and at phase gates.

---

## 19. Operations: health and doctor

The `doctor` route is shown in Tools → Health and exposed through MCP and the CLI. It exits 1 on any `fail`. Checks:

- **Platform**
  - storage collections reachable
  - declared indexes present (probe query)
  - cron `tick` registered (`ctx.cron.list()`), last tick under 3 min ago
  - `EMDASH_ENCRYPTION_KEY` present
- **Bindings and configuration**
  - private bucket bound
  - email transport available
  - companion detected and its options matching the plugin's
- **Queue and delivery**
  - job backlog (> 500 pending warns)
  - failed jobs (> 0 warns)
  - uncertain action runs
  - email failure rate over 24 h (warn > 0 %, fail > 20 %)
- **Data and configuration health**
  - headless forms without an API key (fail)
  - last webhook per configured gateway (P4)
  - analytics row counts (P3)
  - data schema version current
  - v0.1.0 data pending migration
