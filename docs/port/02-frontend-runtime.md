# 02 · Front-end runtime, DOM contract, CSS, theme customizer and builder

Spec for porting everything Core Forms 4.11.1 runs in the browser, the stylesheets it ships, the Form Theme Customizer, and the admin builder surfaces (visual builder, code editor, preview, accessibility audit) to EmDash.

Path prefixes used below:

- `WP:` = `.reference/core-forms-wp/` (read-only WordPress plugin, 4.11.1)
- `PORT:` = `plugins/core-forms/` (EmDash port v0.1.0)

Line numbers refer to the readable sources (`*.js`, `*.css`). WordPress serves the `.min.*` siblings (`WP:src/class-assets.php:41-82`), which have identical behavior. Minified-only bundles are cited by a grep-able string.

---

## 0. Summary

**Where the runtime lives.** The front end is nine small IIFE scripts with no dependencies, no framework and no build step. Each is gated per form by a capability manifest (`WP:src/class-asset-requirements.php:24-83`):

- `forms.js` and `accessibility.js` always load.
- Everything else (smart forms, fullscreen, inline Stripe, analytics, CAPTCHA, polls) loads only when that form needs it.

**What an existing site depends on.** Its CSS and JS rely on four things:

- the form wrapper markup (`WP:src/class-form.php:85-117`)
- the schema-rendered field markup (`WP:src/schema/class-schema-renderer.php`)
- seven `cf-*` CustomEvents
- the `--cf-*` custom properties on `.cf-form`

**What admin produces.** It produces two artifacts per form:

- raw HTML markup (`post_content`)
- an optional JSON schema

The schema wins at render time (`WP:src/class-form.php:260-286`). The visual builder edits the schema; the code editor edits the HTML. Section 5 has the detail.

**Port status.** The v0.1.0 port covers about 15% of this surface: AJAX submit, messages, events and the two base stylesheets (with a specificity change). It has no conditional logic, URL prefill, global JS API, smart forms, fullscreen, payments UI, analytics, polls, theme customizer or visual builder (section 7).

---

## 1. Asset loading per capability

### 1.1 Handles

All front-end handles are registered in `WP:src/class-forms.php:108-170` and enqueued per form by `AssetRequirements::enqueue_for_form()` (`WP:src/class-asset-requirements.php:88-128`). That function is called from:

- the page-level detector at `wp_enqueue_scripts` priority 99 (`WP:src/class-forms.php:213-230`)
- every `Form::get_html()` call (`WP:src/class-form.php:143-145`), so programmatic renders also work

| Handle | File | Deps | Loaded when (`for_form()` key) |
|---|---|---|---|
| `core-forms` (JS) | `assets/js/forms.js` | none | always (`core`) |
| `core-forms-a11y` | `assets/js/accessibility.js` | `core-forms` | always (`accessibility`) |
| `core-forms-analytics` | `assets/js/analytics.js` | `core-forms` | `Tracker::is_enabled_for_form()`: per-form `analytics_enabled` `'1'`/`'0'` wins, else global `enable_analytics` (default **1**) (`WP:src/analytics/class-tracker.php:40-51`) |
| `core-forms-smart` (JS) | `assets/js/smart-forms.js` | `core-forms` | `has_schema` **or** any smart feature (`smart_script`, line 63) |
| `core-forms-smart` (CSS) | `assets/css/smart-forms.css` | `core-forms` CSS | smart feature **or** `data-resize` **or** `schedule_enabled` (`smart_style`, line 51) |
| `core-forms-multi-step` | `assets/css/multi-step.css` | `core-forms-smart` CSS | schema `layout.type` is `multi-step` or `conversational` (`MultiStep::is_multi_step`, step count not checked), or legacy markup containing `cf-step-panel`. `data-smart-multistep="1"` follows the same flag even when fewer than 2 steps render (then the JS no-ops). |
| `core-forms-fullscreen` (CSS+JS) | `fullscreen.css`, `fullscreen.js` | JS: `core-forms` | `settings.display_mode === 'fullscreen'` |
| `core-forms-inline-payments` | `assets/js/inline-payments.js` | `stripe-js` (`https://js.stripe.com/v3/`) | `payment_enabled && payment_provider==='stripe' && payment_flow==='inline'` |
| `core-forms` (CSS) | `assets/css/forms.css` | none | `should_load_stylesheet()`: per-form `load_stylesheet` `'1'`/`'0'` wins, else global (default **0**) |
| `core-forms-theme` | `assets/css/form-theme.css` | **`core-forms` CSS** | `should_load_theme()`: per-form `load_form_theme` wins, else global (default **1**) |
| `core-forms-theme-custom` | `uploads/core-forms/form-theme-custom.css` | `core-forms-theme` | registered only when `cf_form_theme_tokens` is non-empty; enqueued with the theme |
| `core-forms-standalone` | `assets/css/standalone.css` | `core-forms` CSS | standalone route only (`WP:src/class-standalone-routes.php:249-255`) |
| `core-forms-recaptcha` | `assets/js/recaptcha.js` (min-only source) | `google-recaptcha-v3` (`api.js?render={site_key}`), `core-forms` | reCAPTCHA configured; enqueued from the `cf_form_html` filter (`WP:src/admin/class-recaptcha.php:75,95-120`) |
| `core-forms-turnstile` | `assets/js/turnstile.js` | `cloudflare-turnstile` (`api.js?render=explicit`), `core-forms` | Turnstile enabled for the form (`WP:src/admin/class-turnstile.php:86,108-133`) |
| `core-forms-poll` (CSS+JS) | `poll-frontend.css`, `poll-frontend.js` | none | a poll renders (`WP:src/polls/class-poll-frontend.php:780-815`) |
| `core-forms-license-frontend` | `license-frontend.css/js` | `dashicons` | license commerce pages (`WP:src/licensing/class-license-commerce.php:698-701`) |

**Hidden consequence of the CSS dependency chain.** `core-forms-theme`, `core-forms-smart` (CSS) and `core-forms-standalone` all depend on `core-forms` (`forms.css`). So with the default settings (theme on, stylesheet off), `forms.css` **is** printed as a dependency. The global "load stylesheet" setting only matters when the theme is off. The effective matrix:

| Theme | Stylesheet | Smart CSS needed | CSS printed |
|---|---|---|---|
| on | any | any | `forms.css` + `form-theme.css` (+ custom tokens) |
| off | on | any | `forms.css` |
| off | off | yes | `forms.css` (as dependency) + `smart-forms.css` |
| off | off | no | none |

The block's `loadStylesheet:"0"` dequeue (`WP:render.php:84-89`) therefore does not remove `forms.css` when the theme is on.

**Unused-page guard.** `dequeue_form_assets_when_unused()` (`WP:src/class-forms.php:232-249`) strips the runtime from pages without a form.

**Block-editor canvas.** `forms.css`, `form-theme.css` and the custom tokens load in the editor canvas (`WP:src/class-forms.php:201-211`).

### 1.2 Localized globals (PHP to JS)

| Global | Set by | Shape |
|---|---|---|
| `window.cf_js_vars` | `WP:src/class-forms.php:112-118` | `{ ajax_url }`, default `admin-ajax.php`, filterable via `cf_frontend_ajax_url` |
| `window.cf_recaptcha` | `WP:src/admin/class-recaptcha.php:116` | `{ site_key }` |
| `window.cf_turnstile` | `WP:src/admin/class-turnstile.php:132` | `{ site_key }` |
| `window.cf_poll` | `WP:src/polls/class-poll-frontend.php:801-812` | `{ ajax_url, strings:{error,loading,vote,update,no_choice,thanks,change}, live_poll_ms:15000 }` |
| `window.cfLicensePortal` | `WP:src/licensing/class-license-commerce.php:701` | `{ copied, copy, reveal, hide }` |

### 1.3 Form flags consumed by JS

`AssetRequirements::data_attributes()` (`WP:src/class-asset-requirements.php:178-189`) always emits six attributes, each `'0'` or `'1'`:

- `data-ajax-submit`
- `data-smart-multistep`
- `data-save-resume`
- `data-partial-entries`
- `data-calculations`
- `data-counters`

`smart-forms.js` gates each module on `form.dataset[x] === '1'` (`WP:assets/js/smart-forms.js:23-25`). So the script can load for inline validation alone while the advanced modules stay off.

Detection for schema forms:

- calculations: `attributes.calculation` or `attributes['data-calculation']` on any field
- counters: the `data-counter` key is present
- resize: `data-resize`

Legacy (non-schema) forms are detected by `strpos` on the markup (`WP:src/class-asset-requirements.php:34-47`).

---

## 2. Front-end runtime modules

### 2.1 `forms.js`: core (425 lines; 6,147 B min, 2,235 B br)

Initialization is a synchronous IIFE in the footer (`WP:assets/js/forms.js:1-425`). At script execution it calls `prefillFromUrl()` and then `refreshConditionals()` (lines 423-424). It does **not** wait for `DOMContentLoaded`. All handlers are delegated on `document`, so forms injected later work. The `swup:contentReplaced` listener re-runs prefill and conditionals for Swup page transitions (lines 417-420).

**Listeners.**

| Event (on `document`) | Phase | Action | Lines |
|---|---|---|---|
| `submit` | bubble | If `form.cf-form` and `dataset.ajaxSubmit !== '0'`: `preventDefault()`, then `submit(form, event.submitter)`. A missing attribute counts as AJAX. | 389-395 |
| `click`, `keyup`, `change` | bubble | If the target is a control of a `.cf-form`: `refreshConditionals(form, target)`. If inside `[data-cf-required-group]` with any checked input, clear `setCustomValidity` on all its inputs. | 397-413 |
| `cf-refresh` | bubble | `refreshConditionals()` for the whole document | 415 |
| `cf-calculated` | bubble | `refreshConditionals(event.target)` | 416 |
| `swup:contentReplaced` | bubble | prefill + conditionals | 417-420 |

#### Conditional logic engine (lines 36-167)

Targets: every `.cf-form [data-show-if], .cf-form [data-hide-if], .cf-form [data-cf-conditions]`.

**Rule sources.**

- `data-cf-conditions` holds a JSON array of `{action:'show'|'hide', rule:string}`. The schema renderer emits it when a field has 2 or more conditions (`WP:src/schema/class-schema-renderer.php:288-295`).
- Otherwise `data-show-if` and `data-hide-if` are read. Both may be present; each becomes one rule.
- All rules are ANDed with `every()` (line 103).

**Rule grammar.**

- The field name runs up to the first `:` or `=`, trimmed, with a trailing `[]` stripped.
- The expected list is the rest, split on `|`. If there is no separator, expected is `['*']`.
- A rule matches when any current value is in the expected list, or when `*` is expected and the value is non-empty.
- `hide` negates the match.

The structured operator format (`=`, `!=`, `>`, `contains`, `in`… with `match:all|any`) from `docs/smart-forms/conditional-logic.md` is **server-only** (`ConditionEvaluator`). The browser never evaluates it. Port the client grammar exactly as above.

**Values** (`getControlValues`, 36-76):

- Query `[name="X"], [name="X[]"]`, using `CSS.escape` when available.
- Skip disabled controls and unchecked radios or checkboxes.
- For `<select multiple>`, take all selected options.
- Buttons count too. When a `button`/`submit` named X is the event target, its value is remembered in `form.dataset[X]`, which writes a `data-X` attribute on the form. This lets a rule depend on which button was clicked.
- If nothing is found, the value list is `['']`.

**Applying a result** (lines 119-151):

- The target is the element itself. If the element is a bare control, the target is its closest `[data-cf-field]` (or itself).
- If any ancestor of the target has the `[hidden]` attribute, the target is forced hidden. Nested conditionals cascade this way.
- Hidden: set `target.hidden = true` and `style.display = 'none'`. Every descendant control with `required` gets `data-was-required="true"` and loses `required`. Every enabled one gets `data-cf-conditional-disabled="true"` and `disabled`.
- Shown: the reverse. Only flags this engine set are restored, so author-disabled controls stay disabled.

**Fixpoint.** `refreshConditionals` iterates passes until nothing changes, capped at `min(elements+1, 20)` passes (lines 153-167). Chains (A drives B drives C) settle in one call.

Disabled controls are excluded from `FormData`, so hidden fields are not submitted. `submit()` also appends `_was_required[]=<name>` for each `[data-was-required="true"]` (lines 328-332). The server uses this to relax required checks.

#### URL prefill (lines 188-244)

Every query parameter fills every `form.cf-form`, except keys starting with `_`, `action` and `cf_response`.

- A key ending in `[]` is collected as an array, with `[]` stripped from the lookup key.
- Lookup is `form.elements.namedItem(key)`. So a checkbox group named `colors[]` is reached with `?colors[][]=red`, and `?colors[]=red` targets a control literally named `colors`.

`setControlValue`:

- radio and checkbox: `checked` if the value is in the list
- `select-multiple`: per-option `selected`
- `date`: `new Date(v)` reformatted to `YYYY-MM-DD`
- anything else: the first value

It then dispatches a bubbling `change` for checked choices and for all non-choice inputs, so conditionals and calculations react.

The port has an unrelated server-side token, `{{url_params.x}}`. That is separate from this client prefill.

#### Required checkbox groups (lines 168-186)

Applies to `[data-cf-required-group="true"]` (emitted for required checkbox fields, `schema-renderer.php:205-210`). If no enabled checkbox is checked, the first one gets `setCustomValidity('Please select at least one option.')`.

#### Submit flow: `submit(form, submitter)` (lines 312-387)

1. Return if the element is not a `form.cf-form`.
2. Run `validateRequiredGroups()`, then `form.reportValidity()`. On failure, stop. Native bubbles show; `accessibility.js` decorates them. AJAX forms carry `novalidate` (`class-form.php:74`), so this is the only native validation.
3. `clearMessages()` removes **every** `.cf-message` in the form, including the server-rendered no-JS response.
4. Fire `cf-submit` with `detail:{}`.
5. Build `FormData(form)`. Append `submitter.name=value` if it has a name. Append `_was_required[]`.
6. `createLoader(form).start()`. Its target is the **first** `input[type=submit], button[type=submit]` only. It adds the `.cf-loading` class and `aria-busy="true"` to the form, freezes the button width to its computed width, and sets `disabled`. The button label becomes `button.dataset.loadingText || 'Submitting…'`: an input's `value` is replaced, a button's `textContent` is replaced and its original `innerHTML` is saved. The per-form `loading_text` setting exists (`WP:src/functions.php:171`, `views/tab-settings.php:386-388`) but is **never rendered** into `data-loading-text`. Only author-written button attributes take effect.
7. `XMLHttpRequest` POSTs to `cf_js_vars.ajax_url` (fallback `location.href`) with header `X-Requested-With: XMLHttpRequest`.
8. On `DONE`: `loader.stop()` restores the label (via `innerHTML`), width and original `disabled`. The response is parsed as JSON. On a parse failure it becomes `{error:true, message:{type:'error', text:'The form could not be submitted. Please try again.'}}`. HTTP status <200 or ≥400 forces `error:true`.
9. Fire `cf-submitted` with `{response}`, then `cf-success` or `cf-error` with `{response}`.
10. `showMessage(form, response.message)` creates `<p class="cf-message cf-message-{error|success}" role="alert">`. Its content uses **`innerHTML`**, because message HTML (links, `<strong>`) is allowed. It is appended to `.cf-messages` (or the form), then `cf-message` fires with `{message}`. A `message.type` of `warning` renders as `cf-message-success`.
11. If `response.hide_form`: `.cf-fields-wrap` gets `hidden` and `display:none`.
12. If `response.redirect_url`: `location.assign()` and return.
13. If there is no error: `form.reset()`, then `refreshConditionals(form)`.

