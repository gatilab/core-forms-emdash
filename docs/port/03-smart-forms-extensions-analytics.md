# 03 — Smart Forms, Extensions, Polls, Analytics, Spam and Privacy

Scope: server behavior and data for Core Forms 4.11.1 smart forms, bundled extensions, polls, analytics, spam protection and privacy, plus the client contract each feature needs. Browser JS internals are covered in another spec.

Conventions:
- WP paths are relative to `.reference/core-forms-wp/`. `file:N-M` means line numbers. A `~` marks an approximate number.
- Port paths are relative to `plugins/core-forms/` (EmDash port v0.1.0).
- "Code wins": wherever `docs/` disagrees with code, the code behavior is specified and the doc claim is listed under "Doc vs code".
- Storage names are WP names: tables `wp_cf_*`, post meta `_cf_*`, the option `cf_settings`, and transients `cf_*`.

---

## 0. Shared data touched by these features

### 0.1 `wp_cf_submissions` (src/functions.php:2299-2341)

| Column | Type / default | Used here by |
|---|---|---|
| `id` | INT UNSIGNED AI PK | all |
| `form_id` | INT UNSIGNED | all |
| `data` | TEXT JSON | drafts store partial JSON |
| `user_agent`, `ip_address`, `referer_url` | TEXT / VARCHAR(255) / TEXT, raw | drafts also fill these (class-draft-manager.php:131-133) |
| `is_spam` | TINYINT 0 | Akismet / custom `spam` verdicts |
| `status` | VARCHAR(30) `'new'` | `draft` (save & resume and partials). `partial` is defined (class-submission.php:36) but **never written** |
| `draft_token` | VARCHAR(64) NULL, indexed `idx_draft_token` | 64-hex bearer token |
| `current_step` | INT UNSIGNED 0 | multi-step index saved with drafts |
| `submitted_at` | TIMESTAMP (UTC string) | |
| `modified_at` | TIMESTAMP NULL | draft expiry clock; index `idx_status_modified (status, modified_at)` |
| `payment_*` | | out of scope |

Statuses (class-submission.php:34-43): `new, draft, partial, read, replied, archived, pending_payment, paid, payment_failed, refunded`. `is_draft()` is true for `draft` and `partial` (:92-94). Drafts are **listed in the inbox** with the label "Draft" (src/admin/class-submission-presentation.php:17). No list query excludes them.

### 0.2 Per-form settings touched here

Settings live in the post meta `_cf_settings` (serialized array), merged over `cf_get_form_default_settings()` (src/functions.php:141-189) and filter `cf_form_default_settings`. Messages are post meta `cf_message_{key}` (functions.php:117-125).

| Key | Default | Source |
|---|---|---|
| `enable_honeypot` | `1` (**inert**: honeypot is always rendered and enforced, see §4.1) | functions.php:153 |
| `prevent_duplicates` | `0` | :154 |
| `rate_limit` | `0` (per IP per hour) | :155 |
| `enable_save_resume` | `0` | :157 |
| `enable_partial_entries` | `0` | :158 |
| `draft_expiry_days` | `30` | :159 |
| `schedule_enabled` | `0` | :161 |
| `schedule_open_date` / `schedule_close_date` | `''` (`Y-m-d`) | :162-163 |
| `schedule_days` | `[]` (`mon`…`sun`) | :164 |
| `schedule_open_time` / `schedule_close_time` | `''` (`H:i`) | :165-166 |
| `schedule_timezone` | `''` (IANA; no UI field) | :167 |
| `schedule_closed_message` | `''` (HTML) | :168 |
| `analytics_enabled` | `''` (inherit) / `'1'` / `'0'` | :174 |
| `submission_limit` | `''` | extensions/submission-limit/src/class-admin.php:16-19 |
| `require_user_logged_in` | `'0'` | extensions/require-user-logged-in/src/class-admin.php:16-19 |
| `enable_notifications` | `1` | extensions/notifications/src/Notifier.php:12-15 |
| `display_mode` | `'normal'` / `'fullscreen'` | extensions/fullscreen-forms/fullscreen-forms.php:11-20 |
| `fullscreen_theme` | `'light'` (`dark`, `gradient-blue`, `gradient-purple`, `gradient-green`) | same |
| `fullscreen_show_progress` | `'1'` | same |
| `fullscreen_animation` | `'slide'` (`fade`, `scale`) | same |
| `fullscreen_page_title`, `fullscreen_external_css`, `fullscreen_external_js` | `''` | same |
| `enable_turnstile` | unset → off | src/admin/class-turnstile.php:62-64 |
| `enable_math_captcha` | unset → off | src/admin/class-math-captcha.php:47-49 |
| `submission_retention_days`, `attachment_retention_days` | unset → 0 (off), UI max 3650 | src/admin/class-privacy-controls.php:188, 207-208 |
| `protect_uploads` | unset → off | class-privacy-controls.php:209 |

Message defaults added by these features:
- `form_closed`: "This form is currently closed." (class-form-scheduler.php:30)
- `submission_limit_reached`: "The submission limit for this form has been reached."
- `require_user_logged_in`: "You must be logged in before you can use this form."
- `file_too_large`: "Uploaded file is too large."
- `file_upload_error`: "An upload error occurred. Please try again later."
- `file_invalid_extension`: "This file type is not allowed."
- `file_mime_mismatch`: "The uploaded file does not match its extension. Please upload a valid file." (extensions/file-upload/file-upload.php:6-12)
- `recaptcha_failed`, `recaptcha_low_score`, `spam`, `math_captcha_failed`, `duplicate_submission` (functions.php:191-208)
- `turnstile_failed` has **no default**. `Form::get_message()` (src/class-form.php:417-427) returns `''` unless the admin saved one. The admin field pre-fills "Verification failed. Please try again." (class-turnstile.php:303).

Other form post meta here: `_cf_form_schema` (schema JSON, needed by multi-step), `_cf_blocked_counts`, `_cf_unseen_submissions`, `_cf_hidden_columns`.

### 0.3 Global settings (option `cf_settings`, functions.php:430-560)

- `enable_analytics`: `1`
- `google_recaptcha.site_key` / `.secret_key`
- `cloudflare_turnstile.site_key` / `.secret_key`
- `akismet_whitelist`: newline list
- `enable_nonce`: `1` on fresh installs, `0` on pre-4.2 upgrades
- `delete_data_on_uninstall`: `0`

There are no hCaptcha keys.

### 0.4 Cron events (all WP-cron)

| Hook | Schedule | Registered | Job |
|---|---|---|---|
| `cf_cleanup_drafts` | daily, first run +1h | class-draft-manager.php:49-53 (on `init`) | §1.3.6 |
| `cf_cleanup_analytics` | daily | src/analytics/class-tracker.php:77-81 | §6.6 |
| `cf_poll_auto_close` | hourly | functions.php:1692-1694 (4.3.0 migration only) | §5.7 |
| `cf_retention_cleanup` | daily | class-privacy-controls.php:9 | §4.9.2 |

All of them are cleared on deactivation (functions.php:2181-2200) and uninstall (uninstall.php:116-128).

---

## 1. Smart Forms

### 1.1 Conditional logic

**What actually runs:** `src/smart-forms/class-condition-evaluator.php` (14 operators, groups, `match`) is **dead code**. Nothing references `ConditionEvaluator` (grep confirmed). The live implementations are:

**A. Field visibility.** Client: `assets/js/forms.js:79-166`. Server: `src/schema/class-field-validator.php:32-98`.

Rules come from attributes on any element: a wrapper, container, fieldset or the control itself.

- `data-show-if="RULE"` / `data-hide-if="RULE"`: one condition each (markup parser `src/schema/class-markup-parser.php:422-436`).
- `data-cf-conditions='[{"action":"show"|"hide","rule":"RULE"}, …]'`: a JSON array. When present it **replaces** the show-if/hide-if attributes on that element. The schema renderer emits it when there is more than one condition (`class-schema-renderer.php:290-294`).
- The `RULE` grammar is `name ( (":"|"=") value ("|" value)* )?`.
  - Split on the **first** `:` or `=`.
  - `name` is trimmed and normalized: anything from `[` on is stripped (`cf_normalize_field_name`, functions.php:4082).
  - With no separator, the expected value is `*`.
  - Expected values are split on `|` and are **not** trimmed.
- `matches_rule` (field-validator.php:83-98) matches when any submitted item (arrays are iterated, non-scalars are skipped, items are cast to string) is **exactly** in the expected list (case-sensitive), or when `*` is expected and the item is non-empty.
- `is_active(field)` (:32-57) walks the field, then its parent chain (`SchemaRenderer::parent_name`):
  - Any element with a `disabled` attribute makes the field inactive.
  - For each condition with action `show` or `hide`: `show` with no match makes it inactive, and `hide` with a match makes it inactive.
  - All conditions on all ancestors must pass, so the semantics are AND.
  - A cycle in the parent chain makes the field inactive.
- `conditional_dependencies` (:58-82) lists the field names referenced by the field's and its ancestors' rules. They are resolved before activity is decided.
- Server enforcement happens in `FieldCalculator::process()` (§1.2.3). It runs for **every** submission (class-forms.php:820), so every inactive field is `unset` from `$data` **before** validation, storage, actions and email. Then `validate_fields()` skips inactive definitions for the `required_fields` and `email_fields` settings (class-forms.php:1296-1316), and `FieldValidator::validate()` skips inactive fields (:113+).
- Field definitions come from the schema (`_cf_form_schema`) or from `MarkupParser::parse(markup)` for markup-only forms (field-validator.php:12-15). Markup forms are therefore enforced too, which needs a **DOM-aware parser with ancestor tracking**.
- Client behavior: all rules on the element must pass. The client also forces hidden when any ancestor is `[hidden]`. Hidden targets get `hidden` and `display:none`. Their controls get `required` removed (marked `data-was-required="true"`) and are `disabled` (marked `data-cf-conditional-disabled="true"`), so they are not posted. Up to `min(n+1, 20)` passes settle chained rules. The client posts `_was_required[]` names (forms.js:328-330); the server ignores them because `_` keys are dropped.

**B. Action conditions.** `cf_evaluate_action_conditions()` (src/functions.php:2939-2984), called from class-forms.php:1107 and rehearsal.

- Input is `settings.actions[i].conditions`: a list of `{field, operator, value}` combined with AND. Entries missing `field` or `operator` are skipped. An empty or non-array list passes.
- `actual = data[field] ?? ''`. Arrays are joined with `', '` (comma and space; visibility uses a different join).
- Operators:
  - `equals`: strict `===`, so `"5" !== 5` matters if the value is numeric in JSON
  - `not_equals`
  - `contains`, `not_contains`: case-insensitive substring
  - `empty` (`=== ''`), `not_empty`
  - Anything else fails.
- `data` here is post-processing (hidden fields already removed, calculations applied).

**Doc vs code** (docs/smart-forms/conditional-logic.md):
- The structured `{conditions:{action,match,rules:[{field,operator,value}]}}` format, the 14 operators, `match: all/any`, nested groups and the `ConditionEvaluator` API are not wired anywhere.
- Action conditions use the 6-operator list above, not the documented format.
- Port the code behavior. Optionally keep `ConditionEvaluator` semantics as an unused library function.

**ConditionEvaluator reference** (if kept):
- `evaluate(conds, data, match='all')`: an empty list is true. `{group:[…], match}` recurses.
- `evaluate_single`:
  - With `rule` and no `field`, it uses the legacy rule (`:` then `|` list, else `=`; `*` means non-empty; array values are joined with `,`).
  - Otherwise the operators are:
    - `=`/`equals`, `!=`/`not_equals`: string compare
    - `>`, `<`, `>=`, `<=` (also `greater_than`, `less_than`, `greater_equal`, `less_equal`): both sides must be `is_numeric`, else false
    - `contains`, `not_contains`, `starts_with`: `stripos`
    - `ends_with`: `strcasecmp` of the tail; an empty expected value is true
    - `is_empty`, `is_not_empty`
    - `in`, `not_in`: array, or a comma list, trimmed, strict
    - unknown: false

### 1.2 Calculated fields

#### 1.2.1 Declaration

- A field with the attribute `data-calculation` (or schema attribute `calculation`) holding the expression. The schema renderer emits `data-calculation` (class-schema-renderer.php:271-273).
- `AssetRequirements` sets the form flag `data-calculations="1"`:
  - schema forms: any field has `calculation`/`data-calculation`
  - markup forms: `strpos(markup,'data-calculation')` (src/class-asset-requirements.php:34-46, 177-188)

