# 05 · Actions, workflows and integrations

Port spec for the Core Forms 4.11.1 action layer: `src/actions/`, `src/workflows/`, `src/integrations/` (incl. `ottokit/`), `extensions/webhooks/`, `extensions/notifications/`, plus `docs/actions/*`, `docs/integrations/*`, `docs/workflows/*`, `docs/developers/custom-actions.md`.

Conventions. WP paths are relative to `.reference/core-forms-wp/`; `file:N` and `file:N-M` are line numbers in that file. EmDash paths are relative to `plugins/core-forms/`. "PHP-empty" means PHP `empty()`: `undefined`, `null`, `false`, `0`, `"0"`, `""`, `[]`. Settings arrive from WP as strings (`"1"`, `"0"`), so every truthiness test in a port must use PHP-empty semantics, not JS truthiness.

---

## 0. Findings at a glance

- **No OAuth anywhere.** Every integration uses a static credential: API key, personal access token, bearer token, HTTP Basic, bot token, webhook URL or shared secret. Google Sheets avoids OAuth on purpose via an Apps Script receiver (`assets/integrations/google-sheets.gs`). No token acquisition or refresh is needed.
- **29 in-scope action types**: 26 outbound HTTP integrations (including `surecontact`, which the task list missed), plus `email`, `autoresponder` and `whatsapp_redirect`. 19 WP-only types (plus the `create_article` alias) are skipped. `issue_license` and `renew_license` are pure Core Commerce, owned by the licensing spec.
- **FlowMattic is not HTTP.** It fires an in-process WordPress action hook that FlowMattic's "Plugin Actions" trigger listens to (`src/actions/class-flowmattic.php:22,37`). It's WP-only, so skip it. OttoKit, AutomatorWP and Uncanny Automator are also in-process trigger bridges, not form actions.
- **Idempotency lives in the execution ledger**, not the queue. Every run claims a unique `run_key` row in `cf_action_logs`, with a lease, step checkpoints and an `uncertain` state that blocks replay until an admin reconciles it (`src/workflows/class-action-runner.php:103-131`, `src/workflows/class-action-logger.php:28-83`).
- **Retry policy**: only `ActionFailure(retryable: true)` retries, which means transport errors, HTTP 408/425/429/≥500, or explicit retryable failures. Backoff is `max(2^attempts × 60 s, Retry-After)` with `max_retries = 3`. A sync failure re-enters the queue with at least a 120 s delay and `attempts = 1` (`class-action-runner.php:57-62`, `class-action-queue.php:206-214`).
- **Logs are never purged in practice.** `ActionLogger::cleanup()` exists (`class-action-logger.php:248-256`) but nothing calls it. The docs claim 90-day cleanup.
- **Inbound endpoints the port must expose**: Resend delivery webhook (Svix HMAC), Meta WhatsApp (GET verify plus POST HMAC-SHA256) and Twilio WhatsApp (HMAC-SHA1 over URL plus sorted params).
- **v0.1.0 has four correctness bugs for imported forms**: it ignores `conditions` (every action fires unconditionally), sends Bcc addresses as Cc, wraps the webhook payload in a new envelope (which breaks existing receivers), and defaults a missing webhook `content_type` to `json` where WP uses `form`.

---

## 1. Action framework

### 1.1 Registration and catalog

- Base class `Core_Forms\Actions\Action` (`src/actions/class-action.php:8-98`). `hook()` registers three things (`:13-17`):
  - the filter `cf_available_form_actions` (`type → label`), which drives the "Add action" grid and decides whether a type counts as available;
  - `cf_output_form_action_{type}_settings` to render the card;
  - `cf_process_form_action_{type}` to run it, with args `($settings, $submission, $form)`.
- Instantiation order is in `core-forms.php:362-500`:
  - core actions `email` and `autoresponder` first;
  - `mailchimp` only when `MC4WP_MailChimp` exists;
  - `mailerpress` and the FluentCart bridge conditionally;
  - `emailit` and `emailit_subscribe` **only when the global `cf_settings.emailit.api_key` is set** (`:384-391`);
  - then Slack, Discord, Telegram, Sheets, Notion, Airtable, Kit, ActiveCampaign, FluentCRM (conditional), Brevo, Drip, MailerLite, HubSpot, Zapier and Make;
  - then the 4.9.5 `ConfiguredAction` set: `mailchimp_api`, `fluent_support`, `n8n`, `pipedrive`, `zendesk`, `resend`, `flowmattic` (`:448-450`), plus the `ResendWebhook` routes (`:451`);
  - then Twilio SMS, WhatsApp Cloud, Twilio WhatsApp, WhatsApp redirect, Fluent Community, Create User, Create Post and Create Comment;
  - finally `IntegrationManager` (`:500`), which registers the 4.4 `NativeAction` set and `WhatsAppInbound`.
- The webhook action loads from `extensions/webhooks/webhooks.php:3-7` via `_load_extensions()` (`core-forms.php:340-341`).
- `type: create_article` is forwarded to the `create_post` handler (`core-forms.php:490-493`).
- Discovery catalog: `cf_form_action_catalog` (`views/tab-actions.php:5-12`, `class-native-action.php:50-53`) lists dependency-gated types even when unavailable. Categories (`views/tab-actions.php` ~`:85-110`):

| Category | Types |
| --- | --- |
| notifications | email, autoresponder, slack, discord, telegram, resend |
| messaging | whatsapp_cloud, twilio_whatsapp, whatsapp_redirect, twilio_sms |
| data | google_sheets, notion, airtable |
| marketing | mailchimp, mailchimp_api, mailerpress, convertkit, activecampaign, brevo, drip, mailerlite, hubspot, pipedrive, fluentcrm, emailit, emailit_subscribe, fluentcart_mailerpress, groundhogg, jetpack_crm, wp_crm_system, surecontact |
| support | fluent_support, zendesk |
| community | fluent_community |
| automation | zapier, make, webhook, n8n, flowmattic, … |

- Docs link per card: `https://core-forms.com/docs/{actions|integrations}/{slug}/`, with aliases `webhook→webhooks`, `emailit_subscribe→emailit` and `create_post→create-post` (`src/integrations/class-action-documentation.php:6-12`).

### 1.2 Base-class contract (three flavours)

| Class | File | Settings UI | Notes |
| --- | --- | --- | --- |
| `Action` (abstract) | `src/actions/class-action.php` | `page_settings($settings,$index)` hand-written HTML | `process(array $settings, Submission, Form)` returns `bool`, `IntegrationResult` or throws. Helpers: `resolve_mappings()` (`:38-40`, uses `FieldMapping::resolve`) and `accept_response()` (`:43-45`, uses `IntegrationHttp::accepted` with `$this->label`). |
| `ConfiguredAction` | `src/integrations/class-configured-action.php:9-60` | `fields(): [key => {label,type,default,required,help,options}]` rendered as a table | Defaults come from `fields()[*].default ?? ''` (`:13-17`). A select keeps a missing saved value as "Unavailable: X" (`:38`). Admin-only "Test action" panel with JSON sample data (`:48-58`). Used by `mailchimp_api`, `n8n`, `pipedrive`, `zendesk`, `resend`, `flowmattic` and `fluent_support`. |
| `NativeAction` | `src/integrations/class-native-action.php:20-138` | config-driven field table | Wraps a handler callable. **Every string setting is data-variable rendered before the handler runs** (`resolve_settings`, `:127-137`). A successful result's `meta.checkout_url` or `meta.redirect_url` becomes the form redirect (`:121-122`). Used by `surecontact`, the licensing actions and the WP-only commerce/CRM set (`src/integrations/class-integration-manager.php:35-108`). |

`render_settings()` (`class-action.php:19-36`) wraps every card:
1. It converts inputs named `email_field`, `name_field`, `first_name_field`, `last_name_field`, `phone_field`, `company_field` and `recipient_routes[*][field]` into `<select>`s of the form's real field names (`FieldMapping::selectors`, `src/integrations/class-field-mapping.php:104-125`). `create_comment` and `mailerpress` are exempt from the required-email rule.
2. It appends hidden `_cf_action_id`, which defaults to `'action-' . $index` (`:29-30`). New cards get `action-<uuid>` from JS (`assets/js/form-actions.js:160-161`).
3. If `ActionRunner::can_queue(type)`, it appends hidden `async=0` plus a checkbox `async=1`, labelled "Run in the background" (`:31-35`).

### 1.3 Stored settings shape

Per form: `form.settings.actions` is a **list**, and its order is execution order. Each element is a flat map of strings, with these exceptions:

| Key | Present on | Meaning |
| --- | --- | --- |
| `type` | all | Action type id. A row without a type is dropped on save (`class-action-settings.php:27`). |
| `_cf_action_id` | all saved via admin | Stable identity (`action-N` or `action-<uuid>`). Used in the run key, Resend webhook URL, queue retry matching and fulfillment refresh. |
| `async` | queueable types | `"1"` means background, `"0"` or absent means inline. PHP-empty test. |
| `conditions` | any | `[{field, operator, value}]`. Operators: `equals`, `not_equals`, `contains`, `not_contains`, `empty`, `not_empty` (`src/functions.php:3019+`, `cf_output_condition_row`). |
| `recipient_routes` | `email` | `[{field, operator, value, recipient}]`. Rows with all of field, value and recipient blank are dropped on save (`class-action-settings.php:36-43`). |
| `_cf_preserve_index`, `_cf_preserve_hash` | transient POST only | Preservation of unavailable cards; stripped on save. |
| `_cf_run_key`, `_cf_execution_version` | queue snapshots only | Run-key override and version. `_cf_execution_version` is never set anywhere in 4.11.1, so it is always `'1'`. |
| `_cf_purchase_terms` | licensing actions in a fulfillment snapshot | Owned by the licensing spec. |

Save pipeline (`src/admin/class-admin.php:1247-1250`, `src/class-rest-forms.php:232-239,293-296`), via `ActionSettings::prepare()` (`src/integrations/class-action-settings.php:33-46`):
1. `restore()` (`:10-31`) drops the literal `$index` key and non-array or typeless rows. It restores unavailable cards from the existing saved copy when `_cf_preserve_hash === sha256(wp_json_encode(original))`. A mismatch returns `cf_action_changed`, which asks the user to reload. Unavailable integrations are therefore **never edited and never lost**.
2. `email.recipient_routes` blank rows are filtered.
3. `FieldMapping::validate` (`class-field-mapping.php:82-101`) runs only for available types. Every mapping key in `KEYS` (`:10`) must name an existing form field (with a unique case-insensitive alias rewritten to the exact name). An empty `email_field` is an error except for `create_comment` and `mailerpress`.

**Import rule for EmDash.** Keep every action object verbatim, including unknown keys and WP-only types. Don't coerce `"0"`/`"1"` strings away. If you normalise, normalise `async`, `include_metadata`, `double_optin` and similar with PHP-empty semantics. Set `_cf_action_id ??= 'action-' + index` (0-based) so Resend webhook URLs and ledger identity match.

### 1.4 Ordering, enabling, removing, copying

- Order is the stored list order. There is no reordering UI: new cards are appended and cards can only be removed (`assets/js/form-actions.js:176`). There is no `enabled` flag in WP; removing the card is the off switch. v0.1.0's `enabled` field is an EmDash extension, so default it to `true`.
- An unavailable type renders a warning card with only the preserve inputs (`views/tab-actions.php:170-190`). It never executes: `ActionRunner::execute` logs `failed` with "No available handler is registered for this action." (`class-action-runner.php:83-88`).
- Cross-form copy (`src/workflows/class-rest-action-editor.php:17-90`, `src/integrations/class-action-copy.php:9-43`):
  - `GET actions/copy/sources?page&search&target_id` lists forms, 20 per page.
  - `POST actions/copy/source {source_id}` returns `[{index, fingerprint, label, available}]`.
  - `POST actions/copy/prepare {source_id, target_id, selected:[{index,fingerprint}], start_index}` checks 1–50 selections and fingerprints, and refuses unavailable types. It assigns each copy a new `_cf_action_id = 'action-<uuid4>'`, strips `_cf_run_key`/`_cf_preserve_*`, and returns rendered cards plus `missing_fields`. The `missing_fields` scan skips keys matching `/token|secret|password|api_key/i` and tokens `CF_*`, `all` and `all:label`.
  - Permission: `edit_forms && manage_options`.

### 1.5 Conditional execution

`cf_evaluate_action_conditions($conditions, $data)` (`src/functions.php:2939-2986`):
- Empty or non-array conditions pass.
- Each row needs non-empty `field` and `operator`, otherwise it's ignored.
- `actual = data[field] ?? ''`. Arrays are joined with `', '`. The key match is exact, with no case alias.
- `equals` and `not_equals` use strict string identity. `contains` and `not_contains` compare `strtolower` (byte-wise ASCII) substrings, so an empty expected value makes `contains` pass. `empty` and `not_empty` compare against `''`.
- **An unknown operator fails the row**, because the switch has no default and `$pass` stays false.
- All rows are ANDed.