The **response contract** (server: `WP:src/class-forms.php:645-675, 1248-1276`) is `{ error?: true, message: {type:'success'|'error', text: html}, hide_form?: bool, redirect_url?: string, payment?: {provider, mode, flow?, payment_id?, client_secret?, publishable_key?, return_url?} }`. `respond()` adds `error:true` whenever `message.type==='error'`.

#### Events (complete list)

| Event | Target | Bubbles | `detail` | Fired by |
|---|---|---|---|---|
| `cf-submit` | form | yes | `{}` | forms.js:322 |
| `cf-submitted` | form | yes | `{response}` | forms.js:366 |
| `cf-success` / `cf-error` | form | yes | `{response}` | forms.js:367 |
| `cf-message` | form | yes | `{message}` | forms.js:309 |
| `cf-calculated` | form | yes | none | smart-forms.js:594 |
| `cf-success` (fullscreen) | original form | **no** | none | fullscreen.js:685 |
| `cf-refresh` | document (listened) | n/a | n/a | external, re-runs conditionals |
| `cf_form_reset` | document (listened) | n/a | `{formId}` | external, resets Turnstile (turnstile.js:117-121). Nothing in core dispatches it. |

None of these events is cancelable. Events from `forms.js` go through `trigger()` (lines 6-16). It first dispatches the DOM event, then calls listeners registered through the JS API as `listener(form, detail)`.

#### Global API

`window.core_forms = window.core_forms || { on(name, fn), off(name, fn), submit(form, submitter?) }` (line 422). Event names passed to `on()` omit the `cf-` prefix (`'success'`, `'error'`, `'submit'`…). An existing `window.core_forms` (for example the admin `FieldBuilder` namespace) is not overwritten.

### 2.2 `accessibility.js`: always loaded (256 lines; 3,888 B min)

This is the front-end a11y layer, not the admin audit (that is section 5.4). All listeners are delegated on `document`.

| Behavior | Lines | Detail |
|---|---|---|
| Focus the newest message | 12-29 | On `cf-message`, `.cf-messages .cf-message:last-child` gets `tabindex=-1` and `focus()`. The tabindex is removed after 100 ms. |
| "Touched" gating | 44-66 | `input` or `change` sets `data-cf-touched="1"` on the control. A capture-phase `submit` marks every control touched. |
| Native `invalid` decoration | 68-94 | Capture phase. Only for touched controls. Sets `aria-invalid="true"`. Reuses `parentElement > .cf-field-error` or creates `<span class="cf-field-error" id="{id or name}_error" role="alert" style="display:block;color:#d63638;font-size:0.9em;margin-top:0.25em;">` with the text `validationMessage \|\| 'This field is required.'`. **Replaces** `aria-describedby` with the error id, which loses any existing description. |
| Clear on input | 97-108 | Removes `aria-invalid` and the sibling `.cf-field-error`. |
| Submit button busy | 114-135 | `cf-submit`: the first `[type=submit]` gets `aria-busy` and `disabled`. `cf-submitted`: both removed. |
| Conditional tab order | 141-165 | **Only on `cf-refresh`**: controls inside `[data-show-if],[data-hide-if]` with `style.display==='none'` get `tabindex=-1` and `aria-hidden=true`; otherwise those are removed. Redundant, because hidden controls are already `disabled`. |
| Skip link | 170-205 | Forms with more than 10 controls get `<a href="#" class="cf-skip-link">Skip to submit button</a>`, positioned off-screen until focused. **Dead code in practice**: the `DOMContentLoaded` listener is registered while `DOMContentLoaded` is already dispatching (or has fired), so it never runs. Decide whether to port it as a no-op or make it work deliberately. |
| Assertive announce | 210-236 | On `cf-success` or `cf-error`, `.cf-messages` switches to `aria-live="assertive"` and back to `polite` after 1 s. |

### 2.3 `smart-forms.js` (714 lines; 10,564 B min, 3,311 B br)

`init()` runs on `DOMContentLoaded` (lines 695-713). For every `.cf-form`:

- if `data-smart-multistep="1"`: `initMultiStep`
- always: `initInlineValidation`
- `initAutoSave`, `initResumeFromUrl`, `initPartialTracking`, `initCalculations` and `initCharacterCounter` each run but self-gate on their flag

Per-form state lives in a `WeakMap`: `{hasInteracted, draftTimeout}` (lines 13-21).

**Multi-step** (lines 29-142). This runs only with 2 or more `.cf-step-panel`. It reads:

- `.cf-step` indicator buttons
- `.cf-progress`, `.cf-progress__bar`, `.cf-progress__text`
- `input[name="_cf_current_step"]`, whose value is the start index

`goToStep(i, skipValidation)`:

- Moving forward validates the current panel with `validateStep()`.
- Panels toggle with `style.display`.
- Indicators get `is-active` (current) and `is-completed` (`i < index`). Indicator buttons are `disabled` when `i > index`. The current one gets `aria-current="step"`.
- Progress: bar `width = round((i+1)/n*100)%`, text `"{i+1} / {n}"`, `aria-valuenow = i+1`.
- `_cf_current_step` is updated.
- If the user has interacted and save/resume or partial entries is on, `saveDraft()` runs.
- `form.scrollIntoView({behavior:'smooth', block:'start'})`.
- The first enabled control in the panel is focused with `preventScroll`.

Bindings:

- `form._cfGoToStep` is exposed.
- `reset` goes to step 0 without validation.
- `Enter` in a non-button input advances instead of submitting, except on the last step (line 111).
- `.cf-step-next` / `.cf-step-prev` clicks go to `data-step`.
- Indicator clicks are allowed only to steps ≤ the current step.

**Step validation** (lines 146-223) covers non-hidden, non-button controls that are not disabled. Errors are added in this order:

- required checkbox or radio with nothing checked in the panel's same-name group
- required control with empty `value.trim()`
- `type=email` failing `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, comma-split when `multiple`
- `!checkValidity()`, which uses `validationMessage`

Then required checkbox groups. The required message is `data-error-required` or `'This field is required.'`. If anything failed, the first `[aria-invalid="true"]` is focused and the first `.cf-field-error`'s closest `p, fieldset, div` is scrolled into view.

**Inline validation** (lines 227-281) uses a capture-phase `blur` on the form with the same checks. Radio and checkbox groups are checked across the whole form.

**Field errors** (lines 283-325):

- `showFieldError` adds `.cf-invalid` and `aria-invalid="true"`, then appends `<span class="cf-field-error" id="{id}-error" role="alert">` (random `cf-err-xxx` if there is no id) to `input.parentNode`. It **appends** the id to `aria-describedby`, unlike `accessibility.js`, which replaces it. The two modules use different error id suffixes: `-error` here, `_error` there.
- `clearFieldError` removes only `aria-describedby` tokens that point at a `.cf-field-error`.

**Save & resume / partial entries** (lines 335-504):

- `saveDraft`:
  - Uses `FormData(form)` with `action=cf_save_draft`, `_cf_draft_token` (hidden input created on demand) and `_cf_current_step`.
  - POSTs with `fetch` to `ajax_url`.
  - Reads `res.data.draft_token` back.
  - The server returns `{draft_token, resume_url}` (`WP:src/smart-forms/class-draft-manager.php:366-368`). The client **ignores `resume_url`**: there is no save button, link or `.cf-draft-saved` UI, although the CSS class exists (`smart-forms.css:183-192`).
- Autosave: `input` sets `hasInteracted` and debounces `saveDraft` by **5,000 ms** per form.
- Resume:
  - Triggered by `?cf_resume=<64 hex>` when `data-save-resume="1"`.
  - POSTs `action=cf_load_draft`.
  - The response `{form_id, data, current_step, draft_token}` (`class-draft-manager.php:406-411`) is applied only when `form_id` matches.
  - Values are written raw by `[name="x"], [name="x[]"]` without `CSS.escape`, and **no `change` or `input` events** are dispatched, so conditionals and calculations stay stale until the next interaction.
  - It then jumps to `current_step`.
- Partial entries: on `beforeunload`, only if the user has interacted **and** a token already exists, `sendBeacon` posts a `URLSearchParams` of the string fields plus `_cf_current_step`, `action`, the token, `_cf_form_id` and `_wpnonce`.

**Calculations** (lines 508-641) require `data-calculations="1"` and at least one `[data-calculation]`. `recalculate()` runs on `input`, `change`, `reset` (deferred) and at init, and is guarded against re-entry.

- Controls are grouped by base name, which is `name.split('[')[0]`.
- `resolve(name)` evaluates depth-first, memoized, with cycle detection.
- `active(control)` walks ancestors up to the form. A control is inactive if it is author-disabled (not engine-disabled), or if any ancestor's show/hide rules evaluate false **using resolved values**. This is a re-implementation of the forms.js grammar, so visibility and totals are computed consistently in a single pass.
- An inactive calculated field gets `''`.
- A non-calculated name yields the checked or selected values: an array when the name has `[` or the control is `multiple`, otherwise the first value or `''`.
- Any error (unknown `{ref}`, cycle, invalid expression) clears **all** calculated fields and sets `setCustomValidity('This total could not be calculated.')`, which blocks submit.
- After each pass, `cf-calculated` fires (bubbling). `forms.js` re-runs conditionals on it.

Expression evaluation:

- `{name}` (`[a-zA-Z0-9_-]+`) is replaced with `Number(value||0)`. Arrays and non-finite values become 0.
- After the words `round|ceil|floor|min|max|abs|Math` are deleted, only `[0-9+\-*/().,\s]` may remain. So `Math.round(...)` also passes.
- Evaluation is `new Function('round','ceil','floor','min','max','abs', 'return (expr)')`.
- `round(n, p)` accepts integer `|p| ≤ 10` and rounds half away from zero with an EPSILON correction.
- The result must be finite.
- The computed value is written to `field.value` as `String(value)`, with no number formatting.

**Character counter** (lines 645-680) requires `data-counters="1"`. Each `[data-counter]` field gets `<span class="cf-char-counter" aria-live="polite">` inserted after it:

- with a positive `maxlength`: text `"{len} / {max}"`, plus `.cf-char-counter--limit` when `len ≥ max`
- otherwise: `"{n} character(s)"`

It updates on `input` only, so it goes stale after `form.reset()`. It is guarded by `field._cfCounter`.

### 2.4 `fullscreen.js`: conversational overlay (751 lines; 18,698 B min, 4,100 B br)

**Init.** `document.querySelectorAll('.cf-form[data-display-mode="fullscreen"]')` runs on DOM ready (lines 729-746). Options come from these attributes, added by `WP:extensions/fullscreen-forms/src/class-frontend.php:44-70`:

- `data-fullscreen-theme`: `light` (default) | `dark` | `gradient-blue` | `gradient-purple` | `gradient-green`
- `data-fullscreen-animation`: `slide` (default) | `fade` | `scale`
- `data-fullscreen-show-progress`: anything except `'0'` shows progress

The form also gets the class `cf-form-fullscreen`. Fullscreen is refused (no attributes added) when the form has `payment_enabled` or a multi-step schema (`is_supported()`, lines 28-42). `window.CFFullscreenForm` is the class, for manual init (line 749).

**Question parsing** (lines 46-99):

- Inputs inside `.cf-fields-wrap`, excluding `hidden`, `submit` and `button`, are grouped **by name** after stripping `[]` and skipping names starting with `_`. This is the 4.9 behavior; previously grouping was by container.
- The container is the closest `fieldset` for multi-input groups, otherwise the closest `p, div, fieldset, section` inside the wrap.
- The label comes from the first match of: a fieldset `legend`; `label[for=id]` (non-choice fields); a standalone label in the container that does not wrap an input; a previous sibling `label` or `legend`; the placeholder; the name with `_`/`-` turned into spaces. Trailing `*`s are stripped.
- The description is `.description, .cf-description, small` in the container.
- Types are `textarea`, `select`, `radio`, `checkboxes` (more than one checkbox), `checkbox`, or the input's `type`.
- `required` means any input has `required` or `data-was-required`.

Conditionally hidden and disabled controls still become questions. Conditional logic is **not** evaluated in fullscreen mode.

**Overlay DOM** (lines 198-293). It is appended to `body`, with `body.style.overflow='hidden'`. The source form gets `.cf-form-fullscreen-source`, which CSS sets to `display:none !important`.

```
div.cf-fullscreen-overlay.cf-theme-{theme}.cf-animation-{animation}[role=dialog][aria-modal=true][aria-label=form aria-label|'Form']
  div.cf-fs-header
    div.cf-fs-progress > div.cf-fs-progress-bar > div.cf-fs-progress-fill[style=width:0%]
                       + div.cf-fs-progress-text > span.cf-fs-progress-current + " / " + span.cf-fs-progress-total
    (or <div></div> when progress is off)
    button.cf-fs-close[aria-label="Close form"]          (omitted when body[data-cf-standalone])
  div.cf-fs-questions
    div.cf-fs-question[data-step=i][data-name=name]   (×N)
      div.cf-fs-question-header > span.cf-fs-question-number + span.cf-fs-question-label (+ span.cf-fs-question-required "*")
      div.cf-fs-question-description?
      div.cf-fs-input-wrap > (control, see below) (+ div.cf-fs-error)
      div.cf-fs-actions > button.cf-fs-btn-back? + (button.cf-fs-btn-submit | button.cf-fs-btn-next "OK" + span.cf-fs-keyboard-hint "press Enter ↵")
    div.cf-fs-question.cf-fs-success-slide[data-step=success] > div.cf-fs-success > div.cf-fs-success-icon + h2.cf-fs-success-title "Thank you!" + p.cf-fs-success-message
  div.cf-fs-footer > div.cf-fs-nav-arrows > button.cf-fs-nav-btn.cf-fs-nav-up[disabled] + button.cf-fs-nav-btn.cf-fs-nav-down
  div.cf-fs-live[aria-live=polite][aria-atomic=true] (inline off-screen; created on first announce)
```

Overlay controls are **new elements outside the `<form>`** (lines 295-358):

- `textarea.cf-fs-textarea`, `select.cf-fs-select`, `input.cf-fs-input[type=…]` (copies `placeholder` and `pattern`, without escaping)
- choices: `div.cf-fs-options > label.cf-fs-option[data-type=radio|checkbox][data-value]` containing `input`, `span.cf-fs-option-indicator`, `span.cf-fs-option-text` and `span.cf-fs-option-key` (letters A, B, C…)
- checkbox groups are named `name[]`

**Behavior** (lines 379-597):

- **Choices.** Clicking a radio option sets `.cf-fs-selected` and auto-advances after 300 ms unless it is the last question. Clicking a checkbox toggles it and `.cf-fs-selected`.
- **Keyboard:**
  - `Enter` without Shift, outside a textarea: next question, or submit on the last
  - `Ctrl+↑` / `Ctrl+↓`: previous / next
  - `Esc`: close (not on standalone pages)
  - a letter key: clicks the Nth option of the current question
- **`showStep`:**
  - Every question gets `aria-hidden="true"`.
  - The active one gets `.cf-fs-active` and `aria-current="step"`; the previous one gets `.cf-fs-exit-up` or `.cf-fs-exit-down`.
  - The first control is focused in a `requestAnimationFrame`.
  - The live region says `"Step {n} of {total}: {label}"`.
  - The progress fill and current number update; the nav arrows are disabled at the ends.
- **Validation:**
  - `checkValidity()` on the step's controls. The message is `validationMessage || 'This field is required'`.
  - Required radio and checkbox groups need a checked box, else `'Please select an option'`.
  - Errors render as `div.cf-fs-error`.
- **Submit** (lines 599-695) does not go through `forms.js`:
  - `FormData(original form)` loses every non-underscore name owned by the overlay. Overlay values are re-added: checked choices, files, multi-select, text.
  - It sets `_cf_form_id`, `action=cf_form_submit`, an empty honeypot `_cf_h*` and `_wpnonce`, then `fetch`es with `X-Requested-With`.
  - Error: the message renders in the current step's `.cf-fs-error` and the button is restored.
  - Success: the success text is set via `textContent` (default `form.dataset.messageSuccess`), the success slide shows, and `redirect_url` is followed after **1,500 ms**. A **non-bubbling** `cf-success` without `detail` is dispatched on the source form.
  - **Not fired:** `cf-submit`, `cf-submitted`, `cf-error`, `cf-message`, and the `core_forms.on` listeners.
  - While submitting, the button shows `<span class="cf-fs-loading"><span class="cf-fs-spinner"></span> Submitting...</span>`.

### 2.5 `inline-payments.js`: Stripe Payment Element (111 lines; 2,002 B min)

1. A **capture-phase** `submit` listener on `document` (line 110) matches `.cf-form[data-cf-payment-provider="stripe"][data-cf-payment-flow="inline"]`. The attributes come from `WP:src/payments/class-payments.php:75-81`. If `dataset.cfInlineReady !== '1'`, it calls `preventDefault()` and `stopImmediatePropagation()`. That means `forms.js`, the reCAPTCHA hook and all `cf-*` events are skipped.
2. It disables `[type=submit]` and `fetch`es the `FormData` (credentials `same-origin`, `X-Requested-With`).
3. It expects `data.payment.flow === 'inline'` and `window.Stripe`. `payment` carries `{provider:'stripe', flow:'inline', mode, payment_id, client_secret, publishable_key, return_url}` (`WP:src/class-forms.php:1053-1062`, `payments/class-stripe.php:70-75`).
4. It appends `<div class="cf-inline-payment"><div class="cf-inline-payment__element"></div><button type="button" class="cf-inline-payment__confirm">Pay securely</button><p class="cf-inline-payment__error" role="alert"></p></div>` to `.cf-fields-wrap`.
5. It runs `Stripe(publishable_key).elements({clientSecret}).create('payment').mount(...)` and sets `data-cf-inline-ready="1"`.
6. The confirm button calls `stripe.confirmPayment({elements, confirmParams:{return_url}})`. Errors go to `.cf-inline-payment__error`.
7. Messages are written with `textContent` into a `.cf-messages` region that is **cleared** first (lines 4-12).

Quirk: once `cfInlineReady` is set, another submit falls through to `forms.js`, which posts a second submission. The hosted flow has no client code; `forms.js` follows `redirect_url`.

Payment product picker markup is server-rendered (`WP:src/payments/class-payments.php:88-95`): `p.cf-payment-product > label[for=cf-payment-product-{id}] + select#cf-payment-product-{id}[name=cf_payment_product][required]`.

### 2.6 CAPTCHA clients

**reCAPTCHA v3** (`WP:assets/js/recaptcha.js`, only a minified source ships):

- It waits for `grecaptcha` (polling every 100 ms) and then `grecaptcha.ready`.
- For each `.cf-form` it adds a **capture** `submit` handler on the form. If there is no token yet, it calls `preventDefault()` and `stopImmediatePropagation()`, then `grecaptcha.execute(site_key, {action:'core_forms_submit'})`.
- On success it writes a hidden `g-recaptcha-response`.
- On failure it writes a hidden `g-recaptcha-failed=1`.
- Either way it removes itself and re-submits by `submitBtn.click()` (or by dispatching `submit`), then re-attaches after 100 ms.
- On `cf-error` it clears the token and failure flag.
- State lives on `form._recaptchaProcessing`, `form._recaptchaFailed` and `form._recaptchaHandler`.

The server markup injection is only an HTML comment (`class-recaptcha.php:137-141`).

**Turnstile** (`WP:assets/js/turnstile.js`):

- Markup is `<div class="cf-turnstile-container" data-sitekey data-form-id>`. It is inserted before the first submit control, or appended (`class-turnstile.php:153-179`).
- It uses explicit `turnstile.render`, with `data-rendered="true"` as a guard.
- Success writes a hidden `cf-turnstile-response`. Error writes `cf-turnstile-failed=1`. Expiry resets the widget.
- `window.cf_turnstile_reset(formId)` and the `cf_form_reset` event both reset it.

**Math CAPTCHA** is server markup only (`WP:src/admin/class-math-captcha.php:111-119`): `div.cf-math-captcha[role=group]` with a label, `input[type=number][name=cf_math_captcha_answer][inputmode=numeric]`, `span.cf-field-description` and a hidden `cf_math_captcha_hash`.

**hCaptcha** has no client code in WP; it only adds ignore-list entries (`class-hcaptcha.php`). The port's native hCaptcha is new.

### 2.7 `analytics.js` (116 lines; 1,506 B min, 601 B br)

It runs on DOM ready for each `.cf-form` that has `input[name=_cf_form_id]`. Events:

| Event | When it fires |
|---|---|
| `view` | Once, when an `IntersectionObserver` reports the form visible (threshold 0), or immediately when there is no IO. |
| `start` | First `focusin`. Also forces `view`. |
| `field_interaction` | Capture-phase `blur` of any named control whose name does not start with `_`. Fires on **every** blur, with no dedup on the client. |
| `abandon` | `beforeunload` when the form was started and not submitted. Sent with `sendBeacon(URLSearchParams)`. `submitted` is set by the native `submit` or by `cf-success`. |

Every event POSTs `action=cf_track_event, form_id, event_type, page_url, field_name?` with `fetch` (or `sendBeacon` for abandon).

The server accepts only these four types, rate-limits to 30 per IP per form per minute, and supports an optional `event_id` for dedup that the client never sends (`WP:src/analytics/class-tracker.php:199-246`). `submit` is recorded server-side.

### 2.8 Polls (`poll-frontend.js`, 213 lines)

**Markup** (`WP:src/polls/class-poll-frontend.php:181-269`):

```
div.cf-poll.cf-poll-style-{bar|percent|columns}[.cf-poll-with-results][.cf-poll-changing][data-poll-id][data-poll-slug][data-live=0|1][data-style]
  form.cf-poll-form[method=post][novalidate] > fieldset.cf-poll-fieldset
    legend.cf-poll-question
    hidden poll_id, poll_action=vote|change, cf_poll_nonce, honeypot div.cf-poll-hp > input[name=cf_poll_hp]
    div.cf-poll-options > label.cf-poll-option[for=cf-poll-{id}-opt-{i}] > input[type=radio|checkbox][name=cf_poll_option(\[\])][value=i] + span.cf-option-content > span.cf-option-text (+ span.cf-option-stats > span.cf-option-pct + span.cf-option-count) (+ span.cf-option-bar[style=width:%])
      label.cf-poll-option.cf-poll-option-other > input[data-cf-other=1][aria-controls] + … input.cf-poll-other-input[name=cf_poll_other][maxlength=200]
  div.cf-poll-footer > span.cf-poll-total? + button.cf-poll-submit
  div.cf-poll-message[role=status][aria-live=polite]
```

The results view (lines 272-321) is `div.cf-poll.cf-poll-results` containing `h3.cf-poll-question`, an optional `div.cf-poll-closed-notice`, and `div.cf-poll-results-list[role=list][aria-live=polite]`. Each `div.cf-result-item[role=listitem]` contains:

- `div.cf-result-header > span.cf-result-option + span.cf-result-percentage`
- `div.cf-result-bar-container[role=progressbar][aria-valuenow]` > `div.cf-result-bar`
- `div.cf-result-votes`

The list is followed by `div.cf-poll-total-votes` (+ `span.cf-poll-voter-count`). There are also scheduled and closed variants: `.cf-poll-scheduled`, `.cf-poll-closed`, `.cf-poll-redirect-link`.

**JS:**

- **"Other" input.** It is enabled and `required` only while `[data-cf-other="1"]` is checked; it is focused when activated and its custom validity is cleared when deactivated.
- **Submit.** The client requires a selection. It adds `.cf-poll-loading`, sets the button text to `strings.loading` (the original is kept in `data-original-label`), and POSTs `FormData + action=cf_poll_vote`.
- **Success.** If `data.data.html` is present, the whole `.cf-poll` is replaced from a `<template>`. Then other-inputs re-init, the `.cf-poll-question` is focused (`tabindex=-1`), and live polling starts. Otherwise a message shows.
- **Live polling.** For `data-live="1"`, it polls `GET ajax_url?action=cf_poll_results&poll_id=` every `live_poll_ms` (15 s), skipping while `document.hidden`. It updates `.cf-result-bar` width, `.cf-result-percentage`, `.cf-result-votes` and `aria-valuenow` by index.

The editor block `core-forms/poll` (`assets/js/poll-block.js`) has attributes `pollId` and `mode: auto|results|form`, and previews through `ServerSideRender`. It is WordPress-only.

### 2.9 License portal (`license-frontend.js`, 81 lines)

These are delegated clicks:

- `[data-license-reveal]` toggles `hidden` between `[data-license-value]` and `[data-license-mask]` inside `[data-license-record]`.
- `[data-copy-value]` copies to the clipboard (with an `execCommand` fallback) and shows the `copied` label for 1.6 s.
- `form[data-confirm]` asks `confirm()` before submitting.
- `[data-portal-search-container]` has a live filter. `[data-portal-filter]` filters `[data-portal-search]` records and toggles `[data-portal-filter-empty]`.
- `[data-portal-print]` calls `print()`.

The classes are in the `.cf-license-*` / `.cf-customer-portal` namespace (`license-frontend.css`). This belongs with the licensing spec; it is listed here for DOM-contract completeness.

### 2.10 File uploads

There is no front-end upload JavaScript. File fields are native `<input type="file">`, and `multiple` makes the name `name[]` (`schema-renderer.php:141-143`). The form gets `enctype="multipart/form-data"` when any file input exists (`class-form.php:81-86, 409-415`). It submits through the same XHR `FormData`, with no progress UI, previews or drag-and-drop. Styling lives in `form-theme.css:293-309` (dashed drop-zone look). `WP:extensions/file-upload/assets/dist/js/admin.js` only registers a `file` type in the admin `core_forms.FieldBuilder`.

### 2.11 Cross-module ordering

These interactions must be preserved or handled deliberately:

1. **Submit-time capture listeners.**
   - `document` capture: `inline-payments.js` (can stop everything), then `accessibility.js` (marks all fields touched).
   - Form-target capture: reCAPTCHA (can stop `forms.js`).
   - `document` bubble: `forms.js`.
   - Analytics' `submit` listener on the form sets `submitted` even when JS validation later fails.
2. **Two error renderers.** `accessibility.js` handles the native `invalid` event with an `_error` id and a replaced `aria-describedby`. `smart-forms.js` handles blur and step validation with a `-error` id and an appended `aria-describedby`. Both use `.cf-field-error`; the a11y one adds an inline color.
3. **Button state.** `forms.js` restores the button's original `disabled` before firing `cf-submitted`, then `accessibility.js` removes `disabled` unconditionally. A button that started disabled ends enabled.
4. **Calculations and conditionals feed each other.** Calculations dispatch `cf-calculated`, which triggers `refreshConditionals`, which can disable controls, which changes the next calculation. Calculations re-check visibility themselves, so the result converges.

---

## 3. DOM contract

### 3.1 Form wrapper (`WP:src/class-form.php:85-117`)

```html
<form method="post" [action="…/admin-post.php" when AJAX off] class="cf-form cf-form-{ID} {form_class} [cf-form-fullscreen]"
      data-id="{ID}" data-title="{title}" data-slug="{slug}"
      data-ajax-submit="0|1" data-smart-multistep="0|1" data-save-resume="0|1"
      data-partial-entries="0|1" data-calculations="0|1" data-counters="0|1"
      data-message-{key-with-dashes}="…"   (one per message, e.g. data-message-success)
      [data-display-mode="fullscreen" data-fullscreen-theme data-fullscreen-animation data-fullscreen-show-progress]
      [data-cf-payment-provider data-cf-payment-flow]
      [novalidate when AJAX] [enctype="multipart/form-data" when file input] aria-label="{title}">
  [<input type="hidden" name="_wpnonce" …>]   (global enable_nonce, default on)
  <input type="hidden" name="action" value="cf_form_submit" />
  <input type="hidden" name="_cf_form_id" value="{ID}" />
  [<input type="hidden" name="_cf_source_url" value="{url}" />]   (AJAX off)
  <div style="display: none;" aria-hidden="true"><input type="text" name="_cf_h{ID}" value="" tabindex="-1" autocomplete="off" /></div>
  <div class="cf-messages" role="status" aria-live="polite" aria-atomic="true"></div>
  [<p class="cf-message cf-message-{success|error}" role="alert">…</p>]   (no-JS PRG flash, NOTE: sibling of .cf-messages)
  <div class="cf-fields-wrap" [style="display:none"]> …fields… [<noscript><p role="alert">Please enable JavaScript…</p></noscript>] </div>
</form>
[<style>.cf-form-{ID} { …custom_css… }</style>]
[<script>(function(){var form=document.querySelector(".cf-form-{ID}");if(form){…custom_js…}})()</script>]
```

`data-*` keys from the `cf_form_element_data_attributes` filter get a `data-` prefix unless they already have one (lines 157-194). Forms have **no `id` attribute**. `docs/developers/css-theming.md:73` shows `#cf-form-42`, which matches nothing; the real hook is `.cf-form-42`.

Replacement markup:

- Closed or scheduled: `<div class="cf-form cf-form-{ID} cf-form-closed" role="status"><p>{msg}</p></div>` (`WP:src/smart-forms/class-form-scheduler.php:155`).
- Submission limit: `div.cf-message.cf-message-warning.cf-message-submission-limit`.
- Login required: `div.cf-message.cf-message-warning.cf-message-require-user-logged-in`.

The Gutenberg block wraps the form in `div.wp-block-core-forms-form` with optional `h{n}.cf-form-title`, alignment, `max-width` and `id` (`WP:render.php:41-91`).

Standalone page: `body.cf-standalone[.cf-standalone--fullscreen][data-cf-standalone="true"] > main.cf-standalone__main > form` (`WP:src/class-standalone-routes.php:214-235`).

### 3.2 Markup enhancement on every render

The `cf_form_markup` filter at priority 100 runs `cf_enhance_accessibility` (`WP:src/functions.php:3242-3386`). It applies to both raw-HTML and schema forms:

- Every visible control without an `id` gets one, built from its name with non-`[a-z0-9_-]` characters turned into `_` and deduplicated with `_n`.
- `label[not(@for)]` gets `for`, pointing at its wrapped control or the first control in its parent.
- `autocomplete` is added by type (`email`, `tel`, `url`), or by **substring** of the name: `email, name, first_name, last_name, phone, tel, address, city, state, zip, postal, country, url, website`. The first match wins, so `username` becomes `name`.
- A `fieldset` without a `legend` gets `<legend class="screen-reader-text">Field Group</legend>`.
- `type="text"` inputs are rewritten: names containing `email` become `type=email inputmode=email`; `phone`/`tel` become `tel`; `url`/`website` become `url`.

`Form::get_markup()` also forces `maxlength="254"` on `type=email` inputs (`class-form.php:294-307`). `PORT:src/core/render.ts:83-109` implements ids, `for` and a stricter last-word autocomplete. It does not add the legend or the type rewriting.

### 3.3 Schema-rendered field markup (`WP:src/schema/class-schema-renderer.php`)

**Field ids** are `{prefix}{attributes.id ?: name}`. The prefix is `wp_unique_id("cf-form-{ID}-")."-"`, for example `cf-form-12-3-email`, so several copies of a form can share a page (`class-form.php:81`). `normalize_ids()` (lines 335-375) rewrites these to match:

- `id`
- `for`, `list`, `aria-describedby` and `aria-labelledby` references
- `href="#…"` links

The original id is kept in `data-cf-original-id`.

**Wrapper.** The tag is the global `wrapper_tag`: `p` (default), `div` or `span` (lines 10-14, 300-313). It carries:

- `data-cf-field="1"`
- `data-cf-field-type="{type}"`
- `data-cf-field-name="{name}"`
- `[data-cf-step-group="{group}"]`
- whitelisted `wrapper_attributes`: `id class style title role tabindex dir lang hidden` and `data-*`/`aria-*` (`WP:src/schema/class-field.php:46-49`)
- `data-show-if`, `data-hide-if` or `data-cf-conditions` when the field has conditions

The field's `css_class` goes on the **control**, not the wrapper. Layout elements (heading, paragraph, divider, html) carry it.

**Per-type HTML** (`render_field`, lines 97-193; `render_choices`, lines 194-237):

| Type | Markup inside wrapper |
|---|---|
| text, email, url, tel, number, date, time, datetime-local, password, color, range, search, month, week, file | `<label for=id>{label}</label><input type=… id name [value] …attrs />` + description. `file` and `select` with `multiple` get `name[]`. |
| name | `input type=text autocomplete=name`, plus `data-cf-field-type="name"` on the control |
| hidden | bare `<input type=hidden …>` with no wrapper |
| textarea / address | `<textarea id name …>default</textarea>`. `address` adds `autocomplete=street-address rows=3`. |
| select | `<select …>` with an optional placeholder `<option value="">`, `optgroup` from `option.group`, `selected` and `disabled`. The placeholder text moves to `data-cf-placeholder`. |
| checkbox (single) / consent | `<label><input type=checkbox id name value="{default_value or 1}" [checked] /> {label}</label>` + description |
| radio, checkbox with options, rating | `<fieldset data-cf-field=1 data-cf-field-type data-cf-field-name data-cf-choice-group="{type}" [aria-required=true] [data-cf-required-group=true (checkbox)] [conditions]><legend>{label}</legend><label><input type=radio\|checkbox id="{prefix}{option.id or name-index}" name="{name}[ [] for checkbox ]" value [checked] [required (radio only)] [disabled] data-cf-original-id /> {option label}</label>…<small …desc></fieldset>`. `rating` uses radios from `validation.min` (default 1) to `validation.max` (default 5), each 0-20, with `data-cf-field-type="rating"` on each control. |
| submit, button, reset | `<button type={type} id [name unless starting with _] [value] …>{label or "Submit"}</button>` in the wrapper |
| heading | `<h{level 1-6, default 3} …marker>{label}</h>` |
| paragraph | `<p …marker>{kses(default_value or label)}</p>` |
| html | `<div …marker style="display:contents">{kses html}</div>` |
| divider | `<hr …marker />` |
| container | `<div data-cf-field=1 … class="cf-row {css_class}" style="--cf-cols:N;--cf-cols-t:N;--cf-cols-m:N;--cf-gap:{len};">children</div>`. Counts are clamped 1-6. Gap must match `0` or a number with a `px/rem/em/%/vw/vh` unit. |
| fieldset | `<fieldset …marker [disabled]><legend>{label}</legend>children</fieldset>`. A disabled container stamps `disabled` on every descendant control. Nesting stops at depth 10 (an HTML comment marks the cut). |

**Descriptions** render as `<small data-cf-description="1" id="{id}-desc">`. The control gets `aria-describedby="{id}-desc"`.

**Control attributes** come from `validation`: `min max minlength maxlength pattern step`. Email `maxlength` is clamped to ≤254. The calculation goes into `data-calculation`. Custom attributes must satisfy `Field::is_html_attribute()`: `data-*`/`aria-*` except the reserved `data-cf-*` and conditional names, plus a whitelist (`class-field.php:32-43`).

**Parenting.** A child belongs to a container when `attributes.parent` names it, or when `group` equals a container's name.

**Multi-step markup** (`WP:src/smart-forms/class-multi-step.php:107-181`). Steps come from `layout.steps` (`[{id, label|title}]`) or from distinct top-level `group` values (at least 2). The type is `layout.type` `multi-step` or `conversational`.

```html
<div class="cf-progress" role="progressbar" aria-label="Form progress" aria-valuenow="1" aria-valuemin="1" aria-valuemax="N">
  <div class="cf-progress__bar" style="width: {round(100/N)}%;"></div><span class="cf-progress__text">1 / N</span></div>
<div class="cf-steps" role="group" aria-label="Form steps">
  <button type="button" class="cf-step is-active" data-step="0" aria-current="step"><span class="cf-step-number" aria-hidden="true">1</span>{label}</button>
  <button type="button" class="cf-step " data-step="1" disabled>…</button></div>
<div class="cf-step-panel[ cf-conversational]" data-step="i" [style="display:none;"] role="group" aria-label="{label}">
  …fields…
  <div class="cf-step-nav">[<button type="button" class="cf-step-prev" data-step="i-1">Previous</button>]
    [<button type="button" class="cf-step-next" data-step="i+1">Next</button>]
    [<button type="submit" class="cf-step-submit">Submit</button> (last step, only if the schema has no submit field)]</div></div>
<input type="hidden" name="_cf_current_step" value="0" />
```

`.cf-rating` and `.cf-rating-value` CSS (`forms.css:193-258`) expects **hand-written** reversed-radio markup. The schema `rating` type does not emit `.cf-rating`, so a builder rating renders as plain radios unless `css_class` is set to `cf-rating`.

### 3.4 Master class and attribute table

R = read by JS, W = written by JS, S = server markup, C = styled by CSS.

| Name | Kind | Role |
|---|---|---|
| `cf-form`, `cf-form-{id}` | class | Form root (S, R, C) |
| `cf-fields-wrap`, `cf-messages`, `cf-message`, `cf-message-{success,error,warning}` | class | Structure and messages (S, R, W, C) |
| `cf-loading` | class | On the form during XHR (W) |
| `cf-form-fullscreen`, `cf-form-fullscreen-source`, `cf-form-closed`, `cf-form-title` | class | S / W / C |
| `cf-row` + `--cf-cols`, `--cf-cols-t`, `--cf-cols-m`, `--cf-gap` | class + inline vars | Column containers (S, C) |
| `cf-invalid`, `cf-field-error` | class | Validation (W, C) |
| `cf-char-counter`, `cf-char-counter--limit` | class | Counter (W, C) |
| `cf-progress`, `cf-progress__bar`, `cf-progress__text`, `cf-steps`, `cf-step`, `cf-step-number`, `is-active`, `is-completed`, `cf-step-panel`, `cf-conversational`, `cf-step-nav`, `cf-step-prev`, `cf-step-next`, `cf-step-submit` | class | Multi-step (S, R, W, C) |
| `cf-skip-link` | class | a11y skip link (W, dead) |
| `cf-inline-payment`, `__element`, `__confirm`, `__error` | class | Inline Stripe (W, C) |
| `cf-turnstile-container`, `cf-math-captcha`, `cf-payment-product`, `cf-draft-saved` (CSS only), `cf-help`, `cf-required`, `cf-submit`, `description` | class | Misc (S / C) |
| `cf-fullscreen-overlay`, `cf-theme-{light,dark,gradient-blue,gradient-purple,gradient-green}`, `cf-animation-{slide,fade,scale}`, `cf-fs-*` (37 classes, §4.5), `cf-fs-active`, `cf-fs-exit-up/down`, `cf-fs-selected` | class | Fullscreen (W, C) |
| `data-ajax-submit`, `data-smart-multistep`, `data-save-resume`, `data-partial-entries`, `data-calculations`, `data-counters` | form attr | Capability flags (S, R; multi-step CSS keys on `data-smart-multistep="1"`) |
| `data-id`, `data-title`, `data-slug`, `data-message-*` | form attr | Metadata (S; `data-message-success` R by fullscreen) |
| `data-display-mode`, `data-fullscreen-theme`, `data-fullscreen-animation`, `data-fullscreen-show-progress` | form attr | Fullscreen (S, R) |
| `data-cf-payment-provider`, `data-cf-payment-flow`, `data-cf-inline-ready` | form attr | Inline Stripe (S, R, W) |
| `data-show-if`, `data-hide-if`, `data-cf-conditions` | any element | Conditionals (S, R) |
| `data-was-required`, `data-cf-conditional-disabled` | control | Engine bookkeeping (W, R) |
| `data-cf-required-group` | fieldset | Required checkbox group (S, R) |
| `data-cf-field`, `data-cf-field-type`, `data-cf-field-name`, `data-cf-step-group`, `data-cf-choice-group`, `data-cf-original-id`, `data-cf-description`, `data-cf-placeholder` | wrapper / control | Schema markers (S; `data-cf-field` R by conditionals and multi-step CSS) |
| `data-calculation`, `data-counter`, `data-resize="none|vertical|horizontal|both"`, `data-error-required`, `data-loading-text` (button) | control | Smart features (S/author, R, C) |
| `data-cf-touched` | control | a11y gating (W) |
| `data-step` | button or panel | Multi-step and fullscreen (S/W, R) |
| `data-sitekey`, `data-form-id`, `data-rendered` | Turnstile container | S, R, W |
| hidden fields `action`, `_wpnonce`, `_cf_form_id`, `_cf_source_url`, `_cf_h{ID}`, `_cf_current_step`, `_cf_draft_token`, `_was_required[]`, `g-recaptcha-response`, `g-recaptcha-failed`, `cf-turnstile-response`, `cf-turnstile-failed`, `cf_math_captcha_answer`, `cf_math_captcha_hash` | inputs | Transport |
| URL params `cf_response`, `cf_resume`, `cf-form`, `cf_preview_form` | query | No-JS flash, resume, legacy standalone, preview |

### 3.5 CSS custom properties

**Form theme**, declared on `.cf-form` (`form-theme.css:13-79`):

| Token | Default | Used for |
|---|---|---|
| `--cf-font` | `inherit` | All text |
| `--cf-text` | `#0f172a` | Labels, values, headings |
| `--cf-text-soft` | `#334155` | Form body text, inline choice labels |
| `--cf-text-light` | `#64748b` | Help text, closed form |
| `--cf-text-muted` | `#94a3b8` | Placeholders |
| `--cf-bg` | `#ffffff` | Form and controls |
| `--cf-bg-soft` | `#f7f9fc` | File input, secondary hover, closed form |
| `--cf-border` | `#7d8da3` | Control borders (3.38:1) |
| `--cf-border-light` | `#e2e8f0` | Fieldset, hr, step-nav, secondary buttons |
| `--cf-brand` | `#2f63f5` | Submit background, checked state |
| `--cf-brand-hover` | `#1f4de0` | Submit hover |
| `--cf-brand-soft` | `#eef3ff` | File hover |
| `--cf-brand-border` | `#dbe6ff` | Declared, unused in the theme |
| `--cf-error` | `#dc2626` | Error text, invalid border, required mark |
| `--cf-error-soft` | `#fef2f2` | Error message background |
| `--cf-error-border` | `#fecaca` | Error message border |
| `--cf-success` | `#15803d` | Declared, but success text uses literal `#14532d` |
| `--cf-success-soft` | `#f0fdf4` | Success message background |
| `--cf-success-border` | `#bbf7d0` | Success message border |
| `--cf-warning` | `#f59e0b` | Declared |
| `--cf-warning-soft` | `#fffbeb` | Warning message background |
| `--cf-warning-border` | `#fde68a` | Warning message border |
| `--cf-focus` | `var(--cf-brand)` | Focus border |
| `--cf-focus-shadow` | `0 0 0 4px rgba(47,99,245,.18)` | Full `box-shadow` value, not a color |
| `--cf-radius` / `--cf-radius-sm` / `--cf-radius-lg` | `8px` / `6px` / `12px` | Shapes (`-sm` unused) |
| `--cf-spacing` | `20px` (`16px` ≤480px) | Field rhythm |
| `--cf-wrapper-padding` | `10px` | Form padding |
| `--cf-input-padding` | `11px 14px` | Control padding |
| `--cf-shadow-input` | `0 1px 2px rgba(15,23,42,.04)` | Control shadow |
| `--cf-shadow-button` | `0 4px 12px rgba(47,99,245,.25)` | Submit shadow |

**Elsewhere:**

- Multi-step: `--cf-ms-ink #0f172a`, `--cf-ms-muted #475569`, `--cf-ms-brand #1f4de0`, `--cf-ms-soft #eef3ff`, `--cf-ms-border #7d8da3` on `.cf-form[data-smart-multistep="1"]` (`multi-step.css:6-11`). These are independent of the theme tokens, so the customizer does **not** recolor multi-step chrome.
- Poll: `--cf-poll-accent #2271b1`, `-accent-soft`, `-accent-strong`, `-bg`, `-border`, `-border-hover`, `-track`, `-text`, `-muted`, `-shadow` (`poll-frontend.css:13-23`).
- Theme customizer page: `--cf-theme-panel-width: 380px`.

Watch the drift trap. In the theme, setting `--cf-focus` alone recolors **only** focus borders, because buttons use `--cf-brand`. Only customizer-generated CSS aliases `--cf-brand*` to `--cf-focus` (§4.7). `docs/developers/css-theming.md` lists old defaults (`#1d2327`, `#2271b1`, `4px`…) and documents `--cf-focus-shadow` as a color. A site that followed that doc has a broken focus shadow in 4.11.1 too, so reproduce the 4.11.1 behavior, not the doc.

---

## 4. CSS

### 4.1 `forms.css`: baseline (276 lines; 5,559 B min, 1,436 B br)

It is unscoped to any theme class; everything sits under `.cf-form` except `.cf-message*`, `.cf-row`, `.cf-rating*` and `.cf-inline-payment*`.

- **Touch floor** (13-41): `min-height:44px; box-sizing:border-box` on text-like inputs, `file`, buttons, `select` and `textarea`; `min-width:44px` on buttons.
- **Focus floor** (46-52): `outline:2px solid currentColor; outline-offset:2px` on `:focus-visible`.
- **Reduced motion** (56-64): animations and transitions forced to 0.001 ms inside `.cf-form`.
- **Legacy look** (66-97): labels are block, 700 weight, `margin-bottom:1px`; `label+label` is 400; inputs `padding:4px 8px`; `textarea:not([rows])` gets `min-height: calc(5lh + 16px)` (fallback 140px).
- **Messages** (99-121): Bootstrap-style success, warning and error colors.
- **`.cf-row` grid** (146-172): `grid-template-columns: repeat(var(--cf-cols,1), minmax(0,1fr))`, gap `var(--cf-gap,1rem)`. At ≤1024px it uses `--cf-cols-t` (falling back to `--cf-cols`); at ≤640px `--cf-cols-m` (then `-t`, then `--cf-cols`). Direct `p`, `div` and `fieldset` children get `margin:0; min-width:0`.
- **Star rating** (193-258): a `row-reverse` inline-flex fieldset. Radios are visually hidden. Labels are 28px masks using inline Font Awesome star SVGs (outline, and solid for hover, `:hover ~` and `:checked ~`). Colors are `#d1d5db` and `#f59e0b`; focus `outline: 2px solid #2271b1`. `.cf-rating-value` is styled.
- **Inline payment** (260-276).

### 4.2 `form-theme.css`: default theme (551 lines; 9,174 B min, 1,974 B br)

Everything is scoped `.cf-form …` (specificity 0,1,x).

- Tokens are listed in §3.5.
- The form gets `max-width:640px`, `line-height:1.6`, padding `--cf-wrapper-padding` and background `--cf-bg`.
- Labels are 600 weight, 14px. Checkbox and radio labels use flex with an 8px gap at 400 weight (via `:has()`).
- Text-like controls, including `color` and `range`, are `display:block; width:100%; min-height:44px`, 15px, use the tokens, and `appearance:none`.
- Focus: `outline:none; border-color:var(--cf-focus); box-shadow:var(--cf-focus-shadow)`, plus a transparent 2px outline for High Contrast Mode.
- `textarea` gets `min-height: calc(5lh + 22px)` and vertical resize.
- `select` gets an inline SVG chevron at right 14px, with an RTL flip.
- Custom checkbox and radio: 18px, a `::before` tick or dot, `:checked` fills with brand, `forced-colors` falls back to native.
- File input: dashed, `--cf-bg-soft` background, brand on hover.
- `p` margin is `--cf-spacing`, and `:last-child` drops it.
- Fieldset: 1px `--cf-border-light`, `radius-lg`, padding 20px 24px.
- Submit: `button[type=submit], input[type=submit], .cf-submit` use a brand background, white 600-weight text, a shadow, `translateY(-1px)` on hover, and 0.55 opacity when disabled.
- Secondary: `button[type=button], .cf-step-prev`.
- Help text: `small, .description, .cf-help` at 13px in `--cf-text-light`.
- `.cf-required, abbr[title]` use the error color.
- Heading sizes: h2 22px, h3 18px, h4 15px.
- `hr` is 1px `--cf-border-light`.
- Themed messages: success text `#14532d`, error `#7f1d1d`, warning `#78350f`.
- `.cf-invalid` uses `!important` for the error border and a 4px ring. `.cf-field-error` is 13px.
- `.cf-progress` and `.cf-step-nav` overrides.
- `.cf-form-closed` card (unscoped).
- At ≤480px, `--cf-spacing` is 16px and submit buttons go full width.

### 4.3 `smart-forms.css` (192 lines; 2,240 B min)

Most of these are unscoped globals:

- `.cf-progress*` (flex bar, `#3858e9`)
- `.cf-steps` / `.cf-step` pills (`is-active`, `is-completed`)
- `.cf-step-panel` with the `cfFadeIn` animation (opacity plus 8px translate)
- `.cf-conversational` (max 600px, centered)
- `.cf-step-nav` and `.cf-step-prev/next` buttons
- `.cf-invalid` (`#cc1818 !important`) and `.cf-field-error` (12px)
- `.cf-form-closed`
- `input[data-calculation]` (grey, default cursor)
- `.cf-form textarea[data-resize=…]`
- `.cf-char-counter`
- `.cf-draft-saved`

### 4.4 `multi-step.css` (226 lines; 6,368 B min)

This is a self-contained skin keyed on `.cf-form[data-smart-multistep="1"]`, with `--cf-ms-*` tokens.

- **Reset.** The form becomes a 720px card (24px padding, 1px `#cbd5e1` border, 12px radius) with a system font, `isolation:isolate`, `color-scheme:light` and `container-type:inline-size`. The progress bar, step nav and buttons get `all: revert`.
- **Steps** become an underline tab strip.
- **Controls** inside panels: 44px, 16px font, 6px radius, `appearance:auto` choices.
- `.cf-row` inside panels uses `--cf-cols`, and switches to `--cf-cols-m` under a container query `max-width:640px`.
- **Breakpoints.** Focus is a 2px brand outline with offset 3. At ≤480px the padding is 16px.

The skin deliberately overrides `form-theme.css`, so multi-step forms look the same with the theme on or off.

### 4.5 `fullscreen.css` (1,134 lines; 19,701 B min, 2,813 B br)

- **Overlay:** `position:fixed; inset:0; z-index:999999`, a column flex layout and a system font.
- **Themes.** Each of the five themes has about 31 rules. Base colors:
  - light: `#fff` / `#191919`, accent `#0445af`
  - dark: `#1a1a2e` / `#eaeaea`
  - gradient-blue: `135deg #667eea→#764ba2`
  - gradient-purple: `#f093fb→#f5576c`
  - gradient-green: `#11998e→#38ef7d`
- **Animations.** Questions are `position:absolute; opacity:0` until `.cf-fs-active`.
  - `slide`: translateY ±60px, 0.5 s, `cubic-bezier(.16,1,.3,1)`
  - `fade`: opacity 0.4 s
  - `scale`: 0.9 to 1
- **Reduced motion** disables transforms (479-492, 1093+).
- **Responsive** rules at ≤768px (1034-1092).
- `.cf-form.cf-form-fullscreen-source{display:none!important}` (1110).
- `.cf-fs-spinner` uses the `cf-fs-spin` keyframes.
- `.cf-fs-powered` is styled but never emitted.

The full `.cf-fs-*` vocabulary: `actions active btn-back btn-next btn-submit close error exit-down exit-up footer header input input-wrap keyboard-hint loading nav-arrows nav-btn option option-indicator option-key option-text options powered progress progress-bar progress-fill progress-text question question-description question-header question-label question-number question-required questions select selected spinner success success-icon success-message success-title textarea`.

### 4.6 Others

- **`standalone.css`** (54 lines) makes `body.cf-standalone` a centered grid on `#f6f7f7` with padding `clamp(20px,5vw,64px)`, and sets `.cf-standalone__main` to `width:min(100%,720px)`. The form becomes a card. The `--fullscreen` variant is unpadded and white, with `overflow:hidden`.
- **`poll-frontend.css`** (398 lines) has tokens on `.cf-poll`, option cards (`:has(input:checked)`), result bars, and `cf-poll-style-percent` / `columns` variants.
- **`license-frontend.css`** and **`license-admin.css`** belong to the licensing spec.

The admin CSS is out of scope for a pixel port:

- `admin.css` (4,026 lines): WP admin chrome
- `design-system.css` (2,306 lines): `:root` tokens `--cf-brand-50..900`, `--cf-ink-*`, `--cf-r-*`, `--cf-shadow-*`, `--cf-ring`, `--cf-font-sans/mono`, copied from core-forms.com
- `theme-customizer.css`, `poll-admin.css`, `prism.css`
- `build/style-form-builder.css`

In EmDash the admin should use kumo tokens instead.

### 4.7 Form Theme Customizer

**Storage.** The option `cf_form_theme_tokens` is an associative array of `token => value`, registered via `register_setting` (`WP:src/admin/class-admin.php:85`). The page is `views/page-form-theme-customizer.php`, served at slug `core-forms-theme-customizer`.

**Controls and defaults** (`page-form-theme-customizer.php:7-95`):

| Token | Default | Control | Sanitizer (`class-admin.php:97-175`) |
|---|---|---|---|
| `--cf-text` | `#0f172a` | color picker + text | `^(#[0-9a-fA-F]{3,8}\|rgba?\([0-9.,\s%]+\))$` |
| `--cf-text-light` | `#64748b` | color | same |
| `--cf-bg` | `#ffffff` | color | same |
| `--cf-border` | `#7d8da3` | color | same |
| `--cf-border-light` | `#e2e8f0` | color | same |
| `--cf-focus` | `#2f63f5` | color ("Primary and focus") | same |
| `--cf-error` | `#dc2626` | color | same |
| `--cf-success` | `#15803d` | color | same |
| `--cf-wrapper-padding` | `10px` | text (placeholder `10px`) | 1-4 lengths, each `0` or a number with `px/rem/em/%`, total ≤100 characters |
| `--cf-radius` | `8px` | text (placeholder `4px`) | `^[0-9]+(px\|rem\|em)$`. **`0` and decimals such as `0.5rem` are rejected.** |
| `--cf-spacing` | `20px` | text (placeholder `20px`) | same as radius |
| `--cf-input-padding` | `11px 14px` | text (placeholder `8px 12px`) | free text without `<>{};\`, ≤100 characters |
| `--cf-font` | `inherit` | text (placeholder `system-ui, sans-serif`) | same as input padding |

The sanitizer also accepts `--cf-focus-shadow`, but there is no control and `FormTheme::allowed_tokens()` drops it. There are no numeric ranges or sliders. Invalid values are silently dropped and fall back to the stylesheet default.

The server adds non-blocking settings errors when text vs bg falls below 4.5:1 (`low_text_contrast`) or focus vs bg below 3.0:1 (`low_focus_contrast`).

**Presets** (lines 27-76). Each merges over the defaults:

| Preset | Overrides |
|---|---|
| Core Forms (`classic`) | defaults |
| Compact | radius 2px, spacing 14px, input padding 7px 10px |
| Warm | text `#292524`, light `#57534e`, bg `#fffbeb`, border `#78716c`, border-light `#d6d3d1`, focus `#9a3412`, error `#b91c1c`, success `#166534`, radius 6px |
| High contrast (`contrast`) | text `#111827`, light `#374151`, border `#4b5563`, border-light `#9ca3af`, focus `#005fcc`, error `#991b1b`, success `#116329`, radius 2px |

**CSS generation** (`WP:src/class-form-theme.php:37-77`):

1. Take the allowed tokens in fixed order (`--cf-text, --cf-text-light, --cf-bg, --cf-border, --cf-border-light, --cf-focus, --cf-error, --cf-success, --cf-radius, --cf-spacing, --cf-wrapper-padding, --cf-input-padding, --cf-font`). Skip empty values.
2. Derive aliases:
   - from `--cf-text`: `--cf-text-soft: var(--cf-text)`
   - from `--cf-text-light`: `--cf-text-muted: var(--cf-text-light)`
   - from `--cf-focus`: `--cf-brand` and `--cf-brand-hover` become `var(--cf-focus)`; `--cf-brand-soft` is `rgba(focus, 0.08)`, `--cf-brand-border` is `rgba(focus, 0.18)`, `--cf-focus-shadow` is `0 0 0 4px rgba(focus, 0.18)`, and `--cf-shadow-button` is `0 4px 12px rgba(focus, 0.25)`.
   - `alpha_color()` handles `#rgb` and `#rrggbb` and prints alpha with `%.2F`, for example `0.08`. Any other color string passes through unchanged, which produces an invalid shadow for `rgb()` input.
3. Output:

```css
/* Generated by Core Forms. Edit the Form Theme Customizer, not this file. */
.cf-form {
	--cf-text: #0f172a;
	…
}

```

The output uses a tab indent, `property: value;` declarations and a trailing newline. It is an **unscoped `.cf-form`** at the same specificity as `form-theme.css`, so it wins by load order.

**Delivery** (`ensure_asset()`, lines 84-125):

- The version is the first 16 hex characters of the CSS's SHA-256.
- The file is written to `uploads/core-forms/form-theme-custom.css`, and `cf_form_theme_asset` stores `{path, url, version}`. The file is rewritten only when the hash changes, or when `$force` is set.
- If the write fails, the CSS goes inline on `core-forms-theme` (`WP:src/class-forms.php:144-157`).
- The upgrade routine `_cf_upgrade_inaccessible_theme_tokens()` (`WP:src/functions.php:1990-2020`) rewrites saved old defaults (`#cbd5e1`, `#ef4444`, `#16a34a`) to the new ones and forces regeneration.

**Customizer page JS** (`WP:assets/js/theme-customizer.js`, 348 lines). The root is `[data-cf-theme-customizer]`. It binds:

- `[data-cf-token]` text inputs (`data-cf-theme-default`)
- `[data-cf-theme-color-target]` pickers, which sync with text inputs only for 6-digit hex
- `[data-cf-theme-preset]` buttons (JSON tokens; `is-active` and `aria-pressed` when every preset token matches)
- `[data-cf-theme-viewport]` desktop/mobile, which sets `[data-cf-theme-preview-stage]`; the mobile frame is 390px, desktop 720px (`theme-customizer.css:185-211`)
- `[data-cf-theme-reset]`, which restores defaults and focuses the first input
- `[data-cf-theme-copy]`, which copies the same CSS without the header comment, with aliases, through the clipboard API or an `execCommand` fallback

On every input:

- Tokens and aliases are written as inline custom properties on `#cf-theme-preview`. It is a `div.cf-form` demo with a name, email, select, textarea, checkbox, submit and success message, styled by the real `form-theme.css`.
- The frame background follows `--cf-bg`.
- The **contrast audit** runs. `li[data-cf-contrast-check][data-foreground][data-background][data-threshold]` pairs are text/bg 4.5, focus/bg 3, border/bg 3, error/bg 4.5 and success/bg 4.5. It uses WCAG relative luminance (sRGB 0.03928) and applies to 6-digit hex only; other formats show "Check value". Results set `is-pass`/`is-fail` and a summary in `[data-cf-theme-audit-summary]` (`aria-live`).
- Dirty state is computed against load-time values: root `.is-dirty` and `[data-cf-theme-save-status]` ("Unsaved theme changes" / "No unsaved changes" / "Saving theme…").

Saving is a native POST to `options.php`.

---

## 5. Admin builder surfaces

The bundles are minified, so offsets written `@n` are byte offsets into the named file. Pretty-printed copies used during research (session scratchpad, not committed): `form-builder.pretty.js` (9,006 lines; app code lines 9-1805 and 5096-8941, bundled `@dnd-kit` 1806-5095) and `admin-app.pretty.js`.

### 5.0 What actually runs in 4.11.1

The Fields tab is at `admin.php?page=core-forms&view=edit&form_id=N&tab=fields`. It loads:

- **The React visual builder.** Handle `core-forms-visual-builder`, file `assets/js/build/form-builder.js` (144 KB). Dependencies are `react`, `react-dom`, `react-jsx-runtime`, `wp-api-fetch`, `wp-components`, `wp-element` and `wp-i18n` (`build/form-builder.asset.php`). It mounts into `#cf-form-builder-root`.
- **The legacy `form-builder.js`.** Handle `core-forms-builder` (`WP:src/admin/class-admin.php:513-516`, comment "kept for code mode fallback"). It works on the `#cf-legacy-builder` block (`views/tab-fields.php:44-276`). An inline `MutationObserver` hides that block as soon as React renders (`tab-fields.php:278-295`). The hidden DOM still submits its fields with the classic Save Form button, including `form[markup]`, `form[settings][custom_css]`, `form[settings][required_fields]` and `form[settings][email_fields]`.
- **Inline scripts** in `tab-fields.php`: the audit panel (14-33), "Insert columns row" and "Insert star rating" (305-371, inside the hidden block), and a postMessage live preview (391-441). The live preview is **dead**: it waits for a `{cf:'preview-ready'}` message that nothing sends.

Three other pieces are **dead code in 4.11.1. Do not port them.**

- `assets/js/admin.js` (268 KB: CodeMirror 5.65.16, a Preact "Add Field" `core_forms.FieldBuilder`, and a legacy actions accordion). It loads only on `core-forms` / `core-forms-settings` **without** `form_id` (`class-admin.php:494-511`). Its editor boots only when `#cf-form-editor` exists, which only happens on the Fields tab. The `#cf-field-builder` mount is rendered by no view.
- `prism.js` and `prism-markup.js`, which are never enqueued.

`admin.js` still matters for one reason: forms created by **older** versions contain its output, and imported markup must keep working. Its generator emitted:

- UPPERCASE names (`label → /[^\w[\]_]/` stripped, spaces to `_`)
- ids `{slug}-{NAME}`
- the configurable `wrapper_tag`
- tab indentation
- `<option>` with no `value`
- radios pre-selected with `selected` (a bug)
- group labels whose `for` points at a non-existent id
- submit as `<input type="submit" value="…">`

### 5.1 Data model and save path

**Two artifacts are stored per form:**

1. `post_content`: the HTML markup. It is the render fallback, the input to the accessibility audit, and what Code mode edits.
2. `FormSchema` JSON in post meta:

```
{ version: 1,
  fields: [Field],
  layout: { type: "single"|"multi-step"|"conversational", steps: [{ id, label }] },
  form_settings: {…passed through} }
```

`Field` (`WP:src/schema/class-field.php:51-100`; builder writes the same keys):

```
{ name, type, label, placeholder, required, default_value, default_values[], checked,
  options[{ value, label, disabled?, group?, attributes?, css_class?, id? }],
  validation{ min, max, minlength, maxlength, pattern, step },
  conditions[{ action: "show"|"hide", rule }],
  css_class, description, attributes{…}, wrapper_attributes{…}, position,
  parent, group, cols_desktop, cols_tablet, cols_mobile, gap }
```

- `parent` names a container. `group` is a step id, or a legacy container name.
- Calculations live in `attributes.calculation` or `attributes["data-calculation"]`.
- The counter is `attributes["data-counter"]="1"`.
- Textarea resize is `attributes["data-resize"]`.
- Heading level is `attributes.level`.

At render time the schema wins (`WP:src/class-form.php:260-286`). The markup is only used when no schema exists.

**Save path A: "Save fields" button.**

- The builder calls `apiFetch PUT /cf/v1/forms/{id}/editor-state` with `{fingerprint, markup, template_id?, schema:{version:1, fields, layout, form_settings}}` (`build/form-builder.js@136657`, grep `editor-state`).
- The client gives up after 15 s.
- Server side (`WP:src/class-rest-forms.php:99-104, 425-482`):
  - `FormDefinition::atomic_mutation` with a fingerprint check returns 409 when another editor changed the form.
  - The markup goes through kses unless the user has `unfiltered_html`.
  - `<form>` tags are stripped.
  - It writes `post_content`, `FormSchema::from_array()->save()`, template presets (`cf_apply_form_template_presets`) and `AccessibilityTester::test_and_store`.
  - It returns `{saved, form, schema, fingerprint}`. The client updates `[name=definition_fingerprint]` from the response.

**Save path B: classic "Save Form" POST.**

A `useEffect` mirrors the builder's state into hidden inputs (`tab-fields.php:160,173-176`):

- `#cf-form-editor` → `form[markup]`
- `#cf-form-schema` → `form[schema]` (JSON string)
- `#cf-applied-template` → `form[template_id]`
- `definition_fingerprint` (`page-edit-form.php:25`)

The server reads them in `class-admin.php:1225-1284, 1383-1384`.

**The HTML is generated twice.**

- The builder has its own JS generator, `ar(fields, wrapperTag)` (pretty 7466-7725), that mirrors `SchemaRenderer`. It produces the same `data-cf-*` markers, `cf-row` variables, choice fieldsets, `-desc` descriptions and attribute allowlist (`@115256`).
- Its post-pass uses `DOMParser` to normalize every id to `cf-field-{original}`, adds `data-cf-original-id`, and remaps `for`/`list`/`aria-describedby`/`aria-labelledby`/`href="#"`. So stored markup has **non-instance** ids (`cf-field-email`), while the live render re-prefixes them per instance (`cf-form-12-3-email`).
- Paragraph and html content is sanitized client-side with a tag allowlist (A, ABBR, B, BR, CODE, DIV, DL/DT/DD, EM, HR, I, IMG, P, S, SMALL, SPAN, STRONG, SUB, SUP, UL/OL/LI, DATALIST, OPTION, OUTPUT; `on*` attributes dropped, unsafe `href`/`src` dropped).
- **EmDash should have one TypeScript renderer in `core/`.** The admin preview and the server render both import it, so the two can never drift. Keep saving the generated markup alongside the schema for the audit and the raw-HTML fallback.

### 5.2 React visual builder

**Bootstrap.**

- The mount element is `div#cf-form-builder-root[data-form-id][data-form-title][data-form-slug]` (`tab-fields.php:36`).
- Initial data is `<script type="application/json" id="cf-form-builder-data">{markup, fingerprint, schema|null, wrapper_tag}</script>` (`tab-fields.php:6-11,41`).
- Globals:
  - `window.cfCustomFieldTypes`: `[{type,label,native_type,description,defaults}]`, from `WP:src/schema/class-custom-fields.php:18-22`
  - `window.cfFormTemplates`: `[{id,label,description,icon,category,field_count,markup,schema,layout,setup_note,preview_url}]`, from `class-admin.php:519-558`
  - `cf_admin_vars.{preview_base_url, nonce}`
- Rendering is `<SlotFillProvider><Builder formId initialData/></SlotFillProvider>` via `wp.element.createRoot` on `DOMContentLoaded` (`@142797`).

**Layout and CSS** (`build/style-form-builder.css`, 27 KB; namespaces `cf-builder__*`, `cf-inserter*`, `cf-canvas*`, `cf-inspector*`, `cf-options*`, `cf-step-editor*`, `cf-templates*`, `cf-preview-dialog*`, `cf-field-groups-modal*`, `cf-code-editor*`):

- **Toolbar:** a Visual/Code toggle (buttons with `aria-pressed`), Templates, Field groups, Preview ("Save & preview" when dirty), and Save fields.
- **Workspace columns:**
  - inserter, 260 px
  - canvas, flexible, `.cf-canvas` max 700 px
  - sidebar, 380 px (320 px at ≤1180 px)
- **Narrow screens:** at ≤782 px the columns stack, with 48 px tap targets.
- **Tokens** come from `design-system.css`.
- The canvas `.cf-row` uses the same `--cf-cols*` grid as the front end.

**Base types.** There are 24 (pretty 11-220, `@149`), listed as type (label, category, defaults):

- **basic:** `text` (`{placeholder:""}`), `email` (`{placeholder:"",required:true}`), `textarea`, `number`, `tel` (Phone), `url` (`{placeholder:"https://"}`)
- **choice:** `select` (Dropdown, two options `option-1`/`option-2`), `radio` (same options), `checkbox` (`{}`)
- **advanced:** `date`, `time`, `file`, `hidden` (`{default_value:""}`), `password`
- **composite:** `name`, `address`, `consent` (`{label:"I agree to the terms and conditions"}`), `rating` (`{validation:{min:"1",max:"5"}}`)
- **structure:** `fieldset` (`{label:"Group"}`, container), `container` (`{label:"",cols_desktop:1,cols_tablet:"",cols_mobile:"",gap:"1rem"}`, container)
- **layout:** `heading` ("Section Title"), `paragraph` ("Descriptive text here."), `divider`, `submit` (`{label:"Submit"}`)

Dashicon names are listed in the bundle. The category labels are computed but never rendered.

**What the inserter shows.** It lists 37 presets in 5 categories (`@6753`; helper `u(id,type,label,desc,kw,kwI18n,category,nameBase,attrs)` from `@7227`). Each preset adds `attributes`:

- **Common:** Full name (`text`, `full_name`, `autocomplete=name`); Email (`inputmode=email`); Phone (`tel`, `inputmode=tel`); Message (`textarea rows=5`); Text; Website (`url`).
- **Contact details:** Name; First name (`given-name`); Last name (`family-name`); Company (`organization`); Job title (`organization-title`); Subject; Street address (`address_line_1`, `address-line1`); Address line 2; City (`address-level2`); State (`address-level1`); Postal code; Country (`country-name`); Address (`address`, `street-address`).
- **Choices:** select, radio, checkbox ("Checkboxes / Multiple Selections"), consent, rating.
- **Advanced:** Long text, number, date, time, file, password, hidden.
- **Layout:** fieldset, container, heading, paragraph, divider, submit.
- **Custom types** come from `cfCustomFieldTypes`, are rendered as their `native_type`, and sit in Advanced with the `editor-code` icon (`@18803`).

The `name` composite type has **no preset**. It only arrives through templates or parsed markup.

**Adding a field** (pretty 8307-8336) creates:

```
{label, placeholder:"", required:false, ...deepClone(preset.defaults),
 name: unique(nameBase), type, position: fields.length, parent: containerName|null}
```

plus `group: activeStep` in multi-step mode. Names are made unique with `_2`, `_3` and so on, after replacing `/[^a-z0-9_]/gi` with `_` (`@16544`).

**Inspector.** This is component `Dn` (pretty 5858-6572). Sections collapse with a `button.cf-inspector__section-header[aria-expanded]`. Labels are auto-associated through generated ids `cf-inspector-control-N` (`@91250`).

- **General**
  - Move to step (multi-step only)
  - Label
  - Name: sanitized `/[^a-z0-9_-]/gi → _`, committed on blur or Enter. Uniqueness is enforced with "Use a unique, nonempty field name."
  - Placeholder
  - Default value, or "Submission value" for checkbox/consent
  - Checked by default
  - Rows + Resize (`""|vertical|horizontal|both|none`) for textarea and address
  - Heading level H2-H5
  - Content for paragraph and html
  - CSS class for containers
- **Layout** (container): columns for desktop (1-6), tablet (≤1024 px) and mobile (≤640 px), placeholder "inherit"; Gap (placeholder `1rem`).
- **Options** (select/radio/checkbox): per row a default toggle (multi for checkbox or `multiple`), label, value, ↑, ↓ and remove; "+ Add option" adds `{value:"option-N", label:"Option N"}`. Renaming a value carries its default selection over.
- **Validation**
  - Required
  - min/max for number, range and rating
  - minlength/maxlength for text, textarea, email, url and tel
  - pattern for text and tel
  - Show character counter for textarea and address
- **Conditions** (§5.2.2)
- **Advanced:** CSS class (control), Help text (`description`)

There are no controls for `step`, date min/max, select `multiple`, a custom error message, a custom id, or readonly. Renaming a field also rewrites other fields' condition rules (the prefix before `:`/`=`) and the `{name}` tokens in calculation attributes (`@17742`, `@17848`).

#### 5.2.1 Containers and drag-and-drop

**Model.**

- Fields are a flat array.
- Nesting is stored as `parent`, with fallbacks `attributes.parent` or `group`=container name.
- Root order is array order. Children are sorted by `position`.
- Only `fieldset` and `container` are containers.
- The visual UI supports **one level** of nesting. Containers can't be dropped into containers, and a container's own inserter hides container presets.
- Deeper nesting, up to 10 levels, is only possible in Code mode.

**Drag and drop uses bundled `@dnd-kit`**, not HTML5 DnD:

- Sensors: `PointerSensor` with `activationConstraint:{distance:5}` (`@114130`), and `KeyboardSensor` with `sortableKeyboardCoordinates`. Keyboard: Space or Enter to pick up and drop, Esc to cancel.
- Sortable contexts: one for the root, one per container (`useSortable({id:name, data:{parent}})`).
- Each container body is `useDroppable({id:"drop-"+name})`.
- Each step tab is `useDroppable({id:"step-drop:"+id, data:{kind:"step"}})`.
- Only `div.cf-canvas__item-grip` starts a drag.
- A `DragOverlay` shows `.cf-canvas__item--overlay`.
- Collision detection: pointer-within (or rect intersection), step hits win, then rect intersection, then closest-center (pretty 7170).
- Screen-reader announcements: "Picked up %s. Drop on another step to move it.", "Over %s.", "Drag finished.", "Move canceled.".

**Card actions.**

- **Duplicate** copies the subtree with new unique names and remaps `parent`, `group`, `attributes.id` and inner id references. It **appends at the end**, not after the original.
- **Delete** removes the subtree with no confirmation.
- **No undo/redo** exists (0 matches for "undo" or "redo" in the bundle).
- **No global shortcuts.**
- Canvas items select on Enter or Space.

#### 5.2.2 Conditional logic UI

Component `Nn` (pretty 5737). Each row has:

- an Action select: "Show if" → `show`, "Hide if" → `hide`
- a free-text Rule input with the hint "e.g., field_name:value"
- remove

"+ Add Condition" adds `{action:"show", rule:""}`.

There is **no field picker, operator picker or match all/any**.

Serialization `er()` (`@115719`) drops empty rules. One rule becomes `data-show-if` or `data-hide-if`; two or more become `data-cf-conditions='[…]'`. These go on the control, or on the fieldset for choice groups and containers. The rule grammar is the `forms.js` grammar (§2.1).

#### 5.2.3 Calculations UI

**None.** The builder only preserves `attributes.calculation` / `data-calculation` (emitted as `data-calculation`) and rewrites `{name}` tokens on rename. Formulas are typed into Code mode or arrive through templates.

#### 5.2.4 Multi-step UI

Component `$n`, `section.cf-step-editor` (`@109397`).

**Controls.**

- Form layout select `#cf-builder-layout` with "Single page" and "Multi-step". Conversational appears only if it is already set.
- A step tablist: `cf-edit-step-{id}` buttons with a number badge, using a roving tabindex with RTL-aware arrows and Home/End.
- Add step, a Step name input (`#cf-builder-step-name`), Move step earlier/later, and Remove step. Removing a step moves its fields to the previous step, or the next one when it is the first.
- In multi-step mode the canvas is `#cf-step-canvas[role=tabpanel]`.

**Step data.**

- New step ids are the first free `cf_step_N`.
- Normalization (`Ln`, pretty 6812): steps come from `layout.steps`, falling back to distinct root `group` values, falling back to a single `{id:"cf_step_1"}`.

**Moves.**

- Dropping a field on a step tab moves its subtree (`parent=null, group=step`). It lands before that step's submit, or at the end.
- Invalid targets are disabled: the same step, child fields, and a subtree holding a submit unless the target is the last step.
- An invariant forces any submit-bearing root into the final step.

**Not editable:** progress-bar options and step-button text ("Next"/"Previous" are fixed in `MultiStep::render`).

#### 5.2.5 Other builder features

- **Reusable field groups.** A modal with Insert and Save tabs.
  - API: `GET /cf/v1/field-groups` returns `{groups:[{id,label,fields,owner,shared,can_remove}], version}`; `POST /cf/v1/field-groups` takes `{label, shared, fields, version}`; `DELETE /cf/v1/field-groups/{16-hex}`.
  - Storage: the `cf_field_groups` option (`WP:src/schema/class-field-groups.php`), capped at 100 groups × 100 fields, 60 KB per group, and a 100-character label. A sha256 version mismatch returns 409.
  - Saving stores the selected subtree, or the whole form when nothing is selected. Inserting renames to unique names.
- **Templates.**
  - The picker (`Rn`, `@104005`) uses `cfFormTemplates`, falling back to a built-in set of 6: contact, feedback, newsletter, support, registration, blank.
  - It offers search, a layout filter (all / multi-step / single), a Multi-step badge, `setup_note`, and a preview button (`[data-cf-preview]`, which opens the PHP footer modal: `admin-ajax.php?action=cf_template_preview&template=`, `class-admin.php:731-927`).
  - Applying a template replaces all fields **without confirmation** and records `template_id`. The server then applies that template's setting and action presets.
- **Code mode.**
  - A plain `<textarea rows=24 spellcheck=false>` (`@103308`), not CodeMirror.
  - Every change is parsed live by `dr()` (pretty 7822-8216). Parse errors show "Could not parse HTML…".
  - The parser skips `_wpnonce`, `_cf_form_id`, `action`, `_wp_http_referer` and `_cf_h*`. It rebuilds choice groups from `fieldset[data-cf-choice-group]` and `name[]`. Containers come from `fieldset`, `[data-cf-field-type=container]`, or a styled or classed wrapper `div` (column variables read back). Headings, `hr` and `p` are recognized; anything else becomes an `html` field. Each field keeps its previous step `group` by name.
- **Preview.**
  - URL: `{preview_base_url}?cf_preview_form={id}&_wpnonce={nonce}&cf_rehearsal=1` (`@106177`).
  - Shown in the sidebar iframe when nothing is selected, and in a `cf-preview-dialog` modal with Desktop and Mobile (390 px) buttons.
  - With unsaved changes it asks you to save first. It always shows the **saved draft**, not live state.

### 5.3 Legacy `form-builder.js`: hidden visual fallback

This is only relevant to the port because imported forms contain its output.

**Generator** (`assets/js/form-builder.js:468-699`):

- Always wraps in `<p>`, ignoring `wrapper_tag`.
- Ids are `name.replace(/[^a-z0-9]/gi,'_')`.
- The required marker is `<span aria-hidden="true">*</span>` inside the label or legend.
- Blocks are joined with blank lines and indented with 2 spaces.
- Select:
  - a single select starts with `<option value="">{placeholder||'Select...'}</option>`
  - options use the `value|label` line syntax
  - `multiple` adds `name[]`
- Checkbox:
  - a single checkbox is `<label><input type="checkbox" … value="{value||1}"/> text *</label>`
  - groups are `<fieldset><legend>`, with **`required` only on the first box** and ids `{id}_{n}`
- Radio groups use the same shape.
- Hidden inputs are unwrapped.
- Submit is `<p><button type="submit">`.

**Palette** (`form-builder.js:37-68`):

- 13 types: text, email, textarea, select, checkbox, radio, number, tel, url, date, fieldset, hidden, submit
- The `columns` and `rating` palette items generate nothing.

**Templates and sync.**

- The card template is `{{key}}` substitution with **no escaping**.
- It syncs to `#cf-form-editor` only when dirty: on mode switch, form submit, a 2 s interval, or `beforeunload`. Writing dispatches `input` and `change`.
- It exports `window.cfUpdateFieldNames` (`name="…"` scan → `.cf-field-names`).

**Inline helpers in `tab-fields.php`, inside the hidden block.**

"Insert columns row" (305-338) prompts for desktop, tablet and mobile column counts (1-6) and inserts:

```html
<div class="cf-row" style="--cf-cols:{d};--cf-cols-t:{t};--cf-cols-m:{m};--cf-gap:1rem;">
	<p><label for="cf-col-a">Field A</label><input type="text" id="cf-col-a" name="COL_A" /></p>
	<p><label for="cf-col-b">Field B</label><input type="text" id="cf-col-b" name="COL_B" /></p>
</div>
```

"Insert star rating" (345-371) inserts:

```html
<fieldset class="cf-rating"><legend>Your rating</legend>
	<input type="radio" name="{name}" value="5" id="cf-{safe}-5" /><label for="cf-{safe}-5"><span class="screen-reader-text">5 stars</span></label>
	… down to 1 ("1 star")
</fieldset>
```

This is the markup `forms.css` `.cf-rating` expects.

### 5.4 Code editor

The 4.11.1 "code editor" is **React Code mode**, described in §5.2.5. `docs/form-builder/code-editor.md` describes features that don't exist in the shipped JS:

- an 800 ms sync debounce
- a Synced/Editing/Parse-error hint bar
- line numbers
- find/replace
- 4-space formatting

The legacy `#cf-form-editor` textarea is the POST carrier for `form[markup]`. `admin.js` CodeMirror is dead (§5.0).

`{{key.path || default}}` template tags can appear in the markup. They are resolved on the server. The dead `admin.js` preview replaced them with their default (`/\{\{ *(\w+)(?:\.([\w.]+))? *(?:\|\| *(\w+))? *\}\}/g`, `admin.js@235175`).

**EmDash recommendation.** Use CodeMirror 6 (`@codemirror/lang-html`), lazy-loaded, with a debounced parse into the schema and a visible parse-error state. That would make the doc's promises true.

### 5.5 Preview

**Saved-form preview.**

- `?cf_preview_form={id}&_wpnonce&cf_rehearsal=1` is handled by `Forms::listen_for_preview()` (`WP:src/class-forms.php:1225-1247`). It loads the **draft** definition, or `cf_revision`, and renders `views/form-preview.php`.
- `form-preview.php` dequeues all theme assets, renders `get_html()` (which enqueues the form's capability assets), forces `forms.css` and `form-theme.css`, and wraps everything in a 720 px `main#form-preview`.
- **Rehearsal mode** (lines 5-12) turns off save/resume, partial entries, analytics and `custom_js`, and forces `payment_flow=hosted`.
- A capture-phase `submit` handler converts `FormData` (skipping `_*` and `action`; `[]` keys become arrays) to JSON `{data, revision_id}` and POSTs it to REST `cf/v1/forms/{id}/rehearsal` with `X-WP-Nonce`. The JSON result is printed in `#cf-preview-outcome[role=status]` (lines 52-63).

**Template preview.** `admin-ajax.php?action=cf_template_preview&template=` (`class-admin.php:731-804`):

- Renders the template markup, or `MultiStep::render` of its schema, inside `<form class="cf-form" data-smart-multistep="0|1" onsubmit="event.preventDefault()" novalidate>`.
- Loads `forms.css` and `form-theme.css`, plus the smart CSS and JS for multi-step.
- Shows the banner "Preview only — buttons and inputs don't submit anywhere."
- Sends `X-Frame-Options: SAMEORIGIN`.

**Port.** The port already previews the **unsaved** draft via `forms/preview` in a sandboxed iframe (`PORT:src/admin/editor/FieldsTab.tsx:182-223`). That is better than WP, so keep it. Extend it to load the capability assets from §8.1 and to support a rehearsal submit, which dry-runs validation and actions and returns the outcome without storing anything.

### 5.6 Accessibility audit (server-side static analysis)

**Code location.** `WP:src/admin/class-accessibility-tester.php` (539 lines).

**Triggers.**

- AJAX actions `cf_a11y_audit` and `cf_a11y_fix` (`edit_forms` + `TeamInbox::can_access`, nonce `cf_a11y_{id}`).
- Every builder save (`test_and_store`).
- First render of the Fields tab when there is no cached report (`tab-fields.php:4`).

**Storage.** Results are cached in post meta `_cf_a11y_report` as `{status:'pass'|'issues', checked_at, issue_count, issues:[{rule, message}]}`. **There is no severity field.** The input is `post_content` (markup), not the schema render.

**UI** (`tab-fields.php:14-33`):

- `details#cf-a11y-builder-panel.is-clear|has-issues`, open when there are issues
- summary text in `#cf-a11y-summary[aria-live=polite]`
- the first 10 issues as `<li><code>rule</code> message`
- `#cf-a11y-run` ("Run audit") and `#cf-a11y-fix` ("Fix safe issues", disabled when there are no issues)
- A fix posts the `definition_fingerprint` for optimistic concurrency, then reloads the page.

**Rules** (`test()`, lines 140-200; checks at 213-539):

| Rule | Check |
|---|---|
| `parse_error` | `DOMDocument::loadHTML` failed |
| `missing_label` | Any `input` (not hidden/submit/button/reset/image), `textarea` or `select` without `aria-label`, `aria-labelledby`, a matching `label[for]` or an ancestor `label`. One issue per control: "Field “{name}” has no associated label, aria-label, or aria-labelledby." |
| `group_no_fieldset` | Two or more radios or checkboxes sharing `type\|name` (with `[]` stripped) whose first input's nearest `fieldset` lacks a non-empty first `legend`. "{Type} group “{name}” needs a <fieldset> with a <legend>." |
| `select_no_placeholder` | `select[required]` whose first `option` has a non-empty `value` |
| `button_no_text` | `button` (no type or `type=submit`) with empty `textContent` |
| `submit_no_value` | `input[type=submit]` with an empty `value` |
| `broken_describedby` | Any `aria-describedby` token without a matching `id` |
| `image_no_alt` | `img:not([alt])` |
| `iframe_no_title` | `iframe` without a `title`, or with an empty one |
| `missing_autocomplete` | **Two or more** of: `input[type=email\|tel\|url]` or `name`/`email`-named inputs without `autocomplete`. One aggregate issue. |
| `empty_lang` | Any element with `lang=""` |
| ~~`missing_aria_required`~~ | Retired. Filtered out of cached reports (lines 121-133) and never emitted, although `accessibility-audit.md` still lists it. |

**"Fix safe issues"** (`autofix()`, lines 61-107) is deterministic and never renames fields:

- Adds an id from `sanitize_title(name)`, deduplicated with `-2`, `-3`.
- Inserts `<label for>` before unlabelled controls with the text `ucwords(name with -/_ → space)`.
- Adds `autocomplete` for **exact** names: `email, phone, tel, first_name, last_name, name`.
- Adds `aria-label="Submit form"` to empty buttons, `alt=""` to images and `title="Embedded content"` to iframes.

It does **not** add `aria-required`, contrary to the docs.

**EmDash.** Port it as a pure TypeScript function over a parsed tree (for example `parse5` or `htmlparser2` with a DOM adapter). Run it on save and on demand, store the report on the form record, and show it with kumo (`Banner` + list). Keep the rule ids and message text so imported reports and docs line up.

---

## 6. Sizes

All sizes are in bytes. Raw is the shipped `.min` file. gzip uses `-9`; brotli uses `-q 11` and was measured from the files.

| Asset | Readable lines | Raw | gzip | brotli |
|---|---|---|---|---|
| `forms.min.js` | 425 | 6,147 | 2,598 | 2,235 |
| `accessibility.min.js` | 256 | 3,888 | 1,097 | 852 |
| `analytics.min.js` | 116 | 1,506 | 734 | 601 |
| `smart-forms.min.js` | 714 | 10,564 | 3,801 | 3,311 |
| `fullscreen.min.js` | 751 | 18,698 | 4,745 | 4,100 |
| `inline-payments.min.js` (+ Stripe.js, external) | 111 | 2,002 | 954 | 722 |
| `recaptcha.min.js` (+ Google, external) | n/a | 2,053 | 736 | 601 |
| `turnstile.min.js` (+ Cloudflare, external) | 125 | 1,628 | 663 | 514 |
| `poll-frontend.min.js` | 213 | 3,306 | 1,429 | 1,180 |
| `license-frontend.min.js` | 81 | 1,746 | 748 | n/a |
| `forms.min.css` | 276 | 5,559 | 1,773 | 1,436 |
| `form-theme.min.css` | 551 | 9,174 | 2,324 | 1,974 |
| `smart-forms.min.css` | 192 | 2,240 | 844 | 637 |
| `multi-step.min.css` | 226 | 6,368 | 1,491 | 1,224 |
| `fullscreen.min.css` | 1,134 | 19,701 | 3,330 | 2,813 |
| `standalone.min.css` | 54 | 900 | 425 | 319 |
| `poll-frontend.min.css` | 398 | 7,593 | 2,131 | 1,792 |
| Admin: `build/form-builder.js` (React builder) | minified | 144,420 | 40,921 | n/a |
| Admin: `admin.js` (webpack bundle: CodeMirror plus admin modules) | minified | 267,584 | 87,829 | n/a |
| Admin: `form-builder.js` (legacy field builder, unminified twin 19,882) | 1,152 | 52,618 | 9,751 | n/a |
| Admin: `build/style-form-builder.css` | minified | 27,370 | 5,103 | n/a |
| Admin: `admin.css` / `design-system.css` | 4,026 / 2,306 | 63,783 / 59,260 (min) | 11,574 / 10,128 | n/a |

**Default embed.** This is a plain HTML form with the theme on and analytics on, which is the default.

- JS: `forms` + `a11y` + `analytics` = 11.5 KB raw, 3.7 KB brotli.
- CSS: `forms` + `form-theme` = 14.7 KB raw, 3.4 KB brotli.
- Total: about **7.1 KB brotli across 5 requests**.

A schema-built form adds `smart-forms.js` (+3.3 KB brotli) even with no smart feature, because inline validation needs it. Multi-step adds the two smart stylesheets (+1.9 KB brotli). Fullscreen adds about 6.9 KB brotli.

The port's current `client.ts` is 5,158 B of TypeScript source. It is bundled by Astro, and no built size was measured.

---

## 7. Gap analysis vs the v0.1.0 port

The port references are:

- `PORT:src/astro/client.ts` (127 lines)
- `PORT:src/astro/FormAssets.astro`
- `PORT:src/core/render.ts`
- `PORT:src/astro/forms.css` (byte-identical to WP apart from a header comment)
- `PORT:src/astro/form-theme.css` (rescoped)

### 7.1 Contract breaks in what was ported

These are things existing sites can observe.

| # | WP behavior | Port behavior | Impact | Fix |
|---|---|---|---|---|
| 1 | AJAX flag is `data-ajax-submit`; a missing flag means AJAX (`forms.js:391`) | `data-ajax="1"`, and the client binds only `form.cf-form[data-ajax='1']` (`client.ts:117`) | Custom JS and CSS keyed on `data-ajax-submit` break | Emit `data-ajax-submit`; intercept unless `'0'`. Keep `data-ajax` only as an alias if wanted. |
| 2 | Theme selectors are `.cf-form …` (0,1,x) | Rescoped to `.cf-form.cf-theme …` (0,2,x), plus a `cf-theme` class on the form (`render.ts:157`) | Site CSS like `.cf-form input{…}` or `.cf-form{--cf-brand:…}` **loses** to the theme. Customizer output `.cf-form{…}` would be overridden by theme defaults. | Restore the WP selectors. Gate the theme by loading or omitting the stylesheet per page or form, not by a class. If a class gate is unavoidable, wrap theme rules in `:where(.cf-theme)` so specificity stays 0,1,x. |
| 3 | Messages are rendered with `innerHTML` (HTML allowed; server-sanitized) | `textContent` (`client.ts:29`) | Links and markup in success messages render as literal text | Sanitize on the server; set HTML on the client |
| 4 | Message element always has `role="alert"`; appended after `clearMessages()` removes all `.cf-message` in the form | `.cf-messages` emptied via `innerHTML=""`; `role` is `status` for success | Minor; a11y announce differs | Match WP |
| 5 | Event `detail` is `{}`, `{response}` or `{message}` | `{form, …}` added | Additive, OK | Keep |
| 6 | `window.core_forms.{on,off,submit}`, listener signature `(form, detail)` | Absent | Integrations that call `core_forms.on('success', …)` or `core_forms.submit(form)` break | Implement |
| 7 | Loader: first submit button, `button.dataset.loadingText` or "Submitting…", frozen width, original `disabled` restored | All submit buttons; `form.dataset.loadingText`; no default text; no width freeze | Visual differences | Match WP, and **additionally** emit `data-loading-text` from the `loading_text` setting onto the submit button (WP never wired the setting) |
| 8 | Fields reset after success, then conditionals refresh | Reset, then CAPTCHA reset | OK once conditionals are ported | n/a |
| 9 | Native `reportValidity()` plus required checkbox groups (`setCustomValidity`) | `checkValidity`/`reportValidity`, no groups | Required checkbox groups are not enforced on the client | Port |
| 10 | Hidden fields: `action=cf_form_submit`, `_wpnonce` | Absent | Only matters if custom JS reads them | Optionally emit `action` for parity |
| 11 | Turnstile markup `div.cf-turnstile-container[data-sitekey][data-form-id]`, explicit render, hidden `cf-turnstile-response`, `cf_turnstile_reset`, `cf_form_reset` | `div.cf-turnstile.cf-captcha` with implicit render (Cloudflare's `cf-turnstile-response` input) | CSS keyed on `.cf-turnstile-container` breaks | Emit WP markup and port `turnstile.js` |
| 12 | reCAPTCHA: capture hook, `action:'core_forms_submit'`, `g-recaptcha-failed` fallback, cleared on `cf-error` | Token fetched inside `submit()`, `action:'submit'`, hidden input with `data-recaptcha-sitekey` | Score analytics in the reCAPTCHA console change action name | Use `core_forms_submit` |
| 13 | Closed form: `<div class="cf-form cf-form-{id} cf-form-closed" role="status"><p>msg</p></div>` | `<p class="cf-message cf-message-error">` inside a normal form with hidden fields (`render.ts:170-172`) | `.cf-form-closed` styling is lost | Match WP |
| 14 | No-JS flash `<p class="cf-message…">` is a **sibling after** `.cf-messages` | Inside `.cf-messages` | Minor CSS difference | Either is fine, but note it |
| 15 | `forms.css` printed only when the theme is on, the stylesheet is on, or smart CSS is needed (§1.1) | Always bundled by `FormAssets.astro` | Sites that disabled both see new styles (bold labels, 44px controls) | Load per form setting |
| 16 | `cf_enhance_accessibility` also adds legends and rewrites `type=text` email, phone and url fields (§3.2) | Not done; autocomplete matches only the last word | Rendered markup differs: email inputs keep `type=text`, losing the mobile keyboard and email validation | Decide: replicate for imported HTML forms (recommended for parity) |
| 17 | Form id prefix `cf-form-{ID}-{n}-` applied only to schema-rendered ids; raw-HTML ids stay unprefixed | `idPrefix` `cf{n}-` applied to **every** id, `for` and aria reference in raw markup (`render.ts:36-42`) | Custom CSS and JS targeting `#email` in a raw-HTML form breaks | Do not prefix raw-HTML ids, or prefix only when the same form renders twice on a page |

### 7.2 Missing entirely

1. **Conditional logic runtime** (`data-show-if`, `data-hide-if`, `data-cf-conditions`, bookkeeping attributes, `_was_required[]`, fixpoint, `cf-refresh`). This is the highest priority: imported forms use it, and today hidden-but-required fields block submission.
2. URL prefill (client).
3. `accessibility.js` (message focus, touched-gated `invalid` decoration, assertive live region, button `aria-busy`).
4. `smart-forms.js`: multi-step, inline validation, save & resume, partial entries, calculations, counters. The server-side schema renderer and MultiStep markup are also absent; the port is markup-only.
5. `fullscreen.js` and `fullscreen.css`, the standalone page and `standalone.css`.
6. Inline Stripe client, payment product picker.
7. `analytics.js` and its endpoint.
8. Polls (markup, JS, CSS, block).
9. Math CAPTCHA markup.
10. CSS: `smart-forms.css`, `multi-step.css`, `fullscreen.css`, `poll-frontend.css`, `standalone.css` (the port ships only `forms.css` and `form-theme.css`).
11. Form Theme Customizer: tokens storage, generated CSS, presets, contrast audit, preview.
12. Visual builder, schema model, legacy field builder, accessibility audit with autofix, revision-aware preview (section 5).
13. `swup:contentReplaced` re-init. The equivalent need in Astro is `astro:page-load` / `astro:after-swap` for View Transitions; the port's `initCoreForms` guards with `data-cf-ready` but is not re-invoked on swaps.

---

## 8. Porting notes for EmDash

### 8.1 Front-end packaging

Keep the progressive-enhancement model and the per-capability split. Do not merge everything into one Astro island.

**Server.** The `render` route returns `{html, requirements}`, where `requirements` mirrors `AssetRequirements::for_form()`:

`{core, a11y, analytics, smart, smartCss, multiStep, fullscreen, inlinePayment, captcha:{provider,siteKey}[], poll}`

**Assets component.** `FormAssets.astro` takes the union of the requirements for the page and emits:

- CSS per flag. Ship the WP files under their WP names and selectors, with no rescoping:
  - `forms.css` when theme, stylesheet or smart CSS applies
  - `form-theme.css` when the theme applies
  - the generated token CSS (inline `<style>` or a hashed asset route; see §8.3)
  - `smart-forms.css`, `multi-step.css`, `fullscreen.css`, `standalone.css` as flagged
- JS as separate `<script type="module">` imports, so Vite emits one chunk each:
  - `core.ts` (forms.js)
  - `a11y.ts`
  - `smart.ts` (with internal flags, or split further into `multistep`, `drafts`, `calc` and `counter` dynamic imports keyed off the `data-*` flags)
  - `fullscreen.ts`, `payments-stripe.ts`, `analytics.ts`, `captcha-turnstile.ts`, `captcha-recaptcha.ts`, `poll.ts`

  Astro deduplicates `<script>` in components, which is good for multiple forms on a page.

**Globals.**

- Replace `cf_js_vars.ajax_url` with the form's own `action`, which is `/_emdash/api/plugins/core-forms/submit` (`PORT:src/core/render.ts:11`).
- Draft, analytics and poll endpoints become sibling plugin routes: `…/draft/save`, `…/draft/load`, `…/track`, `…/poll/vote`, `…/poll/results`.
- Keep `window.cf_js_vars = {ajax_url}` defined, because third-party snippets read it.
- Keep `window.core_forms`, `window.CFFullscreenForm` and `window.cf_turnstile_reset`.

**Re-init.** Delegate on `document` as WP does. Also listen for `astro:page-load` and `swup:contentReplaced` to re-run prefill, conditionals and per-form inits. Make inits idempotent with a `data-cf-ready` marker.

**Calculations.** Replace `new Function` with a tiny recursive-descent evaluator over `+ - * / ( ) ,`, numbers and `round, ceil, floor, min, max, abs` (and the `Math.` forms). It must give identical results:

- WP's `round(n, p)` semantics
- arrays count as 0
- non-finite results are errors

The reason is that EmDash and Cloudflare sites commonly ship a CSP without `unsafe-eval`. The server `FieldCalculator` (`WP:src/smart-forms/class-field-calculator.php`) must share the grammar, so put it in `core/` and use it on both sides.

**Response contract.** The submit route must return the exact §2.1 contract: `error`, `message.{type,text}` with HTML text, `hide_form`, `redirect_url`, `payment`. Additive keys such as `fields` are fine.

**WordPress-only items** and their replacements:

| WordPress item | Replacement |
|---|---|
| `_wpnonce` | Not needed; EmDash routes use `X-EmDash-Request` / same-origin. Drop it from beacon payloads. |
| `admin-post.php`, `admin-ajax.php`, the `action` param | Plugin routes |
| `wp_localize_script` | Inline JSON or `data-*` |
| `wp_unique_id` | Per-render counter, as in `load.ts:37` |
| `WP_HTML_Tag_Processor` / `DOMDocument` passes (`normalize_ids`, `cf_enhance_accessibility`, the a11y tester) | An HTML tokenizer that runs on Workers: `parse5`, `htmlparser2` or `HTMLRewriter`. `HTMLRewriter` suits attribute passes; the audit needs a tree. |
| Uploads-dir CSS file for the customizer | Store tokens in plugin KV/D1 and serve the generated CSS from a route with `ETag` = the 16-char SHA-256 prefix and `Cache-Control: public, max-age=31536000, immutable` via `?v={hash}`. Or inline it (about 600 B). |
| `dashicons` used in customizer and license markup | Phosphor icons in admin; inline SVG on the front end |
| `ServerSideRender` poll and form blocks | EmDash Portable Text block components |
| Swup hook | Keep, plus Astro events |

### 8.2 Markup

Port `SchemaRenderer`, `MultiStep` and `cf_enhance_accessibility` to `PORT:src/core/` as pure TypeScript. They are string builders, so they run on Workers. Reproduce byte-for-byte:

- attribute names and order where CSS could depend on them (it mostly doesn't)
- the `data-cf-*` markers
- the `-desc` and `-error` suffixes
- the `cf-row` inline variables
- the multi-step DOM

Keep the raw-HTML path for imported markup-only forms. Precedence stays "schema wins".

Imported raw markup can come from three generators, and the Code-mode parser and runtime must accept all of them:

- the pre-4.x `admin.js` FieldBuilder (§5.0)
- the legacy `form-builder.js` (§5.3)
- the React builder (§5.1)

Port the React builder's parser `dr()` (§5.2.5) as the canonical HTML → schema importer. That gives imported WP forms an editable schema on first open in the EmDash builder.

### 8.3 Theme customizer

This is an EmDash admin page (React + kumo):

- **Controls.** The 13 token fields, with color inputs pairing kumo `Input` and a native `type=color`.
- **Presets.** The 4 presets.
- **Preview.** A desktop (720px) / mobile (390px) toggle, rendering the real `form-theme.css` demo form inside a sandboxed iframe or shadow root so admin styles cannot bleed in.
- **Contrast audit.** Port the luminance code verbatim.
- **Copy CSS.**
- **Restore defaults.**
- **Save** to plugin storage. Apply the identical sanitizer (§4.7) and the identical generator (`FormTheme::css`, including the alias block and `%.2F` alpha formatting). Return server warnings for <4.5 and <3.0.

**Import.** The WordPress export script must include the `cf_form_theme_tokens` option. The port README's export covers forms only.

**Global settings.** `load_form_theme` (default on), `load_stylesheet` (default off) and `wrapper_tag` (`p|div|span`) become plugin settings, overridable per form with `''|'1'|'0'`.

### 8.4 Builder in EmDash

Section 5 covers what the WP builder does. Rebuild it as React in the EmDash admin with `@cloudflare/kumo` (Button, Input, Select, Switch, Dialog, Tabs, Badge) and `@phosphor-icons/react` for icons. That pairing is already in use: `PORT:src/admin/editor/FieldsTab.tsx:6`, `PORT:src/admin/ui.tsx:5`.

Replace:

- `wp.components` with kumo equivalents
- `wp.apiFetch` with the port's `admin/api.ts` fetch helper
- `wp.i18n` with plain strings (or EmDash i18n if available)
- the WP media frame (used only by licensing admin) with EmDash media

Use `@dnd-kit/core` + `@dnd-kit/sortable` for drag and drop. WP already bundles them, so the same sensors, the step-tab drop targets and the screen-reader announcements port directly. Builder state is the JSON schema (`fields[]`, `layout`). It is saved through one admin route (`PUT …/forms/{id}/editor-state`, keeping the fingerprint/409 conflict contract). The server re-renders HTML from the schema with the shared `core/` renderer; never trust client-generated HTML.

These were never shipped in WP and are opt-in improvements:

- undo/redo (a schema history stack)
- duplicate-in-place
- a field picker and operator picker for conditions (keeping the legacy rule grammar as output)
- a formula editor with `{field}` autocomplete
- a confirmation before a template replaces the fields

The code editor should be CodeMirror 6 with `@codemirror/lang-html`, lazy-loaded. WP ships CodeMirror 5 inside `admin.js`.

Preview: reuse the port's existing iframe preview (`FieldsTab.tsx:182-223`). Feed it schema-rendered HTML and the same capability assets, so multi-step, conditionals and calculations work in preview.

---

## 9. Doc drift, quirks to decide, open questions

### 9.1 Docs that disagree with 4.11.1 code

The port should follow the **code**.

- `css-theming.md`:
  - Wrong defaults table.
  - `--cf-focus-shadow` is described as a color.
  - `#cf-form-42` matches nothing.
  - The `disable_default_css` setting does not exist; the real one is `load_form_theme`.
  - It claims the submit uses `--cf-focus`; it uses `--cf-brand`.
- `fullscreen.md`:
  - Lists themes `light|dark` only; the code has 5.
  - Lists animations with `none` instead of `scale`.
  - Says each `<p>` becomes a step; the code groups by field name.
  - The hook example uses the `.cf-fullscreen-step` class, which does not exist.
- `save-resume.md` describes a "Show save button", a resume URL in the UI, and a `_cf_nonce` param. None of these exist on the client.
- `conditional-logic.md` says conditions are "evaluated on the frontend", but the JSON operator format is server-only.
- `accessibility-audit.md` lists `missing_aria_required`, which is retired: it is filtered out at `class-accessibility-tester.php:121-133` and never emitted. It also says the autofix adds `aria-required`; it doesn't.
- `visual-builder.md`, `containers.md` and `templates.md` describe features the bundle doesn't have:
  - keyboard shortcuts and undo
  - a condition operator/field picker
  - custom error message, id and readonly controls
  - select "Allow multiple"
  - nested containers in the visual UI
  - duplicate-below
  - a replace confirmation for templates
  - 280/320 px panels (the CSS uses 260/380)
- `code-editor.md` describes a debounced, line-numbered editor with find/replace; the shipped one is a plain textarea (§5.4).

### 9.2 Quirks to reproduce or fix

Each needs a decision, and the decision should be recorded:

- the skip link never appears (§2.2)
- the a11y `invalid` handler replaces `aria-describedby`
- `accessibility.js` re-enables a button that started disabled
- resume does not fire change events
- the counter goes stale after reset
- inline Stripe double-submits on a second submit
- inline Stripe bypasses reCAPTCHA
- fullscreen ignores conditionals and never fires `cf-submit`/`cf-error`/`cf-message`
- fullscreen interpolates `placeholder` and `pattern` without escaping
- `forms.js` writes `form.dataset[fieldName]` for button rules
- the `loading_text` setting is never applied

The recommendation: fix the a11y, escaping and double-submit bugs, and keep every class, attribute, event name and timing (5 s autosave, 300 ms auto-advance, 1.5 s fullscreen redirect delay, 15 s poll interval, 100 ms focus tabindex removal).

### 9.3 Open questions

1. **Theme scoping.** Is the `.cf-theme` class in v0.1.0 relied on by anything yet? If not, revert to WP selectors (fix #2).
2. **Raw-HTML id prefixing.** Keep it for duplicate forms on one page, or match WP (only schema ids are prefixed)?
3. **Analytics on EmDash.** Ship the tracker (with D1 storage) or defer? Default-on analytics changes the payload by 600 B and adds requests.
4. **Fullscreen and standalone routes.** In scope for the first milestone? They need an EmDash public page route (`/collect/{slug}`).
5. **Polls and licensing front ends.** Same port milestone, or separate plugins?
6. **reCAPTCHA action name.** Revert to `core_forms_submit` (WP) or keep `submit`?
7. **Native hCaptcha.** WP has none; the port added it. Keep it as an extension?