#### 1.2.2 Expression grammar (src/smart-forms/class-field-calculator.php:120-272)

Placeholders are substituted first (:39-47), via regex `\{([a-zA-Z0-9_-]+)\}`. The replacement is `is_numeric(v) ? (string)(float)v : '0'`, so:
- arrays, empty values, `"1,000"` and `"$5"` become `0`
- `"1e3"` becomes `"1000"`
- a negative becomes `"-5"`
- a very large or small float stringifies as `"1.0E+25"`, which then **fails to parse** and makes the whole calculation fail

The resolved string is then parsed:

```
expr    := add
add     := mul (('+'|'-') mul)*
mul     := unary (('*'|'/') unary)*        ; '/' by 0 (loose ==) throws
unary   := ws ( '-' primary | '+'? primary )   ; one sign only, '--5' throws
primary := ws ( '(' expr ws ')'
              | FUNC ws '(' args ')'         ; FUNC case-insensitive, no word boundary
              | NUMBER )                     ; NUMBER = \d+\.?\d* | \.\d+
FUNC    := round | ceil | floor | abs | min | max
args    : min/max → expr (',' expr)*  (≥1 arg)
          round   → expr (',' expr)?   ; precision must be integral and |p| ≤ 10, else throw
          ceil/floor/abs → expr
ws      := ctype_space*
```

- There is no `^`, `%`, comparison, variables or exponent notation.
- Trailing characters make the result `null` (:57-60).
- A non-finite result becomes `null` (:62).
- Any exception becomes `null` (:63-65).

Rounding follows PHP `round($v,$p)`: half away from zero, with PHP 8's precise pre-rounding. `ceil`, `floor` and `abs` are standard. The port needs a PHP-compatible `round`, not `Math.round`, which rounds half toward +∞ and has no precision.

#### 1.2.3 Server processing: `FieldCalculator::process($data, $schema)` (:75-118)

Called after the allowlist and before size limits and validation (class-forms.php:814-822). Also called by rehearsal.

1. Build `definitions[name]` for every schema field with a non-empty normalized name. For every field with an expression, **`unset($data[name])`**, so client-posted totals are discarded.
2. Depth-first `resolve(name)` over all definitions, with `visiting`/`finished` sets.
   - For each conditional dependency, resolve it first. Re-entering a node in `visiting` throws "circular calculation or visibility dependency".
   - If the field is inactive (§1.1), `unset($data[name])`.
   - Otherwise, if it has an expression:
     - Every `{dep}` must be a known definition, else it throws "unknown field".
     - Resolve each dependency.
     - `evaluate()` must be non-null, else it throws.
     - `$data[name] = float result`.
3. Return `$data`. Inactive non-calculated fields are removed too; this is the hidden-field enforcement.

On any `RuntimeException` the submission is rejected with HTTP 422 and `message.text` "The form total could not be calculated. Please check your answers." (class-forms.php:821-822). Rehearsal maps this to the error `calculation_failed`.

Stored values are PHP floats. For example, `json_encode(80.0)` gives `80.0`, and emails print `80`.

#### 1.2.4 Client contract (assets/js/smart-forms.js:507-600)

- Recalculates on `input`.
- Uses the same dependency, activity and cycle rules as the server.
- Writes `String(value)` raw. There is **no formatting**.
- Inactive calculated fields are blanked.
- On error, all calculated fields get `''` and `setCustomValidity('This total could not be calculated.')`.
- Dispatches a bubbling `cf-calculated` event.

**Doc vs code** (docs/smart-forms/calculations.md):
- "Division by zero returns 0", "malformed returns NaN/0" and "unknown references are 0" are false on the server; they reject the submission.
- `data-calculation-format`, `data-calculation-decimals` and the currency/percent formats are not implemented anywhere.

### 1.3 Save & resume, and partial entries (drafts)

#### 1.3.1 Settings

- `enable_save_resume`: enables autosave, the `?cf_resume=` URL resume and `cf_load_draft`.
- `enable_partial_entries`: enables autosave and an unload beacon. There is **no** resume or load: `cf_load_draft` requires `enable_save_resume` (class-draft-manager.php:398-400).
- Both features write the **same** rows with `status='draft'`. There is no `partial` status.
- `draft_expiry_days` (default 30; `0` = never expire). Filter `cf_draft_ttl_days($days, $form_id)` (:244-246).
- `DraftManager::is_enabled_for_form` = save_resume OR partial (:25-28).
- Form flags: `data-save-resume`, `data-partial-entries` (class-asset-requirements.php:183-185).

#### 1.3.2 `cf_save_draft`

`wp_ajax[_nopriv]_cf_save_draft`, POST admin-ajax (class-draft-manager.php:261-370). Checks run in order:

1. When global `enable_nonce` is on: `check_ajax_referer('core_forms_submit','_wpnonce')`, else 403 "Your session has expired."
2. `_cf_form_id` must be an int > 0, else 400 "Invalid form."
3. `cf_get_form(id)` resolves the published (live) form, else 404 "Form not found."
4. Not enabled for the form: 403 "Draft storage is disabled for this form."
5. `SubmissionPolicy::error(form)` is non-empty (unpublished, login required, closed by schedule, limit reached): 403 "This form is currently unavailable."
6. When `_cf_draft_token` is present, it must match `/^[a-f0-9]{64}$/D`, exist, be a draft, belong to the same `form_id` and not be expired. Otherwise 403 "This draft is no longer available."
7. Without a token, a rate limit applies:
   - transient `cf_draft_rl_` + `md5(REMOTE_ADDR . '_' . form_id)`
   - limit filter `cf_draft_save_rate_limit` (default **30**)
   - `count >= limit` gives 429 "Too many drafts. Try again in a moment."
   - Otherwise it sets `count+1` with a TTL of 60 s. The TTL resets on every write, so the window slides. Resuming saves (with a token) are exempt.
8. Data handling:
   - `$data = $_POST` minus keys that are non-string, empty or start with `_`.
   - The `action` key is not removed explicitly; only the allowlist removes it.
   - Allowlist: `cf_get_form_field_names(form)` plus filter `cf_allowed_field_names`. It is enforced when non-empty or when the form has a schema.
   - Files in `$_FILES` are ignored.
   - Calculations are **not** recomputed and hidden fields are **not** stripped in drafts.
9. `cf_validate_submission_limits(form,data)` must pass, else 413 "Draft data is invalid or too large."
10. Sanitize: scalars go through `sanitize_text_field(stripslashes(trim(v)))`, and arrays map `stripslashes` then `sanitize_text_field`. This **strips tags and newlines**, so textarea line breaks are lost in drafts.
11. Second token/form mismatch check: 403 "Token mismatch."
12. `DraftManager::save` (:91-146):
    - With a valid token, it updates `data`, `current_step`, `modified_at=now UTC`.
    - Otherwise it inserts `{form_id, data, status:'draft', draft_token: bin2hex(random_bytes(32)), current_step, ip_address: REMOTE_ADDR, user_agent, referer_url: HTTP_REFERER, submitted_at=modified_at=now}`.
    - It emits `cf_submission_written(id,'draft')`. A DB failure gives 500 "Failed to save draft."
13. 200 `{success:true, data:{draft_token, resume_url}}`. `resume_url` = `add_query_arg('cf_resume', token, home_url())`, which is the **home page**, not the form page. The client ignores it anyway.

#### 1.3.3 `cf_load_draft`

`wp_ajax[_nopriv]_cf_load_draft` (:375-412). There is no nonce and no rate limit.

- Token comes from `$_POST['_cf_draft_token']`, then `$_GET['cf_resume']`. Empty gives 400 "No token provided."
- Format must be `/^[a-f0-9]{64}$/`, else 400 "Invalid token format."
- Not found or not a draft: 404 "Draft not found or already submitted."
- Form missing: 404 "Form not found."
- `enable_save_resume` off: 403 "Save and resume is disabled for this form."
- Expired or `SubmissionPolicy::error`: 403 "This draft is no longer available."
- Success: 200 `{success:true, data:{form_id, data, current_step, draft_token}}`.
- The token is a pure bearer secret. Anyone holding it reads the draft's answers.

#### 1.3.4 Expiry

`expired(draft, form)` = `ttl>0 && strtotime((modified_at ?: submitted_at).' UTC') < now - ttl*86400` (:247-251).

#### 1.3.5 Finalization

On the normal submit, `_cf_draft_token` is a control field (dropped from data). A **new** submission row is created. After success, `DraftManager::retire(token, form_id)` **deletes** the draft row: `DELETE … WHERE draft_token=? AND form_id=? AND status IN ('draft','partial')`, and only when the token matches the 64-hex pattern (:252-256).

Retire call sites:
- class-forms.php:1100: success branch, `error_code===''` only; spam never retires
- class-forms.php:1057 and :1066: payment checkout start

`DraftManager::finalize()` (:178-209), `cleanup()` (:231-242) and `get_resume_url($token,$form_url)` with a URL are unused.

#### 1.3.6 Cron `cf_cleanup_drafts` (daily) — `run_cleanup()` (:58-71)

- `$days = apply_filters('cf_draft_ttl_days', 30)`. If `<=0`, the cron is disabled entirely.
- For each distinct `form_id` that has drafts:
  - `ttl = DraftManager::ttl(cf_get_form(id))`; if the lookup throws (form unpublished or deleted), `ttl = $days`.
  - Skip when `ttl<=0`.
  - `DELETE … WHERE form_id=? AND status IN('draft','partial') AND modified_at < now-ttl days LIMIT 1000`.
- WP-CLI `wp cf submission cleanup --days=90` also purges drafts (src/cli/class-submission-command.php:87-94).

#### 1.3.7 Draft rows elsewhere

- Excluded from `SubmissionPolicy::count` (submission limits) and from retention candidates.
- **Included** in GDPR export and erase (they match on `data`).

#### 1.3.8 Client contract (smart-forms.js:333-504)

- **Autosave:** on each `input`, the form is marked interacted and a 5 s debounce starts, then `saveDraft`.
- `saveDraft`:
  - Posts `FormData(form)` with `action=cf_save_draft`, `_cf_draft_token` (created as hidden input if absent), `_cf_current_step` and the form's `_wpnonce`.
  - Stores `data.draft_token` in the hidden input.
- **Step change:** saves immediately when the form has been interacted with.
- **Resume** (save_resume only): reads `?cf_resume=`, posts `cf_load_draft`, and ignores the result unless `String(data.form_id) === _cf_form_id`. It then:
  - fills `[name=x]`/`[name="x[]"]` (checkbox/radio by value inclusion)
  - sets the token
  - jumps with `form._cfGoToStep(step, true)`
- **Partial beacon** (partial only): on `beforeunload`, if interacted and a token already exists, it sends `navigator.sendBeacon(ajaxUrl, URLSearchParams)` with:
  - string fields only
  - `_cf_current_step`, `action`, `_cf_draft_token`, `_cf_form_id`, `_wpnonce`
  - The first draft is therefore created by autosave, never by the beacon.

**Doc vs code** (docs/smart-forms/save-resume.md):
- These are not implemented: "Save Progress" button, `auto_save` toggle, `message` in the response, the "Welcome back" notice, the displayed resume URL, the `cf_cleanup_expired_drafts` hook name, the `updated_at` column, `cf_track_partial_entries` filter, `status='partial'`, the `{fields, updated_at}` load response, rate limiting on load, and deleting uploads with drafts.

### 1.4 Multi-step and conversational

**Server** (src/smart-forms/class-multi-step.php): rendering only. There is **no server-side step validation**. `_cf_current_step` is a control field, ignored on submit, and stored only with drafts.

- `is_multi_step(schema)`: `layout.type ∈ {multi-step, conversational}` (:25-31). This **requires `_cf_form_schema`**.
- Markup forms are detected client-side by `cf-step-panel` in markup (class-asset-requirements.php:45). Hand-written step panels then get navigation.
- `get_steps` (:42-70):
  - Returns `layout.steps` verbatim when set (each `{id, label|title}`).
  - Otherwise derives steps from top-level fields' `group` (`'default'` if empty), labelled `ucfirst(str_replace(['_','-'],' ',group))`.
  - Fewer than 2 groups gives `[]`, which renders as a single page.