Where conditions are checked:
- At submit (`src/class-forms.php:1104-1110`), skipped silently.
- At replay after un-spam (`src/functions.php:2787-2822`), logged as `skipped` with reason `conditions_not_met` (`:2833-2850`).
- At fulfillment (`src/workflows/class-fulfillment.php:177`).
- **Again at queue execution time** (`src/workflows/class-action-queue.php:184-186`), which gives `skipped` "The current action conditions were not met."
- Email `recipient_routes` reuse the same evaluator per route (`src/actions/class-email.php:203-218`).

### 1.6 Field mapping and data-variable rendering

Base renderer: `cf_replace_data_variables($string, $submission, $escape)` (`src/functions.php:701-848`).
- The regex is `/\[(.+?)\]/`.
- `CF_*` tokens: TIMESTAMP, USER_AGENT, IP_ADDRESS, REFERRER_URL/HOST/PATH, POST_ID/TITLE/URL, SUBMISSION_ID, USER_ID/LOGIN/EMAIL/DISPLAY_NAME, DATE, TIME, SITE_NAME/URL, ADMIN_EMAIL, FORM_ID/TITLE and PAYMENT_STATUS/PROVIDER/ID/CURRENCY/AMOUNT/AMOUNT_FORMATTED.
- `[all]` and `[all:label]` come from `cf_format_all_fields` (`:858-892`). With `esc_html` the lines are `<strong>L:</strong> v` joined by `<br />`; otherwise `L: v` joined by `\n`.
- Other keys: spaces become `_`, then `cf_array_get` with **dot-notation** (`:627-645`), then `cf_field_value` (`:1025+`). That function joins arrays with `', '`, renders files as `<a>` links, and reformats date-looking values with WP `date_format`.
- **A missing field renders as `''`.** The template rules belong to the template spec; this section only covers what actions add on top.

Mapping helpers, all in `src/integrations/`:
- `FieldMapping::match($key, $names)` (`class-field-mapping.php:47-52`): exact name first, otherwise a unique case-insensitive match, otherwise `null`.
- `FieldMapping::resolve($settings, $submission)` (`:54-69`): for each `KEYS` mapping, rewrites it to the exact submitted name. A generic default (`name`, `first_name`, `last_name`, `phone`, `company`) that is absent becomes `''`. Any other missing mapping throws non-retryable `ActionFailure` "The mapped field "%s" is not present in this submission.". Used by `autoresponder`, `hubspot`, `convertkit`, `activecampaign`, `brevo`, `drip`, `mailerlite`, `mailchimp_api`, `emailit_subscribe`, `pipedrive` and `zendesk`.
- `FieldMapping::tags($text)` (`:71-76`): rewrites `[Email]` to `[email]` when a unique alias exists. Applied by `ActionPayload::text`, `NativeAction` and `resend.message`. The legacy actions (`email`, `slack`, Twilio, WhatsApp) do **not** alias.
- `ActionPayload` (`class-action-payload.php`):
  - `text()` = tags + replace, no escape (`:12-14`);
  - `required()` (`:16-20`);
  - `email()` rejects CR/LF and invalid addresses (`:22-26`);
  - `field()` takes the raw value of the mapped field, which must be scalar (`:28-33`);
  - **`json()`** (`:36-52`) parses first, then resolves leaves. An exact `"[FIELD]"` leaf returns the **typed** value (array, number, null preserved; files reduced to `name, original_name, size, type, url`). `"[CF_SUBMISSION_ID]"` becomes an int. A missing exact token throws. Other strings go through `text()`;
  - `selected(fields)` (`:63-74`): `*` means all fields, otherwise a comma or newline list resolved via `match`; internal `_*` and password-ish names are dropped;
  - `event()` (`:76-83`): `{event:'core_forms.submission', event_id, form_id, form_title, form_slug, submission_id, submitted_at, entry}`;
  - `positive_id()` (`:85-88`);
  - `api(url, method, headers, body, service)` (`:90-94`): JSON, `timeout 20`, `redirection 0`, then `IntegrationHttp::json`.
- `DestinationFields` (`class-destination-fields.php`): `mapping()` parses `form_field=Target` lines and throws on malformed lines (`:12-29`). It also does typed conversion for Notion (`:92-122`) and Airtable (`:124-145`). `schema()` caches the provider schema for 120 s, keyed by `sha256(url + json(headers))` (`:147-157`).

Per-action templating and escaping:

| Action | Templated settings | Escape | Case alias |
| --- | --- | --- | --- |
| email | to, subject, from, each header line | `cf_esc_email_header`: strip tags, collapse `[\r\n\t]+` to a space, trim (`functions.php:3957-3964`) | no |
| email | message | `esc_html` if `text/html`, else none, with `<br />` removed | no |
| autoresponder | subject (header-escaped), message (`esc_html` if HTML; plain turns `<br />` into `\n`) | as listed | `email_field` via resolve |
| webhook, zapier, make, google_sheets, discord | none (raw submission data) | n/a | n/a |
| slack | message (none); default builder runs `esc_html` on title, keys and values | n/a | no |
| telegram | message: each token replaced then `htmlspecialchars(ENT_QUOTES\|ENT_SUBSTITUTE)` in HTML mode | per token | no |
| emailit | from, to, subject, reply_to (header); message (`esc_html`/none) | as listed | no |
| emailit_subscribe | `custom_fields` values (`strip_tags`) | strip_tags | field names via resolve |
| resend, pipedrive, zendesk, n8n, flowmattic, mailchimp_api | `ActionPayload::text` and `json` | none (typed JSON) | yes |
| twilio_sms, twilio_whatsapp, whatsapp_cloud | to_number, message, content_variables values, template_body parts | none | no |
| whatsapp_redirect | message only; `to_number` is **literal** | none | no |
| surecontact (NativeAction) | **every** string setting, including `api_key` | none | yes |

### 1.7 Execution paths: what runs sync and what runs async

1. **Submit, non-payment form** (`src/class-forms.php:1098-1112`). The submission is saved, then `do_action('cf_form_success')` runs. That fires OttoKit, AutomatorWP and Uncanny triggers and the notifications counter. Then each action whose conditions pass goes through `ActionRunner::dispatch($settings, $submission, $form, $index)`. All of this happens **inline, sequentially, before the JSON response is built**. The response's `redirect_url` comes afterwards from `apply_filters('cf_form_redirect_url', …)` (`:1262-1267`), so redirect-producing actions must finish inline. Spam submissions never reach the action loop.
2. **`dispatch()`** (`class-action-runner.php:48-64`) sets `_cf_action_id ??= (string)$index` and `_cf_run_key = execution_key()`. Then:
   - if the type is queueable **and** `submission.id > 0` **and** `async` is truthy, it enqueues and returns `queued`;
   - otherwise it calls `execute()`. If that fails and `meta.retryable` is set and the action is queueable, it enqueues with `delay = max(120, retry_after)` and `attempts = 1`, and returns `queued`.
3. **Queueable types** (`ActionRunner::can_queue`, `:25-35`): `issue_license`, `renew_license`, `email`, `autoresponder`, `mailchimp`, `mailchimp_api`, `mailerpress`, `emailit`, `emailit_subscribe`, `slack`, `discord`, `telegram`, `google_sheets`, `notion`, `airtable`, `convertkit`, `activecampaign`, `fluentcrm`, `brevo`, `drip`, `mailerlite`, `hubspot`, `zapier`, `make`, `webhook`, `twilio_sms`, `whatsapp_cloud`, `twilio_whatsapp`, `fluent_community`, `groundhogg`, `jetpack_crm`, `wp_crm_system`, `surecontact`, `fluent_support`, `n8n`, `pipedrive`, `zendesk`, `resend`, `flowmattic`. **Never queued**: `whatsapp_redirect`, `create_*`, `woocommerce`, `edd`, `surecart`, `wp_simple_pay`, `memberpress`, `learndash`, `pmpro`. These produce redirects or create accounts or content.
4. **Unsaved submissions** (`save_submissions` off) always run inline with no retry. The run key uses `ephemeral:<uuid>` (`:39-42`).
5. **Payment forms** don't run actions at submit. Fulfillment (`class-fulfillment.php:174-188`) runs `cf_form_success`, the actions and `cf_payment_completed` after a verified paid webhook, from a purchased-definition snapshot. That flow is owned by the payments spec, but it goes through the same `dispatch()` and ledger.
6. **Replay after un-spam**: `cf_replay_submission_actions` (`functions.php:2787-2822`). The ledger suppresses runs that already completed.
7. **Admin test**: `POST cf/v1/actions/test` (`class-rest-workflows.php:137-200`), `manage_options` only. Body is `{action_type, settings, form_id, test_data}`. `test_data` defaults to `FieldMapping::samples` (`class-field-mapping.php:25-45`) and must be a JSON object. It runs `ActionRunner::test()` with `submission.id = 0`, which sets `is_testing()` (n8n allows `/webhook-test/` URLs). It returns `{payload, hook, success, status, message, retryable}`; `payload` and `hook` are set only for flowmattic. The client posts only flat `form[settings][actions][i][key]` inputs (`assets/js/integration-actions.js:22-27`), so nested `conditions` and `recipient_routes` aren't sent.
8. **Rehearsal**: `POST cf/v1/forms/{id}/rehearsal {data, revision_id?}` (`class-rehearsal.php:13-60`) is a pure plan. For each action it returns `{index, type, outcome: would_run|would_skip, handler_available, destination}`. `destination` renders keys `to, email, recipient, recipients, url, webhook_url, chat_id, list_id, database_id, board_id`; URL keys are reduced to `scheme://host/…`.

### 1.8 Result model and error handling

- `IntegrationResult` (`src/integrations/class-integration-result.php:9-35`) has `{success, message, meta, status}`. Possible `status` values are `success`, `failed`, `queued`, `skipped`, `unverified` and `uncertain`. `state()` sets `success = status ∈ {success, queued, skipped}`.
- `ActionRunner::normalize()` (`class-action-runner.php:171-189`):
  - a `WP_Error` becomes failure;
  - `false`, `0` or `{success:false}` become failure with the generic text "The action handler reported a failure…";
  - `null` becomes `unverified`;
  - `true`, a positive int or `{success:true}` become success with "provider acceptance does not confirm final delivery";
  - anything else becomes `unverified`.
- **Legacy `return false`** (for example a missing webhook URL, an invalid email or an SSRF block) is a **non-retryable failure**.
- `ActionFailure(message, retryable=false, retry_after=0)` (`src/workflows/class-action-failure.php:6-15`) clamps `retry_after` to 0–3600. Any other `Throwable` is non-retryable. `DeliveryUncertain` (`class-delivery-uncertain.php`) becomes status `uncertain`.
- `IntegrationHttp::accepted($response, $label)` (`src/integrations/class-integration-http.php:8-24`):
  - a `WP_Error` (transport) throws retryable "%s could not reach the provider.";
  - a non-2xx response throws "%s rejected the request (HTTP %d).". It's retryable iff the code is 408, 425, 429, ≥500 or 0. `retry_after` comes from `Retry-After`, either delta-seconds or an HTTP-date minus now;
  - a 2xx JSON body with `ok === false`, `success === false` or `status === 'error'` throws non-retryable "%s reported that the operation failed.";
  - `json()` (`:26-33`) also requires a JSON object.
  - **Response bodies are never copied into messages.**
- Hook capture (`invoke_hook`, `class-action-runner.php:134-169`): every callback on `cf_process_form_action_{type}` runs. Each non-null return is normalised. The first failure wins; otherwise the last result counts. With no results the outcome is `unverified`.
- Redaction (`:208-216`): every settings value of length ≥ 4 whose key matches `/key|token|secret|password|auth|url/i` is replaced with `[redacted]` in the message. The message is then tag-stripped and truncated to 1000 characters.
- Each action is independent: `once()` catches every throwable, so one failure never stops the loop.

### 1.9 Redirect-producing actions

`IntegrationManager::set_redirect()` (`src/integrations/class-integration-manager.php:21-25`) handles `NativeAction` `checkout_url`/`redirect_url`. `WhatsAppRedirect` registers a one-shot `cf_form_redirect_url` filter keyed by `spl_object_id($submission)` (`src/actions/class-whatsapp-redirect.php:101-117`). Both need the action to finish **before** the response is built. In EmDash these must run in the request, before `processSubmission` returns, and not in `after()`.

---

## 2. Workflows

### 2.1 Execution ledger and idempotency

- **Run key** (`class-action-runner.php:37-46`): if `_cf_run_key` matches `/^[a-f0-9]{64}$/`, use it. Otherwise:
  `sha256(form.ID | ("stored:"+submission.id | "ephemeral:"+uuid4) | (_cf_action_id ?? type) | type | (_cf_execution_version ?? "1"))`.
  The settings **content is not part of the key**, so a changed configuration reuses the key. This contradicts `docs/integrations/reliability.md`.
  The key is also exposed as `X-CF-Event-Id` (webhook), `X-Core-Forms-Event-Id` and `event_id` (n8n, FlowMattic), `Idempotency-Key: cf-<key>` (Resend) and `external_id: core-forms-<key>` (Zendesk).
