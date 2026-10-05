# 06 — Payments, Licensing & Digital Products ("Core Commerce")

Spec for porting the payments and Core Commerce subsystems of Core Forms 4.11.1 (WordPress) to EmDash. All WP paths are relative to `.reference/core-forms-wp/`. `file:N-M` means line range. WP-only commerce integrations are listed in §2.12 and §7.11 but not specified.

---

## 0. Summary

- **Payments** (`src/payments/`, 2,213 lines) are a property of a *form*. A form with `payment_enabled` saves the submission, freezes a purchase snapshot, creates a hosted checkout (Stripe Checkout Session, PayPal Order, Razorpay Payment Link, Polar Checkout) or a Stripe PaymentIntent (inline), then waits for a **signed webhook**. Only the webhook can set `paid`. A durable outbox (`cf_fulfillment`) runs `cf_form_success`, every form action, and `cf_payment_completed` after payment. Refunds go through a second outbox (`cf_payment_reversals`).
- **One-time charges only.** There's no tax, no coupons, no shipping, no provider-side recurring billing, and no quantity pricing beyond license quantity. "Subscriptions" are local license terms (§3.6).
- **Core Commerce** (`src/licensing/`, 5,374 lines) adds 10 custom tables: products, plans, orders, order items, licenses, activations, packages, subscriptions, downloads, and events. It also provides a native checkout that needs no form post, an EDD Software Licensing-compatible public license/update API, a public storefront REST API, an admin REST API with WP Abilities/MCP, a magic-link customer portal, 8 shortcodes and 8 blocks, and theme-rendered "virtual" product URLs. There's no CPT.
- **Hard compatibility surface** (must not change): the license API URLs, parameters and response shapes (§3.9); package-link and access-token HMAC formats (§5.3); webhook URLs registered at providers; numeric product, license and submission IDs (§7.1).

---

## 1. Source map

| File | Lines | Role |
|---|---|---|
| `src/payments/class-payments.php` | 360 | Orchestrator: form defaults, product picker, webhook route, return handler, status CAS, payment-attempt recording |
| `src/payments/class-gateway.php` | 339 | Abstract gateway: credentials, test/live, amount/currency/description resolution, return-token HMAC |
| `src/payments/class-currency-gateway-router.php` | 133 | Currency → ordered gateway list |
| `src/payments/class-stripe.php` | 319 | Checkout Sessions (hosted) + PaymentIntents (inline) |
| `src/payments/class-paypal.php` | 326 | Orders v2 + capture + verify-webhook-signature API |
| `src/payments/class-razorpay.php` | 208 | Payment Links |
| `src/payments/class-polar.php` | 264 | Polar Checkouts + Standard Webhooks |
| `src/payments/class-fluentcart.php` | 472 | **WP-only** (in-process FluentCart hand-off) |
| `src/workflows/class-fulfillment.php` | 202 | Paid/refund outbox (`cf_fulfillment`, `cf_payment_reversals`) |
| `src/class-forms.php:998-1096` | — | Payment branch of the submission pipeline |
| `src/functions.php` | — | Settings defaults `461-491`, merge `561-576`, `CF_PAYMENT_*` tokens `793-833`, schemas `2305-2333` and `3452-3612`, migrations `1545-1908` |
| `src/licensing/class-license-commerce.php` | 1305 | Fulfillment, renewals, refunds, native checkout, shortcodes, customer portal handlers, maintenance |
| `src/licensing/class-license-server.php` | 191 | Public EDD-compatible license/update API, signed package download |
| `src/licensing/class-license-api.php` | 590 | Permissioned service layer (admin REST + Abilities) |
| `src/licensing/class-license-rest-api.php` | 91 | `/core-forms/v1/commerce/*` routes |
| `src/licensing/class-storefront-rest-api.php` | 417 | Public `/core-forms/v1/storefront*` |
| `src/licensing/class-license-admin.php` | 1089 | Admin workspace (WP screens), package ZIP validation, money formatting |
| `src/licensing/class-license-list-table.php` | 415 | `WP_List_Table` for products, licenses, orders and customers |
| `src/licensing/class-product-provisioner.php` | 376 | Sample catalog, generated checkout/renewal forms and pages |
| `src/licensing/class-product-options.php` | 76 | Product types and `details` JSON |
| `src/licensing/class-virtual-product.php` | 71 | `/?product=slug` theme-rendered product page |
| `src/licensing/class-customer-portal.php` | 114 | Portal tabs, profile save, owner-scoped order lookup |
| `src/licensing/class-license-blocks.php` | 119 | 8 dynamic blocks |
| `src/licensing/class-license-key-policy.php` | 52 | Key generation policy |
| `src/licensing/class-license-abilities.php` | 81 | WP 6.9 Abilities (MCP) |
| `src/licensing/class-commerce-compatibility.php` | 113 | **Mostly WP-only** (foreign checkout detection, GT Performance cache policy) |
| `src/licensing/class-content-picker.php` | 43 | Admin AJAX search for content connections |
| `src/licensing/class-product-gallery.php` | 24 | Gallery images from `details.gallery_ids` |
| `views/tab-payment.php` (387), `views/license-dashboard.php`, `views/license-portal-licenses.php`, `views/virtual-product.php` | — | Form Payment tab, portal, virtual product template |
| `assets/js/inline-payments.js` (111), `assets/js/license-frontend.js` | — | Stripe Payment Element mount; portal reveal, copy, filter and print |
| Docs | — | `docs/payments/overview.md`, `docs/licensing/{commerce,license-keys-auto-updates,customers,product-pages}.md` |

Bootstrap: `core-forms.php:246-269` (LicenseApi, Abilities, REST controllers), `core-forms.php:282-309` (Fulfillment hook, gateway registration, `cf_payments_orchestrator` filter). `LicenseServer::hook()` wires `LicenseCommerce`, which wires Admin, Portal, ContentPicker, VirtualProduct and Blocks (`class-license-server.php:17-23`, `class-license-commerce.php:27-65`).

---

## 2. Payments

### 2.1 Global settings: `cf_settings['payments']` (plain `wp_options`, autoloaded)

Defaults are at `src/functions.php:463-491`. Merge logic is at `:561-576`, which deep-merges each provider sub-array.

| Key | Default | Notes |
|---|---|---|
| `mode` | `'test'` | Global for **all** gateways. Must be `test` or `live` (`class-admin.php:288-289`) |
| `currency_gateways` | `{USD:[stripe,paypal,polar], INR:[razorpay]}` | `CurrencyGatewayRouter::default_routes()` `:21-26`. Order matters: the first entry is the default |
| `stripe` | `publishable_key_test, secret_key_test, publishable_key_live, secret_key_live, webhook_secret` | |
| `paypal` | `client_id_test, client_secret_test, client_id_live, client_secret_live, webhook_id` | |
| `razorpay` | `key_id_test, key_secret_test, key_id_live, key_secret_live, webhook_secret` | |
| `polar` | `access_token_test, access_token_live, webhook_secret` | |

- **Credential resolution:** `Gateway::credential($base)` reads `{$base}_test` or `{$base}_live` according to `mode` (`class-gateway.php:78-83`). `shared_credential()` reads the unsuffixed key (`:88-92`). Webhook secrets are **not** split by mode, but Stripe, Razorpay and Polar issue mode-specific secrets. Switching mode therefore needs a re-paste.
- **Saving:** each leaf goes through `sanitize_text_field`. Saves merge with the stored settings, so providers that weren't rendered keep their keys (`class-admin.php:283-306`).
- **Settings-form route editing:** the form posts `currency_routes_present` and `currency_gateway_rows[]` (`{currency, gateways[], primary}`), which `sanitize_rows` normalizes (`router:67-90`).

### 2.2 Per-form settings (`_cf_settings` post meta)

These are registered via the `cf_form_default_settings` filter (`class-payments.php:58-73`). The UI is `views/tab-payment.php` and the sanitizer is `class-admin.php:1322-1359`.

| Key | Default | Semantics |
|---|---|---|
| `payment_enabled` | `false` | Turns the form into a payment form. Requires `save_submissions` (`class-forms.php:1011-1020`) |
| `payment_provider` | `''` | `stripe`, `paypal`, `razorpay`, `polar` or `fluentcart` |
| `payment_flow` | `'hosted'` | `hosted` or `inline`. `inline` only works with Stripe |
| `payment_amount` | `''` | A major-unit literal (`19.99`) **or** a token (`[total]`, `[AMOUNT]`, `[TIER]`). Resolved by `cf_replace_data_variables` |
| `payment_currency` | `'USD'` | Saved uppercase, letters only, three characters (`class-admin.php:1357-1359`). Invalid values fall back to `USD` (`class-gateway.php:196-199`) |
| `payment_description` | `''` | Supports tokens. Falls back to the form title (Stripe uses the product description first) |
| `payment_success_redirect` | `''` | `esc_url_raw`. Tokens are replaced at return (`class-payments.php:157-161`) |
| `payment_required` | `true` | Registered but **never read** (dead key) |
| `payment_products` | `''` | **Stripe only (UI).** One `label\|amount\|description` per line (`class-gateway.php:114-122`) |
| `payment_polar_product_id` | *(not registered, no UI)* | Read by Polar (`class-polar.php:72`). When set, the checkout uses a Polar product instead of an ad-hoc amount |
| `fluentcart_variation_id`, `fluentcart_quantity`, `fluentcart_quantity_field` | `'', 1, ''` | WP-only |

**Product picker** (`class-payments.php:88-95`): this applies only when the provider is `stripe` and `payment_products` parses to at least one entry.
- A required `<select name="cf_payment_product">` is prepended to the form markup. Option values are the **indexes** into the product list.
- `cf_payment_product` is added to the field allowlist (`:83-86`).
- The server resolves the amount and description from the index (`class-gateway.php:103-111`, `:124-129`), so the browser never posts a price.

**Amount sources:**
- a fixed literal
- a field token
- a calculated field: FieldCalculator recomputes calculations server-side after the allowlist and discards the posted total (`class-forms.php:812-823`, fix in 4.9.0)
- the product picker
- for native checkout and generated forms, the plan's `price_minor`, converted to a major string

There are **no** tax, discount or coupon fields anywhere in payments or commerce.

**Form markup attributes:** `data-cf-payment-provider` and `data-cf-payment-flow` (`class-payments.php:75-81`). Stripe.js (`https://js.stripe.com/v3/`) and `inline-payments.js` are enqueued only for an inline Stripe form (`class-asset-requirements.php:53-66, 114-115`, `class-forms.php:110-111`).

### 2.3 Money maths

- **`parse_decimal_amount()`** (`class-gateway.php:147-191`):
  - Strips everything except `[0-9.,-]`.
  - If both `.` and `,` are present, the last one is the decimal separator.
  - A single `,` or `.` followed by **exactly 3 digits** is a thousands separator, so `"1.000"` becomes 1000 and `"1,000"` becomes 1000.
  - Multiple identical separators are thousands separators.
  - Otherwise `,` is a decimal separator (`"1,5"` becomes 1.5).
- **Minor units:** `round(major × multiplier)`. The multiplier is 1 for zero-decimal currencies and 100 otherwise (`:225-228`). The gateway zero-decimal list is `JPY KRW VND CLP PYG XAF XOF BIF DJF GNF KMF MGA RWF UGX VUV XPF`.
- **Inconsistencies to fix in the port** (use one shared table):
  - `LicenseApi::major_to_minor` (`class-license-api.php:556-560`), `LicenseAdmin::format_money` (`class-license-admin.php:1054-1059`) and `ProductProvisioner::major_amount` (`class-product-provisioner.php:136-144`) leave out **MGA**.
  - The admin plan form stores `round(price*100)` regardless of currency (`class-license-admin.php:878`), so a JPY plan of ¥1000 is stored as 100000.
  - Three-decimal currencies (BHD, KWD, JOD, OMR, TND) are treated as 2-decimal.
  - PayPal formats every currency with 2 decimals (`class-paypal.php:53`). PayPal rejects decimals for JPY, HUF and TWD.
- **Display:** `format_money` returns `"{CUR} {number_format_i18n}"`. There are no currency glyphs.

### 2.4 Currency → gateway routing (`class-currency-gateway-router.php`)

- `KNOWN_GATEWAYS = [stripe, paypal, razorpay, polar, fluentcart]` (`:18`), filterable with `cf_payment_currency_gateway_keys`.
- `sanitize_map` (`:35-60`) normalizes currencies to `[A-Z]{3}` and gateway keys to `[a-z0-9_-]`, keeps only known keys, de-duplicates, and sorts by currency (`ksort`).
- `routes()` (`:93-102`) uses the stored map, or the defaults if the key is **absent**. An empty stored map means "no routes".
- `gateways_for_currency` (`:105-109`) is filterable with `cf_payment_gateways_for_currency`. `primary_gateway` is element 0.
- **`is_gateway_allowed`** (`:120-123`): an *unmapped* currency allows any gateway (backward compatibility). A mapped currency allows only the listed gateways.
  - The form pipeline enforces this (`class-forms.php:1041-1050`).
  - Native checkout additionally **requires** `has_route` (`class-license-commerce.php:990`).
