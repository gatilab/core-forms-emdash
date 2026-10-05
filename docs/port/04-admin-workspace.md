# 04: Admin workspace, submission management, data portability, CLI, global settings

Spec for porting Core Forms 4.11.1 (WordPress) to EmDash. This part covers the admin information architecture, the submissions inbox (list, detail, editing, replies, team inbox, email logs, retention), global settings, the native backup/restore format, the six competitor importers, WP-CLI, and uninstall. Form-editor tab contents (Fields, Actions, Payment, Headless, Analytics, Revisions), Core Commerce, Polls, Delivery recovery, payments and licensing belong to other specs. They show up here only where the admin shell or the export format touches them.

Path prefixes:
- `WP:` means `/Users/gauravtiwari/Development/emdash-next/.reference/core-forms-wp/`.
- `EM:` means `/Users/gauravtiwari/Development/emdash-next/plugins/core-forms/` (port v0.1.0).

Line numbers refer to those trees. "Cap" means a WordPress capability.

---

## 1. Admin information architecture

### 1.1 Menu registration (every screen)

| Menu label | Page slug | Cap | Renderer | Registered at | Notes |
|---|---|---|---|---|---|
| Core Forms (top level, position `99.88491`, inline SVG `pen-field` icon) | `core-forms` | `edit_forms` | `Admin::page_overview` | `WP:src/admin/class-admin.php:623-634` | Routes to the form editor whenever `form_id` is in the query (`:897-906`). Also handles `action=duplicate_single` (`:887-891`). |
| All Forms | `core-forms` | `edit_forms` | same | `:635-645` | |
| Add New | `core-forms-add-form` | `edit_forms` | `views/page-add-form.php` | `:646-656` | Template gallery |
| Settings | `core-forms-settings` | `edit_forms` | `views/page-global-settings.php` | `:657-667` | Saving posts to `options.php`, which requires `manage_options` (WordPress core behaviour) |
| Form Theme Customizer | `core-forms-theme-customizer` | `edit_forms` | `views/page-form-theme-customizer.php` | `:668-678` | Saves option `cf_form_theme_tokens` |
| Spam (hidden, parent `''`) | `core-forms-spam` | `edit_forms` | `views/page-spam.php` | `:679-689` | `redirect_legacy_spam()` (`:72-76`) 302s to `core-forms-submissions&spam_status=1` at `admin_init` priority 20, so the view never renders |
| All Submissions | `core-forms-submissions` | `edit_forms` | `views/page-all-submissions.php` | `WP:src/admin/class-all-submissions.php:17-26` | Shown as "Submissions" in the subnav |
| Email Logs | `core-forms-email-logs` | `edit_forms` | `views/page-email-logs.php` | `WP:src/admin/class-email-logs.php:30-39` | |
| Migrate | `core-forms-migrate` | `edit_forms` (native backup panel needs `manage_options`) | `CF7Migration::render_page` | `WP:src/admin/class-cf7-migration.php:27-36` | Priority 20. Hosts the native JSON transfer and all importers |
| Delivery recovery | `core-forms-recovery` | `manage_options` | `Workflows\Recovery::render` | `WP:src/workflows/class-recovery.php:9` | Priority 30. Belongs to the workflows spec |
| Core Commerce | `core-forms-licensing` | `manage_core_forms_licenses` | `LicenseAdmin::page` | `WP:src/licensing/class-license-admin.php:28` | Licensing spec |
| Polls / Add Poll | `edit.php?post_type=core-poll`, … | `edit_posts` | native CPT screens | `WP:src/polls/class-poll-admin.php:88-120` | Polls spec |
| License & Updates | `core-forms-license` | `manage_options` | `LicenseManager::render_license_page` | `WP:src/admin/class-license-manager.php:145-154` | Priority 99. Updater licence for the plugin itself (§1.3.10) |

The bootstrap that registers these classes is `WP:core-forms.php:125-200`. Admin classes are constructed only when `is_admin() && ! wp_doing_ajax()` (`:163-198`). `TeamInbox` and `PrivacyControls` are hooked on every request (`:133-134`).

`disable_screen_options()` (`class-admin.php:706-716`) removes WordPress Screen Options on `toplevel_page_core-forms` and on every `core-forms_page_*` screen.

### 1.2 Shared chrome (the "unified admin workspace", 4.7)

- **Subnav**, `WP:views/admin-subnav.php:13-51`. Four destinations, in this order:
  1. Core Forms → `page=core-forms`, dashicon `feedback`
  2. Submissions → `page=core-forms-submissions`, dashicon `email-alt`
  3. Core Commerce → `page=core-forms-licensing`, dashicon `products`. Hidden unless the user has `manage_core_forms_licenses` (`:40-42`).
  4. Settings → `page=core-forms-settings`, dashicon `admin-settings`

  The caller sets `$cf_active`. `add` maps to `forms` and `spam` maps to `submissions` (`:14-15`). The active link gets `.is-active` and `aria-current="page"`. Email Logs uses `$cf_active='submissions'` (`views/page-email-logs.php:16`).
- **Page hero** on every screen: `<header class="cf-page-hero">` with an h1, a subtitle and an actions area. The Forms list and Email Logs add a `vX.Y.Z` version badge. Each hero is followed by `<hr class="wp-header-end">` so WordPress injects notices after it.
- `views/admin-sidebar.php` and `views/admin-footer.php` are intentionally empty.
- **Assets** (`class-admin.php:390-612`) load only when `page` starts with `core-forms`:
  - `admin.css` and `design-system.css` on every screen.
  - `admin-ui.js` on every screen: toasts, modals, settings workspace, copy buttons. Localised `cf_admin_vars` with nonce `cf_admin_action`, `preview_base_url` and i18n strings (`:473-491`).
  - `submissions.js` on the inbox screens (`:461-470`).
  - The visual builder, actions and theme-customizer bundles on their own screens.
  - If a `form_id` is outside the user's team scope, `assets()` returns early (`:395`).
- **Template preview modal**, injected in the footer of every Core Forms screen (`:810-882`):
  - Delegated click on `[data-cf-preview="{slug}"]`; Esc closes.
  - Iframe source is `admin-ajax.php?action=cf_template_preview&template=`, handled by `ajax_template_preview` (`:731-797`), which requires `edit_forms` and sends `X-Frame-Options: SAMEORIGIN`. The page shows a "Preview only" banner and submit is blocked.
  - Public JS API: `window.CoreFormsAdmin.openTemplatePreview(id,label)` and `closeTemplatePreview()`.
- **Site Health → Info → Core Forms** (`:1468-1494`): the plugin version plus every `DoctorCommand::run_checks()` row, formatted `STATUS — detail`. Deliberately not a Site Health *test* (`:54-58`).

### 1.3 Screens

#### 1.3.1 Forms list (`page=core-forms`)

View: `WP:views/page-overview.php`. Table class: `WP:src/admin/class-table.php`.

- **Hero.** Title "Core Forms" with version badge, subtitle "Build, edit, and manage every form on your site." Buttons: **New form** (primary, links to Add New) and **Settings**.
- **Stats strip** (`page-overview.php:11-18, 53-82`):
  - Active forms: published `core-form` count.
  - Total submissions: `is_spam=0`.
  - Submissions today: `is_spam=0`, since local midnight converted to UTC.
  - Caught as spam: `is_spam=1`.
  - These counts are **not team-scoped**.
- **Search notice.** "Search results for “%s”" appears when `s` is set (`:84-88`).
- **Views** (`class-table.php:71-90`):
  - All (publish + draft + future + pending + private) and Trash, each with a count.
  - When the user has a team scope, the counts are recomputed over the forms they can access.
- **Search box** `#core-forms-search-search-input`.
  - Keyboard: `/` or `s` focuses and selects it, unless focus is already in an input, textarea, select or contenteditable, or a modifier key is held (`page-overview.php:107-129`).
- **Columns** (`class-table.php:126-134`):

  | Column | Content |
  |---|---|
  | checkbox | `forms[]` |
  | Form | Title linking to the editor. Row actions are one link per editor tab (from `cf_get_admin_tabs`), plus **Duplicate** (nonce `cf_duplicate_form_{id}`). In Trash the title is plain bold text (`:218-240`). |
  | Shortcode | Read-only input holding `[cf_form slug="…"]` plus a copy button (`data-cf-copy`) (`:247-259`) |
  | Submissions | Count of **all** rows for the form, spam included. Links to the Submissions tab when greater than 0 (`:323-332`). |
  | Accessibility | From `_cf_a11y_report`: "Fully accessible", or "N issues", the first issue message and "+N more". Backfilled lazily (`:275-316`). |

- **Sorting** (`:146-152, 157-193`): by `post_title`, `submissions` or `accessibility` (sorted in PHP, ties broken by natural title then ID). `date` and `id` are also accepted. Default order is DESC.
- **Pagination:** 50 per page, sliced in PHP after loading all accessible forms (`:46-60`).
- **Bulk actions** (`:95-110`):
  - Normal view: `trash` and `duplicate`. The `trash` action is labelled **"Delete Permanently"** but calls `wp_trash_post`. That is a label bug.
  - Trash view: `untrash` (Restore) and `delete` (Delete Permanently).
  - Every action asserts team access for each ID (`:383-417`).
  - Duplicate copies the post (status publish, **same title**, no "(copy)" suffix) and every meta row (`:383-402`).
  - Single duplicate redirects to `?page=core-forms&duplicated=1`, which renders no notice (`:363-381`).
- **Empty state:** "No forms found. Would you like to create one now?" (`:337-339`).
- **Notification badges** come from the `extensions/notifications` extension (`WP:extensions/notifications/src/Admin.php:104-180`):
  - A count bubble is appended to the top-level menu label.
  - A "N New Submission(s)" pill sits on each form row, built from post meta `_cf_unseen_submissions`.
  - Unseen rows are highlighted on the per-form Submissions tab.

#### 1.3.2 Add New (`page=core-forms-add-form`)

View: `WP:views/page-add-form.php`.

- **Hero:** "Pick a starting point".
- **Tools:**
  - Template search (`data-cf-template-search`).
  - Layout filter: All, Multi-step, Single page.
  - Category filter buttons, built from the template registry: starter, business, marketing, events, nonprofit, engagement, payment, license.
  - Live result status, plus a "No templates match" message.
- **Card** (one `<form method=post>` each):
  - Icon, label, description.
  - A "Multi-step" badge when applicable.
  - Field count.
  - One badge: License ready (`license`), Payment ready (`payment`) or Accessible.
  - Optional setup note.
  - Buttons: **Use this template** (or **Start blank**) and **Preview**.
- **Duplicate an existing form:** a select of accessible forms (shown as `title (slug)`) plus **Duplicate form**.
- **Create** (`class-admin.php:1079-1211`), via `_cf_admin_action=create_form`:
  - **Duplicate path.** Title becomes `"%s (copy)"`. Copies all meta except `_cf_a11y_report`, which is recomputed. Redirects to the editor.
  - **Template path.** Title comes from the card. Markup is `cf_get_template_markup()`, falling back to the legacy NAME/EMAIL/SUBJECT/MESSAGE skeleton (`:1675-1687`) unless the template is `blank`. Then:
    - Template settings preset goes into `_cf_settings`. Non-blank templates without `actions` get the default "email the admin" action (`:1173-1184`).
    - Template messages become `cf_message_{slug}` meta (`:1189-1197`).
    - The template schema is saved (`:1199-1202`).
    - The accessibility report is stored.
    - Redirect to `?page=core-forms&view=edit&form_id=N`.
  - New forms are always `post_status=publish`.

#### 1.3.3 Form editor shell (`page=core-forms&view=edit&form_id=N&tab=…`)

View: `WP:views/page-edit-form.php`. Only the shell is specified here; each tab's body belongs to its own spec.

- **Access.** `page_edit_form()` (`class-admin.php:941-953`) loads `cf_get_form($id,'draft')`. A missing form redirects to the list. Out-of-scope access dies "You cannot access this form."
- **Title.** `document.title` is set to `{form title} — Core Forms ‹ …`.
- **Header bar:**
  - Back arrow to the forms list.
  - Inline title input `form[title]`.
  - Slug shown as code with a pencil toggle that reveals the `form[slug]` input.
  - **Copy shortcode** (`[cf_form slug="…"]`).
  - **Save Form** button.
- **Hidden inputs:** `_cf_admin_action=save_form`, `_wpnonce` (`_cf_admin_action`), `form_id`, `definition_fingerprint` (`FormDefinition::fingerprint`), and `active_tab`.
- **Standalone URL bar.** Rendered when `settings.standalone_enabled`; visible only when `display_mode=fullscreen`. Holds a read-only URL field, a copy button and an **Open** link.
- **Tabs** come from `cf_get_admin_tabs()` (`WP:src/functions.php:1281-1299`) and are filterable via `cf_admin_tabs`:
  1. Fields
  2. Messages
  3. Settings
  4. Actions
  5. Payment
  6. Headless
  7. Submissions (only when `settings.save_submissions` is truthy)
  8. Analytics
  9. Revisions

  Unknown tab values fall back to `fields`. Only the active tab's panel is rendered, through `do_action('cf_admin_output_form_tab_{tab}', $form)`.
- **Notices:**
  - `saved=1`: "Form saved."
  - `restored=1`: "Form restored from the selected revision. The previous state is now itself a revision — nothing was lost."
  - reCAPTCHA (when configured) adds "Google reCAPTCHA v3 is enabled on this form…" on every editor page (`WP:src/admin/class-recaptcha.php:301-312`).
- **Save** (`class-admin.php:1213-1411`) runs inside `FormDefinition::atomic_mutation`:
  - A fingerprint mismatch returns a 409 "This form changed in another editor. Reload before saving." The missing-fingerprint case is also rejected.
  - Absent `markup`, `title` and `slug` fall back to the stored values. This is the 4.9.0 fix that stopped saves from non-Fields tabs wiping the markup.
  - Users without `unfiltered_html` get their markup run through `sanitize_markup()` (`:1695-1809` allowlist). `<form>` tags are always stripped.
  - `custom_css` is stripped of tags, `expression(`, `javascript:`, `@import`, `behavior:` and `<`.
  - `custom_js` is dropped when the user lacks `unfiltered_html`.
  - Listed text settings are sanitised. `display_mode` must be `normal` or `fullscreen`. `payment_currency` is uppercased and cut to 3 letters.
  - `load_stylesheet` and `load_form_theme` must be one of `''`, `'1'` or `'0'`.
  - Settings are merged with `array_replace_recursive`. The `actions` array is replaced wholesale when the Actions tab saves.
  - Messages go to `cf_message_{key}` (kses unless the user has `unfiltered_html`).
  - `wp_save_post_revision()` is forced on every save.
  - Redirect to `…&saved=1&tab={active}`.

#### 1.3.4 Submissions, Email Logs, Settings, Migrate

Specified in §2, §2.10, §3 and §4.

#### 1.3.5 Form Theme Customizer (`page=core-forms-theme-customizer`)

Token editor for option `cf_form_theme_tokens`. Allowed keys and validation are in `class-admin.php:97-184`:

