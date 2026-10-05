# 00 · EmDash 1.1 plugin platform: what it can and cannot do

Foundation spec for the Core Forms 4.11.1 port (forms + payments + licensing + analytics). Every claim below is tied to a source file. Where a fact is a Cloudflare platform limit rather than EmDash code, it is labelled **(platform)** and should be checked against the Cloudflare docs before you rely on it.

## Source aliases

| Alias | Path |
| --- | --- |
| `E/` | `node_modules/.pnpm/emdash@1.1.0_*/node_modules/emdash/src/` (any hashed copy) |
| `PT` | `node_modules/.pnpm/@emdash-cms+plugin-types@0.5.0/node_modules/@emdash-cms/plugin-types/dist/index.{d.ts,js}` |
| `CF/` | `node_modules/.pnpm/@emdash-cms+cloudflare@1.1.0_*/node_modules/@emdash-cms/cloudflare/src/` |
| `ADM` | `node_modules/.pnpm/@emdash-cms+admin@1.1.0_*/node_modules/@emdash-cms/admin/dist/index.js` |
| `AUTH/` | `node_modules/.pnpm/@emdash-cms+auth@1.1.0_*/node_modules/@emdash-cms/auth/src/` |
| `BLK` | `node_modules/.pnpm/@emdash-cms+blocks@1.1.0_*/node_modules/@emdash-cms/blocks/dist/validation-*.d.ts` |
| `GH:forms/` | `github.com/emdash-cms/emdash` → `packages/plugins/forms/src/` (the official forms plugin, read-only) |
| `GH:docs/` | `github.com/emdash-cms/emdash` → `docs/src/content/docs/` |
| `site/` | `apps/gatilab/` |
| `cf/` | `plugins/core-forms/` (our current v0.1.0 plugin) |

---

## TL;DR: the 15 constraints that shape the port