- The admin form tab disables gateways that aren't configured or aren't routed for the form's currency (`views/tab-payment.php:100-115`).

### 2.5 Submission pipeline integration (`src/class-forms.php:998-1096`)

This runs after validation, spam checks and the save. It applies only when `$error_code === ''` and `payment_enabled` is set.

1. **No saved row** (`$submission->id` empty) → respond with an error and fire `cf_form_response(..., 'payment_unsaved')`.
2. **Gateway missing or not `is_configured()`** → `'payment_misconfigured'`, and the submission is refused rather than treated as free.
3. **`!is_gateway_allowed(currency, provider)`** → `'payment_currency_gateway_mismatch'`.
4. **Stripe with `inline` flow:**
   - `create_payment_intent` → `mark_payment_status(pending_payment, 'stripe')` → retire the draft.
   - Response: `{message:{type:'success', text:'Enter your payment details to finish.'}, payment:{provider:'stripe', flow:'inline', mode:'test'|'live', payment_id, client_secret, publishable_key, return_url}}`.
5. **Hosted flow:**
   - `create_checkout` → `mark_payment_status(pending_payment, provider)` → retire the draft → `cf_form_response`.
   - Response: `{message:{type:'success', text:'Redirecting to secure checkout…'}, redirect_url:<provider URL>, payment:{provider, mode}}`.
6. **Any exception** → `mark_payment_status(payment_failed)`, `error_log`, `cf_form_response(...,'payment_failed')`, and a generic error. Provider error text is never leaked.
7. On a payment form, `cf_form_success` and actions do **not** run at submit time. They run from the outbox after payment.

The headless REST submit (`src/rest/class-rest-headless.php:200`) reuses the same pipeline, so it returns `redirect_url` and `payment` the same way.

**Client (`assets/js/inline-payments.js`):**
- Capture-phase `submit` listener on `.cf-form[data-cf-payment-provider="stripe"][data-cf-payment-flow="inline"]`.
- POSTs `FormData` to `cf_js_vars.ajax_url`.
- Requires `data.payment.flow==='inline'`.
- Mounts `stripe.elements({clientSecret}).create('payment')` with a "Pay securely" button.
- Calls `stripe.confirmPayment({elements, confirmParams:{return_url}})`.
- Hosted redirects use the normal forms JS (`redirect_url` → `window.location`).

### 2.6 Payment state on submissions

**Columns.** These were added to `wp_cf_submissions` by the 4.1.0 migration (`functions.php:1549-1575`). The fresh schema is at `:2320-2328`.

| Column | Type |
|---|---|
| `payment_status` | `VARCHAR(30) NULL` |
| `payment_provider` | `VARCHAR(20) NULL` |
| `payment_id` | `VARCHAR(190) NULL` |
| `payment_amount` | `BIGINT UNSIGNED NULL` (minor units) |
| `payment_currency` | `VARCHAR(8) NULL` |

Index: `idx_payment_id(payment_provider, payment_id)`.

**Statuses:** `pending_payment`, `paid`, `payment_failed`, `refunded` (`class-submission.php:40-52`).
- Every transition writes both `status` **and** `payment_status`.
- `is_paid()` and `is_awaiting_payment()` read `payment_status` and fall back to `status` for old rows (`:97-113`). This lets inbox status changes (read, archived) keep payment eligibility.

**Transitions:**
- `record_payment_attempt()` (`class-payments.php:330-339`) runs inside `create_checkout` **before** returning the URL. It calls `Fulfillment::prepare` (§2.9), then stores `payment_id` (the provider object ID), `payment_amount` (minor), `payment_currency` (upper) and `payment_provider`.
- `mark_payment_status()` (`:302-327`):
  - Takes lock `payment:{id}` and a transaction.
  - **Never** downgrades `paid` or `refunded` to `pending_payment` or `payment_failed`.
  - Moving to `refunded` inserts a reversal row in the same transaction, then runs `Fulfillment::run_refund` after commit.
- `try_mark_paid()` (`:250-280`):
  1. Takes lock `payment:{id}`.
  2. Reloads the row. If `refunded`, returns false.
  3. If already `paid` with no outbox row (pre-4.11 legacy), returns false.
  4. Calls `Fulfillment::prepare` if missing.
  5. In one transaction, runs `UPDATE … SET status='paid', payment_status='paid' WHERE id=? AND (payment_status IS NULL OR payment_status NOT IN ('paid','refunded'))`, then `Fulfillment::ready()` (`awaiting_payment` → `pending`).
  6. Fires `cf_submission_written(id,'payment')` only if rows changed.
- Locks come from `FormDefinition::acquire_lock` (`src/class-form-definition.php:104+`). It uses MySQL `GET_LOCK(name, 0)`, which is non-blocking: a busy lock throws "The operation is busy." On SQLite it falls back to an options-row CAS lease with a 300 s TTL.

**Lifecycle:**

```
(new) → pending_payment ─webhook paid→ paid ─webhook refund→ refunded
           │                                    ▲
           ├─create error / cancel/failure return / webhook failed → payment_failed ─webhook paid→ paid
           └─(stays pending forever if no webhook; no expiry job)
```

**Template tokens** (`functions.php:793-833`) render an empty string when not applicable:
- `CF_PAYMENT_STATUS`, `CF_PAYMENT_PROVIDER`, `CF_PAYMENT_ID`, `CF_PAYMENT_CURRENCY`
- `CF_PAYMENT_AMOUNT`: major units, `number_format(…, 2|0, '.', '')`
- `CF_PAYMENT_AMOUNT_FORMATTED`: `"USD 19.99"`

The EmDash 0.1.0 port currently renders all `CF_PAYMENT_*` tokens empty (`plugins/core-forms/README.md:100`).

### 2.7 Return URL (UX only, never sets `paid`)

`build_return_url` (`class-gateway.php:249-262`):

```
{home_url('/')}?cf_payment_return=1&cf_submission={id}&cf_outcome=success|cancel&cf_issued={unix}&cf_token={hex}
```

- **Token:** `hash_hmac('sha256', "{id}|{form_id}|{outcome}|{issued}", wp_salt('auth'))` (`:275-279`).
- **TTL:** `RETURN_TOKEN_TTL = 7200` s, checked as `abs(now − issued) ≤ 7200` with `hash_equals` (`:288-297`).

`maybe_handle_return` runs on `init` on any front-end URL (`class-payments.php:117-163`):
- `cancel` or `failure` → `payment_failed`, but only if the submission is still `pending_payment`.
- `success` → if `payment_success_redirect` is set, run `wp_safe_redirect(tokens replaced)` (same host only); otherwise **do nothing** and the home page renders. The admin help text says "show the form's normal success message", which isn't implemented.
- Stripe inline: Stripe appends `payment_intent`, `payment_intent_client_secret` and `redirect_status` to `return_url`. These are ignored.

### 2.8 Webhook receiver

- **Route:** `POST /wp-json/cf/v1/payments/(?P<provider>[a-z0-9_-]+)/webhook`, `permission_callback __return_true` (`class-payments.php:97-106`).
- The **namespace is `cf/v1`**, not `core-forms/v1`.
- Headers are lowercased and `_` becomes `-` (`:205-211`). The gateway receives the **raw body**.

`handle_webhook` (`:168-200`):

| Condition | HTTP | Body |
|---|---|---|
| Unknown provider | 404 | `{error:'unknown_provider'}` |
| `verify_webhook` throws (e.g. Stripe reconciliation GET failed) | 503 | `{error:'payment_reconciliation_unavailable'}` |
| `verify_webhook` returns null | **401** | `{error:'invalid_signature'}` |
| No submission with `(payment_provider, payment_id)` | 200 | `{received:true, matched:false}` |
| PayPal `CHECKOUT.ORDER.APPROVED` → `capture_order` throws | 503 | `{error:'capture_unavailable'}` |
| `apply_webhook_event` throws (lock busy, DB) | 503 | `{error:'fulfillment_unavailable'}` |
| OK | 200 | `{received:true, matched:true}` |

**Bug:** `normalize_event()` returns null for *validly signed but unhandled* event types, so they get **401**. Providers then retry, and Stripe may disable the endpoint. The port should return 200 `{received:true, ignored:true}` after verification, and the divergence should be documented.

`apply_webhook_event` (`:225-241`):
- `paid` → `try_mark_paid` and **always** `Fulfillment::run(id)` synchronously within the webhook request.
- `failed` → `payment_failed`.
- `refunded` → `refunded`.
- `pending` → no-op.

No event-ID dedupe store exists. Idempotency comes from the status CAS, the outbox state and the order `source_key`.

There's **no amount check on paid events** except for PayPal capture (§2.10.3). Stripe, Razorpay and Polar trust the object created server-side.

### 2.9 Fulfillment outbox (`src/workflows/class-fulfillment.php`)

**Tables** (`:17-41`), both created in migration 4.11.0 (`functions.php:1910-1919`):

```sql
cf_fulfillment(
  submission_id BIGINT UNSIGNED PK,
  form_definition LONGTEXT NULL,          -- frozen form snapshot JSON
  execution_actions LONGTEXT NULL,        -- admin "refresh actions" override
  status VARCHAR(30) NOT NULL DEFAULT 'awaiting_payment',
  lease CHAR(36) NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  created_at DATETIME NOT NULL,
  modified_at DATETIME NOT NULL,
  next_attempt_at DATETIME NULL,
  INDEX ready(status, next_attempt_at)
)

cf_payment_reversals(
  submission_id PK,
  status DEFAULT 'pending',
  lease, attempts, last_error, created_at, modified_at, next_attempt_at,
  INDEX ready(status, next_attempt_at)
)
```

**`prepare(submission, form)`** (`:58-82`) is called before contacting the provider:
- `INSERT IGNORE` of `definition(form)` = `{id, title, slug, markup, settings, messages, schema}`.
- For each `issue_license` or `renew_license` action, it resolves tokens against the submission and adds `_cf_purchase_terms`:
  - `LicenseCommerce::purchase_terms()` gives a map `"{product_id}:{plan_id}" → {product: row, plan: row}`. It throws if the product or plan is inactive, which blocks checkout.
  - `renewal_terms()` (§3.7) throws on a key or email mismatch.
- **Purchased terms never change afterwards:** "Never reread today's catalog for an existing purchase".

**Statuses:**

```
awaiting_payment →(ready)→ pending → processing(lease uuid, attempts++)
   → completed | pending(retry +300 s) | failed(after 10 attempts) | uncertain
```

- **`process()`** (`:94-100`) is hooked to `cf_process_queued_actions`, which is WP cron `cf_every_five_minutes` = 300 s (`class-action-queue.php:51-62`).
  - It picks up to 10 rows per table where `status='pending' AND next_attempt_at<=now`, or rows stuck in `processing` for more than 600 s.
- **`work(id, refund)`** (`:140-196`):
  1. Takes lock `payment:{id}`.
  2. Claims the row with a CAS update.
  3. Requires `submission.payment_status` = `paid` (or `refunded` for refunds).
  4. Rebuilds the `Form` from the snapshot, applying the `execution_actions` override if present.
  5. **Paid path**, in this order:
     - the native action `cf_form_success` (`do_action('cf_form_success', $submission, $form)`)
     - each snapshot action whose `conditions` pass, via `ActionRunner::dispatch`
     - the native action `cf_payment_completed`
  6. **Refund path:** the native action `cf_payment_refunded` (`do_action('cf_payment_refunded', $submission)`).
  7. Throws inside hooks map to `DeliveryUncertain` (status `uncertain`). Result status `unverified` counts as success.
- **`retry(id, refund, refresh_actions)`** (`:104-139`) is the admin recovery path (`src/workflows/class-recovery.php`). It resets to `pending` with attempts=0 only if the payment state matches.
  - `refresh_actions` re-maps non-license actions to the current form's actions by `_cf_action_id`.
  - License actions always keep their purchased terms.

### 2.10 Gateways

All gateways call `Fulfillment::prepare` first, reject `amount <= 0`, use `wp_remote_*` with a 15 s timeout (20 s for PayPal capture), and pull the customer email from the **first** submission value that passes `FILTER_VALIDATE_EMAIL` (`class-gateway.php:209-219`). No SDKs are used.

#### 2.10.1 Stripe hosted (`class-stripe.php:82-153`)

- **Configured** when a secret key is set for the current mode.
- **Request:** `POST https://api.stripe.com/v1/checkout/sessions`, `Authorization: Bearer {secret}`, form-encoded. **No `Idempotency-Key`** (the docs claim one) and **no `Stripe-Version` pin**.
- **Params:**

  | Param | Value |
  |---|---|
  | `mode` | `payment` |
  | `success_url` | `build_return_url(success)` |
  | `cancel_url` | `build_return_url(cancel)` |
  | `client_reference_id` | `{sid}` |
  | `metadata[cf_submission]`, `metadata[cf_form_id]` | submission and form IDs |
  | `payment_intent_data[metadata][cf_submission]`, `payment_intent_data[metadata][cf_form_id]` | submission and form IDs |
  | `line_items[0][quantity]` | `1` |
  | `line_items[0][price_data][currency]` | lowercase currency |
  | `line_items[0][price_data][unit_amount]` | minor units |
  | `line_items[0][price_data][product_data][name]` | description, or `'Form payment'` |
  | `customer_email` | when an email was found |