- **Claim** (`ActionLogger::reserve`, `class-action-logger.php:28-55`):
  1. `INSERT IGNORE` a row `(run_key, form_id, submission_id, action_type, status='processing', message=<lease uuid>)`. **The `message` column doubles as the lease token while a row is processing.**
  2. If the row already exists: `success` or `unverified` means `complete` (the runner returns `skipped` "This action was already completed."). `uncertain` means `uncertain`.
  3. If the row is still `processing` past `cf_action_claim_timeout` (600 s, minimum 60), it **moves to `uncertain`, not reclaimed**.
  4. If the row is `failed` or `skipped`, it is reclaimed with a new lease. Previous `meta.steps` carry over, so the run resumes.
  5. Otherwise the result is `busy`, which the runner returns as a retryable failure with `retry_after` 120.
- **Finish** (`:58-64`) updates only when `status='processing' AND message=<lease>`. If zero rows change, the run becomes `uncertain` "Provider outcome could not be recorded" (`class-action-runner.php:129`).
- **Steps** (`ActionRunner::step($name, fn)`, `:192-206`) memoise small results such as IDs inside `meta.steps` and checkpoint them on each step (`ActionLogger::checkpoint`, `:66-72`, which also refreshes `created_at`, so it extends the lease). A failed checkpoint throws `DeliveryUncertain`. Step names in use:

| Action | Steps |
| --- | --- |
| convertkit | `form_<id>`, `tag_<id>` |
| activecampaign | `contact`, `list_<id>`, `tag_<id>` |
| resend | `resend_email` |
| pipedrive | `pipedrive_organization`, `pipedrive_person`, `pipedrive_record`, `pipedrive_activity` |
| zendesk | `zendesk_upload_<sha256(path\|Y-m-d)>`, `zendesk_ticket` |

- **Enqueue identity**: queue insertion is itself a ledger run under `sha256('enqueue|' + key)` (`class-action-runner.php:66-78`), so an outbox retry can't add a second queue row.
- **Reconcile** (`ActionLogger::reconcile`, `:75-83`): `uncertain` becomes `success` ("An administrator confirmed provider delivery.") or `failed` ("…may be retried."). Only the Recovery page can do this.
- Guarantee: at-most-once *claim* per key, and **at-least-once** delivery to providers without native idempotency. Resend (Idempotency-Key, 24 h) and Zendesk (external_id lookup) recover across retries; Pipedrive and ActiveCampaign rely on step checkpoints.

### 2.2 Queue (`src/workflows/class-action-queue.php`)

Table `{prefix}cf_action_queue` (`:347-373`):

| Column | Type | Notes |
| --- | --- | --- |
| id | INT UNSIGNED AI PK | |
| form_id | INT UNSIGNED | |
| submission_id | INT UNSIGNED | must be > 0 (`:79`) |
| action_type | VARCHAR(50) | |
| action_settings | LONGTEXT | JSON snapshot **including secrets** and `_cf_run_key` |
| status | VARCHAR(20) | `pending` \| `processing` \| `completed` \| `failed` \| `retrying` |
| priority | INT, default 10 | always 10 from dispatch |
| attempts | INT UNSIGNED, default 0 | |
| max_retries | INT UNSIGNED, default 3 | `MAX_RETRIES` |
| last_error | TEXT NULL | **doubles as the claim id `cf_<uniqid>` while processing** |
| scheduled_at, started_at, completed_at | TIMESTAMP NULL | UTC |
| created_at | TIMESTAMP | |

Indexes: `idx_status(status)`, `idx_form(form_id)`, `idx_scheduled(status, scheduled_at)`.

Scheduling: a custom WP-Cron schedule `cf_every_five_minutes` (300 s) runs the hook `cf_process_queued_actions`, scheduled on `init` (`:37-64`). `Fulfillment::process` also hangs off the same hook at priority 20 (`class-fulfillment.php:16`). It's traffic-triggered unless the site runs system cron. **Action Scheduler is not used.**

`process_queue($batch = 10)` (`:101-141`):
1. Run `recover_stale()`.
2. Claim atomically: `UPDATE … SET status='processing', last_error=<claim>, started_at=now WHERE status IN ('pending','retrying') AND (scheduled_at IS NULL OR scheduled_at <= now) ORDER BY priority, created_at LIMIT 10`.
3. Select the claimed rows by claim id.
4. Call `process_item` on each.

`process_item` (`:148-224`):
- Re-check ownership.
- Load the submission. Load the form from the fulfillment snapshot if one exists, otherwise from the live form or the payments orchestrator.
- Force `settings.type = action_type`.
- **Re-evaluate conditions**, then call `ActionRunner::execute`.
- On success: `ActionLogger::log(queue_id, …, result.status, message)` and set the row `completed`.
- On a throwable: `attempts++` and log `failed`.
  - If it's a retryable `ActionFailure` and `attempts <= max_retries`, set `status='retrying'` and `scheduled_at = now + max(2^attempts × 60, retry_after)`.
  - Otherwise set `failed` and `completed_at`.

Worked timeline:
- Async action that fails retryably every time: attempt at T0, then retries at about T0 + 2, + 4 and + 8 minutes (rounded up to cron ticks), then `failed`. That's **4 executions**.
- Sync failure followed by queue: inline run at T0 (attempts recorded as 1), queue at T0 + max(120 s, RA), then + 4 min, then + 8 min, then `failed`. Also **4 executions**.

`recover_stale()` (`:236-278`): rows in `processing` with `started_at` older than `cf_action_queue_stale_minutes` (10) get `attempts+1` and become `retrying` now, or `failed` if over budget. The message is "Recovered from stale processing state.". The matching ledger row turns `uncertain` after 600 s, so the next execution returns `uncertain`, the row goes `failed`, and an admin has to reconcile.

Manual retry (`ActionQueue::retry`, `:286-313`) works only on `failed` rows:
- For licensing rows with `_cf_purchase_terms`, it resets the immutable snapshot.
- Otherwise it reloads the form (draft) and finds the **unique** current action with the same type and `_cf_action_id` (falling back to the index). It replaces the snapshot with current settings but **keeps `_cf_run_key`**, then resets `attempts=0`, `status='retrying'` and `scheduled_at=now`. An ambiguous or removed action refuses the retry.

`get_stats()` (`:320-342`) returns counts per status, scoped by TeamInbox.

### 2.3 Logs (`src/workflows/class-action-logger.php`)

Table `{prefix}cf_action_logs` (`:278-302`):

| Column | Type | Notes |
| --- | --- | --- |
| id | INT UNSIGNED AI PK | |
| run_key | CHAR(64) NULL, **UNIQUE** | ledger rows only |
| queue_id | INT UNSIGNED NULL | event rows written by the queue worker |
| form_id, submission_id | INT UNSIGNED | 0 for tests |
| action_type | VARCHAR(50) | also pseudo-types `cf_form_success`, `cf_payment_completed`, `cf_payment_refunded`, `resend_event`, `resend_delivery` |
| status | VARCHAR(20) | `processing`, `success`, `failed`, `skipped`, `unverified`, `uncertain`; Resend delivery adds `sent`, `delivered`, `delayed` |
| message | TEXT | the lease uuid while processing; redacted text otherwise |
| meta | LONGTEXT JSON | result meta + `steps`, `retryable`, `retry_after`, provider IDs |
| created_at | TIMESTAMP | ledger: claim time / last checkpoint |

Indexes: `idx_form`, `idx_submission`, `idx_status`, `idx_type_status`, `idx_run_key` (unique).

There are two row kinds:
1. **Ledger rows** (`run_key` set), one per action execution key. They're written by `reserve`, `checkpoint` and `finish_run`.
2. **Event rows** (`run_key` NULL), written by `log()` (`:112-136`): queue outcomes, the no-handler failure (`class-action-runner.php:86`), replay skips and Resend delivery events.

Reads, all scoped by `TeamInbox::sql_scope('form_id')`:
- `get_for_submission` (`:144-155`)
- `get_for_form` with pagination (`:165-187`)
- `get_recent_failures(20)` (`:195-206`)
- `get_stats` (`:214-240`), which returns `{total, success, failed, by_type}`
- `hydrate` (`:261-273`) masks a processing row's message as "Processing action."

Retention: `cleanup($days = 90)` deletes only `run_key IS NULL` rows and **has no caller**. In practice rows are removed only by privacy erasure of the submission (`src/admin/class-privacy-controls.php:140`) or uninstall (`uninstall.php:65-66`). Privacy retention also skips submissions with queue rows in `pending`, `retrying`, `processing` or `uncertain` (`class-privacy-controls.php:107,191`).

Separate tables touched by actions (schema owned by other specs):
- `cf_email_logs`, via `cf_log_email` and `cf_update_email_log_status` (`functions.php:3676,3729`). Used by `email`, `autoresponder`, `emailit`, `twilio_whatsapp` and `whatsapp_cloud`.
- `cf_submission_replies` (`functions.php:3424-3449`): `direction`, `channel`, `provider`, `provider_message_id` (UNIQUE with provider), `status`, `from_email`, `to_email`, `subject`, `message`, `payload`, `user_id`, `sent_at`. Written by both WhatsApp senders and both inbound endpoints.

### 2.4 Recovery and admin surfaces

`Recovery` (`src/workflows/class-recovery.php:7-63`) is the admin page "Delivery recovery", with `manage_options`. It lists up to 50 each of: `uncertain` ledger rows, failed or uncertain fulfillment and refund rows, and failed queue rows. `POST admin_post_cf_recover_delivery` handles three kinds:
- `reconcile` needs `provider_checked`, an evidence string of 8–500 characters that must not match `/Bearer\s|sk_(live|test)_|api[_-]?key\s*[:=]|password\s*[:=]/i`, and an outcome of `delivered` or `not_delivered`. It fires `cf_delivery_reconciled`.
- `queue` is refused if the submission has any uncertain run, then calls `ActionQueue::retry`.
- `fulfillment` and `refund` call `Fulfillment::retry`.

### 2.5 REST surface in this area

| Method & route | Handler | Permission |
| --- | --- | --- |
| GET `cf/v1/action-logs?form_id&submission_id&status&per_page(≤100)&page` | `RestWorkflows::list_logs` (`class-rest-workflows.php:94-110`); `status` is declared but **ignored** | `edit_forms` + TeamInbox scope |
| GET `cf/v1/action-logs/stats?form_id` | `get_log_stats` | same |
| GET `cf/v1/action-logs/failures` | `get_failures` (20) | `edit_forms` |
| GET `cf/v1/action-queue/stats` | `get_queue_stats` | `edit_forms` |
| POST `cf/v1/action-queue/{id}/retry` | `ActionQueue::retry`, returns `{retried:true}` or 400 `retry_failed` | `edit_forms` + entry access |
| POST `cf/v1/actions/test` | §1.7 | `manage_options` |
| GET/POST `cf/v1/actions/copy/{sources,source,prepare}` | §1.4 | `edit_forms && manage_options` |
| POST `cf/v1/actions/telegram/setup {bot_token, operation: verify\|chats}` | `Telegram::inspect` | `edit_forms && manage_options` |
| POST `cf/v1/forms/{id}/rehearsal` | §1.7 | TeamInbox access |
| POST `cf/v1/resend/{form_id}/{action_id}` | §3.27 | **public** (signature) |
| GET/POST `core-forms/v1/whatsapp/meta`, POST `core-forms/v1/whatsapp/twilio` | §3.28 | **public** (signature) |
| AJAX `wp_ajax_cf_whatsapp_cloud_test` | §3.25 | `edit_forms` + nonce |

### 2.6 Webhook signatures (outbound)

`WebhookSigner::sign($payload, $secret, $ts = time(), $key_id = 'default')` (`src/workflows/class-webhook-signer.php:34-51`):
- `X-CF-Signature: sha256=` followed by lowercase hex of `HMAC-SHA256(key = secret as raw UTF-8 bytes, msg = "<ts>.<body>")`
- `X-CF-Timestamp: <unix seconds>`
- `X-CF-Key-Id: <key id>` (an empty value becomes `default`)

The webhook action sets the key id from `sanitize_key(webhook_key_id)`, which keeps lowercase `a-z0-9_-` only (`extensions/webhooks/src/Action.php:155`).

Canonicalisation: none. The signed bytes are exactly the bytes sent. For `content_type=form` with a secret, the body is first serialised with `http_build_query($body, '', '&')` (`:152-154`), so signing and sending use the same string. `verify()` (`:67-95`) checks a ±300 s tolerance, accepts a secret string or a resolver callable for rotation, and compares with `hash_equals`. `generate_secret()` returns 64 hex characters (`:102-104`). The plugin never calls `verify()` or `generate_secret()`; they exist for receivers and docs.

Secret storage: plaintext in the action settings inside post meta `_cf_settings`, exported with the form. The UI uses a password input whose value is echoed back to admins.