- **Colors:** `--cf-text`, `--cf-text-light`, `--cf-bg`, `--cf-border`, `--cf-border-light`, `--cf-focus`, `--cf-focus-shadow`, `--cf-error`, `--cf-success`. Value must match `#hex{3,8}` or `rgb()`/`rgba()`.
- **Lengths:** `--cf-radius`, `--cf-spacing`. Value must match `^\d+(px|rem|em)$`.
- **Strings:** `--cf-input-padding`, `--cf-font`. At most 100 characters and none of `<>{};\`.
- **`--cf-wrapper-padding`:** 1 to 4 CSS lengths (`px`, `rem`, `em`, `%`) or `0`, at most 100 characters.
- **Contrast checks.** Text against background below 4.5:1 adds the settings warning `low_text_contrast`. Focus against background below 3:1 adds `low_focus_contrast`. Both still save.
- **Regeneration.** `FormTheme::ensure_asset($clean, true)` regenerates the public CSS file during the save.
- **Defaults and presets:** `WP:views/page-form-theme-customizer.php:8-75`. Labels are at `:79-94`.

The page UI and preview belong to the theming spec.

#### 1.3.6 Delivery recovery, Core Commerce, Polls

Other specs. One entry point lives in this area: the All Submissions hero shows a **Delivery recovery** button to `manage_options` users (`WP:views/page-all-submissions.php:16`).

#### 1.3.7 Legacy Spam screen

`views/page-spam.php` is unreachable (redirected, §1.1). Spam is a view of the inbox.

#### 1.3.8 Site Health info

See §1.2 and §5.1.

#### 1.3.9 Accessibility tester (admin side)

`WP:src/admin/class-accessibility-tester.php`.

- **Report.** `test()` (`:140-211`) runs a DOMDocument static analysis and stores the report in post meta `_cf_a11y_report`, shaped `{status:'pass'|'issues', checked_at, issue_count, issues:[{rule,message}]}`.
- **Rules:**

  | Rule | Lines |
  |---|---|
  | `missing_label` | `:213-279` |
  | `group_no_fieldset` | `:281-340` |
  | `select_no_placeholder` | `:342-373` |
  | `button_no_text` / `submit_no_value` | `:375-408` |
  | `broken_describedby` | `:410-442` |
  | `image_no_alt` | `:444-464` |
  | `iframe_no_title` | `:466-480` |
  | `missing_autocomplete` | `:482-524` |
  | `empty_lang` | `:526+` |
  | `parse_error` | |

  The retired `missing_aria_required` rule is filtered out of cached reports (`:121-133`).
- **When it runs:** on every save, create and duplicate, and lazily for the forms list.
- **AJAX:**
  - `cf_a11y_audit` re-tests and stores the report.
  - `cf_a11y_fix` applies deterministic fixes (`autofix()`, `:61-107`) under `atomic_mutation`:
    - adds missing ids and a generated `<label>`
    - sets `autocomplete` for `email`/`phone`/`tel`/`first_name`/`last_name`/`name`
    - adds `aria-label="Submit form"` to empty buttons
    - adds `alt=""` to images and `title="Embedded content"` to iframes
  - Both actions use nonce `cf_a11y_{form_id}` and require team access.
- The editor UI belongs to the form-builder spec. The **list column** belongs here.

#### 1.3.10 License & Updates (admin side)

`WP:src/admin/class-license-manager.php`.

- **Options:**
  - `core_forms_license` holds `{key, status, expiration_date, …}`.
  - Also `core_forms_license_last_check`, `core_forms_update_last_check`, `core_forms_license_server` (`'fluentcart'`) and the transient `core_forms_update_info`.
- **Licence server.** `LICENSE_SERVER = https://gauravtiwari.org/`, `ITEM_ID = 1149394`, slug `core-forms` (`:28-50`).
- **Actions** (POST `core_forms_license_action`, nonce `core_forms_license_nonce`, `manage_options`), at `:156-186`:
  - `activate`: the key is lowercased.
  - `deactivate`.
  - `check_updates`: requires a valid licence and clears update transients.
- **Notices** (`:407-435`), shown on every `core-forms*` page except the licence page:
  - Expired: warning "Your Core Forms license has expired…".
  - Otherwise, when not valid: info "Activate your Core Forms license to receive automatic updates."
- **Background:** cron `core_forms_verify_license` on a custom `core_forms_6h` schedule. Also filters `pre_set_site_transient_update_plugins` and `plugins_api`.
- **EmDash:** the plugin ships via npm (`@gatilab/emdash-core-forms`), so there is no updater licence. **Do not port this screen.** If a commercial gate is wanted, the licensing spec owns it. Drop the nag notices.

### 1.4 Keyboard and accessibility behaviours

| Where | Behaviour | Source |
|---|---|---|
| Forms list | `/` or `s` focuses search | `views/page-overview.php:107-129` |
| Template preview, email detail modal, admin-ui modals | `Escape` closes | `class-admin.php:869-871`, `views/page-email-logs.php:345-349`, `assets/js/admin-ui.js:195-200` |
| Settings | Section index links push `#hash`. `hashchange` re-selects. Invalid controls reveal their section and open parent `<details>`. `beforeunload` warns when dirty. | `assets/js/admin-ui.js:508-703` |
| Inbox screens | Master checkbox with indeterminate state. **Select page** toggles to **Clear selection**. Live selection status ("%d selected on this page"). Apply is disabled without a selection and an action. Bulk actions matching `^bulk_delete` show a `confirm()` "Permanently delete the selected submissions? This cannot be undone." A date range with To earlier than From sets `setCustomValidity` "The end date must be on or after the start date." | `assets/js/submissions.js:1-55`, i18n `class-admin.php:463-469` |
| Copy buttons | `[data-cf-copy]` / `data-cf-copy-target`. Clipboard API with an `execCommand` fallback. Toast "Copied to clipboard." or "Copy failed. Select and copy the text manually." | `assets/js/admin-ui.js:705-740` |
| Team tools | Native `<details>`. The team entry card's controls are bound with `form="cf-team-entry-{id}"` to a sibling `<form>`, so they are not nested inside the editor form. | `class-team-inbox.php:207-210`, `views/page-edit-form.php:107-109` |

There is no Cmd/Ctrl+S in WordPress. The v0.1.0 EmDash editor adds Cmd/Ctrl+S (`EM:src/admin/FormEditorPage.tsx:221`). Keep it.

### 1.5 Notice catalogue (query arg → text)

| Screen | Trigger | Text |
|---|---|---|
| Edit form | `saved=1` | Form saved. |
| Edit form | `restored=1` | Form restored from the selected revision. The previous state is now itself a revision — nothing was lost. |
| Submission detail | `updated=1` | Submission updated successfully. (`error=1` is set on failure but no notice renders) |
| Submission detail | `reply_sent=1` / `reply_error=1` | Reply sent successfully. / Failed to send reply. Please check your email settings. |
| All submissions | after a table bulk action | Bulk action processed. The list below is up to date. |
| All submissions | `unmarked`, `deleted`, `bulk_deleted`, `bulk_unmarked` (set by `Admin::process_*spam`, `class-admin.php:1553,1572,1592,1636`) | **No notice renders.** These args are orphaned. |
| Email logs | `deleted=N` / `resent=1` / `resend_failed=1` | "%d log(s) deleted." / Email resent successfully. / Failed to resend email. Please check your email configuration. |
| Settings | `settings-updated` | Settings updated. Plus settings errors: `standalone_base_collision` "That standalone URL base conflicts with an existing page or public content route. The previous value was kept."; theme `low_text_contrast` / `low_focus_contrast` |
| Migrate | `imported[]`, `skipped[]`, `entries_total` | "Imported %d form(s)." plus "(%d entries imported too)" and a link **View all Core Forms →**. "%d form(s) were skipped because they could not be parsed." (`class-cf7-migration.php:66-91`) |
| Migrate (native) | `cf_migrate_notice={token}` → transient `cf_migrate_notice_{uid}_{token}` (5 min) | Success or error message plus up to 12 detail bullets (`class-core-data-migration.php:1325-1371`) |
| Every core-forms page | licence not valid | See §1.3.10 |

### 1.6 Admin request plumbing

- **`_cf_admin_action` dispatcher** (`class-admin.php:342-388`):
  - The action name is read from GET or POST.
  - Nonce `_wpnonce` must verify against `_cf_admin_action`; otherwise `wp_nonce_ays` runs and execution exits.
  - The user needs `edit_forms`.
  - If a `form_id` is present, `TeamInbox::assert_form` runs. If a `submission_id` is present, `can_access_entry` must pass (403 otherwise).
  - Then `do_action('cf_admin_action_{name}')` fires, followed by a redirect to `_redirect_to` or the current URL without `_cf_admin_action`.
- **Registered actions:**

  | Action | Handler |
  |---|---|
  | `create_form` | `Admin::process_create_form` |
  | `save_form` | `Admin::process_save_form` |
  | `bulk_delete_submissions` | `Admin::process_bulk_delete_submissions` (`:1496-1520`); notifications extension also hooks it |
  | `unmark_spam` | `:1522-1555` |
  | `delete_spam` | `:1557-1574` |
  | `bulk_delete_spam` | `:1576-1594` |
  | `bulk_unmark_spam` | `:1596-1638` |
  | `bulk_mark_spam` | `:1648-1673` |
  | `delete_email_log`, `bulk_delete_email_logs`, `resend_email` | `EmailLogs` |
  | `export_form_submissions` | `extensions/data-exporter/src/class-admin.php:30-107` |
  | `hide_data_column`, `show_data_column`, `show_all_data_columns`, `rename_data_column`, `delete_data_column` | `extensions/data-management/src/class-admin.php:56-185` |
  | `bulk_mark_submissions_as_seen`, `bulk_mark_submissions_as_unseen`, `toggle_submission_status` | `extensions/notifications/src/Admin.php` |

- **`admin.php?action=` (admin_action_*):**
  - `cf_save_submission` → `SubmissionEditor`, nonce `cf_save_submission`.
  - `cf_send_reply` → `SubmissionReply`, nonce `cf_send_reply`.
- **`admin-post.php` actions:**

  | Action | Owner and nonce |
  |---|---|
  | `cf_team_save` | nonce `cf_team_{id}` in field `_cf_team_nonce` |
  | `cf_team_scope` | nonce `cf_team_scope` |
  | `cf_team_view` | nonce `cf_team_view` |
  | `cf_core_data_export` | nonce `cf_core_data_export` |
  | `cf_core_data_import` | nonce `cf_core_data_import` |
  | `cf_cf7_migrate` | |
  | `cf_gf_migrate` | |
  | `cf_wpforms_migrate` | |
  | `cf_fluent_migrate` | |
  | `cf_ninja_migrate` | |
  | `cf_formidable_migrate` | |
  | `cf_private_download` | also `nopriv` |
  | `cf_recover_delivery` | |

- **AJAX:** `cf_template_preview`, `cf_a11y_audit`, `cf_a11y_fix`, `cf_whatsapp_cloud_test`.
- **REST used by admin:**
  - `cf/v1/forms/{id}/retention-preview` (`class-privacy-controls.php:201-203`).
  - `cf/v1/actions/*`, the action editor and the integration tests (other specs).

---

## 2. Submissions

### 2.1 Data model

**Table `{prefix}cf_submissions`** (`WP:src/functions.php:2300-2341`):

| Column | Type | Notes |
|---|---|---|
| `id` | INT UNSIGNED, auto-increment | |
| `form_id` | INT UNSIGNED | |
| `data` | TEXT | JSON |
| `user_agent` | TEXT | |
| `ip_address` | VARCHAR(255) | |
| `referer_url` | TEXT | |
| `is_spam` | TINYINT(1), default 0 | |
| `status` | VARCHAR(30), default `new` | |
| `draft_token` | VARCHAR(64) | |
| `current_step` | INT, default 0 | |
| `payment_status` | VARCHAR(30) | |
| `payment_provider` | VARCHAR(20) | |
| `payment_id` | VARCHAR(190) | |
| `payment_amount` | BIGINT UNSIGNED | minor units |
| `payment_currency` | VARCHAR(8) | |
| `submitted_at` | TIMESTAMP, default CURRENT_TIMESTAMP | read as **UTC** (`WP:src/class-submission.php:80-85`) |
| `modified_at` | TIMESTAMP NULL | |

Indexes: `idx_draft_token`, `idx_payment_id(provider,id)`, `idx_form_spam_submitted`, `idx_form_submitted`, `idx_submitted`, `idx_status_modified`.

**Statuses** (`WP:src/class-submission.php:34-43`):
- Workflow: `new`, `read`, `replied`, `archived`.
- Save and resume: `draft`, `partial`.
- Payment: `pending_payment`, `paid`, `payment_failed`, `refunded`. These are written into **both** `status` and `payment_status` (`WP:src/payments/class-payments.php:314`).

**Spam is an orthogonal flag**, `is_spam`. A spam row keeps its status.

**Status writes:**
- `cf_update_submission_status()` (`functions.php:2734-2774`) accepts only `new`, `read`, `replied` or `archived`. It keeps the notifications meta `_cf_unseen_submissions` (per form, an array of submission IDs) in sync: the ID is removed, and re-added on `new` when the form has `enable_notifications`. It fires `cf_submission_written(id,'status')`.
- Opening a detail view flips `new` to `read` (`class-admin.php:1070-1073`). Paid or draft rows are untouched.

**Change hook.** `cf_submission_written($ids, $context, $submission?, $form?)` (`functions.php:2883-2900`) fires the action `cf_submission_after_write` for every writer. Contexts: `submit`, `admin_edit`, `draft`, `delete`, `status`, `spam`, `payment`, `gdpr`, `rest`, `cli`, `import`, `data_management`, `team`, `erase`, `attachment_retention`.

The EmDash port should emit an equivalent internal event, or call one function, from every writer.

**Reply and conversation table `{prefix}cf_submission_replies`** (`functions.php:3424-3449`):

| Column | Type | Notes |
|---|---|---|
| `id` | auto-increment | |
| `submission_id` | | |
| `direction` | VARCHAR(12), default `outbound` | |
| `channel` | VARCHAR(20), default `email` | |
| `provider` | | |
| `provider_message_id` | | UNIQUE with `provider` |
| `status` | VARCHAR(20), default `received` | |
| `from_email` | | |
| `to_email` | NOT NULL | |
| `subject` | | |
| `message` | LONGTEXT | |
| `payload` | LONGTEXT | |
| `user_id` | | |
| `sent_at` | TIMESTAMP | |

The table is shared with the WhatsApp inbound and outbound conversation (`cf_save_submission_message`, `functions.php:2657-2671`; `cf_find_messaging_submission`, `:2674-2690`).

**Team table `{prefix}cf_submission_team`:** see §2.9.

### 2.2 Query semantics (shared by both inboxes)

`cf_get_all_submissions()` and `cf_count_all_submissions()` (`functions.php:2452-2537`, `2544-2614`):

- **Defaults:** `limit 50`, `orderby submitted_at`, `order DESC`.
- **Team scope:** `TeamInbox::sql_scope('s.form_id')` is always ANDed in.
- **Filters:**

  | Filter | Clause |
  |---|---|
  | `form_id` | `s.form_id = %d` |
  | `assignee` | `s.id IN (SELECT submission_id FROM cf_submission_team WHERE assignee=%d)` |
  | `overdue` | `s.id IN (… WHERE due_at < UTC_NOW)`. Doesn't check that an assignee exists or that the row isn't archived. |
  | `is_spam` | `true`, `false` or `null` (any) |
  | `status` | exact match |
  | `exclude_status` | `(s.status IS NULL OR s.status <> %s)` |
  | `search` | `s.data LIKE %term%` over the JSON text, so it also matches keys and JSON escapes |
  | `date_from`, `date_to` | `Y-m-d` interpreted in the **site timezone** when `dates_local` is set, converted to UTC bounds 00:00:00 and 23:59:59 (`cf_submission_date_boundary`, `:2444-2450`). Invalid dates are ignored. |

- **orderby whitelist:** `submitted_at`, `form_id`, `id`.

### 2.3 All Submissions screen (`page=core-forms-submissions`)

Sources: `WP:views/page-all-submissions.php`, `WP:src/admin/class-all-submissions-table.php`.

**Hero:**
- Title "Submissions", subtitle "Review incoming entries and keep track of what needs a reply."
- **Delivery recovery** button, shown only to `manage_options` users.

**Views** (`table:91-111`). Each link resets `submission_status` and `spam_status` and keeps the other filters. Each view shows a live count.

| View | Query args | Filter |
|---|---|---|
| Inbox (default) | `spam_status=0`, no status | `is_spam=0`, excludes `archived` |
| New | `spam_status=0&submission_status=new` | |
| Archived | `spam_status=0&submission_status=archived` | |
| Spam | `spam_status=1` | |
| All | `spam_status=all` | `is_spam=null`. Any value other than `0`/`1` means all. |

**Filter form** (GET, kept outside the bulk POST form):
- Search: label "Search entries", placeholder "Name, email or answer…".
- Form select: "All forms" plus accessible forms sorted by title.
- Status select: "All statuses" plus the 10 labels from `SubmissionPresentation::status_labels()`: New, Read, Replied, Archived, Draft, Partial, Awaiting payment, Paid, Payment failed, Refunded.
- **Apply filters**.
- **Clear filters**, shown when any filter or saved view is active.
- `<details>` "Date range" with From and To; open by default when either is set.
- "Times shown in {tz}".
- Hidden passthrough of `assignee` and `overdue`.

**Team tools** (`<details>` "Saved views and team access"): see §2.9.

**Bulk form:**
- Nonce `bulk-submissions`.
- Selection bar with live status and a **Select page** button.
- WordPress list table with checkbox name `submissions[]`.