- **Stored `payment_id`:** session `id` (`cs_…`). **Redirect:** `body.url`.

#### 2.10.2 Stripe inline (`class-stripe.php:30-76`)

- **Configured** when both the secret and publishable keys are set.
- **Request:** `POST /v1/payment_intents`.
  - `Idempotency-Key: sha256("cf-stripe-intent-{sid}")`
  - Params: `amount`, `currency`, `description`, `automatic_payment_methods[enabled]=true`, `metadata[cf_submission]`, `metadata[cf_form_id]`, and `receipt_email` when an email was found.
- **Stored `payment_id`:** `pi_…`.
- **Returns** `{payment_id, client_secret, publishable_key, return_url}`.

**Stripe webhook** (`:162-227`):
- **Header** `Stripe-Signature: t=…,v1=…[,v1=…]`.
- **Signature:** `HMAC-SHA256(webhook_secret, "{t}.{rawBody}")` in hex, compared against any `v1`. Tolerance is **300 s**. A missing secret returns null (401).
- **Legacy refund reconciliation:** for `charge.refunded` without `metadata.cf_submission` and with `payment_intent` matching `^pi_[A-Za-z0-9]+$`, it calls `GET /v1/checkout/sessions?payment_intent={pi}&limit=1` with the secret key and takes `data[0].metadata.cf_submission`. A non-200 throws, which gives 503.
- **Event mapping** (`:233-286`):

  | Event | Status | `payment_id` |
  |---|---|---|
  | `checkout.session.completed` with `payment_status` not in {`paid`, `no_payment_required`} | `pending` | `object.id` |
  | `checkout.session.completed`, `checkout.session.async_payment_succeeded` | `paid` | `object.id` |
  | `checkout.session.expired`, `checkout.session.async_payment_failed` | `failed` | `object.id` |
  | `payment_intent.succeeded` | `paid` | `object.id` (matches inline `pi_`; hosted won't match → 200 unmatched) |
  | `payment_intent.payment_failed`, `payment_intent.canceled` | `failed` | `object.id` |
  | `charge.refunded` | `refunded` | `object.metadata.cf_submission` → `SELECT payment_id FROM cf_submissions WHERE id=? AND payment_provider='stripe'` |

- **Partial refunds:** `charge.refunded` fires on partial refunds too, so a **partial refund is treated as a full refund**.
- **Settings fields** (`:308-317`). Docs say to subscribe to:
  - `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`
  - for inline: `payment_intent.succeeded` and `payment_intent.payment_failed`
  - async events are also handled

#### 2.10.3 PayPal (`class-paypal.php`)

- **API base** (`:32-36`): `https://api-m.sandbox.paypal.com` in test mode, `https://api-m.paypal.com` in live mode.
- **OAuth** (`:278-314`):
  - `POST {base}/v1/oauth2/token`, `Authorization: Basic base64(client_id:client_secret)`, body `grant_type=client_credentials`.
  - Cached in transient `cf_paypal_token_{md5(client_id|sandbox|live)}` for `max(60, expires_in − 60)` s.
- **Create** (`:43-124`): `POST {base}/v2/checkout/orders`, JSON:

  ```json
  {"intent":"CAPTURE",
   "purchase_units":[{"reference_id":"cf_{sid}","description":"<≤127 chars>","amount":{"currency_code":"USD","value":"19.99"},"custom_id":"{sid}"}],
   "application_context":{"return_url":"…success","cancel_url":"…cancel","user_action":"PAY_NOW","brand_name":"<blogname>"}}
  ```

  - The description is `payment_description` or the form title. The product picker isn't used.
  - `application_context` is deprecated by PayPal in favor of `payment_source.paypal.experience_context`.
  - **Stored `payment_id`:** the order `id`. **Redirect:** the `links[rel=approve].href`.
- **Capture** (`:127-148`) is triggered **only** by the `CHECKOUT.ORDER.APPROVED` webhook. The return URL does not capture.
  - `POST {base}/v2/checkout/orders/{id}/capture`, body `{}`, header `PayPal-Request-Id: substr(sha256("cf-capture-{order_id}"),0,36)`.
  - On non-2xx, it proceeds only if `details[0].issue == ORDER_ALREADY_CAPTURED`; then it calls `GET /v2/checkout/orders/{id}`.
  - It requires `purchase_units[0].payments.captures[0].status == COMPLETED`, otherwise it returns null and the event stays `pending`.
  - **The captured amount and currency must equal the submission's `payment_amount` and `payment_currency`**, otherwise it throws, which gives 503.
- **Webhook verification** (`:153-209`):
  - Requires a `webhook_id` and the headers `paypal-transmission-id`, `paypal-transmission-time`, `paypal-transmission-sig`, `paypal-cert-url` and `paypal-auth-algo`.
  - Calls `POST {base}/v1/notifications/verify-webhook-signature` with `{transmission_id, transmission_time, cert_url, auth_algo, transmission_sig, webhook_id, webhook_event:<json_decode(body)>}` and requires `verification_status == SUCCESS`.
  - A network error returns null, which gives **401** (PayPal retries).
  - **Port note:** splice the raw body string into `webhook_event` instead of re-serializing it. Re-encoded JSON can fail verification.
- **Event mapping** (`:215-273`):

  | Event | Status | `payment_id` |
  |---|---|---|
  | `CHECKOUT.ORDER.APPROVED` | `pending`, then captured | `resource.id` |
  | `CHECKOUT.ORDER.VOIDED` | `failed` | `resource.id` |
  | `PAYMENT.CAPTURE.COMPLETED` | `paid` | `resource.supplementary_data.related_ids.order_id`, falling back to `resource.id` |
  | `PAYMENT.CAPTURE.DENIED` | `failed` | same as above |
  | `PAYMENT.CAPTURE.REFUNDED` | `refunded` | same as above |

  Partial refunds are again treated as full refunds.

#### 2.10.4 Razorpay (`class-razorpay.php`)

- **Configured** when both `key_id` and `key_secret` are set for the mode.
- **Create** (`:36-110`): `POST https://api.razorpay.com/v1/payment_links`, `Authorization: Basic base64(key_id:key_secret)`, JSON:
  - `amount` (minor), `currency`, `accept_partial:false`
  - `description` (up to 2048 chars, form description or title)
  - `reference_id: "cf_{sid}_{6 random chars}"`. The random suffix means there's no idempotency.
  - `callback_url: return(success)`, `callback_method:"get"`
  - `notify:{sms:false, email:false}`
  - `notes:{cf_submission, cf_form_id}`
  - `customer:{email}` when an email was found
- **Stored `payment_id`:** the link `id` (`plink_…`). **Redirect:** `short_url`. There's no cancel URL.
- **Webhook** (`:117-138`):
  - `X-Razorpay-Signature == hex(HMAC-SHA256(webhook_secret, rawBody))`.
  - **No timestamp, so no replay window.**
- **Event mapping** (`:144-189`):
  - If `payload.payment_link.entity.id` is absent and `payload.payment.entity.notes.cf_submission` is present, the stored link ID is resolved by submission (`:191-195`). Then:
    - `refund.processed` or `refund.created` → `refunded`
    - `payment.captured` → `paid`
    - `payment.failed` → `failed`
    - anything else → `pending`
  - `payment_link.paid` → `paid`.
  - `payment_link.cancelled` or `payment_link.expired` → `failed`.
  - `refund.*` with a link ID → `refunded`.
  - **Unverified:** whether payment entities created from payment links carry the link's `notes`. Test this against the Razorpay sandbox during implementation.

#### 2.10.5 Polar.sh (`class-polar.php`)

- **API base** (`:31-35`): `https://sandbox-api.polar.sh` in test mode, `https://api.polar.sh` in live mode.
- **Configured** when `access_token` is set for the mode.
- **Create** (`:41-116`): `POST {base}/v1/checkouts/`, `Authorization: Bearer {token}`, JSON:
  - `success_url`, `metadata:{cf_submission, cf_form_id}`, `customer_email`
  - **then either** `product_id` (from `payment_polar_product_id`) **or** `amount` (minor), `currency` (lowercase), `product_price_type:"one_time"` and `name` (up to 80 chars).
  - **Risk:** the ad-hoc shape isn't verified against the current Polar API, which centers on `products[]`. Check it during implementation; don't trust it blindly.
- **Stored `payment_id`:** the checkout `id`. **Redirect:** `url`.
- **Webhook** (`:121-173`, Standard Webhooks):
  - Headers `webhook-id`, `webhook-timestamp` and `webhook-signature`. Tolerance is **300 s**.
  - Key: if the secret starts with `whsec_`, it's `base64_decode(rest)`; otherwise the raw string is used (`:178-186`).
  - Expected signature: `base64(HMAC-SHA256(key, "{id}.{ts}.{rawBody}"))`, matched against any space-separated `v1,<sig>`.
  - `webhook-id` isn't deduplicated.
- **Event mapping** (`:192-253`):
  - `order.*` events use `data.checkout_id`; `checkout.*` events use `data.id`.
  - `order.created` or `order.paid` with status in {paid, succeeded, completed} → `paid`.
  - `checkout.updated` with status in {succeeded, paid, completed} → `paid`.
  - `order.refunded` → `refunded`.
  - `checkout.updated` with status `expired` → `failed`.

### 2.11 Refunds, subscriptions and test mode, in one place

- **Refunds** are provider-initiated only. There's no refund API call from Core Forms. A webhook moves the submission to `refunded`, which triggers the reversal outbox and then `cf_payment_refunded` → `LicenseCommerce::refund_submission` (§3.8).
- **Recurring billing:** there's none. Stripe always uses `mode=payment`. `provider_subscription_id` is never populated by built-in flows (§3.6).
- **Test vs live:** a single global `mode` selects suffixed keys and the PayPal and Polar hosts. The `mode` is echoed to the client in the `payment.mode` response field.

### 2.12 FluentCart and other WP-only commerce (out of scope)

- **FluentCart gateway** (`class-fluentcart.php`):
  - Same-site and configured whenever the plugin is active.
  - The price comes from a FluentCart variation.
  - There's no webhook. It listens to the `fluent_cart/order_paid_done` and `order_status_changed_to_refunded` actions (`:358-423`).
  - It's registered only if FluentCart is present (`core-forms.php:299-305`).
- **Other native actions** (`src/integrations/class-integration-manager.php:77+`): WooCommerce order, EDD order, SureCart checkout, WP Simple Pay, MemberPress, LearnDash, Paid Memberships Pro, Groundhogg, Jetpack CRM and others.
- **Self-updater:** `Admin\LicenseManager` (`src/admin/class-license-manager.php:26-50`) is Core Forms' own update client against FluentCart on gauravtiwari.org. It's unrelated to the merchant license server.

**Port treatment:** import and keep these settings, but don't run them. This matches how the 0.1.0 port treats `create_comment`.

### 2.13 Payment hooks and filters (to emulate as EmDash plugin events where useful)

- **Filters:**
  - `cf_payments_orchestrator`
  - `cf_payment_submission_form` (used by native checkout to rebuild its synthetic form, `class-license-commerce.php:1058-1065`)
  - `cf_payment_currency_gateway_keys`
  - `cf_payment_gateways_for_currency`
- **Actions:**
  - `cf_form_success`, `cf_payment_completed(Submission, Form)` and `cf_payment_refunded(Submission)`, all from the outbox
  - `cf_form_response(form, submission, code)`
  - `cf_submission_written(id, 'payment'|'fulfillment'|'refund_reconciliation'|'license_commerce')`

---

## 3. Licensing and digital products (Core Commerce)

### 3.1 Enablement, settings, permissions

- **Master switch:** `cf_settings['license_server']['enabled']` (`LicenseServer::enabled()`, `class-license-server.php:25-27`). It's off on fresh installs: the 4.9.0 change stopped `install_defaults()` from enabling it, and `_cf_rollback_unsolicited_license_server()` turns it off on never-used stores (`functions.php:2036-2090`).
- **When the switch is off:**
  - the license API returns `license_server_disabled`
  - the storefront returns 503
  - checkout shows "unavailable"
  - `issue_license` and `renew_license` fail with "Core Commerce is not active."
  - VirtualProduct is inert
- **`license_server` keys:**
  - `enabled` (0/1), `checkout_page_id`, `dashboard_page_id`, `support_url` (http(s) only, `class-license-commerce.php:468-489`).
  - Legacy pre-4.4.1 keys, migrated once to a product row by `migrate_legacy_product` (`:610-618`): `product_slug`, `product_name`, `product_version`, `product_type`, `activation_limit`.
  - A shared-settings save preserves these keys (`class-admin.php:321-337`).
- **Options:**
  - `cf_commerce_key_policy` (§3.5)
  - `cf_license_maintenance_last_run`
- **Transients:**
  - `cf_paypal_token_*`
  - `cf_license_access_{hmac}` (5-minute access-email throttle)
  - `cf_license_checkout_{uuid}` (5-minute checkout error notice)
- **Capability:** `manage_core_forms_licenses`. It's granted to administrators and the activating user (`functions.php:3615-3624`). `LicenseApi::can_manage()` accepts it or `manage_options`.
- **Activation:** `activate_commerce()` (`class-license-commerce.php:458-466`) enables the switch and provisions pages via `ensure_checkout_page` and `ensure_dashboard_page` (§3.13).
- **Cron:** `cf_license_subscription_maintenance` runs daily. It's re-ensured on `admin_init` (`:569-573`).

### 3.2 Data model (custom tables; no CPT, no post meta for products)

DDL is at `functions.php:3452-3612`. Later column additions: 4.4.1 (`:1743-1788`), 4.6.0-beta.2 (`:1832-1846`), 4.9.7 (license_key collation, `:1891-1898`) and 4.9.8 (`details`, `fulfillment_data`, `:1900-1908`). All datetimes are **UTC** `Y-m-d H:i:s` (`current_time('mysql', true)`).

**`cf_license_products`**

| Column | Type / default | Notes |
|---|---|---|
| `id` | BIGINT UNSIGNED PK AI | Clients may send it as `item_id`, so **preserve it** |
| `slug` | VARCHAR(190) UNIQUE | Client `item_name`; public |
| `name` | VARCHAR(255) | |
| `version` | VARCHAR(40) | Set to the version of the last-published release |
| `type` | VARCHAR(20) `'plugin'` | plugin, theme, digital, service or event |
| `activation_limit` | INT UNSIGNED 1 | Default when there's no plan |
| `status` | VARCHAR(20) `'active'` | active or archived. There's no delete |
| `description` | LONGTEXT | Admin saves `wp_kses_post`; the API saves `sanitize_textarea_field` |
| `details` | LONGTEXT JSON | §3.3 |
| `icon_attachment_id` | BIGINT NULL | WP media ID |
| `checkout_form_id`, `renewal_form_id` | BIGINT NULL | **Any WP post/page ID** (content connection), not necessarily a form |
| `created_at`, `updated_at` | DATETIME | |

**`cf_license_plans`**

| Column | Type / default | Notes |
|---|---|---|
| `id` | PK | |
| `product_id` | BIGINT | |
| `slug` | VARCHAR(190) | UNIQUE with `product_id` |
| `name` | VARCHAR(255) | |
| `price_minor` | BIGINT UNSIGNED 0 | 0 means a free plan |
| `currency` | VARCHAR(8) `'USD'` | |
| `checkout_page_id` | BIGINT NULL | Generated page (§3.13) |
| `billing_period` | VARCHAR(20) `'lifetime'` | day, week, month, year or lifetime. Forced to lifetime for service and event |
| `billing_interval` | INT 1 | |
| `activation_limit` | INT 1 | |
| `license_duration_days` | INT 0 | |
| `trial_days` | INT 0 | |
| `status` | `'active'` | active or archived |
| `created_at`, `updated_at` | DATETIME | |

Index: `KEY product`.

**`cf_license_orders`**

| Column | Notes |
|---|---|
| `id` | PK |
| `order_number` | VARCHAR(40), UNIQUE. `CF-YYYYMMDD-XXXXXXXX` for purchases, `CFR-…` for renewals (X = uppercase hex) |
| `source_key` | CHAR(64), UNIQUE, idempotency (§3.5) |
| `submission_id`, `form_id`, `user_id` | NULL-able links. `form_id` is 0 for native checkout |
| `customer_email` | VARCHAR(255), canonical lowercase |
| `customer_name` | |
| `status` | `'paid'`, `'refunded'`. The list UI also filters `pending` and `failed`, which nothing writes |
| `currency` | |
| `subtotal_minor`, `total_minor` | Always equal |
| `payment_provider`, `payment_id` | Copied from the submission |
| `created_at`, `paid_at` | |

Indexes: `customer(user_id, customer_email)`, `submission`.

**`cf_license_order_items`**

| Column | Notes |
|---|---|
| `id`, `order_id`, `product_id`, `plan_id` NULL | |
| `quantity` | INT 1 |
| `fulfillment_data` | LONGTEXT JSON. For purchases: `{type, product_name, details}`. For renewals: `{kind:'renewal', previous_expiration, previous_period_start, period_start, period_end, billing_period, billing_interval}` |
| `unit_amount_minor`, `total_amount_minor` | |
| `license_id` | NULL. The **last** license issued for the item |
| `created_at` | |

Indexes: `order_id`, `product_plan(product_id, plan_id)`, `license_id`.

**`cf_licenses`**

| Column | Notes |
|---|---|
| `id` | PK. Used in signed package URLs, so **preserve it** |
| `product_id`, `submission_id` NULL, `order_item_id` NULL | |
| `license_key` | VARCHAR(191) `ascii_bin`, UNIQUE. **Plaintext, case-sensitive** |
| `customer_email` | |
| `user_id` | NULL |
| `status` | VARCHAR(20) `'active'`: active, disabled or expired |
| `activation_limit` | INT 1 |
| `expires_at` | DATETIME NULL. NULL means lifetime |
| `created_at`, `updated_at` | |

Indexes: `product`, `submission`, `license_customer(user_id, customer_email)`, `order_item`.

**`cf_license_activations`**

| Column | Notes |
|---|---|
| `id` | |
| `license_id` | |
| `site_url` | TEXT, as normalized by `esc_url_raw` |
| `site_hash` | CHAR(64), §3.9 |
| `instance_id` | CHAR(64). Random 32 hex characters |
| `status` | `'active'` or `'inactive'` |
| `activated_at`, `last_seen_at` | |

Indexes: UNIQUE `license_site(license_id, site_hash)`, `instance_id`.

**`cf_license_packages`**

| Column | Notes |
|---|---|
| `id` | |
| `product_id` | |
| `version` | VARCHAR(40). UNIQUE with `product_id` |
| `attachment_id` | WP media ID of the ZIP |
| `sha256` | CHAR(64) |
| `release_notes` | |
| `created_at` | |

**"Latest" means `ORDER BY id DESC`, not the highest version.**

**`cf_license_subscriptions`**

| Column | Notes |
|---|---|
| `id`, `order_item_id`, `license_id` (UNIQUE), `product_id`, `plan_id`, `user_id`, `customer_email` | |
| `status` | `'active'`: active, trialing, past_due, cancelled or expired |
| `billing_period`, `billing_interval` | |
| `auto_renew` | TINYINT 1. Built-in flows write **0** |
| `provider`, `provider_subscription_id` | |
| `current_period_start` | NOT NULL |
| `current_period_end` | NULL |
| `cancelled_at`, `created_at`, `updated_at` | |

Indexes: `customer`, `period_end(status, current_period_end)`.

**`cf_license_downloads`**

| Column | Notes |
|---|---|
| `id`, `license_id`, `package_id`, `user_id` NULL | |
| `ip_hash` | CHAR(64). `HMAC-SHA256(ip, wp_salt('nonce'))` |
| `downloaded_at` | |

**`cf_license_events`** (append-only audit)

| Column | Notes |
|---|---|
| `id` | |
| `event_type` | VARCHAR(50) |
| `object_type` | VARCHAR(30) |
| `object_id`, `license_id`, `product_id`, `actor_user_id` | default 0 |
| `actor_email` | |
| `metadata` | JSON. Keys `license`, `license_key`, `key`, `access_token` and `signature` are stripped (`class-license-commerce.php:349-360`) |
| `created_at` | |

Event types: `license_issued`, `license_activated`, `license_deactivated`, `license_updated`, `activations_reset`, `license_renewed`, `release_published`, `package_downloaded`, `subscription_cancelled`, `subscription_updated`, `access_email_sent`, `product_created`, `product_updated`, `plan_created`, `plan_updated`, `plan_saved`, `purchase_fulfilled`, `checkout_failed`, `commerce_activated`, `store_settings_updated`, `key_policy_updated`, `currency_routes_updated`, `commerce_setup_repaired`, `sample_product_created`, `product_forms_generated`.

**Customers are derived, not stored.** A customer is `UNION(LOWER(TRIM(customer_email)))` over orders and licenses (`class-license-list-table.php:163-185`).

WP user data used per customer:
- **user meta:** `first_name`, `last_name`, `billing_phone`, `billing_company`, `billing_tax_id`, `billing_address_1`, `billing_address_2`, `billing_city`, `billing_state`, `billing_postcode`, `billing_country`, `cf_license_site_url`, `_cf_portal_profile_notice`
- **user columns:** `display_name`, `user_email`

**Generated forms and pages post meta:**
- forms: `_cf_license_generated`, `_cf_license_product_id`, `_cf_license_form_kind` (checkout or renewal), `_cf_license_plan_id`, `_cf_license_page_id`
- pages: `_cf_license_generated`, `_cf_license_form_id`

### 3.3 Product types, details, plans, pricing

- **Types** (`class-product-options.php:8-10`): `plugin`, `theme` and `digital` are licensed (they get keys, activation limits and packages). `service` and `event` are unlicensed: they create an order and item, no key, and log `purchase_fulfilled`.
- **`details` JSON** (`normalize`, `:15-52`):

  | Key | Validation |
  |---|---|
  | `service_timeframe`, `event_location`, `delivery_instructions` | text |
  | `service_booking_url`, `event_access_url`, `checkout_form_id_url`, `renewal_form_id_url` | http(s) only |
  | `service_duration` | int ≤ 100000 minutes |
  | `event_start`, `event_end` | `Y-m-d\TH:i` in `event_timezone`; end must be after start |
  | `event_timezone` | valid timezone; defaults to the site timezone |
  | `gallery_ids` | up to 30 editable image attachment IDs |

- **`public_details`** (`:53-56`), the subset used by the storefront and product cards:
  - event: start, end, timezone, location
  - service: duration, timeframe
  - Delivery instructions and access URLs appear **only** in paid order details in the portal.
- **Connection URL** (`:57-62`): `details[{field}_url]` if set, otherwise the permalink of `checkout_form_id` or `renewal_form_id` when published.
- **Plans:** price in minor units plus currency. There are no variants or options beyond plans.
  - Billing labels: "One-time purchase" for lifetime, otherwise "One-time payment; {n} {period} license term".
  - A paid non-lifetime plan is a **term**, not recurring billing.
- **Sample catalog** (`class-product-provisioner.php:16-53`, inserts only missing rows):

  | Product | Type | Plans |
  |---|---|---|
  | `sample-product` | plugin, limit 3 | `free` (0 USD lifetime, 1 site); `pro-annual` (4900 USD, year, 3 sites, 365 days); `pro-annual-inr` (399900 INR) |
  | `sample-theme` | theme | `personal-annual` 5900; `unlimited-lifetime` 12900, 100 sites |
  | `sample-download` | digital | `personal` 2900; `team` 7900, 10 sites |

  Building any `license_*` **form template's settings seeds this catalog as a side effect** (`templates.php:954-1006`).

### 3.4 Purchase paths

**A. `issue_license` native action on any Core Form**

Definition: `class-integration-manager.php:44-69`. Handler: `LicenseCommerce::fulfill`. String settings are token-resolved by `NativeAction::resolve_settings` (`class-native-action.php:126-137`).

| Setting | Default |
|---|---|
| `product_id` | required |
| `plan_id` | |
| `product_selection` | e.g. `[products]` |
| `product_map` | lines of `value=product_id:plan_id:quantity` |
| `email` | `[email]`, required |
| `first_name`, `last_name`, `phone`, `company`, `tax_id`, `address_line_1`, `address_line_2`, `city`, `state`, `postal_code`, `country`, `site_url`, `order_notes` | |
| `quantity` | 1 |
| `activation_limit` | 1 |
| `expiry_days` | 0 = lifetime |
| `create_user` | 1 |
| `enforce_amount` | 1 |
| `send_email` | 1 |

- On a free form (all selected plans price 0, or no plan), the action runs synchronously at submit.
- On a payment form, it runs from the outbox after `paid`.

**B. `renew_license` native action** (`:70-76`): `license_key` (`[license_key]`), `email`, fallback `billing_period` (month or year, default year), `billing_interval` 1, `send_email` 1. Handler: `LicenseCommerce::renew` (§3.7).

**C. Native checkout without a form post.** This is the default for the catalog.

- **Page** contains `[cf_license_checkout]` (`class-license-commerce.php:874-958`).
  - The selection comes from attributes or `?cf_product=&cf_plan=` (also `product` and `plan`), and requires both product and plan to be active (`:1068-1075`).
  - Paid plans list every configured gateway routed for the plan currency as radios; the first is preselected.
  - With no gateway available, an error is shown, plus a settings link for admins.
  - The form posts to `admin-post.php`:

    | Field | Purpose |
    |---|---|
    | `action=cf_license_checkout`, `product`, `plan`, `_wpnonce` | routing and CSRF |
    | `company_website` | honeypot |
    | `first_name`, `last_name`, `email` | required |
    | `gateway` | paid plans only |
    | `terms=accepted` | required |

- **`process_checkout`** (`:961-1055`):
  1. Checks the nonce, that commerce is enabled, the honeypot, the selection, the name, email and terms, and for paid plans `has_route` + `is_gateway_allowed` + `is_configured`.
  2. Builds a **synthetic Form(0)** from `ProductProvisioner::checkout_settings` (`:147-167`): `payment_enabled` when paid, `payment_amount` set to the major string, `payment_description "{product} {plan} license for [email]"`, and actions `[issue_license(product, plan, …tokens), admin email]`. `payment_provider` is set to the chosen gateway, and `payment_success_redirect` to the checkout URL with `cf_checkout=payment-return` (`:1088-1096`).
  3. Inserts a `cf_submissions` row with `form_id=0` and data `{first_name, last_name, email, terms, _cf_license_checkout:{product_id, plan_id, gateway}}` (`:1098-1113`).
- **Paid:** `create_checkout` → `pending_payment` → **303 redirect** to the provider.
  - On the webhook, the `cf_payment_submission_form` filter rebuilds the synthetic form from `_cf_license_checkout` using `checkout_selection_by_id`, which ignores archived status so an in-flight payment still fulfills (`:1058-1086`).
- **Free:** the row is set to `paid` with `payment_amount=0`, then `fulfill(...)` runs with `create_user=1`, `enforce_amount=1` and `send_email=1`.
  - The buyer is redirected to the dashboard only if they're logged in **as that email**. Otherwise they go to `checkout_url + cf_checkout=access-sent` (4.11.0 fix, so access isn't disclosed before email ownership).