`X-CF-Event-Id: <run key>` is always sent, signed or not (`Action.php:150`).

Inbound verification schemes, for reference in §3.27–3.28:

| Endpoint | Scheme |
| --- | --- |
| Resend | Svix: `base64(HMAC-SHA256(base64decode(secret without "whsec_"), "<svix-id>.<svix-timestamp>.<body>"))` compared with each space-separated `v1,<sig>` in `svix-signature`; ±300 s |
| Meta | `X-Hub-Signature-256 == "sha256=" + hex(HMAC-SHA256(app_secret, raw body))` |
| Twilio | `X-Twilio-Signature == base64(HMAC-SHA1(auth_token, URL + Σ sorted(key+value)))` |

### 2.7 Notifications extension

`extensions/notifications/` holds no outbound notifications. It's an admin "unseen submissions" badge:
- form default setting `enable_notifications = 1` (`extensions/notifications/src/Notifier.php:12-15`);
- on `cf_form_success`, when `save_submissions && enable_notifications`, the submission id is appended to post meta `_cf_unseen_submissions`, pruned against existing rows (`extensions/notifications/src/functions.php:54-106`);
- the admin menu badge, row highlight and bulk "Mark as read/new" actions set submission status (`extensions/notifications/src/Admin.php:9-187`).

v0.1.0 already derives unread counts from `status:"new"`. Import should keep `enable_notifications` and treat it as a display toggle only.

---

## 3. Integrations: behaviour reference

Shared format: **Keys** list `key = default` in the order of `get_default_settings()` or `fields()`. "Returns false" means a non-retryable generic failure via `normalize`. Unless stated otherwise, HTTP status handling is `accept_response` (§1.8). Timeouts are WP `timeout` seconds; WP's default is 5 s with 5 redirects.

### 3.1 `email`: Send Email (`src/actions/class-email.php`)
- **Keys** (`:20-36`):
  - `from = admin_email`, `to = admin_email`;
  - `subject = "New submission: {form title}"` (only in the admin; at runtime the default is `''`);
  - `message = "[all:label]"`;
  - `headers = "Reply-To: [<name>] <[<email>]>"` built from detected fields (admin only);
  - `content_type = "text/html"`;
  - `recipient_routes = []` (UI `:98-133`).
- **Process** (`:189-298`):
  1. Return false if the raw `to` or `message` is empty.
  2. The first matching route with both `field` and `recipient` replaces the `to` template.
  3. `to` goes through header-escaping, then filter `cf_action_email_to`. `subject` goes through header-escaping and `cf_action_email_subject`.
  4. `message` gets `esc_html` if HTML. In plain mode `'<br />'` is removed. Then `cf_action_email_message`.
  5. `headers` split on `PHP_EOL`; each line is rendered and header-escaped, and blank lines are dropped. Any header is allowed: Reply-To, Cc, Bcc or custom.
  6. Append `Content-Type: <type>; charset=<blog charset>` and, if `from` is set, `From: <rendered from>` (filter `cf_action_email_from`).
  7. Write the email log (pending, then sent or failed with the mail error), then `wp_mail(to, …)`. `to` may be a comma list, and every address is a To recipient.
  8. Return the `wp_mail` bool. A failure is non-retryable unless queued.
- **EmDash**: `ctx.email.send` has no From; the provider plugin owns the sender. You need multi-recipient To, Reply-To, Cc and **Bcc kept as Bcc**. Custom headers can be dropped, but log that they were.

### 3.2 `autoresponder`: Auto-Responder (`src/actions/class-autoresponder.php`)
- **Keys** (`:17-29`): `email_field = <detected email field>`, `from_name = blogname`, `from_email = admin_email`, `reply_to = admin_email`, `subject = "Thank you for your submission"`, `message` = a multi-line thank-you text containing `[all]` (`:31-39`), `content_type = "text/html"`.
- **Process** (`:108-194`):
  1. `resolve_mappings`: a missing mapped field throws a non-retryable `ActionFailure`.
  2. Return false if `email_field` or `message` is empty, or if `data[email_field]` isn't an `is_email` string.
  3. `to = sanitize_email` (filter `cf_action_autoresponder_to`).
  4. `subject` is header-escaped. `message` gets `esc_html` if HTML; in plain mode `'<br />'` becomes `"\n"` (the email action removes it instead).
  5. Headers: `Content-Type`, `From: <from_name> <from_email>` (both header-escaped), and `Reply-To: <reply_to>` (raw value, header-escaped, no variables). Filter `cf_action_autoresponder_headers`.
  6. Write the email log, then `wp_mail`.

### 3.3 `webhook`: Trigger Webhook (`extensions/webhooks/src/Action.php`)
- **Keys** (`:21-32`): `url = ""`, `content_type = "form"` (`json` \| `form`), `auth_header_name = ""`, `auth_header_value = ""`, `webhook_secret = ""`, `webhook_key_id = "default"`.
- **Process** (`:97-170`):
  1. Return false if `url` is empty or `!cf_is_safe_outbound_url(url)`. That check (`src/functions.php:3966-4026`) requires an http or https scheme, rejects `localhost`, resolves A and AAAA records and requires every IP to be outside private and reserved ranges. An unresolvable host is rejected unless the `cf_outbound_url_allow_unresolved` filter allows it.
  2. Headers: `Referer: site_url()`. Add `<auth_header_name>: <auth_header_value>` only when both are non-empty after stripping CR/LF and trimming.
  3. Body:
     - `json` sends `Content-Type: application/json` and body `json_encode($submission->data)`. That's the **raw field map, with no metadata**; PHP escapes `/` as `\/` and non-ASCII as `\uXXXX`.
     - `form` sends `application/x-www-form-urlencoded` with the PHP array body, which WP encodes with `http_build_query` (`a[0]=x&a[1]=y`, `+` for spaces). File values are nested arrays and include server paths (`dir`).
  4. Filter `cf_webhook_request_args`, then set `X-CF-Event-Id`, then sign (§2.6).
  5. `wp_remote_post`: 5 s timeout, follows redirects. Then fire `cf_webhook_response`, then `accept_response`.
- **Port**: keep the raw-data payload and PHP `http_build_query` encoding byte-compatible with existing receivers. Send public file descriptors instead of `dir` (`ActionPayload::public_value`); see Q6.

### 3.4 `slack`: Send to Slack (`src/actions/class-slack.php`)
- **Keys** (`:15-23`): `webhook_url`, `channel = ""` and `icon_emoji = ":envelope:"` (neither is in the UI), `username = "Core Forms"`, `message = ""`.
- **Auth**: the incoming-webhook URL is the secret.
- **Request** (`:56-92`): `POST webhook_url` JSON `{text, username: username ?: "Core Forms", icon_emoji: icon_emoji ?: ":envelope:", channel?}`, timeout 15.
  - Empty message: the text is `"*" + esc_html(title) + "* — New submission"`, then one line per field, `"*" + esc_html(Ucfirst(key with _ as space)) + ":* " + esc_html(value)`. Arrays are joined with `", "`. WP `esc_html` turns `'` into `&#039;`, which Slack renders literally.
  - Otherwise: `cf_replace_data_variables(message)`, unescaped.
- Return false if `webhook_url` is empty.

### 3.5 `discord`: Send to Discord (`src/actions/class-discord.php`)
- **Keys** (`:15-21`): `webhook_url`, `username = "Core Forms"`, `embed_color = "3447003"` (not in the UI). There is no message template.
- **Request** (`:47-78`): `POST webhook_url` JSON:
  - `username`;
  - `embeds[0]`:
    - `title`: `"New submission: {title}"`;
    - `color`: `(int)(embed_color ?: 3447003)`;
    - `fields`: the first 25 of `[{name: Ucfirst(key with _ as space), value: mb_substr(v, 0, 1024) ?: "—", inline: strlen(v) < 50}]`. The value `"0"` becomes `"—"` because of PHP's elvis operator, and `strlen` counts bytes;
    - `timestamp`: `gmdate('c')`;
    - `footer`: `{text: "Core Forms"}`.
  - Timeout 15. Discord returns 204, which counts as accepted.

### 3.6 `telegram`: Send to Telegram (`src/actions/class-telegram.php`)
- **Keys** (`:16-18`): `bot_token`, `chat_id`, `message = ""`, `parse_mode = "HTML"` (`HTML` \| `plain`), `message_thread_id = ""`.
- **Validation** (`:68-70,144-177`):
  - the token must match `^\d+:[A-Za-z0-9_-]+$` and be ≤ 256 characters;
  - `chat_id` must match `^(?:-?[1-9]\d*|@[A-Za-z0-9_]+)$`;
  - the topic must be a positive integer;
  - the visible length, `html_entity_decode(strip_tags())` in HTML mode, must be 1–4096. **There is no truncation**; anything else is an `ActionFailure`.
- **Message**:
  - submission values are flattened by `plain_value`, with files rendered as `name (url)` (`:134-138`);
  - an empty template produces the title (`<b>`-escaped in HTML mode) plus `Label: value` lines;
  - otherwise **each `[token]` is rendered and `htmlspecialchars`-escaped** in HTML mode (`:163-166`).
- **Request** (`:68-103`): `POST https://api.telegram.org/bot{token}/sendMessage`, form-encoded `{chat_id, text, parse_mode?="HTML", message_thread_id?}`. Timeout 15, redirects 0, response limit 1 MB.
  - Success needs HTTP 2xx, `ok === true`, an array `result` and `result.message_id`.
  - **Group migration**: on HTTP 400 with a negative `parameters.migrate_to_chat_id` that differs from the current chat, it retries once with the new id. After a successful send it rewrites `chat_id` in every telegram action with the same token and old chat in `_cf_settings`, guarded by compare-and-swap on the previous value (`:180-195`).
  - Retry when the code is 429 or ≥500, or HTTP 0, 408 or 425. Delay comes from `parameters.retry_after`.
  - Friendly messages for 401/404 (token), 403 (permission), 409 (webhook conflict), "chat not found", "parse entities" or "unsupported start tag", thread or topic errors, "too long" and migration (`:87-102`).
