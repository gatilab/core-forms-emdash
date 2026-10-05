# Changelog

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
