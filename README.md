# Core Forms for EmDash

HTML-first forms for [EmDash](https://emdashcms.com). You write the fields as plain HTML. The plugin wraps them in a working form and handles the rest:
- spam protection: a honeypot, rate limiting, a duplicate check, and Turnstile, reCAPTCHA v3 or hCaptcha
- AJAX submission with inline messages, plus a no-JavaScript fallback
- a submissions inbox with CSV export
- email, autoresponder and webhook actions

It's a port of [Core Forms for WordPress](https://wordpress.org/plugins/core-forms/), and that plugin's exports import as they are. Form ids, field names, messages, settings, action templates and the front-end markup all carry over. Existing CSS and `cf-*` event listeners keep working.

```html
<p><label for="name">Your name</label> <input id="name" name="name" required></p>
<p><label for="email">Email</label> <input id="email" type="email" name="email" required></p>
<p><label for="message">Message</label> <textarea id="message" name="message"></textarea></p>
<button type="submit">Send</button>
```

That markup is a complete form. Fields marked `required` and `type="email"` are validated on the server as well as in the browser.

## Install

```sh
pnpm add @gatilab/emdash-core-forms
```

```js
// astro.config.mjs
import { coreForms } from "@gatilab/emdash-core-forms";

emdash({
	plugins: [coreForms()],
});
```

The plugin needs two capabilities, which EmDash asks you to approve:
- `email:send` for email and autoresponder actions. Configure an email provider plugin; in development, EmDash captures mail at `/_emdash/api/dev/emails`.
- `network:request:unrestricted` for webhooks to your own URLs and for CAPTCHA verification.

## Showing a form

**In content.** Insert the **Form** block from the editor's block menu and pick a form. EmDash renders it through the plugin's components, with no theme changes needed.

**In an Astro template.**

```astro
---
import { CoreForm } from "@gatilab/emdash-core-forms/astro";
---
<CoreForm slug="contact" />
<CoreForm id="1050301" />
```

**Inside an HTML string**, such as page-builder sections migrated from WordPress. `renderFormsInHtml` expands `[cf_form id="…"]` and `[cf_form slug="…"]` shortcodes and `<div data-core-form="id"></div>` placeholders. Include `FormAssets` once if any forms rendered.

```astro
---
import { FormAssets, renderFormsInHtml } from "@gatilab/emdash-core-forms/astro";
const { html, forms } = await renderFormsInHtml(Astro, section.html);
---
<Fragment set:html={html} />
{forms.length > 0 && <FormAssets captcha={forms.flatMap((f) => (f.captcha ? [f.captcha] : []))} />}
```

`FormAssets` loads the form styles, the submission script, and the script for whichever CAPTCHA providers the rendered forms use. It's safe to include more than once.

## How a submission is handled

Checks run in this order. The first failure ends the request with that form's message:

1. **Availability.** The form is published, inside its open and close schedule, and under its submission limit.
2. **Honeypot.** A bot that fills the hidden `_cf_h{id}` field gets a fake success; nothing is stored or sent.
3. **Rate limit.** At most `rate_limit` submissions per IP per form per hour. IPs are hashed before they're used as keys.
4. **Validation.**
   - Size limits: 20 KB per field, 200 KB per submission, 200 fields.
   - `maxlength`.
   - Required fields: the `required` attribute, plus the form's required-fields setting.
   - Email fields.
5. **CAPTCHA**, when the form uses one.
6. **Duplicate check.** The same answers from the same visitor within 10 minutes count as a success, but nothing new is stored.
7. **Save and act.** The submission is stored if the form keeps submissions. Actions run after the response is sent, so a slow webhook never delays the visitor.

Only fields declared in the form's markup are kept, so nobody can add extra keys to stored data, emails or webhooks. Keys starting with `_` are control fields and are never stored.

With JavaScript, the form posts in the background and shows the message inline. Without JavaScript, the browser posts normally and lands back on the same page, where the message renders in place. EmDash only lets plugins redirect within the site, so without JavaScript a redirect URL on another site shows the success message instead.

## Templates

Email subjects, bodies, recipients and Reply-To headers accept the WordPress plugin's tokens:

| Token | Value |
| --- | --- |
| `[field_name]` | A submitted field. A space in the token matches an underscore in the field name. |
| `[all]`, `[all:label]` | Every non-empty field, by name or by its label. |
| `[CF_FORM_ID]`, `[CF_FORM_SLUG]`, `[CF_FORM_TITLE]` | The form. |
| `[CF_SUBMISSION_ID]`, `[CF_TIMESTAMP]`, `[CF_DATE]`, `[CF_TIME]` | The submission. Times are UTC; `CF_TIMESTAMP` keeps WordPress's `2026-10-05 04:03:41` shape. |
| `[CF_IP_ADDRESS]`, `[CF_USER_AGENT]` | The visitor. |
| `[CF_REFERRER_URL]`, `[CF_POST_URL]`, `[CF_REFERRER_HOST]`, `[CF_REFERRER_PATH]` | The page the form was on. |
| `[CF_SITE_NAME]`, `[CF_SITE_URL]` | Your site. |

As in WordPress, any other bracketed text becomes the matching field or nothing. So a misspelt `[CF_REFERER]` disappears instead of reaching the recipient. WordPress-only tokens (`CF_POST_ID`, `CF_USER_*`, `CF_PAYMENT_*`) render empty.

Form markup can use `{{url_params.utm_source || direct}}` to prefill a field from the page's query string. Values are HTML-escaped.

## Events

The client script dispatches bubbling `CustomEvent`s on the form element:

| Event | When |
| --- | --- |
| `cf-submit` | Before the request. |
| `cf-submitted` | After any response; `detail.response` holds it. |
| `cf-success`, `cf-error` | After a success or an error response. |
| `cf-message` | When a message is shown. |

During a request the form has the `cf-loading` class and `aria-busy="true"`. Invalid fields get `aria-invalid="true"`, and the first one is focused.

```js
document.addEventListener("cf-success", (event) => {
	gtag("event", "generate_lead", { form: event.detail.form.dataset.slug });
});
```

## Admin

Core Forms adds **Forms** and **Submissions** to the admin sidebar, and a **Recent form submissions** dashboard widget:
- **Forms:** create, duplicate, delete or import forms, with unread counts per form.
- **Form editor:**
  - edit the markup with a live preview, and insert field snippets
  - set per-form settings and messages
  - edit email, autoresponder and webhook actions, with a list of the available tokens
- **Submissions:** filter by form and status, read a submission (which marks it read), mark spam, trash or delete in bulk, and export a form's submissions as CSV.

## Settings

In **Plugins**, open the settings for `core-forms`:
- CAPTCHA keys for Cloudflare Turnstile, Google reCAPTCHA v3 and hCaptcha. Secret keys are stored as secrets.
- Whether IP addresses are stored with submissions. Rate limiting works either way.

Per-form settings are the WordPress plugin's own:
- required and email fields
- whether to save submissions
- hiding the form after success
- a redirect URL
- the honeypot, rate limit, duplicate check, submission limit and open/close schedule
- the CAPTCHA provider
- AJAX on or off
- the button and loading text
- the bundled form theme
- custom CSS and JavaScript

## Importing from WordPress

Export the forms with WP-CLI, which only reads:

```sh
wp eval-file export-core-forms.php > core-forms.json
```

[`wordpress/export-core-forms.php`](./wordpress/export-core-forms.php) ships with this package. It's a short read-only script that prints every `core-form` post as JSON, with its unserialized settings and messages. Then use **Import** on the Forms screen, or post the file to the `forms/import` admin route. WordPress ids are kept, so `[cf_form id="…"]` embeds in imported content keep working. Re-importing updates forms in place.

## Not supported yet

- **File uploads.** File inputs render, but files are dropped on the server.
- **The `create_comment` action** and other WordPress-only actions. They're imported and kept, but they don't run.
- **Logged-in-user tokens** such as `{{user.email}}` in markup and `[CF_USER_*]` in emails. They render empty.
- **A From address per action.** EmDash's email API sends from the address configured in your email provider. Imported From and autoresponder sender values are kept but not used.

## Routes

[ROUTES.md](./ROUTES.md) documents every public and admin route.

## Core API

`@gatilab/emdash-core-forms/core` exports the runtime without EmDash or Astro, for tests and other hosts:
- `renderForm`
- `processSubmission`
- `parseFields`
- `validate`
- `replaceDataVariables`
- `normalizeForm`
- `submissionsToCsv`
- the types

## License

GPL-2.0-or-later, like Core Forms for WordPress.