- **Errors** become a 5-minute transient notice: redirect with `cf_checkout_notice={uuid}` (`:1115-1120`).
- Stripe inline isn't available here; native checkout is always hosted.

**D. Generated Core Forms** (`ProductProvisioner::generate_product_forms`, `:228-320`):
- One checkout form and page per active plan, plus one renewal form and page for the first paid non-lifetime plan.
- Non-destructive: lookups go by post meta, never title.
- Pages contain `[cf_form id="N"]`. The plan's `checkout_page_id` is set, and `renewal_form_id` is set if empty.
- Markup: `_cf_template_license_checkout` and `_cf_template_license_renewal` (`templates.php:877-924`). Messages: `templates.php:1312-1331`. The gateway is the currency's primary route (filter `cf_license_starter_form_gateway`).

### 3.5 Fulfillment algorithm: `LicenseCommerce::fulfill` (`class-license-commerce.php:68-141`)

1. Fail unless the server is enabled. The email is canonicalized: `strtolower(sanitize_email(trim()))`.
2. **Selections** (`resolve_selections`, `:297-310`): the `product_selection` string is split on `,` or `|` and each value is looked up in `product_map`. If nothing matches, fall back to `{product_id, plan_id, quantity}`.
3. **Pricing** (`selection_pricing`, `:370-384`): `Σ plan.price_minor × qty` over selections that have a plan, taken from the frozen `_cf_purchase_terms` when present. Mixed currencies → failure.
4. **`validate_payment_requirement`** (`:313-328`). This applies only if total > 0:
   - the form must be `payment_enabled`
   - the submission must be `is_paid()`
   - if `enforce_amount`: `submission.payment_amount == total` **and** currencies match