**Columns** (`table:125-134`):

| Column | Content |
|---|---|
| checkbox | |
| Submission | Primary column; the summary (§2.5) linking to the detail view |
| Form | Link to the form's Submissions tab, or *Deleted form* |
| Received | Relative plus absolute date (§2.5) |
| Status | Badge (§2.5) |
| Action | **View** button |

- Sortable: `submitted_at` (default desc) and `form_id`.
- 25 per page.
- Row classes: `cf-spam-row`, or `cf-inbox-row--new`.
- Empty state: "No submissions match this view" / "Try another status, search term or date range."

**Bulk actions** (`table:113-123, 216-355`). Every ID is first checked for existence and team access; failure dies "You cannot manage a selected entry."

| Action | Behaviour |
|---|---|
| Mark as spam | `is_spam=1`, `cf_submission_written(spam)`. No actions fire. |
| Not spam | `is_spam=0`, then `cf_replay_submission_actions()`. This fires `cf_form_success` and dispatches every configured action whose `conditions` pass; skipped ones are logged `conditions_not_met` (`functions.php:2787-2823`). |
| Mark as read / Archive / Mark as new | `cf_update_submission_status` |
| Export to CSV | Streams `core-forms-submissions-YYYY-MM-DD-His.csv` (§2.3.1) |
| Delete permanently | `PrivacyControls::delete_submission()` for each ID. Dies "An entry is still needed for unfinished payment or fulfillment." on refusal; earlier IDs in the batch **are already deleted**. |

#### 2.3.1 Bulk CSV columns (global list)

- Header: `id, form_id, submitted_at, status, is_spam, ip_address`, then the union of data keys in first-seen order.
- `is_spam` is written as `spam` or `valid`.
- Arrays are joined with `, `.
- Every row passes through `cf_csv_row()` (`functions.php:10-15`): non-scalars are JSON-encoded, and a cell starting with optional whitespace or control characters followed by `= + - @` or their fullwidth forms `＝＋－＠` is prefixed with `\t`.

### 2.4 Per-form Submissions tab (`…&tab=submissions`)

Sources: `class-admin.php:1018-1060`, `WP:views/tab-submissions-list.php`.

**Form structure.** The view closes the editor's `<form>` and reopens an empty one at the end (`:81, 283`). A Submissions tab must therefore stay structurally isolated.

**Views:**

| View | Filter |
|---|---|
| Inbox (default) | `is_spam=false`; excludes `archived` **unless** a status filter is set |
| Spam | |
| All | |

- Counts sit in pills. In Spam with count > 0, a note reads: "These submissions were flagged by Akismet, the honeypot, or a captcha failure. Bulk-clear them or restore false positives below."

**Filters:** Search, Status (10 labels), date range, timezone label, **Clear filters**.

**Layout toggle** (`layout=summary|fields`):
- **Summary** shows: checkbox, Submission (summary), Received, Status, View.
- **All fields** shows: checkbox, Received, Status, one column per data key, View. Columns come from `get_submission_columns()` (`class-admin.php:997-1016`):
  - data keys over the current page, excluding the form's submission control names
  - label is `ucfirst(strtolower(str_replace('_',' ',key)))`
  - horizontal scroll region with hint "Scroll across to see every field."
- **Hidden columns:** the WordPress screen's hidden columns plus post meta `_cf_hidden_columns`.

**Column header menu** (data-management extension, `extensions/data-management/src/class-admin.php:17-185`):

| Item | Behaviour |
|---|---|
| Hide Column / Show Column | Edits `_cf_hidden_columns` |
| Rename Column | `prompt()`; rewrites `"old":` to `"new":` in every row's JSON with a string replace, in batches of 500 |
| Delete Column | Confirm "Are you sure you want to delete this column? All data will be lost."; unsets the key in every row |

**Bulk actions** (POST `_cf_admin_action`, nonce `_cf_admin_action`, `_cf_return_form_id`):

| View | Actions |
|---|---|
| Spam | Not spam (`bulk_unmark_spam`), Delete permanently (`bulk_delete_submissions`) |
| Otherwise | Mark as spam, Delete permanently |

- Filter `cf_admin_form_submissions_bulk_actions`. The notifications extension adds **Mark as read** and **Mark as new**.

**Toolbar:**
- Pager: "%s submissions", ‹ "%d / %d" ›, 25 per page. Repeated at the bottom.
- Row extra action from notifications: **Mark as read** / **Mark as new** toggle (`toggle_submission_status`).
- Rows are highlighted when unseen.

**Export as CSV** button (data-exporter extension):
- Request: `_cf_admin_action=export_form_submissions`.
- Filename: `core-forms-submissions-{form_id}.csv`.
- Columns: `submitted_at`, then every data key across **all** rows (scanned in batches of 500), then `ip_address`, `user_agent`, `referer_url`.
- File values become `full_path (url)`; file lists become comma-joined URLs; arrays are joined with `, `.
- **Spam rows are included** (`is_spam=null`).
- Uses `cf_csv_row`.

**Empty states:**
- With filters: "No submissions match your filters." / "Try another search, status or date range."
- Spam: "No spam. Carry on."
- Inbox: "No submissions yet. Submissions land here as users complete this form."
- All: "No submissions to display."

### 2.5 Presentation helpers (`WP:src/admin/class-submission-presentation.php`)

**Badge** (`:23-28`): the label is `Spam` when `is_spam`, otherwise the status label; unknown statuses are ucwords-ed. CSS class is `cf-status-{status with _→-}`.

**Date** (`:30-37`):
- Relative text: "Just now" when under 60 s, otherwise "%s ago" or "In %s".
- Absolute text uses `date_format, time_format` in the site timezone.
- Title attribute: absolute plus `(tz)`. A bad timestamp shows "Date unavailable".

**Summary** (`:54-98`). Port this exactly; it is the inbox's identity line.

1. **Excluded keys:** the form's control names, schema fields of type `password` (cached per `form.ID:md5(markup)`), keys starting with `_`, and keys matching `/password|user_pass|secret|token|api_key/i`.
2. **Values:** each value goes through `plain()`:
   - booleans become Yes/No
   - scalars are tag-stripped and trimmed
   - files become their name
   - arrays are recursed to depth 3 and joined with `, `
   - empty values are skipped
3. **Normalised key:** lowercase, with `-` and space replaced by `_`.
4. **Name:** the first of `name, full_name, fullname, your_name, contact_name`. Otherwise `first_name + ' ' + last_name`.
5. **Email:** the first value passing `is_email()`.
6. **Title:** name, then email, then `Submission #%d`. The email is shown separately only when it differs from the title.
7. **Preview:** order `subject, message, comments, reason`, then the remaining keys. Skip keys already used. Take the first **2**, each truncated to **120 characters** plus `…`. Subject, message and comments appear as bare text; others appear as `Label: value`. Join with ` · `.
8. **Markup** (`:100-107`): `.cf-inbox-summary` containing a title link, contact, preview and `#id`.

**`field_html`** (`:47-52`): files and file lists are rendered through `cf_field_value($v,100)`; everything else is plain text truncated to 120 characters.

### 2.6 Detail view (`…&tab=submissions&submission_id=N`)

Sources: `class-admin.php:1062-1077`, `WP:views/tab-submissions-detail.php`.

- **Guard.** The submission must belong to the form and pass `can_access_entry`; otherwise 403.
- **Auto read.** Status `new` becomes `read`.
- Fires `cf_admin_form_submissions_detail`.
- **Header:**
  - h2 "Viewing Form Submission".
  - Spam badge.
  - Payment badge (Pending payment, Paid, Payment failed, Refunded).
  - **Edit** button (`edit=1`).
- **Fields card.** Every data key except the form's submission control names. The label is `str_replace('_',' ',ucfirst(strtolower(key)))`. Values render through `cf_field_value()`, so files become links.
- **Submission Info card:**
  - Submitted: `wp_date` in the site timezone.
  - Last Modified: rendered with PHP `date()`. **Server timezone, inconsistent.**
  - IP Address, Referrer URL (link, `target=_blank`), User Agent.
  - Each row appears only when its value is set.
- **Payment card** (when `payment_status` is set):
  - Status.
  - Provider: stripe→Stripe, paypal→PayPal, razorpay→Razorpay, polar→Polar.sh.
  - Amount as `CUR 0.00`. Minor units are divided by 100 except for the zero-decimal list `JPY KRW VND CLP PYG XAF XOF BIF DJF GNF KMF MGA RWF UGX VUV XPF`.
  - Provider ID.
- **Raw Data.** `<details>` "Click to expand" holding a pretty-printed `json_encode($submission)`, which includes `draft_token` and the payment fields.
- **Reply History** and **Send Reply:** §2.8.
- **Back link:** "‹ Back to submissions list".
- **Team card:** §2.9.

### 2.7 Editing a submission (`WP:src/admin/class-submission-editor.php`)

- **Form** (`:94-160`): one row per **stored** data key. Keys are shown raw.

  | Value | Control |
  |---|---|
  | Array that is a file or file list | Read-only text "File attachments cannot be edited." plus links |
  | Other array | Textarea (3 rows) with values joined by `\n`, hint "Multiple values are separated by new lines." |
  | String longer than 100 characters | Textarea (5 rows) |
  | Anything else | Text input |

  Buttons: **Save Changes** and **Cancel** (removes `edit`).
- **Save** (`:14-92`), via `admin.php?action=cf_save_submission`:
  - Requires `edit_forms`, nonce `cf_save_submission`, and team access.
  - Takes lock `payment:{id}`; a busy lock dies "This entry is busy. Reload before saving."
  - Posted keys go through `sanitize_text_field`. Values go through `sanitize_textarea_field` (array elements are mapped).
  - Stored file and file-list values are **always preserved** and never taken from the POST.
  - Writes `data` and `modified_at = current_time('mysql')`. That value is **site-local time while `submitted_at` is UTC**; normalise to UTC in the port.
  - Fires `cf_submission_written(admin_edit)`.
  - Redirects with `updated=1` or `error=1`.
- **Bug to fix in the port.** Multi-value fields post a single textarea string, so an array becomes one `"a\nb"` string. Split on newlines back into an array when the stored value was an array.
- **Not done:** re-validation against the form, an audit trail, or re-running actions.

### 2.8 Replying to a submitter (`WP:src/admin/class-submission-reply.php`)

**Recipient auto-detect** (`:129-148`):
1. Look for keys in `email, e-mail, your-email, user_email, contact_email, mail`, or any key containing `email`, whose value is a string passing `is_email`.
2. Otherwise, use the first value passing `is_email`.
3. If none is found, show a warning: "No email address found in the submission data. Please enter the recipient email manually."

**Form** (`:150-205`, POST to `admin.php?action=cf_send_reply`, nonce `cf_send_reply`):

| Field | Default |
|---|---|
| From (email, required) | `settings.reply_from_email`, or `admin_email` |
| To (email, required) | the detected recipient |
| Subject (required) | `"Re: {form title} submission"` |
| Message (textarea, 8 rows, required) | empty |

Button: **Send Reply** (dashicon email).