- `get_step_fields(i)`: top-level fields whose `group ?: 'default'` equals the step id. Children follow their container.
- `render()` (:107-181) outputs, in order:
  1. Progress bar: `<div class="cf-progress" role="progressbar" aria-label="Form progress" aria-valuenow="1" aria-valuemin="1" aria-valuemax="N">` containing `<div class="cf-progress__bar" style="width: round(100/N)%;">` and `<span class="cf-progress__text">1 / N</span>`.
  2. Step buttons: `<div class="cf-steps" role="group" aria-label="Form steps">` with one `<button type="button" class="cf-step [is-active]" data-step="i" [aria-current="step"|disabled]><span class="cf-step-number" aria-hidden="true">i+1</span>LABEL</button>` per step.
  3. Panels: `<div class="cf-step-panel[ cf-conversational]" data-step="i" [style="display:none;"] role="group" aria-label="LABEL">` with the fields, then `<div class="cf-step-nav">` holding `.cf-step-prev[data-step=i-1]` "Previous", `.cf-step-next[data-step=i+1]` "Next", and on the last step `<button type="submit" class="cf-step-submit">Submit</button>` only if the schema has no `submit` field.
  4. `<input type="hidden" name="_cf_current_step" value="0" />`
  5. `SchemaRenderer::normalize_ids`
- The step label is `label ?: title ?: "Step N"`.
- Client (smart-forms.js:29-135):
  - Next validates the current panel.
  - Enter in a non-button input advances.
  - Step buttons get `is-active`/`is-completed`; future ones are disabled.
  - Updates the progress bar and `_cf_current_step`.
  - Saves the draft on step change.
  - `form._cfGoToStep` is used for resume.
  - Form flag: `data-smart-multistep="1"`.
- Fullscreen mode refuses multi-step forms (§3.8).

### 1.5 Scheduling (src/smart-forms/class-form-scheduler.php)

`is_open(form)` (:58-136):

1. `schedule_enabled` empty means open.
2. `tz = wp_timezone()`, overridden by `new DateTimeZone(schedule_timezone)` when valid. An invalid zone falls back silently.
3. `now = new DateTime('now', tz)`.
4. When `schedule_open_date` is set: `now < DateTime(open_date, tz)` (midnight local) means closed.
5. When `schedule_close_date` is set: close is that date at **23:59:59** local; `now > close` means closed.
   - An unparsable date makes `new DateTime` throw, which is uncaught (fatal) in WP. The port should treat it as "ignore field" and log.
6. When `schedule_days` is a non-empty array: today's ISO weekday maps 1..7 to `mon,tue,wed,thu,fri,sat,sun`. Not in the list means closed. The check uses today's day even inside an overnight window.
7. Time window, comparing `H:i` strings lexicographically:
   - Both set, `open <= close`: closed if `cur < open || cur > close` (both ends inclusive at minute resolution)
   - Both set, `open > close` (overnight): closed if `cur < open && cur > close`
   - Only open: closed if `cur < open`
   - Only close: closed if `cur > close`

Enforcement:
- **Render:** filter `cf_form_html` at priority 5 (`maybe_block_form`, :145-159) replaces the entire form with `<div class="cf-form cf-form-{ID} cf-form-closed" role="status"><p>{wp_kses_post(schedule_closed_message ?: "This form is currently closed.")}</p></div>`.
- **Submit:** `SubmissionPolicy::error` returns `form_closed`, which responds 403 with `messages.form_closed`. A second check runs at `cf_validate_form` priority 5 (:169-179).
- Drafts are blocked as well (§1.3).

**Doc vs code:**
- `{{schedule.open_time}}` / `{{schedule.next_open_date}}` variables are not implemented.
- The documented default text "…closed for submissions." differs from the code ("This form is currently closed.").
- There is no timezone field in the admin UI (views/tab-settings.php:297-359 renders the enabled flag, dates, days, times and closed message only).

---

## 2. Availability policy

`SubmissionPolicy` (src/class-submission-policy.php) is called first in `Forms::process` (class-forms.php:708-711), then by drafts and rehearsal.

`error(form)` (:8-18) returns the first matching code:
1. Post not `publish`: `form_closed`
2. `require_user_logged_in` and `!is_user_logged_in()`: `require_user_logged_in`
3. `!FormScheduler::is_open`: `form_closed`
4. `submission_limit>0 && count(form) >= limit`: `submission_limit_reached`

The submit response is HTTP 403 `{error:true, message:{type:'error', text: get_message(code) ?: 'This form is currently unavailable.'}}`.

`count(form_id)` (:19-25):
- `SELECT COUNT(*) … WHERE form_id=? AND is_spam=0 AND status NOT IN ('draft','partial')`. All other statuses count, including archived and payment states.
- Plus option `cf_unsaved_capacity_{id}`: an integer incremented by `record_unsaved()` for each accepted submission on forms with `save_submissions=0` (:27-36, called class-forms.php:1099). This makes limits work without storage. **This option must be imported.**
- A DB error gives `PHP_INT_MAX`, which fails closed.

Capacity lock: when `submission_limit` is set, MySQL `GET_LOCK('cf_capacity_'.md5(prefix:ID), 5)` is held from before the availability check until the response (:38-49). A busy lock gives 503 "Please try again in a moment."

Render-time replacements run on `cf_form_html` priority 10, after the scheduler (5); the last writer wins. The admin preview (`SubmissionPolicy::is_preview()`, :50-53) bypasses both.
- Submission limit (extensions/submission-limit/src/class-frontend.php:14-22): `<div class="cf-message cf-message-warning cf-message-submission-limit">{messages.submission_limit_reached}</div>`. The message is unescaped admin HTML.
- Login required (extensions/require-user-logged-in/src/class-frontend.php:14-20): `<div class="cf-message cf-message-warning cf-message-require-user-logged-in">{messages.require_user_logged_in}</div>`.
- Because extensions load in the order submission-limit then require-login (core-forms.php:346-352), login wins over limit, which wins over schedule.

Admin:
- Number input "Submission Limit" and Yes/No radios "Require Users to Be Logged In?" are on `cf_output_form_settings`.
- Message fields are on the Messages tab.

---

## 3. Extensions (`extensions/`)

Load order (core-forms.php:326-353): data-exporter and data-management are admin-only. Webhooks, file-upload, notifications, submission-limit, require-user-logged-in and fullscreen-forms always load.

### 3.1 File upload (extensions/file-upload/includes/class-uploader.php)

**Normalization:** `cf_normalize_uploaded_files($_FILES)` (src/functions.php:1174-1230).
- Each field becomes `{name, type, tmp_name, error:int, size:int≥0}`. Multiple files (`name="x[]" multiple`) become a list of those. Nesting is capped at depth 3.
- `UPLOAD_ERR_NO_FILE` entries are omitted, so an optional empty input is absent from data.
- `full_path` is not copied.
- The result is merged into `$data` before the allowlist (class-forms.php:776). The field name must be declared in markup.

**Validation:** filter `cf_validate_form`, priority 10 (:185-229). It runs only after core validation passes, in this order, per file, returning the first error:
1. `protect_uploads` on and `PrivacyControls::private_directory()` throws: `file_upload_error`
2. `error !== UPLOAD_ERR_OK`: `file_upload_error`
3. Lowercased last extension in `BLOCKED_EXTENSIONS` (:10-25): `file_invalid_extension`. The list is php, php3-8, phtml, phar, exe, bat, cmd, com, msi, sh, bash, csh, ksh, zsh, cgi, pl, py, rb, jsp, asp, aspx, htaccess, htpasswd, svg, shtml, shtm, html, htm, xhtml, xml, xsl, xslt, swf.
4. Any **middle** segment (not the base name, not the last) blocked (`has_dangerous_double_extension`, :91-109): `file_invalid_extension`
5. `finfo` MIME of the temp file, when detectable, must map to the extension in `MIME_EXTENSION_MAP` (:30-73), else `file_mime_mismatch`. **An unknown MIME rejects.**
   - Consequences to replicate or decide on: `.csv` detected as `text/plain` is rejected; a file with no extension is rejected; a `.docx` sniffed as `application/zip` is rejected.
   - Map: jpeg→jpg/jpeg/jpe, png, gif, webp, avif, bmp, tiff→tif/tiff, pdf, msword→doc, docx, xls, xlsx, ppt, pptx, odt, ods, rtf, text/plain→txt/log, text/csv→csv, zip, x-rar-compressed→rar, gzip→gz, x-7z-compressed→7z, mpeg→mp3, wav, ogg, audio/mp4→m4a, video/mp4→mp4, webm, quicktime→mov, x-msvideo→avi.
6. `size > apply_filters('cf_upload_max_filesize', 8000000)` (decimal bytes): `file_too_large`

There is no per-field `accept` enforcement on the server, and no per-form type/size settings.

**Storage:** action `cf_process_form` (:231-273), fired before the DB insert (class-forms.php:915). If `error_code !== ''` (including `spam`), pending file values are removed from data and nothing is stored. Otherwise, per file (`store_file`, :297-398):
- Directory:
  - Public: `{uploads.basedir}/core-forms/{form.slug}`; URL `{uploads.baseurl}/core-forms/{form.slug}`.
  - `protect_uploads`: `{private_directory()}/{form.ID}`.
  - The directory is created, must be writable (else `UploadFailure`), and gets `.htaccess` (deny script extensions) and `index.php`.
- The checks above are re-run. `sanitize_filename(original)` (:114-138):
  - strip ``<>:"/\|?*`` and control characters
  - whitespace becomes `-`
  - collapse `-`, trim `-`
  - empty becomes `upload`
  - append `.` plus the lowercased extension
- Stored name: `sprintf('%s_%s_%s.%s', submission->id ?: gmdate('YmdHis'), sanitize_file_name(field) ?: 'file', uniqid(), ext)`. The id is **always empty** at this point, so the prefix is a UTC timestamp; the docs' `42_resume_…` example is wrong.
- `move_uploaded_file` failure makes `store_file` return null, which throws `UploadFailure`.
- The descriptor stored in submission data replaces the field value (a list for multiple):
  ```
  { name: <stored filename>, type: <client MIME>, size, dir: <absolute dir>, original_name: <sanitized original>,
    url: <public URL | admin-post.php?action=cf_private_download&attachment=ID>, attachment_id?: int, private?: true }
  ```
- A Media Library attachment is created when `protect_uploads` is on or `apply_filters('cf_upload_add_to_media', true)` (default true):
  - `wp_insert_attachment({post_mime_type, post_title: stored name, post_status:'private'}, path, 0)`
  - post meta `_cf_form_id`
  - private files also get `_cf_private_path` and `url` set to the download route
  - attachment metadata is generated (thumbnails)
  - Any failure deletes the file and fails the upload.
- On any exception, all files created in this request are deleted (attachments too), then `UploadFailure` is rethrown. `Forms::process` catches it and sets `error_code='file_upload_error'` (class-forms.php:914-918).
- After the insert, `PrivacyControls::attach_ownership` (class-privacy-controls.php:28-40) sets attachment meta `_cf_submission_id` for descriptors whose path equals `get_attached_file`.

**Display, email and export:**
- `cf_field_value()` (functions.php:1025-1062) is used by `[field]`/`[all]` tokens, emails and the admin. It renders `<a href="{url}">{first 20 chars of name}{'...'}</a> ({human size})`.
  - For non-private files the link is the **wp-admin attachment edit page** `post.php?action=edit&post={attachment_id}`, unless the filter `cf_file_upload_use_direct_links` returns true.
  - A missing attachment renders "File not found". A descriptor without `attachment_id` renders `false`.
- Emails never attach files.
- The CSV exporter writes `full_path (url)`; `full_path` is never set, so the cell is ` (url)`. Multi-file lists are a comma-joined list of URLs.
- Webhook form bodies send the descriptor array as nested form fields; JSON bodies send it as an object.

**Private download:** `admin-post.php?action=cf_private_download&attachment=ID` (class-privacy-controls.php:41-53), both priv and nopriv.
- Requires `TeamInbox::can_access(_cf_form_id)` and, when `_cf_submission_id` is set, `can_access_entry`. Otherwise 403 "Sign in with access to this form to download its attachment."
- The real path must be under `private_directory()/{form_id}/`, else 404.
- Response headers: `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename="{basename}"`, `X-Content-Type-Options: nosniff`, no-cache.

**Private directory:** `CF_PRIVATE_UPLOAD_DIR` or `dirname(ABSPATH)/.core-forms-private`, plus `/{substr(sha256(site_url),0,16)}`. It must resolve outside ABSPATH and DOCUMENT_ROOT and be writable (:16-27).

