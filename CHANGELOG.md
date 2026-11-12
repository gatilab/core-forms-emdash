# Changelog

## 0.1.2 (2026-11-12)

- Fixed: the unique index on a form's `slug` also applied to every other plugin's stored records, because EmDash builds unique indexes over the shared plugin storage table. With Core Forms installed, another plugin could save only 1 record per `slug` value in a collection. Link Manager, for example, kept 1 click record per link. The index is now a plain one, and EmDash removes the old unique index when the plugin updates. Form slugs stay unique: the save, duplicate and import routes already check them.

## 0.1.1 (2026-11-07)

- Relicensed under the MIT License (previously GPL-2.0-or-later).

## 0.1.0 (unreleased)

First release: an EmDash port of Core Forms for WordPress.

- HTML-first forms that render the WordPress plugin's markup, data attributes and `cf-*` classes.
- Submission pipeline:
  - availability, schedule and submission limit
  - honeypot
  - hashed-IP rate limit
  - size, required and email validation
  - Turnstile, reCAPTCHA v3 and hCaptcha
  - duplicate check
- AJAX submission with the WordPress plugin's events, and a no-JavaScript Post/Redirect/Get fallback.
- Email, autoresponder and webhook actions, run after the response. They use the WordPress template tokens, and unknown tags behave as in WordPress.
- Submissions storage with statuses and CSV export (with a BOM, and spreadsheet formula protection).
- A "Form" editor block, a `<CoreForm>` component, and `renderFormsInHtml()` for `[cf_form]` shortcodes in migrated HTML.
- An importer for the WordPress plugin's exports that keeps form ids, plus a read-only WP-CLI export script.