5. **Customer:** a WP user by email. If missing and `create_user`, `wp_insert_user` with a subscriber role and a login taken from the local part of the email, then `wp_new_user_notification` (`:386-397`).
   - The profile meta is saved **only if** that user is the current user (`:400-421`). In webhook context there's no current user, so it's never saved.
6. **Idempotency:** `source_key = sha256("{submission_id}|{wp_json_encode(selections)}|{sanitize_key(purchase_mode ?? 'purchase')}")`. An existing order means success with "already fulfilled". The selections JSON looks like `[{"product_id":12,"plan_id":4,"quantity":1}]`.
7. **Transaction:**
   - Insert the order (`status='paid'`, currency from the plan, the submission currency, or `settings.currency`, defaulting to USD).
   - The subtotal is the plan total. If that's 0, the submission `payment_amount` is used.
   - For each selection, run `fulfill_selection` (`:233-295`):
     - Insert an order item with a `fulfillment_data` snapshot.
     - Unlicensed types: log and stop.
     - Licensed types, for each `qty`:
       - key = `LicenseKeyPolicy::generate`
       - `duration` = `plan.license_duration_days`, else `settings.expiry_days`
       - `expires_at = now + duration days`, or NULL
       - `limit` = `plan.activation_limit`, else `max(1, settings.activation_limit ?? product.activation_limit)`
       - Insert the license (`status=active`), log `license_issued` (metadata includes `key_policy`), and set `item.license_id`.
       - If the plan isn't lifetime: insert a subscription with `period_end = period_end(now, period, interval, trial_days)`, `auto_renew = provider_subscription_id ? 1 : 0`, `provider` = the submission provider. **Then `expires_at` is overwritten with `period_end`**, so `license_duration_days` only applies to lifetime-period plans.
   - COMMIT. Errors roll back and return a failure. `ActionFailure` is retryable.
8. After commit:
   - Create an access token (§3.10).
   - If `send_email`, call `send_purchase_email` (§3.14). It isn't retried or ledgered.
   - Fire `do_action('cf_license_order_fulfilled', order_id, license_ids, submission, form)`.
   - Return `{order_id, order_number, license_ids, license_keys, dashboard_url}`.

**`period_end(start, period, interval, trial)`** (`:362-368`): UTC `DateTimeImmutable` with `+trial days` then `+interval {days|weeks|months|years}` (PHP month overflow semantics). Lifetime returns null.

**Key policy** (`class-license-key-policy.php`, option `cf_commerce_key_policy`):

| Setting | Default | Rules |
|---|---|---|
| `style` | `hex` | `hex` `0-9a-f`, `hex_upper`, `base32` `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, `base62` |
| `length` | 32 | `ceil(128/log2(|alphabet|))` ≤ length ≤ 128, which gives hex ≥ 32, base32 ≥ 26, base62 ≥ 22 |
| `prefix` | `''` | `^[A-Za-z0-9_-]{0,32}$` |
| `group` | 0 | 0, 4 or 8 |

- Total length (with prefix and separators) ≤ 191.
- `generate` uses `random_int` per character, joins groups with `-`, and prepends the prefix.
- Existing keys are never reformatted.

### 3.6 Subscriptions (local terms)

- These rows exist only for non-lifetime plans.
- There's no provider-side recurring charge, and `provider_subscription_id` is never filled by built-in code.
- **Customer "Cancel renewal"** is shown only when `auto_renew` is set and there's no `provider_subscription_id`, which is never true for built-in flows (`views/license-portal-licenses.php`). The handler `customer_cancel_subscription` (`:1172-1183`) refuses with **409** if a provider subscription exists; otherwise it sets `auto_renew=0`, `status=cancelled` and `cancelled_at`.
- **Admin `update_subscription`** (`class-license-api.php:411-431`) refuses with 409 when `provider_subscription_id` is set.
- Renewal happens manually via a paid renewal form (§3.7).
- **There are no renewal reminders or expiry emails.**

### 3.7 Renewal: `renewal_terms` and `renew` (`class-license-commerce.php:162-219`)

- **`renewal_terms(settings)`**, called at checkout time inside `Fulfillment::prepare`:
  - Looks up the license by exact `license_key`, joined with its subscription, plan and product.
  - Requires the canonical email to match the license email; otherwise it throws, which refuses the checkout.
  - Returns `{kind:'renewal', license_id, product_id, subscription_id, plan_id, customer_email, product_name, price_minor (plan, else settings.amount_minor), currency, billing_period, billing_interval}`. The period and interval come from the subscription, else the action fallbacks.
- **`renew()`**:
  1. Uses the frozen terms, revalidates the email, and runs `validate_payment_requirement(price_minor, currency)` with amount enforcement on.
  2. Takes lock `license:{id}`.
  3. A `disabled` license fails.
  4. `source_key = sha256("renew|{submission_id}|{license_id}")`. An existing order means "already applied".
  5. `start` = the current `expires_at` if it's in the future, else now. `end = period_end(start, period, interval)`. A lifetime period fails.
  6. In one transaction: insert a `CFR-` order and an item (`fulfillment_data` with the renewal snapshot), set the license `status=active` and `expires_at=end`, and set the subscription `active` with the new period and `cancelled_at=NULL`.
  7. Send an email if `send_email`.
  8. Log `license_renewed`.
  9. Fire `do_action('cf_license_renewed', license_id, end, submission, form)`.

### 3.8 Refund reversal: `refund_submission` (`class-license-commerce.php:1248-1304`)

This is hooked to `cf_payment_refunded` and runs from the reversal outbox. For each order with that `submission_id`:

1. Take lock `refund-order:{id}`. Skip if the order is already refunded.
2. Lock each affected license (`license:{id}`, sorted).
3. In one transaction:
   - **Purchase items:** every license with `order_item_id` = the item becomes `disabled`, and its subscription becomes `cancelled`, `auto_renew=0`.
   - **Renewal items:** `renewal_entitlement(history, excluded_order)` (`:1220-1245`) replays all renewal items chronologically, skipping refunded orders and this order, from the first renewal's `previous_expiration` and `previous_period_start`.
     - The license gets the recomputed `expires_at` and status `active`, or `expired`, or stays `disabled` if it already was.
     - The subscription period is updated. Its status is preserved if `cancelled`.
   - **Legacy 4.10.2 renewal items** with an empty `fulfillment_data` throw `DeliveryUncertain`, which needs manual reconciliation.
   - Set the order to `refunded`.
4. Fire `do_action('cf_license_order_refunded', order_ids, submission)`.

Activations aren't touched. A disabled license fails every API call anyway.

### 3.9 License server API (EDD Software Licensing–compatible): the client contract

Source: `class-license-server.php`. Docs: `docs/licensing/license-keys-auto-updates.md`. **Every detail below is a compatibility requirement for already-shipped client plugins and themes.**

**Routes:**
- **REST:** `GET|POST /wp-json/core-forms/v1/{check_license|activate_license|deactivate_license|get_version}`, `permission_callback __return_true` (`:29-35`).
  - Parameters come from `WP_REST_Request::get_params()`: query, form-urlencoded, multipart or JSON bodies.
  - The response is **always HTTP 200** with a JSON body, including business failures. The sample client treats non-200 as an error.
- **Legacy:** on `parse_request` (priority 1), **any front-end URL** with `$_REQUEST['edd_action']` in that set gets `wp_send_json(dispatch(...))` (`:37-41`). EDD SL clients POST to the store home URL.
- There's no auth, CORS, nonce or rate limit.

**`dispatch`** (`:43-54`):
1. If the server is disabled: `{success:false, error:'license_server_disabled', message:'License issuing is disabled.'}`.
2. **License lookup:** `sanitize_text_field(license ?? license_key)` → `WHERE license_key = ?`. This is an exact, case-sensitive match (ascii_bin).
3. **Product lookup** (`:163-169`): `absint(item_id ?? product_id)` by ID, else `sanitize_title(item_name ?? slug)` by slug. `sanitize_title` must be ported faithfully so "My Plugin" becomes "my-plugin".
4. If the license or product is missing, or `license.product_id ≠ product.id`: `{success:false, license:'invalid', error:'invalid_license'}`.
5. If the status isn't `active`, or `expires_at < now`: `{success:false, license:'expired', expires:<expires_at or null>}`. This includes **disabled** licenses and has no `error` key.
6. **Site:** `esc_url_raw(url ?? site_url)`. A URL without a scheme gets `http://` prepended, and disallowed schemes become `''`.
7. Route to the action.

**Site identity:** `site_hash = sha256(strtolower(untrailingslashit(esc_url_raw(url))))`.
- `untrailingslashit` strips trailing `/` and `\`.
- Scheme and path count: `http://` and `https://` are **different sites**.
- Existing `site_hash` rows depend on this, so the port must replicate `esc_url_raw` for common inputs and fall back to comparing `site_url`.

**`activate_license`** (`:56-83`):
- Missing URL: `{success:false, error:'missing_url'}`.
- **Transaction:**
  1. `SELECT license FOR UPDATE`, which serializes seats for that license. Recheck it; failure gives `{success:false, error:'invalid_license'}`.
  2. Find an existing row by `(license_id, site_hash)`. `changed` is true when there's no row or it's inactive.
  3. If `changed` and active count ≥ limit: `{success:false, license:'site_inactive', error:'activation_limit_reached', activations_left:0}`.
  4. Update the existing row (`status=active, last_seen_at=now`; `activated_at` unchanged), or insert `{site_url, site_hash, instance_id: 32 hex, active, activated_at, last_seen_at}`.
  5. A DB failure gives `{success:false, error:'activation_unavailable'}`.
- Log `license_activated` with `{site_host}` if changed. Return `status()`.