1. **Cron exists.** There is a `cron` hook and `ctx.cron.schedule/cancel/list`. On Cloudflare it only runs if the Worker has a Cron Trigger and a `scheduled()` handler. gatilab.com has both (`* * * * *`). The executor claims **at most 10 due tasks per tick across all plugins**. A failed one-shot task retries 5 times with 1, 2, 4, 8 and 16 minute backoff, then it is deleted. The cron hook has a **5 s default timeout**. (`E/plugins/cron.ts`, `site/wrangler.jsonc`, `site/src/worker.ts`)
2. **`plugin:install` and `plugin:activate` do not fire for plugins listed in `astro.config.mjs`.** They only fire on registry or marketplace installs and when an admin re-enables a plugin. Recurring cron tasks therefore have to be scheduled lazily and idempotently. (`E/emdash-runtime.ts` ~L1033–1096, `E/plugins/install-finalization.ts`)
3. **Plugin routes live only under `/_emdash/api/plugins/<id>/<exact-route-name>`.** There are no path params, no `OPTIONS` and no CORS headers. Cross-origin browser writes get a 403. (`E/plugins/http-route-dispatch.ts`, `E/astro/middleware/auth.ts`, `E/plugins/route-wire.ts`)
4. **Raw route responses cannot be HTML, JS, CSS, SVG or XML.** They also cannot set cookies or `Access-Control-*` headers, are capped at 8 MiB, and are fully buffered (no streaming). A plugin therefore cannot serve a standalone page, a customer portal or a large download. (`E/plugins/route-wire.ts`)
5. **A plugin cannot inject Astro routes or middleware.** A *companion Astro integration* shipped in the same npm package can (Astro's own `injectRoute`/`addMiddleware`). That is the recommended way to get `/collect/<slug>/`, `/account/…`, CORS license endpoints and streamed downloads.
6. **Declared request bodies default to a 1 MiB limit (8 MiB maximum).** `multipart/form-data` allows at most 100 parts, and each part (file) is capped at **1 MiB**. (`PT` constants, `E/plugins/route-wire.ts`)
7. **Media uploaded by a plugin is always public** at `/_emdash/api/media/file/<key>` and shows up in the Media Library. Only image, video, audio and PDF types are allowed. There are no signed download URLs, and on R2 bindings no signed upload URLs either. (`E/plugins/context.ts` L980–1130, `E/api/handlers/media-allowlist.ts`, `E/astro/routes/api/media/file/[...key].ts`, `CF/storage/r2.ts`)
8. **Plugin storage queries are AND-only.** Supported filters: equality, `in`, `startsWith`, range (`gt/gte/lt/lte`) and null. There is no OR, no `neq` and no substring search. Every `where`/`orderBy` field must be declared in `indexes`. `limit` is capped at 100. On D1 there are **no multi-statement transactions**. (`E/plugins/storage-query.ts`, `E/database/repositories/plugin-storage.ts`, `E/database/transaction.ts`)
9. **Storage indexes, including `uniqueIndexes`, are only created by the scheduler tick** for config-declared plugins. Without a cron trigger they never exist. (`E/emdash-runtime.ts` `syncPluginStorageIndexesOnce`)
10. **`ctx.email.send` takes `{ to (one address), cc?, replyTo?, subject, text (required), html? }`.** There is no `from`, no `bcc`, no attachments and no custom headers. It is `undefined` when no provider is selected. (`E/plugins/types.ts` `EmailMessage`, `E/plugins/email.ts`)
11. **Plugins cannot create users, sessions or tokens.** Public routes never receive `ctx.user`, even when the visitor is logged in. Self-signup only works for allowlisted email domains. A customer portal therefore needs plugin-owned identity (magic links or license keys). (`E/plugins/http-route-dispatch.ts`, `E/plugins/types.ts` `UserAccess`, `AUTH/signup.ts`)
12. **`after()` is `waitUntil` on Workers.** It is fire-and-forget: no retry, and errors are only logged. Use it only for best-effort work. Durable work belongs in a storage-backed job queue drained by cron, or in Cloudflare Queues wired by the site. (`E/after.ts`)
13. **Native plugins share the Worker isolate.** They can `import { env } from "cloudflare:workers"` to use extra bindings (a private R2 bucket, Queues, Analytics Engine, a Rate Limiting binding). The official Cloudflare email plugin does exactly this. (`CF/plugins/cloudflare-email.ts`)
14. **The admin CSP is `connect-src 'self'` and `script-src 'self' 'unsafe-inline'` in production.** Plugin React pages cannot call third-party APIs from the browser or load CDN scripts. (`E/astro/middleware/csp.ts`)
15. **The port must stay a native plugin.** React admin pages, Portable Text blocks, `componentsEntry`, `page:fragments` and Cloudflare bindings are all native-only. Native plugins are distributed on npm, not through the EmDash registry. (`GH:docs/plugins/creating-plugins/choosing-a-format.mdx`)

---

## 1. Plugin definition API

### 1.1 Two objects: descriptor (build time) and `definePlugin` (runtime)

**Descriptor**: `PluginDescriptor` (`E/astro/integration/runtime.ts` L80–175), returned by our factory and placed in `emdash({ plugins: [...] })`:

```ts
{ id, version, entrypoint,            // entrypoint must export createPlugin(options)
  format?: "native" | "standard",     // default "native"
  options?: JSONSerializable,         // passed to createPlugin() via JSON.stringify
  adminEntry?, componentsEntry?,      // React admin module; Astro module exporting blockComponents
  // used for standard/sandboxed plugins only:
  adminPages?, adminWidgets?, editorPanels?, editorActions?, settingsSchema?,
  portableTextBlocks?, fieldWidgets?, capabilities?, allowedHosts?, storage?, mcp?, routes?, hooks? }
```

Generated code: `import { createPlugin as createPluginN } from "<entrypoint>"; createPluginN(<JSON options>)` (`E/astro/integration/virtual-modules.ts` `generatePluginsModule`). A missing `entrypoint` throws at build time.

**`definePlugin(def)`** (`E/plugins/define-plugin.ts`, type `PluginDefinition` in `E/plugins/types.ts` L2145):

```ts
definePlugin({
  id: string,                 // /^[a-z0-9-]+$/ or /^@[a-z0-9-]+\/[a-z0-9-]+$/ (use unscoped: it is a URL segment)
  version: string,            // /^\d+\.\d+\.\d+/
  capabilities?: PluginCapability[],
  allowedHosts?: string[],    // for network:request; "*", "*.example.com" (also matches bare domain), exact
  storage?: Record<string, { indexes: (string|string[])[]; uniqueIndexes?: (string|string[])[] }>,
  hooks?: PluginHooks,        // handler fn or { handler, priority=100, timeout=5000, dependencies=[], errorPolicy="abort", exclusive=false }
  routes?: Record<string, PluginRoute>,
  mcp?: { tools: Record<string, { description, route, input: ZodType, output?, destructive? }> },
  admin?: { entry?, settingsSchema?, pages?, widgets?, editorPanels?, editorActions?, portableTextBlocks?, fieldWidgets? },
})
```

What `definePlugin` validates (`E/plugins/define-plugin.ts`):

- The id and version formats.
- Every capability string. Deprecated aliases are accepted, warned about and normalized.
- MCP tools must reference private, non-raw, POST-JSON routes that declare a `permission`.
- Editor panels and actions must reference private POST-JSON routes.
- If the plugin declares `admin.pages` or `admin.widgets` *and* has a route literally named `admin`, that route must be private POST-JSON.

It also applies implied capabilities. `content:write → content:read`, `media:write → media:read`, `network:request:unrestricted → network:request`, and so on (`E/plugins/types.ts` L84–95).

`definePluginRoute({ request: { body: "form-data" }, handler })` is exported from `emdash` to type `ctx.input` by body mode (`E/plugins/define-plugin.ts`, `E/index.ts` L274).

### 1.2 Native vs sandboxed

| | Native (`plugins: []`, `format: "native"`) | Sandboxed (`sandboxed: []`, or registry install) |
| --- | --- | --- |
| Runs | In the host Worker isolate | Worker Loader isolate per plugin (`CF/sandbox/runner.ts`) |
| Limits | None per plugin (Worker limits only) | Defaults: `cpuMs: 50`, `subrequests: 10`, `wallTimeMs: 30_000`, memory ~128 MB not enforced (`CF/sandbox/runner.ts` `DEFAULT_LIMITS`) |
| Capability gating | `PluginContextFactory`, but **not a security boundary**. Code can call `fetch()`, `cloudflare:workers` and `process.env` directly | Enforced by the `PluginBridge` service binding |
| Admin UI | React (`admin.entry`/`adminEntry`) or Block Kit | Block Kit only (an `admin` route); `admin.entry` is forbidden (`PT` `PluginAdminConfig` docs) |
| Portable Text blocks + Astro renderers | Yes (`componentsEntry`) | No |
| `page:fragments` | Yes (with capability) | Never invoked (`E/page/fragments.ts` header) |
| Request headers in routes | Full `Request` (`ctx.request.headers.get(...)`) | Only names declared in `request.headers`; credentials and cookies stripped (`GH:docs/.../api-routes.mdx` L440–445) |
| Constructor options | `options` on the descriptor | None; reads settings at runtime |
| Distribution | npm + `astro.config.mjs` edit + redeploy | Signed release in the EmDash registry (AT Protocol) |

Source for the comparison: `GH:docs/plugins/creating-plugins/choosing-a-format.mdx`.

### 1.3 Capabilities (`PT` `CURRENT_PLUGIN_CAPABILITIES`; gating in `E/plugins/context.ts` L1675–1877 and `E/plugins/hooks.ts` L335–366)

| Capability | Unlocks |
| --- | --- |
| `content:read` | `ctx.content.get/list/getTranslations/getPublicUrl`. Required to register `content:afterSave`, `afterDelete`, `beforeDelete`, `afterPublish/Unpublish/Restore/Schedule/Unschedule` |
| `content:write` | `ctx.content.create/update/delete`. Required for the `content:beforeSave` hook |
| `content:revisions:read` | `listRevisions/getRevision` |
| `content:publish` | `getVersioned/publish/unpublish/schedule/unschedule` (each needs `_rev`) |
| `content:restore` | `getTrashedVersioned/restore` |
| `hooks.content-policy:register` | `content:beforePublish/beforeSchedule/beforeUnpublish` (veto) |
| `schema:read` | `ctx.schema.listCollections/getCollection` |
| `taxonomies:read` / `:write` | `ctx.taxonomies`, plus `createTerm/addEntryTerms/removeEntryTerms` |
| `bylines:read` | `ctx.bylines`, plus the `byline:*` hooks |
| `redirects:read` / `:write` | `ctx.redirects` list/get, plus create/update/delete (with `_rev`) |
| `media:read` | `ctx.media.get/list`. Required for the `media:afterUpload` hook |
| `media:write` | `ctx.media.upload/getUploadUrl/delete`. Required for the `media:beforeUpload` hook |
| `media:bytes:read` | `ctx.media.readBytes(id, {maxBytes})` (10 MiB default, 16 MiB max; `E/plugins/media.ts`) |
| `media:metadata:write` | `ctx.media.updateMetadata(id, {alt, caption, focalX, focalY})` |
| `users:read` | `ctx.users.get/getByEmail/list`. **Also required to register any `comment:*` hook** |
| `comments:read` / `:moderate` | `ctx.comments` get/list/count, plus `setStatus` |
| `network:request` | `ctx.http.fetch` limited to `allowedHosts` (empty list means deny all) |
| `network:request:unrestricted` | `ctx.http.fetch` to any public host |
| `email:send` | `ctx.email` (only if a provider is selected) |
| `hooks.email-transport:register` | `email:deliver` (exclusive provider) |
| `hooks.email-events:register` | `email:beforeSend/afterSend` |
| `hooks.page-fragments:register` | `page:fragments` |
| `admin.editor-draft:read` / `:patch` | Editor panels and actions can read or patch the unsaved draft |

Hooks registered without the capability they need are **silently skipped**, with only a console warning (`E/plugins/hooks.ts` `registerPluginHook`). Lifecycle hooks, `cron` and `page:metadata` need no capability. Always available on `ctx`: `plugin`, `storage`, `kv`, `settings`, `log`, `site`, `url()`, `cron` (when the runtime wired a scheduler).

---

## 2. Hooks

Complete list (`PT` `HOOK_NAMES`; signatures in `E/plugins/types.ts` L1513–1823; dispatch in `E/plugins/hooks.ts`):

| Hook | Event → return | When |
| --- | --- | --- |
| `plugin:install` | `{}` → void | Registry or marketplace install only (`E/emdash-runtime.ts` `runPluginInstallLifecycle`) |
| `plugin:activate` | `{}` → void | After install, or when an admin re-enables the plugin (`setPluginStatus`). **Not on boot for config plugins** |
| `plugin:deactivate` | `{}` → void | Admin disables the plugin. Its cron tasks are also disabled (`E/plugins/lifecycle.ts`) |
| `plugin:uninstall` | `{ deleteData }` → void | Uninstall of runtime-installed plugins |
| `content:beforeSave` | `{ content, collection, isNew, id?, actor?, locale?, translationOf? }` → `content \| void` | Before a save; can mutate |
| `content:afterSave` | same → void | After a save |
| `content:beforeDelete` | `{ id, collection, permanent }` → `false` to veto | |
| `content:afterDelete` | same → void | |
| `content:beforePublish/beforeUnpublish` | `{ content, collection, origin, actor? }` → `void \| { cancel: true, reason }` | |
| `content:beforeSchedule` | `… + scheduledAt` → same | |
| `content:afterPublish/afterUnpublish/afterRestore/afterSchedule/afterUnschedule` | `{ content, collection }` → void | |
| `media:beforeUpload` | `{ file: { name, type, size } }` → modified file meta or void | |
| `media:afterUpload` | `{ media: MediaItem }` → void | |
| `cron` | `{ name, data?, scheduledAt }` → void | Dispatched **only to the owning plugin** (`invokeCronHook`) |
| `email:beforeSend` | `{ message, source }` → `message \| false` | Not run for `source: "system"` (auth emails) |
| `email:deliver` (exclusive) | `{ message, source }` → void | The one provider an admin selects |
| `email:afterSend` | `{ message, source }` → void | Fire-and-forget |
| `comment:beforeCreate` | `{ comment, metadata }` → event, `false` or void | |
| `comment:moderate` (exclusive) | `{ comment, metadata, collectionSettings, priorApprovedCount }` → `{ status, reason? }` | |
| `comment:afterCreate` / `comment:afterModerate` | → void | |
| `byline:afterSave` / `byline:afterDelete` | → void | |
| `page:metadata` | `{ page: PublicPageContext }` → contribution(s) or null | Rendered by `<EmDashHead>` |
| `page:fragments` | `{ page }` → contribution(s) or null | `<EmDashHead>`, `<EmDashBodyStart>`, `<EmDashBodyEnd>` |

**These hooks do not exist:** request/middleware hooks, auth or user events (login, signup), a per-request "init" hook, form or webhook events, or a "plugin booted" hook.

### 2.1 Cron: the background mechanism (`E/plugins/cron.ts`)

```ts
await ctx.cron?.schedule("cleanup", { schedule: "@daily" });            // recurring: 5/6-field cron or @hourly/@daily/@weekly/@monthly/@yearly, UTC
await ctx.cron?.schedule("retry-ab12", { schedule: "2026-10-05T12:00:00Z", data: { jobId } }); // one-shot: ISO datetime
await ctx.cron?.cancel("retry-ab12"); const tasks = await ctx.cron?.list();
// hook:
cron: { timeout: 25_000, handler: async (event, ctx) => { switch (event.name) { … } } }
```

- Task names match `/^[a-zA-Z][a-zA-Z0-9_-]*$/` and are at most 128 characters. Uniqueness is per (plugin, name), so scheduling again **upserts** the task. The schedule string is at most 256 characters. `data` is JSON, and `data.__emdash` is reserved for retry metadata.
- `tick()` claims `LIMIT 10` overdue idle tasks **across all plugins** and runs them **sequentially**.
  - A recurring task that fails is simply rescheduled.
  - A one-shot task that fails retries 5 times (1, 2, 4, 8, 16 minutes) and is then deleted.
  - A success deletes the one-shot task.
  - Tasks locked for more than 10 minutes are recovered.
- The handler is wrapped in the hook timeout. **The default is 5000 ms**, so set `timeout` explicitly. The timeout rejects the promise but does not cancel the work.
- **Drivers.**
  - *Cloudflare production build*: the Worker's `scheduled()` handler calls `runScheduledTasks()` (`E/astro/middleware.ts` L299; `CF/worker.ts` `createScheduledHandler`). The same tick also publishes scheduled content, runs system cleanup, syncs plugin storage indexes and runs backups.
  - *`astro dev` and Node*: an in-process `NodeCronScheduler` timer (`E/astro/integration/virtual-modules.ts` `generateSchedulerModule`).
- **gatilab.com is wired**: `site/wrangler.jsonc` has `"triggers": { "crons": ["* * * * *"] }` and `site/src/worker.ts` exports `scheduled: createScheduledHandler()`. Granularity is 1 minute.
- `ctx.cron` is `undefined` if the runtime didn't wire a scheduler. In practice it is always wired for route and hook contexts (`E/plugins/context.ts` L1837–1842, `E/emdash-runtime.ts` `cronReschedule`).

**Throughput implication.** One-shot tasks are not a job queue. Ten tasks per minute are shared by every plugin and by core.

### 2.2 `after()` (`E/after.ts`, `E/deferred-tasks.ts`)

`after(fn)` runs `fn` after the response:

- **Workers**: handed to `waitUntil` from `cloudflare:workers`.
- **Node**: fire-and-forget.
- **Errors**: caught and `console.error`'d, with no retry.
- **Platform limit**: the post-response budget is bounded by Workers `waitUntil` limits (roughly 30 s after the response) **(platform)**.

Use it only for best-effort work such as notification fan-out or stats. Anything that must happen belongs in a durable job queue (§16.2).

### 2.3 Page hooks

- `page:metadata` contributions: `meta {name, content}`, `property {property, content}`, `link {rel ∈ canonical|alternate|author|license|nlweb|site.standard.document, href, hreflang?}`, `jsonld {id?, graph}`. Plugin contributions win the first-wins dedup by `key` (`E/plugins/types.ts` L1690–1727, `E/components/EmDashHead.astro`).
- `page:fragments` contributions: `external-script {src, async?, defer?, attributes?}`, `inline-script {code, attributes?}` (`</` is escaped; `on*` attributes are dropped), `html {html}` (raw). `placement` is one of `head | body:start | body:end`. Duplicates are removed by `key`, or by `src` for external scripts (`E/page/fragments.ts`).
- Both hooks receive a `PublicPageContext` (`url, path, locale, kind, pageType, title, description, canonical, image, content?: {collection, id, slug}, seo?, articleMeta?, breadcrumbs?, siteName?, siteUrl?`). That lets a plugin target specific pages. Both only run when the theme renders `<EmDashHead page>` / `<EmDashBodyEnd page>`. gatilab.com does, in `site/src/layouts/Base.astro`.

---

## 3. Storage

### 3.1 Storage collections (`E/plugins/types.ts` L147–312, `E/database/repositories/plugin-storage.ts`)

All plugins share one `_plugin_storage` table. Each row is `(plugin_id, collection, id, data JSON text, revision, created_at, updated_at)`. Only **declared** collection names exist on `ctx.storage`.

```ts
get(id) / put(id, data) / delete(id) / exists(id)
getMany(ids) → Map            // single IN(); NOT chunked → keep ≤ ~90 ids on D1 (100 bound params; E/utils/chunks.ts)
putMany(items)                // sequential upserts "in a transaction" → NOT atomic on D1
deleteMany(ids) → number      // single IN(); chunk yourself
query({ where?, orderBy?, limit? (default 50, max 100), cursor? }) → { items: {id,data}[], cursor?, hasMore }
count(where?) → number        // COUNT(*) over the same filter
getVersioned(id) → { value, revision } | null
compareAndSet(id, expectedRevision | null, data) → { applied, revision? }   // null = create-only (idempotency)
compareAndDelete(id, revision) → { applied }
updateIf(id, { where, set?, delta? }) → { applied: true, data } | { applied: false }
  // single guarded UPDATE…RETURNING; delta = { field: { inc|dec: safeInt } } applied in SQL (COALESCE(x,0)±n)
  // never inserts; where:{} = unconditional; no clamping (guard with gte for decrements)
```

**Supported `where` values** (`E/plugins/storage-query.ts`):

- Scalars: `string | number | boolean | null`, matched by equality (`null` is `IS NULL`).
- `{ in: [...] }`
- `{ startsWith: "x" }` (LIKE with escaping)
- `{ gt, gte, lt, lte }`

Clauses are combined with **AND only**.

**Not supported:** OR, `neq`/NOT, contains or full-text search, nested paths beyond a validated field name, joins, aggregates other than `count`, or `distinct`.

- **Rule:** every `where` and `orderBy` field must be in `indexes` or `uniqueIndexes`, otherwise the query throws `StorageQueryError` (`validateWhereClause`).
- **Composite indexes:** `["formId", "submittedAt"]` makes both fields queryable.
- **Default order:** `created_at, id`.
- **Cursor paging:** works with any `orderBy`, as long as every field sorts in the same direction.
- **Number comparisons:** numeric when the bound value is a JS number.

**Indexes** are created by `syncDeclaredStorageIndexes` → `CREATE [UNIQUE] INDEX IF NOT EXISTS … ON _plugin_storage(plugin_id, collection, json_extract(data,'$.f'))` (`E/plugins/storage-indexes.ts`). For config plugins this runs **only once per process from the scheduler tick** (`E/emdash-runtime.ts` `syncPluginStorageIndexesOnce`, L973/L991/L2139).

Until the first tick after a deploy, a `uniqueIndexes` constraint is not enforced. Once enforced, it surfaces as a thrown DB error on `put`. So code must still check uniqueness itself, or use `compareAndSet(id, null, …)` with a deterministic id.

**Transactions.** `withTransaction` probes once. D1 reports "transactions are not supported" and falls back to running the statements without atomicity (`E/database/transaction.ts`). The only atomic primitives are single-row `compareAndSet`, `compareAndDelete` and `updateIf`. `updateIf` can throw `StorageSerializationError` (retryable; mainly on Postgres).

**Size.** There is no EmDash cap on document size. D1 limits rows and values to about 2 MB **(platform)**. Keep documents small: store file bytes elsewhere, and split logs and line items into their own rows.

### 3.2 KV (`E/plugins/context.ts` L130–209, `E/database/repositories/options.ts`)

```ts
ctx.kv.get<T>(key) / set(key, value) / delete(key) → boolean
ctx.kv.getVersioned<T>(key) / compareAndSet(key, rev | null, value) / compareAndDelete(key, rev)
ctx.kv.list(prefix?) → { key, value }[]     // unbounded LIKE scan, ordered by key
```

- Stored in the D1 `options` table as `plugin:<id>:<key>`. Keys are 1–1024 characters (`E/plugins/conditional-storage.ts`).
- **No TTL** (store `exp` yourself and sweep with cron). No atomic increment (use a CAS loop, or a storage row plus `updateIf` delta).
- The `settings:*` prefix is an alias for `ctx.settings`.
- This is **not** Cloudflare Workers KV. Every write is a D1 write.

---

## 4. Routes

### 4.1 Definition (`E/plugins/types.ts` L1906–1947, `PT` `routeOptionsSchema`)

```ts
routes: {
  "license/activate": {
    public?: boolean,                       // default private
    permission?: Permission,                // private routes; default "plugins:manage" (Admin)
    methods?: ("GET"|"HEAD"|"POST"|"PUT"|"PATCH"|"DELETE")[],   // no OPTIONS
    request?: { body: "none"|"json"|"text"|"bytes"|"form-data", maxBytes?: ≤8 MiB (default 1 MiB), headers?: string[] (≤32; sandbox only) },
    response?: "json" | "raw",              // raw → must return pluginResponse()
    cacheControl?: string,                  // only honoured for public GET/HEAD success
    input?: ZodType,                        // validated against parsed body; 400 VALIDATION_ERROR on fail
    handler: async (ctx: RouteContext) => unknown,
  },
}
```

- **URL:** `/_emdash/api/plugins/<pluginId>/<routeName>`. Route names match `/^[a-zA-Z0-9][a-zA-Z0-9_\-/]*$/`, and the match is **exact**: `getPluginRouteMeta` strips the leading slash and looks the name up in a map (`E/emdash-runtime.ts` L5392). There are **no path params or wildcards**, so dynamic ids go in the query string or body.
- **`ctx` = `PluginContext` plus:** `input`, `request` (the original `Request`, but body readers throw because the body is already parsed), `requestMeta: { ip, userAgent, referer, geo: {country, region, city} | null }`, `user?: UserInfo` (**private routes only**) and `ui?` (`E/plugins/routes.ts`). The IP comes from `cf-connecting-ip` when a `cf` object is present (`E/plugins/request-meta.ts`).

### 4.2 Body modes (`E/plugins/route-wire.ts`, `E/plugins/routes.ts` `parseRouteInput`)

- `none` → query object `Record<string, string | string[]>`. `json` → parsed JSON. `text` → string (strict UTF-8). `bytes` → `Uint8Array` (exact raw body, which is what webhook signatures need).
- `form-data` (multipart or urlencoded) → `{ entries: Array<{ name, kind: "text", value } | { name, kind: "file", filename, contentType, bytes: Uint8Array }> }`.
  - At most **100 parts**.
  - Each text value and each **file ≤ 1 MiB** (`PLUGIN_ROUTE_MAX_MULTIPART_PART_BYTES`).
  - Filenames are at most 255 bytes, with no `/`, `\` or control characters. A missing type becomes `application/octet-stream`.
- **No `request` declaration (legacy):** `POST/PUT/PATCH` → `request.json()` with **no EmDash size cap**; other methods → query object. The official forms plugin uses this to send files as base64 JSON, capped at 10 MB by its own zod schema (`GH:forms/schemas.ts`). Platform request-size and memory limits still apply **(platform)**.

### 4.3 Responses

- **JSON (default):** `{ success: true, data }`. A thrown `PluginRouteError(code, message, status)` (helpers: `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `internal`) becomes `{ success: false, error: { code, message } }`. The `details` field is **dropped** (`E/plugins/http-route-dispatch.ts`). Other errors become 500 `INTERNAL_ERROR` with the message hidden. For field-level validation errors, return them in `data`.
- **Raw:** `pluginResponse({ status 200–599, headers, body: {kind:"text"|"bytes", value} | null })` (`E/plugin-types.ts`). The wire filter (`E/plugins/route-wire.ts`) enforces:
  - **Allowed headers:** `accept-ranges, content-disposition, content-encoding, content-language, content-range, content-type, etag, last-modified, retry-after`, and `location` (public routes: **same origin only**, otherwise the response is invalid and returns 500; private routes: any URL). Everything else is dropped silently, including **`set-cookie`, `access-control-*`, `vary`, `www-authenticate`** and custom `x-*` headers.
  - **Forbidden content types:** html, xhtml, xml, svg, css, js/ecmascript, wasm, multipart/related, x-mixed-replace.
  - **Forced headers:** `x-content-type-options: nosniff`, `content-security-policy: sandbox; default-src 'none'`, `referrer-policy: no-referrer`.
  - **Body:** at most 8 MiB, fully buffered, so **no streaming**.
