# Core Forms routes

Plugin id `core-forms`. Every route lives under `/_emdash/api/plugins/core-forms/`. Types are in `src/core/types.ts`.

JSON routes take a JSON body and return EmDash's envelope, `{ "success": true, "data": … }`. Admin routes need an admin session (the admin UI sends `X-EmDash-Request: 1`).

## Public

| Route | Body | Returns |
| --- | --- | --- |
| `submit` | form-data (`multipart/form-data` or urlencoded) | raw response. With `_cf_ajax=1`: JSON `SubmitResponse`. Without it: a 303 redirect (Post/Redirect/Get) |
| `render` | JSON `{ id?: string, slug?: string, pageUrl?: string, responseToken?: string, idPrefix?: string }` | `{ html: string, form: { id, slug, title }, theme: boolean, captcha?: { provider, siteKey } }`, or `null` when the form is missing or a draft. `pageUrl` fills `{{url_params.*}}` and the no-JS return address; `idPrefix` keeps element ids unique when a page shows a form twice |

### `submit` fields

- `_cf_form_id`: the form id (required).
- `_cf_h{id}`: the honeypot. It must be present and empty.
- `_cf_ajax`: `1` when the client script submits.
- `_cf_source_url`: the page to return to after a native (no-JS) submission.
- `cf-turnstile-response`, `g-recaptcha-response`, `h-captcha-response`: CAPTCHA tokens.
- Everything else is form data. Keys starting with `_` are dropped, and so are keys the form's markup doesn't declare.

## Admin

| Route | Input | Returns |
| --- | --- | --- |
| `forms/list` | none | `{ items: FormSummary[] }` |
| `forms/get` | `{ id }` | `{ form: FormDefinition }` |
| `forms/save` | `{ form: Partial<FormDefinition> & { title, markup } }` | `{ form: FormDefinition }`. Creates the form when `id` is missing. The slug must be unique |
| `forms/delete` | `{ id, deleteSubmissions?: boolean }` | `{ deleted: true }` |
| `forms/duplicate` | `{ id }` | `{ form: FormDefinition }` |
| `forms/preview` | `{ form: Partial<FormDefinition> }` | `{ html: string }` |
| `forms/options` | none | `{ items: { id: string, name: string }[] }`: the form picker in the editor block (EmDash's `optionsRoute` contract) |
| `forms/import` | `{ forms: unknown[] }` (EmDash `FormDefinition` or a Core Forms for WordPress export) | `{ created: number, updated: number, skipped: string[] }` |
| `submissions/list` | `{ formId?, status?, cursor?, limit? }` | `{ items: Submission[], nextCursor?: string }` |
| `submissions/get` | `{ id }` | `{ submission: Submission, form: FormSummary \| null }` |
| `submissions/update` | `{ ids: string[], status: SubmissionStatus }` | `{ updated: number }` |
| `submissions/delete` | `{ ids: string[] }` | `{ deleted: number }` |
| `submissions/export` | `{ formId }` | raw `text/csv` download |
| `stats` | none | `{ forms, submissions, unread, blocked: { honeypot, rateLimit, captcha, duplicate } }` |

Plugin settings (`GlobalSettings`) come from `admin.settingsSchema`. EmDash renders that form and stores the values in plugin KV under `settings:<key>`.