**`deactivate_license`** (`:85-91`):
- Sets the rows matching `(license_id, site_hash)` to `inactive` and `last_seen_at=now`, logs, and **always** returns `{success:true, license:'deactivated'}`, even when no row matched.
- An expired or disabled license is rejected at the gate in step 5, so it **can't free a seat via the API** (the portal can).

**`check_license`** (`status`, `:93-103`):

```json
{"success":true,"license":"valid"|"site_inactive","item_id":12,"expires":"2027-10-05 04:03:41"|"lifetime",
 "site_count":1,"license_limit":3,"activations_left":2}
```

- `site_inactive` means a URL was given and no active row matches it. With no URL, the result is `valid`.
- It **doesn't** update `last_seen_at`, record runtime metadata, or rebuild missing activations. `docs/licensing/customers.md` claims all three, which doesn't match the code.

**`get_version`** (`version`, `:105-110`). It needs no site activation and ignores `url`, `version` and `beta`.

```json
{"success":true,"new_version":"<product.version>","stable_version":"<product.version>","name":"…","slug":"…",
 "package":"<signed URL or ''>","download_link":"<same>","sections":{"changelog":"<latest package release_notes or ''>"},"sha256":"<hex or ''>"}
```

- The package is the newest row by `id`.
- `product.version` follows the **last published** release even if it was a replacement of an older version. That's an edge-case mismatch.

**Signed package URL** (`signed_package_url`, `:139-149`):

```
{admin_url('admin-post.php')}?action=cf_license_package&license_id={id}&package={pid}&expires={now+900}&signature={hex}
```

- **Signature:** `HMAC-SHA256("{license_id}|{package_id}|{expires}", wp_salt('auth'))`.
- **Legacy variant:** `license={key}` instead of `license_id`, with the key as the HMAC subject.
- A URL is issued only if the license is active and unexpired.

**Download** (`download_package`, `:112-136`, `admin-post` with and without a logged-in user):
1. Check `expires ≥ now` and the HMAC, else **403**.
2. The license must be active and unexpired, and the package must belong to the license's product, else 403.
3. The file must be readable and `sha256(file)` must equal the stored hash, else **404**.
4. Insert a downloads row with `ip_hash`, and log `package_downloaded`.
5. Respond with `Content-Type: application/zip`, `Content-Disposition: attachment; filename="{basename}"`, `Content-Length` and no-cache headers, then stream the file.

**Release publishing** (`LicenseApi::publish_release`, `class-license-api.php:211-247`, and `LicenseAdmin::validate_package`, `class-license-admin.php:943-966`):
- Input: a Media Library ZIP `attachment_id`, a version, and notes.
- ZipArchive checks:
  - 1–5000 entries
  - rejects `../`, leading `/` and `\` in paths
  - **plugin:** some `.php` file whose first 8 KB contains a `Plugin Name:` header
  - **theme:** a `style.css` with a `Theme Name:` header
  - **digital:** any ZIP passes
  - a detected `Version:` must equal the entered version
- Computes sha256 and size.
- An existing product/version needs `replace_existing`, which updates in place and keeps the ID.
- Sets `product.version` and logs `release_published`.

### 3.10 Customer access and portal

- **Identity** (`customer_identity`, `class-license-commerce.php:1122-1127`): a logged-in WP user (by user ID or email) **or** a magic-link token in `?cf_license_access=`.
- **Token** (`create_access_token`, `:423-427`):

  ```
  base64url(json{"email":canonical,"exp":unix}) "." hex(HMAC-SHA256(payload, wp_salt('auth')))
  ```

  - TTL is `TOKEN_TTL = 2592000` (30 days).
  - It's stateless and can't be revoked.
  - Verification checks `hash_equals` and expiry (`:429-437`).
- **Dashboard URL:** the permalink of `dashboard_page_id`, else `/license-dashboard/`, plus `?cf_license_access={token}` (`:446-451`).
- **Access request** (`request_access`, `:665-682`):
  - POST to `admin-post.php` with `action=cf_license_request_access`, `email` and a nonce.
  - Only if the email exists in licenses or orders **and** throttle `cf_license_access_{HMAC(email|ip, wp_salt('nonce'))}` (5 min) isn't set: send the access email and log.
  - **Always** redirects to `dashboard?cf_access_sent=1`, which makes the form enumeration-safe.
- **Data** (`customer_data`, `:1129-1141`): matches licenses and orders by `(user_id = ? OR LOWER(TRIM(customer_email)) = ?)`.
  - Licenses join product name, version, `renewal_form_id`, details, plan name, subscription ID, status, `auto_renew`, `provider_subscription_id` and `current_period_end`.
  - Each license gets its activations and a fresh `download_url` (15-minute signed URL).
  - Orders are `SELECT *`, which leaks `source_key` and `payment_id` to the customer.
- **Portal tabs** (`CustomerPortal::tabs`, `class-customer-portal.php:20-22`). Query parameters: `?cf_portal=overview|purchases|subscriptions|licenses|downloads|profile`, `cf_order`, `cf_page`. The view is `views/license-dashboard.php`.

  | Tab | Contents |
  |---|---|
  | overview | Shortcuts and the 5 most recent orders |
  | purchases | 20 per page. Order detail is owner-scoped (`order()`, `:81-91`). Paid orders show service and event fulfillment details (`delivery_instructions`, booking or access URL) and a printable receipt |
  | subscriptions | Term end and renewal method ("Manual renewal" or "Managed by payment provider"). Renew link via the `renewal_form_id` connection |
  | licenses | Masked key (`first8••••••••••••last8`) with reveal and copy, version, expiry, sites used/limit, download, renew, cancel renewal, and per-site **Deactivate** |
  | downloads | Latest package per product |
  | profile | Logged-in users only. Edits first, last and display name plus `billing_*` (2-letter country, ≤ 250 characters), via `admin-post` `cf_license_save_profile` (`:45-79`) |

- **Customer actions** (`admin-post`, nonce, logged-in **or** `access_token` in POST, ownership asserted by license ID and email/user ID):
  - `cf_license_deactivate_site(license_id, activation_id)` (`:1160-1170`)
  - `cf_license_cancel_subscription(license_id)` (`:1172-1183`)
- **REST:** `GET /wp-json/core-forms/v1/customer/licenses?access_token=…`. Permission is a logged-in cookie with a REST nonce, or a valid token. It returns `customer_data` with **full keys** (`:1143-1158`).
- **Filters:** `cf_customer_portal_links` (extra sidebar links), `cf_customer_portal_support_url` (default `license_server.support_url` or `/support/`), `cf_customer_portal_shop_url` (`/shop/`).
- **Page protection** (`CommerceCompatibility::protect_customer_pages`, `class-commerce-compatibility.php:105-112`): checkout and dashboard pages get `DONOTCACHEPAGE`, `nocache_headers` and `Referrer-Policy: no-referrer`. The cache bypass also covers query parameters `cf_license_access`, `cf_checkout`, `cf_checkout_notice`, `product` and `cf_product` (`:81-92`).

### 3.11 Storefront REST (public, read-only): `class-storefront-rest-api.php`

| Route | Permission | Notes |
|---|---|---|
| `GET /wp-json/core-forms/v1/storefront` | open | `{name:'Core Forms Storefront API', version:1, enabled, checkout_url, _links:{self, products}}` |
| `GET …/storefront/products` | enabled, else 503 `cf_storefront_disabled` | `page` (1), `per_page` (12, max 100), `type` (enum of types or `''`), `currency` (`^$|^[A-Za-z]{3}$`, keeps only products with an active plan in that currency and filters plans), `search` (name, slug, description LIKE), `orderby` name\|created\|updated\|version, `order` ASC\|DESC. Returns `{products:[…], pagination:{page, per_page, total, total_pages}}` plus `X-WP-Total`, `X-WP-TotalPages` |
| `GET …/storefront/products/{slug}` (`[a-zA-Z0-9_-]+`) | enabled | Optional `currency`. Inactive slug: 404 `cf_storefront_product_not_found` |

**Product payload** (`:195-224`):
- `{slug, name, type, version, description, icon:{url, width, height, alt, fallback:type}, gallery:[{url, width, height, alt}], product_details:public_details, plans:[…], updated_at:ISO8601, _links.self}`.
- Unlicensed types drop `version`, and their plans drop `activation_limit`, `license_duration_days` and `trial_days`.
- Image sizes: icon uses `medium`, gallery uses `large`.

**Plan payload** (`:227-258`): `{slug, name, price_minor, price:"49.00", currency, formatted_price:"USD 49.00", is_free, billing_period, billing_interval, billing_label, activation_limit, license_duration_days, trial_days, checkout_url}`.

**Headers** (`:384-397`):
- `ETag: "sha256(json)"`, with 304 on `If-None-Match` (`*`, exact or `W/`).
- `Cache-Control: public, max-age=T, s-maxage=T, stale-while-revalidate=max(60, 12T)`, with T = 300 (filter `cf_storefront_cache_ttl`).
- `Access-Control-Allow-Origin: *`, `Access-Control-Expose-Headers: ETag[, X-WP-Total, X-WP-TotalPages]`.

**Filters:** `cf_storefront_enabled`, `cf_storefront_product`, `cf_storefront_plan`. Errors use the WP REST error shape `{code, message, data:{status}}`.

### 3.12 Admin commerce REST and Abilities

**REST:** `class-license-rest-api.php:17-80`. All routes are under `/wp-json/core-forms/v1/commerce` with permission `can_manage`. The service layer is `LicenseApi`.

| Area | Routes |
|---|---|
| Summary and catalog | `GET /summary`; `GET`/`POST /products`; `GET`/`PATCH /products/{id}`; `POST /products/{id}/generate-forms` |
| Plans | `GET /plans`; `GET`/`POST /products/{product_id}/plans`; `PATCH /plans/{id}` |
| Releases | `GET /releases`; `GET`/`POST /products/{product_id}/releases` |
| Orders | `GET /orders`; `GET /orders/{id}`; `POST /orders/{id}/resend-access` |
| Licenses | `GET /licenses`; `GET`/`PATCH /licenses/{id}`; `POST /licenses/{id}/reset-activations`; `POST /licenses/{id}/resend-access` |
| Operations | `GET /activations`; `POST /activations/{id}/deactivate`; `GET /subscriptions`; `PATCH /subscriptions/{id}`; `GET /downloads`; `GET /events` |
| Setup | `POST /sample-products`; `GET`/`PUT /currency-routes`; `GET /gateways` |

- Lists are paginated `{data, total, page, per_page, pages}` (`per_page` ≤ 100); some return the first 500 rows.
- **Full keys are never returned** (`license_key_masked` = `first8…last8`, `:548-550`), and `source_key` is stripped.
- There are no delete routes; archive by changing status.
- `update_license` takes `status`, `activation_limit` and `expires_at`. `update_subscription` takes `status` (active, trialing, past_due, cancelled, expired) and `auto_renew`.
- `gateway_status` returns `{key, label, registered, configured, mode, currencies}` without credentials.

**Abilities** (`class-license-abilities.php:29-56`):
- 26 abilities under `core-forms/<name>` in category `core-forms-commerce`, mapping 1:1 to the service methods.
- Annotations: readonly, destructive, idempotent. `mcp.public=true`, `show_in_rest=true`.
- **Port:** expose the same names if EmDash has an agent/MCP tool registry; otherwise defer.

### 3.13 Shortcodes, blocks, pages, virtual product URLs

**Shortcodes** (`class-license-commerce.php:32-39`, reference `:798-809`):

| Shortcode | Attributes |
|---|---|
| `[cf_license_products]` | `type`, `limit` ≤ 100, `columns` 1–4, `orderby`, `order` |
| `[cf_license_product_list]` | `type`, `limit`, `orderby`, `order`, `show_price` |
| `[cf_license_product]` | `product`/`slug`, `plan`, `show_description`, `show_version` |
| `[cf_license_price]` | `product`, `plan` |
| `[cf_license_buy_button]` | `product`, `plan`, `label`. Default label "Buy now", or "Get license" for free plans |
| `[cf_license_checkout]` | `product`, `plan` |
| `[cf_license_dashboard]` | |
| `[cf_product_gallery]` | `product`, `columns` 1–6 |

**Blocks** (`class-license-blocks.php:51-108`) are dynamic and server-rendered via the same methods: `core-forms/license-products`, `license-product-list` (`showPrice`), `license-product` (`showDescription`, `showVersion`), `license-price`, `license-buy-button`, `license-checkout`, `license-dashboard` (editor placeholder in REST context), and `product-gallery`.

**Product card markup:**
- `render_product`, `:844-867`: `.cf-license-product`, `.cf-license-plans` > `article.cf-license-plan`, `.cf-license-price`, `a.cf-license-button`.
- CTA labels: "Get license" (free), "Choose plan", "Register" (event), "Choose service".
- Styles: `assets/css/license-frontend.css`. Keep the class names for theme compatibility.

**Checkout URL** (`checkout_url`, `:575-596`):
1. A product's `checkout_form_id` connection URL overrides everything.
2. Otherwise use the checkout page permalink. If unset, look up an owned page at slug `core-checkout`, then `checkout`; otherwise use `/core-checkout/`.
3. Append `?cf_product=&cf_plan=`.

**Provisioned pages:**
- "Core Commerce Checkout": slug `core-checkout`, content `<!-- wp:shortcode -->[cf_license_checkout]<!-- /wp:shortcode -->`.
- "Customer Dashboard": slug `license-dashboard`, `[cf_license_dashboard]`.
- See `:491-532`. A page counts as a checkout page only if it's published, contains the shortcode or block, and has no foreign checkout markers (`:562-567`).

**Virtual product page** (`class-virtual-product.php`):
- `/?product={slug}` serves an active product through the theme. If another public post type uses query var `product` and owns that slug, the URL is `/?cf_product={slug}`.
- It applies **only at the site root path**, and skips requests that also carry `s`, `p`, `page_id`, `pagename`, `preview`, `feed`, `rest_route`, `paged`, `fluent-cart`, `edd_action` or `wc-ajax`.
- A missing or inactive slug gives 404.
- Rendering: title "{name} - {site}", meta description from `description`, canonical, no-cache, `<h1>` product card plus gallery (`views/virtual-product.php`).

### 3.14 Emails (all plain text via `wp_mail`, From = site default)

| Trigger | Subject | Body |
|---|---|---|
| Purchase with keys (`:645-652`) | `[{site}] Your products and license keys` | `Hello {name or email},\n\nYour order {order_number} is ready.\n\nLicense keys:\n{keys one per line}\n\nManage licenses, downloads, activations, and subscriptions:\n{dashboard_url with token}` |
| Purchase, no keys (service, event) | `[{site}] Purchase confirmation` | `Hello {name},\n\nYour order {n} is confirmed. View your purchase and next steps:\n{url}` |
| Renewal (`:215`) | `Your {product} license was renewed` | `Your license is active through {Y-m-d H:i:s}.\n\nManage it here: {url}` |
| Access link (`:655-662`; admin resend, portal request) | `[{site}] Your secure customer dashboard link` | `Use this private link to manage your licenses, downloads, sites, and renewals:\n\n{url}\n\nThis link expires in 30 days. If you did not request it, you can ignore this email.` |
| New WP user (`create_user`) | WP core `wp_new_user_notification` | n/a in EmDash |
| Admin notification | Regular `email` action from templates (`templates.php:940-945`), `Reply-To: [email]` | |

**Full license keys travel in plaintext email.** There are no receipt PDFs. A printable receipt exists in the portal.

### 3.15 Maintenance and CLI

- **`run_maintenance()`** (`:1209-1217`, daily cron `cf_license_subscription_maintenance`):
  - `UPDATE subscriptions SET status='expired' WHERE status IN ('active','cancelled') AND current_period_end < now`
  - `UPDATE licenses SET status='expired' WHERE status='active' AND expires_at < now`
  - Stores `cf_license_maintenance_last_run` and fires `cf_license_maintenance_completed(subs, licenses)`.
  - The API also checks `expires_at` live, so the cron is cosmetic for enforcement.
- **WP-CLI** `wp core-forms license` (`src/cli/class-license-command.php`): `product-list`, `product-create`, `plan-list`, `license-list`, `order-list`, `maintenance`. There's no EmDash equivalent; maintenance becomes an admin action.

---

## 4. Admin UI (brief)

- **Form → Payment tab** (`views/tab-payment.php`):
  - Enable toggle and a must-save-submissions warning.
  - Provider select showing "(not configured)" or "(not routed for X)", with flow (hosted or inline) for Stripe.
  - Pricing: amount, currency, description, and the product picker (Stripe).
  - After payment: redirect URL.
- **Settings → Payments** (`#cf-payments`): mode, currency-route repeater (currency, gateways, primary), per-gateway credentials and webhook URL, and the shortcode/block reference.
- **Core Commerce workspace** (`admin.php?page=core-forms-licensing`, cap `manage_core_forms_licenses`, `class-license-admin.php`):
  - When inactive: an "Activate Core Commerce" screen.
  - Tabs: Overview, Products, Customers, Licenses, Orders, Storefront, Settings (`:152-169`).
  - **Overview** (`:316-386`): metrics plus "Next steps" (`overview_tasks`): checkout or dashboard page missing, no products, products without plans, licensed products without releases, paid currencies with no configured gateway, cron missing, licenses expiring within 30 days, licenses at their seat limit, failed or pending orders. Also a recent activity timeline.
  - **Products:** list table (readiness column), product editor (type-specific fields, icon and gallery pickers, content connections via `ContentPicker` AJAX `cf_commerce_search_content`), product workspace (plans, generated forms, releases, setup, embed snippets), plan editor, and release upload (Media Library ZIP).
  - **Customers:** case-insensitive aggregate list and detail.
  - **Licenses:** list (search email, key LIKE or product; `attention=expiring|at-limit`) and detail (status, limit, expiry edit; reset activations; resend access).
  - **Orders:** list and detail.
  - **Storefront:** shortcode and block reference.
  - **Settings:** store setup (enable, pages, support URL), key format (live preview), link to payments, and compatibility report and repair.