**Send** (`:20-84`):
- Checks `edit_forms`, the nonce, and `can_access_entry`.
- Sanitises: `to` with `sanitize_email` (must be valid, otherwise dies), `from` (falls back to `admin_email` when invalid), subject with `sanitize_text_field`, message with `wp_kses_post`. Subject and message are required.
- Headers: `Content-Type: text/html; charset=UTF-8`, `From: {blogname} <{from}>`, `Reply-To: {from}`.
- Body: `wpautop($message)`, sent with `wp_mail`.
- On success:
  - Insert into `cf_submission_replies` with `submission_id`, `from_email`, `to_email`, `subject`, raw (kses'd) `message` and `user_id`. Direction, channel and status take their defaults: `outbound`, `email`, `received`.
  - Set status to `replied`.
- **On failure nothing is stored.** Replies are **not** written to `cf_email_logs`.

**Threading.** There are no Message-ID, In-Reply-To or References headers, so the recipient's mail client does not thread anything. "Thread" means only the per-submission history list.

**History** (`:207-243`):
- Rows are ordered by `sent_at DESC`.
- Each item shows the author's display name (or a fallback) `<from>` → `to`, "%s ago", the subject, and `wpautop(esc_html(message))`. HTML replies therefore display escaped.
- Inbound and outbound WhatsApp rows from the same table also appear, with no direction or channel indicator.

**Settings section** "Reply Settings" (`:106-127`, hooked into `cf_admin_output_settings`): **Default Sender Email** `cf_settings[reply_from_email]`, placeholder `admin_email`.

### 2.9 Team inbox (4.11, `WP:src/admin/class-team-inbox.php`)

**Storage:**
- **Table `{prefix}cf_submission_team`** (`:50-58`): `submission_id` (PK), `assignee` (user ID, 0 = none), `due_at` (DATETIME, UTC), `hold` (TINYINT), `notes` (LONGTEXT JSON `[{author:int, at:'Y-m-d H:i:s' UTC, text}]`), `version` (INT, optimistic lock), `reminded_at`. Index `owner_due(assignee,due_at)`.
- **User meta** (keys are prefixed with `$wpdb->prefix` so they stay per-site on multisite, `:60-63`):
  - `{prefix}cf_form_scope`: an array of form IDs.
  - `{prefix}cf_inbox_views`: saved views.

**Access model:**
- `scope($user)` (`:64-69`): administrators (`manage_options`) return `null`, meaning every form. Otherwise the user meta array is returned, or `null` when that meta is missing. **A user with no scope meta sees every form.**
- `can_access($form,$user)` (`:70-77`):
  - the user needs `edit_forms`
  - `form_id 0` is allowed only for admins
  - the post must be a `core-form`
  - the form must be in scope
- `sql_scope()` (`:79-83`) returns `1=1`, `form_id IN (…)`, or `1=0` for an empty array.
- `grant_created_form` (`:45-49`): when a scoped user creates a form, it is appended to their scope.
- `guard_native_rest` (`:21-27`): `wp/v2/core-form` returns 403 when out of scope and **405 for any non-GET method**. Forms must be edited through `cf/v1`.
- `scope_native_query` (`:28-33`) adds `post__in` filtering to native REST listing.
- `scope_post_capability` (`:34-44`): `read_post`, `edit_post` and `delete_post` on forms, their revisions, and attachments with `_cf_form_id` meta return `do_not_allow` when out of scope.
- `assert_entries` (`:89-92`) resolves **all** IDs before any mutation and dies 403 on the first failure.

**Entry card** (`render()`, `:192-211`, under the detail view):
- h2 "Team", note "Assignments and notes are visible only to team members with access to this form."
- Existing notes: **author display name** (or "Former team member") · `at` (raw UTC string), then the text.
- **Assignee:** "Unassigned" plus `get_users(['number'=>200])` filtered to users who can access the form.
- **Due date:** `datetime-local` in the site timezone, followed by the timezone label.
- **Private note:** textarea, maxlength 10000.
- **Hold:** checkbox "Hold this entry and its files from automatic retention cleanup".
- **Save team details** button.

**Save** (`:100-132`, admin-post `cf_team_save`):
1. Takes lock `payment:{id}`.
2. Checks the version matches the posted `team_version`; otherwise dies "This entry changed. Reload before saving."
3. The assignee must have access to the form.
4. Due must parse as `Y-m-d\TH:i` in the site timezone, then converts to UTC.
5. The note is appended. Limits: 10,000 characters per note and 1,000 notes.
6. Upsert, then `UPDATE … WHERE version = old`, setting `version+1` and `reminded_at=NULL`.
7. Fires `cf_submission_written(team)`.
8. Redirects to the detail view. **Notes cannot be edited or deleted.**

**States.** There is no explicit state machine. The effective states are unassigned/assigned, no due/due/overdue (`due_at < now`), held, and reminded (`reminded_at` within 24 h).

**Views** (`render_views()`, `:212-244`):
- Links: **Assigned to me** (`assignee={current user}`), **Overdue** (`overdue=1`), and each saved view (`cf_view={key}`).
- "Save current filters": a name (required, at most 80 characters) plus hidden copies of `form_id, assignee, overdue, submission_status, spam_status, s, date_from, date_to`.
  - The key is `substr(sha256(name),0,16)`. Saving an existing name replaces it.
  - At most **30** views; otherwise dies "You can save up to 30 views. Use an existing view name to replace its filters."
- `load_view` (`:176-181`): at `admin_init` priority 1, a stored view's params are copied into `$_GET` only for keys that aren't already present.

**Manage team access** (admins only):
- A select of non-admin users (`get_users` limit 200).
- **Grant Core Forms access** checkbox, which runs `add_cap('edit_forms')`.
- Form checkboxes for every form.
- **Save access scope** **replaces** the user's scope (`save_scope`, `:133-144`).

**Reminders.**
- Daily cron `cf_team_reminders`, scheduled lazily on `init`, first run in 1 h.
- Query: up to 50 rows where `assignee>0`, `due_at<now`, the row isn't spam, status is not `archived`, `draft` or `partial`, and `reminded_at` is null or more than 24 h old.
- Sends `wp_mail(assignee email, "A Core Forms entry is overdue", "An entry assigned to you is overdue. Review it here: {detail URL}")`, then sets `reminded_at`.
- The assignee must still have access (`:182-191`).

### 2.10 Email logs

**What is logged.** `cf_log_email()` (`functions.php:3676-3718`) is called by:
- `actions/class-email.php:260`
- `class-autoresponder.php:156`
- `class-emailit.php:166`
- `class-whatsapp-cloud.php:291`
- `class-twilio-whatsapp.php:153`

A row is inserted with status `pending` before the send, then updated to `sent` or `failed` with an error message (`cf_update_email_log_status`, `:3729-3741`). For email actions the error comes from the captured `wp_mail_failed` error, then the PHPMailer `ErrorInfo`, then "Unknown error" (`class-email.php:271-291`). Non-email action types store phone numbers through `sanitize_text_field`. Admin replies and team reminders are **not** logged.

**Table `{prefix}cf_email_logs`** (`functions.php:3391-3416`):

| Column | Type |
|---|---|
| `id` | |
| `form_id` | |
| `submission_id` | NULL |
| `to_email` | |
| `from_email` | |
| `subject` | VARCHAR(500) |
| `message` | LONGTEXT |
| `headers` | TEXT, newline-joined |
| `status` | `pending` / `sent` / `failed` |
| `error_message` | |
| `action_type` | default `email` |
| `sent_at` | TIMESTAMP |

Indexes on `form_id`, `submission_id`, `status`. A guard creates the table once and records option `cf_email_logs_table_created` (`class-email-logs.php:21-28`).

**Screen** (`WP:views/page-email-logs.php`, `class-email-logs-table.php`):
- **Hero:** "Email Logs" with version badge, subtitle "Every notification and autoresponder this site tried to send, and whether the transport accepted it."
- **Stats:** Total emails, Accepted by transport (`sent`), Failed. These are team-scoped through `cf_count_email_logs`.
- **Search box:** "Search emails" matches `to_email LIKE` or `subject LIKE`.
- **Filters** (top tablenav): Form (accessible forms), Status (Sent, Failed, Pending), **Filter**.
- `cf_get_email_logs` supports `date_from` and `date_to` but **there is no UI** for them.
- **Columns:**

  | Column | Content |
  |---|---|
  | checkbox | `log_ids[]` |
  | Status | Badge, plus the error message under failed rows |
  | To | Row actions: **View Details**; **Resend** only for `failed` rows of type `email`, `autoresponder` or `emailit`; **Delete** |
  | Subject | or "(no subject)" |
  | Form | Link, `#id` when the form is deleted, or `—` |
  | Type | Email, Auto-Responder, Emailit, WhatsApp (Cloud), WhatsApp (Twilio), or raw |
  | Date | "%s ago" with an absolute title |

- **Sorting:** `sent_at` (default DESC), `status`. 20 per page.
- **Bulk:** Delete, posted to `_cf_admin_action=bulk_delete_email_logs`.
- **Detail modal:** To, From, Subject, Headers, Status, Error, Date, Message (as text). The data is preloaded as JSON for **only the latest 100 logs** (`:297`), so older rows open an empty spinner. That is a bug; the port should fetch by ID.
- **Resend** (`class-email-logs.php:89-116`): `wp_mail(to, subject, message, headers)` with the stored headers. It **does not update the original row or create a new log**.
- **Delete** checks that the log's `form_id` is accessible (`authorize_log`, `:48-52`). A log with `form_id` 0 is accessible only to admins.

**Retention:**
- There is **no automatic email-log retention**. `cf_delete_old_email_logs()` (`functions.php:3890-3898`) is never called.
- Logs are removed only by:
  - `wp core-forms submission cleanup` (`sent_at < cutoff`, §5)
  - per-entry erasure (§2.11)
  - uninstall

### 2.11 Retention, erasure, protected uploads (`WP:src/admin/class-privacy-controls.php`)

These are **per-form** settings, rendered at the bottom of the form Settings tab (`views/tab-settings.php:629`, `render()` `:204-213`):

| Setting | Notes |
|---|---|
| `submission_retention_days` | 0 to 3650; 0 = off |
| `attachment_retention_days` | 0 to 3650; 0 = off |
| `protect_uploads` | 0 or 1 |

A `<details>` "Preview saved retention policy" lists the next 100 entry IDs and attachment entry IDs.

**Candidates** (`:187-192`): `form_id` matches, `submitted_at < now - days`, `hold=0`, status not `draft`/`partial`, payment status null or `payment_failed`, and no pending work in:
- `cf_fulfillment`: status not `completed`, `failed` or `cancelled`
- `cf_action_queue`: `pending`, `retrying`, `processing` or `uncertain`
- `cf_payment_reversals`: `pending`, `processing` or `uncertain`

Results are ordered by ID, limit 100.

**Cron.** Daily `cf_retention_cleanup` (`:193-200`):
- For every form, delete entry candidates through `delete_submission(id, true)`.
- Retire attachments on attachment candidates: each file value is replaced with the string `"Attachment removed by retention"`.
- Writes option `cf_retention_last_run = {at, entries, attachments}`.

**`delete_submission(id, automatic)`** (`:123-150`), used by every delete path: inbox bulk actions, the spam handlers, GDPR erase, and retention.
1. Takes lock `payment:{id}`, starts a transaction, and runs `SELECT … FOR UPDATE`.
2. **Refuses** when there is pending work or the payment is pending. In automatic mode it also refuses when held, a draft, or paid.
3. Erases owned files: canonical-path and ownership checks, `wp_delete_file`, `wp_delete_attachment`. Any failure aborts.
4. Deletes rows from `cf_submission_replies`, `cf_email_logs`, `cf_action_queue`, `cf_action_logs`, `cf_submission_team`, `cf_fulfillment`, `cf_payment_reversals`, and finally `cf_submissions`.
5. Commits and fires `cf_submission_written(erase)`.

**REST:** `GET cf/v1/forms/{id}/retention-preview` returns `{entry_ids, attachment_entry_ids, limit:100}`.

**Protected download:** `admin-post.php?action=cf_private_download&attachment=ID` (logged in or not; access is checked; `:41-53`).

**GDPR** (`WP:src/admin/class-gdpr.php`):
- WordPress personal-data exporter and eraser, both named `core-forms`.
- Lookup: `data LIKE '%"email"%'` (with `esc_like`), then an exact-value confirmation.
- Export fields: Submitted at, IP address, User agent, then every field with arrays joined.
- Erase runs `delete_submission`. Retained items get the message "Entries needed for pending payment or fulfillment were retained."

---

## 3. Global settings

### 3.1 Storage and lifecycle

- **Option `cf_settings`**, registered with `register_setting('cf_settings','cf_settings', sanitize_settings)` (`class-admin.php:78-86`). The settings page posts to `options.php` (`settings_fields('cf_settings')`).
- **Read path:** `cf_get_settings()` (`functions.php:431-583`):
  1. Merge the defaults, then deep-merge `google_recaptcha`, `cloudflare_turnstile`, `emailit`, `whatsapp_cloud` and `payments`, including each provider sub-array.
  2. `currency_gateways` goes through `CurrencyGatewayRouter::sanitize_map`.
  3. Apply filter `cf_settings`.
  4. On a fresh install, write `[]`.
  5. **Legacy nonce rule:** when an existing install lacks `enable_nonce` and `cf_db_version < 4.2.0`, force `enable_nonce=0`.
- **Sanitiser** (`sanitize_settings`, `class-admin.php:243-340`):
  - Leaves unknown keys untouched. **There is no allowlist.**
  - Payment providers are **merged** with the stored values, so a page that didn't render a provider can't wipe it.
  - `license_server` is preserved when it isn't posted.

### 3.2 Every key

| Key | Default | UI (section → control) | Sanitise | Effect / consumer |
|---|---|---|---|---|
| `enable_nonce` | `1` on fresh installs (`0` on pre-4.2 installs without the key) | General → radio Yes/No | none (radio) | Adds a WordPress nonce to forms. Advise "No" behind full-page caches. |
| `enable_analytics` | `1` | General → radio Enable/Disable | int 0/1 | Site default for analytics. Per form `analytics_enabled` can be inherit, on or off. Consent filter `cf_should_track_analytics`. |
| `delete_data_on_uninstall` | `0` | General → checkbox (a hidden 0 is posted first) | hard 0/1 | Gates `uninstall.php` (§6) |
| `standalone_base_slug` | `collect` | General → text, pattern `[a-z0-9\-]+`, previewed as `{home}/` + input + `/form-slug/` | `StandaloneRoutes::sanitize_base_slug`. A collision with a page or public route keeps the old value and shows an error. | Base of `/{base}/{form-slug}/` standalone pages. Rewrites flush only on change. |
| `load_stylesheet` | `0` | General → "Skeleton CSS" radio Load/Skip | none | Loads `forms.css` (about 1.5 KB of structure). Per form `load_stylesheet` is `''` (inherit), `'1'` or `'0'`. |
| `load_form_theme` | `1` | General → "Default form theme" radio Load/Skip, with a link to the Customizer | int 0/1 | Loads `form-theme.css` plus the tokens. Per-form override. |
| `wrapper_tag` | `p` | General → select `p`, `div`, `span` (`class-admin.php:922`). Docs also mention `label`, but it isn't offered. | `sanitize_text_field` | Wrapper for the default skeleton and the legacy builder |
| `google_recaptcha.site_key` / `.secret_key` | `''` | Google reCAPTCHA v3 → text / password | none | Configured means both are set. Then reCAPTCHA applies to **all forms** (global). No score-threshold setting. |
| `cloudflare_turnstile.site_key` / `.secret_key` | `''` | Cloudflare Turnstile (hooked section) → text / **text** (the secret isn't masked) | none | Enabled **per form** ("Enable Turnstile" in the Spam settings) |
| `reply_from_email` | `''` (falls back to `admin_email`) | Reply Settings → email | none | Default From for admin replies (§2.8). `cf_get_default_reply_email()` (`functions.php:2709`). |
| `akismet_whitelist` | `''` | Spam Protection → textarea, one keyword per line, case-insensitive | none | Matching submissions bypass Akismet (`class-akismet.php:67`) |
| `emailit.api_key` | `''` | Emailit → password, placeholder `em_xxxxxxxx` | none | Enables the "Send Email via Emailit" action |
| `whatsapp_cloud.access_token` / `.phone_number_id` / `.business_account_id` | `''` | WhatsApp Cloud API → password / text / text, plus a **Test connection** button (AJAX `cf_whatsapp_cloud_test`, nonce `cf_whatsapp_cloud_test`; shows the verified name, phone and quality rating; doesn't save) | none | WhatsApp actions |
| `whatsapp_inbound.meta_verify_token` / `.meta_app_secret` / `.twilio_auth_token` | unset | WhatsApp Inbound Webhooks (hooked) → shows `rest_url('…/whatsapp/meta')` and `…/twilio` | `sanitize_text_field` each | Signed inbound replies are appended to the submission thread |
| `payments.mode` | `test` | Payments → segmented Test / Live | `test` or `live` | Selects the credential set |
| `payments.currency_gateways` | `CurrencyGatewayRouter::default_routes()` | Payments → Currency routing table (currency code, allowed gateways, default gateway; add/remove rows). Posted as `currency_gateway_rows` + `currency_routes_present`. | `sanitize_rows` / `sanitize_map` | Gateway enforcement per currency |
| `payments.stripe.{publishable_key_test, secret_key_test, publishable_key_live, secret_key_live, webhook_secret}` | `''` | Payments → gateway card (`settings_fields()` per gateway; mode-specific rows are hidden for the other mode); webhook URL with click-to-copy | `sanitize_text_field`, merged | Payments spec |
| `payments.paypal.{client_id_test, client_secret_test, client_id_live, client_secret_live, webhook_id}` | `''` | same | same | |
| `payments.razorpay.{key_id_test, key_secret_test, key_id_live, key_secret_live, webhook_secret}` | `''` | same | same | |
| `payments.polar.{access_token_test, access_token_live, webhook_secret}` | `''` | same | same | |
| `headless.api_key` | `''` | Headless / REST → password-or-text, buttons Show/hide, **Generate** (client-side `cf_` + 64 hex from 32 random bytes) and **Copy** | trim + `sanitize_text_field` | Required header `X-Core-Forms-Key` for headless submit. Empty disables headless. |
| `headless.allowed_origins` | `''` | Headless / REST → textarea, one origin per line | `sanitize_textarea_field` | CORS allowlist. Empty reflects any Origin, with a warning. |
| `fluentcart_mailerpress.list_id` / `.tag_id` | unset | Fluent Cart + MailerPress (only when both plugins are present) | none | Not portable. **Drop.** |
| `license_server.{enabled, dashboard_page_id, checkout_page_id, support_url}` | unset | Core Commerce settings screen, not this page | `enabled` 0/1, absint IDs, http(s) URL | Licensing spec |

Things that are **not** global settings in 4.11.1 (the parent brief asked for them):

- **No global From name or address for notifications.** From is set per Email action (`settings.from`). The only sender default is `reply_from_email`.
- **No global privacy or retention defaults.** Retention and protected uploads are per form (§2.11). GDPR erasure follows WordPress's tools.
- **No hCaptcha keys.** hCaptcha is handled by the third-party hCaptcha plugin; Core Forms only ignores its fields (`class-hcaptcha.php`).
- **Math CAPTCHA and the honeypot are per form.**
- **No asset-loading toggle beyond `load_stylesheet` and `load_form_theme`.**
- **No email-log retention setting.**

### 3.3 Settings page UI (`WP:views/page-global-settings.php`)

- **Hero:**
  - Title "Settings".
  - Subtitle "Defaults that apply to every form — security, styling, captcha keys, and email delivery."
  - **Documentation** button, linking to `gauravtiwari.org/portal/course/core-forms-training/lessons`.
- **Settings index nav** (`.cf-settings-index`), driven by `admin-ui.js:508-703`:
  - Built from the h2 sections.
  - One section shows at a time.
  - Search input "Search settings…" filters sections by text, with status "%d sections found" / "1 section found" / "No matching settings. Try another search."
  - **Show all sections** link.
  - The URL hash selects the section.
  - The `_wp_http_referer` hash is preserved on save.
- **Sections in DOM order:**

  | # | Section | Anchor / lines |
  |---|---|---|
  | 1 | General | `#cf-general`, `:48-153` |
  | 2 | Google reCAPTCHA v3 | `#cf-recaptcha`, `:155-188` (hook `cf_admin_output_google_recaptcha_v3_settings` inside its table) |
  | 3 | Emailit | `#cf-emailit`, `:190-211` |
  | 4 | WhatsApp Cloud API | `#cf-whatsapp`, `:213-296` |
  | 5 | Spam Protection | `#cf-spam-protection`, `:298-314` |
  | 6 | Payments | `#cf-payments`, `:316-536`; only when `cf_payments_orchestrator` returns an object |
  | 7 | Headless / REST | `#cf-headless`, `:538-658` |
  | 8 | `do_action('cf_admin_output_settings')` | `:660`; in registration order: Reply Settings, Cloudflare Turnstile, WhatsApp Inbound Webhooks, Fluent Cart + MailerPress |

- **Save bar** (`:662-665`): status text "No unsaved changes" / "Unsaved changes" / "Saving…" (dirty state compares serialised `cf_settings[*]` entries) and a **Save settings** button.
- **After the form:** `do_action('cf_admin_output_misc_settings')`. Nothing hooks it in 4.11.1.

### 3.4 Other persisted state (for migration and uninstall)

**Options:**

| Option | Purpose |
|---|---|
| `cf_settings` | §3.2 |
| `cf_form_theme_tokens` | §1.3.5 |
| `cf_db_version` | schema version, compared with `CF_SCHEMA_VERSION` |
| `cf_field_groups` | 4.11 reusable field groups; form-builder spec |
| `cf_retention_last_run` | §2.11 |
| `cf_migration_error` | schema migration error |
| `cf_email_logs_table_created` | table-creation guard |
| `cf_last_webhook_{stripe\|paypal\|razorpay\|polar}` | last webhook time, used by doctor |
| `cf_license_maintenance_last_run` | licensing |
| `core_forms_license*` | §1.3.10 |
| `cf_unsaved_capacity_*` | |
| `_cf_lock_*` | SQLite lease locks |

**Transients:** `cf_*`, including `cf_migrate_notice_*` and `cf_native_*` for no-JS responses.

**User meta:** `{prefix}cf_form_scope`, `{prefix}cf_inbox_views`. **User caps:** `edit_forms`, `manage_core_forms_licenses`.

**Form post meta:**

| Meta key | Purpose |
|---|---|
| `_cf_settings` | form settings |
| `cf_message_{key}` | message overrides |
| `_cf_form_schema` | |
| `_cf_headless` | |
| `_cf_hidden_columns` | |
| `_cf_live_definition` | draft publishing |
| `_cf_a11y_report` | |
| `_cf_unseen_submissions` | notification badges |
| `_cf_{cf7\|gf\|wpforms\|fluent}_source_id`, `_cf_ninja-forms_source_id`, `_cf_formidable-forms_source_id` | importer provenance |

Attachment meta: `_cf_form_id`, `_cf_submission_id`, `_cf_private_path`.

### 3.5 EmDash mapping

`admin.settingsSchema` supports only flat `string` (with `multiline`), `number`, `boolean`, `select`, `secret`, `url` and `email` fields (`EM:node_modules/emdash/dist/types-BT1p3uyb.d.mts:1510-1552`). Recommended split:

**Flat keys in `settingsSchema`** (auto-generated page):

| Key | Type |
|---|---|
| `enableNonce` | boolean, default true. In EmDash the meaning becomes "per-render anti-CSRF token". Confirm it is still needed with Workers and caching. |
| `enableAnalytics` | boolean, default true |
| `deleteDataOnUninstall` | boolean, default false |
| `standaloneBaseSlug` | string, default `collect`. A collision check needs a custom route; the schema can't validate it. |
| `loadStylesheet` | boolean, default false |
| `loadFormTheme` | boolean, default true |
| `wrapperTag` | select `p` / `div` / `span` |
| `recaptchaSiteKey` | string |
| `recaptchaSecretKey` | secret |
| `turnstileSiteKey` | string |
| `turnstileSecretKey` | secret |
| `hcaptchaSiteKey` / `hcaptchaSecretKey` | keep from v0.1.0; an EmDash addition |
| `replyFromEmail` | email |
| `akismetWhitelist` | string, multiline. Akismet itself needs a key on EmDash; owned by the spam spec. |
| `emailitApiKey` | secret |
| `whatsappAccessToken` | secret |
| `whatsappPhoneNumberId` / `whatsappBusinessAccountId` | string |
| `whatsappMetaVerifyToken` / `whatsappMetaAppSecret` / `twilioAuthToken` | secret |
| `headlessApiKey` | secret |
| `headlessAllowedOrigins` | string, multiline |
| `storeIp` | boolean; keep from v0.1.0 |

**A custom React Settings page** (`admin.pages` entry `/settings`) for what the schema can't express:
- The payments mode switch, per-provider credential cards and the currency-routing table. These are nested and dynamic; store them in KV `settings:payments` as one JSON value, with secrets encrypted. Payments spec.
- The WhatsApp "Test connection" button.
- The headless key Generate and Copy buttons.
- Standalone base collision validation.

Alternatively, render the whole page custom and keep `settingsSchema` only for secrets. **Decision needed:** EmDash encrypts only fields declared `secret` in `settingsSchema`. Confirm whether a custom page can write to the encrypted settings store, or whether secrets must be declared in the schema.

**Import mapping.** A WordPress `cf_settings` object maps to these keys (§4.7). `reply_from_email` and every per-action `from` can't be honoured while `EmailMessage` has no `from` field (§8.4).

---

## 4. Data portability

### 4.1 Migrate screen (`page=core-forms-migrate`)

Renderer: `CF7Migration::render_page` (`class-cf7-migration.php:42-145`). Layout from top to bottom:

1. h1 "Migrate", lead text "Back up or move Core Forms data, or bring forms across from another WordPress forms plugin."
2. `do_action('cf_migrate_render_native')`, which renders the native backup panel (§4.2). Users without `manage_options` see instead: "Core Forms data transfer — An administrator must export or restore site data because backups can contain submissions, customer details, API credentials, and license keys."
3. Result notices (§1.5).
4. Eyebrow "Other form plugins", h2 "Import forms from another plugin", note "Source forms are never modified, so both plugins can run side by side while you verify the migration."
5. **Source cards grid** (`role=list`):
   - CF7 first: "%d form(s) ready to import." (published + draft) or "Plugin not detected on this site."
   - Then the sources registered through filter `cf_import_sources`: `slug, title, description, available, count`. In bootstrap order these are Gravity Forms, WPForms, Fluent Forms, Ninja Forms, Formidable Forms.
   - Each card links to `?page=core-forms-migrate&source={slug}`. The active card gets `.is-active`.
   - "Coming soon" card styling exists but is unused.
6. **Active source panel.** `cf7` (the default) renders inline; other sources render through `do_action('cf_import_render_section', $source)`.

Inline styles: `:274-344`. These include the native panel's two-column grid, which collapses at 900 px.

### 4.2 Native Core Forms backup and restore (`WP:src/admin/class-core-data-migration.php`)

**Permissions.** Export and import both require `manage_options` plus their nonce (`authorize()`, `:1313-1318`).

**Datasets** (`:29-56`):

| Key | Label | Contents |
|---|---|---|
| `forms` | Forms | Form markup, settings, messages, actions, and other form metadata |
| `submissions` | Submissions | Entries, drafts, payment state, and reply history |
| `polls` | Polls | Poll definitions, settings, schedules, and votes |
| `settings` | Settings and form theme | Core Forms settings, integrations, payment credentials, and theme tokens |
| `activity` | Activity and analytics | Email logs, workflow history, queued actions, and form analytics |
| `commerce` | Core Commerce | Products, plans, orders, subscriptions, licenses, activations, releases, and download history |

**Export panel** (`:105-149`):
- Checkboxes for every dataset, all checked, with a **Select all data** toggle that supports the indeterminate state.
- "Form scope" select:
  - "All forms and related records"
  - "Only selected forms and related records", which reveals a multi-select of forms.
  - The note reads: "Form scope filters Forms, Submissions, and Activity. Polls, Settings, and Core Commerce remain site-wide."
- Warning: "Keep the file private. Selected data can include personal information, payment credentials, and software license keys."
- Button **Download JSON export**.

**Import panel** (`:151-194`):
- File input (`.json`). Client-side, FileReader parses the file and **disables dataset checkboxes not present** in it. Summary "Available data: …" or "This file does not look like a Core Forms portable export."
- Dataset checkboxes.
- "Matching forms and products" select:
  - `create`: "Create new forms; reuse matching commerce records" (the default)
  - `update`: "Update records with the same slug or unique key"
  - `skip`: "Skip records that already exist"
- Warning about backups and that media isn't embedded.
- Button **Import selected data**.

**Export handler** (`:204-237`):
- Errors: "Select at least one data type to export." and "Choose at least one form for a selected-form export."
- Encoded with `JSON_PRETTY_PRINT | UNESCAPED_SLASHES | UNESCAPED_UNICODE | INVALID_UTF8_SUBSTITUTE`.
- Filename `core-forms-{sanitized host}-{Y-m-d-His}.json`.
- `nocache` and `nosniff` headers.

**Import handler** (`:242-284`):
- The file is required, must be between 1 byte and `min(wp_max_upload_size, 100 MB)`, and must be valid JSON passing `validate_payload`.
- The selected datasets are intersected with the datasets present in the file.
- Report: "Import complete: %1$d created, %2$d updated, and %3$d skipped." plus up to 12 unique warnings.

#### 4.2.1 Exact JSON format (`format_version` 1)

`build_export()` is at `:293-356`.

```jsonc
{
  "format": "core-forms-data",                 // constant FORMAT
  "format_version": 1,                          // constant FORMAT_VERSION; import rejects != 1
  "plugin_version": "4.11.1",                  // CORE_FORMS_VERSION
  "created_at": "2026-10-05T04:03:41+00:00",   // gmdate('c')
  "source": { "home_url": "https://…", "site_url": "https://…" },
  "selection": { "datasets": ["forms","submissions",…], "form_ids": [12,15] },  // [] = all forms
  "notes": [
    "Media files and uploaded packages are referenced, not embedded.",
    "The site-bound Core Forms updater license and generated caches are intentionally excluded."
  ],
  "references": {
    // Always present. Keyed by OLD form ID (JSON object). Built from the same
    // form scope, independent of whether "forms" was selected.
    "forms": { "12": { "slug": "contact", "title": "Contact" } },
    // [] when empty, otherwise an object keyed by OLD attachment ID. Filled only
    // when "commerce" is exported: product icon_attachment_id,
    // details.gallery_ids[], package attachment_id.
    "media": { "88": { "url": "https://…/file.zip", "filename": "file.zip" } }
  },
  "data": {                                     // only the selected datasets appear
    "forms": { "posts": [ PostRow, … ] },       // post_type core-form, ORDER BY ID
    "submissions": {
      "cf_submissions": [ Row, … ],             // SELECT * [WHERE form_id IN (…)]
      "cf_submission_replies": [ Row, … ]       // WHERE submission_id IN (exported ids)
    },
    "polls": {
      "posts": [ PostRow, … ],                  // post_type core-poll (always site-wide)
      "cf_polls": [ Row, … ],
      "cf_poll_votes": [ Row, … ]
    },
    "settings": {
      "options": {
        "cf_settings": { … },                   // raw get_option, includes secrets
        "cf_form_theme_tokens": { "--cf-text": "#0f172a", … }
      }
    },
    "activity": {                               // each filtered by form_id when scoped
      "cf_email_logs": [ Row, … ],
      "cf_analytics": [ Row, … ],
      "cf_action_queue": [ Row, … ],
      "cf_action_logs": [ Row, … ]
    },
    "commerce": {                               // site-wide; each table SELECT *
      "cf_license_products": [], "cf_license_plans": [], "cf_license_orders": [],
      "cf_license_order_items": [], "cf_licenses": [], "cf_license_activations": [],
      "cf_license_packages": [], "cf_license_subscriptions": [],
      "cf_license_downloads": [], "cf_license_events": []
    }
  }
}
```

**PostRow** (`export_posts`, `:562-594`):

```jsonc
{
  "id": 12, "post_title": "Contact", "post_name": "contact", "post_content": "<p>…</p>",
  "post_excerpt": "", "post_status": "publish", "post_author": 1,
  "post_date": "2026-01-02 10:00:00", "post_date_gmt": "2026-01-02 04:30:00", "menu_order": 0,
  "meta": {
    // EVERY post meta key; values are arrays (one per meta row), each maybe_unserialize()d.
    "_cf_settings": [ { "save_submissions": "1", "actions": [ {…} ], … } ],
    "cf_message_success": [ "Thanks!" ],
    "_cf_form_schema": [ {…} ], "_cf_headless": [ {…} ], "_cf_hidden_columns": [ [ "ip" ] ],
    "_cf_live_definition": [ … ], "_cf_a11y_report": [ {…} ],
    "_cf_unseen_submissions": [ [ 101, 102 ] ],   // OLD submission ids, not remapped on import
    "_edit_lock": [ "…" ], "_edit_last": [ "1" ]  // core meta rides along too
  }
}
```

**Row:** `$wpdb->get_results('SELECT * …', ARRAY_A)` (`:618-641`). **Every value is a string or null**, exactly as MySQL returned it: `"id":"7"`, `"is_spam":"0"`, `"payment_amount":"1999"`. JSON columns arrive as encoded strings:
- `cf_submissions.data`
- `cf_action_queue.action_settings`
- `cf_action_logs.meta`
- `cf_analytics.meta`
- `cf_license_products.details`
- `cf_polls.options` / `settings`

Timestamps are `"Y-m-d H:i:s"`; treat `cf_submissions` timestamps as UTC. The table columns are in `functions.php:2300-2341` (submissions), `:2346-2369` (polls), `:2376-2396` (poll votes), `:3391-3416` (email logs), `:3424-3449` (replies), `WP:src/analytics/class-tracker.php:290-305`, `WP:src/workflows/class-action-queue.php:353-372` and `WP:src/workflows/class-action-logger.php:284-302`. The licensing tables are at `functions.php:3466-3610` (licensing spec).

**Validation** (`validate_payload`, `:363-378`):
- `format === 'core-forms-data'`, otherwise "This is not a Core Forms portable data export."
- `format_version === 1`, otherwise "This export format is not supported by this Core Forms version."
- `data` is a non-empty object, otherwise "This Core Forms export does not contain any datasets."
- `data` has no keys outside the six datasets, otherwise "This export contains unsupported data types."

**Deliberately or silently not exported** (the port must decide each one):
- The updater licence and generated CSS or cache files. Deliberate, per the notes.
- Media binaries, uploaded form files and release ZIPs. Referenced only.
- **`cf_submission_team`** (assignments, notes, holds). **Not exported.**
- **`cf_fulfillment` and `cf_payment_reversals`.** Not exported.
- **Option `cf_field_groups`.** Not exported.
- **User meta `cf_form_scope` and `cf_inbox_views`.** Not exported.
- **Form revisions** (`revision` posts). Not exported.
- `cf_db_version` and the other options in §3.4.

#### 4.2.2 Import algorithm (`import_payload`, `:386-464`)

Datasets are imported in this order, carrying ID maps for `forms`, `submissions`, `poll_posts`, `polls`, `queue`, `products`, `plans`, `orders`, `items`, `licenses` and `packages`.

**1. forms** (`import_posts`, `:650-718`):
- Status is kept only if it is `publish`, `draft`, `pending` or `private`; anything else becomes `draft`.
- Slug is `sanitize_title(post_name || post_title)`. The match is `get_page_by_path(slug)`.
- Policy:
  - `skip`: map old to the existing ID and count it as skipped.
  - `update`: `wp_update_post` on the match.
  - `create` (or no match): insert. On a slug collision, `wp_unique_post_slug` is used.
- The author is kept if that user exists, otherwise it becomes the current user. Dates go through `mysql_date()` (`:1292-1295`; an unparseable date becomes the current time).
- For every meta key (`sanitize_key`ed), the existing meta is deleted and each value is added.

**2. Form references** (`:726-738`): old form IDs that weren't imported are mapped to existing forms by slug from `references.forms`, so submissions can attach to forms already on the site.

**3. submissions** (`:745-784`):
- Rows whose old `form_id` can't be mapped are skipped, with the warning "Some submissions were skipped because their forms were not imported or matched by slug."
- Every row is **inserted with a new ID**. **There is no dedupe**: re-running an import duplicates submissions regardless of policy.
- Replies are remapped by submission ID; `user_id` is kept only if that user exists.
- `insert_row` (`:1140-1158`) drops `id`, keeps only columns that exist on the destination, and fires `cf_submission_written(import)`.
- `is_spam`, `status`, `draft_token` (resume links survive) and the payment columns are preserved verbatim.

**4. polls** (`:791-831`): `core-poll` posts, then `cf_polls` (`post_id` remapped), then `cf_poll_votes` (`poll_id` remapped, `user_id` validated).

**5. settings** (`:837-850`): only `cf_settings` (autoloaded) and `cf_form_theme_tokens` (not autoloaded) are written. Each counts as one "updated". The theme CSS asset is regenerated. **Settings are replaced wholesale, including secrets.**

**6. activity** (`:857-903`):
- `form_id` is remapped. Rows whose form can't be mapped are skipped.
- `submission_id` is remapped when known. Otherwise:
  - queue and logs rows are skipped, with a warning
  - email logs get `submission_id = null`
- `cf_action_logs.queue_id` is remapped or set to null.
- **Queue rows with status `pending`, `processing` or `retrying` become `failed`** with `last_error` "Paused during Core Forms data migration. Review before retrying."

**7. commerce** (`:913-1016`), in dependency order:
- products: icon and gallery media resolved by the old ID if it is a local attachment, otherwise by URL through `attachment_url_to_postid`; `checkout_form_id` and `renewal_form_id` remapped
- plans
- orders: form, submission and user remapped
- licenses: `order_item_id` nulled
- order items: `license_id` nulled
- then `repair_commerce_links` fixes the circular references
- subscriptions
- packages
- activations, downloads, events

Natural keys: products by `slug`; plans by `product_id + slug`; orders by `order_number`; licenses by `license_key`; subscriptions by `license_id`; packages by `product_id + version`. On a natural-key match, `update` updates the row and `create`/`skip` reuse it (counted as skipped). Licensing spec.

**Known import defects** (fix in the port's importer):
- Submissions and replies duplicate on re-import.
- `_cf_unseen_submissions` keeps old submission IDs.
- `_cf_settings.actions[*]` values that reference other entities (for example license product IDs or other form IDs) are **not remapped**.
- `_cf_live_definition` and `_cf_a11y_report` are copied as-is.
- **WordPress core meta** (`_edit_lock`) is copied.
- `sanitize_key` lowercases meta keys.

### 4.3 WP-CLI form export format (a different, older format)

`wp core-forms form export` (`WP:src/cli/class-form-command.php:50-87`):

```jsonc
{ "schema": 1, "plugin_version": "4.11.1", "forms": [ {
    "title": "…", "slug": "…", "status": "publish", "markup": "<p>…</p>",
    "schema": { … } | "",                              // _cf_form_schema
    "definition": {                                    // FormDefinition::snapshot()
      "title": "…", "slug": "…", "status": "…", "markup": "…",
      "meta": { "_cf_settings": {…}, "_cf_form_schema": {…}, "_cf_headless": {…},
                "_cf_hidden_columns": […], "cf_message_success": "…", … }  // ksorted
    },
    "settings": { … },
    "messages": { "success": "…", "invalid": "…", "required": "…" }   // only 3 keys
} ] }
```

- Note there is **no `id`**. CLI import (`:102-144`) always creates new posts. It prefers `definition` (`FormDefinition::restore`) over `schema` and passes the markup through `sanitize_markup()`.
- **Bug:** the `messages.invalid` key maps to meta `cf_message_invalid`, which isn't a real message key; the real one is `invalid_email` (`views/tab-messages.php:12-37`). Full messages only travel through `definition.meta`.

**The port's v0.1.0 exporter** (`EM:wordpress/export-core-forms.php`) is a third format: `[ {id, slug, title, status, markup, settings, messages:{key:value}, created, modified} ]`. The port's importer accepts that format, an array, or `{forms:[…]}` (`EM:src/admin/helpers.ts:619-627`, `EM:src/routes.ts:296-315`). **It skips any form without an `id`**, which means:
- CLI exports (`schema:1`) are silently skipped.
- A `core-forms-data` file is treated as a single form and skipped.

### 4.4 Competitor importers: shared plumbing

**`BaseMigration`** (`WP:src/admin/class-base-migration.php`):
- `hook()` registers `admin_post_{post_action}`, filter `cf_import_sources` and action `cf_import_render_section`.
- `handle_submit()` requires `edit_forms` plus the nonce, takes `$_POST[{id_field}][]`, calls `migrate_one()` for each, and redirects with `imported[]` (new IDs), `skipped[]` (source IDs) and `source` (`:109-136`).
- The unavailable-source panel reads: "{Plugin} isn't active on this site. Activate {Plugin} (or import a database with its data)…".
- Each panel has a **Select all** toggle, an **Import selected forms** button, and a per-form list showing the title, the source shortcode, and field, notification, webhook or entry counts.
- `insert_core_form()` (`:213-234`): publish, title (default "Imported {Source} form"), unique slug (`-2`, `-3`, …), meta `_cf_settings`, provenance meta.
- Settings are always `{hide_after_success:1, redirect_url, actions}`. **Everything else takes the defaults.**
- `build_email_action()` (`:158-192`):

  ```
  { type:'email', to, from, subject, message (default '[all:label]'),
    content_type: html ? 'text/html' : 'text/plain',
    headers: "Reply-To: …\nCc: …\nBcc: …", conditions? }
  ```

  `conditions` items are `{field, operator:'equals'|'not_equals', value}`, evaluated by `cf_evaluate_action_conditions`, so all conditions must pass.
- `build_conditional_attr()` (`:257-274`) emits **one** rule as ` data-show-if="field:value"` or `data-hide-if`. An empty value becomes `*` (any non-empty). Negated operators (`isnot`, `!=`, `!==`, `not_equals`) flip show and hide. Only the first usable rule is kept.

**`StructuredMigration`** (`WP:src/admin/class-structured-migration.php`), used by Ninja and Formidable:
- Normalised source shape: `{id, title, fields:[{id,type,name,label,required,placeholder,options}], actions, success, redirect}`.
- `field_name()`: `sanitize_key(name)`, or `sanitize_key(label)_{id}` (`:104-109`).
- Token translation (`:111-128`): `{all_fields_table}`, `{fields_table}` and `[default-message]` become `[all:label]`; `{field:<key>}`, `[<key>]`, `{field:<id>}` and `[<id>]` become `[<name>]`.
- Webhook actions are `{type:'webhook', url, content_type:'application/json'}`. That value isn't one of the `json`/`form` values Fluent uses; normalise it.
- `render_field` (`:69-102`) emits **no `for`/`id` pairing for radio and checkbox groups**. The `condition` key is supported, but **neither Ninja nor Formidable populates it**, so conditions are never imported despite the card text.

**Common output conventions:**
- Labelled fields are wrapped in `<p>`: `<label for="cf-{name}">`, then the control with `id="cf-{name}"`, then an optional `<small>` description.
- Radio and checkbox groups become `<fieldset><legend>`.
- Dropped elements become HTML comments.
- A submit button is appended.

#### 4.4.1 Contact Form 7 (`WP:src/admin/class-cf7-migration.php`)

- **Detection:** `post_type_exists('wpcf7_contact_form')`. Count is published + draft. The list shows up to 200 posts ordered by title.
- **Reads post meta:**
  - `_form`: the CF7 tag template
  - `_mail`: `{recipient, sender, subject, body, additional_headers, attachments, use_html}`
  - `_messages`
- **Not read:** `_mail_2` (autoresponder), `_additional_settings`, Flamingo entries.
- **Row extras:** detected field names (`/\[(?:[a-z_]+\*?)\s+([a-zA-Z0-9_-]+)/`, excluding submit and button), shortcode `[contact-form-7 id="N"]`, and a `<details>` "Preview converted HTML".
- **Tag conversion** (`convert_markup`, `:489-598`). Regex: `\[(type)(\*?)(?:\s+(name))?(attrs)\]`. In attrs:
  - quoted strings become `values`
  - `id:` and `class:` tokens are extracted
  - other tokens become `flags`
  - the `placeholder` flag uses the first value as the placeholder; otherwise the first value is the default
  - `*` means `required`

  | CF7 tag | Output |
  |---|---|
  | text | `<input type=text …value=default>` |
  | email, tel, url | matching input type |
  | number, range | `type=number` |
  | date | `type=date` |
  | hidden | `<input type=hidden value=default>` |
  | textarea | `<textarea>default</textarea>` |
  | select | options from values; the `multiple` flag gives `name[]` plus `multiple` |
  | checkbox | one `<label><input type=checkbox name="n[]">` per value; with no values, a single `value=1` |
  | radio | one labelled radio per value |
  | acceptance | required checkbox labelled with the first value, or "I accept." |
  | file | `type=file` with `accept` from the first value |
  | submit | `<button type=submit>` with the first value, or "Submit" |
  | quiz, captchac, captchar, recaptcha | `<!-- CF7 {type} tag dropped during import; configure spam protection in Core Forms → Settings -->` |
  | other | `<!-- CF7 [type] tag not converted -->` |

  Surrounding HTML (labels, `<p>`) is preserved verbatim. Field names keep hyphens (`your-name`), so mail tokens `[your-name]` keep working.
- **Mail:** one Email action (`:660-686`) with `to=recipient`, `from=sender`, subject, `message=body` (default `[all:label]`), `content_type` from `use_html`, and `headers=additional_headers` verbatim.
- **Messages** (`:439-462`):

  | CF7 key | Core Forms key |
  |---|---|
  | mail_sent_ok | success |
  | mail_sent_ng | error |
  | validation_error, invalid_required | required_field_missing (first non-empty wins) |
  | invalid_email | invalid_email |
  | spam | spam |
  | captcha_not_match | math_captcha_failed |

- **Settings:** `hide_after_success=1`, `redirect_url=''`. Provenance meta `_cf_cf7_source_id`.
- **Skip rule:** a form is skipped when the converted HTML is empty.

#### 4.4.2 Gravity Forms (`WP:src/admin/class-gravity-forms-migration.php`)

- **Detection:** `class_exists('GFAPI')` or `GFForms`. Reads through `GFAPI::get_forms(null)` and `GFAPI::get_form($id)`.
- **Field names:** `sanitize_key(adminLabel || label) + '_' + id`, or `field_{id}` (`:197-204`). Names are therefore **not** the GF input IDs.
- **Fields** (`:215-311`):

  | GF type | Output |
  |---|---|
  | text, phone→tel, website→url | input |
  | hidden | hidden input with `defaultValue` |
  | email, number, date, time, textarea | matching control |
  | select / multiselect | options from `choices{text,value,isSelected}`; placeholder as an empty first option |
  | radio / checkbox | fieldset |
  | fileupload | `multipleFiles` gives `name[]` plus `multiple` |
  | name | `{n}_first`, `{n}_last`, with **no label** |
  | address | `{n}_street`, `_city`, `_state`, `_zip`, `_country` |
  | consent | checkbox labelled with `checkboxLabel` |
  | page, section, html, captcha | comment |
  | other | text input |

  `isRequired` becomes `required`, `placeholder` and `description` carry over, and the submit text comes from `button.text`.
- **Field conditional logic:** `conditionalLogic{actionType, rules[{fieldId, operator, value}]}` becomes `data-show-if` or `data-hide-if`. Only `is` and `isnot` are understood; every other GF operator (`>`, `<`, `contains`, `starts_with`, …) is **treated as `is`**.
- **Notifications** (every one, **including inactive ones**; the `isActive` flag is ignored):
  - `to`, `from`, `subject`, `message` (default `[all:label]`), `replyTo`, `cc`, `bcc`, `enableHtml` → `html`.
  - Notification `conditionalLogic.rules` become `conditions` (`isnot` → `not_equals`, else `equals`).
  - **`toType`** (`field`, `routing`) is **ignored**. `to` may be a numeric field ID or empty for routing.
- **Merge tags** (`:416-423`) are replaced literally:

  | GF tag | Core Forms tag |
  |---|---|
  | `{all_fields}` | `[all:label]` |
  | `{date_mdy}`, `{date_dmy}` | `[CF_TIMESTAMP]` |
  | `{ip}` | `[CF_IP_ADDRESS]` |
  | `{post_title}` | `[CF_POST_TITLE]` |
  | `{user_email}` | `[CF_USER_EMAIL]` |
  | `{embed_url}` | `[CF_REFERRER_URL]` |

  **Field tags `{Label:3}` are not translated.** The docs claim `{field:name}` becomes `[name]`; that is a doc mismatch.
- **Confirmations:** the loop takes `isDefault` (or the first one when the success message is still empty). `type=redirect` gives `redirect_url=url`, otherwise `cf_message_success=message`, with merge tags translated and kses'd. `type=page` is not handled.
- **Not imported:** entries, feeds and add-ons, calculations, multi-page, `limitEntries`, scheduling. Provenance meta `_cf_gf_source_id`.

#### 4.4.3 WPForms (`WP:src/admin/class-wpforms-migration.php`)

- **Detection:** `post_type_exists('wpforms')` or `function_exists('wpforms')`.
- **Definition:** `post_content` holds slashed JSON. It is unslashed and decoded (`:173-178`) into `{fields:{id:{…}}, settings:{notifications, confirmations, submit_text}}`.
- **Field names:** `sanitize_key(label)_{id}`, or `field_{id}`.
- **Fields** (`:258-310`):

  | WPForms type | Output |
  |---|---|
  | text, phone→tel, url, address | a single text input (**address is not split**) |
  | email, number, number-slider | matching input |
  | date-time | `type=date` |
  | textarea, select | matching control |
  | radio / checkbox | choices `{label, value, default}` |
  | name | `_first`, `_last` |
  | file-upload | file input |
  | gdpr-checkbox | `gdpr-label` |
  | html, divider, pagebreak | comment |
  | other | text input |

- **Conditions:** `conditional_logic` plus `conditional_type` (show or hide) plus `conditionals` (OR groups of AND rules). Only the first group is read, then the first usable rule; `!=` becomes `isnot`.
- **Notifications:**

  | WPForms key | Core Forms field |
  |---|---|
  | `email` | `to` |
  | `sender_address` | `from` |
  | `subject` | `subject` |
  | `message` | `message`, with `{all_fields}` → `[all:label]` |
  | `replyto` | `reply_to` |
  | `carboncopy` | `cc` |

  HTML is always on. Conditions come from the first group. **Other smart tags (`{field_id="3"}`) are not translated.**
- **Confirmations:** `redirect` or `page` gives `redirect_url = redirect || page_url` (`page_url` usually doesn't exist; the page ID isn't resolved). Otherwise the first message becomes the success message.
- **Entries** (Pro only; `{prefix}wpforms_entries` must exist, and the "Also import existing entries" checkbox is on by default):
  - Reads `entry_id, fields, ip_address, user_agent, referer, date`.
  - The data key is `sanitize_key(field.name ?: 'field_'+fid)` and the value is a string (arrays are joined with `, `).
  - **Bug:** the entry keys are derived from the label (`name`), but the form markup names are `label_id`. **Imported entries don't line up with the imported form's fields.** Use the same `compute_field_name` as the form.
  - Status, spam flag, starred and read state, notes, payments and files are not carried over.
  - A zero or empty date becomes the current time.
- Provenance meta `_cf_wpforms_source_id`.

#### 4.4.4 Fluent Forms (`WP:src/admin/class-fluent-forms-migration.php`)

- **Detection:** the table `{prefix}fluentform_forms` exists. The plugin can be inactive. The list shows `id, title, status`, limited to 200, and flags status other than `published`.
- **Definition:** `form_fields` JSON `{fields:[…], submitButton:{settings:{button_ui:{text}}}}`.
- **Field names:** `sanitize_key(attributes.name)`, or `field_{md5 prefix}`. Fluent names are kept, so they match Fluent entries.
- **Fields** (`:191-266`):

  | Fluent element | Output |
  |---|---|
  | input_text, input_url, input_password, input_tel, phone, input_hidden | matching input |
  | input_email, input_number | matching input |
  | input_date, input_date_time | `date` / `datetime-local` |
  | textarea | textarea |
  | select | `settings.advanced_options[{label,value}]` |
  | select_country | text input |
  | multiselect, multi_payment_component | multi-select |
  | input_radio, input_checkbox | fieldset |
  | input_file, input_image | file input |
  | gdpr_agreement, terms_and_condition | required checkbox with `tnc_html` |
  | container, input_repeat, tabular_grid | recurse into `columns[].fields` inside `<fieldset>` |
  | section_break, custom_html, recaptcha, hcaptcha, turnstile | comment |
  | other | text input |

  **`input_name` (the compound name field) falls to the default text input** and its sub-fields are lost.
- **Conditions:** `settings.conditional_logics{status, conditions[{field, operator, value}]}`, always as **show**. `type:any` (OR) isn't distinguished.
- **Meta** (`{prefix}fluentform_form_meta`, `:381-411`):
  - `notifications` is decoded.
  - `formSettings` is decoded.
  - Any `meta_key` containing `webhook` is collected if it has `request_url` or `url`.
  - **Likely bug:** Fluent stores **one row per notification**, all with `meta_key='notifications'`. The loader overwrites, so only the last row survives, and the importer then iterates over **that single notification's keys**. Verify against a real export.
- **Notifications:**
  - `sendTo.email || email` → `to`
  - `fromEmail` → `from`
  - `subject`
  - `message`, with `{all_data}` → `[all:label]`
  - `replyTo`, `cc`, `bcc` (arrays are joined)
  - HTML is always on
  - `conditionals.status` + `conditions` become `conditions`
  - `sendTo.type` (field, routing) is ignored
- **Webhooks:** `{type:'webhook', url: request_url||url, content_type: request_format=='json' ? 'json' : 'form', auth_header_name: auth_key_name, auth_header_value: auth_key_value}`.
- **Confirmation:** `formSettings.confirmation.redirectTo` of `customUrl` or `redirect` gives `redirect_url = customUrl`; otherwise `messageToShow`. `samePage` and `customPage` are not resolved.
- **Entries are not imported.** Provenance meta `_cf_fluent_source_id`.

#### 4.4.5 Ninja Forms (`WP:src/admin/class-ninja-forms-migration.php`)

- **Detection:** `function_exists('Ninja_Forms')`. Reads `Ninja_Forms()->form()->get_forms()`, `->form($id)->get_fields()` and `->get_actions()`, using `get_settings()`.
- **Field types:**

  | Ninja type | Normalised type |
  |---|---|
  | textbox, firstname, lastname | text |
  | email | email |
  | textarea | textarea |
  | listselect | select |
  | listmultiselect | multiselect |
  | listradio | radio |
  | listcheckbox | checkboxes |
  | checkbox | checkbox |
  | number | number |
  | phone | phone |
  | date | date |
  | file_upload | file |
  | hidden | hidden |
  | html | html |
  | hr | hr |
  | submit | skipped |
  | other | text |

  The name comes from Ninja's `key`. Options are `{label, value}`.
- **Actions:**

  | Ninja action | Result |
  |---|---|
  | `email` | `to`, `from_address`, `email_subject`, `email_message`, `reply_to` |
  | `successmessage` | `success_msg` → success message |
  | `redirect` | `url` → redirect |
  | `webhooks` / `webhook` | `remote_url \|\| url` |

- Merge tags `{field:key}` translate through the structured importer.
- **Conditions are not imported** (the Conditional Logic add-on stores them elsewhere). Submissions aren't imported. Note: `source_forms()` is recomputed for every `migrate_one` call, which is O(n²).

#### 4.4.6 Formidable Forms (`WP:src/admin/class-formidable-forms-migration.php`)

- **Detection:** `FrmForm` and `FrmField`. Reads `FrmForm::getAll(['is_template'=>0],'name')`, `FrmField::get_all_for_form($id,'','include')` and `FrmFormAction::get_action_for_form($id)`.
- **Field types:**

  | Formidable type | Normalised type |
  |---|---|
  | text, email, url, phone, number, textarea, select, radio, date, file, hidden, html | same |
  | checkbox | checkboxes |
  | divider | section |
  | other | text |

  The name is `field_key` (random keys such as `abc12`). `options` and `field_options.placeholder` are unserialized.
- **Actions** (identified by `post_excerpt`):

  | Action | Fields |
  |---|---|
  | `email` | `email_to`, `from`, `email_subject`, `email_message`, `reply_to` |
  | `redirect` | `redirect_url` |
  | `message` | `success_msg` |

  In Formidable, the success message and redirect usually live in the **form options** (`options.success_msg` / `success_action`), so many forms import with no success message. Verify.
- **Not imported:** conditions, entries.

### 4.5 Which importers make sense on EmDash

All six importers read a **live WordPress database** through PHP APIs or tables. EmDash runs on Workers with D1 and can't do that. Options:

1. **(Recommended) A single read-only WP-CLI dump script**, extending the existing `EM:wordpress/export-core-forms.php`. It would emit a normalised JSON envelope per source plugin: raw definitions, raw notifications and confirmations, and optionally entries, all unserialized server-side. EmDash then runs the importers in TypeScript against that envelope. Benefits: one code path, PHP serialization handled where it is native, every importer's logic ported once, and no guessing at each vendor's export format.
2. **Accept each plugin's own export file.** The formats differ, and several embed PHP-serialized data:

| Source | Native export (verify each against a sample file) | Contents | Usable for |
|---|---|---|---|
| Contact Form 7 | No CF7 export. WordPress **Tools → Export (WXR XML)** of `wpcf7_contact_form`. | `<wp:postmeta>` with `_form`, `_mail`, `_mail_2`, `_messages`, `_additional_settings`; `_mail*` and `_messages` are **PHP-serialized** | Forms; needs WXR plus a PHP-unserialize parser |
| Gravity Forms | Forms → Import/Export → **Export Forms** (`gravityforms-export-YYYY-MM-DD.json`) | JSON object of form arrays (fields, notifications, confirmations) plus `version` | Forms; entries only as **CSV** (Export Entries) |
| WPForms | WPForms → Tools → **Export** forms (JSON) | Array of form-data objects (the same shape as `post_content`) | Forms; entries CSV (Pro) |
| Fluent Forms | Fluent Forms → Tools → **Export Forms** (JSON) | Array of `{id, title, form_fields (JSON string), status, …, metas:[{meta_key, value}]}` | Forms, notifications, webhooks; entries via CSV/JSON export (verify JSON) |
| Ninja Forms | Ninja Forms → Import/Export → **Export Forms** (`.nff`) | JSON-encoded form with settings, fields and actions | Forms and actions; submissions CSV |
| Formidable | Formidable → Import/Export (**XML**; CSV for entries) | Custom XML of forms, fields, actions, optional entries; serialized options | Forms and actions |

**Recommendation:**
- Ship option 1 first, for parity with 4.11.1 behaviour, which reads the database.
- Support Gravity and WPForms JSON uploads as a second step; their JSON is self-contained.
- Fluent's JSON export carries `metas`, so it is also straightforward.
- Postpone CF7 WXR, Ninja and Formidable.
- **Fix the importer bugs listed in §4.4** while porting. Do not reproduce them.

### 4.6 Core Forms (WordPress) → EmDash import requirements

This is the import path that matters most. The importer must accept:

1. **`core-forms-data` v1** (§4.2.1). Primary, full fidelity.
2. **The CLI `schema:1` export** (§4.3). These forms have no `id`: create new ones and fall back to `definition.meta` for messages.
3. **The v0.1.0 `export-core-forms.php` array.** Keep supporting it.

Per dataset:

**Forms**
- **Keep the WordPress post ID as the EmDash form ID** (`String(id)`), as v0.1.0 already does, so `[cf_form id]` and block references survive.
- Map `meta._cf_settings[0]` → `settings`, `cf_message_*[0]` → `messages`, and `_cf_form_schema`, `_cf_headless`, `_cf_hidden_columns` and `_cf_live_definition` to their EmDash fields (form-builder, headless and revisions specs).
- Drop `_cf_a11y_report` (recompute it), `_cf_unseen_submissions` (rebuild from status), and `_edit_*`.
- Conflict policy applies by ID first, then by slug.

**Submissions**
- **Deterministic ID**: `wp-{old id}` or the numeric string, so re-imports update instead of duplicating.
- Coerce types from strings (numbers, booleans, `data` JSON). Treat `submitted_at` as UTC and convert it to ISO.
- Keep `status`, `isSpam`, the payment columns and `draft_token`.

**Replies** go into an EmDash `replies` collection keyed `wp-{id}`.

**Email logs and action logs.** Import them when the selection includes them, keyed deterministically. Pause `pending` queue rows, as in WordPress.

**Settings.** Map `cf_settings` keys to the EmDash settings keys (§3.5). Secrets go into encrypted settings. Ignore `license_server`, `fluentcart_mailerpress` and `payments` unless the payments spec claims them. Theme tokens go into KV, with the CSS regenerated.

**Polls and commerce:** hand off to those specs. The envelope parser must accept and pass through the datasets it doesn't own.

**Team data:** not in the WordPress export. Extend the dump script (option 1 above) to include `cf_submission_team`, `cf_field_groups` and the user-meta scopes. User IDs need a mapping from WordPress user email to EmDash user ID (`ctx.users.getByEmail`, which needs `read:users`).

**Files.** Media and upload URLs stay as absolute WordPress URLs unless an R2 migration step copies them (uploads spec).

**Size.** WordPress allows exports up to 100 MB. EmDash route bodies are capped (v0.1.0 uses `maxBytes: 1_000_000` for submit). Import must be **chunked**: the client parses the file and posts batches of about 200 rows per call to `import/batch`, with idempotent IDs. Confirm the maximum JSON body size for plugin routes on Workers.

---

## 5. WP-CLI

### 5.1 Commands (registered at `WP:core-forms.php:110-117`)

**Conventions:** `--format=table|json|csv|yaml|ids|count` through `WP_CLI\Utils\format_items`. Destructive commands accept `--dry-run` and use `WP_CLI::confirm` with `--yes`.

| Command | Args | Behaviour | Source |
|---|---|---|---|
| `wp core-forms form list` | `[--status=<any>] [--format]` | All `core-form` posts ORDER BY ID ASC → `id, title, slug, status` | `class-form-command.php:22-37` |
| `wp core-forms form export` | `[<ids>...] [--output=<file>]` | §4.3 JSON. Unknown IDs warn "Form %d was not found." `--output` writes the file and reports "Exported %d forms to %s." | `:50-87` |
| `wp core-forms form import` | `<file\|-> [--status=<s>] [--dry-run]` | Validates that `forms[]` exists ("Invalid Core Forms export."). Dry run: "Validated %d forms. No data changed." Otherwise creates **new** posts with unique slugs, sanitised markup, `_cf_settings`, the 3 messages, then the definition restore or schema save → "Imported %d forms." | `:102-144` |
| `wp core-forms submission list` | `[--form] [--status] [--before=<Y-m-d>] [--limit=100, max 10000] [--format]` | `cf_get_all_submissions` → `id, form_id, status, is_spam, submitted_at`. `--before` maps to **`date_to`**, which is inclusive through 23:59:59 **UTC** (`dates_local` isn't set) and requires `Y-m-d`; other formats are silently ignored, even though the docs show `"6 months ago"` for `update`. Spam is included. | `class-submission-command.php:23-38` |
| `wp core-forms submission update` | `--status=<cur> --set-status=<new> [--form] [--before=<strtotime>] [--dry-run] [--yes]` | Counts matches (`status = cur`, optional `form_id`, `submitted_at < gmdate(strtotime(before))`). Dry run: "%d submissions would be updated." Confirm "Update %d submissions?". Captures IDs, runs `UPDATE status=new, modified_at=UTC_TIMESTAMP()`, fires `cf_submission_written(cli)`. **No status validation** (any string) and **notifications meta isn't updated**. | `:55-75` |
| `wp core-forms submission cleanup` | `[--days=90 (min 1)] [--dry-run] [--yes]` | Cutoff is now minus days (UTC). Deletes: `cf_submissions` with status `draft`/`partial` and `modified_at < cutoff` (rows with NULL `modified_at` are never matched); `cf_action_logs` with `created_at < cutoff`; `cf_email_logs` with `sent_at < cutoff`; `cf_action_queue` with status `completed`/`failed` and `created_at < cutoff`. Reports "%d records would be deleted." / "Permanently delete %d records?" / "Deleted %d old records." **Bypasses `PrivacyControls::delete_submission`**, so orphaned replies and team rows stay and uploaded files stay. | `:87-106` |
| `wp core-forms license product-list \| product-create \| plan-list \| license-list \| order-list \| maintenance` | see `docs/developers/wp-cli.md` | Licensing spec | `class-license-command.php:13-65` |
| `wp core-forms doctor` | `[--format=table\|json]` | Runs the checks below. **Exits 1 when any check is `fail`.** | `class-doctor-command.php:38-54` |

**Doctor checks** (`run_checks`, `:63-72`):

| Check | ok | warn / fail |
|---|---|---|
| schema version | `cf_db_version >= CF_SCHEMA_VERSION` | fail otherwise |
| submissions table | exists | fail if missing |
| submissions indexes | `idx_form_spam_submitted`, `idx_form_submitted`, `idx_submitted`, `idx_status_modified` all present | fail, listing what is missing |
| submissions rows | count (always ok) | |
| analytics rows | | warn if more than 2,000,000 ("consider lowering retention") |
| `cron: cf_process_queued_actions`, `cf_cleanup_drafts`, `cf_cleanup_analytics` | scheduled (shows next run, UTC) | fail "not scheduled" |
| `DISABLE_WP_CRON` | | warn when set |
| queue backlog | | warn if more than 500 pending |
| queue failures | | warn if more than 0 failed |
| email (24h) | 0 sent ("no mail sent"), or failure rate 0% | warn if more than 0%, fail if more than 20% |
| `webhook: {provider}` | per configured provider, last seen | warn "never received" |
| headless | | fail when any form has `headless_enabled` and the API key is empty |

The same rows appear in Site Health Info (§1.2).

### 5.2 EmDash equivalents

EmDash's CLI (`EM:node_modules/emdash/dist/cli`) has fixed commands (`content`, `schema`, `media`, `users`, `doctor`, …) and **no plugin command extension point** that I could find. Confirm. Proposal:

- **Admin routes**, the source of truth, all under `/_emdash/api/plugins/core-forms/`:

  | Route | Input / behaviour |
  |---|---|
  | `forms/list` | `{status?}` (exists) |
  | `forms/export` | `{ids?}` → `core-forms-data` v1 subset |
  | `forms/import` | extend to accept every format in §4.6, `{dryRun?}` |
  | `submissions/list` | add `{before?, after?, search?, isSpam?, assignee?, overdue?}` |
  | `submissions/bulk-status` | `{status, setStatus, formId?, before?, dryRun}` → `{matched, updated}` |
  | `maintenance/cleanup` | `{days, dryRun}`; must route deletes through the coordinated erasure |
  | `doctor` | `{}` → `[{check, status, detail}]` |

  Doctor equivalents:
  - storage collections present
  - cron tasks registered (`ctx.cron.list()`)
  - queue backlog and failures
  - email failure rate from the email-log collection over 24 h
  - payments last-webhook from KV
  - headless forms without a key
  - email provider configured (`ctx.email` defined)
- **MCP tools** (`definePlugin({ mcp: { tools } })`, `types-BT1p3uyb.d.mts:1463-1472`): expose `doctor`, `forms_list`, `forms_export`, `submissions_list` (read-only), plus `submissions_bulk_status` and `maintenance_cleanup` with `destructive: true`. Agents can then run them.
- **Node script** `scripts/core-forms.mjs` in the package: `list | export | import | submissions | cleanup | doctor`. It calls the admin routes with an EmDash API token (`Authorization: Bearer`) and mirrors `--dry-run`, `--yes`, `--format`, and exit code 1 on a doctor `fail`. **Confirm** that plugin admin routes accept API-token auth (`ctx.user` is undefined for token requests, per `types-BT1p3uyb.d.mts:1418-1428`).
- **Admin UI:** a "Health" card on the Settings or Forms page that renders the `doctor` output.

---

## 6. Uninstall and data cleanup

**Deactivation** (`_cf_on_plugin_deactivation`, `WP:src/functions.php:2184-2203`):
- Unschedules `cf_process_queued_actions`, `cf_cleanup_drafts`, `cf_cleanup_analytics`, `cf_poll_auto_close`, `cf_license_subscription_maintenance`, `cf_retention_cleanup` and `cf_team_reminders`.
- `flush_rewrite_rules`.
- **No data is touched.** (`core_forms_verify_license` isn't unscheduled.)

**Uninstall** (`WP:uninstall.php`):
- Runs only when `cf_settings.delete_data_on_uninstall` is truthy (`:28-31`).
- Multisite: runs for every site (`:215-224`).
- Order:
  1. **Private attachments** (`:144-177`). Validates the whole ownership set first: each attachment's form ID, `_cf_private_path` and attached file must agree and sit under `{private base}/{sha16(site_url)}/{form_id}/`. **Any mismatch aborts the entire uninstall** and leaves the data. Then it deletes files and attachments, guard files (`.htaccess`, `index.php`) and directories.
  2. Recursively deletes `{uploads}/core-forms` (refuses paths outside uploads).
  3. Force-deletes every `core-form` post, in all statuses.
  4. Drops tables: `cf_submissions`, `cf_submission_replies`, `cf_polls`, `cf_poll_votes`, `cf_analytics`, `cf_action_queue`, `cf_action_logs`, `cf_email_logs`, every `cf_license_*` table (products, plans, orders, order_items, activations, packages, subscriptions, downloads, events) plus `cf_licenses`, `cf_submission_team`, `cf_fulfillment`, `cf_payment_reversals`.
  5. Deletes options `cf_settings`, `cf_db_version`, `cf_form_theme_tokens`, `cf_field_groups`, `cf_retention_last_run`, `cf_migration_error`; anything matching `cf_unsaved_capacity_*` and `_cf_lock_*`; user meta `{prefix}cf_form_scope` and `{prefix}cf_inbox_views` for all users; transients `_transient_cf_*` and `_transient_timeout_cf_*`; **every** postmeta `_cf_%` on any post.
  6. Clears the 7 cron hooks.
  7. Removes the `edit_forms` user cap from every user and from every role.
- **Left behind:**
  - `core-poll` posts (the poll tables are dropped, but the CPT posts remain)
  - licensing pages created for the dashboard and checkout
  - non-private upload attachments in the Media Library
  - options `cf_email_logs_table_created`, `cf_last_webhook_*`, `cf_license_maintenance_last_run`, `core_forms_license*`
  - the `manage_core_forms_licenses` cap
  - the `core_forms_verify_license` cron

**EmDash mapping:**
- `hooks["plugin:deactivate"]`: `ctx.cron.cancel()` for every task.
- `hooks["plugin:uninstall"]` receives `{ deleteData: boolean }` (`types-BT1p3uyb.d.mts:1163-1165, 1203`). Delete when `event.deleteData || settings.deleteDataOnUninstall`. Confirm who sets `deleteData` (presumably a host UI checkbox), and whether the host already drops plugin storage collections, KV and secrets on uninstall. If it does, keep only R2 object cleanup (uploads and private files) and any non-plugin-scoped records (media items created through `ctx.media`).
- Mirror the "validate the whole ownership set, then delete, abort on failure" rule for R2 objects.

---

## 7. Gap analysis vs v0.1.0

| Area | WordPress 4.11.1 | EmDash v0.1.0 (`EM:`) | Gap and action | Pri |
|---|---|---|---|---|
| Navigation | Core Forms, Submissions, Core Commerce, Settings subnav; plus Add New, Email Logs, Migrate, Theme Customizer, Recovery, License | `admin.pages`: `/` Forms, `/submissions`; hidden `/form` editor (`src/index.ts:101-104`, `src/admin/index.tsx:16-20`). Settings is the host's auto page. | Add pages `/email-logs`, `/migrate`, `/settings` (custom), `/theme`; keep `/form` and a gallery route `/new`. Recovery, Commerce and Polls are other specs. | P1 |
| Forms list | Stats strip, All/Trash views, search with `/` shortcut, Shortcode copy, Accessibility column, tab row actions, sort by submissions or accessibility, 50/page, trash/restore | Table: title, slug, status, submissions, unread, updated; edit, duplicate, delete with "also delete submissions"; JSON import | Add stats, search and `/`, shortcode copy, a11y column, sorting, a draft/trash model (EmDash has publish/draft only; WordPress trash has no counterpart, so decide), per-tab deep links | P2 |
| Add New | Template gallery with filters, preview modal, duplicate picker; template presets plus a default email action | "New form" opens a blank editor | Gallery is owned by the templates spec. The **default email action on non-blank templates** must be kept. | P2 |
| Editor tabs | 9 tabs; Submissions tab only when `save_submissions` | Fields, Settings, Messages, Actions, Submissions | Other specs add Payment, Headless, Analytics, Revisions. Hide Submissions when not saving. Fingerprint 409 conflict handling is missing. | P1 |
| Status model | `status` (10 values) + `is_spam` flag + `payment_status`; no trash; delete is permanent and coordinated | `status` ∈ `new, read, spam, trash` (`src/core/types.ts:121`) | **Adopt the WordPress model** (`status`, `isSpam`, `paymentStatus`). Migrate v0.1.0 rows: `spam` → `isSpam=true, status=read`; `trash` → `archived` (or keep `trash` as an EmDash extension, outside the WordPress status set). | **P0** |
| Inbox views and filters | Inbox/New/Archived/Spam/All with counts; search; form, status (10), local-tz date range; Clear | Form and status selects; no counts, search or dates | Add views with counts (`count(where)`), date range (UTC conversion), and search (§8.3) | P1 |
| Inbox row | Summary algorithm (§2.5), Received relative+absolute, badge, View | First non-empty value, truncated to 80 (`helpers.ts:507-513`) | Port `SubmissionPresentation::summary` exactly | P1 |
| Pagination | 25/page with page N/M | Cursor "Load more" | Acceptable. Show the total from `count()`. | P3 |
| Bulk actions | Mark spam / Not spam (**replays actions**), Mark read/new, Archive, Export CSV (selected), Delete (coordinated, refuses pending work) | Read, unread, spam, trash, restore, delete (plain `deleteMany`) | Add **replay actions on un-spam** (with conditions), Archive, CSV of the selection, and coordinated delete (cascade replies, logs, team rows, files; refuse pending payment) | **P0** |
| Per-form list | Summary/All-fields layouts, column hide/rename/delete, spam view, CSV including spam | Shared inbox fixed to one form | Add an All-fields layout, column menu (rename and delete rewrite stored data: confirm), hidden-columns persistence | P2 |
| CSV | Global: `id, form_id, submitted_at, status, is_spam, ip_address, …keys`. Per-form: `submitted_at, …keys, ip_address, user_agent, referer_url`. `\t` formula guard incl. fullwidth. | `Submitted at, Status, …labels, IP address, Referrer, Submission ID` with BOM; `'` guard; excludes trash | Decide whether to match WordPress headers exactly (people's spreadsheets depend on them). At minimum add `user_agent` and the fullwidth `＝＋－＠` guard. Add CSV for a selection. | P2 |
| Detail | Fields, Submission Info, Payment card, Raw JSON, Edit, Reply history + Send Reply, Team card, Back; auto-read | Side panel: fields, meta (IP, country, page, browser), status buttons | Add Edit, Payment card, Raw data, Replies, Team. Auto-read already exists. | P1 |
| Edit submission | Field editor, files preserved, lock | none | Add a `submissions/update-data` route with the array fix (§2.7) | P1 |
| Replies | Send from admin; From = `reply_from_email`; history table; status → replied | none | Add a `replies` collection and route. **From can't be set on EmDash** (§8.4): use `replyTo`. | P1 |
| Team inbox | Assignee, due, notes, hold, saved views, scopes, reminders cron, native API guard | none | Add the `team` collection, KV views, scopes, cron. Needs `read:users` and a role model (§8.4). | P1 |
| Email logs | Logged per send; screen with stats, filters, detail, resend, delete | none (`runActions` doesn't log) | Add an `emailLogs` collection, log around `ctx.email.send`, build the screen. Resend should **create a new log row** (improvement). | P1 |
| Retention and privacy | Per-form retention days for entries and attachments; daily cron; preview; GDPR export and erase | none | Add per-form settings, a cron, a preview route. GDPR on EmDash: check for a host personal-data hook; otherwise add an admin "find by email" export/erase tool. | P2 |
| Global settings | §3.2 (about 30 keys) | 7 keys (CAPTCHA x6, `storeIp`); `defaultFrom` is in the types but **not in the schema** (`types.ts:166-167` vs `index.ts:87-100`) | Add the §3.5 keys; remove `defaultFrom` or wire it up | P1 |
| Native backup | `core-forms-data` v1 export and import, 6 datasets, policies, form scope | Forms-only import of its own array; no export | Implement §4.6 import plus an export of the EmDash data in the **same envelope** (`format_version` 1, EmDash rows) for round trips | **P0** |
| Competitor importers | 6 (database-reading) | none | §4.5 option 1 dump script plus TypeScript importers | P2 |
| CLI | form, submission, license, doctor | none | §5.2 routes, MCP tools, script | P2 |
| Dashboard | (WordPress has no widget) | "Recent form submissions" widget | Keep. Exclude spam using the new flag. | P3 |
| Notification badges | Unseen count in menu and rows | Unread counts per form in the list | Equivalent. Derive from `status=new`; don't port `_cf_unseen_submissions`. | P3 |
| Accessibility column and autofix | Yes | none | Form-builder spec, but the list column belongs here | P3 |
| Uninstall | Opt-in delete, ownership-validated | none | §6 | P2 |
| License & Updates | Updater licence page and nags | n/a | **Don't port** | n/a |

---

## 8. Porting notes for the EmDash admin

### 8.1 Pages, widgets, routes

**`admin.pages`** (sidebar entries) in `EM:src/index.ts`:
- `/` Forms (icon `list`)
- `/submissions` Submissions (`tray`)
- `/email-logs` Email logs
- `/migrate` Migrate
- `/settings` Settings (custom; or rely on the host page plus a link)

Hidden pages, reached through links, registered in `src/admin/index.tsx`: `/form`, `/new`, `/theme`. The editor's Submissions tab reuses `SubmissionsInbox` fixed to one form, as today. The detail view stays a panel but gains the cards from §2.6. Deep links: `?formId&status&spam&q&from&to&assignee&overdue&view&id`.

**Widgets:** keep `recent-submissions`. Optionally add an "Overdue assigned to me" widget for the team inbox.

**Routes to add** (admin, JSON). Names follow v0.1.0 conventions:

| Group | Routes |
|---|---|
| Submissions | `submissions/views-counts`, `submissions/update-data`, `submissions/spam` (`{ids, spam:boolean}`, replays actions on false), `submissions/archive`, `submissions/export` (`{formId?, ids?}`), `submissions/delete` (coordinated) |
| Replies | `replies/list`, `replies/send` |
| Team | `team/get`, `team/save` (`{id, version, assignee, due, note, hold}`), `team/views/list`, `team/views/save`, `team/views/delete`, `team/scope/list`, `team/scope/save`, `users/list` (needs `read:users`) |
| Email logs | `email-logs/list`, `email-logs/get`, `email-logs/resend`, `email-logs/delete`, `email-logs/stats` |
| Data transfer | `data/export`, `data/import` (batched, §4.6), `importers/parse` (competitor dump) |
| Maintenance | `retention/preview`, `doctor`, `maintenance/cleanup`, `settings/payments/get`, `settings/payments/save` (payments spec) |

**Cron** (`ctx.cron.schedule(name, {schedule})` plus a `hooks.cron` handler):

| Task | Schedule |
|---|---|
| `retention-cleanup` | daily |
| `team-reminders` | daily |
| `cleanup-drafts` | daily (smart-forms spec) |
| `cleanup-analytics` | daily (analytics spec) |
| `process-queue` | 5 min (workflows spec) |

Register them in `plugin:install` / `plugin:activate` and cancel them in `plugin:deactivate`. **Confirm the `schedule` string format** (cron expression vs `@daily`) and the minimum interval on Workers.

### 8.2 Storage collections (proposal)

| Collection | Key | Fields | Indexes |
|---|---|---|---|
| `submissions` | `wp-{id}` for imports, UUID for new | `formId, data, status, isSpam, paymentStatus, paymentProvider, paymentId, paymentAmount, paymentCurrency, draftToken, currentStep, ip, userAgent, refererUrl, country, submittedAt, modifiedAt` | `[formId,submittedAt]`, `[isSpam,status,submittedAt]`, `[formId,isSpam,submittedAt]`, `[formId,isSpam,status]`, `[status,modifiedAt]`, `paymentId` |
| `replies` | `wp-{id}` / UUID | `submissionId, direction, channel, provider, providerMessageId, status, fromEmail, toEmail, subject, message, payload, userId, sentAt` | `[submissionId,sentAt]`, `[provider,providerMessageId]` |
| `team` | `submissionId` | `assignee, dueAt, hold, notes[], version, remindedAt, formId` (denormalised for scope filtering) | `[assignee,dueAt]`, `[dueAt]`, `formId` |
| `emailLogs` | UUID / `wp-{id}` | `formId, submissionId, toEmail, fromEmail, subject, message, headers, status, errorMessage, actionType, sentAt` | `[status,sentAt]`, `[formId,sentAt]`, `submissionId` |

**KV:**
- `views:{userId}`: saved inbox views
- `scope:{userId}`: form scopes
- `settings:payments`, `theme:tokens`
- `retention:lastRun`
- `webhook:last:{provider}`

### 8.3 Query constraints to design around (EmDash storage)

`WhereValue` supports only equality, ranges (`gt`/`gte`/`lt`/`lte`), `in` and `startsWith`. `limit` is at most 100, pagination is cursor-only, and `count(where)` exists (`types-BT1p3uyb.d.mts:15-45`).

- **"Exclude archived"** becomes `status: {in: [every non-archived status]}`.
- **Free-text search over answers** (WordPress `data LIKE`) isn't expressible. Options:
  1. A bounded scan in the route: walk cursor pages server-side, filter in JS, stop at N matches or M scanned.
  2. A `searchTokens` side index: lowercased words written on every submission write. That needs a `startsWith`-friendly layout, for example a separate `submissionTerms` collection keyed `{term}:{submissionId}`.

  **Decide** which. Option 1 matches WordPress semantics for small sites.
- **Team scope** becomes `formId: {in: scope}`, which can be large. Confirm the maximum `in` list size.
- **Assignee and overdue** need a join. Query `team` first (`assignee=` / `dueAt<now`), then `getMany` the submissions. Counts must be computed the same way.

### 8.4 Needs another agent (or the EmDash core team) to confirm

1. **Email From and Bcc.** `EmailMessage` is `{to, cc?, replyTo?, subject, text, html?}`; there is no `from` and no `bcc` (`types-BT1p3uyb.d.mts:860-869`). This affects `reply_from_email`, per-action `from`, the GF/WPForms/Fluent `bcc` and `Cc`/`Bcc` headers, and the "From: {site} <from>" reply header. Ask whether `email:beforeSend` hooks or the provider can set From per message. Until then, put the configured sender in `replyTo` and say so in the UI.
2. **Users and roles.** `ctx.users.list()` (needs `read:users`) returns `role:number`. Questions:
   - Which number means admin versus editor?
   - Can non-admin roles reach plugin admin pages and routes at all? ROUTES.md says admin routes need an admin session. If only admins can, team scopes and assignment to non-admins are moot; ask whether EmDash supports per-route role gating.
   - `ctx.user` identifies the caller on private routes; use it for "Assigned to me" and note authorship.
3. **Cron.** `CronAccess.schedule(name, {schedule})`: confirm the schedule syntax and the minimum interval (the WordPress queue runs every 5 min), and that cron runs on Workers deployments (Cron Triggers).
4. **Uninstall semantics.** Who sets `UninstallEvent.deleteData`, and does the host auto-drop plugin storage, KV and secrets?
5. **Settings encryption from custom pages.** Can a React settings page write `secret` values through `ctx.settings`, or only through the auto-generated schema form?
6. **Route body size and time limits** for the batched import, and whether a `raw` response can stream a large CSV export (rather than building it in memory).
7. **API-token auth for admin routes**, for the CLI script and MCP.
8. **Personal-data export and erase hooks** in EmDash, to match the WordPress GDPR tools.
9. **Media and R2** for retention and protected uploads (uploads spec): delete APIs, ownership metadata, authenticated download routes.
10. **Akismet** on EmDash: there is no WordPress Akismet plugin, so it needs an API key setting and a direct HTTP call (spam spec). `akismet_whitelist` only makes sense if Akismet is ported.

### 8.5 Behaviours to preserve exactly (checklist)

- Opening a `new` entry marks it `read`. Payment, draft and spam rows keep their status.
- Un-spamming replays success and actions with per-action conditions. Marking spam runs nothing.
- Delete always cascades replies, email logs, queue, action logs, team, fulfillment and reversals, plus owned files. It refuses entries with pending payment or pending work and reports which.
- Inbox excludes spam and archived by default. A status filter overrides the archived exclusion. Date filters use the site timezone; storage is UTC.
- The summary title, email and preview algorithm (§2.5).
- Team: optimistic `version`, append-only notes (10k characters / 1k notes), the hold blocks retention, an assignee must have form access, reminders at most once per 24 h, and saving resets `remindedAt`.
- Saved views: at most 30, names at most 80 characters, keyed by the name hash, replace on the same name, params `form_id, assignee, overdue, submission_status, spam_status, s, date_from, date_to`.
- Reply success sets status `replied`. Failed sends store nothing.
- Settings: a payment save merges and never wipes providers that weren't rendered. `delete_data_on_uninstall` is a hard boolean.
- Import pauses pending queued actions (no surprise emails or webhooks after a migration).
