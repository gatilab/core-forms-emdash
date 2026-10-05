# 01 · Form engine, server side

Spec for porting the Core Forms 4.11.1 form engine (data model, schema system, rendering, submission pipeline, engine REST) to EmDash. It covers what the code actually does. Where the user docs disagree with the code, the code wins and the disagreement is flagged.

**Path conventions.** WP paths are relative to `.reference/core-forms-wp/` and cite `file:line`. Port paths are relative to `plugins/core-forms/`.

**Out of scope (owned by other specs, referenced only at the hand-off point):** individual actions and `ActionRunner`, payments and gateways, smart forms internals (FieldCalculator expression grammar, DraftManager, save/resume, partial entries), CAPTCHA, Akismet and math-captcha internals, file-upload storage, the admin UI, analytics, team inbox, retention, licensing, polls, and front-end JS behaviour.

---

## 0. Source map

| Area | WP files |
|---|---|
| Bootstrap | `core-forms.php:126-322` (`_bootstrap` on `init` priority 1, line 504) |
| Form object | `src/class-form.php` |
| Engine controller (CPT, shortcode, asset detection, submit, preview) | `src/class-forms.php` |
| Draft publishing, revisions, locks | `src/class-form-definition.php`, `src/functions.php:1308-1449` |
| Availability policy | `src/class-submission-policy.php` |
| Submission/Reply value objects | `src/class-submission.php`, `src/class-reply.php` |
| `{{tag}}` replacers | `src/class-tag-replacers.php`, `src/functions.php:654-691` |
| `[var]` data variables | `src/functions.php:701-1095` |
| Assets | `src/class-assets.php`, `src/class-asset-requirements.php`, `src/class-form-theme.php` |
| Standalone URLs | `src/class-standalone-routes.php` |
| Usage finder | `src/class-form-usage.php` |
| REST | `src/class-rest-forms.php`, `src/class-rest-submissions.php`, `src/rest/class-rest-headless.php`, plus routes in `class-form-definition.php`, `schema/class-field-groups.php`, `workflows/class-rehearsal.php`, `admin/class-privacy-controls.php` |
| Schema | `src/schema/*.php` |
| Templates | `src/templates.php`, `src/templates/industry.php` |
| Block / shortcode | `block.json`, `render.php`, `class-forms.php:559-594` |
| Lifecycle | `src/functions.php:1457-2435` (migrations, activation, tables), `uninstall.php` |

---

## 1. Data model

### 1.1 Forms: the `core-form` post type

Registered at `class-forms.php:74-96`: `public=false`, `show_in_rest=true`, `map_meta_cap=true`, `supports=[title, editor, revisions, author]`.

| WP field | Meaning | Notes |
|---|---|---|
| `ID` | Form id. Used in `[cf_form id]`, the `.cf-form-{ID}` class, `_cf_h{ID}`, `cf-form-{ID}-N-` id prefixes and every FK | Integer. Keep it on import because content embeds reference it. |
| `post_title` | `Form::$title`. Also the form's `aria-label` | `sanitize_text_field` on save |
| `post_name` | `Form::$slug`. Used by `[cf_form slug]`, block `slug` and the standalone-slug fallback | Unique per type. `FormDefinition::reserve_slugs` (`class-form-definition.php:171-184`) also reserves the published slugs of other forms, appending `-2`, `-3`, ... |
| `post_content` | `Form::$markup`: the field HTML **without** a `<form>` tag. Admin and REST strip `</?form[^>]*>` (`admin/class-admin.php:1262`, `class-rest-forms.php:443`) | Sanitized by `Admin::sanitize_markup` (KSES allowlist, `admin/class-admin.php:1695-1809`) unless the author has `unfiltered_html`. |
| `post_status` | `publish` normally. The admin always saves `publish` (`admin/class-admin.php:1268`). Import keeps `publish/draft/pending/private`. | `SubmissionPolicy::error` refuses submissions unless `publish` (`form_closed`). Rendering by **id** does not check status. |
| `post_author`, `post_date(_gmt)`, `post_modified(_gmt)` | Audit | |

The `cf_get_forms()` query is `post_status => 'any'` (`functions.php:23-44`), which excludes trash and auto-drafts.

### 1.2 Post meta on `core-form`