- **Setup** (`:106-132`, REST `actions/telegram/setup`):
  - `verify` calls `getMe` and requires `is_bot` and `username`;
  - `chats` calls `getWebhookInfo` and refuses if a webhook URL is set, then `getUpdates {limit: 100, timeout: 0}` (it doesn't acknowledge updates). It collects `{id, topic_id, label}` from message, edited_message, channel_post, edited_channel_post and my_chat_member.

### 3.7 `google_sheets`: Add to Google Sheet (`src/actions/class-google-sheets.php`)
- **Keys** (`:22-28`): `web_app_url`, `fields = ""` (comma-separated exact names; empty means all), `web_app_secret = ""`.
- **Auth**: a shared secret in the body as `_cf_shared_secret`. There's no OAuth. The Apps Script receiver (`assets/integrations/google-sheets.gs:5-33`) checks it, deletes it, maps the header row and returns `{ok: true, version: 1}`.
- **Request** (`:60-96`):
  - Data is `array_intersect_key` with the field list (exact, case-sensitive). Arrays are joined with `", "`, so a file array leaks all its values.
  - Then `_cf_shared_secret` (when set), `_form_title` and `_submitted_at` are added.
  - `POST web_app_url` JSON, timeout 30.
  - Success requires `accept_response` **and** either the body `"OK"` or JSON `ok/success === true`. Otherwise it's a non-retryable `ActionFailure` "did not confirm that a row was appended".

### 3.8 `notion`: Add to Notion (`src/actions/class-notion.php`)
- **Keys** (`:17-24`): `api_key` (internal integration token), `database_id`, `data_source_id` (takes precedence), `field_map` (`form_field=Notion Property` lines).
- **Headers**: `Authorization: Bearer <api_key>` and `Notion-Version: 2025-09-03` when `data_source_id` is set, else `2022-06-28`.
- **Requests** (`:61-81`):
  1. Fetch the schema, cached 120 s: `GET https://api.notion.com/v1/data_sources/{id}` or `/v1/databases/{id}`. A missing title property throws.
  2. Properties:
     - the title property is set to `"{form title} — {submitted_at}"`;
     - if `field_map` is empty, each submission field auto-maps to a property with `FieldMapping::match` against the property names;
     - each mapped property runs through `DestinationFields::notion(type, value)` (`class-destination-fields.php:92-122`):
       - `title` and `rich_text` are split into 2000-character chunks, at most 100;
       - `number` must be numeric and finite;
       - `checkbox` accepts `1/true/yes/on/accepted` and `0/false/no/off/""`, and anything else throws;
       - `email`, `url` and `phone_number` take strings or null;
       - `select` and `status` become `{name}`;
       - `multi_select` uses a comma split;
       - `date` becomes `{start: ISO}`;
       - `relation` and `people` need 32–36 character ids;
       - any other type throws "read-only or unsupported".
  3. `POST https://api.notion.com/v1/pages {parent: {data_source_id|database_id: id}, properties}`, timeout 20.

### 3.9 `airtable`: Add to Airtable (`src/actions/class-airtable.php`)
- **Keys** (`:15-23`): `api_key` (PAT, needs `schema.bases:read` and `data.records:write`), `base_id`, `table_name` (name or `tbl…` id), `field_map`, `include_metadata = 1`.
- **Requests** (`:62-89`):
  1. Fetch the schema, cached 120 s: `GET https://api.airtable.com/v0/meta/bases/{base}/tables`, then match the table by `id` or `name`.
  2. Map fields with `field_map` or auto-match, then `DestinationFields::airtable` (`:124-145`):
     - number, currency, percent, duration and rating go through `number`;
     - `checkbox` goes through `bool`;
     - `multipleSelects` becomes a choices array;
     - `multipleRecordLinks` must be `rec…` ids;
     - `date` keeps the first 10 characters of the ISO value;
     - `dateTime` is parsed in the site timezone and formatted `DATE_ATOM`;
     - text-ish types become strings;
     - anything else throws.
  3. When `include_metadata` is on, fill the `Form` and `Submitted At` columns only if they exist and aren't already mapped. `Submitted At` becomes `"Y-m-dTH:i:sZ"` for date types. With no fields left, throw.
  4. `POST https://api.airtable.com/v0/{base}/{tableId} {fields}` with Bearer auth, timeout 20.

### 3.10 `hubspot`: Add to HubSpot (`src/actions/class-hubspot.php`)
- **Keys** (`:15-24`): `access_token` (private app token), `email_field = "email"`, `name_field = "name"`, `phone_field = ""` (no UI, **unused**), `company_field = ""`, `field_map` (`form_field=hubspot_property`).
- **Request** (`:49-85`): `POST https://api.hubapi.com/contacts/v1/contact/createOrUpdate/email/{urlencode(email)}` with Bearer auth, JSON `{properties: [{property, value}]}`. Properties:
  - `email`;
  - `firstname` and `lastname`, from splitting the name field at the first space;
  - `company`, if mapped and non-empty;
  - custom map lines `form_key=prop`, with the property passed through `sanitize_key` and the value through `sanitize_text_field` (arrays joined). Form keys are **exact**.
- Returns false if there's no token or the email is invalid. Timeout 15. This is a legacy v1 endpoint; see Q4.

### 3.11 `convertkit`: Add to ConvertKit/Kit (`src/actions/class-convertkit.php`)
- **Keys** (`:17-25`): `api_key`, `form_id`, `email_field = "email"`, `name_field = "name"`, `tag_ids = ""` (comma ids).
- **Requests** (`:66-82`): body `{api_key, email, first_name}` as JSON.
  - Step `form_<id>`: `POST https://api.convertkit.com/v3/forms/{absint(form_id)}/subscribe`.
  - For each tag, step `tag_<id>`: `POST https://api.convertkit.com/v3/tags/{id}/subscribe` with the same body. Timeout 15.
- Returns false if `api_key` or `form_id` is empty, `form_id` isn't numeric, or the email is invalid.

### 3.12 `activecampaign`: Add to ActiveCampaign (`src/actions/class-activecampaign.php`)
- **Keys** (`:15-25`): `api_url` (`https://<acct>.api-us1.com`), `api_key`, `list_id = ""`, `tag_ids = ""`, `email_field = "email"`, `name_field = "name"`, `phone_field = ""` (no UI, but used).
- **Requests** (`:67-95`), base `rtrim(api_url, '/') + '/api/3/'`, header `Api-Token`:
  - step `contact`: `POST contact/sync {contact: {email, firstName, lastName, phone}}`. Requires `contact.id`;
  - step `list_<id>`: `POST contactLists {contactList: {list, contact, status: 1}}`;
  - step `tag_<id>`: `POST contactTags {contactTag: {contact, tag}}`. Timeout 15.

### 3.13 `brevo`: Add to Brevo (`src/actions/class-brevo.php`)
- **Keys** (`:15-23`): `api_key`, `list_id = ""`, `email_field = "email"`, `name_field = "name"`, `double_optin = 0`. **`double_optin` is saved but never read.**
- **Request** (`:46-70`): `POST https://api.brevo.com/v3/contacts`, header `api-key`, JSON `{email, attributes: {FIRSTNAME, LASTNAME}, updateEnabled: true, listIds?: [int]}`. Timeout 15.

### 3.14 `drip`: Add to Drip (`src/actions/class-drip.php`)
- **Keys** (`:15-23`): `api_token`, `account_id`, `email_field = "email"`, `name_field = "name"`, `tag = ""`.
- **Request** (`:46-66`): `POST https://api.getdrip.com/v2/{absint(account_id)}/subscribers` with `Authorization: Basic base64(token + ":")` and JSON `{subscribers: [{email, custom_fields: {name}, tags?: [tag]}]}`. Timeout 15.

### 3.15 `mailerlite`: Add to MailerLite (`src/actions/class-mailerlite.php`)
- **Keys** (`:15-22`): `api_key`, `group_id = ""`, `email_field = "email"`, `name_field = "name"`.
- **Request** (`:44-68`): `POST https://connect.mailerlite.com/api/subscribers` with Bearer auth and JSON `{email, fields: {name}, groups?: [group_id as string]}`. Timeout 15.

### 3.16 `mailchimp_api`: Subscribe to Mailchimp (API) (`src/actions/class-mailchimp-api.php`)
- **Keys** (`fields()` `:24-34`): `api_key` (required), `list_id` (audience, required), `email_field = "email"`, `first_name_field = ""`, `last_name_field = ""`, `new_contact_status = "pending"` (`pending` \| `subscribed`), `merge_fields = ""` (JSON).
- **Process** (`:36-82`):
  1. If spam or `is_awaiting_payment()`, return `skipped`. The ledger row stays reclaimable.
  2. Validate: `api_key` must match `^[a-f0-9]{32}-(us[0-9]+)$` (case-insensitive), which also yields the data centre; the audience must match `^[a-z0-9_-]+$` (case-insensitive).
  3. Build the payload: email from `ActionPayload::field` plus `email()`, lowercased; `FNAME` and `LNAME` from the name fields; the `merge_fields` JSON is typed and its keys must match `^[A-Z][A-Z0-9_]*$`.
  4. `PUT https://{dc}.api.mailchimp.com/3.0/lists/{aud}/members/{md5(email)}` with `Authorization: Basic base64("core-forms:" + key)` and JSON `{email_address, status_if_new, merge_fields?: object}`. Timeout 20, redirects 0.
  5. The response must have `id === md5` and `status ∈ {subscribed, pending, unsubscribed, cleaned, transactional}`.
  6. Success message: "Mailchimp contact saved. Subscription status: X."

### 3.17 `emailit`: Send Email via Emailit (`src/actions/class-emailit.php`)
- **Auth**: the **global** setting `cf_settings.emailit.api_key` as `Authorization: Bearer` (`:47-50`). The action is registered only when that key exists (`core-forms.php:384-391`).
- **Keys** (`:17-32`): `from = admin_email`, `to = admin_email`, `subject = "New submission: {title}"` (admin only), `message = "[all:label]"`, `content_type = "text/html"`, `reply_to = "[<detected email>]"`.
- **Request** (`:123-209`): `POST https://api.emailit.com/v2/emails` JSON `{from, to, subject, html|text, reply_to?}`. from, to, subject and reply_to are header-escaped and rendered, with filters `cf_action_emailit_from`, `_to`, `_subject` and `_message`. Timeout 15. The result is written to the email log, including the provider `message` on error. 2xx is success.

### 3.18 `emailit_subscribe`: Emailit: Subscribe Contact (`src/actions/class-emailit-subscribe.php`)
- **Keys** (`:17-27`): `email_field`, `first_name_field` and `last_name_field` (detected), `audiences = []` (array of ids from checkboxes), `custom_fields = ""` (`key=value` lines with variables).
- **Admin**: `GET https://api.emailit.com/v2/audiences?page=N&limit=100`, up to 10 pages, cached 5 minutes in transient `cf_emailit_audiences` (`:34-83`).
- **Process** (`:177-266`):
  1. Field names have `[]` trimmed. If the mapped email is empty, it falls back to the first `is_email` string in the submission.
  2. `POST https://api.emailit.com/v2/contacts {email, first_name?, last_name?, audiences?, custom_fields?}` (filter `cf_emailit_subscribe_contact_data`). 2xx is success.
  3. **409 with audiences** goes to `update_existing_contact` (`:268-330`):
     - `POST v2/contacts/{rawurlencode(email)}` with `{first_name, last_name, custom_fields}`, with empty values filtered out;
     - then, for each audience, `POST v2/audiences/{id}/subscribers {email, first_name?, last_name?, custom_fields?}`, where 409 counts as OK.
     - Any other non-2xx throws through `accept_response`, so the `$success = false` branches are unreachable.
  4. **409 without audiences is a non-retryable failure.** That's a WP quirk; see Q8.

### 3.19 `resend`: Send Email with Resend (`src/actions/class-resend.php`)
- **Keys** (`fields()` `:17-29`): `api_key`, `from_email`, `from_name = ""`, `to = "[EMAIL]"`, `reply_to = ""`, `subject = "[SUBJECT]"`, `message = "[all:label]"`, `content_type = "text"` (`text` \| `html`), `webhook_secret = ""` (`whsec_…`).
- **Validation** (`:36-52`):
  - the key must have no whitespace;
  - `from` must be a valid email; the name must not contain CR, LF, `<` or `>`. From is built as `"\"<addcslashes(name, '\"\\')>\" <email>"`;
  - `to` is rendered, split on commas, each address validated and de-duplicated, at most 50;
  - `subject` must be non-empty after rendering;
  - `message` uses alias tags plus `esc_html` when HTML;
  - `reply_to`, if set, must be a valid email;
  - `webhook_secret`, if set, must be `whsec_` plus base64 that decodes to ≥ 16 bytes.
- **Request**: step `resend_email`, `POST https://api.resend.com/emails` with Bearer auth and **`Idempotency-Key: cf-<run key>`**, JSON `{from, to[], subject, text|html, reply_to?}`. Timeout 20, redirects 0. The response `id` must match `^[a-zA-Z0-9_-]{1,100}$`.
- **Result meta**: `{resend_email_id, resend_action_id: _cf_action_id ?? "0", delivery_status: "accepted"}`. The webhook URL shown in the admin (`:30-35`) is `rest_url('cf/v1/resend/{form_id}/{_cf_action_id ?? "action-"+index}')`. Inbound handling is in §3.27.

### 3.20 `zapier`: Send to Zapier (`src/actions/class-zapier.php`)
- **Keys**: `webhook_url`.
- **Request** (`:35-54`): `POST webhook_url` JSON with the data (arrays joined `", "`) plus `_form_title`, `_form_id`, `_submitted_at` and `_ip_address`. Timeout 15. There's no SSRF guard.

### 3.21 `make`: Send to Make (`src/actions/class-make.php`)
- **Keys**: `webhook_url`.
- **Request** (`:33-48`): same as Zapier, plus only `_form_title` and `_submitted_at`.

### 3.22 `n8n`: Send to n8n (`src/actions/class-n8n.php`)
- **Keys** (`fields()` `:18-28`): `webhook_url`, `auth_mode = "header"` (`header` \| `basic`), `auth_header_name = "X-Core-Forms-Key"`, `auth_username = ""`, `auth_secret` (required), `fields = ""`, `json_map = ""`.
- **Validation** (`:31-51`):
  - the URL must be https, contain no userinfo and pass `cf_is_safe_outbound_url`;
  - a path containing `/webhook-test` or `/webhook-waiting` is rejected unless `ActionRunner::is_testing()`;
  - the secret must have no CR or LF;
  - basic mode: the user must not contain `:`, CR or LF; the header becomes `Authorization: Basic base64(user:secret)`;
  - header mode: the name must match `^[a-zA-Z][a-zA-Z0-9-]*$` and not be one of host, content-type, content-length, transfer-encoding, connection, cookie or proxy-authorization.
- **Payload**: `ActionPayload::event`:
  - `entry` comes from `selected(fields)`. An empty value produces PHP `[]`, which serialises as **`[]`, not `{}`**;
  - `entry` is replaced by the `json_map` result when `json_map` is set;
  - `event_id` is the run key; it's also sent as header `X-Core-Forms-Event-Id`.
- **Request**: `wp_safe_remote_post` (WP's own private-IP block), timeout 20, redirects 0. Result meta `{event_id}`.
- An importable template ships in `assets/integrations/n8n-core-forms.json`.

### 3.23 `pipedrive`: Create Pipedrive Lead or Deal (`src/actions/class-pipedrive.php`)
- **Keys** (`fields()` `:16-37`):
  - connection: `company_domain`, `api_token`;
  - field mappings: `email_field = "EMAIL"`, `name_field = "NAME"`, `phone_field = ""`, `company_field = ""`;
  - record: `record_type = "lead"` (`lead` \| `deal`), `title = "[SUBJECT]"`, `pipeline_id = ""`, `stage_id = ""`, `value = ""`, `currency = "USD"`;
  - custom fields JSON: `person_fields`, `organization_fields`, `record_fields`;
  - follow-up: `activity_subject = ""`, `activity_type = "task"`, `activity_date = ""`.
- **Auth**: header `x-api-token`. Base URL `https://{domain}.pipedrive.com/api/`. Every response must be `{success: true, data: object}` (`:38-42`).
- **Validation** (`:55-84`):
  - the domain must be a DNS label;
  - the token must have no whitespace;
  - custom-field JSON keys must be 40-character hex strings;
  - organisation fields require a mapped organisation name;
  - pipeline and stage are allowed only for deals;
  - value must be numeric and ≥ 0, with a 3-letter currency;
  - the activity date must be a valid `YYYY-MM-DD`;
  - the activity type must match `[a-zA-Z0-9_-]+`.
- **Sequence** (`:86-123`):
  1. Routing check: `GET v2/stages/{id}` (the stage's `pipeline_id` must match), or `GET v2/pipelines/{id}`.
  2. Step `pipedrive_organization`: `GET v2/organizations/search?term=&fields=name&exact_match=true&limit=2`. More than one match fails. Then `POST v2/organizations` or `PATCH v2/organizations/{id}` with `{name, custom_fields?}`.
  3. Step `pipedrive_person`: `GET v2/persons/search?term=<email>&fields=email&exact_match=true&limit=2`. Then `POST v2/persons {name, emails: [{value, primary: true}], phones?, org_id?, custom_fields?}`, or `PATCH v2/persons/{id}` without `emails`.
  4. Step `pipedrive_record`:
     - for a lead: `POST v1/leads {title, person_id, organization_id?, value?: {amount, currency}, …record_fields merged at top level}`;
     - for a deal: `POST v2/deals {title, person_id, org_id?, pipeline_id?, stage_id?, value?, currency?, custom_fields?}`.
     The id must match `[a-zA-Z0-9-]+`.
  5. Optional step `pipedrive_activity`: `POST v2/activities {subject, type, lead_id|deal_id, due_date?}`.
- **Result meta**: `{person_id, organization_id, record_type, record_id, activity_id}`.

### 3.24 `zendesk`: Create Zendesk Ticket (`src/actions/class-zendesk.php`)
- **Keys** (`fields()` `:17-31`): `subdomain`, `agent_email`, `api_token`, `email_field = "EMAIL"`, `name_field = "NAME"`, `subject = "[SUBJECT]"`, `message = "[DESCRIPTION]"`, `priority = "normal"`, `tags = ""`, `custom_fields = ""` (JSON keyed by numeric field id), `attachment_fields = ""`.
- **Auth**: `Authorization: Basic base64("{agent_email}/token:{api_token}")`. Base URL `https://{sub}.zendesk.com/api/v2/`.
- **Sequence** (`:32-73`):
  1. Validate: priority must be low, normal, high or urgent after rendering. Tags are split on `[,\s]+`, passed through `sanitize_key` and de-duplicated. Custom fields become `[{id, value}]`.
  2. Attachments: every file is validated **before** any request (§ below).
  3. `GET tickets.json?external_id=core-forms-<run key>`. More than one ticket fails. Exactly one returns that ticket, which gives idempotent recovery.
  4. For each file, step `zendesk_upload_<sha256(path|date)>`: `POST uploads.json?filename=<name>` with the raw bytes and the file's `Content-Type`, timeout 30. Uses `upload.token`.
  5. Step `zendesk_ticket`: `POST tickets.json {ticket: {subject, comment: {body, public: true, uploads?}, requester: {email, name}, priority, external_id, tags?, custom_fields?}}`.
- **Result meta**: `{ticket_id, ticket_url: https://{sub}.zendesk.com/agent/tickets/{id}}`.
- **Attachment rules** (`:78-106`):
  - the submission must be stored;
  - the selected field must be an `<input type=file>` in the markup;
  - the stored submission's data must equal the in-memory value;
  - the real path must sit directly under `uploads/core-forms/{form slug}`;
  - limits are ≤ 10 MB per file, ≤ 20 MB total and ≤ 20 files;
  - the name sent is the sanitised `original_name`, and the MIME type comes from the extension.
- **EmDash**: read the bytes from R2 through the file-upload spec's API.

### 3.25 `twilio_sms`, `twilio_whatsapp`, `whatsapp_cloud`

**`twilio_sms`** (`src/actions/class-twilio-sms.php`)
- **Keys** (`:15-23`): `account_sid`, `auth_token`, `from_number`, `to_number` (supports `[phone]`), `message = ""`.
- Returns false if any of the first four is empty.
- **Message**: the default is `"{title} — New submission"` plus `Label: value` lines. Then `mb_substr(…, 0, 1600)`.
- **Request** (`:48-74`): `POST https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json` with `Authorization: Basic base64(sid:token)` and form body `{From, To, Body}`. Timeout 15.

**`twilio_whatsapp`** (`src/actions/class-twilio-whatsapp.php`)
- **Keys** (`:28-38`): the same as SMS, plus `content_sid = ""` (HX…) and `content_variables = ""` (JSON).
- **Addresses** (`:203-220`): an existing `whatsapp:` prefix is kept. Otherwise the value is reduced to `[0-9+]`, a leading `+` is forced, and `whatsapp:` is prefixed.
- **Body**:
  - with `ContentSid`: `ContentVariables` is the JSON re-encoded after rendering each value. Invalid JSON is silently omitted;
  - otherwise `Body`, capped at 1600 characters.
- **Logging**: an email-log row with subject "WhatsApp via Twilio → {to}".
- **Request** (`:100-201`): the same endpoint as SMS. On 2xx it writes a `cf_submission_replies` outbound row: `provider: twilio`, `provider_message_id: sid`, `status: response.status ?? "sent"`, `payload: response`.

**`whatsapp_cloud`** (`src/actions/class-whatsapp-cloud.php`)
- **Keys** (`:86-97`): `to_number`, `mode = "template"` (`template` \| `text`), `template_name`, `template_language = "en_US"`, `template_body = ""` (comma list), `message = ""`, `access_token = ""` and `phone_number_id = ""`.
- The last two are per-action overrides of the **globals** `cf_settings.whatsapp_cloud.{access_token, phone_number_id}` (`:99-112`). `business_account_id` is stored by the settings UI but never used.
- `to` is reduced to digits only, without `+` (`:343-347`).
- **Payload** `{messaging_product: "whatsapp", to, …}`:
  - **text** mode: `{type: "text", text: {body: ≤ 4096 characters, preview_url: false}}`;
  - **template** mode: `{type: "template", template: {name, language: {code}, components?: [{type: "body", parameters: [{type: "text", text}]}]}}`. Parameters come from splitting `template_body` on commas *before* rendering.
  - Filter `cf_action_whatsapp_cloud_payload`.
- Returns false if credentials, `to` or (template mode) the template name is missing.
- **Request** (`:203-341`): `POST https://graph.facebook.com/v21.0/{phone_number_id}/messages` with Bearer auth. Timeout 15. On 2xx it writes a replies row: `provider: meta`, id `messages[0].id`, `status: sent`.
- **Test connection** (`:44-84`): `GET https://graph.facebook.com/v21.0/{id}?fields=display_phone_number,verified_name,quality_rating`.

### 3.26 `whatsapp_redirect` and `surecontact`

**`whatsapp_redirect`**: Redirect to WhatsApp (`src/actions/class-whatsapp-redirect.php`). There's no HTTP call and no WordPress dependency, so it's in scope.
- **Keys** (`:37-42`): `to_number = ""`, `message = "Hi! I just submitted the form on your site.\n\n[all:label]"`.
- **Process** (`:74-105`):
  - the number is reduced to digits;
  - a blank message falls back to `Label: value` lines;
  - the message is rendered and capped at 4096 code points;
  - the URL is `https://wa.me/{digits}?text={rawurlencode(text)}`, or `https://wa.me/?text=…`. `rawurlencode` follows RFC 3986, so `!'()*` are encoded; `encodeURIComponent` doesn't encode them;
  - filter `cf_action_whatsapp_redirect_url`, then set the response `redirect_url`;
  - it always returns true. It must run **inline before the response** and is never queued.

**`surecontact`**: Add to SureContact (`IntegrationHandlers::surecontact`, `src/integrations/class-integration-handlers.php:116-124`, registered at `class-integration-manager.php:103`).
- Always available, despite sitting in the "native" set. It's pure HTTP.
- **Keys**: `email = "[email]"`, `first_name = "[first_name]"`, `last_name = "[last_name]"`, `phone = "[phone]"`, `api_key` (password, required), `tag_uuids` and `list_uuids` (comma lists).
- Every string is rendered (NativeAction).
- **Request**: `POST https://api.surecontact.com/api/v1/public/contacts` with headers `X-API-Key` and `Accept: application/json`, JSON `{primary_fields: {email, first_name, last_name, phone}, tag_uuids: [], list_uuids: []}`. Timeout 15. Uses `IntegrationHttp::json`.
- **Result meta**: `{contact_uuid: data.uuid}`.

### 3.27 Inbound: Resend delivery webhook (`src/integrations/class-resend-webhook.php`)

Route: `POST /wp-json/cf/v1/resend/{form_id}/{action_id}`, public (`:10-15`).

1. Load the form; if it's missing, return 401. Find **exactly one** action with `type == resend` and `(_cf_action_id ?? index) == action_id`. Its `webhook_secret` is the key.
2. Verify (`:19-24`):
   - body ≤ 1 MB;
   - `svix-id` matches `^[a-zA-Z0-9_-]{1,200}$`;
   - `svix-timestamp` is all digits and within ±300 s;
   - the secret is valid;
   - the signature matches (§2.6).
   On failure return 401 `cf_resend_signature`.
3. Event map: `email.sent→sent`, `delivered→delivered`, `delivery_delayed→delayed`, `bounced→bounced`, `complained→complained`, `failed→failed`, `suppressed→suppressed`. Any other type returns 200 `{received: true, ignored: true}`. `data.email_id` must match `^[a-zA-Z0-9_-]{1,100}$`, else 400.
4. Find the send record: the latest `cf_action_logs` row with the same form, `action_type = 'resend'` and `meta LIKE` both the email id and the action id.
   - If it's missing and the event's `created_at` is less than 120 s old, return **503**, so Resend retries.
   - Otherwise return 200 ignored.
5. Dedupe: reserve the ledger key `sha256('resend-event|form|action|svix-id')`. Already complete returns 200 `{duplicate: true}`; busy returns 503.
6. Write an event row with `action_type = resend_delivery`. The status is `failed` for bounced, complained, failed and suppressed, else the mapped name. The message is "Resend: X", meta `{resend_email_id, resend_action_id, delivery_status, event_id}`. Then finish the claim.

EmDash: replace the `LIKE` scan with an index keyed by Resend email id (§5.3).

### 3.28 Inbound: WhatsApp replies (`src/integrations/class-whatsapp-inbound.php`)

Settings (global): `cf_settings.whatsapp_inbound.{meta_verify_token, meta_app_secret, twilio_auth_token}` (`:123-136`).

**`GET core-forms/v1/whatsapp/meta`** (`:41-48`)
- Requires `hub.mode == "subscribe"` and `hub.verify_token == meta_verify_token`, which must be non-empty. Compare with `hash_equals`.
- Returns 200 `text/plain` with the raw `hub.challenge`, else 403.
- PHP turns `hub.mode` into `hub_mode`; **EmDash must read the dotted names literally**.

**`POST …/meta`** (`:50-87`)
1. Verify `X-Hub-Signature-256`; on failure return 401.
2. For each `entry[].changes[].value`:
   - `statuses[]` update `cf_submission_replies.status` where `provider = meta` and `provider_message_id = id`;
   - `messages[]` are correlated with `cf_find_messaging_submission('meta', context.id, from)` (`functions.php:2674-2687`). That checks the quoted outbound message id first, then the latest outbound row whose `to_email` digits equal `from` digits.
3. A match writes an inbound row:
   - `status: received`, `from`;
   - `to: metadata.display_phone_number`;
   - `subject: "WhatsApp reply"`;
   - text from `text.body`, `button.text`, `interactive.button_reply.title` or `interactive.list_reply.title`, else `"[<type> message]"`;
   - `payload`: the whole body.
   It then sets the submission status to **`replied`** and fires `cf_whatsapp_reply_received`.
4. Respond 200 `{received: true}`.

**`POST …/twilio`** (`:89-115`)
1. Verify `X-Twilio-Signature`: `base64(HMAC-SHA1(token, rest_url(route) + concat(ksort(body params) as key + scalar value)))`. On failure return 401.
2. Correlate on `OriginalRepliedMessageSid`, then on `From`.
3. Store an inbound row: `MessageSid`, `status: SmsStatus ?? received`, `Body`, `payload: params`. Set the status to replied and fire the hook.
4. Respond 200 `text/xml` `<?xml …?><Response></Response>` (served raw by `serve_raw_response`, `:20-29`).

EmDash needs:
- public plugin routes with raw body access, all headers and dotted query names;
- the ability to return `text/plain` and `text/xml` bodies;
- **the exact public URL Twilio calls**, for the signature;
- a `replied` submission status, which v0.1.0's `SubmissionStatus` lacks.

### 3.29 WP-only bridges examined (skipped)

- **`mailchimp`** (MC4WP, `src/actions/class-mailchimp.php:76-123`): `MC4WP_MailChimp::list_subscribe(list_id, first is_email value, {merge_fields, status: pending})`, plus filters. Only `list_id` is stored. It needs the MC4WP plugin and its stored API key, so it's WP-only. Imported actions can be offered a one-click conversion to `mailchimp_api` (see Q3).
- **`flowmattic`** (`src/actions/class-flowmattic.php:12-40`):
  - keys `scope = "form"` (`form` \| `all`) and `fields = ""`;
  - it calls `do_action('cf_flowmattic_form_{id}' | 'cf_flowmattic_submission', ActionPayload::event(...))` and fails if `!has_action(hook)`;
  - it is **not HTTP**, so it's skipped. Migration path: FlowMattic's own Webhook trigger plus the `webhook` or `n8n`-style action.
- **OttoKit, AutomatorWP, Uncanny** (`src/integrations/class-automation-integrations.php:13-102`, `ottokit/class-ottokit-integration.php:10-22`): in-process triggers on `cf_form_success`. OttoKit also has the action "Submit a Core Form", which calls `Rest_Headless::handle_internal_submit`. These have no stored action settings and are skipped.
- **`fluentcart_mailerpress`** (`src/actions/class-fluentcart-mailerpress.php`): a global listener on `fluent_cart/order_paid_done` using `cf_settings.fluentcart_mailerpress.{list_id, tag_id}`. It isn't a form action.

---

## 4. Action type table

| type id | Label | Status | Reason |
| --- | --- | --- | --- |
| email | Send Email | **in scope** | core; maps to `ctx.email` |
| autoresponder | Auto-Responder | **in scope** | core; maps to `ctx.email` |
| webhook | Trigger Webhook | **in scope** | HTTP, signed |
| slack | Send to Slack | **in scope** | HTTP incoming webhook |
| discord | Send to Discord | **in scope** | HTTP webhook |
| telegram | Send to Telegram | **in scope** | Bot API |
| google_sheets | Add to Google Sheet | **in scope** | HTTP to an Apps Script web app |
| notion | Add to Notion | **in scope** | REST + schema read |
| airtable | Add to Airtable | **in scope** | REST + schema read |
| hubspot | Add to HubSpot | **in scope** | REST (legacy v1) |
| convertkit | Add to ConvertKit | **in scope** | REST v3 |
| activecampaign | Add to ActiveCampaign | **in scope** | REST v3, steps |
| brevo | Add to Brevo | **in scope** | REST v3 |
| drip | Add to Drip | **in scope** | REST v2 |
| mailerlite | Add to MailerLite | **in scope** | REST (connect API) |
| mailchimp_api | Subscribe to Mailchimp (API) | **in scope** | Marketing API 3.0 |
| emailit | Send Email via Emailit | **in scope** | REST v2; needs the global key |
| emailit_subscribe | Emailit: Subscribe Contact | **in scope** | REST v2; needs the global key |
| resend | Send Email with Resend | **in scope** | REST + inbound Svix webhook |
| zapier | Send to Zapier | **in scope** | HTTP webhook |
| make | Send to Make | **in scope** | HTTP webhook |
| n8n | Send to n8n | **in scope** | authenticated HTTP webhook |
| pipedrive | Create Pipedrive Lead or Deal | **in scope** | REST v1/v2, steps |
| zendesk | Create Zendesk Ticket | **in scope** | REST + uploads |
| twilio_sms | Send SMS (Twilio) | **in scope** | REST |
| twilio_whatsapp | Send WhatsApp (Twilio) | **in scope** | REST + inbound |
| whatsapp_cloud | Send WhatsApp (Cloud API) | **in scope** | Graph API + inbound |
| whatsapp_redirect | Redirect to WhatsApp (wa.me) | **in scope** | URL builder; inline only |
| surecontact | Add to SureContact | **in scope** | REST; no WordPress dependency |
| issue_license, renew_license | Fulfill License Purchase / Renew License Subscription | in scope, **licensing spec** | Core Commerce NativeActions |
| mailchimp | Mailchimp | skipped (WP) | needs the MC4WP plugin and its key |
| mailerpress | MailerPress | skipped (WP) | `add_mailerpress_contact()` |
| fluentcrm | Add to FluentCRM | skipped (WP) | `FluentCrmApi` |
| fluent_support | Create Fluent Support Ticket | skipped (WP) | same-site Fluent Support models |
| fluent_community | Add to Fluent Community | skipped (WP) | FluentCommunity models |
| flowmattic | Trigger FlowMattic | skipped (WP) | in-process `do_action` hook, no HTTP |
| create_user | Create WordPress User | skipped (WP) | `wp_insert_user` |
| create_post (alias create_article) | Create Post / Article / CPT | skipped (WP) | `wp_insert_post`, ACF, taxonomies |
| create_comment | Create Comment / Review | skipped (WP) | `wp_insert_comment` |
| woocommerce | Create WooCommerce Order | skipped (WP) | `wc_create_order` |
| edd | Create Easy Digital Downloads Order | skipped (WP) | `edd_add_order` |
| surecart | Create SureCart Checkout | skipped (WP) | SureCart PHP models |
| wp_simple_pay | Handoff to WP Simple Pay | skipped (WP) | `get_permalink` of a `simple-pay` post |
| groundhogg | Add to Groundhogg | skipped (WP) | Groundhogg Contact class |
| jetpack_crm | Create Jetpack CRM Contact | skipped (WP) | `zbs_addUpdateCustomer` |
| wp_crm_system | Create WP-CRM System Lead | skipped (WP) | `WPCRM_System_Create` |
| memberpress | Create MemberPress Membership | skipped (WP) | `MeprTransaction` |
| learndash | Enroll in LearnDash | skipped (WP) | `ld_update_course_access` |
| pmpro | Assign Paid Memberships Pro Level | skipped (WP) | `pmpro_changeMembershipLevel` |
| (non-action) fluentcart_mailerpress, OttoKit, AutomatorWP, Uncanny Automator, Elementor, Bricks, Independent Analytics | n/a | skipped (WP) | plugin hooks and builders; no per-form action settings |

Skipped types keep importing verbatim and render as an "unavailable" card with the dependency label, matching WP (§1.3). On execution they log `failed` "No available handler is registered for this action." WP logs that row; the port should log `skipped` with reason `wp_only`, so recovery views stay clean (Q2).

---

## 5. Gap analysis: v0.1.0 (`src/core/actions.ts`, `types.ts`, `template.ts`, `routes.ts`)

| Area | WP 4.11.1 | v0.1.0 | Required |
| --- | --- | --- | --- |
| Types implemented | 29 in scope | `email`, `autoresponder`, `webhook` only (`actions.ts:145-157`); others return `skipped: "action type not supported in EmDash"` | implement §3 |
| `conditions` | evaluated at submit, queue, replay and fulfillment (§1.5) | **never evaluated**; `runActions` loops every action (`actions.ts:140-161`), and `process.ts` and `normalize.ts` don't read `conditions` | port `cf_evaluate_action_conditions` exactly, including unknown operator → fail |
| Execution timing | inline before the response, sequential | all actions in `after()` (`routes.ts:133-141`) | keep `after()` for normal actions; run `whatsapp_redirect` inline (§1.9) |
| Identity | `_cf_action_id` (`action-N` 0-based or `action-<uuid>`) | `id = "action-${i+1}"` (1-based) (`normalize.ts:89`) | canonical `_cf_action_id`; never renumber |
| `enabled` | none | `enabled` (default true) | keep as an extension |
| Email recipients | `to` comma list, all To; routes; arbitrary headers | first address is To, the rest Cc; **Bcc sent as Cc** (`actions.ts:80`); Cc/Bcc header values not rendered; only Reply-To/Cc/Bcc honoured; no routes | fix Bcc; render all header lines; implement `recipient_routes` |
| Email From | `From:` header | dropped (`actions.ts:5-7`); EmDash email API has no From | accepted limitation; surface it in the admin |
| Plain-text body | Email strips `<br />`; Autoresponder converts it to `\n` | single path with `htmlToText` for HTML | match per action |
| Autoresponder field | `FieldMapping::resolve` (case alias, throws if missing) | strips `[]`, exact key | add resolve |
| Webhook payload | **raw `submission.data`** (JSON) or PHP `http_build_query` (form) | wrapped `{form, submission, data}` (`actions.ts:107-113`); form arrays as `k[]` | restore WP shape byte-compatibly |
| Webhook default content type | `form` | `json` when missing (`normalize.ts:94-95`) | default `form` |
| Webhook auth, signing, event id, Referer | yes (§3.3, §2.6) | none | add |
| SSRF guard | `cf_is_safe_outbound_url` (webhook, n8n) | protocol check only | add hostname/IP-literal guard (§6.4) |
| HTTP outcome | 2xx + JSON `ok/success/status` check, retry classification | `res.ok` only | port `IntegrationHttp` |
| Ledger, idempotency, steps | yes | none | add (§2.1) |
| Queue, `async`, retries | yes (§2.2) | none | add (§6.5) |
| Action logs, stats, failures, retry REST | yes (§2.5) | `ctx.log` only | add routes |
| Test action, rehearsal, copy, recovery | yes | none | add admin routes |
| Inbound endpoints | Resend, Meta, Twilio | none | add (§3.27–3.28) |
| Global integration settings | `emailit.api_key`, `whatsapp_cloud.*`, `whatsapp_inbound.*` | not in `GlobalSettings` (`types.ts:159-170`); the exporter ships only `_cf_settings` (`wordpress/export-core-forms.php:17`) | extend settings and the exporter |
| Data variables | case-alias pre-pass, dot paths, `CF_USER_*`, `CF_POST_*`, `CF_ADMIN_EMAIL`, `CF_PAYMENT_*` | none of these (`template.ts:66-117`) | template spec; actions need at least alias + dot paths + payment tokens |
| Submission status `replied` | set by inbound WhatsApp | not in `SubmissionStatus` (`types.ts:121`) | add |
| Messaging thread table | `cf_submission_replies` | none | add collection |

---

## 6. Porting notes for EmDash

### 6.1 Module layout

```
src/actions/
  index.ts                 registry: type → ActionModule; WP_ONLY map (type → dependency label)
  types.ts                 ActionModule, RunContext, ActionOutcome, ActionFailure, DeliveryUncertain
  runtime/
    runner.ts              dispatch / execute / once / step / test (ActionRunner)
    ledger.ts              reserve / finishRun / checkpoint / reconcile (ActionLogger ledger half)
    log.ts                 event rows, list/stats/failures
    queue.ts               enqueue / processDue / recoverStale / retry / stats
    conditions.ts          cf_evaluate_action_conditions
    http.ts                accepted / json / retryAfter / timeout + redirect policy
    payload.ts             ActionPayload.* (text, required, email, field, json, selected, event, positiveId, api)
    mapping.ts             FieldMapping (match, resolve, tags, validate, samples) + DestinationFields
    redact.ts              redact(message, settings)
    signer.ts              WebhookSigner.sign/verify (+ svix, meta, twilio verifiers)
    ssrf.ts                isSafeOutboundUrl
    php.ts                 phpEmpty, elvis, sanitizeTextField, sanitizeKey, isEmail, sanitizeEmail,
                           escHtml (WP), htmlspecialchars, escEmailHeader, rawurlencode, httpBuildQuery,
                           ucfirst, mbSubstr (code points), strlenBytes, absint, md5
  core/      email.ts autoresponder.ts webhook.ts
  integrations/
    slack.ts discord.ts telegram.ts google-sheets.ts notion.ts airtable.ts hubspot.ts
    convertkit.ts activecampaign.ts brevo.ts drip.ts mailerlite.ts mailchimp-api.ts
    emailit.ts emailit-subscribe.ts resend.ts zapier.ts make.ts n8n.ts pipedrive.ts
    zendesk.ts twilio-sms.ts twilio-whatsapp.ts whatsapp-cloud.ts whatsapp-redirect.ts surecontact.ts
  inbound/   resend-webhook.ts whatsapp-meta.ts whatsapp-twilio.ts
  admin/     test.ts rehearsal.ts copy.ts telegram-setup.ts recovery.ts
```

Module contract. The exact keys and defaults are in §3. All settings stay string-typed as imported.

```ts
export interface ActionModule<S extends Record<string, unknown> = Record<string, unknown>> {
  type: string;
  label: string;
  category: "notifications" | "messaging" | "data" | "marketing" | "support" | "automation";
  defaults: S;                         // exact WP keys/defaults (§3)
  secretKeys: readonly string[];       // for UI masking, redaction, export warnings
  queueable: boolean;                  // ActionRunner::can_queue
  phase: "inline" | "after";           // inline = must finish before the submit response
  globals?: readonly string[];         // e.g. ["emailit.api_key"] — unavailable when missing
  run(settings: S, rc: RunContext): Promise<ActionOutcome | boolean | void>;  // normalize() like WP
}
export interface RunContext {
  form: FormDefinition; submission: Submission; runKey: string; testing: boolean;
  fetch(url: string, init: RequestInit & { timeoutMs: number; redirect?: "follow" | "manual"; maxBytes?: number }): Promise<Response>;
  step<T>(name: string, fn: () => Promise<T>): Promise<T>;   // ledger-checkpointed
  render(template: string, escape?: "none" | "html" | "header" | "strip_tags" | "telegram"): string;
  sendEmail?(m: EmailMessage): Promise<void>;
  messages: { save(row: ReplyRow): Promise<void> };           // cf_submission_replies
  globals: IntegrationGlobals; setRedirect(url: string): void; log: Logger;
}
```

Behaviour notes:
- `fetch` wraps `ctx.http.fetch`. Use `AbortSignal.timeout(timeoutMs)` with the WP timeouts from §3. The WP default of 5 s applies only to `webhook`; every other action sets its own timeout. `redirect: "manual"` matches WP `redirection: 0`: Telegram, the `ActionPayload::api` users and n8n. In that mode a 3xx is a non-retryable failure.
- `ActionPayload::api` and Zendesk's GET send `Content-Type: application/json` even on a GET. That's harmless; keep it for parity.

### 6.2 Secrets

- **Per-action secrets** live in the form definition, as in WP, so imports are lossless:
  - `auth_header_value`, `webhook_secret` (webhook);
  - `webhook_url` (slack, discord, zapier, make, google_sheets: the URL is the secret);
  - `web_app_secret`, `bot_token`;
  - `api_key` (notion, airtable, convertkit, activecampaign, brevo, mailerlite, mailchimp_api, resend, surecontact);
  - `access_token` (hubspot, whatsapp_cloud), `api_token` (drip, pipedrive, zendesk), `auth_secret` (n8n), `auth_token` (twilio_*);
  - Resend's `webhook_secret`.
- Requirements:
  - **Never return form settings from public routes.** `render` already returns only HTML.
  - Mask secrets in admin responses with a sentinel and keep the stored value on save when the sentinel comes back. That's stricter than WP, which echoes secrets into password inputs.
  - Redact log messages with the WP rule (§1.8).
  - Queue snapshots: see Q6.
- **Global secrets** go in plugin settings: Emailit key, WhatsApp Cloud token and phone id, Meta verify token and app secret, Twilio inbound token. They must be added to `GlobalSettings`, the admin settings schema and the WP exporter (`get_option('cf_settings')` subset). Without them, imported `emailit*` actions are unavailable and `whatsapp_cloud` actions without overrides fail.

### 6.3 Crypto and encoding in Workers

- HMAC-SHA256 (webhook signing, Svix, Meta) and HMAC-SHA1 (Twilio) via `crypto.subtle`.
- **MD5** for the Mailchimp subscriber hash: Workers' `crypto.subtle.digest("MD5", …)` is a Cloudflare extension. Use `node:crypto` in Vitest.
- Base64 via `btoa` on bytes. Use UTF-8 bytes for Basic auth strings.
- Port PHP `http_build_query` for the webhook form body and its signing:
  - nested `a[0]`, `a[k]` notation;
  - `+` for spaces;
  - booleans as `1`/`0`;
  - `null` values skipped.
- `rawurlencode` for wa.me URLs.
- `json_encode` escaping (`\/`, `\uXXXX`) is not needed for verification, because receivers verify the bytes they get. Keep PHP `[]` vs `{}` only where it's observable: n8n and FlowMattic `entry`.

### 6.4 SSRF in Workers

There's no DNS API, so `cf_is_safe_outbound_url`'s resolve step can't be ported directly.
- Port the rest: scheme `http` or `https`, reject `localhost` and IP literals in private and reserved ranges (v4, v6 and v4-mapped), reject userinfo for n8n.
- Optionally resolve over DoH (`https://cloudflare-dns.com/dns-query`), which costs a subrequest.
- Workers `fetch` can't reach the host's loopback or internal network. Flag the residual risk only for self-hosted, non-Cloudflare EmDash runtimes.

### 6.5 Queue and retries without WP-Cron

Keep the WP state machine and numbers: `MAX_RETRIES = 3`, `delay = max(2^attempts × 60 s, retry_after ≤ 3600)`, a sync-failure enqueue delay of at least 120 s with `attempts = 1`, batch 10, stale after 10 minutes, a ledger lease of 600 s, and conditions re-checked at run time.

Proposed design:
- `action_queue` storage collection: `{id, formId, submissionId, actionType, settings (snapshot), runKey, status, priority, attempts, maxRetries, lastError, claimId, scheduledAt, startedAt, completedAt, createdAt}`, indexed on `(status, scheduledAt)` and `submissionId`.
- Claim per row with a conditional update: `updateIf(id, {where: {status ∈ [pending, retrying], scheduledAt ≤ now}, set: {status: processing, claimId, startedAt}})`. v0.1.0 already uses `updateIf` (`routes.ts:346`). An `UPDATE … LIMIT` isn't required.
- `processDue(ctx, {limit: 10, budgetMs})` runs from:
  1. **an EmDash scheduled hook every 1–5 minutes, if the platform provides one**. The cron and background-processing spec covers EmDash's support for this;
  2. opportunistically, in `after()` on every submit and on admin queue and log routes. That mirrors WP-Cron's traffic trigger;
  3. an admin "Process now" button.
- First attempt: run immediately in the submit request's `after()`. That's WP's inline semantics, moved after the response. If the remaining `waitUntil` budget can't cover the action's timeout and the submission is stored, enqueue it instead.
- Workers limits to design for:
  - roughly 30 s of `waitUntil` after the response;
  - the subrequest cap: Pipedrive can make about 8 requests, Zendesk up to 22, Emailit subscribe up to 2 + N audiences.
- If EmDash exposes Cloudflare Queues or Durable Object alarms to plugins, prefer `delaySeconds` scheduling over polling. That needs bindings the plugin sandbox may not have; see Q1.

### 6.6 Ledger storage

`ActionLogger::reserve` needs an **atomic insert-if-absent keyed by `run_key`**. Options:
1. A storage collection with `id = runKey`, if the collection API offers create-if-not-exists or conditional `put`.
2. KV `compareAndSet(\`ledger:${runKey}\`, null, …)`. v0.1.0 relies on null-revision create semantics in `routes.ts:69-75`. Mirror the row into an `action_logs` collection for querying by form, submission, status and type.

Lease rules to port verbatim:
- finish and checkpoint only when `status == processing && lease == mine`;
- a stale processing row becomes `uncertain`, never reclaimed;
- `failed` and `skipped` rows are reclaimable and keep their `steps`.

Also add a `resend_index` collection mapping `resendEmailId → {formId, actionId, submissionId}`, to replace the `LIKE` scan.

### 6.7 Routes to add

All are under `/_emdash/api/plugins/core-forms/`.
- Admin: `actions/test`, `actions/rehearsal`, `actions/copy/sources`, `actions/copy/source`, `actions/copy/prepare`, `actions/telegram-setup`, `actions/whatsapp-cloud-test`, `actions/emailit-audiences`, `action-logs/list`, `action-logs/stats`, `action-logs/failures`, `action-queue/stats`, `action-queue/retry`, `action-queue/process`, `recovery/list`, `recovery/reconcile`.
- Public: `inbound/resend` (form and action ids in the path or query, depending on the EmDash router; see Q7), `inbound/whatsapp-meta` (GET + POST) and `inbound/whatsapp-twilio`.
- After migrating, admins must **re-register** the webhook URLs in Resend, Meta and Twilio. The Twilio signature covers the URL, so a redirect from `/wp-json/...` won't verify.

### 6.8 Extension points

WP exposes these filters and actions:
- `cf_action_email_*`, `cf_action_autoresponder_*`, `cf_action_emailit_*`
- `cf_emailit_subscribe_contact_data`
- `cf_webhook_request_args`, `cf_webhook_response`
- `cf_action_whatsapp_cloud_payload`, `cf_action_whatsapp_redirect_url`
- `cf_mailchimp_action_*`
- `cf_action_queue_stale_minutes`, `cf_action_claim_timeout`
- `cf_is_safe_outbound_url`, `cf_outbound_url_allow_unresolved`
- `cf_whatsapp_reply_received`, `cf_delivery_reconciled`, `cf_action_skipped`
- `cf_available_form_actions`, `cf_form_action_catalog`, `cf_process_form_action_{type}`

EmDash has no PHP hook bus. Either drop them, keeping the defaults, or expose a typed plugin event API later (Q5). `docs/developers/custom-actions.md` (the PHP `Action` subclass) has no EmDash equivalent until a registry API exists.

### 6.9 Tests to write

1. The condition matrix, including an unknown operator and an empty `contains`.
2. Run-key derivation.
3. Ledger state transitions: busy, stale → uncertain, failed → reclaim with steps.
4. The backoff schedule.
5. `IntegrationHttp` classification: 408, 425, 429, 5xx, 0 and `Retry-After` as an HTTP-date.
6. Golden request fixtures per integration, using a mocked `fetch`, matching the URL, method, headers and body in §3.
7. Signing vectors: webhook, Svix, Meta and Twilio.
8. `http_build_query` parity.
9. A Telegram migration rewrite.
10. A Zendesk external_id recovery.
11. An import round-trip that keeps unknown, WP-only and `"0"`/`"1"` settings intact.

---

## 7. WP docs vs code drift (code wins)

- `docs/workflows/retries-logs.md` claims:
  - "All endpoints require `edit_forms`", but `actions/test` needs `manage_options`;
  - "Logs older than 90 days are automatically cleaned up", but `cleanup()` has no caller.
- `docs/workflows/webhook-signatures.md` lists two headers. The code also sends `X-CF-Key-Id`, and always sends `X-CF-Event-Id`.
- `docs/integrations/webhooks.md` claims:
  - "Returns `true` if no WP_Error", but the code requires 2xx plus the body check;
  - its settings table omits signing and the SSRF guard.
- `docs/workflows/async-actions.md` says "each item is processed exactly once". Delivery is at-least-once, and stale rows are retried.
- `docs/integrations/reliability.md` says "Configuration changes create a fresh execution key". The key excludes settings and `_cf_execution_version` is never set.
- `docs/integrations/surecontact.md` claims:
  - run key = `sha256(submission|type|resolved settings)`, but it's `execution_key`;
  - "API message logged verbatim", but `IntegrationHttp` never includes bodies.
- `docs/developers/custom-actions.md` says "Throwing triggers retry". Only `ActionFailure(retryable: true)` retries.
- `docs/integrations/overview.md` lists `[CF_IP]`. The token is `[CF_IP_ADDRESS]`; `[CF_IP]` renders empty.
- The Brevo setting `double_optin` does nothing (`class-brevo.php:46-70`). HubSpot's `phone_field` is unused.

---

## 8. Open questions

1. **Background execution**: does EmDash give plugins a cron or scheduled hook, Queues, or Durable Object alarms? If not, is "after() on traffic + admin process-now" an acceptable retry cadence? WP-Cron has the same traffic dependence.
2. **WP-only execution log**: when an imported WP-only action is reached, log `skipped/wp_only` (recommended) or mirror WP's `failed` "No available handler"?
3. **Mailchimp MC4WP → `mailchimp_api`**: offer conversion at import? It needs the user's API key, because MC4WP stores it in its own option and it isn't exported.
4. **Fidelity vs modernisation**: should a faithful port keep the HubSpot v1 `createOrUpdate`, Kit v3 `api_key`-in-body and Graph `v21.0` pins? Recommendation: port as-is behind one per-module constant, and verify endpoint liveness separately. No external calls were made for this spec.
5. **Hook and filter parity** (§6.8): drop it, or design a plugin event API?
6. **Queue snapshot secrets and file metadata**: store full settings snapshots, as WP does, or a reference plus non-secret snapshot, resolving secrets from the current form at run time? Separately, webhook and Sheets payloads in WP leak the server `dir` of uploaded files. Send public descriptors instead (a deliberate divergence)?
7. **Inbound route shape**: can EmDash plugin routes take path params like `/resend/{form}/{action}`, and can the plugin know its own absolute public URL for the Twilio signature?
8. **WP quirks to keep or fix**:
   - Emailit 409 without audiences counts as a failure;
   - Discord renders `"0"` as `"—"`;
   - Slack shows HTML entities for quotes;
   - Telegram migration silently rewrites saved settings.
   Recommendation: keep the first three for parity, and keep the migration rewrite with a CAS on the form record.
9. **Log retention**: implement the documented 90-day cleanup of event rows (it isn't active in WP), or match WP's keep-forever behaviour?