- **Cache-Control:** `private, no-store` unless the route is public, has `cacheControl` set, and the request is a successful GET/HEAD.

### 4.4 Auth and CSRF (`E/astro/middleware/auth.ts` L214–228, `E/plugins/http-route-dispatch.ts`, `E/api/csrf.ts`)

- Any non-GET/HEAD/OPTIONS request to `/_emdash/api/plugins/*`, **public or private**, must have **no `Origin`**, an `Origin` matching the site (internal or public origin), or `X-EmDash-Request: 1`. Anything else gets **403 `CSRF_REJECTED`**.
  - Server-to-server callers (Stripe, WordPress `wp_remote_post`, curl) send no `Origin`, so they pass.
  - Cross-origin browser POSTs fail.
  - There is no `OPTIONS` route and no CORS headers, so cross-origin `fetch` from another site is impossible.
- **Private routes:**
  - The user must hold `permission` (the default is `plugins:manage`, which is Admin), checked through the session or a Bearer API/OAuth token with the `admin` scope.
  - Cookie-session requests also need `X-EmDash-Request: 1` **for every method, including GET**. `apiFetch` from `emdash/plugin-utils` adds it.
  - Roles: SUBSCRIBER 10, CONTRIBUTOR 20, AUTHOR 30, EDITOR 40, ADMIN 50 (`AUTH/rbac.ts`). Pick a lower permission (for example `plugins:read` for Editor+, or `content:read` for any logged-in user) to widen access.
