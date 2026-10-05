/**
 * Accessibility audit report (`AccessibilityTester`, spec 02 §5.6, spec 04 §1.3.9; D-069b).
 * Stored verbatim in form meta `_cf_a11y_report` and returned by `forms/a11y/*` and `forms/list`.
 */

export type A11yRule =
	| "missing_label"
	| "group_no_fieldset"
	| "select_no_placeholder"
	| "button_no_text"
	| "submit_no_value"
	| "broken_describedby"
	| "image_no_alt"
	| "iframe_no_title"
	| "missing_autocomplete"
	| "empty_lang"
	| "parse_error";

export interface A11yIssue {
	rule: A11yRule | (string & {});
	message: string;
}

/** WP key names (snake_case) because the report is stored as WP meta. */
export interface A11yReport {
	status: "pass" | "issues";
	/** Unix seconds (WP `time()`). */
	checked_at: number;
	issue_count: number;
	issues: A11yIssue[];
}