**Deletion:** see §4.9 (`PrivacyControls::files/delete_submission/retire_attachments`). Plain inbox delete also goes through `PrivacyControls::delete_submission`; this is assumed and the inbox-delete call site belongs to another spec.

**Admin:**
- File field in the legacy field builder (`assets/dist/js/admin.js`).
- Message fields for `file_too_large` and `file_upload_error` only (includes/class-admin.php:29-47). The other two messages have no UI.

### 3.2 Notifications (unread badge)

- `enable_notifications` (default 1). On `cf_form_success`, if `save_submissions && enable_notifications`, the submission id is appended to post meta `_cf_unseen_submissions` (a serialized int list) after pruning ids whose rows no longer exist (extensions/notifications/src/functions.php:54-106).
- `cf_update_submission_status()` (functions.php:2734-2770) removes the id unless the new status is `new`, which re-adds it. Deletes prune it via `cf_prune_unseen_submissions` (functions.php:2902-2930).
- Admin:
  - menu badge with the total
  - per-form "N New Submissions" badge
  - `cf-unseen` row highlight
  - bulk "Mark as read"/"Mark as new" and a row toggle (src/Admin.php)
- **Port mapping:** the unread state equals `status==='new'` (v0.1.0 already counts this). `enable_notifications=0` only hides badges. Import `_cf_unseen_submissions` as a consistency check only.

### 3.3 Webhooks (extensions/webhooks/src/Action.php)

Action settings and defaults (:21-32):
- `url`
- `content_type` **`'form'`** (`'json'` | `'form'`)
- `auth_header_name`, `auth_header_value`
- `webhook_secret`
- `webhook_key_id` `'default'`

`process()` (:97-170):
1. An empty URL, or one failing `cf_is_safe_outbound_url` (http/https only; rejects `localhost` and hosts resolving to private, loopback or link-local IPs; functions.php:3966+), returns false.
2. Headers: `Referer: site_url()`, plus the auth header with CR/LF stripped from name and value when both are non-empty.
3. JSON body: `json_encode($submission->data)`, the **flat field map**. Form body: the `$submission->data` array, encoded by WP using `http_build_query` semantics, so lists are `k[0]=a&k[1]=b`.
4. Filter `cf_webhook_request_args`.
5. `X-CF-Event-Id` = `ActionRunner::execution_key()`: `sha256("{formID}|stored:{id}|{action_id}|{type}|{version}")`, or `ephemeral:{uuid}` for unsaved submissions (src/workflows/class-action-runner.php:37-46).
6. When a secret is set:
   - the body is stringified (`http_build_query` for arrays)
   - `X-CF-Signature: sha256=` + `hex(HMAC-SHA256(secret, "{ts}.{body}"))`
   - `X-CF-Timestamp: {ts}`
   - `X-CF-Key-Id: sanitize_key(key_id) || 'default'` (src/workflows/class-webhook-signer.php)
7. Success means a 2xx response whose JSON body does not contain `ok:false`, `success:false` or `status:'error'`. 408, 425, 429, 5xx and network errors are retryable, honoring `Retry-After` (src/integrations/class-integration-http.php:8-23). Queue and retry mechanics belong to the workflow spec.

### 3.4 Data exporter (CSV)

`_cf_admin_action=export_form_submissions` (extensions/data-exporter/src/class-admin.php:30-107):
- Access via `TeamInbox::can_access`.
- Filename `core-forms-submissions-{form_id}.csv`, `application/octet-stream`.
- Columns: `submitted_at`, then the union of data keys across all submissions (first-seen order, paged by 500), then `ip_address, user_agent, referer_url`.
- Arrays are joined with `', '`. Files are rendered as described in §3.1.
- Every row goes through `cf_csv_row()`, which does formula-injection escaping (core spec).
- `cf_get_form_submissions` defaults include drafts and spam, so they are exported.

### 3.5 Data management (column tools)

Admin actions on the per-form submissions table (extensions/data-management/src/class-admin.php):
- `hide_data_column` / `show_data_column` / `show_all_data_columns`: edit post meta `_cf_hidden_columns` (a string list).
- `rename_data_column&new_column_key=`: paged through all rows of the form, and does a raw `str_replace('"old":','"new":', data_json)`.
  - This is a WP bug: it also rewrites a matching `"old":` inside string values.
  - The port should rename the key properly.
- `delete_data_column`: unsets the key in every row, then drops it from hidden.
- Each change emits `cf_submission_written`.

### 3.6 Submission limit, 3.7 Require login

See §2.

### 3.8 Fullscreen forms (extensions/fullscreen-forms)

Server side is data attributes plus assets only. The one-question-at-a-time UI is client JS (`assets/js/fullscreen.js`, `assets/css/fullscreen.css`).

- `is_supported(form)` (src/class-frontend.php:28-42) is false when `payment_enabled` is set or when the schema is multi-step. Filter `cf_fullscreen_is_supported`. Unsupported forms render normally.
- When `display_mode==='fullscreen'` and supported:
  - form attributes `data-display-mode="fullscreen"`, `data-fullscreen-theme`, `data-fullscreen-animation`, `data-fullscreen-show-progress` (filter `cf_form_element_data_attributes`)
  - class ` cf-form-fullscreen`
  - external CSS/JS from the comma- or newline-separated `fullscreen_external_css`/`_js`, filtered to valid **https** URLs passing `wp_http_validate_url` (:149-161)
- `fullscreen_page_title` and the standalone-page settings shown in this admin section belong to the standalone-routes spec.
- Admin: "Display" section with display mode, page title, theme, animation, progress yes/no, and the external CSS/JS textareas (src/class-admin.php).

---

## 4. Spam protection

### 4.0 Exact order in `Forms::process` (src/class-forms.php:678-1120)

1. Nonce, if global `enable_nonce` (:680-691). Failure: 403 "Your session has expired."
2. Form resolve: 404.
3. Capacity lock, then `SubmissionPolicy::error`: 403 (§2).
4. **Honeypot** (:713-746).
5. **Rate limit read** (:750-767).
6. Drop `_`-prefixed keys and `cf_ignored_field_names` (`action`, captcha token keys) (:772-781). Then the allowlist (:794-810).
7. `FieldCalculator::process`, which enforces hidden fields (:814-822). Failure: 422.
8. Size limits (:827-838), trim and template (:844-861), size limits again (:865-874).
9. **Duplicate check** (:886-899).
10. `validate_form` (:912): `validate_fields` (limits, required, email, schema field validation). If that is empty, filter `cf_validate_form`:

    | Priority | Check | Notes |
    |---|---|---|
    | 5 | schedule | |
    | 10 | reCAPTCHA | only if global keys are set (registered earlier, so it runs first) |
    | 10 | Turnstile | |
    | 10 | file upload | |
    | 15 | math captcha | |
    | 20 | Akismet | |

    Each validator passes through an existing error unchanged.
11. `cf_process_form`: file storage, which can produce `file_upload_error`.
12. `is_spam = (error==='spam')`. Rate limit bump only when the error is `''` or `spam` (:926-928).
13. Save when `save_submissions` and the error is `''` or `spam`, with `is_spam`. Remember the duplicate fingerprint only after a successful insert (:994).
14. Payment branch.
15. Success branch, only when the error is `''`: `record_unsaved`, retire draft, `cf_form_success`, actions with conditions. **Spam never runs actions** and never fires `cf_form_success`.
16. `cf_form_response(form, submission, error_code)`, which feeds analytics.
17. Response: `''` or `spam` gives the success message (plus `hide_form` and `redirect_url`). Anything else gives `{message:{type:'error', text: get_message(code)}}` with HTTP **200** and `error:true` added by `respond()` (:645-676).

### 4.1 Honeypot