| Meta key | Shape (after `maybe_unserialize`) | Written by | Read by | Import? |
|---|---|---|---|---|
| `_cf_settings` | assoc array of form settings (§1.3), including `actions` (list of action arrays) | Admin save (`admin/class-admin.php:1361-1367`, a **recursive merge of current effective settings + posted values**, so stored arrays normally contain every default key), REST create/update, template presets | `cf_get_form` (`functions.php:112-115`, `array_merge(defaults, stored)`) | **Yes**, verbatim |
| `cf_message_{key}` | string, one meta row per message (KSES'd unless `unfiltered_html`) | Admin save (`admin/class-admin.php:1371-1381`), template presets | `cf_get_form` (`functions.php:119-125`) | **Yes** |
| `_cf_form_schema` | `FormSchema::to_array()` (§2.1) | Builder, REST schema/editor-state, templates | `FormSchema::load` | **Yes** |
| `_cf_live_definition` | Snapshot `{title, slug, status, markup, meta{…}}` (§3.16). Only present once draft publishing is on. | `FormDefinition::publish` | `cf_get_form` in non-draft contexts | **Yes** |
| `_cf_hidden_columns` | string[] of field names hidden in the per-form submissions table | Admin | Admin list table | Yes |
| `_cf_headless` | Revisioned and part of the definition, but nothing in 4.11.1 writes it. Headless state lives in `_cf_settings.headless_enabled`. | none | `FormDefinition::meta_keys` | Carry if present |
| `_cf_blocked_counts` | `{honeypot_missing?:int, honeypot_filled?:int}` | `Forms::record_blocked_attempt` (`class-forms.php:1140-1156`) | Analytics panel | Yes |
| `_cf_unseen_submissions` | int[] of submission ids (unread badge) | notifications extension | Admin | Optional (rebuild from `status='new'`) |
| `_cf_a11y_report` | AccessibilityTester report array | `AccessibilityTester::test_and_store` | Admin list | No (regenerate) |
| `_cf_revision_definition` | complete snapshot, stored on **revision** posts | `_cf_wire_revisions` (`functions.php:1392-1407`) | `FormDefinition::revision_definition` | With revisions |
| `_cf_license_*` | licensing linkage | licensing spec | | licensing spec |

Revisioned keys: `cf_revisioned_meta_keys()` = `_cf_settings, _cf_hidden_columns, _cf_form_schema, _cf_headless` plus wildcard `cf_message_*` (`functions.php:1308-1317`). The definition keys are `FormDefinition::meta_keys()` = `_cf_settings, _cf_form_schema, _cf_headless, _cf_hidden_columns` plus `cf_message_*` (`class-form-definition.php:12-14`).

Attachment meta used by the engine for privacy: `_cf_form_id`, `_cf_submission_id`, `_cf_private_path` (`admin/class-privacy-controls.php:28-53`).

### 1.3 Form settings: complete key list and defaults

Effective settings are `array_merge(cf_get_form_default_settings(), stored _cf_settings)` (`functions.php:110-115`). The live/revision path uses `array_replace` (`class-form-definition.php:153`). Defaults come from `functions.php:141-191`, extended by `cf_form_default_settings` filters (sources noted).

Stored value types vary. Admin checkboxes post `"1"`/`"0"` strings, numbers arrive as strings, templates use ints and bools, and `payment_enabled` is coerced to bool. **An importer must accept `1|"1"|true|"on"` as truthy and `0|"0"|""|false|null` as falsy**, except for the tri-state keys flagged ⚑, where `""` means "inherit global".

| Key | Default | Source | Consumed server-side by | Notes |
|---|---|---|---|---|
| `save_submissions` | `1` | core | process (store), payments require it, admin tabs | |
| `hide_after_success` | `0` | core | response `hide_form` | |
| `redirect_url` | `''` | core | response `redirect_url` after `[var]` replacement | `esc_url_raw` on admin save |
| `required_fields` | `''` | core | `Form::get_required_fields` | comma list; `[]` suffix stripped |
| `email_fields` | `''` | core | `Form::get_email_fields` | comma list |
| `confirmation_type` | `'message'` | core | **nothing server-side** | UI offers `message` and `redirect`. The comment mentions `page`. Redirect happens whenever `redirect_url` is non-empty. |
| `confirmation_page_id` | `0` | core | nothing | inert |
| `enable_honeypot` | `1` | core | **nothing**: the honeypot is always rendered and always enforced | UI-only flag |
| `prevent_duplicates` | `0` | core | duplicate check (§4.2 step 12) | |
| `rate_limit` | `0` | core | per-IP/hour limit | filter `cf_submit_rate_limit` |
| `enable_save_resume` | `0` | core | asset manifest, DraftManager | smart-forms spec |
| `enable_partial_entries` | `0` | core | asset manifest, DraftManager | smart-forms spec |
| `draft_expiry_days` | `30` | core | DraftManager | |
| `schedule_enabled` | `0` | core + scheduler (`false`) | `FormScheduler::is_open` | |
| `schedule_open_date` / `schedule_close_date` | `''` | core | is_open | `Y-m-d`. Open = 00:00 in the tz; close = 23:59:59 in the tz (`smart-forms/class-form-scheduler.php:78-92`) |
| `schedule_days` | `[]` | core | is_open | subset of `mon..sun`; empty means every day |
| `schedule_open_time` / `schedule_close_time` | `''` | core | is_open | `H:i` **daily window** that may cross midnight; independent of the dates |
| `schedule_timezone` | `''` | core | is_open | invalid or empty falls back to the site tz. No UI. |
| `schedule_closed_message` | `''` | core | `FormScheduler::maybe_block_form` (render) | fallback `'This form is currently closed.'` |
| `submit_button_text` | `''` | core | **nothing in the engine** | the builder bakes it into markup; templates set it |
| `loading_text` | `''` | core | nothing server-side | front-end reads `data-loading-text` off the submit button |
| `success_scroll` | `1` | core | nothing server-side | |
| `ajax_submit` | `1` | core | `get_html` (action attr, novalidate, `_cf_source_url`, noscript), data attr `data-ajax-submit` | |
| `analytics_enabled` ⚑ | `''` | core | `Tracker::is_enabled_for_form` | `''` means use the global `enable_analytics`; `'1'`/`'0'` force |
| `load_stylesheet` ⚑ | `''` | core | `AssetRequirements::should_load_stylesheet` | `''` inherits global (default `0`) |
| `load_form_theme` ⚑ | `1` | core | `should_load_theme` | `'1'`/`'0'` force; any other value inherits global (default `1`) |
| `custom_css` | `''` | core | `get_html` `<style>` | sanitized on save **and** at render |
| `custom_js` | `''` | core | `get_html` `<script>` | dropped on save unless the author has `unfiltered_html` |
| `form_class` | `''` | core | `get_html` class attr | split on whitespace, `sanitize_html_class` |
| `standalone_enabled` | `0` | core | StandaloneRoutes | the 4.5.0 migration set it to `1` for fullscreen forms |
| `standalone_slug` | `''` | core | StandaloneRoutes | made unique on save (`StandaloneRoutes::unique_public_slug`) |
| `standalone_page_title` | `''` | core | StandaloneRoutes `<title>` | |
| `standalone_indexable` | `0` | core | robots meta and header | |
| `headless_enabled` | `false` | `rest/class-rest-headless.php:54-57` | headless REST | |
| `payment_enabled` | `false` | `payments/class-payments.php:58-73` | payment branch, assets | payments spec |
| `payment_provider` | `''` | payments | | `stripe/paypal/razorpay/polar/fluentcart` |
| `payment_amount` | `''` | payments | | |
| `payment_currency` | `'USD'` | payments | | upper-cased to 3 letters on save |
| `payment_description` | `''` | payments | | |
| `payment_success_redirect` | `''` | payments | | |
| `payment_required` | `true` | payments | | |
| `payment_flow` | `'hosted'` | payments | inline Stripe asset flag | `hosted\|inline` |
| `payment_products` | `''` | payments | product picker | |
| `fluentcart_variation_id`, `fluentcart_quantity` (`1`), `fluentcart_quantity_field` (`''`) | | payments | | |
| `display_mode` | `'normal'` | `extensions/fullscreen-forms/fullscreen-forms.php:11-20` | assets, standalone, fullscreen | `normal\|fullscreen` |
| `fullscreen_theme` (`'light'`), `fullscreen_show_progress` (`'1'`), `fullscreen_animation` (`'slide'`), `fullscreen_page_title` (`''`), `fullscreen_external_css` (`''`), `fullscreen_external_js` (`''`) | | fullscreen ext | data attrs, standalone | external URLs must be `https`, split on newlines or commas |
| `submission_limit` | `''` (**only registered in wp-admin**: `extensions/submission-limit/src/class-admin.php:16-19`) | ext | `SubmissionPolicy::error/lock`, render | read as `(int)(… ?? 0)` |
| `require_user_logged_in` | `'0'` (admin-only default) | ext | SubmissionPolicy, render | |
| `enable_notifications` | `1` | `extensions/notifications/src/Notifier.php:12-15` | unread badge | |
| `enable_turnstile` | (unset) | Turnstile | per-form Turnstile | CAPTCHA spec |
| `enable_math_captcha` | (unset) | MathCaptcha | | CAPTCHA spec |
| `protect_uploads` | (unset) | PrivacyControls/uploader | | |
| `submission_retention_days`, `attachment_retention_days` | (unset → 0) | PrivacyControls | | retention spec |
| `actions` | (unset) | admin Actions tab | action loop | list of `{type, conditions?, …}`; actions spec |

Template presets (`cf_get_template_settings`, `templates.php:424-438`) create forms whose `_cf_settings` contain **only** the preset keys: `save_submissions, ajax_submit, enable_honeypot, display_mode, payment_enabled, confirmation_type, redirect_url, confirmation_page_id, required_fields, email_fields, schedule_enabled, enable_save_resume, enable_partial_entries` + preset + `actions` (a default email action is added when a non-blank preset has none). The blank template stores no `_cf_settings` at all. **Stored arrays can therefore be partial or full, and defaults must always be merged at read time.**

### 1.4 Messages: keys and defaults

Effective messages are `array_merge(cf_get_form_default_messages(), cf_message_* meta)`. Lookups go through `Form::get_message($code)` → filter `cf_form_message_{code}`, which returns `''` for unknown codes (`class-form.php:417-427`).

| Key | Default text | Source |
|---|---|---|
| `success` | `Thank you! We will be in touch soon.` | `functions.php:195` |
| `invalid_email` | `Sorry, that email address looks invalid.` | :196 |
| `invalid_field_value` | `One or more fields contain an invalid value. Please check your entries.` | :197 |
| `required_field_missing` | `Please fill in the required fields.` | :198 |
| `field_too_long` | `One or more fields are too long. Please shorten your response and try again.` | :199 |
| `submission_too_large` | `This submission is too large. Please shorten it and try again.` | :200 |
| `error` | `Oops. An error occurred.` | :201 |
| `recaptcha_failed` | `reCAPTCHA verification failed. Please try again.` | :202 |
| `recaptcha_low_score` | `Your submission appears to be spam. Please try again.` | :203 |
| `spam` | `Your submission was flagged as spam.` | :204 (never shown; spam answers success) |
| `math_captcha_failed` | `Incorrect answer to the math problem. Please try again.` | :205 |
| `duplicate_submission` | `You have already submitted this form with the same details.` | :206 |
| `form_closed` | `This form is currently closed.` | `smart-forms/class-form-scheduler.php:29-32` |
| `submission_limit_reached` | `The submission limit for this form has been reached.` | `extensions/submission-limit/submission-limit.php:6-13` |
| `require_user_logged_in` | `You must be logged in before you can use this form.` | `extensions/require-user-logged-in/require-user-logged-in.php:6-13` |
| `file_too_large` | `Uploaded file is too large.` | `extensions/file-upload/file-upload.php:6-12` |
| `file_upload_error` | `An upload error occurred. Please try again later.` | same |
| `file_invalid_extension` | `This file type is not allowed.` | same |
| `file_mime_mismatch` | `The uploaded file does not match its extension. Please upload a valid file.` | same |
| `turnstile_failed` | **no runtime default** (`''`). The admin field pre-fills `Verification failed. Please try again.`, which is persisted on the first save (`admin/class-turnstile.php:303`). | port: use that text as the default |
| custom codes | Returned by `cf_validate_form` filters or custom-field validators (e.g. `invalid_postal_code`). They resolve to `''` unless a `cf_message_{code}` exists. | |

Hard-coded response texts that are **not** message keys: honeypot `Thank you! We will be in touch soon.` (the literal string, not the form's `success`); nonce `Your session has expired.`; missing form `This form is no longer available.`; lock busy `Please try again in a moment.`; availability fallback `This form is currently unavailable.`; rate limit `Too many submissions. Please try again in a moment.`; calc failure `The form total could not be calculated. Please check your answers.`; unsaved capacity `Your submission could not be accepted. Please try again.`; and the payment strings in `class-forms.php:1017-1092`.

Every message (defaults plus saved, including custom keys) is emitted as a `data-message-{key with _→-}` attribute on `<form>` (`class-form.php:167-171`).

### 1.5 Global options

`cf_settings` is read through `cf_get_settings()` (`functions.php:431-585`). Defaults:

```
enable_nonce: 1          // 4.2.0 flipped the default. Pre-4.2 installs without the key get 0 (functions.php:524-529; migration :1593-1600)
load_stylesheet: 0
load_form_theme: 1
enable_analytics: 1
delete_data_on_uninstall: 0
standalone_base_slug: 'collect'
wrapper_tag: 'p'         // SchemaRenderer accepts p|div|span only (schema/class-schema-renderer.php:10-14). The docs also list `label`, which the code rejects.
google_recaptcha: { site_key:'', secret_key:'' }
cloudflare_turnstile: { site_key:'', secret_key:'' }
reply_from_email: ''
akismet_whitelist: ''
emailit: { api_key:'' }
payments: { mode:'test', currency_gateways:<router defaults>, stripe{publishable_key_test, secret_key_test, publishable_key_live, secret_key_live, webhook_secret}, paypal{client_id_test, client_secret_test, client_id_live, client_secret_live, webhook_id}, razorpay{key_id_test, key_secret_test, key_id_live, key_secret_live, webhook_secret}, polar{access_token_test, access_token_live, webhook_secret} }
headless: { api_key:'', allowed_origins:'' }
whatsapp_cloud: { access_token:'', phone_number_id:'', business_account_id:'' }
```

Nested arrays are deep-merged one level (`functions.php:541-575`). Other modules add keys (e.g. `license_server`). On a fresh install the option is created as `[]` (`functions.php:515-518`). Filter: `cf_settings`.

Other engine options:

| Option | Shape | Notes |
|---|---|---|
| `cf_db_version` | string, currently `'4.11.0'` (`CF_SCHEMA_VERSION`, `functions.php:1457`) | migration gate |
| `cf_migration_error` | `{message, at}` | |
| `cf_form_theme_tokens` | `{'--cf-text': '#…', …}` limited to the allowed tokens (§3.13) | |
| `cf_form_theme_asset` | `{path, url, version}` (`class-form-theme.php:11,117-123`) | regenerate; don't import |
| `cf_field_groups` | `{ [id16hex]: {id, label, fields: Field[], owner:int, shared:bool} }` (`schema/class-field-groups.php:29-42`) | **import** |
| `cf_unsaved_capacity_{formId}` | int counter of accepted-but-unsaved submissions (`class-submission-policy.php:27-36`) | counts toward `submission_limit` |
| `_cf_lock_{sha256}` | CAS lease `{owner, expires}` (SQLite path, `class-form-definition.php:104-125`) | ephemeral |
| `cf_retention_last_run` | `{at, entries, attachments}` | retention spec |

### 1.6 Transients (ephemeral; map to KV with TTL)

| Key | Value | TTL | Source |
|---|---|---|---|
| `cf_native_{token}` (token = 32 hex) | `{form_id, response}` | 300 s | `class-forms.php:665-670` |
| `cf_rl_{md5(ip.'_'.formId)}` | int count | `HOUR_IN_SECONDS`, **reset on every increment**, so the window slides | `class-forms.php:755-756,926-928` |
| `cf_dup_{md5(formId.'|'.scope.'|'.json(ksorted data minus pending files))}` (scope `u{userId}` or `i{ip}`) | `1` | `cf_duplicate_window_seconds` (default 3600) | `class-forms.php:1170-1219` |
| `cf_form_template_parts` | string[] of block-theme template parts that contain a form | 1 day | `class-forms.php:513-543` |

### 1.7 Tables

**`{prefix}cf_submissions`** (`functions.php:2300-2341`; columns added by migrations 3.5.0, 4.0.0, 4.1.0; indexes from 4.9.0 at `:1944-1969`):

| Column | Type | Default | Meaning |
|---|---|---|---|
| `id` | INT UNSIGNED PK AI | | |
| `form_id` | INT UNSIGNED NOT NULL | | |
| `data` | TEXT NOT NULL | | `wp_json_encode` of field map (§1.8). Capped at 60 KiB by validation. |
| `user_agent` | TEXT NULL | | `HTTP_USER_AGENT` |
| `ip_address` | VARCHAR(255) NULL | | `REMOTE_ADDR` (no proxy-header handling) |
| `referer_url` | TEXT NULL | | `HTTP_REFERER` (headless: `_cf_page_url`) |
| `is_spam` | TINYINT(1) | 0 | separate flag, **not** a status |
| `status` | VARCHAR(30) | `'new'` | §1.8 |
| `draft_token` | VARCHAR(64) NULL | | save/resume |
| `current_step` | INT UNSIGNED | 0 | multi-step progress |
| `payment_status` | VARCHAR(30) NULL | | `pending_payment\|paid\|payment_failed\|refunded` |
| `payment_provider` | VARCHAR(20) NULL | | |
| `payment_id` | VARCHAR(190) NULL | | |
| `payment_amount` | BIGINT UNSIGNED NULL | | minor units |
| `payment_currency` | VARCHAR(8) NULL | | |
| `submitted_at` | TIMESTAMP | CURRENT_TIMESTAMP | written as `gmdate('Y-m-d H:i:s')` (**UTC**) |
| `modified_at` | TIMESTAMP NULL | | |

Indexes: `idx_draft_token(draft_token)`, `idx_payment_id(payment_provider, payment_id)`, `idx_form_spam_submitted(form_id, is_spam, submitted_at)`, `idx_form_submitted(form_id, submitted_at)`, `idx_submitted(submitted_at)`, `idx_status_modified(status, modified_at)`.

**`{prefix}cf_submission_replies`** (`functions.php:3424-3449`): `id, submission_id, direction('outbound'), channel('email'), provider, provider_message_id, status('received'), from_email, to_email NOT NULL, subject VARCHAR(500), message LONGTEXT, payload LONGTEXT, user_id BIGINT, sent_at TIMESTAMP`. Indexes: `submission_idx`, UNIQUE `provider_message_idx(provider, provider_message_id)`. The engine only defines the shape; the inbox spec owns behaviour.

Other tables created at activation, owned by other specs: `cf_email_logs`, `cf_polls`, `cf_poll_votes`, `cf_action_queue`, `cf_action_logs`, `cf_analytics`, `cf_license_*` (×10), `cf_submission_team` (`admin/class-team-inbox.php:50-58`: `submission_id PK, assignee, due_at, hold, notes JSON, version, reminded_at`), `cf_fulfillment`, `cf_payment_reversals`.

### 1.8 Submission object, statuses and the `data` value shapes

`Submission` (`class-submission.php`): `id, execution_id (unsaved runs), form_id, data, user_agent, ip_address, referer_url, is_spam, status='new', draft_token, current_step, submitted_at, modified_at, payment_status, payment_provider, payment_id, payment_amount, payment_currency`. `from_object` json-decodes `data`.

`status` values: `new, read, replied, archived` (inbox; the only values `cf_update_submission_status` and the REST PATCH accept, `functions.php:2734-2773`), `draft, partial` (DraftManager), and `pending_payment, paid, payment_failed, refunded` (`Payments::mark_payment_status` writes **both** `status` and `payment_status`, `payments/class-payments.php:314`). Spam is the `is_spam` flag. Deletion is a hard delete (`PrivacyControls::delete_submission`); there is no trash.

`data` is `{ fieldName: value }`, where `value` is one of:
- a `string`, trimmed with `stripslashes`, `{{tags}}` expanded (§3.10);
- a `string[]` (from `name[]`), which must be a list of scalars;
- a stored file descriptor `{name, size, type, attachment_id, url?, dir?, private?}`, or a list of them (file-upload spec);
- the literal `"Attachment removed by retention"` where retention retired a file (`admin/class-privacy-controls.php:170`);
- calculated fields: the numeric result written by FieldCalculator;
- legacy rows may contain an `action: "cf_form_submit"` key (shown as "Form Submission" by `cf_friendly_action_label`, `functions.php:1016-1023`).

A PHP `$_POST` quirk to replicate: a repeated scalar name (no `[]`) keeps **only the last** value. A single checkbox `name="x"` stores a **string**.

### 1.9 Request-scoped caches

`cf_get_form` memoizes per `{postId}:{version}:{draftContext}` and returns clones (`functions.php:100-137`). The version is bumped on `save_post_core-form` and on any meta change of a `core-form` (`:221-271`). `cf_count_form_submissions` memoizes counts, invalidated on `cf_submission_inserted` (`:322-362`). `cf_get_field_labels` caches per form id (`:905-983`). On Workers these become per-request memos; nothing persistent is needed.

### 1.10 Lifecycle

- **Activation** (`functions.php:2133-2175`): create all tables, add the `.htaccess`/`index.php` guards in `uploads/core-forms`, grant `edit_forms` and `manage_core_forms_licenses` to the activating user and the administrator role, run migrations, register and flush the standalone rewrite. Multisite runs the same per site (`:2250-2295`, `:2417-2435`).
- **Migrations** (`functions.php:1478-1929`) are version-gated. Engine-relevant ones: 4.5.0 fullscreen → `standalone_enabled=1` and `standalone_slug=sanitize_title(slug)` (`:1804-1822`); 4.6.3 `MarkupParser::repair_legacy_schema` on stored schemas (`:1863-1881`); 4.9.0 submission indexes and theme-token contrast upgrade (`#cbd5e1→#7d8da3`, `#ef4444→#dc2626`, `#16a34a→#15803d`, only on exact match, `:1990-2020`). **An importer should apply the same 4.5.0 and 4.6.3 normalizations to pre-4.5/4.6.3 data.**
- **Deactivation** (`:2184-2205`) clears crons `cf_process_queued_actions, cf_cleanup_drafts, cf_cleanup_analytics, cf_poll_auto_close, cf_license_subscription_maintenance, cf_retention_cleanup, cf_team_reminders`.
- **Uninstall** (`uninstall.php`) acts only when `cf_settings.delete_data_on_uninstall`. It deletes private attachments (all-or-nothing ownership validation first), `uploads/core-forms`, all `core-form` posts, 21 tables, options `cf_settings, cf_db_version, cf_form_theme_tokens, cf_field_groups, cf_retention_last_run, cf_migration_error`, `cf_unsaved_capacity_*`, `_cf_lock_*`, user meta `{prefix}cf_form_scope`/`cf_inbox_views`, `_transient(_timeout)_cf_*`, all `_cf_*` postmeta, crons, and the `edit_forms` cap.

### 1.11 Native export format (the import source to support)

`Admin\CoreDataMigration` (`admin/class-core-data-migration.php`) writes `format: "core-forms-data", format_version: 1`. The **EmDash importer should accept this format** in addition to the port's simple export (`wordpress/export-core-forms.php`).

```jsonc
{
  "format": "core-forms-data", "format_version": 1, "plugin_version": "4.11.1", "created_at": "c",
  "source": { "home_url", "site_url" },
  "selection": { "datasets": [...], "form_ids": [...] },
  "references": { "forms": { "<oldId>": { "slug", "title" } }, "media": [...] },
  "data": {
    "forms":       { "posts": [ { "id", "post_title", "post_name", "post_content", "post_excerpt", "post_status",
                                  "post_author", "post_date", "post_date_gmt", "menu_order",
                                  "meta": { "<key>": [ <unserialized value>, ... ] } } ] },   // every meta key, as a value LIST
    "submissions": { "cf_submissions": [ <raw row, data still a JSON string> ], "cf_submission_replies": [ <raw row> ] },
    "settings":    { "options": { "cf_settings": {...}, "cf_form_theme_tokens": {...} } },
    "polls" | "activity" | "commerce": ...   // other specs
  }
}
```

WP import semantics (`:386-470`, `:650-790`): forms are matched by slug with policy `create|update|skip`, and an id map is built. Submissions are skipped if their form is unmapped and get new ids. Replies are remapped through the submission map. Only `cf_settings` and `cf_form_theme_tokens` options are restored. **The port's import requirement is to preserve form ids** (content embeds use them) and to map submissions through form ids.

---

## 2. Form schema system

### 2.1 Storage shape (`_cf_form_schema`)

`FormSchema` (`schema/class-form-schema.php`): `SCHEMA_VERSION = 1`, `META_KEY = '_cf_form_schema'`.

```jsonc
{
  "version": 1,
  "fields": [ Field, ... ],          // ORDER MATTERS: rendering iterates array order, not `position`
  "layout": { "type": "single" | "multi-step" | "conversational", "steps"?: [ { "id", "label"? | "title"? } ] },
  "form_settings": {}                // unused by the engine
}
```

`Field::to_array()` (`schema/class-field.php:160-211`) always emits `name, type, label, placeholder, required, position`. Optional keys appear only when non-empty: `default_value, default_values[], checked:true, css_class, description, options[], validation{}, conditions[], wrapper_attributes{}, attributes{}, group`. The layout keys **`parent, cols_desktop, cols_tablet, cols_mobile, gap` are duplicated** at the top level and inside `attributes`. `from_array` accepts either location (top level wins into `attributes`). An unknown `type` becomes `text` unless it is a registered custom type. `from_array` also runs `repair_wrapper_collisions()` (`class-form-schema.php:69-86`) to undo a 4.9.2 bug where a container and its only child shared a name.

Option object: `{ value, label, disabled?:bool, group?:string (optgroup label), id?:string, css_class?:string, attributes?:{} }`.
Validation keys used: `min, max, minlength, maxlength, pattern, step`.
Condition object: `{ action: "show"|"hide", rule: "<field>[:=]<v1|v2|*>" }` (§2.10). The docs' `{field, operator, value}` shape in `docs/developers/schema.md` is **not** what the renderer or validator read. It is the *action-condition* shape (§4.8).

### 2.2 Field types (`Field::TYPES`, `schema/class-field.php:21-29`)

| Class | Types |
|---|---|
| Native inputs | `text, email, url, tel, number, date, time, datetime-local, password, color, range, hidden, file, search, month, week` |
| Complex | `textarea, select, radio, checkbox` |
| Composite (render as **one** native control plus a `data-cf-field-type` marker) | `name` (text, `autocomplete=name`), `address` (textarea, `autocomplete=street-address rows=3`), `consent` (checkbox), `rating` (radio group min..max) |
| Containers | `container` (div), `fieldset` |
| Layout (non-input) | `heading, paragraph, divider, html` |
| Buttons | `submit, button, reset` |
| Custom | any `cf_register_field_type()` type |

`get_input_fields()` (`class-form-schema.php:183-193`) excludes `heading, paragraph, divider, container, fieldset, html, button, reset`. `submit` is included **only when it has a name not starting with `_`**. That is how a named submit button's value can become submission data.

> The docs (`docs/form-builder/field-types.md`) describe Name as first and last inputs and Address as a multi-input block. **4.11.1 renders a single control for each.** Treat the code as authoritative.

### 2.3 Attribute allowlists (shared by parser and renderer)

`Field::is_html_attribute($name)` (`schema/class-field.php:32-43`):
- denied (schema-reserved): `data-show-if, data-hide-if, data-cf-field-type, data-cf-field, data-cf-field-name, data-cf-original-id, data-cf-step-group, data-cf-choice-group, data-cf-required-group, data-cf-description, data-cf-placeholder, data-cf-conditions`;
- allowed: `/^(?:data|aria)-[a-z0-9_.:-]+$/` plus `autocomplete, inputmode, enterkeyhint, autocapitalize, autocorrect, spellcheck, autofocus, disabled, readonly, multiple, accept, capture, list, size, rows, cols, wrap, title, role, tabindex, dir, lang, hidden, style`.
- `min/max/minlength/maxlength/pattern/step` live in `validation`, **not** in `attributes`. Values placed in `attributes` (as the industry templates do for `min`, `step`, `maxlength`) are silently ignored. Replicate this, or fix it consciously.

`Field::is_wrapper_attribute($name)` (`schema/class-field.php:46-49`): `id, class, style, title, role, tabindex, dir, lang, hidden`, or any allowed `data-*`/`aria-*`.

`style` values pass through `safecss_filter_attr`.

### 2.4 SchemaRenderer: exact HTML per type

`SchemaRenderer::render($schema, $prefix='cf-field-')` (`schema/class-schema-renderer.php:15-26`) walks top-level fields (no parent, §2.5) in array order, renders containers recursively, then runs `normalize_ids` (§2.4.4). `W` is the global `wrapper_tag` (`p|div|span`, default `p`). Attribute serialization: `true` gives a bare attribute, `false`/`null` are omitted, everything else is `esc_attr`'d (`:314-322`).

`id = prefix + (field.attributes.id ?? field.name)`; `id_base = attributes.id ?? name`.

**Marker attributes** (`marker_attrs`, `:277-287`): `data-cf-field="1" data-cf-field-type="{type}" data-cf-field-name="{name}" [data-cf-step-group="{group}"] [class="{css_class}"]`.

**Condition attributes** (`condition_attrs`, `:288-295`): keep conditions with `action ∈ {show,hide}` and a non-empty `rule`. More than one gives `data-cf-conditions='{JSON}'`; exactly one gives `data-show-if="{rule}"` or `data-hide-if="{rule}"`.

**Control attributes** (`control_attrs`, `:242-276`), in order: allowed `attributes` (scalar, `!== false`); `placeholder`; `class=css_class`; `required`; `aria-describedby="{id}-desc"` if `description`; `validation` min/max/minlength/maxlength/pattern/step (non-empty scalars); for `email`, `maxlength = min(254, max(1, maxlength || 254))`; `data-calculation` from `attributes.calculation ?? attributes['data-calculation']`; then the condition attributes.

**Wrapper** (`wrap`, `:300-313`): `<W {safe wrapper_attributes} data-cf-field="1" data-cf-field-type data-cf-field-name [data-cf-step-group] {extra}>\n{inner}\n</W>\n`. The marker `class` is **removed** from the wrapper (`css_class` goes on the control). Conditions sit on the **control**, except for custom types, where they go on the wrapper.

**Description**: `<small data-cf-description="1" id="{id}-desc">{esc description}</small>\n`.
**Label**: `<label for="{id}">{esc label}</label>\n` when `label` is non-empty.

| Type | Output (attribute order as emitted) |
|---|---|
| `heading` | `<h{L}{marker}>{esc label}</h{L}>\n`. `L = attributes.level` clamped 1..6, default **3**. Not wrapped. |
| `paragraph` | `<p{marker}>{kses(default_value ?: label)}</p>\n`. Not wrapped. |
| `html` | `<div{marker} style="display:contents">{kses(default_value)}</div>\n`. kses is `post` plus `datalist`, `option`, `output`. |
| `divider` | `<hr{marker} />\n` |
| `submit` / `button` / `reset` | W-wrapped `<button type="{type}"{control attrs minus placeholder,required} data-cf-original-id="{id_base}" id="{id}"[ name="{name}" if name and not "_…"][ value="{default_value}"]>{esc(label ?: 'Submit')}</button>` |
| `text, email, url, tel, number, date, time, datetime-local, password, color, range, search, month, week, file` | W-wrapped `{label}<input type="{type}" id="{id}" name="{name}"{control attrs} data-cf-original-id="{id_base}"[ value="{default_value}" unless file] />{help}`. `file` with the `multiple` attribute gets `name[]`. |
| `hidden` | `<input type="hidden" id="{id}" name="{name}"{attrs} data-cf-original-id="…"[ value] />\n`. **No wrapper, no label.** |
| `name` | as text, plus `data-cf-field-type="name"`, plus `autocomplete="name"` unless already set |
| `textarea` | W-wrapped `{label}<textarea id name{attrs} data-cf-original-id>{esc_textarea default_value}</textarea>{help}` |
| `address` | as textarea, plus `data-cf-field-type="address"`, plus `autocomplete="street-address" rows="3"` unless set |
| `select` | W-wrapped `{label}<select id name[[] if multiple]{attrs minus placeholder}[ data-cf-placeholder="{placeholder}"] data-cf-original-id>[<option value="">{placeholder}</option>]{options}</select>{help}`. Options are `<option value[ selected][ disabled]>{esc label}</option>`, grouped in `<optgroup label>` while consecutive options share `group`. Selected = `default_values ?: [default_value]`. |
| `checkbox` without options, `consent` | W-wrapped `<label><input type="checkbox" id name{attrs minus placeholder} data-cf-original-id[ data-cf-field-type="consent"] value="{default_value ?: '1'}"[ checked] /> {esc label}</label>{help}` |
| `radio`, `checkbox` with options, `rating` | **Not W-wrapped**: `<fieldset{marker}{conditions} data-cf-choice-group="{type}"[ aria-required="true"][ data-cf-required-group="true" (checkbox only)]>\n[<legend>{esc label}</legend>\n]` then per option `<label><input type="radio\|checkbox" id="{prefix}{option.id ?? name-index}" name="{name}[] for checkbox, else {name}"{control attrs minus placeholder,required,data-show-if,data-hide-if,data-cf-conditions}{option.attributes}[ class=option.css_class] value="{value}"[ checked][ required (radio/rating when field required)][ disabled (field or option)] data-cf-original-id="{option id base}"[ data-cf-field-type="rating"] /> {esc option label}</label>\n`, then `{help with id {prefix}{name}-desc}</fieldset>\n`. Rating options are `n = min..max` with `min = clamp(validation.min ?? 1, 0, 20)` and `max = clamp(validation.max ?? 5, min, 20)`. |
| custom type | `wrap(sanitize_markup(render_cb(field, id)), field, conditions)`. `data-cf-field-type` is set on the control whose `name === field.name` (`schema/class-custom-fields.php:23-34`). |

#### 2.4.4 `normalize_ids($html, $prefix)` (`:335-375`)

For every element with `id`, take `original = data-cf-original-id ?: (id without prefix)` and set `id = prefix + original` and `data-cf-original-id = original`. Then rewrite the tokens of `for, list, aria-describedby, aria-labelledby` and `href="#…"` through the old→new map. **This only happens on the schema path. Legacy markup ids are not prefixed** (§3.3).

### 2.5 Containers

- A field's parent is `attributes.parent` (if non-empty), else `group` when `group` names another `container|fieldset` field (`parent_name`, `:27-38`).
- `render_container` (`:39-96`) emits `<div|fieldset{marker}[ disabled (fieldset with attributes.disabled)][ class="cf-row {css_class}" for container, deduped / class=css_class for fieldset][ style="--cf-cols:N;--cf-cols-t:N;--cf-cols-m:N;--cf-gap:G;"]{conditions}>\n[<legend>{esc label}</legend>\n (fieldset only)]{children…}</div|fieldset>\n`. Columns are clamped 1..6 from `cols_desktop/tablet/mobile`. `gap` must match `/^(?:0|[0-9.]+(?:px|rem|em|%|vw|vh))$/`. Depth over 10 gives `<!-- max nesting depth reached -->`. A disabled container adds `disabled` to every descendant `input/select/textarea/button`.
- Children are fields whose `parent_name` equals the container's name, in array order.

### 2.6 Multi-step and conversational render

`Form::get_markup` uses `MultiStep::render` when `layout.type ∈ {multi-step, conversational}` (`smart-forms/class-multi-step.php:25-31,107-181`). Steps are `layout.steps` if present; otherwise distinct `group ?: 'default'` values of top-level fields, and only if there are two or more. With no steps it falls back to `SchemaRenderer::render`. Output:

```html
<div class="cf-progress" role="progressbar" aria-label="Form progress" aria-valuenow="1" aria-valuemin="1" aria-valuemax="{N}"><div class="cf-progress__bar" style="width: {round(100/N)}%;"></div><span class="cf-progress__text">1 / {N}</span></div>
<div class="cf-steps" role="group" aria-label="Form steps">
<button type="button" class="cf-step is-active" data-step="0" aria-current="step"><span class="cf-step-number" aria-hidden="true">1</span>{label}</button>
<button type="button" class="cf-step " data-step="1" disabled>…</button>
</div>
<div class="cf-step-panel[ cf-conversational]" data-step="{i}"[ style="display:none;" for i>0] role="group" aria-label="{label}">
  …top-level fields whose (group ?: 'default') === step.id, containers recursive…
  <div class="cf-step-nav">[<button type="button" class="cf-step-prev" data-step="{i-1}">Previous</button>][<button type="button" class="cf-step-next" data-step="{i+1}">Next</button>][<button type="submit" class="cf-step-submit">Submit</button> on the last step only when the schema has no submit field]</div>
</div>
<input type="hidden" name="_cf_current_step" value="0" />
```

Then `normalize_ids`. Step label is `step.label ?? step.title`, else `Step {n}`. The smart-forms spec owns the front-end behaviour.

### 2.7 MarkupParser: HTML to schema (`schema/class-markup-parser.php:22-220`)

Used for legacy forms (validation, allowlists, labels, length limits), `schema/generate`, multistep template variants and migrations. Rules:

1. Load into DOM. For every `[data-cf-original-id]`, restore `id = data-cf-original-id` and rewrite `for/list/aria-describedby/aria-labelledby/href=#` to match (the inverse of §2.4.4).
2. Pre-count `checkbox`/`radio` names (normalized, with `[]` stripped) per `type|name`.
3. Walk the DOM:
   - `data-cf-field-type="html"` → `html` field (innerHTML; name from `data-cf-field-name` or a fresh `_html[_N]`).
   - `input|select|textarea|button` → `element_to_field` (below). Choice controls (`radio`, `rating`, a checkbox whose name ends `[]`, a repeated checkbox name, or one inside `fieldset[data-cf-choice-group]`) collapse into **one** grouped field. The group gets its name without `[]`; its label comes from the enclosing fieldset `<legend>`, else `ucfirst(humanized name)`. It is required if any option is `required` or the wrapper has `data-cf-required-group="true"`, and takes its conditions from the enclosing fieldset. Each option is `{value (default 'on'), label (option's label text or value), id?, disabled?, attributes?, css_class?}`. `checked` sets `default_value` (radio: last wins) and `default_values`.
   - Skip `[data-cf-description]`, `legend`, and a `label` without controls.
   - **Field wrapper:** a `p|div|span` with exactly one descendant control, not marked `container|fieldset`, and either `data-cf-field` or a direct control child (or a control inside a direct `label`). Recurse into it, then attach the wrapper's conditions and wrapper-safe attributes to that field's `wrapper_attributes`.
   - **Container:** not a choice-only fieldset, and one of: `fieldset`, `data-cf-field-type="container"`, or a `div` with controls plus `class` or `style`. It becomes `container|fieldset` with name `data-cf-field-name ?: fresh _container/_fieldset`, `css_class`, conditions, legend → label, and `--cf-cols/-t/-m/--cf-gap` parsed from `style` into attributes. Children get `attributes.parent`.
   - `h1..h6` → `heading` (level). `hr` → `divider`. A `p` without controls → `paragraph` (innerHTML in `default_value`). Any other control-less element except `form|div` → `html` field (outerHTML, `label = tag`). Otherwise recurse.
4. `element_to_field` (`:323-420`):
   - Skip the names `_wpnonce, _cf_form_id, action, _wp_http_referer` and `_cf_h*`. Skip unnamed non-buttons.
   - Type: `select|textarea` from the tag; `button` → `submit` unless `type=button|reset`; unknown input types → `text`; a `data-cf-field-type` of `name|address|consent|rating` or a registered custom type overrides.
   - `name = name || '_'+type`. `attributes.id` is kept only when `id ∉ {name, 'cf-field-'+name}`.
   - Label: `label[for=id]` text (minus `aria-hidden` children), else `aria-label`, else the wrapping label's text, else `ucfirst(name with _-[] → space)`.
   - `placeholder` (or `data-cf-placeholder`), `required`, `class` → `css_class`, conditions.
   - Buttons: label = text (`<button>`) or `value` (default `Submit`); `default_value = value`.
   - Defaults: textarea `default_value` = text. Non-choice `default_value` = `value`. Checkbox/consent `default_value = value || 'on'` plus `checked`.
   - Select options: value attr or text; trimmed label; disabled; optgroup `group`; `selected`. A **leading** empty-value option whose label equals the placeholder is dropped. `multiple` → `default_values` and name without `[]`. `file multiple` → name without `[]`.
   - `validation` from the `min, max, minlength, maxlength, pattern, step` attributes.
   - `aria-describedby` pointing at `[data-cf-description]` becomes `description`, and `aria-describedby` is removed.
5. Conditions are parsed from `data-cf-conditions` (JSON) or `data-show-if`/`data-hide-if` (`:422-436`).

`repair_legacy_schema` (`:233-314`) fixes two pre-4.6.3 signatures: same-name choice fields stored without options (replaced by the parsed group), and select options whose explicit `''` value was replaced by their label.

### 2.8 Schema vs `post_content`

- **Rendering:** a stored schema wins over `post_content`; post_content is kept as the fallback and for the raw-HTML editor (`class-form.php:260-286`). `update_editor_state` saves both together.
- **Allowlist:** names from the schema's input fields **union** names regex-scanned from `post_content` (`functions.php:4028-4073`).
- **Validation and calculation:** `FieldValidator::schema($form)` = the stored schema, else `MarkupParser::parse(post_content)` (`schema/class-field-validator.php:12-15`).
- **Length limits:** parse of the **rendered** `get_markup()` (`functions.php:4122-4145`).
- **Labels for `[all:label]`:** DOM of raw `post_content` only (`functions.php:905-983`). Schema-only forms with an empty `post_content` fall back to humanized names.
- **Headless field list:** schema, else parse.

### 2.9 Server validation (`FieldValidator`, `schema/class-field-validator.php`)

- `is_empty`: `''|null|false`, or an array whose elements are all `''|null|false`.
- `is_active(field)`: walk the field and its ancestors. Inactive if any is `disabled`, if a `show` rule fails, or if a `hide` rule matches. Loops are treated as inactive.
- `matches_rule(rule, data)`: split on the first `:` or `=`. Left side is the field name (normalized: cut at `[`; `_`-prefixed names are rejected). Right side is `v1|v2|…`, default `*`. True when any submitted scalar value is in the set, or when `*` is in the set and the value is non-empty.
- `validate(schema, data)`, per input field that is active, non-empty, and not `file`/`submit`, in order. The first error wins:
  1. custom type validator → its code (`true` or `''` means OK, a non-string means `invalid_field_value`);
  2. `email` → `valid_email` (multiple if the `multiple` attribute or a `name[]`: array or comma-split; uses WP `is_email`) → `invalid_email`;
  3. `select|radio|checkbox|consent`: an array when not multiple → `invalid_field_value`. Every value must be in the non-disabled option values. Checkbox/consent without options allow only `default_value ?: '1'`. A non-scalar anywhere else → `invalid_field_value`;
  4. arrays skip the remaining checks;
  5. `url`: scheme `http|https|ftp`, a host, and `FILTER_VALIDATE_URL` after IDN→ASCII;
  6. `color`: `^#[0-9a-f]{6}$`;
  7. `number|range|rating|date|time|datetime-local|month|week`: parse; `min`/`max` (range defaults 0..100, rating 1..5); `step` (default 1; 60 for time and datetime-local; `any` skips). The step base is `min ?? default_value ?? (week: -3 days, month: 1970*12, else 0)`, with units of a day (date) or a week (week). Tolerance is 1e-7;
  8. `minlength` (`mb_strlen`);
  9. `pattern` for `text, search, tel, email, url, password, name`: `~\A(?:pattern)\z~u`. A regex compile error means pass.

### 2.10 Conditional logic, server side

Conditions affect the server in three ways:
1. **FieldCalculator** (`smart-forms/class-field-calculator.php:75-117`), which runs for every form, schema or parsed. It **drops the submitted value of every inactive field** and recomputes every field with `attributes.calculation|data-calculation`, discarding the posted value. A circular or unknown reference throws, and the response is HTTP 422.
2. Required and email checks skip inactive fields.
3. `validate` skips inactive fields.

### 2.11 Custom native field types

`cf_register_field_type($type, $def)` → `CustomFields::register` (`schema/class-custom-fields.php:9-16`). The type must match `/^[a-z][a-z0-9_-]{2,60}$/D`, must not be a built-in, and must be unique. `render` and `validate` callables are required. `native_type ∈ {text,email,url,tel,number,date,textarea,select}` (default text). Optional `label, description, defaults, script` (a script handle enqueued on render). `catalog()` feeds the builder. In EmDash this becomes a TS registration API on the plugin (render and validate functions); sanitize the output with the same allowlist.

### 2.12 Reusable field groups (4.11)

Stored in option `cf_field_groups` (§1.5). REST in §5. Rules:
- private by default; visible to the owner, or to all when `shared`, or to `manage_options` users;
- `can_remove` for the owner or an admin;
- label is 1..100 chars;
- at most 100 groups;
- fields JSON ≤ 60000 bytes, a list of 1..100 field definitions, normalized through `FormSchema::from_array`;
- optimistic concurrency: `version = sha256(json(all))`, and a write fails with 409 unless the stored value is unchanged.

Insertion-time renaming and reference rewriting happen client-side (builder spec).

---

## 3. Rendering pipeline

### 3.1 Entry points

| Entry | Resolution | Wrapper / extras |
|---|---|---|
| Shortcode `[cf_form slug="" id=""]` (`class-forms.php:559-594`) | **slug wins if non-empty** (the docs claim id wins, which is wrong). Filter `cf_shortcode_form_identifier($idOrSlug, $atts)`. Not found → `''`. | `$form->get_html()` only |
| Block `core-forms/form` (`block.json`, `render.php`) | `slug` first, else `id` | `<div {get_block_wrapper_attributes}>[<h{titleLevel} class="cf-form-title">{title}</h…>]{form html}</div>` (§3.1.1) |
| PHP `cf_get_form(x)->get_html()` | | |
| Bricks element / Elementor widget (`src/builders/*`) | `formId` | `theme` on/off overrides `load_form_theme`. **N/A for EmDash.** Bricks dynamic tag `{cf_submission:field}`: N/A. |
| Preview `?cf_preview_form=ID&_wpnonce=…[&cf_rehearsal=1][&cf_revision=R]` | §3.17 | full document |
| Standalone `/{base}/{slug}/`, legacy `?cf-form={slug}` | §3.14 | full document |
| Headless `GET /wp-json/core-forms/v1/forms/{id|slug}` | §5.3 | JSON `html` |
| `GET cf/v1/forms/{id}/preview` | draft | JSON `html` |

#### 3.1.1 Block attributes (`block.json`) and render rules (`render.php`)

| Attr | Type | Default | Behaviour |
|---|---|---|---|
| `slug` | string | `''` | lookup by slug (wins) |
| `id` | number | `0` | lookup by id. The legacy attribute `formId` is read in asset detection (`class-forms.php:349-351`). |
| `showTitle` | bool | false | prepend `<h{L} class="cf-form-title">{esc title}</h{L}>` |
| `titleLevel` | number | 2 | clamped 1..6 |
| `loadTheme` | `''\|'1'\|'0'` | `''` | `'1'` enqueues the theme **before** render; `'0'` dequeues it **after** render |
| `loadStylesheet` | `''\|'1'\|'0'` | `''` | same for `forms.css` |
| `alignment` | `''\|left\|center\|right` | `''` | style `margin-inline:auto` (center), `margin-inline-start:auto;margin-inline-end:0` (right), `margin-inline-start:0;margin-inline-end:auto` (left) |
| `maxWidth` | string | `''` | applied when it matches `/^\d+(\.\d+)?(px|em|rem|%|ch|vw|vh)$/` → `max-width:…;` |
| `anchorId` | string | `''` | wrapper `id` (`sanitize_html_class`) |
| supports | `align: [wide, full]`, `className`, `spacing.margin/padding`, `html:false` | | via `get_block_wrapper_attributes` (`wp-block-core-forms-form`, `alignwide/alignfull`, custom class, spacing styles) |

The editor JS registers two variations, "Contact Form" (`slug: contact`) and "Newsletter Form" (`slug: newsletter`), plus shortcode↔block transforms (`docs/getting-started/embedding.md`). Category `core-forms`; keywords `cf, form, contact, email, survey, newsletter`.

### 3.2 Form resolution: `cf_get_form($idOrSlug, $context='auto')` (`functions.php:53-138`)

- `draft_context` is true when `context='draft'`, or when `auto` and `(is_admin() && !wp_doing_ajax())` or a valid preview request. **Quirk:** `admin-post.php` counts as `is_admin()`, so **native (no-JS) submissions validate against the draft definition** when draft publishing is on, while AJAX and headless use the live one. The docs intend the published definition everywhere public. The port should use the live definition for all public submits.
- A numeric id or `WP_Post` → `get_post`, any status. The type must be `core-form`, else `Exception('Invalid form ID')`.
- A non-numeric slug → `post_name = slug AND post_status = publish`. In public context a live definition with a different slug rejects the match, and the published live definitions are then searched for that slug (`:76-86`).
- `cf_get_form_by_slug($slug)` (`:307-314`): for numeric slugs, scan published forms comparing `post_name` (so `"001"` is not treated as an id).
- The form is built as `{ID, title, slug, markup, settings: defaults⊕stored, messages: defaults⊕cf_message_*}`. In public context `FormDefinition::live()` overlays `_cf_live_definition` when it has `markup` (`class-form-definition.php:149-162`).

### 3.3 `Form::get_html()`: exact output (`class-form.php:45-155`)

```
$prefix = wp_unique_id("cf-form-{ID}-") . "-"           // e.g. "cf-form-12-1-" (per-request counter)
$fields = get_markup($prefix)                           // §3.4
<form method="post" {action="{admin-post.php}" only when ajax_submit is off; filter cf_form_element_action_attr($default, $form), null → no attr}
      class="cf-form cf-form-{ID} {filter cf_form_element_class_attr(form_class sanitized)}"
      {data attributes §3.6} {novalidate if ajax}{ enctype="multipart/form-data" if $fields contains <input … type="file">}
      aria-label="{esc title}">
  [<input type="hidden" id="_wpnonce" name="_wpnonce" value="…" /><input type="hidden" name="_wp_http_referer" value="…" />  // when global enable_nonce
  <input type="hidden" name="action" value="cf_form_submit" />
  <input type="hidden" name="_cf_form_id" value="{ID}" />
  [<input type="hidden" name="_cf_source_url" value="{current URL minus cf_response}" />   // only when ajax_submit is off
  <div style="display: none;" aria-hidden="true"><input type="text" name="_cf_h{ID}" value="" tabindex="-1" autocomplete="off" /></div>
  <div class="cf-messages" role="status" aria-live="polite" aria-atomic="true"></div>
  [<p class="cf-message cf-message-{success|error}" role="alert">{wp_kses_post(text)}</p>]   // native PRG flash, §3.7
  <div class="cf-fields-wrap"[ style="display:none" when the flash has hide_form and is not an error]>
    {$fields}
    [<noscript><p role="alert">Please enable JavaScript for this form to work.</p></noscript>]   // when ajax
  </div>
</form>
[<style>.cf-form-{ID} { {custom_css re-sanitized: strip tags, /expression\s*\(|javascript\s*:|@import|behavior\s*:/i → "/* blocked */", remove "<"} }</style>]
[<script>(function(){var form=document.querySelector(".cf-form-{ID}");if(form){ {custom_js raw} }})()</script>]
→ AssetRequirements::enqueue_for_form($this) → filter cf_form_html($html, $form)
```

Notes:
- The honeypot is rendered regardless of `enable_honeypot`.
- The legacy (non-schema) path does **not** prefix ids. Only the schema and multistep renders use `$prefix`, so `id="cf-contact-name"` stays as written.
- `get_field_count()` counts `name=` in the html, plus one. Legacy and unused.

### 3.4 `Form::get_markup($prefix)` and filter chain (`class-form.php:260-310`)

1. Schema present → `MultiStep::render` or `SchemaRenderer::render`, then filter `cf_schema_markup($html, $schema, $form)`. Otherwise use `post_content`.
2. Filter `cf_form_markup($markup, $form)`. Registered listeners, by priority:
   - 10: reCAPTCHA widget (when global keys are set) and Turnstile widget (when keys are set and the form has `enable_turnstile`) (CAPTCHA spec);
   - 20: math captcha (`enable_math_captcha`); payments product picker (`payments/class-payments.php:48`);
   - **100: `cf_enhance_accessibility`** (§3.5).
3. Email maxlength pass (WP_HTML_Tag_Processor): every `<input type="email">` whose `maxlength` is missing, `< 1` or `> 254` gets `maxlength="254"` (it **lowers** larger values too).

### 3.5 Accessibility enhancement (`cf_enhance_accessibility`, `functions.php:3242-3381`)

DOMDocument round-trip. Re-serialization normalizes the markup, so self-closing slashes and quoting change. Steps in order:
1. **Ids.** Every `input` (not hidden or submit), `textarea` and `select` without an id gets `id = name` with `[^a-z0-9_-]` → `_`. Collisions get the suffix `_{n}` from one counter shared across the form.
2. **Labels.** A `label` without `for`: if it wraps a control that has an id, `for = that id`. Otherwise use the first non-hidden `input`, `textarea` or `select` **in the label's parent** that has an id.
3. **Autocomplete.** For an `input` without `autocomplete` that is not hidden, submit, checkbox or radio, and for a `textarea` or `select` without `autocomplete`: `type=email|tel|url` sets the same token. Otherwise do a **substring** match on the lowercased name, first hit wins, in the order `email→email, name→name, first_name→given-name, last_name→family-name, phone→tel, tel→tel, address→street-address, city→address-level2, state→address-level1, zip→postal-code, postal→postal-code, country→country-name, url→url, website→url`. Because `name` is checked before `first_name`, **`first_name` gets `name`**: a faithful-port quirk.
4. **Legends.** A `fieldset` without a `legend` gets `<legend class="screen-reader-text">Field Group</legend>` prepended.
5. **Type coercion.** An `input[type=text]` whose name contains `email` becomes `type=email inputmode=email`; one containing `phone` or `tel` becomes `tel` (so `hotel` is coerced too); one containing `url` or `website` becomes `url`.

### 3.6 Form data attributes (`class-form.php:157-194`, `class-asset-requirements.php:178-189`)

The order is `id, title, slug, ajax-submit ('0'|'1'), smart-multistep, save-resume, partial-entries, calculations, counters` (each `'0'|'1'`), then `message-{key}` for every message, then the filter `cf_form_element_data_attributes($attrs, $form)`. Keys without a `data-` prefix get one, and values are `esc_attr`'d. Known filter additions:
- payments: `data-cf-payment-provider`, `data-cf-payment-flow` when payment is enabled;
- fullscreen, when `display_mode=fullscreen` and supported: `data-display-mode="fullscreen"`, `data-fullscreen-theme`, `data-fullscreen-animation`, `data-fullscreen-show-progress`, and the class ` cf-form-fullscreen` via `cf_form_element_class_attr`.

### 3.7 Native (no-JS) Post/Redirect/Get round trip

Submit → `respond()` (`class-forms.php:645-676`):
- a non-error with `redirect_url` → `wp_redirect(esc_url_raw(url))`, a 302 to **any host**;
- otherwise store `cf_native_{32hex}` = `{form_id, response}` for 300 s and `wp_safe_redirect(add_query_arg('cf_response', token, _cf_source_url validated against the site host, else home_url('/')), 303)`.

Render → `cf_take_native_form_response($formId)` (`functions.php:594-617`) reads `$_GET['cf_response']` (sanitize_key, `/^[a-zA-Z0-9]{20,64}$/`), checks the transient's form_id matches, deletes it, memoizes per request, and shows the message (§3.3).

### 3.8 HTML-level replacements (filter `cf_form_html`)

- priority 5, schedule closed → the whole output becomes `<div class="cf-form cf-form-{ID} cf-form-closed" role="status"><p>{kses(schedule_closed_message ?: 'This form is currently closed.')}</p></div>` (`smart-forms/class-form-scheduler.php:145-160`);
- 10, submission limit reached (not in preview) → `<div class="cf-message cf-message-warning cf-message-submission-limit">{messages.submission_limit_reached}</div>`;
- 10, `require_user_logged_in` and anonymous (not in preview) → `<div class="cf-message cf-message-warning cf-message-require-user-logged-in">{messages.require_user_logged_in}</div>`;
- 10: reCAPTCHA and Turnstile enqueue their scripts.

### 3.9 Data attributes on fields

These are emitted by the schema renderer and must be preserved, because the front-end relies on them: `data-cf-field, data-cf-field-type, data-cf-field-name, data-cf-step-group, data-cf-original-id, data-cf-choice-group, data-cf-required-group, data-cf-description, data-cf-placeholder, data-cf-conditions, data-show-if, data-hide-if, data-calculation, data-counter, data-resize`.

### 3.10 Template tags `{{tag.param || default}}`

**What the code does (4.11.1):** `cf_template()` is applied **only to submitted values**, during processing (`class-forms.php:844-861`). It is not applied to the rendered markup. URL prefill on the front end is done by `forms.js prefillFromUrl()`: every query param whose control name matches is filled, skipping `_*`, `action` and `cf_response` (`assets/js/forms.js:218-243`). `docs/developers/data-variables.md` says render-time. **That is inaccurate.**

- Regex: `/\{\{ *(\w+)(?:\.([.\w]+))? *(?:\|\| *(\w+))? *\}\}/`. The fallback is a single `\w+` word. Unknown tags are left unchanged. An empty value uses the fallback. A tag maps to a scalar or a callable(param) (filter `cf_template_tags`).
- `user.X`: allowlist `ID, user_login, user_email, user_nicename, user_url, display_name, first_name, last_name, nickname, description, roles` (filter `cf_template_user_fields`). Arrays are joined with `, `. Anonymous → `''` (`class-tag-replacers.php:19-81`).
- `post.X`: allowlist `ID, post_title, post_name, post_type, post_status, post_date, post_modified, post_author, post_excerpt, title, slug, url` (filter `cf_template_post_fields`). `url` is the permalink. Since this runs during the AJAX submit, `get_post()` is normally null, so the result is `''`.
- `url_params.X`: `sanitize_text_field($_GET[X])` of the **submit request**, usually empty.

Port recommendation (open question Q2): keep v0.1.0's render-time expansion of `url_params`/`post`/`user`, because it is the documented behaviour, **and** add WP's submit-time expansion of submitted values with the same regex and allowlists. Stored data then matches WP for hidden `{{user.ID}}`-style fields.

### 3.11 Data variables `[key]` (`cf_replace_data_variables`, `functions.php:701-848`)

The regex is `/\[(.+?)\]/`. An optional `$escape_function` is applied to field values only (callers: `esc_html` for HTML bodies, `strip_tags` for subjects, `cf_esc_email_header` for headers, `null` for plain text and redirect URLs, **with no URL-encoding**).

| Token | Value |
|---|---|
| `CF_TIMESTAMP` | `submitted_at` (`Y-m-d H:i:s` UTC) |
| `CF_USER_AGENT`, `CF_IP_ADDRESS`, `CF_REFERRER_URL`, `CF_POST_URL` | submission fields (`POST_URL` = referer) |
| `CF_REFERRER_HOST` / `CF_REFERRER_PATH` | parsed from the referer |
| `CF_POST_ID` / `CF_POST_TITLE` | `url_to_postid(referer)` |
| `CF_SUBMISSION_ID` | id or `''` |
| `CF_USER_ID/LOGIN/EMAIL/DISPLAY_NAME` | **current** user at replacement time |
| `CF_DATE` / `CF_TIME` | `mysql2date(get_option('date_format'|'time_format'), submitted_at)`, which shows the UTC value in the site format with no tz conversion |
| `CF_SITE_NAME`, `CF_SITE_URL` (`home_url()`), `CF_ADMIN_EMAIL`, `CF_FORM_ID`, `CF_FORM_TITLE` | |
| `CF_PAYMENT_STATUS/PROVIDER/ID/CURRENCY` | columns |
| `CF_PAYMENT_AMOUNT` | major units, 2 decimals (0 for the zero-decimal currencies `JPY KRW VND CLP PYG XAF XOF BIF DJF GNF KMF MGA RWF UGX VUV XPF`) |
| `CF_PAYMENT_AMOUNT_FORMATTED` | `{CUR} {amount}` |
| `all` / `all:label` | `cf_format_all_fields`: every data key with a non-empty formatted value. Label: `cf_get_field_labels` (label[for], wrapping label minus nested control text, placeholder fallback; trailing `*` stripped), else `ucwords(name with _- → space)`. HTML mode (escape === `esc_html`) gives `<strong>{label}:</strong> {value}` joined by `<br />`; otherwise `{label}: {value}` joined by `\n`. |
| anything else | `key` with spaces → `_`, then `cf_array_get(data, key)` (dot notation supported), formatted by `cf_field_value` |

`cf_field_value(value, limit=0, escape)` (`:1025-1095`):
- `''` → `''`;
- a file list → each formatted, joined `<br />`;
- a file → `<a href="{admin edit URL unless private or the cf_file_upload_use_direct_links filter}">{name≤20}[...]</a> ({human size})`, or `File not found` if the attachment is gone;
- a 10-char date string matching `\d{2,4}[-/]\d{2}[-/]\d{2,4}` → `gmdate(date_format)`;
- an array → `join(', ')`;
- truncate to `limit` plus `...`, then escape;
- **`nl2br` when limit = 0, even for plain-text emails.** That last one is a quirk to replicate or consciously drop.

### 3.12 Capability-driven assets (`AssetRequirements`, `class-asset-requirements.php`)

`for_form($form)` (filter `cf_form_asset_requirements`):

| Flag | Rule |
|---|---|
| `core`, `accessibility` | always |
| `analytics` | `Tracker::is_enabled_for_form` (per-form tri-state, else global `enable_analytics`) |
| `multi_step` | schema with `layout.type ∈ {multi-step, conversational}`; legacy: markup contains `cf-step-panel` |
| `save_resume` | `enable_save_resume` |
| `partial_entries` | `enable_partial_entries` |
| `calculations` | a schema field with `attributes.calculation` or `data-calculation`; legacy: markup contains `data-calculation` |
| `counters` | a schema field with `data-counter` set and `!== false`; legacy: contains `data-counter` |
| `resize` | `data-resize` |
| `scheduled` | `schedule_enabled` |
| `smart_script` | has a schema **or** any of multi_step, save_resume, partial, calculations, counters |
| `smart_style` | the smart features above, or resize, or scheduled |
| `fullscreen` | `display_mode === 'fullscreen'` |
| `inline_payment` | `payment_enabled` and provider `stripe` and `payment_flow === 'inline'` |

Handles: `core-forms` (forms.js; localized `cf_js_vars.ajax_url`, filter `cf_frontend_ajax_url`), `core-forms-a11y`, `core-forms-analytics`, `core-forms-smart` (js and css), `core-forms-multi-step` css, `core-forms-fullscreen` (js and css), `core-forms-inline-payments` (needs `stripe-js`), `core-forms` css (`forms.css` skeleton, when `should_load_stylesheet`), `core-forms-theme` (`form-theme.css`, when `should_load_theme`) and `core-forms-theme-custom` (the generated tokens file), `core-forms-standalone` css. `should_load_*`: a per-form `'1'`/`'0'` wins, anything else inherits the global setting (`:164-171`). Minified `.min` siblings are served unless SCRIPT_DEBUG (`class-assets.php`).

Page-level detection (`class-forms.php:213-552`) scans queried posts, reusable blocks (≤20), block widgets, and block-theme template parts (cached in a transient) for the block or shortcode. It enqueues per detected form at `wp_enqueue_scripts` priority 99 and dequeues everything at 100 if none is found. Filters: `cf_current_page_contains_core_form`, `cf_asset_detection_sources`. **In Astro this is unnecessary:** the component knows its form and emits the manifest-selected assets.

`diagnostics()` (`:196-228`) gives human-readable strings for the editor.

### 3.13 Theme tokens (`FormTheme`, `class-form-theme.php`)

The allowed tokens are `--cf-text, --cf-text-light, --cf-bg, --cf-border, --cf-border-light, --cf-focus, --cf-error, --cf-success, --cf-radius, --cf-spacing, --cf-wrapper-padding, --cf-input-padding, --cf-font`. Derived tokens: `--cf-text-soft:var(--cf-text)`, `--cf-text-muted:var(--cf-text-light)`; from `--cf-focus`: `--cf-brand`, `--cf-brand-hover` (both `var(--cf-focus)`), `--cf-brand-soft` (rgba α .08), `--cf-brand-border` (α .18), `--cf-focus-shadow:0 0 0 4px rgba(α .18)`, `--cf-shadow-button:0 4px 12px rgba(α .25)`. The rgba conversion only applies to 3- or 6-digit hex.

Output:

```css
/* Generated by Core Forms. Edit the Form Theme Customizer, not this file. */
.cf-form {
	--cf-…: …;
}
```

The CSS is written to `uploads/core-forms/form-theme-custom.css`, versioned by `sha256(css)[0..16]`. If uploads are unwritable it falls back to inline CSS. The customizer UI belongs to the admin spec. The default wrapper padding is 10px.

### 3.14 Standalone form URLs (`class-standalone-routes.php`)

- Rewrite `^{base}/([^/]+)/?$` → `cf_standalone=1&cf_form_slug=$1`. The base is `sanitize_title(cf_settings.standalone_base_slug)` (default `collect`). It is refused (with an admin notice) if it is `wp-admin|wp-json|wp-content|wp-includes|feed`, a page path, or a public post-type rewrite slug (`:80-97`). The rewrite is flushed when the base changes. Canonical redirects are disabled for these requests.
- `handle_request` at `template_redirect` priority 0, **GET/HEAD only**. A pretty slug or a legacy `?cf-form=` is resolved by finding the first form whose `public_slug` (`sanitize_title(standalone_slug) ?: sanitize_title(slug)`) equals the request, else by `cf_get_form_by_slug`. The result is 404 unless `standalone_enabled`. The exception is a legacy URL to a fullscreen form.
- Response: status 200; headers `Content-Type: text/html; charset`, `Cache-Control: private, no-store, max-age=0, must-revalidate`, `X-LiteSpeed-Cache-Control: no-cache`, `X-Robots-Tag: index, follow|noindex, nofollow`, `X-Content-Type-Options: nosniff`. Document:

```html
<!DOCTYPE html><html {lang}><head><meta charset><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index, follow|noindex, nofollow"><link rel="canonical" href="{home}/{base}/{public_slug}/">
<title>{standalone_page_title ?: fullscreen_page_title ?: title}</title>
[do_action cf_fullscreen_head] do_action cf_standalone_head; wp_head()</head>
<body class="cf-standalone[ cf-standalone--fullscreen] …" data-cf-standalone="true">
wp_body_open; cf_standalone_before_form; [cf_fullscreen_before_form]
<main class="cf-standalone__main">{get_html()}</main>
[cf_fullscreen_after_form]; cf_standalone_after_form; [cf_fullscreen_footer]; cf_standalone_footer; wp_footer()
</body></html>
```

- Assets: the form manifest plus the theme (**always**, ignoring the theme opt-outs), the custom theme, `standalone.css`. For fullscreen, add `https` URLs from `fullscreen_external_css/js` (split on newlines or commas; filter `cf_standalone_external_asset_urls`).
- 404 page: `<title>Form not found</title>` / `<h1>Form not found</h1><p>This form is unavailable or has not been published as a standalone page.</p>`, `noindex`.
- `url_for_form` = `home_url(user_trailingslashit(base/public_slug))`.

### 3.15 Form usage (`FormUsage::find`, `class-form-usage.php`)

A LIKE search over `post_content` for any of: `[cf_form id="{ID}"`, `[cf_form id='{ID}'`, `[cf_form slug="{slug}"`, `[cf_form slug='{slug}'`, `"formId":{ID}`, `"id":{ID}`, `"slug":"{slug}"`. It excludes trash, auto-draft and revisions, orders by `post_modified_gmt DESC`, and limits to `clamp(limit,1,100)` (default 20). It returns `{ID, post_title, post_type, post_status}`. The `"id":{ID}` needle over-matches; this is a known approximation.

### 3.16 Draft publishing, revisions, concurrency (`class-form-definition.php`)

- **Snapshot** = `{title, slug, status, markup, meta: {_cf_settings, _cf_form_schema, _cf_headless, _cf_hidden_columns, cf_message_*} (ksorted)}`.
- **Fingerprint** = `sha256(wp_json_encode([snapshot, _cf_live_definition]))`.
- **`atomic_mutation(id, expected, cb, require_version=true)`**: lock `definition:{id}` (MySQL `GET_LOCK(…,0)` or a CAS lease with 300 s expiry). A busy lock → 409 `cf_edit_busy`. A missing fingerprint → 409 `cf_version_required` ("Reload the form before saving."). A mismatch → 409 `cf_edit_conflict` ("This form changed in another editor. Reload before saving."). Then `revision_edit`: snapshot before, save a complete revision (deduplicated against the newest non-autosave revision's `_cf_revision_definition`), run the callback, and save another revision if anything changed.
- **Publishing** `POST cf/v1/forms/{id}/publishing {action, fingerprint}`:
  - `start` or `publish`: under lock `published-slugs`, refuse with 409 `cf_slug_conflict` if another form's `post_name` or live slug equals this slug; otherwise `_cf_live_definition = snapshot`.
  - `discard`: needs a live snapshot (else 400 `cf_no_published_definition`); restore it into the draft.
  - Anything else → 400 `cf_invalid_publish_action`.
  - Returns `{fingerprint}`.
- **Restore** `restore(id, def)`: update title, markup (sanitized), slug and status when present; delete `cf_message_*` keys absent from the def; set or delete each definition meta key; set the messages.
- **Revision restore** `POST cf/v1/forms/{id}/revisions/{rev}/restore {fingerprint}` → `{restored:true, fingerprint}`. `revision_definition` uses `_cf_revision_definition` if complete; otherwise the current snapshot overlaid with the revision's title, content and its own meta (old revisions lack metadata). A revision of another form → 404 `cf_revision_missing`.
- **Public reads use the live definition.** `published_meta($id,$key,$default)` reads meta from the live snapshot when present.
- WP revision plumbing (`functions.php:1329-1436`): revisions are never skipped for unchanged content, a change means the snapshot differs, there are no intermediate snapshots during managed edits, `cf_message_*` is copied onto revisions, and meta is restored on `wp_restore_post_revision`.

### 3.17 Preview and rehearsal

- **Preview URL** (`Forms::get_preview_url`, `class-forms.php:1340-1350`): `site_url()?cf_preview_form={ID}&_wpnonce={cf_admin_action nonce}&cf_rehearsal=1`. `is_preview()` requires TeamInbox access plus the nonce.
- **`listen_for_preview`** (`:1225-1245`) loads the draft form, or a revision via `cf_revision`, and renders `views/form-preview.php`. In rehearsal mode it clones the form with `enable_save_resume=0, enable_partial_entries=0, analytics_enabled='0', custom_js='', payment_flow='hosted'`, dequeues all theme assets, and enqueues `core-forms` and `core-forms-theme`. The document has `<meta name="robots" content="noindex,nofollow">`, `#form-preview` (max-width 720px), and a capture-phase submit interceptor that POSTs `{data: FormData minus _* and action, with name[] → arrays; revision_id}` to the rehearsal route and prints the JSON.
- **Rehearsal** `POST cf/v1/forms/{id}/rehearsal {data, revision_id?}` (`workflows/class-rehearsal.php:30-60`):
  1. intersect with the allowlist;
  2. `cf_validate_submission_limits`;
  3. FieldCalculator (failure → `calculation_failed`);
  4. `Forms::validate_fields`. The `cf_validate_form` filters (schedule, CAPTCHA, Akismet, file) are **not** run;
  5. the action plan: per action `{index, type, outcome: would_run|would_skip, handler_available, destination}`. `destination` takes the keys `to, email, recipient, recipients, url, webhook_url, chat_id, list_id, database_id, board_id`, with data variables replaced and URL keys reduced to `scheme://host/…`;
  6. payment: `{provider, configured, amount_minor (gateway resolve_amount), currency}`. Failure → `payment_amount_invalid`.
  
  It returns `{availability: SubmissionPolicy::error, valid, error, data, actions, payment, notice: "Rehearsal only. Nothing was submitted, sent, subscribed, or charged. Spam services and provider responses require a separate live test."}`.

### 3.18 Templates registry (`templates.php`, `templates/industry.php`)

`cf_get_form_templates()` → filter `cf_form_templates`. Entry shape: `{id, label, description, icon (dashicon), field_count, category, markup: callable→HTML, schema?: array|callable, layout?: {type, steps?}, settings?: callable→array, messages?: callable→array, setup_note?}`.

- **Base (31):** `blank, contact, newsletter, feedback, support, rsvp, job_application, quote, donation, survey, booking, lead_capture` (business, marketing, events, nonprofit; HTML markup with `<p>` wrappers, uppercase field names like `NAME, EMAIL, SUBJECT, MESSAGE`, explicit `label for` and `aria-hidden` asterisks); payment: `paid_product, paid_product_paypal, paid_product_polar, donation_paypal, razorpay_inr, fluentcart_product, fluentcart_subscription` (the two FluentCart ones are hidden unless FluentCart is present), `event_ticket`; license: `license_free, license_stripe, license_paypal, license_polar, license_razorpay, license_renewal`; engagement: `product_review, page_comment`; plus `nps_survey, bug_report, waitlist`.
- **Multistep variants:** `{id}_multistep` for each template with `field_count ≥ 5` or `contact` that has a callable markup and no `layout`. The schema is parsed from the markup. Top-level `NAME, FIRST_NAME, LAST_NAME, EMAIL, PHONE` (else the first root field) go to step `cf_step_contact`, everything else to `cf_step_details`; if all would land in the first step, the last moves to the second. Submit fields are excluded from root classification but carry their group (`industry.php:196-232`).
- **Industry (16):** `industry_{real_estate, home_services, construction, agency, education, healthcare, legal, hospitality, catering, automotive, travel, fitness, beauty, logistics, nonprofit, software}`. Schema-first with 3 steps `contact` (NAME text required, EMAIL email required, PHONE tel), `request` (3 industry fields plus MESSAGE textarea `rows=4`), `confirm` (`CONTACT_CONSENT` consent required, `default_value 'yes'`; `SUBMIT`). Settings come from `_cf_industry_template_settings` (`industry.php:181-193`): support settings (email action with subject `"{label}: [NAME]"` and `Reply-To: [NAME] <[EMAIL]>`; autoresponder to `EMAIL`) plus `prevent_duplicates=1, rate_limit=10, standalone_enabled=0` etc. Messages: `{success: definition.success}`.
- `cf_get_template_settings($id)` (§1.3), `cf_get_template_messages($id)`, `cf_get_template_schema($id)`, `cf_apply_form_template_presets($formId, $id)` (merge into `_cf_settings`, write `cf_message_*` KSES'd).
- Default email action: `{type:'email', from: admin_email, to: admin_email, subject: 'New submission on {site name}', message:'[all:label]', headers:'', content_type:'text/html', conditions:[]}` (`templates.php:1618-1632`).
- Legacy "no template" skeleton (`admin/class-admin.php:1675-1687`): `<{W}><label>Your name</label><input type="text" name="NAME" placeholder="Your name" required /></{W}>`, the same for `EMAIL` (email), `SUBJECT`, `MESSAGE` (textarea), and `<input type="submit" value="Send" />`.
- The template markup is static data and can be ported verbatim as TS string constants or JSON (about 1,700 lines). Payment and license presets depend on the payments and licensing specs (`LicenseCommerce::seed_sample_catalog`).

---

## 4. Submission pipeline

### 4.1 Endpoints

| Endpoint | Mode |
|---|---|
| `admin-ajax.php` `action=cf_form_submit` (`wp_ajax_` and `wp_ajax_nopriv_`) | JSON via `wp_send_json(response, status)` |
| `admin-post.php` `action=cf_form_submit` | native PRG (§3.7) |
| `POST /wp-json/core-forms/v1/forms/{id|slug}/submit` | headless. It fills `$_POST` and calls `Forms::process()`, capturing the JSON (§5.3). |
| `Rest_Headless::handle_internal_submit($formId, $body)` | trusted automation adapters: sets `_cf_h{ID}=''`, `action`, nonce |

### 4.2 Ordered steps (`Forms::process`, `class-forms.php:678-1120`)

`respond()` always releases the capacity lock and adds `error:true` when `message.type === 'error'`.

| # | Step | Failure response (HTTP) | Hooks |
|---|---|---|---|
| 1 | If global `enable_nonce`: `check_ajax_referer('core_forms_submit','_wpnonce')` | error `Your session has expired.` (403) | |
| 2 | `cf_get_form((int)$_POST['_cf_form_id'])` (auto context; §3.2 quirk) | `{error:true}` `This form is no longer available.` (404) | |
| 3 | `SubmissionPolicy::lock`: only if `submission_limit` is set, `GET_LOCK('cf_capacity_'.md5(prefix:id), 5)` | `Please try again in a moment.` (503) | |
| 4 | `SubmissionPolicy::error` (`class-submission-policy.php:8-18`), in order: post status ≠ publish → `form_closed`; `require_user_logged_in` and anonymous → `require_user_logged_in`; schedule closed → `form_closed`; `limit && count ≥ limit` → `submission_limit_reached`. `count` = rows with `is_spam=0 AND status NOT IN ('draft','partial')` + `cf_unsaved_capacity_{id}`; a DB error counts as `PHP_INT_MAX`. | `get_message(code) ?: 'This form is currently unavailable.'` (403) | |
| 5 | Honeypot: find the **first** `$_POST` key starting with `_cf_h` (any suffix). A missing key gives reason `honeypot_missing`; a non-empty value gives `honeypot_filled`. | `record_blocked_attempt` (increments `_cf_blocked_counts[reason]`), then the literal success `Thank you! We will be in touch soon.` (200) | `cf_submission_blocked($form,$reason)`, `cf_form_response($form, new Submission{form_id}, $reason)` |
| 6 | Rate limit check: `cf_get_form_submission_rate_limit` (`rate_limit`, filter `cf_submit_rate_limit`) > 0, and transient `cf_rl_{md5(ip_formId)}` ≥ limit (**not incremented here**) | `{error:true}` `Too many submissions. Please try again in a moment.` (**200**) | |
| 7 | Data = `$_POST` ∪ normalized `$_FILES`. Drop keys starting `_` and names in `cf_ignored_field_names` (default `['action']`; CAPTCHA modules add `g-recaptcha-response, g-recaptcha-failed, cf-turnstile-response, cf-turnstile-failed, cf_math_captcha_answer, cf_math_captcha_hash`) | | filter `cf_ignored_field_names` |
| 8 | Allowlist: `cf_get_form_field_names` (§2.8) → filter `cf_allowed_field_names($names,$form,$data)` (payments add theirs). Enforced if non-empty **or** the form has a schema. Unknown keys are dropped silently. | | |
| 9 | `FieldCalculator::process($data, FieldValidator::schema($form))`: strip inactive answers, recompute calculations (§2.10) | `The form total could not be calculated. Please check your answers.` (422) | |
| 10 | `cf_validate_submission_limits` (raw): objects, resources, non-list or nested arrays → `field_too_long`; per-field limits (§4.3); JSON size → `submission_too_large` | `{error:true}` + message (200) | |
| 11 | Normalize each non-file value: `trim(stripslashes(…))` (arrays element-wise, cast to string), then `cf_template()` (§3.10). Repeat the step 10 checks. | same | |
| 12 | Duplicate check if `prevent_duplicates`: fingerprint transient exists (window `cf_duplicate_window_seconds`, default 3600; ≤0 disables) | `{error:true}` `duplicate_submission` message (200) | filter `cf_duplicate_window_seconds` |
| 13 | Build `Submission` {form_id, data, user_agent, ip_address = REMOTE_ADDR, referer_url = HTTP_REFERER, submitted_at = gmdate} | | |
| 14 | `validate_form` = `validate_fields` (limits; required: settings list ∪ schema required, skipping inactive ones → `required_field_missing`; email: settings list ∪ schema email inputs, skipping inactive and empty ones → `invalid_email`; `FieldValidator::validate`), then if `''` the filter `cf_validate_form('', $form, $data)` | (deferred) | `cf_validate_form` listeners: 5 schedule → `form_closed`; 10 reCAPTCHA → `recaptcha_failed`/`recaptcha_low_score`; 10 Turnstile → `turnstile_failed`; 10 file-upload validate → `file_*`; 15 math → `math_captcha_failed`; 20 Akismet → `spam` (skipped for `edit_posts` users and whitelist hits). Every listener passes a non-empty incoming code through. |
| 15 | `do_action('cf_process_form', $form, $submission, $data, $error_code)`. A `File_Upload\UploadFailure` sets `error_code = 'file_upload_error'`. | | file-upload stores files here |
| 16 | `is_spam = (error_code === 'spam')`. If a rate bucket exists and the outcome is storable (`''` or `'spam'`), increment the counter and **reset the TTL to 1 h** | | |
| 17 | If `save_submissions` and storable: `wp_json_encode(data)`. Failure → `cf_submission_insert_failed($sub,$form,'json_encode_failed')` and error `messages.error`. INSERT `{form_id, data, ip_address, user_agent, referer_url, is_spam, status:'new', submitted_at}`. Failure → `cf_submission_insert_failed($sub,$form,$wpdb->last_error)` and error. On success: `id`, `is_spam`; `cf_submission_inserted($sub,$form)`; `cf_submission_written(id,'submit',$sub,$form)` → `cf_submission_after_write`. If `prevent_duplicates`, remember the fingerprint (**only after a successful insert**, so the setting is inert when submissions aren't saved). | error (200) | `cf_submission_inserted` listeners: submissions cache bust; `PrivacyControls::attach_ownership` (20) |
| 18 | Payment branch when `error_code === ''` and `payment_enabled` (payments spec): requires a saved row, a configured gateway, currency routing; Stripe inline → `{message, payment:{provider:'stripe', flow:'inline', mode, …intent}}`; hosted → `{message:'Redirecting to secure checkout…', redirect_url: checkoutUrl, payment:{provider, mode}}`. Marks `pending_payment` and retires the draft token. Actions do **not** run here; they run on webhook confirmation. | various error messages (200) | `cf_form_response($form,$sub, ''|'payment_unsaved'|'payment_misconfigured'|'payment_currency_gateway_mismatch'|'payment_failed')` |
| 19 | Success (`error_code === ''`): if `!save_submissions` and `!SubmissionPolicy::record_unsaved` (atomic `cf_unsaved_capacity_{id}`++ when a limit exists) → error `Your submission could not be accepted. Please try again.` (503). Retire the `_cf_draft_token`. `cf_form_success($sub,$form)`. For each `settings.actions[i]`: if `cf_evaluate_action_conditions(conditions, data)` then `ActionRunner::dispatch($action, $sub, $form, $i)` (actions spec; skipped actions are not logged on the live path, only on replay) | | `cf_form_success` listeners: notifications (10), analytics (100) |
| 20 | `cf_form_response($form, $sub, $error_code)` and `get_response_for_error_code` (§4.4) | | |

### 4.3 Field length and size limits (`functions.php:4106-4237`)

- **Email fields** (settings list ∪ schema email inputs ∪ parsed email types) are capped at 254 chars.
- **Any field** with a positive declared `maxlength` (parsed from the rendered markup) gets that cap. Email takes `min(254, declared)`.
- Filter `cf_form_field_length_limits($limits,$form)`: limits ≤ 0 are removed, and email is clamped again afterwards.
- Lengths are counted with `mb_strlen(UTF-8)` (characters). Array items are checked individually. → `field_too_long`.
- **Aggregate:** `strlen(wp_json_encode(data)) ≤ clamp(filter cf_max_submission_bytes(61440,$form,$data), 1024, 61440)`, else `submission_too_large`. Pending file uploads are excluded from all checks.

### 4.4 Response format (JSON body for AJAX and headless)

```jsonc
// success, or spam (identical, to fool bots)
{ "message": { "type": "success", "text": "<messages.success>" }, "hide_form": <bool hide_after_success>, "redirect_url"?: "<string>" }
// error
{ "message": { "type": "error", "text": "<messages[code] or literal>" }, "error": true }
// honeypot
{ "message": { "type": "success", "text": "Thank you! We will be in touch soon." } }
// payment: see 4.2 step 18 (adds "payment" and possibly "redirect_url")
```

`redirect_url` (`class-forms.php:1262-1268`) = `cf_replace_data_variables(settings.redirect_url, $submission)` (no escaping, no URL-encoding) → filter `cf_form_redirect_url($url, $form, $data, $submission)`, which always runs (WhatsApp redirect and IntegrationManager hook it at 20). It is included when non-empty. HTTP status is 200 for all validation and business errors (the exceptions are listed in 4.2). Headless maps any error to **422** (`rest/class-rest-headless.php:563-569`).

### 4.5 Action conditions (`cf_evaluate_action_conditions`, `functions.php:2939-2986`)

A list of `{field, operator, value}` combined with AND. Entries missing `field` or `operator` are skipped. Array actual values are joined with `', '`. Operators: `equals` (strict string), `not_equals`, `contains`/`not_contains` (case-insensitive substring), `empty`, `not_empty`. An empty list means true. This shape is stored in `settings.actions[i].conditions`.

### 4.6 Replay and status helpers

- `cf_replay_submission_actions($sub, $formId)` (`functions.php:2787-2822`), used when un-spamming: fires `cf_form_success`, then each action with a type, honouring conditions; skips are logged via `cf_log_action_skipped` → `cf_action_skipped($form, $action, $sub, 'conditions_not_met')`.
- `cf_update_submission_status($id, $status ∈ new|read|replied|archived)` updates the row, syncs the unseen badge and fires `cf_submission_written($id,'status')`.

### 4.7 Spam semantics

- `spam` (Akismet, or any `cf_validate_form` returning `spam`): the row is **stored** with `is_spam=1`, the visitor sees the normal success (including the redirect), actions **do not run**, the rate counter increments, and `cf_form_response(..., 'spam')` fires.
- Every other validator error: no row is stored and the counter is not incremented.

### 4.8 Quirks to decide on (preserve or fix; list for review)

| # | Quirk | Where | Recommendation |
|---|---|---|---|
| Q-a | The honeypot matches the **first** `_cf_h*` key. A headless body without `_cf_h{ID}` hits the injected `_cf_headless=1` first and gets a silent fake success. | `class-forms.php:717-746`, `rest/class-rest-headless.php:218` | Match `_cf_h{formId}` exactly (the port already does) |
| Q-b | Native submits use the draft definition | §3.2 | Use the live definition |
| Q-c | `enable_honeypot` is ignored | §1.3 | Always enforce, as WP does |
| Q-d | Autocomplete gives `first_name→name` and `hotel→tel` | §3.5 | Decide (the port fixed this deliberately) |
| Q-e | `nl2br` in plain-text values | §3.11 | Decide |
| Q-f | Industry template `min/step/maxlength` in `attributes` are ignored | §2.3 | Preserve, so imported schemas behave identically |
| Q-g | The schedule closed message is replaced at render, but the submit message is `form_closed` | §3.8 | Preserve |
| Q-h | `prevent_duplicates` is inert without `save_submissions` | §4.2 step 17 | Preserve |
| Q-i | `turnstile_failed` has no default | §1.4 | Default it to `Verification failed. Please try again.` |

---

## 5. REST API

Auth: "edit" means `current_user_can('edit_forms')`. "scope(id)" means `TeamInbox::can_access(id)`: the user has `edit_forms`, and either `manage_options`, or no saved scope, or id ∈ their `{prefix}cf_form_scope` user meta (`admin/class-team-inbox.php:64-77`). Native `wp/v2/core-form` writes return **405** `cf_versioned_api_required`. Out-of-scope native reads return 403 `cf_scope_forbidden` (`admin/class-team-inbox.php:21-27`).

### 5.1 `cf` and `cf/v1` (authoring)

| Method & route | Auth | Body / params | Response |
|---|---|---|---|
| `GET cf/forms` (legacy, `class-forms.php:596-633`) | edit | | `[{ID, title, slug}]` (scoped) |
| `GET cf/v1/forms/options` | edit | | `[{id, title, slug}]`, all statuses, ordered by title (`class-rest-forms.php:164-189`) |
| `GET cf/v1/forms` | edit | | `[FormDTO]` of **draft** definitions |
| `POST cf/v1/forms` | edit | `{title='Untitled Form', slug=title, markup='', schema?, settings?}`. Markup is sanitized unless `unfiltered_html`. `settings.actions` is validated via `ActionSettings::restore` and `FieldMapping::validate_names` against the schema or parsed input names. custom_css is sanitized; custom_js is dropped without `unfiltered_html`. | 201 FormDTO. Creates `publish`. **No fingerprint needed.** |
| `GET cf/v1/forms/{id}` | scope | | FormDTO (draft) |
| `PATCH cf/v1/forms/{id}` | scope | `{fingerprint, title?, slug?, markup?, settings?}` (settings are **shallow-merged** over current; actions prepared via `ActionSettings::prepare`). **`messages` is not handled despite the docs.** | FormDTO + `fingerprint`; 409s per §3.16 |
| `DELETE cf/v1/forms/{id}` | scope | (the docs ask for a fingerprint; the code does not check it) | 204. Force-deletes the post and the schema meta. **Submissions are kept.** |
| `GET cf/v1/forms/{id}/preview` | scope | | `{id, title, html}` (draft `get_html`) |
| `GET cf/v1/forms/{id}/schema` | scope | | `{exists:true, schema}` or `{exists:false, schema:null, hint:"No schema stored. POST to /schema/generate to create one from existing markup."}` |
| `PUT cf/v1/forms/{id}/schema` | scope | full schema plus `fingerprint` | `{exists:true, schema, fingerprint}`; 400 `invalid_schema` if the body is empty |
| `PUT cf/v1/forms/{id}/editor-state` | scope | `{fingerprint, markup, schema, template_id?}`. Markup is sanitized and `<form>` stripped, both are saved, and template presets are applied if `template_id`. Re-runs the a11y audit. | `{saved:true, form: FormDTO, schema, fingerprint}`; 400 `invalid_editor_state` |
| `POST cf/v1/forms/{id}/schema/generate` | scope | `{fingerprint, save?:bool}` | `{saved, schema, fingerprint}` (MarkupParser of post_content) |
| `GET cf/v1/forms/{id}/fields` | scope | | `Field[]`; 404 `no_schema` |
| `POST cf/v1/forms/{id}/fields` | scope | `Field` + `fingerprint` | 201 Field; 400 `missing_name`; 409 `duplicate_name` |
| `PATCH cf/v1/forms/{id}/fields/{field_name}` (`[a-zA-Z0-9_-]+`) | scope | any of `type,label,placeholder,default_value,css_class,description,group,required,options,validation,conditions,attributes,position` + `fingerprint` | Field; 404 `no_schema`/`field_not_found` |
| `DELETE cf/v1/forms/{id}/fields/{field_name}` | scope | `fingerprint` | 204 |
| `POST cf/v1/forms/{id}/publishing` | scope | `{action: start|publish|discard, fingerprint}` | `{fingerprint}` |
| `POST cf/v1/forms/{id}/revisions/{revision}/restore` | scope | `{fingerprint}` | `{restored:true, fingerprint}` |
| `POST cf/v1/forms/{id}/rehearsal` | scope | `{data:{}, revision_id?}` | §3.17 |
| `GET cf/v1/forms/{id}/retention-preview` | scope | | `{entry_ids[], attachment_entry_ids[], limit:100}` |
| `GET cf/v1/field-groups` | edit | | `{groups:[{id,label,fields,owner,shared,can_remove}], version}` |
| `POST cf/v1/field-groups` | edit | `{version, label, fields[], shared?}` | list; 409 `cf_group_conflict`; 400 `cf_invalid_group` |
| `DELETE cf/v1/field-groups/{id:[a-f0-9]{16}}` | edit | | list; 403 `cf_group_forbidden`; 409 |
| `GET cf/v1/submissions` | edit | `per_page` (20, 1..100), `page`, `form_id`, `status ∈ new|read|replied|archived`, `is_spam`, `search` (LIKE on raw `data` JSON), `date_from`/`date_to` (`Y-m-d`, UTC day bounds), `orderby ∈ submitted_at|id`, `order ∈ asc|desc` | `{data: SubmissionDTO[], total, pages}` (scoped via `sql_scope`) |
| `GET cf/v1/forms/{form_id}/submissions` | scope(form) | same | same |
| `GET cf/v1/submissions/{id}` | edit + entry scope | | SubmissionDTO; 404 |
| `PATCH cf/v1/submissions/{id}` | entry scope | `{status?, is_spam?:bool}` | SubmissionDTO; 400 `invalid_status`. Fires `cf_submission_written(id,'rest_update')`. **Does not replay actions when un-spamming.** |
| `DELETE cf/v1/submissions/{id}` | entry scope | | 204, or 409 `cf_entry_busy` (pending work, see the retention spec) |

`FormDTO` = `{id, fingerprint, title, slug, markup, settings (effective), messages (effective), has_schema}` (`class-rest-forms.php:696-707`). `SubmissionDTO` = `{id, form_id, data, status, is_spam, ip_address, user_agent, referer_url, submitted_at}` (`class-rest-submissions.php:185-197`). Payment and draft columns are not exposed.

Other `cf/v1` routes (analytics, workflows, action-logs, action editor, polls, licensing) belong to other specs.

### 5.2 Fingerprint protocol

All existing-form mutations listed above (except DELETE form and field-groups) run inside `atomic_mutation`. **The fingerprint is required.** The request reads the param `fingerprint` (JSON body or query). The response carries the new fingerprint.

### 5.3 `core-forms/v1` (headless, public)

| Route | Auth | Behaviour |
|---|---|---|
| `GET /forms/{id|slug}` (`[a-zA-Z0-9_-]+`) | public. `headless_enabled` required (403 `cf_headless_disabled`; 404 `cf_unknown_form`). Live definition. | `{id, slug, title, html: get_html(), fields:[{name (no []), type, required, label (or name), options}] (input fields, non-_), messages, submit_url, requires_captcha (global reCAPTCHA or Turnstile site key set)}` |
| `POST /forms/{id|slug}/submit` | `X-Core-Forms-Key` header must equal `cf_settings.headless.api_key` (`hash_equals`). Header only since 4.2.0. Errors: 404, 403, 503 `cf_missing_api_key`, 401 `cf_invalid_api_key`. | JSON or form params. `name[]` keys are merged into `name` arrays. It injects `_cf_form_id`, `_cf_headless=1` and a server nonce. `_cf_page_url` becomes `HTTP_REFERER`. It runs `Forms::process()` with `wp_die` intercepted. Response: the processor JSON, status 200 or 422; 500 `cf_processor_no_response` if nothing was captured. |
| `GET /embed.js` | public | Vanilla JS. `Content-Type: application/javascript`, `Cache-Control: public, max-age=300`. It mounts `[data-cf-form="{slug}"][data-cf-key]` by fetching the form, injecting html, and intercepting submit. Payload is FormData → object (repeated names → arrays) plus `_cf_page_url`; it POSTs JSON with the key header. Events `cf:mounted`, `cf:submit`, `cf:success`, `cf:error`. Success replaces the host with `<div class="cf-form-success">{text}</div>` or redirects. Errors fill `.cf-form-error`. Exposes `window.CoreFormsEmbed = {mount, init}` (`rest/class-rest-headless.php:295-415`). |
| CORS | on every `core-forms/v1/*` response | Allowlist from `headless.allowed_origins` (newline-separated, normalized to `scheme://host[:port]`). An empty allowlist reflects the Origin (or `*`). A non-match sends only `Vary: Origin`. A match sends `Access-Control-Allow-Origin`, `Vary: Origin`, `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type, X-Core-Forms-Key`. No credentials. |

---

## 6. Hooks worth keeping as EmDash extension points

WP hooks map to a typed in-plugin event and filter registry (e.g. `coreForms.on("formSuccess", fn)` and `coreForms.filter("validateForm", fn)`), plus EmDash plugin hooks where they exist. Trivial hooks are omitted.

| WP hook | Kind & args | Purpose | Keep as |
|---|---|---|---|
| `cf_validate_form` | filter `(code, form, data)` → code | custom validation and spam engines (CAPTCHA, Akismet, file, schedule). Priority order matters. | `validators[]` with `priority`, pass-through semantics |
| `cf_process_form` | action `(form, submission, data, error_code)` | pre-save processing (file uploads) | `beforeSave` |
| `cf_submission_inserted` | action `(submission, form)` | post-insert, before actions | `submissionInserted` |
| `cf_submission_after_write` | action `(id, context, submission?, form?)` | every write path; contexts `submit, admin_edit, draft, delete, status, spam, payment, gdpr, rest, rest_update, cli, import, data_management, team, erase, attachment_retention, license_commerce` | **Keep.** Use one storage wrapper that emits it. |
| `cf_submission_insert_failed` | action `(submission, form, error)` | lost-lead alarm | keep |
| `cf_submission_blocked` | action `(form, reason)` | honeypot telemetry | keep |
| `cf_form_success` | action `(submission, form)` | primary success hook (also fired by payment confirmation and replay) | keep |
| `cf_form_response` | action `(form, submission, error_code)` | every outcome, including spam, blocked and payment codes (analytics) | keep |
| `cf_process_form_action_{type}` | action `(settings, submission, form)` | action handlers | actions spec registry |
| `cf_action_skipped` | action `(form, action, submission, reason)` | | keep |
| `cf_form_redirect_url` | filter `(url, form, data, submission)` | WhatsApp and integrations inject redirects | keep |
| `cf_allowed_field_names` | filter `(names, form, data)` | payments and extensions add accepted keys | keep |
| `cf_ignored_field_names` | filter `(names)` | CAPTCHA token fields | keep (or hard-code the token names) |
| `cf_form_markup` / `cf_schema_markup` / `cf_form_html` | filters | widget injection, a11y, closed or limit replacement | keep as an ordered render pipeline |
| `cf_form_element_data_attributes` / `_class_attr` / `_action_attr` | filters `(value, form)` | payments and fullscreen markers | keep |
| `cf_form_default_settings` / `cf_form_default_messages` | filters | module defaults | static module registration |
| `cf_form_message_{code}` | filter `(message, form)` | | optional |
| `cf_form_asset_requirements` | filter `(manifest, form)` | | keep |
| `cf_template_tags`, `cf_template_user_fields`, `cf_template_post_fields` | filters | `{{}}` tags | keep |
| `cf_form_field_length_limits`, `cf_max_submission_bytes`, `cf_submit_rate_limit`, `cf_duplicate_window_seconds` | filters | policy knobs | plugin options or callbacks |
| `cf_shortcode_form_identifier` | filter | | optional |
| `cf_form_templates` | filter | template registry | registration API |
| `cf_standalone_head/before_form/after_form/footer`, `cf_fullscreen_*`, `cf_standalone_external_asset_urls` | actions and filter | standalone page slots | Astro slots or props |
| `cf_settings` | filter | global settings | n/a |
| `cf_payments_orchestrator` | filter | service locator | DI |
| `cf_migration_failed` | action | | n/a |

---

## 7. Gap analysis vs the existing port (v0.1.0)

### 7.1 Equivalent or near-equivalent

- The wrapper skeleton: `form.cf-form.cf-form-{id}`, `_cf_form_id`, honeypot `_cf_h{id}` in a hidden div, `.cf-messages` with role and aria, `.cf-fields-wrap`, `aria-label`, `novalidate` with AJAX, multipart detection, scoped custom CSS (same blocklist plus `<` stripping), custom JS IIFE (`src/core/render.ts:125-196`).
- The no-JS PRG round trip with a 300 s token keyed by form (`src/routes.ts:163-174`, `:176-189`).
- An allowlist of names declared in the markup, with `_` keys dropped (`src/core/validate.ts:17-43`).
- Required from the markup and `required_fields`; email from `type=email` and `email_fields` (`validate.ts:65-94`).
- The honeypot answers bots with a fake success (`process.ts:95-101`).
- A per-IP per-form hourly rate limit, a duplicate check, and a submission limit, all present in some form.
- `[var]` tokens: most `CF_*` metadata, `[all]`/`[all:label]`, unknown tokens → field or `''` (`template.ts:66-117`).
- WP export import preserving ids, `_cf_settings` and `cf_message_*` (`normalize.ts`, `wordpress/export-core-forms.php`).
- `[cf_form id|slug]` shortcode expansion in HTML and a Portable Text form block (`src/astro/load.ts`).

### 7.2 Present but different (fix for fidelity)

| Area | v0.1.0 | WP 4.11.1 | Impact |
|---|---|---|---|
| Settings model | `normalizeSettings` keeps ~20 keys, drops the rest (`normalize.ts:8-82`) | ~70 keys (§1.3) | **Import is lossy**, and re-export is impossible. Store the raw WP settings object and add typed accessors. |
| Booleans and tri-states | `toBool('')` = undefined, so `load_form_theme` defaults to **false** | `load_form_theme` and `load_stylesheet` are tri-state with global inherit (default theme on) | Imported forms lose the theme |
| CAPTCHA model | per-form `captcha` enum (not a WP key) | reCAPTCHA is global for all forms when keys are set; Turnstile per form via `enable_turnstile`; math via `enable_math_captcha`; Akismet global; failures give `recaptcha_failed`/`recaptcha_low_score`/`turnstile_failed`/`math_captcha_failed` | Imported forms lose CAPTCHA. The port answers `spam`/400 instead. |
| Schedule | collapses date+time into one ISO instant in **UTC** | separate dates (open 00:00, close 23:59:59 local), `schedule_days`, a daily time window (overnight allowed), `schedule_timezone` or the site tz, `schedule_closed_message` replaces the whole HTML | Wrong open/close behaviour |
| Messages | 11 keys; invented `rate_limited` and `too_long`; `form_closed` text differs | 21 keys (§1.4); rate limit is a literal; `field_too_long`/`submission_too_large` | Wrong copy; missing overrides |
| Pipeline order | availability → honeypot → limit → rate (increment on check) → validate → captcha → dup → save | §4.2 (rate checked early but incremented only for storable outcomes with a sliding TTL; dup before validation; spam stored) | Different counts and outcomes |
| Duplicate | fake success, 10 min, IP-hash scope | error `duplicate_submission`, 1 h (filter), user-id-or-IP scope, remembered only after insert | Visible behaviour change |
| HTTP status | 422/429/400/403 | mostly 200 (headless maps errors to 422) | Clients relying on 200 |
| Spam | CAPTCHA failure is rejected; spam never stored | `spam` stored with `is_spam=1` and a success reply; no actions | Inbox parity |
| Data shapes | a single checkbox becomes `string[]`; repeated names become arrays; CRLF normalized | single checkbox is a string; repeated scalar names keep the last; `stripslashes`+trim | Action, CSV and import data differ |
| Size limits | 20 KB per field, 200 KB total, 200 fields | per-field `maxlength`, email 254, total 60 KiB JSON | Stored rows can exceed WP limits |
| Statuses | `new, read, spam, trash` | `new, read, replied, archived, draft, partial, pending_payment, paid, payment_failed, refunded` + `is_spam` flag; hard delete | Model mismatch |
| Submission record | uuid `id`, ISO `submittedAt`, `ip`, `country` | int id, `Y-m-d H:i:s` UTC, `is_spam`, draft and payment columns, `modified_at` | Import and export mismatch |
| Redirect | no `[var]` replacement; same-origin only for native | `[var]` replaced (unencoded) + filter; any host | Feature loss (the EmDash same-origin constraint is noted) |
| `{{}}` tags | render-time only; fallback `[^}]*` | submit-time on submitted values; fallback `\w+` (§3.10) | Decide (Q2) |
| a11y pass | ids + label `for` + smarter autocomplete | + legend insertion + text→email/tel/url coercion + DOM normalization (§3.5) | Markup differs |
| Id prefixing | prefixes **all** forms (`cf{n}-`) | only schema forms (`cf-form-{ID}-{n}-`); legacy ids untouched | Custom CSS/JS targeting `#id` breaks |
| Auto submit button | appended when missing | never added | Extra button |
| Data attributes | `data-ajax`, `data-hide-after-success`, `data-success-scroll`, `data-loading-text`, `data-captcha`, fixed message set | `data-ajax-submit`, smart flags, all message keys, filter additions | Existing custom JS reading `dataset.ajaxSubmit` breaks |
| Email maxlength | adds only when missing | also lowers values > 254 | Minor |
| Draft forms | `render` returns null for `status=draft` | renders by id (submit refused with `form_closed`) | Minor |
| Closed form | form rendered with fields hidden + `form_closed` | whole HTML replaced by the `cf-form-closed` div | Markup differs |
| Honeypot flag | honours `enable_honeypot=false` | always enforced | Q-c |
| CSV | `'` prefix for `=+-@\t\r` | `\t` prefix, also for fullwidth `＝＋－＠` and leading whitespace/control chars (`functions.php:10-15`) | Minor (admin spec) |

### 7.3 Missing entirely

1. **The schema system**: FormSchema/Field model, SchemaRenderer (all types, composites, choice groups, containers with grid vars, descriptions, conditions, `normalize_ids`), MarkupParser (HTML→schema, repair), FieldValidator (option allowlists, url/color/measure/step/pattern/minlength, `invalid_field_value`), server-side conditional logic, custom field types, field groups.
2. **Multi-step and conversational render** and the step metadata.
3. **FieldCalculator** server recompute and inactive-answer stripping (smart-forms spec, but invoked from the engine pipeline).
4. **The validator extension chain** (`cf_validate_form` priorities), math captcha, Akismet, `require_user_logged_in`, file uploads (files are dropped today), the payment branch.
5. **Draft publishing** (`liveDefinition`), complete revisions, the fingerprint/409 concurrency protocol, revision preview and restore.
6. **Preview and rehearsal** (an admin preview page; the rehearsal planner).
7. **Standalone URLs** (`/{base}/{slug}/`, legacy `?cf-form=`), page shell, robots and no-store headers, base-slug collision rules, fullscreen external assets.
8. **Headless REST** (`core-forms/v1`): form JSON, API-key submit, `embed.js`, CORS allowlist.
9. **The authoring REST surface** (`cf/v1` forms, schema, editor-state, fields, publishing, revisions, field-groups) with WP-shaped DTOs. The port has only `forms/*` admin RPC routes with different shapes.
10. **The templates registry** (63 templates: 31 base, 16 multistep variants, 16 industry) with settings and message presets and the default email action.
11. **The asset requirement manifest** (selective client modules, skeleton/theme tri-state, smart CSS, fullscreen, inline payments).
12. **Theme tokens** (`cf_form_theme_tokens` → generated CSS) and the global `load_stylesheet`/`load_form_theme`/`wrapper_tag`/`enable_nonce`/`standalone_base_slug`/`enable_analytics`/`delete_data_on_uninstall` settings.
13. **Block attributes** beyond `formId` (`slug`, `showTitle`, `titleLevel`, `loadTheme`, `loadStylesheet`, `alignment`, `maxWidth`, `anchorId`, align, className, spacing) and the block wrapper markup.
14. **Import**: `core-forms-data` v1 (forms with **all** meta incl. schema and live definition, submissions and replies, `cf_settings`, theme tokens, field groups), plus the 4.5.0 and 4.6.3 normalizations. The WP export script omits schema, live definition and submissions.
15. Per-form blocked counts (`_cf_blocked_counts`), hidden columns, the unseen list, the form-usage finder, the hook/event registry, `cf_submission_after_write` emission on every write.

---

## 8. Porting notes: mapping to EmDash primitives

### 8.1 Storage (plugin storage collections over D1)

```ts
// forms: keep WP keys verbatim so export/import round-trips.
interface FormDoc {
  id: string;                    // WP post ID as a string for imports. New forms: see Q1.
  slug: string;                  // unique index; plus a reserved-slug check against liveDefinition.slug
  title: string;
  status: "publish" | "draft" | "pending" | "private";
  markup: string;                // post_content
  settings: Record<string, unknown>;   // RAW _cf_settings; defaults merged at read time (§1.3)
  messages: Record<string, string>;    // cf_message_* overrides only
  schema: FormSchemaJson | null;       // _cf_form_schema
  liveDefinition: DefinitionSnapshot | null; // _cf_live_definition
  hiddenColumns: string[];             // _cf_hidden_columns
  blockedCounts: Record<string, number>; // _cf_blocked_counts
  authorId?: string; createdAt: string; updatedAt: string;
  version: number;                     // monotonically bumped. Use updateIf(version) for the fingerprint protocol.
}
// indexes: status, updatedAt; unique slug; liveSlug (denormalized) for public slug lookup

// form_revisions: { id, formId, definition: DefinitionSnapshot, createdAt, authorId, autosave:false }
//   indexes [formId, createdAt]; retain N (setting) to mirror WP revision limits

// submissions: WP columns in camelCase, plus legacyId for imports
interface SubmissionDoc {
  id: string; legacyId?: number; formId: string;
  data: Record<string, unknown>;      // §1.8 shapes, incl. file descriptors pointing at R2 keys
  ipAddress: string | null; userAgent: string | null; refererUrl: string | null;
  isSpam: boolean; status: string; draftToken: string | null; currentStep: number;
  paymentStatus: string | null; paymentProvider: string | null; paymentId: string | null;
  paymentAmount: number | null; paymentCurrency: string | null;
  submittedAt: string;  // store as "YYYY-MM-DD HH:MM:SS" UTC (or ISO; convert at the CF_TIMESTAMP boundary)
  modifiedAt: string | null;
}
// indexes mirror WP: [formId,isSpam,submittedAt], [formId,submittedAt], [submittedAt], [status,modifiedAt],
//                    [draftToken], [paymentProvider,paymentId]

// field_groups: { id(16 hex), label, fields, owner, shared } or a single KV doc with a version (CAS)
```

KV keys:
- `settings:*` (global; secrets as secret type);
- `theme:tokens`;
- `rl:{hash(ip|formId)}` (count, sliding 1 h TTL);
- `dup:{hash(formId|scope|data)}`;
- `resp:{token}` (300 s);
- `cap:unsaved:{formId}`;
- `lock:{resource}` (CAS lease, 300 s);
- `stats:blocked:{formId}:{reason}`.

The port's `incrementCounter` CAS pattern (`src/routes.ts:67-77`) generalizes to the capacity counter and the locks.

**Capacity race:** WP serializes with `GET_LOCK`. Without DB locks, use a KV CAS "admitted" counter per form: reserve a slot before insert and release it on failure. Alternatively use a D1 transaction if storage exposes one (flag F7).

### 8.2 Routes (`/_emdash/api/plugins/core-forms/…`)

| WP | EmDash |
|---|---|
| admin-ajax / admin-post `cf_form_submit` | public `submit` (form-data, `_cf_ajax=1` → JSON, else 303 PRG). Already exists. Keep JSON bodies WP-shaped and **use HTTP 200 for business errors** (Q3). |
| `cf/v1/*` authoring | admin routes, e.g. `forms/list|get|create|update|delete|preview|schema/get|schema/put|editor-state|schema/generate|fields/*|publishing|revisions/restore|rehearsal|retention-preview`, `field-groups/*`, `submissions/*`. JSON bodies carry `id` and `fingerprint` when path params are unavailable (F2). Return WP DTO shapes so external tooling ports. |
| `core-forms/v1` headless | public `headless/form` (GET, `?id=`), `headless/submit` (POST with `X-Core-Forms-Key`), `embed.js` (raw JS). Needs CORS and OPTIONS (F2/F3). |
| preview `?cf_preview_form` | an admin-authenticated page (F1) that renders the draft and posts to `rehearsal` |
| standalone `/{base}/{slug}/` | a front-end page route (F1) |

### 8.3 Rendering in Astro

- `renderForm(form, ctx)` should implement §3.3–§3.8 exactly. Pick schema → SchemaRenderer/MultiStep, else markup. Run the ordered pipeline `markupFilters` (CAPTCHA widgets 10, math 20, product picker 20, a11y 100), then the email maxlength pass, then the wrapper, then `htmlFilters` (closed 5, limit and login 10).
- No DOM exists on Workers. The a11y pass and MarkupParser need an HTML tokenizer/tree that runs on Workers (e.g. `parse5` or `htmlparser2`), not regexes. The parser in particular needs a real tree for wrapper, container and choice-group detection.
- `<CoreForm>` returns `{html, manifest}`. `FormAssets` loads client modules per the manifest (`core`, `a11y`, `analytics`, `smart`, `multi-step css`, `fullscreen`, `inline-payments`) and CSS per the skeleton/theme tri-state. Theme tokens are inlined as `<style>` or served from a hashed `theme.css` route.
- PT block `form` fields should add `formSlug, showTitle, titleLevel, loadTheme, loadStylesheet, alignment, maxWidth, anchorId, className`. The WP block import maps `{id|formId, slug, …}` across. Render the block wrapper `div.wp-block-core-forms-form` (keep the class so existing CSS still matches).

### 8.4 Admin (React)

The admin spec covers the editor, preview and rehearsal UI, the Revisions tab (diff of markup), the publishing controls, field groups, and the template gallery. The engine must provide the routes in §8.2 and DTOs identical to `cf/v1`.

### 8.5 EmDash capabilities to confirm (flags for the platform spec)

| # | Need | Used by |
|---|---|---|
| F1 | A plugin can contribute **front-end page routes** (`/collect/[slug]/`, an admin preview page) or must ship an Astro page the site installs | standalone, preview |
| F2 | Plugin routes with **path params / GET query params**, **OPTIONS preflight**, and **custom response headers** (CORS, `X-Robots-Tag`, `Cache-Control`) | headless, standalone |
| F3 | A raw non-JSON response from a public route (JS/CSS with caching) | `embed.js`, `theme.css` (the port already uses `pluginResponse` raw) |
| F4 | **Current user identity** (and roles) inside public routes and during render | `require_user_logged_in`, `{{user.*}}`, `CF_USER_*`, Akismet skip for editors, duplicate scope |
| F5 | Searching site content (Portable Text blocks and HTML with shortcodes) for references | FormUsage |
| F6 | Site metadata: name, home URL, admin email, **date/time format, timezone** | `[CF_DATE]`, `[CF_TIME]`, schedule tz, `CF_ADMIN_EMAIL` |
| F7 | Atomicity: KV CAS (present) and/or D1 transactions from plugin storage | capacity limit, definition lock, duplicate/rate counters |
| F8 | `form-data` bodies exposing **file parts** (bytes, name, type, size) and R2 write access | file uploads (file-upload spec) |
| F9 | Mapping a referer URL to a content id/title | `CF_POST_ID`, `CF_POST_TITLE`, `{{post.*}}` |
| F10 | Per-user preference storage and a fine-grained admin permission (`edit_forms`, form scope) | team scope (inbox spec) |
| F11 | Plugin uninstall hook with an opt-in destructive cleanup | `delete_data_on_uninstall` |
| F12 | `after()` / waitUntil for post-response work (present) | actions after the response |

---

## 9. Open questions

1. **Ids for new forms.** Should they be UUIDs (v0.1.0) or a numeric sequence that continues past the max imported WP id? Numeric ids keep `.cf-form-{ID}`, `_cf_h{ID}` and `[cf_form id]` short and WP-shaped.
2. **`{{tag}}` semantics.** Render-time (docs, v0.1.0), submit-time (code), or both (recommended)?
3. **HTTP status parity.** Mirror WP's 200 for business errors on the AJAX endpoint, or keep 4xx? The front-end and headless contract depends on it.
4. **Quirks Q-a…Q-i** (§4.8). Which to preserve and which to fix? In particular: the native-submit draft quirk, `first_name→name` autocomplete, and `nl2br` in plain text.
5. **Redirects to other hosts.** WP allows them, including native `wp_redirect`. EmDash plugins can only redirect within the site. Should AJAX responses still return off-site `redirect_url` (the client navigates), with only native submits restricted?
6. **Nonce equivalent.** WP's `enable_nonce` (default on) has no direct EmDash analogue. Options: an Origin/Referer check, or an HMAC token tolerant of edge caching. Which?
7. **Settings storage.** Keep raw WP `_cf_settings` blobs (round-trippable) with typed getters, or a typed schema with a lossless `extra` bag? Recommended: raw plus getters.
8. **Import scope.** Is `core-forms-data` v1 (forms, submissions, replies, settings, theme) the required import path, with the simple WP-CLI JSON as a fallback? Should submissions keep their WP ids (as `legacyId`) for support references?
9. **Schema parity.** Should the port render legacy markup forms through MarkupParser→SchemaRenderer (normalized output), or keep WP's split (raw markup plus a11y pass for legacy, schema render for schema forms)? Fidelity argues for keeping the split.