- **Public routes:** no auth and no `ctx.user`. The caller is forced to `undefined` even with a valid session (`dispatchPluginApiRequest`: `const caller = routeMeta.public ? undefined : user`).
- **Rate limiting:** none is exported to plugins. Core's `checkRateLimit` (`E/auth/rate-limit.ts`) is internal. Use a KV/storage counter keyed by a hashed IP (as `cf/src/routes.ts` does), Cloudflare WAF rate-limit rules, or a Workers Rate Limiting binding through `cloudflare:workers` (native).

### 4.5 Calling routes from SSR (`E/plugin-utils.ts`, `E/astro/types.ts` L529–556)

- `getPublicPluginApiRouteHandler(Astro.locals)` → `(pluginId, method, path, request) => HandlerResponse`. It only dispatches **public** routes; the official forms plugin uses this in `FormEmbed.astro`.
- `Astro.locals.emdash.handlePluginApiRoute(pluginId, method, path, request, user?)` is the trusted, auth-free dispatcher, the same one the catch-all route uses. An Astro page or endpoint can pass `Astro.locals.user` (set by soft auth on public pages, `auth.ts` `handlePublicRouteAuth`) so the plugin receives `ctx.user`. **The caller must do the authorization.**
- `withEmDashRuntime(rt => rt.handlePluginApiRoute(...))` from `emdash/middleware` runs plugin routes from a Queue consumer or `scheduled()` handler, fully trusted (`E/astro/middleware.ts` L310–352).