- Always rendered: `<div style="display: none;" aria-hidden="true"><input type="text" name="_cf_h{ID}" value="" tabindex="-1" autocomplete="off" /></div>` (src/class-form.php:99).
- Always enforced. `enable_honeypot` is **never read**.
- The server accepts the first POST key that **starts with** `_cf_h`.
- A missing key gives reason `honeypot_missing`; a non-empty value gives `honeypot_filled`.
- Both answer with the hardcoded default success text "Thank you! We will be in touch soon." (not the form's custom success message), HTTP 200, store nothing, run nothing.
- `record_blocked_attempt(form, reason)` (:1140-1155):
  - increments post meta `_cf_blocked_counts[reason]` (per form)
  - fires `cf_submission_blocked`
  - fires `cf_form_response` with the reason, which produces an analytics `blocked` event

### 4.2 Rate limit

- `cf_get_form_submission_rate_limit` = `rate_limit` setting, filter `cf_submit_rate_limit` (functions.php:4248-4251).
- Transient `cf_rl_` + `md5(REMOTE_ADDR.'_'.form_id)`. When `count >= limit`, it responds "Too many submissions. Please try again in a moment." (HTTP 200, `error:true`). There is no message key and no analytics event.
- The count is bumped only for stored-eligible outcomes (valid or spam), with TTL 3600 s that resets on each bump, so the window slides.

### 4.3 Prevent duplicates

- Key: `cf_dup_` + `md5("{form.ID}|{u{user_id} | i{ip}}|" + wp_json_encode(ksort(data minus pending files)))` (:1170-1186).
- Window: filter `cf_duplicate_window_seconds` (default **3600**; `<=0` disables).
- A hit responds with error `duplicate_submission` ("You have already submitted this form with the same details.").
- The fingerprint is set only after a **stored** submission, so it never applies to `save_submissions=0` forms or to validation failures.

### 4.4 Google reCAPTCHA v3 (src/admin/class-recaptcha.php)

- **Site-wide:** active on **every form** when both global keys are set (`is_configured`, :47-53). There is no per-form toggle.
- Render:
  - the comment `<!-- Google reCAPTCHA v3 active on this form -->` is prepended to markup
  - scripts `https://www.google.com/recaptcha/api.js?render={site_key}` and `assets/js/recaptcha.js` are enqueued
  - `cf_recaptcha.site_key` is localized
- Client: intercepts submit, then `grecaptcha.execute(key,{action:'core_forms_submit'})`, then a hidden `g-recaptcha-response`. On a client error it posts `g-recaptcha-failed=1`. It resets on `cf-error`.
- `validate_recaptcha` (:151-211) reads `$_POST`:
  - `g-recaptcha-failed` non-empty: `recaptcha_failed`
  - empty token or `strlen<20`: `recaptcha_failed`
  - POST `https://www.google.com/recaptcha/api/siteverify` with form body `secret, response, remoteip=REMOTE_ADDR`, timeout 10 s
  - network or JSON failure: `recaptcha_failed`
  - `!success`: `recaptcha_failed`
  - `score < apply_filters('cf_recaptcha_min_score', 0.5)`: `recaptcha_low_score`
  - `action` and `hostname` are **not** checked
- These are error responses (not stored, not `spam`).
- Admin: message fields `recaptcha_failed` and `recaptcha_low_score` (only when configured), plus a notice on the form editor.

### 4.5 Cloudflare Turnstile (src/admin/class-turnstile.php)

- Requires both global keys **and** per-form `enable_turnstile=1`. The checkbox appears in the Anti-spam card via `cf_output_form_settings_spam` (:315-338).
- When reCAPTCHA is also configured, a Turnstile form needs **both** to pass.
- Render: `<div class="cf-turnstile-container" data-sitekey="{key}" data-form-id="{ID}"></div>` is inserted before the first `<input|button … type="submit">` (regex), or appended. Scripts `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` and `assets/js/turnstile.js` are enqueued.
- Client: explicit `turnstile.render` with callback, error-callback and expired-callback. It fills `cf-turnstile-response`, sets `cf-turnstile-failed=1` on error, and resets on error.
- `validate_turnstile` (:189-231):
  - `cf-turnstile-failed`, an empty token or `strlen<20`: `turnstile_failed`
  - POST `https://challenges.cloudflare.com/turnstile/v0/siteverify` with `secret, response, remoteip`, timeout 10 s
  - `!success`: `turnstile_failed`
- Global keys UI: `output_global_settings` (:367-397).

### 4.6 hCaptcha (src/admin/class-hcaptcha.php)

- Core Forms does **no** hCaptcha verification. When the third-party hCaptcha plugin is active (`function_exists('hcaptcha')`, core-forms.php:203-206), it only adds the ignored fields `hcaptcha-widget-id`, `hcap_fst_token`, `g-recaptcha-response`, `h-captcha-response` and `core_forms_form_nonce`.
- Verification is done by that plugin through its own hooks.
- The port's native hCaptcha (v0.1.0) is an EmDash-only addition. Imported forms cannot carry an hCaptcha flag (open question §11).

### 4.7 Math captcha (src/admin/class-math-captcha.php)

- Per-form `enable_math_captcha`. Generation runs on every render (`cf_form_markup` priority 20, :56-84). The operator is chosen with `array_rand`:
  - `+`: a, b ∈ [1,20]
  - `-`: a ∈ [10,30], b ∈ [1,a-1]
  - `*`: a, b ∈ [2,10]
- Markup (:111-130), inserted before the **first** `<button…>` or `<input type=submit>` (regex, :133-139), or appended:
  - `div.cf-math-captcha[role=group][aria-labelledby=cf_math_captcha_label_{ID}]`
  - label "Security question: **a op b** = ?"
  - `<input type="number" name="cf_math_captcha_answer" required inputmode="numeric" id="cf_math_captcha_answer_{ID}">`
  - description "This question helps us prevent spam. Please solve the math problem above."
  - `<input type="hidden" name="cf_math_captcha_hash" value="{wp_hash(answer . wp_salt())}">`
  - Inserting before the first `<button` can land before a multi-step "Next" button.
- Validation (:152-192): skipped for users with `edit_posts`. A missing answer or hash, or `hash !== wp_hash((int)answer . wp_salt())`, gives `math_captcha_failed`.
  - Weakness: the hash depends only on the answer, so a solved pair is **replayable forever across forms**.
  - The port should HMAC `formId|answer|expiry|nonce`. Rendered challenges carry no stored data, so this does not affect compatibility.

### 4.8 Akismet (src/admin/class-akismet.php)

- Active only when the Akismet plugin exists with an API key (:31-44).
- Skipped for `edit_posts` users.
- Whitelist: global `akismet_whitelist` (newline list, trimmed, filter `cf_akismet_whitelist_keywords`). A case-insensitive substring match against all values joined by spaces skips the check.
- Request (`build_akismet_data`, :103-165), filter `cf_akismet_data`:
  - `blog=home`, `blog_lang=get_locale()`, `blog_charset`
  - `user_ip` = first of `HTTP_CF_CONNECTING_IP`, `X-Forwarded-For` (first entry), `X-Real-IP`, `REMOTE_ADDR`
  - `user_agent`, `referrer=HTTP_REFERER`, `permalink=HTTP_REFERER || site_url`, `comment_type=contact-form`
  - `comment_author`: first key in `[name, full_name, fullname, your_name, your-name, author, first_name, firstname]`
  - `comment_author_email`: first key in `[email, e-mail, your_email, your-email, mail, email_address]` **or any value passing `is_email`**
  - `comment_author_url`: first key in `[url, website, site, web, homepage]`
  - `comment_content`: `"{key}: {value}"` lines for non-empty values (arrays joined with `', '`)
  - Keys are compared lowercased.
- Call: `Akismet::http_post(http_build_query(data), 'comment-check')`. The body `"true"` gives `spam`.
- EmDash must call the Akismet REST API directly: POST `https://rest.akismet.com/1.1/comment-check` with `api_key` plus the fields above. Needs a new global secret `akismetApiKey` (open question §11).
- A `spam` verdict means: stored with `is_spam=1`, success response, no actions, analytics `spam` event.
- Admin: message field `spam` (only when Akismet is active).

### 4.9 Privacy and GDPR

#### 4.9.1 WP personal-data exporter and eraser (src/admin/class-gdpr.php)

Registered as `core-forms` on `wp_privacy_personal_data_exporters` / `_erasers` (priority 90).

- Lookup (:103-160): `cf_submissions.data LIKE '%"{esc_like(email)}"%'` as a prefilter, then a confirmed **exact, case-insensitive, trimmed scalar equality** against any submitted value (arrays flattened one level).
- Export item: `group_id core_forms_submissions`, label "Form submissions", `item_id core-forms-submission-{id}`. Data:
  - "Submitted at"
  - "IP address" (if any)
  - "User agent" (if any)
  - each field, with arrays joined `', '`
- `done:true` in a single page.
- Erase: `PrivacyControls::delete_submission(id)` per row. It returns `items_removed`, `items_retained`, and the message "Entries needed for pending payment or fulfillment were retained." when any row was refused.
- **Not covered:** poll votes (raw IP, user_id, cookie), analytics (hashed), email logs except through deleting their submission.

#### 4.9.2 Retention: cron `cf_retention_cleanup`, daily (class-privacy-controls.php:116-200)

- `candidates(form, limit=100, attachments=false)` uses `submission_retention_days` or `attachment_retention_days` (0 = off). It selects ids with:
  - `submitted_at < now-days`
  - no team `hold`
  - `status NOT IN ('draft','partial')`
  - no active fulfillment, action queue or payment reversal
  - `payment_status IS NULL OR 'payment_failed'`
  - ordered by id, limit 1..100
- `cleanup()`: for every form, `delete_submission(id, automatic:true)` for entry candidates, then `retire_attachments(id)` for attachment candidates. It writes option `cf_retention_last_run = {at, entries, attachments}`.
- `delete_submission` (:123-150), under lock `payment:{id}` and a DB transaction:
  - Refuses when there is pending work, `pending_payment`, or (if automatic) a hold or draft.
  - Deletes owned files (`files()`, :69-101, which validates canonical path, ownership meta and that the root is the private dir or `uploads/core-forms/{slug}`). A failed file delete aborts and keeps the row.
  - Deletes rows in `cf_submission_replies`, `cf_email_logs`, `cf_action_queue`, `cf_action_logs`, `cf_submission_team`, `cf_fulfillment`, `cf_payment_reversals`, `cf_submissions`.
  - Emits `cf_submission_written(id,'erase')`.
- `retire_attachments`: deletes owned files and replaces each file descriptor in data with the string `"Attachment removed by retention"`.
- REST `GET /cf/v1/forms/{id}/retention-preview` (`TeamInbox::can_access`) returns `{entry_ids, attachment_entry_ids, limit:100}`.
- Admin card "Privacy and retention" (`render`, :204-213): two day inputs, "Protect new uploads" checkbox, saved-policy preview.

#### 4.9.3 IP handling summary

| Store | What | Notes |
|---|---|---|
| `cf_submissions.ip_address` | raw `REMOTE_ADDR` | always stored (no setting); drafts too |
| `cf_poll_votes.ip_address` | raw; `REMOTE_ADDR` unless filter `cf_poll_trust_forwarded_for` | plus `cookie_hash` (raw cookie value) and `user_id` |
| `cf_analytics.ip_hash` | `sha256(ip . AUTH_SALT . gmdate('Y-m-d'))` | written, **never read** by any query |
| transients | `md5(ip…)` keys | rate limits |

v0.1.0 adds a global `storeIp` setting (default true). Keep it; WP has no equivalent.

---

## 5. Polls (src/polls/)

### 5.1 Data model

- CPT `core-poll` (class-poll-admin.php:55-85): non-public, `show_ui`, supports `title`. The post supplies the **title**, **slug** (`post_name`) and **post_status**.
- Table `wp_cf_polls` (functions.php:2346-2373, migration 4.3.0 :1602-1626):

  | Column | Default | Meaning |
  |---|---|---|
  | `id` INT AI | | poll id (block/shortcode `id`) |
  | `post_id` INT, index | | core-poll post |
  | `question` TEXT | | |
  | `options` TEXT | | JSON string list |
  | `settings` TEXT | | JSON `{allow_multiple(legacy), show_results_before_vote, vote_limit, honeypot, display_style}` |
  | `type` VARCHAR(20) | `single` | `single`/`multiple` (legacy `settings.allow_multiple` truthy and `type==single` gives multiple, class-poll.php:72-74) |
  | `allow_other` TINYINT | 0 | "Other" write-in, option index = `count(options)` |
  | `post_close_behavior` VARCHAR(20) | `show_results` | `show_results`/`hide`/`redirect` |
  | `redirect_url` TEXT NULL | | |
  | `enable_live_results` TINYINT | 0 | |
  | `change_vote_window` INT | 0 | minutes; 0 = off |
  | `status` VARCHAR(20) | `active` | `active`/`closed` (the save handler accepts any string; non-`active` is treated as inactive) |
  | `ends_at`, `starts_at` DATETIME NULL | | see timezone note |
  | `created_at` TIMESTAMP | now | |

- Table `wp_cf_poll_votes` (functions.php:2378-2401, migration :1628-1645):
  - `id`, `poll_id`
  - `option_index` INT (one row **per selected option**)
  - `option_value` TEXT NULL (write-in text)
  - `ip_address`, `user_id` NULL, `cookie_hash` VARCHAR(64), `voter_hash` CHAR(64)
  - `referrer` TEXT, `voted_at` TIMESTAMP
  - Indexes: `poll_idx`, `poll_ip_idx`, `poll_voter_idx(poll_id, voter_hash)`
  - Legacy backfill: `voter_hash = sha256("{poll_id}|{user_id}|{ip}|{cookie_hash}")` (:1655-1688). This differs from the live hash format, so legacy votes do not dedupe against new votes.
- Defaults (class-poll.php:152-160): `vote_limit 'ip'`, `honeypot 1`, `display_style 'bar'` (`columns`, `percent`; `donut` is mentioned in a comment but not offered), `show_results_before_vote false`.
- **Timezone bug to decide on:**
  - The admin saves `date('Y-m-d H:i:s', strtotime(datetime-local))` with PHP in UTC, so the entered wall time is stored as if UTC (:554-566).
  - `is_active`, `is_closed` and `is_scheduled` use `strtotime(...)`, which is UTC.
  - The cron compares against `current_time('mysql')` (site local).
  - The scheduled notice formats with `wp_date` (site tz).
  - **Import as UTC instants**. That matches the voting checks and the existing data.

### 5.2 State predicates (class-poll.php:96-150)

- `is_active` = `status==='active' && !(ends_at && ends_at < now) && !(starts_at && starts_at > now)`
- `is_scheduled` = `starts_at > now`
- `is_closed` = `status==='closed' || ends_at < now`
- `honeypot_enabled` = setting unset or truthy
- `change_vote_window_seconds` = minutes × 60
- `get_result_options(results)` = options, plus index `count(options)` labelled "Other" when `allow_other` or that index has votes (:35-42)
- **The core-poll `post_status` is not checked anywhere in render or vote.** Draft polls render and accept votes.

### 5.3 Embeds

- Shortcode `[cf_poll slug="" id="" results="1"]` (class-poll-frontend.php:104-124). Slug wins: `get_page_by_path(slug,'core-poll')`, then the poll row. Not found renders `<p class="cf-poll-error">Poll not found.</p>`.
- Block `core-forms/poll` (class-poll-block.php:68-97), title "Core Polls". Attributes `pollId:int=0` and `mode:'auto'|'results'|'form'`. The editor list holds polls whose post is publish or draft, ordered by title, limit 200.
- `render(poll, mode)` (class-poll-frontend.php:133-175):
  1. `is_scheduled`: `<div class="cf-poll cf-poll-scheduled">` with question and "This poll opens on {date time}."
  2. `is_closed`:
     - `hide`: `''`
     - `redirect`: closed notice plus `<a class="cf-poll-redirect-link">Continue</a>` (no server redirect)
     - otherwise: results with "This poll is closed."
  3. `mode==='results'`: results panel.
  4. Has voted and `mode!=='form'`: within the change window gives the form with results and pre-checked choices (`cf-poll-changing`, `poll_action=change`, button "Update my vote"); otherwise the results.
  5. `show_results_before_vote`: form with inline results.
  6. Otherwise the plain form.
- Form markup (:181-281):
  - `div.cf-poll.cf-poll-style-{style}[.cf-poll-with-results][.cf-poll-changing][data-poll-id][data-poll-slug][data-live][data-style]`
  - `form.cf-poll-form[novalidate]` > `fieldset` > `legend.cf-poll-question`
  - hidden `poll_id`, `poll_action` (vote|change) and nonce `cf_poll_nonce` (action `cf_poll_vote_{id}`)
  - honeypot `cf_poll_hp` in an off-screen div
  - options `input[type=radio|checkbox][name=cf_poll_option(\[\])?][value=index][id=cf-poll-{id}-opt-{i}]`
  - Other: `value=count(options)` with `data-cf-other="1"`, plus `input[name=cf_poll_other][maxlength=200]`
  - with results: `.cf-option-pct`/`.cf-option-count`/`.cf-option-bar` (integer % via `round`)
  - footer total "N vote(s)" when results are shown
  - `button.cf-poll-submit`, `.cf-poll-message[role=status]`
- Results markup (:283-339):
  - `div.cf-poll.cf-poll-results`, `h3.cf-poll-question`, optional `.cf-poll-closed-notice`
  - `.cf-poll-results-list[role=list]` > `.cf-result-item` with option, `%`, `progressbar`, "N votes"
  - footer "N votes total", plus " · M voters" when `0 < uniques ≠ total`
- Assets: `assets/css/poll-frontend.css`, `assets/js/poll-frontend.js`. Localized `cf_poll = {ajax_url, strings{error, loading, vote, update, no_choice, thanks, change}, live_poll_ms: 15000}`.

### 5.4 Voting: `cf_poll_vote`, POST admin-ajax, nopriv too (:380-483)

All errors are `wp_send_json_error({message})` with HTTP 200 and `success:false`.

1. `poll_id` must be present and `wp_verify_nonce(cf_poll_nonce, 'cf_poll_vote_{id}')` must pass, else "Invalid request."
2. A non-empty honeypot `cf_poll_hp`: bump the rate limit and return success `{message:'Thank you for voting!', html:''}`. Nothing is stored. This runs even if the poll has the honeypot disabled.
3. Rate limited, meaning transient `cf_poll_rl_` + `md5(ip)` ≥ **12** (all polls; TTL 60 s, sliding): "Too many requests. Please try again in a minute."
4. Poll missing or `!is_active()`: "This poll is no longer active."
5. `is_change` = `poll_action==='change'`.
6. `vote_limit==='user'` and not logged in: "Please log in to vote."
7. Not a change and `has_user_voted`: "You have already voted in this poll."
8. A change with `!can_change_vote || !is_within_change_window`: "The window to change your vote has closed."
9. `parse_submitted_options` (:511-536): `cf_poll_option` (scalar or array) is mapped with `intval` and kept when `0 ≤ idx ≤ count(options)+(allow_other?1:0)-1`, then deduplicated.
   - None left: "Please select an option."
   - Single type with more than one: "This poll only accepts one choice."
10. `other = sanitize_text_field(cf_poll_other)`. There is **no server length cap**; the port should cap at 200.
11. Filter `cf_poll_validate_vote(null, poll, options, other)` returning a `WP_Error` fails.
12. `voter_hash = compute_voter_hash`. On a change, all rows `WHERE poll_id AND voter_hash` are deleted (`cf_get_voter_recent_votes` + `cf_delete_poll_votes`; no transaction).
13. For each option: if it is the Other index with empty text, return "Please type your answer for the "Other" option." **after** earlier rows may already be written (WP bug: partial write). Otherwise insert `{poll_id, option_index, option_value, ip_address, user_id|null, cookie_hash: cookie value, voter_hash, referrer: HTTP_REFERER}`.
14. Bump the rate limit, then `do_action('cf_poll_voted', poll, options, other, voter_hash)`.
15. Success `{message: change ? 'Your vote has been updated.' : 'Thank you for voting!', html: render(poll) (auto mode), results:{idx:count}, total}`.

**Voter hash** (:589-647):
- `vote_limit=none`: a per-request UUIDv4, so there is never a dedupe.
- Otherwise the parts start as `['p{poll_id}']`, then:
  - `user`, `ip` and `cookie` add `u{user_id}` when logged in
  - `ip` and `cookie` add `i{ip}` and `a{md5(first 200 chars of UA)}`
  - `cookie` adds `c{cookie}`
  - `user` with an anonymous visitor adds `c{cookie}`
- Only `p…` present gives `''` (no dedupe). Otherwise `sha256(implode('|', parts))`.
- An unknown `vote_limit` string also yields `''`, so votes are unlimited.
- The admin labels are misleading. `ip` ("By IP + cookie") is actually IP+UA, and `cookie` ("By cookie only") is actually IP+UA+cookie.

**`has_user_voted`**: false for `none` or an empty hash; otherwise `EXISTS(poll_id, voter_hash)`.

**Change window**: true when the newest row for the hash is at most `change_vote_window*60` seconds old (`voted_at` parsed as UTC).

**Voter cookie** `cf_poll_voter`:
- 32 alphanumeric characters (`wp_generate_password(32,false)`)
- 365 days, `httponly`, `SameSite=Lax`, `secure` when on SSL, path `COOKIEPATH||'/'`, domain `COOKIE_DOMAIN`
- Set on `send_headers` for pages containing a poll (block, shortcode or raw marker detection) and lazily during AJAX votes (:712-756)

**IP**: `REMOTE_ADDR`. `HTTP_CLIENT_IP`/`X-Forwarded-For` only when `cf_poll_trust_forwarded_for` is true (:685-702).

### 5.5 Results reads

- `cf_poll_results` AJAX, GET `poll_id`, public, no rate limit (:490-505): `{success:true, data:{results:{idx:count}, total, html: render_results(poll, is_closed)}}`.
- Results visibility (`show_results_before_vote`, `mode`) is **UI-only**. Counts are always public via this AJAX action and `REST /results`.
- `cf_get_poll_results` = `GROUP BY option_index`. Total = sum, which counts selections.
- `cf_get_poll_unique_voters` = `COUNT(DISTINCT COALESCE(voter_hash, 'row-'||id))` (functions.php:3144-3155).
- `cf_get_poll_daily_votes(days)` zero-fills `Y-m-d` (UTC) for `days` days ending today (:3161-3195).
- Live client: every `live_poll_ms` (15 s), skipped when `document.hidden`. It fetches `?action=cf_poll_results&poll_id=` and updates bars from `data.results`/`data.total` (poll-frontend.js:159-183).

### 5.6 REST (src/polls/class-poll-rest.php), namespace `cf/v1`

- `GET /polls` (`edit_posts`): latest 100 by `created_at` DESC. Payload `{id, post_id, slug, title, question, type, status, is_active, is_closed, allow_other, starts_at, ends_at, enable_live_results, change_vote_window, display_style, post_close_behavior}`.
- `GET /polls/{id}` (`edit_posts`): the same payload plus `options`. 404 `cf_poll_not_found`.
- `GET /polls/{id}/results` (**public**): `{poll_id, total, uniques, closed, options:[{index, label, votes}]}`.
- `GET /polls/{id}/analytics?days=30` (`edit_posts`; clamped 1..365): `{poll_id, days, series:{Y-m-d:n}, total, uniques}`.

### 5.7 Cron `cf_poll_auto_close`, hourly (class-poll-cron.php:19-28)

`UPDATE cf_polls SET status='closed' WHERE status='active' AND ends_at IS NOT NULL AND ends_at <= current_time('mysql')` (site-local time; see §5.1). It is cosmetic, because `is_active` already checks `ends_at`. The port can derive the state lazily and skip the cron, keeping the stored status consistent on read or write.

### 5.8 Admin (class-poll-admin.php)

- Menus under Core Forms: "Polls" (CPT list) and "Add Poll" (`edit_posts`). There is a hidden page `admin.php?page=cf-poll-analytics&poll=ID` (:87-121).
- Single-column tabbed editor replacing the post editor. Tabs Question, Settings, Schedule, Embed and Results, with the active tab persisted through save via `cf_active_tab` and `cf_tab` (:156-221).
  - **Question:** `cf_poll_question` textarea, `cf_poll_type`, `cf_poll_options[]` (sortable, Enter adds), `cf_poll_allow_other`. The client requires at least 2 options.
  - **Settings:** `cf_poll_settings[vote_limit|display_style|show_results_before_vote|honeypot]`, `cf_poll_enable_live_results`, `cf_poll_change_vote_window` (minutes).
  - **Schedule:** `cf_poll_status` (active/closed), `cf_poll_starts_at`/`ends_at` (datetime-local), `cf_poll_post_close_behavior`, `cf_poll_redirect_url`.
  - **Embed:** shortcodes (publish only) and a block hint.
  - **Results:** total, uniques, bars, links to analytics and CSV.
- Save (`save_post_core-poll`, nonce `cf_save_poll`, :482-604): partial-safe merge with the existing row.
  - Options are sanitized and empty ones removed.
  - Type is validated, as is the close behavior.
  - `vote_limit` and `display_style` are **not** validated.
  - `redirect_url` goes through `esc_url_raw`.
  - Upsert by `post_id`.
- List columns: Shortcode `[cf_poll slug="…"]`, Votes, Status (Scheduled/Active/Closed). Row actions: Analytics, Duplicate.
- Duplicate (`admin-post.php?action=cf_poll_duplicate`, :690-732): a new draft post "{title} (Copy)" and a row copy with `status active` and schedule cleared.
- CSV (`action=cf_poll_export_csv`, nonce `cf_poll_export_{id}`, :734-783): `poll-{id}-votes.csv`, columns `id, option_index, option_label ('Other' for the write-in index), option_value, ip_address, user_id, voter_hash, voted_at, referrer`, ordered by `voted_at` ASC, through `cf_csv_row`.
- Analytics page (:785-889): total, unique voters, Open/Closed, 30-day SVG polyline (720×220), and an option table with share at 1 decimal.
- Deleting a core-poll post does **not** delete its `cf_polls`/`cf_poll_votes` rows, which become orphans.

---

## 6. Form analytics (src/analytics/)

### 6.1 Enablement

`Tracker::is_enabled_for_form` (class-tracker.php:40-58):
- per-form `analytics_enabled` `'1'`/`'0'` overrides, otherwise global `enable_analytics` (default 1)
- then the filter `cf_should_track_analytics($enabled, $form)`, which is the consent hook
- The admin preview forces `analytics_enabled='0'` (views/form-preview.php:9).
- Assets: `assets/js/analytics.js` is enqueued when enabled (class-asset-requirements.php `analytics`).

### 6.2 Table `wp_cf_analytics` (class-tracker.php:284-307)

- `id` INT AI, `form_id` INT, `event_type` VARCHAR(30), `page_url` TEXT
- `utm_source`, `utm_medium`, `utm_campaign` VARCHAR(100) `''`
- `field_name` VARCHAR(100) `''`
- `meta` TEXT JSON|NULL, `ip_hash` VARCHAR(64), `created_at` TIMESTAMP (UTC)
- Indexes `(form_id, event_type)`, `(created_at)`, `(form_id, created_at)`

### 6.3 Event types

| Type | Source | Trigger |
|---|---|---|
| `view` | client | once per form instance when the IntersectionObserver fires (threshold 0) or on first focus |
| `start` | client | first `focusin` in the form (also forces `view`) |
| `field_interaction` | client | `blur` (capture) on `input/select/textarea` with a non-`_` name, **every blur**, with `field_name` |
| `abandon` | client | `beforeunload` when started and not submitted (`submit` event or `cf-success` marks submitted), sent with `sendBeacon(URLSearchParams)` |
| `submit` | server | `cf_form_success` priority 100 (all successful submissions, saved or not) |
| `spam` | server | `cf_form_response` with error `spam` |
| `blocked` | server | `cf_form_response` with any other non-empty error, `meta.reason`. Covers honeypot_missing/filled, recaptcha_*, turnstile_failed, math_captcha_failed, file_*, required_field_missing, invalid_email, field_too_long, payment_*, … Rate-limit, duplicate and availability refusals do **not** emit (no `cf_form_response`). |

### 6.4 Recording

`Tracker::record(form_id, type, meta)` (:126-163):
1. When `meta.event_id` is present: transient `cf_evt_` + `md5("{form}|{type}|{sanitize_key(event_id)}")`. If it exists, return 0 (dropped). Otherwise set it with TTL 300 s. The bundled client **never sends `event_id`**.
2. `page_url = meta.page_url ?: HTTP_REFERER` (`sanitize_text_field`). The UTM fields `utm_source`, `utm_medium` and `utm_campaign` come from **its query string** (`extract_utm_params`, :254-268). Server events therefore take UTM from the submit request's Referer, which is the form page.
3. Insert `{…, field_name: meta.field_name ?? '', meta: json(meta) | NULL, ip_hash, created_at: gmdate}`.

### 6.5 Client endpoint `cf_track_event`

`wp_ajax[_nopriv]_cf_track_event` (:200-247). There is no nonce.

- POST `form_id`, `event_type ∈ {view, start, abandon, field_interaction}`, `page_url`, `field_name?`, `event_id?`.
- Missing form or bad type: 400. Form missing: 404. Not enabled: 403.
- Throttle: transient `cf_track_` + `md5(ip_formId)`; `≥30` gives 429. Otherwise count+1 with TTL 60 s (sliding).
- Success: `{success:true}`.
- Client: `fetch` with `FormData`, except abandon, which uses `sendBeacon`. Fields: `action`, `form_id` (from `input[name=_cf_form_id]`), `event_type`, `page_url=location.href`, `field_name`.

### 6.6 Retention: cron `cf_cleanup_analytics`, daily (:77-111)

`DELETE WHERE created_at < now - apply_filters('cf_analytics_retention_days', 365) days`. A value `≤0` disables it.

### 6.7 Aggregations (src/analytics/class-dashboard.php)

- **Funnel** `get_funnel(form, from='', to='')` (:23-80):
  - `GROUP BY event_type` with `created_at ≥ '{from} 00:00:00'` and `≤ '{to} 23:59:59'` (UTC).
  - Mapping: `view→views`, `start→starts`, `submit→submissions`, `abandon→abandonments`, `spam→spam`. `blocked` and `field_interaction` are ignored.
  - `start_rate_capped = starts > views`
  - `start_rate = views>0 ? min(100, round(starts/views*100, 1)) : 0`
  - `completion_rate = starts>0 ? round(submissions/starts*100, 1) : 0` (can exceed 100)
  - `abandonment_rate = starts>0 ? round(abandonments/starts*100, 1) : 0`
  - `spam_rate = (submissions+spam)>0 ? round(spam/(submissions+spam)*100, 1) : 0`
  - Response key order: `views, starts, submissions, abandonments, spam, start_rate_capped, start_rate, completion_rate, abandonment_rate, spam_rate`.
- **Daily** `get_daily_stats(form, from, to)` (:90-104): `[{date:'Y-m-d', event_type, count:"n"(string)}]`, `GROUP BY DATE(created_at), event_type` ordered by date. All event types are included.
- **Field drop-off** (:114-127): all-time `field_interaction` `GROUP BY field_name` → `[{field_name, interactions:"n"}]` DESC. There is no date filter and no sequencing; it is only interaction counts.
- **Attribution** (:135-170), all-time, `submit` events only:
  - `utm_sources`: top 20 `GROUP BY utm_source, utm_medium, utm_campaign WHERE utm_source != ''` → `[{utm_source, utm_medium, utm_campaign, count}]`
  - `referrers`: top 20 by `referrer_domain` = `'direct'` when `page_url=''`, else the host of `page_url` (scheme stripped, cut at the first `/` then `?`; MySQL `SUBSTRING_INDEX`) → `[{referrer_domain, count}]`
  - These are the **form page's host**, not the external referrer. Replicate the behavior; label it "Source page host".
- **Spam trends** (:179-194): `spam` events since `gmdate('Y-m-d', -days)` 00:00 → `[{date, count}]`, default 30 days.
- **Recommendations** (:202-257), all-time funnel, evaluated in order:
  1. `views>50 && start_rate<10`: `{type:'visibility', severity:'warning', message:'Low engagement: only %s%% of viewers start the form. Consider making the form more prominent or reducing perceived effort.', value:start_rate}`
  2. `starts>20 && completion_rate<30`: `{type:'length', severity:'warning', message:'High abandonment: only %s%% of starters complete the form. Consider reducing the number of fields or using multi-step.', value}`
  3. `starts>20 && abandonment_rate>60`: `{type:'abandonment', severity:'critical', message:'Very high abandonment rate (%s%%). Enable save-and-resume or simplify the form.', value}`
  4. `(submissions+spam)>10 && spam_rate>30`: `{type:'spam', severity:'warning', message:'High spam rate (%s%%). Consider enabling Turnstile, reCAPTCHA, or the honeypot field.', value}`
  5. No recommendation and `submissions>10`: `{type:'healthy', severity:'info', message:'This form is performing well with a %s%% completion rate.', value:completion_rate}`
  - `message` is returned **unformatted**. The admin JS replaces only `%s`, so users see `%%` (WP bug). The port should format server-side with sprintf semantics.
- **Overview** `/analytics/overview`: up to 50 forms (`cf_get_forms(posts_per_page:50)`) filtered by team access and `cf_can_view_form_analytics` → `[{form_id, title, slug, views, submissions, completion_rate, spam_rate}]` (all-time funnel).

### 6.8 REST (src/analytics/class-rest-analytics.php), `cf/v1`, all GET

Permission: `edit_forms`. Per form: `TeamInbox::can_access(form_id)`, the form exists, filter `cf_can_view_form_analytics(true, id, form)`. Errors are 403 `rest_forbidden`, 400 `invalid_form`, 404 `not_found`.

| Route | Params |
|---|---|
| `/analytics/{form_id}/funnel` | `date_from?`, `date_to?` (Y-m-d) |
| `/analytics/{form_id}/daily` | `date_from`, `date_to` **required** |
| `/analytics/{form_id}/field-dropoff` | none |
| `/analytics/{form_id}/attribution` | none |
| `/analytics/{form_id}/spam-trends` | `days=30` |
| `/analytics/{form_id}/recommendations` | none |
| `/analytics/overview` | none |

### 6.9 Admin: per-form "Analytics" tab (views/tab-analytics.php)

- Range presets 7/30/90/365 days (default 30, UTC dates) plus From/To inputs.
- Cards:
  - **Funnel:** views, starts, submissions, spam, with hints for start rate (capped/unavailable text), completion rate and spam rate
  - **Daily activity:** SVG lines for views, starts and submissions
  - **Field interactions** table
  - **Top sources** table
  - **Recommendations** as WP notices (critical/warning use the warning style, ok/success the success style, everything else info)
- Fetches the REST endpoints with `X-WP-Nonce`.
- The per-form blocked counters `_cf_blocked_counts` have **no UI** in 4.11 (only meta and events). The Spam page lists `is_spam=1` rows (views/page-spam.php, limit 200).

---

## 7. Rehearsal (4.11; src/workflows/class-rehearsal.php)

`POST /cf/v1/forms/{id}/rehearsal`, permission `TeamInbox::can_access`. Body `{data:{…}, revision_id?}`. It uses the **draft** definition, or a revision applied over it.

`plan(form, data)` (:30-60), which is pure:
1. Intersect `data` with `cf_get_form_field_names` (normalized).
2. `cf_validate_submission_limits`.
3. `FieldCalculator::process`; failure gives `calculation_failed`.
4. `validate_fields` (no `cf_validate_form`, so no captcha, Akismet, schedule or file checks).
5. Per action, `outcome` is `would_run` when valid and `cf_evaluate_action_conditions` passes, else `would_skip`. Also:
   - `handler_available` (an action hook exists)
   - `destination`: the keys `to`, `email`, `recipient`, `recipients`, `url`, `webhook_url`, `chat_id`, `list_id`, `database_id`, `board_id` expanded with `cf_replace_data_variables`. URL keys are reduced to `scheme://host/…`.
6. Payment: `{provider, configured, amount_minor, currency}`. Errors are mapped to `payment_amount_invalid`.
7. Return `{availability: SubmissionPolicy::error(form), valid, error, data, actions, payment, notice:'Rehearsal only. Nothing was submitted, sent, subscribed, or charged. Spam services and provider responses require a separate live test.'}`.

Admin: a "Rehearse the complete saved form" `<details>` block on the Actions tab with a JSON textarea and a result `<pre>`. Form and revision previews also submit to rehearsal (core spec).

---

## 8. Endpoint inventory (this area)

| WP endpoint | Auth | Purpose |
|---|---|---|
| admin-ajax `cf_save_draft` | public (+nonce if enabled) | §1.3.2 |
| admin-ajax `cf_load_draft` | public | §1.3.3 |
| admin-ajax `cf_track_event` | public | §6.5 |
| admin-ajax `cf_poll_vote` | public + WP nonce | §5.4 |
| admin-ajax `cf_poll_results` (GET) | public | §5.5 |
| admin-post `cf_private_download` | form access | §3.1 |
| admin-post `cf_poll_duplicate`, `cf_poll_export_csv` | `edit_post(s)` + nonce | §5.8 |
| `_cf_admin_action=export_form_submissions` / `*_data_column` / `bulk_mark_submissions_as_(un)seen` / `toggle_submission_status` | form access + nonce | §3.2-3.5 |
| REST `cf/v1/polls*` | §5.6 | |
| REST `cf/v1/analytics/*` | §6.8 | |
| REST `cf/v1/forms/{id}/retention-preview` (GET), `/rehearsal` (POST) | form access | §4.9.2, §7 |
| WP privacy exporter/eraser `core-forms` | WP privacy tools | §4.9.1 |

---

## 9. Gap analysis vs EmDash port v0.1.0

| Area | WP 4.11.1 | v0.1.0 (plugins/core-forms) | Gap / action |
|---|---|---|---|
| Conditional visibility | data-show-if/hide-if/data-cf-conditions, client toggle, server strips inactive fields | none. `parseFields` is a flat regex scanner (src/core/markup.ts:39+) with no ancestry; `required` on a hidden field still fails (`validate.ts`) | **Breaks imported conditional forms** (required hidden fields reject). Needs a tree parser and the §1.1 algorithm, plus client JS. |
| Action conditions | 6 operators, AND | `FormAction` has no `conditions`; actions always run | Add `conditions` and the evaluator. |
| Calculations | server recompute, 422 on failure | none; posted totals stored verbatim | Add the parser (§1.2), a PHP `round`, and client JS. Security relevant for payment forms. |
| Drafts / partials | `cf_save_draft`/`cf_load_draft`, `draft` status, token, TTL cron | none; statuses `new/read/spam/trash` only | New routes, status, fields, cleanup job. |
| Multi-step | schema `layout` render plus client | none; no schema concept; export omits `_cf_form_schema` | Import the schema; render panels (§1.4); client JS. |
| Scheduling | date range (close 23:59:59 local), weekdays, daily/overnight window, IANA tz, closed HTML replaces form | `normalize.ts:45-74` collapses to two ISO instants with `Z` (UTC), close at 00:00 or the close time; drops days, window and tz; shows `form_closed` message, not `schedule_closed_message` | **Wrong semantics on import.** Store WP keys verbatim; implement `is_open` (§1.5). |
| Availability order | published, login, schedule, limit (403) | published, open, honeypot, **limit** | Reorder; add login. |
| Submission limit | counts non-spam non-draft + unsaved counter; lock; render message | `submissions.count({formId})` counts spam and trash; no lock; no render message | Fix the count, import `cf_unsaved_capacity_*`, CAS counter, render replacement. |
| Require login | render and submit | none | Needs visitor session in public routes (§10). |
| File uploads | full pipeline (§3.1) | files dropped (`routes.ts` `entriesFrom` keeps text only); route `maxBytes 1_000_000` | R2 storage, validation, descriptors, download route, retention, import of WP files. The body cap must allow at least 8 MB per file. |
| Honeypot | always on; any `_cf_h*`; default text | honors `enable_honeypot` (WP-inert); requires `_cf_h{id}`; uses the form's success text | Decide: always-on to match WP (recommended), or keep. |
| Rate limit | counted only for valid/spam; sliding 1 h; HTTP 200 + fixed text | counted before validation (fixed window); 429 + `rate_limited` | Align counting; keep the message key. |
| Duplicates | 1 h, scoped to user or IP, set after store, **error** `duplicate_submission` | 10 min, set before store, applies to unsaved forms, **success** reply | Align. |
| reCAPTCHA | site-wide when keys are set; errors `recaptcha_failed`/`recaptcha_low_score` (not stored) | per-form `captcha:'recaptcha'`; failure gives `spam` message, 400 | Import mapping (§10.6), separate error keys, token length check. |
| Turnstile | per-form `enable_turnstile`; `turnstile_failed`; stacks with reCAPTCHA | per-form `captcha:'turnstile'` (a key WP never has, so imports get `none`) | **Imported Turnstile forms lose protection.** Map `enable_turnstile`; allow stacking. |
| hCaptcha | third-party plugin only | native | Keep (EmDash-only). |
| Math captcha | per form | none | Implement (hardened HMAC). |
| Akismet | via Akismet plugin, `spam` = stored, success, no actions | none; no `is_spam` concept beyond the status | Add the REST call, `isSpam` semantics, global key, whitelist. |
| Blocked accounting | per-form `_cf_blocked_counts` (honeypot_missing/filled) plus `blocked` events with reason | global KV `stats:blocked:{honeypot,rateLimit,captcha,duplicate}` | Per-form counters; reason codes; analytics events. |
| Webhooks | flat JSON `data`; form-encoded `k[0]`; default `form`; auth header; HMAC signing; `X-CF-Event-Id`; SSRF guard; retries | JSON wraps `{form, submission, data}`; `k[]`; normalize defaults missing `content_type` to **json**; no auth, signing, SSRF guard or retry | **Breaks existing receivers.** Match the WP body and headers exactly. |
| Notifications | `_cf_unseen_submissions` | unread = status `new` | OK. Respect `enable_notifications` for badges. |
| CSV export | `submitted_at`, union of keys, ip/ua/referer, formula-safe | `submissionsToCsv` (core spec) | Verify column order and the files format. |
| Data management | hide, rename, delete column | none | Add admin routes. |
| Fullscreen | data attributes plus assets | none | Add settings, data attributes and client assets. |
| Polls | full feature (§5) | none | New collections, routes, component, admin. |
| Analytics | events, REST, tab, retention | none | New collection or rollups, routes, admin page. |
| GDPR | exporter/eraser by email | none | Admin routes or an EmDash privacy hook. |
| Retention / protected uploads | daily jobs, per-form days | none | Scheduled job needed. |
| Rehearsal | REST plan | none | Admin route reusing the pure pipeline (the port's `processSubmission` DI design suits this). |

---

## 10. EmDash porting notes

### 10.1 Storage collections (plugin storage; ids are strings, WP ids preserved)

- **`forms`** (existing): add the settings keys in §0.2 verbatim, plus `schema` (WP `_cf_form_schema`), `hiddenColumns`, `blockedCounts`, `unsavedCapacity` (from option `cf_unsaved_capacity_{id}`).
- **`submissions`** (existing): extend.
  - Status union: `new | read | replied | archived | draft | partial | pending_payment | paid | payment_failed | refunded`, plus the EmDash `spam`/`trash`.
  - Prefer WP's separate `isSpam` boolean (keep `status` for workflow; map the existing `status:'spam'` to `isSpam`).
  - New fields `draftToken?`, `currentStep`, `modifiedAt`.
  - New indexes `draftToken`, `["status","modifiedAt"]`, `["formId","isSpam","status"]`.
- **`polls`**: `{id (WP cf_polls.id), postId, slug (unique), title, postStatus, question, options[], settings{showResultsBeforeVote, voteLimit, honeypot, displayStyle, allowMultiple?}, type, allowOther, postCloseBehavior, redirectUrl, enableLiveResults, changeVoteWindow, status, startsAt, endsAt (ISO UTC), createdAt}`. Indexes `slug` (unique), `status`, `endsAt`.
- **`pollVotes`**: `{id, pollId, optionIndex, optionValue, ipAddress, userId, cookieHash, voterHash, referrer, votedAt}`. Indexes `pollId`, `["pollId","voterHash"]`, `["pollId","votedAt"]`.
- **`analyticsEvents`**: `{id, formId, eventType, pageUrl, pageHost (derived at write), utmSource, utmMedium, utmCampaign, fieldName, meta, ipHash, createdAt, day (YYYY-MM-DD UTC)}`. Indexes `["formId","eventType","day"]`, `["formId","createdAt"]`, `createdAt`.
- **`files`**: `{id, formId, submissionId?, field, r2Key, storedName, originalName, type, size, private, createdAt}`, replacing WP attachments and `_cf_*` attachment meta.

**Aggregation:** funnel and daily views need `GROUP BY`; polls need per-option counts and `COUNT DISTINCT`. If plugin storage offers only `query`/`count` with `where`, keep CAS-maintained rollup docs:
- `pollTallies/{pollId}` = `{counts:{idx:n}, total, uniques}`, updated on vote, change and delete
- `analyticsDaily/{formId}:{day}` = `{view, start, submit, abandon, spam, blocked:{reason:n}, fields:{name:n}, utm:{"s|m|c":n}, hosts:{host:n}}`

Raw events stay for retention and CSV. Flag for the platform agent: are aggregate queries or direct D1 SQL available to plugins?

### 10.2 KV keys

All IP keys are hashed (the port already hashes IPs, so keep that). Keep WP thresholds; sliding vs fixed windows is acceptable if documented.

- `rl:draft:{h(ip|formId)}`: 30/60 s, new drafts only
- `rl:track:{h(ip|formId)}`: 30/60 s
- `rl:poll:{h(ip)}`: 12/60 s, bumped on honeypot and success only
- `evt:{formId}:{type}:{eventId}`: 300 s
- `dup:{…}`: 3600 s, WP key semantics (§4.3)
- `rl:{h(ip|formId)}`: existing; align with §4.2
- `capacity:{formId}`: CAS counter or lease, replacing MySQL `GET_LOCK` for `submission_limit` races

### 10.3 Routes (`/_emdash/api/plugins/core-forms/…`)

Public:
- `drafts/save` (form-data or urlencoded, because the sendBeacon body is `application/x-www-form-urlencoded`)
- `drafts/load` (JSON `{token}`)
- `track` (urlencoded or form-data, beacon-safe; returns 204/JSON)
- `polls/vote` (form-data)
- `polls/results` (JSON `{pollId}`; also serves the REST `/results` shape)
- `polls/render` (JSON `{id|slug, mode}`) when rendered client-side
- `files/download` (GET with `id`; must check an **admin session** and form access; stream from R2 with `Content-Disposition: attachment`, `nosniff`)

Keep the WP response envelopes and error texts, because the client JS is ported 1:1. Drafts and polls use `{success, data:{…}}`; analytics returns arrays as described.

Admin:
- `polls/list|get|save|delete|duplicate|export|analytics`
- `analytics/funnel|daily|field-dropoff|attribution|spam-trends|recommendations|overview`
- `forms/rehearsal`, `forms/retention-preview`
- `submissions/columns` (hide, show, rename, delete)
- `privacy/export|erase {email}`
- `stats` (per-form blocked counts)

### 10.4 Astro components

- `<CorePoll id|slug mode>`: server-renders §5.3 markup and emits `cf_poll_voter` with `Astro.cookies` when missing. **Needs cookie write from a component, or the vote route must set it** (raw response `Set-Cookie`).
- `CoreForm` (existing):
  - closed, limit and login replacements (§1.5, §2)
  - multi-step render (§1.4)
  - captcha injection (Turnstile container and math captcha placement rules)
  - data flags `data-save-resume`, `data-partial-entries`, `data-calculations`, `data-smart-multistep`, `data-counters`
  - analytics script inclusion
  - fullscreen data attributes and assets
  - honeypot always
- The client scripts `smart-forms.js`, `analytics.js`, `poll-frontend.js`, `fullscreen.js` and `turnstile.js`/`recaptcha.js` are ported in the client spec. Point their `ajax_url`/actions at the routes above. Replace WP nonces with EmDash CSRF (`X-EmDash-Request`) or a signed per-render token. WP nonces also broke cached pages.

### 10.5 Admin React pages

- **Polls** (list and the 5-tab editor, analytics, CSV)
- **Form editor additions:**
  - Settings: save/resume, partial, expiry, schedule, limit, login, notifications, analytics mode, Turnstile/math toggles, retention and protected uploads, display/fullscreen
  - Messages: all keys in §0.2
  - Analytics tab (§6.9)
  - Rehearsal panel
- **Submissions:** draft badge, spam view, column menu, file links via the download route
- **Global settings** (settingsSchema): `enableAnalytics`, `akismetApiKey` (secret) and `akismetWhitelist`, `recaptchaMinScore` (WP filter default 0.5)

### 10.6 Import mapping (extend `wordpress/export-core-forms.php`, read-only)

- **Forms:** also export `_cf_form_schema`, `_cf_hidden_columns`, `_cf_blocked_counts`, `_cf_unseen_submissions`, option `cf_unsaved_capacity_{id}`, and the site timezone (`timezone_string`/`gmt_offset`). Write the site timezone into `schedule_timezone` when empty, because EmDash has no WP site tz.
- **Captcha:**
  - `enable_turnstile=1` maps to Turnstile.
  - If global `google_recaptcha` has both keys, **every** form gets reCAPTCHA, stacked with Turnstile when both apply. Model this either as a `captcha: Provider[]` setting or by keeping the WP flags plus a global `recaptchaAllForms`.
  - `enable_math_captcha` maps to the math captcha.
  - Keep the port's `captcha` key for hCaptcha only.
- **Tables:** `wp_cf_submissions` (all statuses including drafts; keep `draft_token`, `current_step`, `modified_at`, `is_spam`), `wp_cf_polls` plus `core-poll` posts (title, slug, post_status), `wp_cf_poll_votes`, `wp_cf_analytics`.
- **Files:** copy `uploads/core-forms/{slug}/*` and the private dir into R2. Rewrite descriptors' `url` to the download route; keep `name`, `original_name`, `type` and `size`; replace `dir`/`attachment_id` with the file id.
- **Global settings:** recaptcha and turnstile keys, `akismet_whitelist`, `enable_analytics`. The Akismet key is the WP option `wordpress_api_key`.

### 10.7 Platform needs (for the EmDash-capabilities agent)

1. **Scheduled jobs:**
   - daily `cleanup-drafts`
   - daily `cleanup-analytics`
   - daily `retention-cleanup` (entries and attachments)
   - optional hourly `poll-auto-close`
   - If there is no plugin cron, use a host Cron Trigger calling an admin route with a secret, or lazy probabilistic cleanup on writes.
2. **Private object storage (R2)** for uploads, with streaming download, size limits above 1 MB per request, and deletion. MIME sniffing in Workers (no `finfo`) needs a magic-byte library, which will diverge from libmagic on text types (§3.1 step 5).
3. **Visitor identity in public routes:** `require_user_logged_in`, poll `vote_limit=user`, `user_id` on votes, and the editor bypass for Akismet and math captcha (`edit_posts`).
4. **Cookie write** on public route responses and/or in Astro components (`cf_poll_voter`).
5. **Aggregate queries, or D1 access,** for analytics and polls (§10.1).
6. **Atomic counters or locks** for submission capacity.
7. **Client IP:** use `CF-Connecting-IP` (trusted on Workers) instead of `REMOTE_ADDR`. Akismet's header cascade collapses to it.
8. **Email:** the port's `email:send` has no attachments (WP never attached files either). File fields render as links (§3.1).
9. **`Intl` time zones** for scheduling (Workers ships full ICU).

---

## 11. Open questions and WP quirks to decide

1. **Honeypot setting:** WP ignores `enable_honeypot`. Match WP (always on) or honor the setting as v0.1.0 does?
2. **Calculation failure:** WP rejects on division by zero, unknown references and overflow (`1.0E+25`). Keep the strict behavior (recommended for payments)?
3. **Draft sanitization:** drafts strip newlines and tags (`sanitize_text_field`). Replicate it, or store raw and escape on output?
4. **Upload MIME rules:** CSV detected as `text/plain`, files without an extension, and docx sniffed as zip are all rejected in WP. Replicate, or broaden the map?
5. **Non-protected uploads:** they are public URLs in WP. Should EmDash serve all uploads privately (recommended), which changes email link behavior for recipients without admin access?
6. **Math captcha replay:** harden with HMAC + expiry (recommended; no data impact)?
7. **hCaptcha:** forms protected by the third-party hCaptcha plugin can't be detected from Core Forms data. Ask the site owner, or read the hCaptcha plugin options during export?
8. **Poll timestamps:** stored as UTC-interpreted wall time (§5.1). Import as UTC (recommended) or reinterpret in the site tz?
9. **Draft polls:** they render and accept votes (`post_status` is not checked). Replicate?
10. **Poll vote errors:** the "Other" empty-text error can leave partial rows. Fix by validating before writing (recommended)?
11. **Results privacy:** results are public via the API even when hidden before voting. Keep?
12. **Labels:** analytics "referrers" are form-page hosts, and recommendation `%%` renders literally. Fix the presentation (recommended) while keeping the data?
13. **Akismet:** port it as a direct REST integration with an API key in EmDash settings? This needs `rest.akismet.com` in network allowances.
14. **Dead code:** `ConditionEvaluator`, `DraftManager::finalize`/`cleanup`, and the `partial` status. Drop them, or keep for API parity?
15. **Rate limits:** sliding (WP transient) vs fixed (KV CAS) windows. Is a fixed window acceptable?
