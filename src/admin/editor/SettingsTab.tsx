/**
 * Settings tab: every `FormSettings` field except actions, grouped like the
 * WordPress plugin's settings screen.
 */

import { Input, Select } from "@cloudflare/kumo";
import * as React from "react";

import type { CaptchaProvider, FormSettings } from "../../core/types.js";
import { DEFAULT_SETTINGS, isoToLocalInput, localInputToIso, localTimeZone, type DraftErrors } from "../helpers.js";
import { AdminLink, SETTINGS_HREF } from "../navigation.js";
import { ToggleField } from "../ui.js";

const CAPTCHA_ITEMS: { value: CaptchaProvider; label: string }[] = [
	{ value: "none", label: "None" },
	{ value: "turnstile", label: "Cloudflare Turnstile" },
	{ value: "recaptcha", label: "Google reCAPTCHA" },
	{ value: "hcaptcha", label: "hCaptcha" },
];

const isCaptcha = (value: unknown): value is CaptchaProvider => CAPTCHA_ITEMS.some((item) => item.value === value);

type SettingKey = Exclude<keyof FormSettings, "actions">;

export function SettingsTab({
	settings,
	errors,
	formId,
	onChange,
}: {
	settings: FormSettings;
	errors: Pick<DraftErrors, "redirect_url" | "schedule">;
	formId?: string;
	onChange: (patch: Partial<FormSettings>) => void;
}) {
	const set = <K extends SettingKey>(key: K, value: FormSettings[K] | undefined) =>
		onChange({ [key]: value } as Partial<FormSettings>);

	const bool = (key: "save_submissions" | "hide_after_success" | "enable_honeypot" | "prevent_duplicates" | "ajax_submit" | "load_form_theme") =>
		settings[key] ?? DEFAULT_SETTINGS[key];

	const text = (key: SettingKey) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
		set(key, event.target.value === "" ? undefined : event.target.value);

	const count = (key: "rate_limit" | "submission_limit") => (event: React.ChangeEvent<HTMLInputElement>) => {
		const raw = event.target.value.trim();
		if (raw === "") return set(key, undefined);
		const n = Math.floor(Number(raw));
		set(key, Number.isFinite(n) && n > 0 ? n : 0);
	};

	const schedule = (key: "schedule_open" | "schedule_close") => (event: React.ChangeEvent<HTMLInputElement>) =>
		set(key, localInputToIso(event.target.value));

	const scope = `.cf-form-${formId ?? "<id>"}`;

	return (
		<div className="cfa-stack">
			<fieldset className="cfa-card cfa-stack">
				<legend>Submission</legend>
				<ToggleField
					label="Save submissions"
					description="Keep each submission in the inbox. Turn off to only run the form's actions."
					checked={bool("save_submissions")}
					onChange={(checked) => set("save_submissions", checked)}
				/>
				<ToggleField
					label="Submit without reloading"
					description="Send the form in the background and show the reply in place. When off, the browser posts the form and returns to the page. Both work without JavaScript."
					checked={bool("ajax_submit")}
					onChange={(checked) => set("ajax_submit", checked)}
				/>
				<ToggleField
					label="Hide the form after success"
					description="Show only the success message once someone submits."
					checked={bool("hide_after_success")}
					onChange={(checked) => set("hide_after_success", checked)}
				/>
				<ToggleField
					label="Scroll to the message"
					description="Bring the success or error message into view after submitting."
					checked={settings.success_scroll !== false}
					onChange={(checked) => set("success_scroll", checked)}
				/>
				<Input
					id="cfa-setting-redirect_url"
					label="Redirect after success"
					value={settings.redirect_url ?? ""}
					placeholder="/thank-you"
					description="Optional. A path on this site or a full URL. Visitors go there instead of seeing the success message. Without JavaScript, only paths on this site redirect."
					error={errors.redirect_url}
					spellCheck={false}
					onChange={text("redirect_url")}
				/>
				<div className="cfa-grid-2">
					<Input
						label="Extra required fields"
						value={settings.required_fields ?? ""}
						placeholder="name, phone"
						description="Comma-separated field names that must be filled, on top of fields marked required in the HTML."
						spellCheck={false}
						onChange={text("required_fields")}
					/>
					<Input
						label="Extra email fields"
						value={settings.email_fields ?? ""}
						placeholder="work_email"
						description='Comma-separated field names that must hold a valid email address. Inputs with type="email" are always checked.'
						spellCheck={false}
						onChange={text("email_fields")}
					/>
				</div>
				<Input
					label="Submission limit"
					type="number"
					min={0}
					step={1}
					inputMode="numeric"
					value={settings.submission_limit ?? ""}
					placeholder="0"
					description="Total submissions to accept. 0 or empty means unlimited."
					onChange={count("submission_limit")}
				/>
			</fieldset>

			<fieldset className="cfa-card cfa-stack">
				<legend>Spam protection</legend>
				<ToggleField
					label="Honeypot"
					description="Add a hidden field that bots fill in and people never see. Submissions that fill it are rejected."
					checked={bool("enable_honeypot")}
					onChange={(checked) => set("enable_honeypot", checked)}
				/>
				<Select
					label="CAPTCHA"
					value={isCaptcha(settings.captcha) ? settings.captcha : DEFAULT_SETTINGS.captcha}
					items={CAPTCHA_ITEMS}
					description={
						<>
							Add the provider's site key and secret key in{" "}
							<AdminLink href={SETTINGS_HREF} className="cfa-link-accent">
								Core Forms settings
							</AdminLink>
							. Without them, the CAPTCHA check is skipped.
						</>
					}
					onValueChange={(value) => set("captcha", isCaptcha(value) ? value : "none")}
				/>
				<div className="cfa-grid-2">
					<Input
						label="Rate limit"
						type="number"
						min={0}
						step={1}
						inputMode="numeric"
						value={settings.rate_limit ?? ""}
						placeholder="0"
						description="Submissions allowed per IP address per hour. 0 or empty means unlimited."
						onChange={count("rate_limit")}
					/>
					<ToggleField
						label="Block duplicates"
						description="Reject an identical submission from the same IP address within 10 minutes."
						checked={bool("prevent_duplicates")}
						onChange={(checked) => set("prevent_duplicates", checked)}
					/>
				</div>
			</fieldset>

			<fieldset className="cfa-card cfa-stack">
				<legend>Schedule</legend>
				<p className="cfa-help">
					Accept submissions only inside this window. Times use your time zone ({localTimeZone()}). Outside the
					window the form shows its "Form closed" message. Leave both empty to always accept submissions.
				</p>
				<div className="cfa-grid-2">
					<Input
						id="cfa-setting-schedule_open"
						label="Opens"
						type="datetime-local"
						value={isoToLocalInput(settings.schedule_open)}
						onChange={schedule("schedule_open")}
					/>
					<Input
						id="cfa-setting-schedule_close"
						label="Closes"
						type="datetime-local"
						value={isoToLocalInput(settings.schedule_close)}
						error={errors.schedule}
						onChange={schedule("schedule_close")}
					/>
				</div>
			</fieldset>

			<fieldset className="cfa-card cfa-stack">
				<legend>Appearance</legend>
				<ToggleField
					label="Use the built-in form theme"
					description="Load Core Forms' stylesheet for this form. Leave off when your site's CSS already styles forms."
					checked={bool("load_form_theme")}
					onChange={(checked) => set("load_form_theme", checked)}
				/>
				<div className="cfa-grid-2">
					<Input
						label="Submit button text"
						value={settings.submit_button_text ?? ""}
						placeholder="Submit"
						description="Used for the button Core Forms adds when your HTML has no submit button."
						onChange={text("submit_button_text")}
					/>
					<Input
						label="Loading text"
						value={settings.loading_text ?? ""}
						placeholder="Sending…"
						description="Shown on the submit button while the form sends."
						onChange={text("loading_text")}
					/>
				</div>
				<Input
					label="Extra CSS classes"
					value={settings.form_class ?? ""}
					placeholder="contact-form wide"
					description="Space-separated classes added to the form element."
					spellCheck={false}
					onChange={text("form_class")}
				/>
			</fieldset>

			<fieldset className="cfa-card cfa-stack">
				<legend>Advanced</legend>
				<CodeField
					id="cfa-setting-custom_css"
					label="Custom CSS"
					help={
						<>
							Scoped to this form: your rules apply inside <code className="cfa-mono">{scope}</code>.
						</>
					}
					value={settings.custom_css ?? ""}
					placeholder={"button { border-radius: 999px; }"}
					onChange={text("custom_css")}
				/>
				<CodeField
					id="cfa-setting-custom_js"
					label="Custom JavaScript"
					help={
						<>
							Runs on every page that shows the form, with <code className="cfa-mono">form</code> set to the form
							element. Only administrators can edit it; don't paste code you don't trust.
						</>
					}
					value={settings.custom_js ?? ""}
					placeholder={'form.addEventListener("submit", () => console.log("sent"));'}
					onChange={text("custom_js")}
				/>
			</fieldset>
		</div>
	);
}

function CodeField({
	id,
	label,
	help,
	value,
	placeholder,
	onChange,
}: {
	id: string;
	label: string;
	help: React.ReactNode;
	value: string;
	placeholder?: string;
	onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
}) {
	return (
		<div className="cfa-stack-xs">
			<label htmlFor={id} className="cfa-label">
				{label}
			</label>
			<p id={`${id}-help`} className="cfa-help">
				{help}
			</p>
			<textarea
				id={id}
				className="cfa-code cfa-code-sm"
				value={value}
				placeholder={placeholder}
				rows={8}
				wrap="off"
				spellCheck={false}
				autoCapitalize="off"
				autoCorrect="off"
				autoComplete="off"
				aria-describedby={`${id}-help`}
				onChange={onChange}
			/>
		</div>
	);
}
