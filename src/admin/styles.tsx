/**
 * Styles for the parts of the admin UI that Kumo components don't cover,
 * prefixed `cf-`. The admin's Tailwind stylesheet is precompiled, so
 * plugin-only utility classes would be missing; these rules use Kumo's CSS
 * variables instead and follow its light/dark tokens.
 */

const CSS = `
/* On :root so Kumo dialogs, which portal outside .cfa-admin, get them too. */
:root {
	--cfa-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
	--cfa-line: var(--color-kumo-line, rgba(127, 127, 127, 0.3));
	--cfa-subtle: var(--text-color-kumo-subtle, inherit);
	--cfa-focus: var(--color-kumo-focus, #2563eb);
	--cfa-danger: var(--text-color-kumo-danger, #dc2626);
	--cfa-tint: var(--color-kumo-tint, rgba(127, 127, 127, 0.08));
	--cfa-surface: var(--color-kumo-base, transparent);
}
.cfa-admin :where(h1, h2, h3, p, dl, dd, figure) { margin: 0; }
.cfa-page { display: grid; gap: 1.5rem; min-width: 0; }
.cfa-page-header { display: grid; gap: 0.75rem; }
.cfa-title { font-size: 1.5rem; line-height: 1.25; font-weight: 600; overflow-wrap: anywhere; }
.cfa-section-title { font-size: 1rem; font-weight: 600; }
.cfa-between { justify-content: space-between; align-items: flex-start; }
.cfa-loading { display: flex; justify-content: center; padding: 3rem 0; }
.cfa-loading-compact { padding: 1rem 0; }
.cfa-stack-xs { display: grid; gap: 0.25rem; }
.cfa-dialog-title { font-size: 1.125rem; font-weight: 600; }
.cfa-dialog-body { margin-top: 1rem; }
.cfa-dialog-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.5rem; }
.cfa-back { display: inline-flex; align-items: center; gap: 0.375rem; font-size: 0.875rem; color: var(--cfa-subtle); text-decoration: none; width: fit-content; }
.cfa-back:hover { color: var(--text-color-kumo-default, inherit); }
.cfa-back:focus-visible { outline: 2px solid var(--cfa-focus); outline-offset: 2px; border-radius: 0.125rem; }
[dir="rtl"] .cfa-flip-rtl { transform: scaleX(-1); }
.cfa-error-summary { border-color: var(--color-kumo-danger, #dc2626); }
.cfa-error-summary:focus-visible { outline: 2px solid var(--cfa-focus); outline-offset: 2px; }
.cfa-error-summary ul { display: grid; gap: 0.25rem; margin: 0.5rem 0 0; padding-inline-start: 1.25rem; }
.cfa-help { margin: 0; font-size: 0.875rem; line-height: 1.4; color: var(--cfa-subtle); }
.cfa-error-text { margin: 0; font-size: 0.875rem; color: var(--cfa-danger); }
.cfa-label { display: block; font-size: 0.875rem; font-weight: 500; }
.cfa-mono { font-family: var(--cfa-mono); }
.cfa-card { border: 1px solid var(--cfa-line); border-radius: 0.75rem; background: var(--cfa-surface); padding: 1.25rem; min-width: 0; }
.cfa-stack { display: grid; gap: 1rem; }
.cfa-stack-sm { display: grid; gap: 0.5rem; }
.cfa-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.cfa-grow { flex: 1 1 auto; min-width: 0; }
.cfa-grid-2 { display: grid; gap: 1rem; }
@media (min-width: 768px) { .cfa-grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

/* Fieldsets used as settings cards */
fieldset.cfa-card { margin: 0; }
fieldset.cfa-card > legend { float: left; width: 100%; padding: 0; margin: 0 0 0.25rem; font-size: 1rem; font-weight: 600; }
fieldset.cfa-card > legend + * { clear: both; }

/* Tabs (WAI-ARIA tabs pattern) */
.cfa-tabs { display: flex; gap: 0.25rem; border-bottom: 1px solid var(--cfa-line); overflow-x: auto; scrollbar-width: thin; }
.cfa-tab { appearance: none; background: none; border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px; padding: 0.5rem 0.75rem; font: inherit; font-size: 0.875rem; font-weight: 500; color: var(--cfa-subtle); cursor: pointer; white-space: nowrap; display: inline-flex; align-items: center; gap: 0.375rem; }
.cfa-tab:hover { color: var(--text-color-kumo-default, inherit); }
.cfa-tab[aria-selected="true"] { color: var(--text-color-kumo-strong, inherit); border-bottom-color: var(--color-kumo-brand, currentColor); }
.cfa-tab:focus-visible { outline: 2px solid var(--cfa-focus); outline-offset: -2px; border-radius: 0.25rem; }
.cfa-tab-dot { width: 0.5rem; height: 0.5rem; border-radius: 999px; background: var(--color-kumo-danger, #dc2626); }
.cfa-tabpanel { padding-top: 1.5rem; }
.cfa-tabpanel:focus-visible { outline: 2px solid var(--cfa-focus); outline-offset: 4px; border-radius: 0.25rem; }

/* Code editor */
.cfa-code { display: block; box-sizing: border-box; width: 100%; min-height: 24rem; resize: vertical; padding: 0.75rem; border: 1px solid var(--cfa-line); border-radius: 0.5rem; background: var(--color-kumo-recessed, var(--cfa-surface)); color: inherit; font-family: var(--cfa-mono); font-size: 13px; line-height: 1.6; tab-size: 4; white-space: pre; overflow: auto; }
.cfa-code-sm { min-height: 10rem; }
.cfa-code:focus-visible { outline: 2px solid var(--cfa-focus); outline-offset: 1px; }
.cfa-code[aria-invalid="true"] { border-color: var(--color-kumo-danger, #dc2626); }

/* Editor layout */
.cfa-editor-grid { display: grid; gap: 1.5rem; align-items: start; }
@media (min-width: 1200px) {
	.cfa-editor-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
	.cfa-sticky { position: sticky; top: 1rem; }
}
.cfa-preview-frame { display: block; box-sizing: border-box; width: 100%; min-height: 30rem; border: 1px solid var(--cfa-line); border-radius: 0.5rem; background: #fff; resize: vertical; }
.cfa-preview-wrap { position: relative; }

/* Chips: field names and data variables */
.cfa-chips { display: flex; flex-wrap: wrap; gap: 0.375rem; margin: 0; padding: 0; list-style: none; }
.cfa-chip { appearance: none; display: inline-flex; align-items: center; padding: 0.125rem 0.5rem; border: 1px solid var(--cfa-line); border-radius: 0.375rem; background: var(--cfa-tint); color: inherit; font-family: var(--cfa-mono); font-size: 12px; line-height: 1.5; cursor: pointer; }
.cfa-chip:hover { border-color: var(--cfa-focus); }
.cfa-chip:focus-visible { outline: 2px solid var(--cfa-focus); outline-offset: 1px; }
span.cfa-chip { cursor: default; }
.cfa-variables { display: grid; gap: 0.375rem 1rem; grid-template-columns: max-content minmax(0, 1fr); align-items: baseline; margin: 0; }
.cfa-variables dd { margin: 0; font-size: 0.8125rem; color: var(--cfa-subtle); }
.cfa-variables dt { margin: 0; }

/* Tables */
.cfa-table-wrap { border: 1px solid var(--cfa-line); border-radius: 0.5rem; background: var(--cfa-surface); overflow-x: auto; }
.cfa-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
.cfa-table th { padding: 0.625rem 1rem; text-align: start; font-weight: 500; white-space: nowrap; background: var(--cfa-tint); border-bottom: 1px solid var(--cfa-line); }
.cfa-table td { padding: 0.625rem 1rem; vertical-align: middle; border-bottom: 1px solid var(--cfa-line); }
.cfa-table tbody tr:last-child td { border-bottom: 0; }
.cfa-table tbody tr:hover { background: var(--cfa-tint); }
.cfa-table tr[data-active] { background: var(--cfa-tint); box-shadow: inset 3px 0 0 var(--color-kumo-brand, currentColor); }
.cfa-table .cfa-num { text-align: end; font-variant-numeric: tabular-nums; }
.cfa-table .cfa-check { width: 2.5rem; padding-inline-end: 0; }
.cfa-table .cfa-actions-cell { text-align: end; white-space: nowrap; }
.cfa-unread { font-weight: 600; }
.cfa-truncate { display: block; max-width: 36rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Text-like buttons */
.cfa-link-button { appearance: none; background: none; border: 0; padding: 0; margin: 0; font: inherit; color: inherit; text-align: start; cursor: pointer; max-width: 100%; }
.cfa-link-button:hover, .cfa-link:hover { color: var(--text-color-kumo-link, inherit); text-decoration: underline; }
.cfa-link-button:focus-visible, .cfa-link:focus-visible { outline: 2px solid var(--cfa-focus); outline-offset: 2px; border-radius: 0.125rem; }
.cfa-link { color: inherit; text-decoration: none; }
.cfa-link-accent { color: var(--text-color-kumo-link, inherit); text-decoration: underline; text-underline-offset: 2px; }

/* Inbox */
.cfa-inbox { display: grid; gap: 1.5rem; align-items: start; }
@media (min-width: 1200px) { .cfa-inbox[data-detail-open] { grid-template-columns: minmax(0, 1fr) 26rem; } }
.cfa-detail { display: grid; gap: 1.25rem; }
@media (min-width: 1200px) { .cfa-detail { position: sticky; top: 1rem; max-height: calc(100vh - 2rem); overflow: auto; } }
.cfa-detail:focus-visible { outline: 2px solid var(--cfa-focus); outline-offset: 2px; }
.cfa-dl { display: grid; gap: 0.75rem; }
.cfa-dl dt { font-size: 0.75rem; font-weight: 600; color: var(--cfa-subtle); overflow-wrap: anywhere; }
.cfa-dl dd { margin: 0.125rem 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.cfa-dl-meta dd { font-size: 0.875rem; }
.cfa-bulkbar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; border: 1px solid var(--cfa-line); border-radius: 0.5rem; background: var(--cfa-tint); }
.cfa-filter { min-width: 12rem; }

/* Actions tab */
.cfa-actions-layout { display: grid; gap: 1.5rem; align-items: start; }
@media (min-width: 1100px) {
	.cfa-actions-layout { grid-template-columns: minmax(0, 1fr) 20rem; }
	.cfa-actions-layout .cfa-sticky { position: sticky; top: 1rem; }
}
.cfa-plain-list { margin: 0; padding: 0; list-style: none; }
.cfa-action-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.cfa-action-title { font-size: 1rem; font-weight: 600; overflow-wrap: anywhere; }
.cfa-action-title:focus-visible { outline: 2px solid var(--cfa-focus); outline-offset: 2px; border-radius: 0.125rem; }
.cfa-inline-help { font-weight: 400; }
.cfa-add-grid { display: grid; gap: 0.75rem; }
@media (min-width: 768px) { .cfa-add-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.cfa-add-action { appearance: none; display: flex; align-items: flex-start; gap: 0.75rem; padding: 0.875rem; border: 1px dashed var(--cfa-line); border-radius: 0.5rem; background: none; color: inherit; font: inherit; text-align: start; cursor: pointer; }
.cfa-add-action:hover { border-style: solid; border-color: var(--cfa-focus); background: var(--cfa-tint); }
.cfa-add-action:focus-visible { outline: 2px solid var(--cfa-focus); outline-offset: 2px; }
.cfa-section-title:focus-visible { outline: 2px solid var(--cfa-focus); outline-offset: 2px; border-radius: 0.125rem; }
.cfa-admin details > summary { cursor: pointer; }
.cfa-pre { margin: 0; padding: 0.75rem; border-radius: 0.5rem; background: var(--cfa-tint); font-family: var(--cfa-mono); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 16rem; overflow: auto; }
.cfa-snippet { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.cfa-snippet code { padding: 0.25rem 0.5rem; border-radius: 0.375rem; background: var(--cfa-tint); font-family: var(--cfa-mono); font-size: 13px; overflow-wrap: anywhere; }

/* Widget */
.cfa-widget-list { display: grid; gap: 0.625rem; margin: 0; padding: 0; list-style: none; }
.cfa-widget-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.125rem 0.75rem; font-size: 0.875rem; }
.cfa-widget-meta { font-size: 0.75rem; color: var(--cfa-subtle); }
`;

/** Injects the stylesheet once; React 19 dedupes and hoists by `href`. */
export function AdminStyles() {
	return (
		<style href="core-forms-admin" precedence="default">
			{CSS}
		</style>
	);
}