---

## 5. Public pages from a plugin

**Not supported by the plugin API:** injecting Astro pages, endpoints, middleware or rewrites. `PluginDescriptor` has no route-injection field. Core injects only its own routes plus auth-provider routes (`E/astro/integration/index.ts` L687–709, `E/astro/integration/routes.ts`). Plugin routes can't return HTML (§4.3), and public routes see no user.

| Need | Achievable in plugin only? | How |
| --- | --- | --- |
| Form embedded in content | Yes | Portable Text block + `componentsEntry` Astro component (§12) |
| Standalone form page `/collect/contact/` | No | (a) the site author adds an Astro page that renders our exported component, or (b) a **companion Astro integration** in our package calls `injectRoute({ pattern: "/collect/[slug]", entrypoint: "@gatilab/emdash-core-forms/pages/collect.astro" })` |
| Customer portal `/account/*` | No | Companion integration pages + plugin-owned sessions (cookies set by the Astro page, since plugin routes can't `Set-Cookie`) |
| Product / checkout pages | No | Same as above, or content entries in a site collection rendered by the theme, using our components |
| License API at a custom path, with CORS | Partly | Server-to-server: public plugin routes work as-is at `/_emdash/api/plugins/core-forms/license/*` (raw JSON for custom shapes). Custom path, CORS or `OPTIONS`: an injected Astro endpoint that forwards to `locals.emdash.handlePluginApiRoute` |
| Large digital downloads | No | An injected Astro endpoint that validates a token through the plugin, then streams from R2 (`locals.emdash.storage.download(key).body`, or a private bucket binding) |

A companion integration is plain Astro: `integrations: [coreFormsSite()]` next to `emdash({ plugins: [coreForms()] })`. Injected specific patterns outrank the site's `[...path].astro` catch-all under Astro's route priority. Everything under `/_emdash/*` gets EmDash's admin CSP and auth; injected public paths get soft auth only.

---

## 6. Media and files

- **`ctx.media.upload(filename, contentType, bytes)`** (with `media:write`): writes to the configured storage (R2 `MEDIA` on gatilab.com) with key `<ULID>.<ext>`, creates a `ready` media row, and returns `{ mediaId, storageKey, url: "/_emdash/api/media/file/<key>" }` (`E/plugins/context.ts` L1061–1113). There is no size check in this path.
- **Allowed types** (`E/api/handlers/media-allowlist.ts`): `image/png, jpeg, gif, webp, avif, jxl`, `video/*`, `audio/*`, `application/pdf`. Anything else gets **415**. ZIP, DOCX, CSV and TXT uploads are **NOT SUPPORTED** through `ctx.media`.
- **`getUploadUrl`** throws on R2 bindings: "R2 bindings do not support pre-signed upload URLs" (`CF/storage/r2.ts` L134).
- **Visibility:** `/_emdash/api/media/file/*` is a **public, unauthenticated** route (`PUBLIC_API_PREFIXES` in `auth.ts`). It refuses only the `backups/` and `transfers/` prefixes (`E/transfer/staging/keys.ts` `PRIVATE_STORAGE_PREFIXES`). Non-image types are served `Content-Disposition: attachment` with a sandbox CSP. Plugin uploads also appear in the admin Media Library.
- **NOT SUPPORTED:** private or hidden media, signed or expiring download URLs, direct `Storage` access from `ctx`.
- **Workarounds for private files (form uploads, digital products):**
  1. *Preferred:* a dedicated R2 bucket binding (for example `FORMS_PRIVATE`) that the site author adds to `wrangler.jsonc`. The native plugin reads it through `import { env } from "cloudflare:workers"`, the pattern used by `CF/plugins/cloudflare-email.ts`. Downloads are served by an injected Astro endpoint that checks a plugin-issued HMAC token and streams the R2 object.
  2. *Fallback:* `ctx.media.upload` with unguessable keys, accepting that the files are public-by-URL and visible in the Media Library. This is the official forms plugin's choice (`GH:forms/handlers/submit.ts`).
- **Reading bytes back:** `ctx.media.readBytes(id, { maxBytes ≤ 16 MiB })` (`media:bytes:read`).

---

## 7. Users and auth

- **`ctx.users`** (`users:read`): `get(id)`, `getByEmail(email)`, `list({ role?, limit?, cursor? })` → `{ id, email, name, role, createdAt }` (`E/plugins/context.ts` L1468). Read-only.
- **NOT SUPPORTED for plugins:** creating or updating users, sessions, passkeys, API tokens or roles. Self-signup only works for email domains on the admin allowlist (`AUTH/signup.ts` `canSignup`); otherwise accounts come from admin invites.
- **Current visitor:**
  - Private plugin routes get `ctx.user`.
  - Public plugin routes never do.
  - Astro pages get `Astro.locals.user` through soft session auth.
- **Login methods:** passkeys, magic link, and OAuth providers (`E/astro/routes/api/auth/*`). These are for CMS users, not for store customers.
- **API tokens:** Bearer tokens work on private plugin routes when they carry the `admin` scope. MCP tools need `mcp:tools` or `mcp:tools:<pluginId>` (`GH:docs/.../api-routes.mdx`).
- **Implication:** customers (buyers, licensees, portal users) must be a plugin-owned identity stored in plugin storage: email + magic-link tokens + a session cookie set by an injected Astro page. Do not create EmDash users.

---

## 8. Content access

- `ctx.content.create(collection, data, { locale?, translationOf? })` works on **existing** collections and always creates a **draft** (`E/database/repositories/content.ts` default `status = "draft"`). `update` is draft-aware. `delete` trashes the entry.
- Publishing requires `content:publish`: `getVersioned()` returns `_rev`, then `publish(collection, id, { _rev })`.
- `list(collection, { where: { status?, locale?, fieldFilters? }, orderBy, limit, cursor })` can only filter on custom fields marked **indexed**.
- **NOT SUPPORTED:** creating or altering collections and fields (there is only `schema:read`). The site author has to add the collection, through a seed or the admin.
- The `seo` key in write input goes to the SEO panel when the collection has SEO enabled.

---

## 9. Email (`E/plugins/types.ts` L1158–1230, `E/plugins/email.ts`)

```ts
await ctx.email?.send({ to: "a@x.com", cc?: string[], replyTo?: string, subject: string, text: string /* required */, html?: string });
```

- **Pipeline:** `email:beforeSend` (other plugins can rewrite or cancel the message) → the exclusive `email:deliver` provider → `email:afterSend`.
- **Recursion:** a send triggered from inside an email hook throws `EmailRecursionError`.
- **No provider selected:** `ctx.email` is `undefined` even with `email:send`.
- **Dev:** a console provider stores emails at `/_emdash/api/dev/emails` (`E/plugins/email-console.ts`).
- **From address:** comes from the provider config. For example, `cloudflareEmail({ from, replyTo })` uses the `send_email` binding (`CF/plugins/cloudflare-email.ts`).
- **NOT SUPPORTED:** a per-message `from`, `bcc`, attachments, custom headers, or multiple `to` addresses.
- **Workarounds:**
  - Send one message per recipient, or use `cc`.
  - Use `replyTo` for the submitter address.
  - Link to attachments instead of attaching them.
  - When a feature truly needs attachments or a custom From, call a transactional API (Resend, Postmark, SES) directly through `ctx.http` with a secret API key setting, and use `ctx.email` as the default path.
  - Registering our own `email:deliver` provider is possible (`hooks.email-transport:register`), but it is exclusive and would take over all site mail.

---

## 10. HTTP (`E/plugins/context.ts` L1132–1337, `E/plugins/http-wire.ts`, `E/security/ssrf.ts`)

- `ctx.http.fetch(url, init)` returns a **buffered** `Response`. Request and response bodies are each capped at **8 MiB**.
- `redirect: "manual"`. Up to 5 redirect hops are followed, each one re-checked against `allowedHosts` and SSRF rules, with credential headers stripped on cross-origin hops.
- **SSRF:** private, loopback and metadata addresses are blocked after a DNS resolution (Cloudflare DoH by default), which costs an extra subrequest.
- **`network:request`** with an empty `allowedHosts` blocks everything. `network:request:unrestricted` allows any public host.
- **No built-in timeout.** Pass `signal: AbortSignal.timeout(ms)`; `init` is spread through, so the signal survives.
- Native code can also call the global `fetch()` directly. Don't, so the capability declarations stay honest.

---

## 11. Admin extension points

- **How it loads:** `adminEntry` modules are statically imported into `virtual:emdash/admin-registry` → `pluginAdmins[pluginId]` (`E/astro/integration/virtual-modules.ts` `generateAdminRegistryModule`). The module may export:
  - `pages: Record<path, Component>`
  - `widgets: Record<id, Component>`
  - `fields: Record<widgetName, Component>`
  - `contentEditorPanels` (`ADM` L11039)
  - `contentListColumns` (`ADM` L33110)
- **Pages:**
  - Route: `/_emdash/admin/plugins/<id>/<splat>`.
  - Components get **no props** (`ADM` L76966–76979).
  - Paths are matched exactly, with trailing-slash tolerance; `/` falls back to the first page (`ADM` L224).
  - **No params:** use `?query` strings (`cf/src/admin/navigation.tsx` already does this, with `history.pushState`).
  - **Sidebar:** only pages listed in `admin.pages` appear there. Labels go through `i18n._(label)`, so a string without a catalog entry renders as-is (`ADM` L40298).
- **Sidebar icons:** any **Phosphor** icon name in kebab-case, converted to PascalCase and lazy-loaded. Fast-path names: `settings, gear, chart, chart-line, dashboard, history, image, award, trophy, grid, crop, book, plug, code, file, document, users, database, list, calendar, bell, folder, star, tag, link, search, palette, upload`. Unknown names fall back to the plugin icon (`ADM` L3454–3510).
- **Dashboard widgets:** `admin.widgets: [{ id, title?, size: "full" | "half" | "third" }]`.
- **`settingsSchema` field types:** `string {multiline?}`, `number {min, max}`, `boolean`, `select {options}`, `secret`, `url`, `email` (`E/plugins/types.ts` L2006–2068). It renders an auto-generated form at `/_emdash/admin/plugins-manager/<id>/settings`. There are no conditional fields, repeaters or groups; use a React page for anything richer.
- **`portableTextBlocks`:** `{ type, label, icon?, description?, placeholder?, category?, fields?: BlockKitElement[] }`.
  - **`type` is global** across plugins, so namespace it (for example `core-form`).
  - Block icons: only `video, code, link, link-external, form`; anything else shows a cube (`ADM` L23850).
  - Block Kit elements (`BLK`): `text_input, number_input, select {optionsRoute?}, toggle, secret_input, checkbox, date_input, combobox, radio, repeater (text/number/select/toggle sub-fields), media_picker, button`.
  - **`optionsRoute` contract:** the admin POSTs `{}` and expects `data.items: [{ id, name }]` (`ADM` L28212–28246).
- **`fieldWidgets`:** `{ name, label, fieldTypes[], elements? }`. A trusted plugin exports React `fields[name]`. A schema field selects it with `widget: "pluginId:name"`. There are **no new field types**, only widgets for existing types (`E/plugins/types.ts` L2104–2118).
- **`editorPanels` / `editorActions`:** Block Kit panels and buttons in the content editor, backed by private POST-JSON routes (`define-plugin.ts`).
- **Available libraries:** the admin bundles React 19, `@cloudflare/kumo` 2.6, `@phosphor-icons/react`, `@tanstack/react-query`/`react-router`, and `@lingui/*`. Plugins must declare these as **peer dependencies** to avoid duplicates (`GH:docs/plugins/creating-native-plugins/distributing.mdx`).
- **Styling:** admin CSS is a precompiled Tailwind v4 build (`dist/styles.css`). Only classes the admin already uses exist, so ship plugin styles yourself (as `cf/src/admin/styles.tsx` does).
- **Admin CSP in production** (`E/astro/middleware/csp.ts`): `script-src 'self' 'unsafe-inline'`, `connect-src 'self'` (+ registry/storage), `img-src 'self' https: data: blob:`, `frame-src 'self' https:`. No third-party XHR or CDN scripts from admin pages.

---

## 12. Front-end integration

- **`componentsEntry`** must export `blockComponents: Record<ptType, AstroComponent>`. They are merged into `<PortableText>` (EmDash defaults < plugin < site overrides) (`E/components/PortableText.astro`, `generateBlockComponentsModule`). The component receives `node` (the block's values).
- **Inside Astro components:** call public routes through `getPublicPluginApiRouteHandler(Astro.locals)`, or the trusted `Astro.locals.emdash.handlePluginApiRoute`. Astro `<script>`/`<style>` in the component are bundled by the site build.
- **Every page:** `page:fragments` (native plus capability) can add scripts or styles (`html` with `<link rel=stylesheet>`) to `head`, `body:start` or `body:end`, conditionally on `page.content`/`pageType`. Fragments run on every rendered page, so keep the handler cheap.
- **NOT SUPPORTED:** Portable Text marks, annotations or inline objects from plugins (only block-level `portableTextBlocks`), and theme template overrides.

---

## 13. Secrets and settings (`E/plugins/settings.ts`, `E/config/secrets.ts`)

- `ctx.settings.get/set/getVersioned/compareAndSet/delete/list`, stored as options under the plugin prefix (KV alias `settings:*`).
- **Encryption:**
  - Fields declared `type: "secret"` are encrypted with AES-GCM (key id + IV, with plugin id and key as AAD) using **`EMDASH_ENCRYPTION_KEY`**. Writing a secret without that env var throws `PLUGIN_SETTING_ENCRYPTION_KEY_MISSING`.
  - Secret values are automatically redacted from `ctx.log` output.
  - For dynamic secrets that aren't in the schema (per-form webhook signing keys, per-gateway credentials), `encryptPluginSetting`/`decodePluginSettingValue` are exported from `emdash` (`E/index.ts` L315–320).
- **Per-site config** = these settings (one site per runtime). Native `options` on the descriptor are build-time JSON.

---

## 14. Registry and publishing

- **Native (our case):** an npm package with a server entry (`createPlugin` + descriptor factory) plus source entrypoints `./admin` and `./astro`. Those must ship as source so the host's Vite and Astro build can compile them. Keep the package version, descriptor version and `definePlugin` version in sync. Install is `pnpm add` + edit `astro.config.mjs` + redeploy (`GH:docs/plugins/creating-native-plugins/distributing.mdx`).
- **Sandboxed:** `emdash-plugin.jsonc` + the `emdash-plugin` CLI build a signed bundle. It is published as AT Protocol records (`pm.fair.package.*`, `com.emdashcms.*`) and installed from the admin with consent prompts driven by `declaredAccess`. Adding a public route or escalating access re-prompts on update (`PT` `diffDeclaredAccess`, `E/registry/types.ts`, `GH:docs/.../api-routes.mdx` L144–146).
  - Slug rule: `/^[a-z][a-z0-9_-]*$/`, at most 64 characters.
  - Version: semver without `+build`.
- A native plugin **cannot** be published to the registry.

---

## 15. Other platform facts for forms, payments, licensing and analytics

- **Webhook receivers (Stripe, PayPal):**
  - Declare a public route with `methods: ["POST"]` and `request: { body: "bytes" or "text", maxBytes }`.
  - `ctx.input` is the exact raw body; native code reads `ctx.request.headers.get("stripe-signature")`.
  - Verify with WebCrypto (`crypto.subtle.importKey("raw", …, { name: "HMAC", hash: "SHA-256" })`).
  - Providers send no `Origin`, so the CSRF check passes.
  - Use `response: "raw"` when a precise status code or body is needed.
- **Idempotency:** `compareAndSet(eventId, null, record)` gives create-only semantics, so a provider event can be processed once. Use `updateIf` guards for state transitions (`status: "pending"` → `"paid"`) and counters (license activations: `where: { activations: { lt: max } }, delta: { activations: { inc: 1 } }`).
- **CORS:** not possible on plugin routes (§4.3–4.4). Use injected Astro endpoints.
- **Crypto:** `crypto.subtle` (AES-GCM, HMAC, SHA-256, Ed25519 on Workers **(platform)**), `crypto.randomUUID()` and `crypto.getRandomValues()` are available. Our plugin and core already use them (`cf/src/routes.ts`, `E/plugins/settings.ts`). gatilab.com runs with `nodejs_compat`, so `node:crypto` and `Buffer` also work in native code (`site/wrangler.jsonc`).
- **Locale and currency:** `Intl.NumberFormat`/`DateTimeFormat` with currencies and time zones work on Workers **(platform)**. `ctx.site.locale` and `getI18nConfig()` (exported) give the site locale(s). There is no money or tax helper in EmDash.
- **Timers:** `setTimeout` works only within the request's lifetime. There are no persistent timers, so use cron (1-minute granularity on gatilab.com).
- **Request geo:** `ctx.requestMeta.geo.country`, useful for tax and VAT hints and analytics (`E/plugins/request-meta.ts`).
- **Logging:** `ctx.log.debug/info/warn/error`, prefixed `[plugin:id]`, with secrets redacted.
- **MCP:** private POST-JSON routes with a `permission` can be exposed as agent tools via `mcp.tools`. An admin must enable them (`define-plugin.ts`, `GH:docs/.../api-routes.mdx`).
- **Background queues:** there is no EmDash queue. Use cron or Cloudflare Queues: the site adds a Queue binding plus a `queue()` handler in `src/worker.ts` that calls `withEmDashRuntime(rt => rt.handlePluginApiRoute("core-forms", "POST", "/jobs/run", req))`, and native code enqueues through `env.QUEUE.send()` (`E/astro/middleware.ts` L310–340).

---

## 16. Implications for the Core Forms port

### 16.1 Hard constraints

1. **Stay native.** Admin React pages, PT blocks with Astro renderers, `page:fragments`, private R2 and Queue bindings all require it.
2. **Every scheduled feature must work at 1-minute granularity, with ≤10 core cron task executions per minute shared site-wide.** This covers retries, async actions, poll closing, license expiry, abandoned-cart and dunning emails, and digest reports. Never create one cron task per submission, order or license.
3. **Recurring cron tasks must be (re)scheduled lazily**, because `plugin:install`/`plugin:activate` don't run for config plugins. Pattern: `ensureCron(ctx)` checks a KV flag `state:cron:v<N>` and calls `ctx.cron.schedule(...)` for each task, which is idempotent because it upserts. Call it from the admin dashboard and stats routes and from the first public submit after a deploy. Also call it in `plugin:activate` for completeness.
4. **Set `cron: { timeout }` explicitly (around 25 s)** and keep each tick's batch small, since each handler call runs sequentially inside `scheduled()`.
5. **Every queried field must be an index**, and each collection's index set decides which admin filters, sorts and exports are possible. Design the indexes up front: adding one later only takes effect after the next scheduler tick in a fresh process. Never rely on `uniqueIndexes` alone.
6. **No OR or substring search.** For admin search (submissions by email or name, orders by customer), store normalized lookup fields (`emailLower`, `nameLower`, `searchKey`) as indexes and use equality or `startsWith`. For anything beyond that, scan with a bound.
7. **No multi-row atomicity on D1.** Model state changes as single-row `updateIf`/`compareAndSet`. Make multi-row flows (order → license → email) idempotent steps driven by a job record, not one transaction.
8. **Keep `IN` lists and `getMany`/`deleteMany` ≤ 50 ids per call.**
9. **No-JS multipart uploads are capped at 1 MiB per file.** Larger uploads need either the JS path (base64 JSON on an undeclared route, as the official plugin does) or an injected Astro upload endpoint that streams to R2.
10. **No Set-Cookie, CORS, HTML or streaming from plugin routes.** Anything a browser visits as a page, or that needs cookies or CORS, goes through the companion integration.
11. **Email has no attachments, From, BCC or multi-recipient `to`.** Core Forms features that depend on these (PDF receipts as attachments, custom From per form) need a direct provider API path or a link-based redesign.
12. **Public submit routes never see the logged-in user.** "Logged-in user" form features (prefill, `user_id` on the submission, restrict-to-members) need the form to render through an Astro component that resolves `Astro.locals.user` server-side and passes a signed, short-lived token, or submits through an injected endpoint that forwards `locals.user` to `handlePluginApiRoute`.
13. **Admin pages can't call external APIs from the browser** (CSP). Gateway account checks, license server pings and similar calls must go through our private routes using `ctx.http`.

### 16.2 Recommended patterns

- **Durable job queue (retries, async actions, webhooks out, emails).**
  - A `jobs` storage collection with indexes `["status", "runAt"]`, `["kind", "status"]` and `"refId"`.
  - Producers `put` a job (id = deterministic idempotency key), then call `after(() => runJob(id))` for immediate best-effort execution.
  - A single recurring cron task `drain` (`* * * * *`) claims due jobs: `query({ where: { status: "pending", runAt: { lte: now } }, orderBy: { runAt: "asc" }, limit: 25 })`, then for each one `updateIf(id, { where: { status: "pending" }, set: { status: "running", lockedAt } })`.
  - Run the job. On success set `done`; on failure set `runAt = now + backoff` and `attempts + 1`, and after N attempts set `failed`.
  - Recover stale `running` jobs.
  - Optional upgrade: Cloudflare Queues when the site wires a `queue()` handler.
- **Poll closing, license expiry, subscription renewals.** Store `closesAt`/`expiresAt` as indexed fields. An hourly (or per-minute) recurring task does a range query and transitions rows with `updateIf`. Read paths also check the timestamp, so correctness never depends on the tick.
- **Counters and analytics.** For hot counters (form views, conversions), use per-day rows, `stats:<formId>:<yyyy-mm-dd>`:
  1. Create if absent with `compareAndSet(id, null, zero)`.
  2. Increment with `updateIf(id, { where: {}, delta: { views: { inc: 1 } } })`, a single atomic SQL statement with no CAS retry loop.
  3. Write through `after()` so page responses aren't blocked.

  For high-volume event analytics, consider a Workers Analytics Engine binding through `cloudflare:workers` (native), with D1 rows kept for summaries only.
- **Uploaded form files.**
  - Default: a private R2 bucket (`FORMS_FILES` binding, set up by the site author) through `cloudflare:workers` env. Keys look like `forms/<formId>/<submissionId>/<uuid>-<name>`.
  - Downloads go through an admin-only injected endpoint or a private plugin route (≤8 MiB, raw, `content-disposition: attachment`).
  - Fallback when no binding is present: `ctx.media.upload`, but only for allowed MIME types, and the admin should be told the files are public by URL.
- **Digital product downloads.** Use the private R2 bucket. The plugin issues an HMAC-signed, expiring token (`productId`, `orderId`, `exp`, `maxDownloads`), and an injected Astro endpoint `/download/[token]` verifies it through `handlePluginApiRoute`. The download counter uses `updateIf` with a `downloads: { lt: max }` guard, and the endpoint streams `env.BUCKET.get(key).body`. Plugin routes can't do this because of the 8 MiB buffered limit.
- **Standalone form URLs (`/collect/<slug>/`).** The companion Astro integration `coreFormsSite({ formBase: "/collect" })` injects `[slug].astro`, which renders the `CoreForm` component inside the site layout (an option for the layout component path). If the site author prefers not to use the integration, document the two-line page they can add themselves.
- **Customer portal.** Use plugin-owned customers (a `customers` collection with a unique index on `emailLower`) and magic-link login: a public plugin route creates a token and emails a link. An injected `/account/login/verify` page exchanges the token through `handlePluginApiRoute`, then sets an HttpOnly session cookie (the Astro page can do this). Injected `/account/*` pages read that cookie and call plugin routes, passing a verified customer id. Never reuse EmDash users.
- **License API.**
  - Server-to-server clients (WordPress sites) can call public plugin routes directly: `/_emdash/api/plugins/core-forms/license/activate|deactivate|check|version`, with `response: "raw"` for an exact JSON shape.
  - For a legacy-compatible path (for example `/wp-json/core-forms/v1/...`) or browser CORS, the companion integration injects an endpoint that forwards and adds CORS headers.
  - Protect against abuse with a hashed-IP rate counter and per-key throttles.
- **Payment webhooks.** Public route, `request: { body: "bytes", maxBytes: 1 MiB }`. Verify the signature first, record the event with `compareAndSet(eventId, null, …)`, enqueue a job, and return 200 fast.
- **Settings.** Put gateway keys and webhook secrets in `settingsSchema` as `secret`, which requires `EMDASH_ENCRYPTION_KEY` to be set on the site. Per-form secrets use `encryptPluginSetting`. Editors' access to the inbox: give data routes `permission: "plugins:read"` (Editor+) and keep config routes on the default `plugins:manage`.

### 16.3 What the site author must add (document in the install guide)

1. `EMDASH_ENCRYPTION_KEY` secret (for secret settings).
2. A selected email provider, for example `cloudflareEmail({ from })` plus the `send_email` binding.
3. Keep the Cron Trigger and `scheduled: createScheduledHandler()` (gatilab.com already has both).
4. Optional: R2 bucket binding(s) for private files and products. Optional: a Queue binding plus a `queue()` export in `src/worker.ts`.
5. `integrations: [coreFormsSite(...)]` for standalone form pages, the portal, downloads and CORS endpoints.
6. `<EmDashHead>`/`<EmDashBodyEnd>` in layouts if we rely on `page:fragments` (gatilab.com already has them).

### 16.4 Issues spotted in the current `plugins/core-forms` (v0.1.0)

- **`forms/options` returns the wrong shape.** It returns `{ items: [{ value, label }] }`, but the admin's `optionsRoute` consumer reads `items[].id`/`items[].name` (`ADM` L28212–28246). The editor's Form dropdown therefore gets empty labels and values. Return `{ items: [{ id, name }] }`.
- **The Portable Text block type is `"form"`.** Block types are global; rename to `core-form` and keep `form` as a legacy alias in `blockComponents` for existing content.
- **`settings()` reads a `defaultFrom` key** that isn't in `settingsSchema`. `EmailMessage` has no `from` anyway, so the setting can never take effect.
- **No `cron` hook yet**, so stats keys `stats:blocked:*` grow forever and the `resp:<token>` KV entries (5-minute expiry) are never swept. Add a sweep task once `ensureCron` exists.
- **`submit` uses a declared `form-data` body with `maxBytes: 1_000_000`.** With files enabled, every file part is also capped at 1 MiB, and the total is still about 1 MB.