- **Recovery screen** (`src/workflows/class-recovery.php`): retry fulfillment or refund work, with "refresh actions" (§2.9).
- Writes go through `admin-post` (`cf_license_save` with entity `activate-commerce`, `store-settings`, `repair-compatibility`, `key-policy`, `product`, `plan`, `package` or `license`; and `cf_license_action` with operation `reset_activations` or `resend_access`) (`:803-941`). **Port:** route everything through the `LicenseApi` equivalent instead of duplicating logic, since the WP admin duplicates some of it.

---

## 5. Security

### 5.1 Secrets
- Gateway credentials sit **plaintext in `wp_options.cf_settings`** (autoloaded), and the Data export "settings" dataset includes them (`class-core-data-migration.php:44-46`).
- **Port:** store them in EmDash plugin secrets. Never import them from a JSON file; re-enter them.

### 5.2 Webhooks
- Stripe: HMAC-SHA256 with a 300 s window.
- Polar: Standard Webhooks HMAC with a 300 s window.
- Razorpay: HMAC-SHA256 hex with **no replay window**.
- PayPal: remote verification API.
- All comparisons are constant-time.
- The return URL can never mark a submission paid. Status changes never downgrade paid or refunded.
- There's no event-ID store. Gaps to consider: Polar `webhook-id` dedupe and a Razorpay replay window.

### 5.3 HMAC secrets in use
`wp_salt('auth')` = `AUTH_KEY . AUTH_SALT` signs:
- return tokens (2 h)
- package URLs (15 min)
- customer access tokens (30 days; tokens are already inside sent emails)

`wp_salt('nonce')` keys the download `ip_hash` and the access throttle key.

### 5.4 License keys
- Stored **plaintext** (not hashed) with a unique index. They must be retrievable because the portal reveals full keys and emails contain them.
- Masked in admin REST, Abilities and list views. Scrubbed from event metadata.
- New package links carry a license ID, not a key.
- **Keep them plaintext in the port.** Hashing would break the portal reveal and EDD-style lookup unless both a hash and an encrypted copy are stored. That's optional hardening.

### 5.5 Amount integrity
- Server-side calculation recompute.
- The product picker posts an index, not a price.
- Plan totals are re-verified against the paid submission at fulfillment (`enforce_amount`).
- PayPal capture amounts are re-verified.
- Purchase terms are frozen before checkout.

### 5.6 Seat-limit race
`SELECT … FOR UPDATE` on the license row (`class-license-server.php:65`).

### 5.7 Abuse controls (weak)
- No rate limiting on the license API, storefront, webhooks, native checkout or customer REST.
- Native free checkout creates WP users (`create_user=1`) protected only by a honeypot, nonce and terms checkbox. This is an account-creation spam vector.
- The access-link request is throttled per email+IP for 5 minutes.
- Guest nonces are shared for user 0.
- **Port:** add per-IP rate limits (license API, checkout, access requests) and Turnstile on native checkout.

### 5.8 Package files
WP releases are **public Media Library attachments**. Anyone who learns the `/wp-content/uploads/…zip` URL bypasses the signed link. The port must use private object storage with no public URL.

### 5.9 Private pages
Private pages get no-cache headers and `Referrer-Policy: no-referrer`. The token sits in the URL query and is repeated in hidden inputs and links.

---

## 6. Known bugs and doc/code mismatches (decide per item: replicate or fix)

1. Validly signed but unhandled webhook events return **401** (§2.8). **Fix** (return 200 ignored).
2. Stripe Checkout Session create has no `Idempotency-Key`, although the docs claim one (`class-stripe.php:117-124` vs `docs/payments/overview.md`). Fix with `sha256("cf-stripe-session-{sid}")`.
3. The success return without `payment_success_redirect` shows nothing, although the help text says it shows the success message (`class-payments.php:157-162`). Fix: show the form's success or pending message.
4. Zero-decimal lists are inconsistent (MGA), the admin plan save ignores the exponent, there's no 3-decimal currency support, and PayPal sends 2 decimals for JPY (§2.3). Fix with one ISO-4217 exponent table.
5. Webhook secrets are shared across test and live (§2.1). Port: `webhook_secret_test` and `webhook_secret_live`, with a legacy fallback.
6. Partial refunds are treated as full refunds for all providers. Port: treat only `amount_refunded == amount` (Stripe `charge.refunded` `refunded:true`; PayPal and Razorpay full amounts) as refunded, and log partial ones. Decide with Gaurav.
7. `wp core-forms doctor` reads `cf_last_webhook_{provider}`, which nothing writes (`src/cli/class-doctor-command.php:215`). Port: record the last verified webhook per provider.
8. The documented heartbeat, runtime metadata and activation rebuild on `check_license` aren't implemented (`docs/licensing/customers.md` vs `class-license-server.php:93-103`).
9. Deactivating via the API on expired or disabled licenses is impossible. `get_version` ignores site activation. Disabled licenses report `license:'expired'`. **Replicate**: clients depend on it.
10. `payment_required` and `payment_polar_product_id` are dead or hidden settings. The Polar ad-hoc checkout shape is unverified.
11. The customer REST and portal leak `orders.source_key` and `payment_id` (`SELECT *`). Fix with an explicit allowlist.
12. `save_customer_profile` never runs for paid purchases, because there's no current user in webhook context.
13. "Latest package" is by `id`, while `product.version` follows the last publish, so replacing an older version desyncs them.
14. License template settings seed the sample catalog as a side effect (`templates.php:954-1006`).
15. A pending payment never expires: there's no job that moves stale `pending_payment` to failed.

---

## 7. Porting to EmDash

### 7.1 Storage (collections) and identity

Use one collection per WP table, with the **same field names**, plus payment fields on submissions. IDs:

- **Preserve the WP numeric IDs** for products (clients send `item_id`), licenses (signed package URLs and portal forms), submissions (Stripe, Razorpay and Polar metadata `cf_submission`; PayPal `custom_id`; `orders.submission_id`), orders, items, plans, packages and activations. Use numeric-string IDs, consistent with forms in 0.1.0 (`plugins/core-forms/src/core/types.ts:11`), and continue new IDs above the WP max.
- **Submissions** (0.1.0 `Submission` has `status: new|read|spam|trash`): add `paymentStatus`, `paymentProvider`, `paymentId`, `paymentAmount` (minor, integer), `paymentCurrency` and `modifiedAt`, plus a **lookup index `(paymentProvider, paymentId)`**. Allow `formId: "0"` (native checkout) and the server-owned data key `_cf_license_checkout`. The 0.1.0 pipeline strips `_` keys from *posted* data; this key is set server-side.
- **Required indexes and uniques:**
  - unique: `licenses.license_key`, `products.slug`, `(plans.product_id, slug)`, `orders.order_number`, `orders.source_key`, `(activations.license_id, site_hash)`, `(packages.product_id, version)`, `subscriptions.license_id`, `fulfillment.submission_id`, `payment_reversals.submission_id`
  - lookups: `licenses.customer_email` (lowercase), `orders.customer_email`, `orders.submission_id`, `licenses.order_item_id`, `activations.license_id+status`, `subscriptions(status, current_period_end)`, `fulfillment(status, next_attempt_at)`
- Customer emails are compared lowercase. Store a normalized `customer_email_key`, because there's no `LOWER(TRIM())` in a key/value store.
- **Settings:**
  - non-secret plugin settings: `payments.mode`, `payments.currency_gateways`, `license_server.{enabled, checkout_page, dashboard_page, support_url}`, `key_policy`
  - plugin secrets: all gateway keys, `webhook_secret(_test|_live)`, `paypal webhook_id`, the new HMAC secret, and **`legacy_wp_auth_salt` / `legacy_wp_nonce_salt`** (§7.6)
- `user_id` columns become legacy references. Keep them, but match customers by email.

### 7.2 Routes (public compatibility map)

| WP URL | EmDash handler | Requirements |
|---|---|---|
| `POST /wp-json/cf/v1/payments/{provider}/webhook` | Webhook receiver | **Raw body bytes plus all headers**, arbitrary status codes. Must stay at this path, or every provider dashboard must be re-pointed |
| `GET\|POST /wp-json/core-forms/v1/{check,activate,deactivate}_license`, `/get_version` | License API | Public, no auth. Parse query, urlencoded, multipart and JSON. **Always 200 JSON.** Exact shapes from §3.9. Allow CORS optionally (WP sends none) |
| `*?edd_action=…` (any path, GET or POST) | Same dispatcher | Needs site-level middleware before page routing. At minimum `/` and `/index.php` |
| `/wp-json/core-forms/v1/storefront[/products[/{slug}]]` | Storefront | CORS `*`, ETag/304, Cache-Control, `X-WP-Total*` |
| `/wp-json/core-forms/v1/customer/licenses` | Customer REST | Token or session |
| `/wp-json/core-forms/v1/commerce/*` | Admin API | EmDash admin auth |
| `/wp-admin/admin-post.php?action=cf_license_package&…` | Package download | Old links live only 15 minutes, so the **legacy path is optional**. New links can use a plugin route, signed the same way |
| `/?cf_payment_return=1&…` | Return handler | Same query contract. New return URLs may use a plugin path |
| `/?product={slug}`, `/?cf_product={slug}` | Virtual product page | Root path with a query parameter. Preserve it (external links) or 301 to a new path |
| `/core-checkout/`, `/license-dashboard/` | Public pages with plugin components | Keep the slugs (links in sent emails). No-cache plus `Referrer-Policy: no-referrer` |
| `admin-post.php` actions `cf_license_checkout`, `cf_license_request_access`, `cf_license_deactivate_site`, `cf_license_cancel_subscription`, `cf_license_save_profile` | Plugin POST routes | Forms are rendered by the plugin, so paths can change. CSRF token needed. **A 303 redirect to an external provider URL is needed** |

**Blocker to resolve with the platform agent:** the 0.1.0 README says "EmDash only lets plugins redirect within the site" (`plugins/core-forms/README.md:84`). Hosted checkout needs either:
- (a) an allowlisted external redirect (Stripe, PayPal, Razorpay and Polar checkout hosts), or
- (b) an interstitial page with a JS or meta-refresh redirect to the provider URL. The AJAX path already works because JS navigates.

### 7.3 Atomicity on D1 / plugin storage

WP relies on MySQL transactions, `GET_LOCK` and `FOR UPDATE`. Replace them with:

- **Seat limit:** a single conditional write. In SQL: `INSERT … SELECT … WHERE (SELECT COUNT(*) … status='active') < limit`, or a Durable Object per license. Note the gotcha that parallel writes wedge local dev.
- **Paid CAS:** `UPDATE … WHERE payment_status NOT IN ('paid','refunded') OR NULL`, and check the changed-row count.
- **Order idempotency:** the unique `source_key`, then insert-or-return-existing.
- **Multi-row fulfillment** (order + items + licenses + subscriptions): D1 `batch()` is atomic but non-interactive. Pre-compute every row and its IDs, then write in one batch. Alternatively, the outbox makes partial failure retryable: keep the order row last, or use a status marker.
- **Locks** (`payment:{id}`, `license:{id}`, `refund-order:{id}`): use outbox lease CAS (already present) plus a per-entity Durable Object, or optimistic version fields.

### 7.4 Private file storage (R2)

- The EmDash media library **rejects ZIP** (project memory: "Media library rejects SVG/DOCX/ZIP by design"). Packages need a **private R2 bucket or prefix** with no public URL.
- Store `object_key`, `size` and `sha256` on the package, and replace `attachment_id` with `file_key`. Keep `legacy_attachment_id` for import.
- **Download:** verify the HMAC and license, then stream `R2Object.body` with `Content-Disposition`.
- **Don't hash per download** (Workers CPU limit). Compute sha256 at upload (R2 `put` with `sha256` checksum) and trust the stored value.
- **ZIP validation in JS** (central directory scan with fflate or unzipit): entry count, path safety, `Plugin Name:` and `Version:` from the first 8 KB of `.php` files, `style.css` `Theme Name:`. Large ZIPs may hit CPU limits, so consider validating in the admin browser plus a server-side central-directory-only scan.
- Icons and gallery images go to the EmDash media library. Map attachment IDs to media IDs or URLs.

### 7.5 Scheduled and background work

| Job | WP | EmDash |
|---|---|---|
| Fulfillment and reversal outbox | every 5 min (`cf_process_queued_actions`), 10 rows per table, stale lease 600 s, retry +300 s, fail after 10 attempts | Cron trigger every 5 min, plus `waitUntil` immediately after the webhook 2xx (don't run actions inside the webhook response path; WP does) |
| Expiry maintenance | daily | daily cron |
| Return-token / pending-payment GC | none | optional: expire `pending_payment` older than N days |
| Renewal reminders | **none** | not in 4.11.1 (new feature if wanted) |
| PayPal OAuth token cache | transient | KV or in-memory with TTL `expires_in − 60` |

### 7.6 Legacy HMAC continuity

Port WP's `wp_salt('auth')`, which is the literal concatenation `AUTH_KEY . AUTH_SALT` from `wp-config.php`, as a secret. Without it:
- 30-day dashboard links already emailed break
- in-flight return tokens fail (harmless)
- legacy package links fail (harmless)

Plan:
- **Verify** with the new secret first, then the legacy secret, and **sign** with the new one.
- After 30 days, drop the legacy secret.
- `wp_salt('nonce')` (`NONCE_KEY . NONCE_SALT`) is only needed to keep `ip_hash` continuity, which is optional.
- Read these values once, read-only, from the server's `wp-config.php`. Don't put them in exports.

### 7.7 Customer identity

There are no WP users in EmDash. Make magic-link the primary login:
- After token verification, set a signed session cookie scoped to the portal, so tokens stop being repeated in links and hidden fields.
- `create_user` becomes "create customer profile record" (a new `customers` collection keyed by email holding first and last name plus `billing_*`).
- Import WP user meta for referenced `user_id`s.
- **Profile editing** (WP: logged-in only) is allowed for verified-session customers. That's a behavior change, so flag it to Gaurav.
- The "Sign in instead" link (WP login) is dropped unless EmDash exposes public user auth.

### 7.8 Rendering imported content

- Imported pages contain `[cf_license_*]` and `[cf_product_gallery]` shortcodes, `<!-- wp:core-forms/license-* -->` blocks, and `[cf_form id]`.
- Extend 0.1.0's `renderFormsInHtml` pattern (`plugins/core-forms/README.md:53-62`) with a commerce expander.
- Add Portable Text block types for the 8 blocks.
- Keep all `cf-license-*` and `cf-portal-*` class names and `license-frontend.css`.

### 7.9 Import plan (WP → EmDash)

1. **Source.** Use Core Forms' own portable export (`src/admin/class-core-data-migration.php`):
   - format `core-forms-data` v1 (`:19-20`)
   - `data.commerce.{cf_license_products, cf_license_plans, cf_license_orders, cf_license_order_items, cf_licenses, cf_license_activations, cf_license_packages, cf_license_subscriptions, cf_license_downloads, cf_license_events}` as **raw rows with IDs; all values are strings**
   - `references.media{attachment_id:{url, filename}}` for icons, gallery images and package ZIPs (`:510-555`, `:1228-1240`)
   - `data.submissions` for payment columns

   It's generated in WP admin (read-only), or via the 0.1.0 approach of a read-only `wp eval-file` script (`plugins/core-forms/wordpress/export-core-forms.php`), extended for commerce tables, `cf_fulfillment` / `cf_payment_reversals` rows not yet `completed`, the key policy option, `license_server` settings, and user meta for referenced users. **Exclude gateway secrets.**
2. **Order:**
   1. products (attach media)
   2. plans
   3. packages (download each ZIP from its public uploads URL into private R2, recompute sha256, **fail on mismatch**)
   4. orders
   5. licenses
   6. order items (re-link `license_id`)
   7. subscriptions
   8. activations
   9. downloads
   10. events
   11. submissions (payment fields)
   12. open outbox rows
3. **Transforms:**
   - Cast numerics. Datetimes stay UTC; keep the `Y-m-d H:i:s` text or convert to ISO, but **API responses must emit `Y-m-d H:i:s`**.
   - `details` and `fulfillment_data` and event `metadata`: parse the JSON.
   - Map `checkout_form_id` and `renewal_form_id` WP post IDs to EmDash URLs (`details.*_url`) when the target is a page.
   - Map `checkout_page_id`.
4. **Verify:**
   - Row counts per table.
   - Every license key is retrievable and every `(license_id, site_hash)` pair is unique.
   - For a sample of keys, call the new `check_license` with stored `site_url` values and compare with the live WP response, run **offline against a local WP copy**, not production.
   - Package sha256 matches.
5. **Cutover:**
   - Point each provider's webhook at the same URL (unchanged path), or update the dashboards.
   - Drain or import pending fulfillment.
   - Copy the legacy salts.
   - Keep WP read-only for refund lookups until in-flight payments settle.

### 7.10 Compatibility contract (must not change)

- License API paths (REST plus `edd_action`), the GET and POST methods, the parameter aliases (`license|license_key`, `item_id|product_id`, `item_name|slug`, `url|site_url`), HTTP 200 for all business results, every JSON key and value listed in §3.9, `expires` as `Y-m-d H:i:s` or `lifetime`, and `item_id` as an integer.
- `sanitize_title` for `item_name`, and `esc_url_raw` → lowercase → untrailingslash → sha256 for the site identity.
- License keys byte-exact and case-sensitive. Product and license IDs preserved.
- Signed package links expire after 15 minutes and are refreshed by `get_version` (clients call it right before download).
- Webhook URL paths and provider metadata keys `cf_submission` and `cf_form_id`. The Stripe `charge.refunded` correlation via `metadata.cf_submission`.
- The storefront JSON shapes, `checkout_url` format `/core-checkout/?cf_product=&cf_plan=`, and the dashboard URL plus `cf_license_access` token format.
- Submit response JSON: `redirect_url`, `payment.{provider, flow, mode, client_secret, publishable_key, return_url, payment_id}` (`inline-payments.js` contract).

### 7.11 Platform capabilities needed (hand-off to the platform agent)

1. Plugin-handled routes at arbitrary public paths (`/wp-json/...`, root `?edd_action`, `?product`, `?cf_payment_return`), or a site-level middleware hook.
2. Raw request body plus headers, and full response control: status, headers, streaming binary, 303 redirects to **external** hosts.
3. Outbound fetch to `api.stripe.com`, `api-m.paypal.com`, `api-m.sandbox.paypal.com`, `api.razorpay.com`, `api.polar.sh` and `sandbox-api.polar.sh`. Browser-side: `js.stripe.com`.
4. Secrets storage. WebCrypto HMAC-SHA256 and SHA-256.
5. Storage with unique constraints, conditional/atomic writes and batch transactions. Optionally a Durable Object for per-license and per-submission serialization.
6. Private R2 objects (put, get-stream, sha256 checksum).
7. Cron: 5-minute and daily. `waitUntil` for background work.
8. `email:send` to arbitrary recipients (customers), plain text.
9. Public pages rendered by plugin components with custom headers (no-cache, no-referrer), plus Portable Text blocks.
10. Admin pages for the commerce workspace, media picker access (icons, gallery), and a content picker (connections).
11. Optional: an MCP/agent tool registry for the 26 abilities.

**WP-only items, not ported:**
- the FluentCart gateway
- the WooCommerce, EDD, SureCart, WP Simple Pay, MemberPress, LearnDash, PMPro and Groundhogg actions
- CommerceCompatibility (foreign-checkout detection, GT Performance cache policy)
- the WP user creation and notification
- the WP-CLI commands
- the Core Forms self-updater (`LicenseManager`)
- the Abilities API (unless EmDash has an equivalent)

### 7.12 Open questions

1. Hosted checkout redirect: does EmDash allow allowlisted external redirects from plugin routes, or must there be an interstitial page?
2. Can a sandboxed plugin (Dynamic Worker) mount `/wp-json/...` and root-query handlers, and read raw bodies? If not, does the site need a thin Astro route or middleware shipped by the package?
3. Partial refunds: keep "any refund = full revoke" (WP behavior) or fix it?
4. Customer accounts: magic-link only, or does EmDash have public user auth to replace "Sign in"? May verified magic-link sessions edit profile and billing data?
5. Fix-or-replicate decisions for §6 items 1–3, 5 and 11 (recommended: fix), and item 9 (recommended: replicate).
6. Will gatilab.com or gauravtiwari.org stores actually move (memory says commerce is deferred)? That determines whether legacy salts and webhook paths matter at launch or can wait.
7. Polar: is the ad-hoc `amount`/`currency`/`name` checkout still accepted? This needs a sandbox test by Gaurav, since this spec made no external calls.
8. Should the port add renewal reminders, pending-payment expiry and license-API rate limiting (new behavior), or ship strict parity first?
