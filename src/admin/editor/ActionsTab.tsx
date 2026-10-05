/**
 * Actions tab: what happens after a successful submission. Email,
 * autoresponder and webhook actions are editable; anything else came from a
 * WordPress import and is kept read-only (EmDash doesn't run it).
 */

import { Badge, Button, Input, InputArea, Select, Switch } from "@cloudflare/kumo";
import { ArrowDown, ArrowUp, EnvelopeSimple, PaperPlaneTilt, Trash, WebhooksLogo } from "@phosphor-icons/react";
import * as React from "react";

import type { AutoresponderAction, EmailAction, FormAction, WebhookAction } from "../../core/types.js";
import {
	ACTION_DESCRIPTIONS,
	ACTION_LABELS,
	createAction,
	DATA_VARIABLES,
	insertText,
	isKnownAction,
	moveItem,
	type ActionFieldErrors,
	type KnownAction,
	type KnownActionType,
} from "../helpers.js";
import { copyToClipboard, focusSoon, Notice } from "../ui.js";

type TextControl = HTMLInputElement | HTMLTextAreaElement;
type Remember = (key: string) => (event: React.FocusEvent<TextControl>) => void;
type Patch = Record<string, unknown>;

const ACTION_TYPES: readonly KnownActionType[] = ["email", "autoresponder", "webhook"];

const ACTION_ICONS: Record<KnownActionType, React.ReactNode> = {
	email: <EnvelopeSimple size={20} aria-hidden="true" />,
	autoresponder: <PaperPlaneTilt size={20} aria-hidden="true" />,
	webhook: <WebhooksLogo size={20} aria-hidden="true" />,
};

const EMAIL_FORMATS = [
	{ value: "text/html", label: "HTML" },
	{ value: "text/plain", label: "Plain text" },
];

const WEBHOOK_FORMATS = [
	{ value: "json", label: "JSON" },
	{ value: "form", label: "Form-encoded" },
];

const actionLabel = (action: FormAction) => (isKnownAction(action) ? ACTION_LABELS[action.type] : `Imported “${action.type}” action`);
const fieldId = (actionId: string, key: string) => `cfa-action-${actionId}-${key}`;

export function ActionsTab({
	actions,
	fieldNames,
	errors,
	onChange,
	announce,
}: {
	actions: FormAction[];
	fieldNames: string[];
	errors: Record<string, ActionFieldErrors> | undefined;
	onChange: (update: (actions: FormAction[]) => FormAction[]) => void;
	announce: (text: string) => void;
}) {
	const lastField = React.useRef<{ actionId: string; key: string; el: TextControl } | null>(null);
	const datalistId = React.useId();

	const update = (id: string, patch: Patch) =>
		onChange((list) => list.map((action) => (action.id === id ? ({ ...action, ...patch } as FormAction) : action)));

	const add = (type: KnownActionType) => {
		const action = createAction(type, fieldNames);
		onChange((list) => [...list, action]);
		announce(`Added ${ACTION_LABELS[type].toLowerCase()}.`);
		focusSoon(fieldId(action.id ?? "", "title"));
	};

	const remove = (index: number) => {
		const action = actions[index];
		if (!action) return;
		if (lastField.current?.actionId === action.id) lastField.current = null;
		onChange((list) => list.filter((_, i) => i !== index));
		announce(`Removed ${actionLabel(action).toLowerCase()}. Save the form to apply the change.`);
		focusSoon("cfa-actions-title");
	};

	const move = (index: number, delta: number) => {
		const action = actions[index];
		const to = index + delta;
		if (!action || to < 0 || to >= actions.length) return;
		onChange((list) => moveItem(list, index, delta));
		announce(`Moved ${actionLabel(action).toLowerCase()} to position ${to + 1} of ${actions.length}.`);
		const atEdge = (delta < 0 && to === 0) || (delta > 0 && to === actions.length - 1);
		const button = (delta < 0) !== atEdge ? "up" : "down";
		focusSoon(fieldId(action.id ?? "", button));
	};

	const remember =
		(actionId: string): Remember =>
		(key) =>
		(event) => {
			lastField.current = { actionId, key, el: event.currentTarget };
		};

	const insertVariable = async (token: string) => {
		const target = lastField.current;
		if (!target || !target.el.isConnected) {
			const copied = await copyToClipboard(token);
			announce(copied ? `Copied ${token}. Click a field and paste it.` : `Click a field first, then choose ${token}.`);
			return;
		}
		const { el, actionId, key } = target;
		const value = el.value;
		const { value: next, caret } = insertText(value, token, el.selectionStart ?? value.length, el.selectionEnd ?? value.length);
		update(actionId, { [key]: next });
		window.requestAnimationFrame(() => {
			el.focus();
			try {
				el.setSelectionRange(caret, caret);
			} catch {
				// Some input types don't support selection; the value is still updated.
			}
		});
		announce(`Inserted ${token}.`);
	};

	return (
		<div className="cfa-actions-layout">
			<div className="cfa-stack">
				<div className="cfa-stack-xs">
					<h2 id="cfa-actions-title" className="cfa-section-title" tabIndex={-1}>
						Actions
					</h2>
					<p className="cfa-help">
						Actions run in order after each successful submission. Spam and rejected submissions don't trigger them.
					</p>
				</div>

				{actions.length === 0 ? (
					<div className="cfa-card">
						<p className="cfa-help">
							No actions yet. Add an email notification so you hear about new submissions, or a webhook to send them to
							another service.
						</p>
					</div>
				) : (
					<ol className="cfa-stack cfa-plain-list" aria-labelledby="cfa-actions-title">
						{actions.map((action, index) => (
							<li key={action.id ?? index}>
								<ActionCard
									action={action}
									index={index}
									total={actions.length}
									errors={errors?.[action.id ?? ""]}
									fieldNames={fieldNames}
									datalistId={datalistId}
									onUpdate={(patch) => update(action.id ?? "", patch)}
									onMove={(delta) => move(index, delta)}
									onRemove={() => remove(index)}
									remember={remember(action.id ?? "")}
								/>
							</li>
						))}
					</ol>
				)}

				<section className="cfa-card cfa-stack" aria-labelledby="cfa-add-action-title">
					<h3 id="cfa-add-action-title" className="cfa-section-title">
						Add an action
					</h3>
					<div className="cfa-add-grid">
						{ACTION_TYPES.map((type) => (
							<button key={type} type="button" className="cfa-add-action" onClick={() => add(type)}>
								{ACTION_ICONS[type]}
								<span className="cfa-stack-xs">
									<span className="cfa-label">{ACTION_LABELS[type]}</span>
									<span className="cfa-help">{ACTION_DESCRIPTIONS[type]}</span>
								</span>
							</button>
						))}
					</div>
				</section>

				<datalist id={datalistId}>
					{fieldNames.map((name) => (
						<option key={name} value={name} />
					))}
				</datalist>
			</div>

			<VariablesPanel fieldNames={fieldNames} onInsert={(token) => void insertVariable(token)} />
		</div>
	);
}

function VariablesPanel({ fieldNames, onInsert }: { fieldNames: string[]; onInsert: (token: string) => void }) {
	// Keep focus (and the caret) in the field when a chip is clicked with the mouse.
	const keepFocus = (event: React.MouseEvent) => event.preventDefault();
	return (
		<aside className="cfa-card cfa-stack cfa-sticky" aria-labelledby="cfa-variables-title">
			<div className="cfa-stack-xs">
				<h3 id="cfa-variables-title" className="cfa-section-title">
					Data variables
				</h3>
				<p className="cfa-help">
					Use these in recipients, subjects and messages. Choose one to insert it where you were typing.
				</p>
			</div>
			<div className="cfa-stack-sm">
				<h4 className="cfa-label">Form fields</h4>
				{fieldNames.length ? (
					<ul className="cfa-chips" aria-label="Field variables">
						{fieldNames.map((name) => (
							<li key={name}>
								<button type="button" className="cfa-chip" onMouseDown={keepFocus} onClick={() => onInsert(`[${name}]`)}>
									[{name}]
								</button>
							</li>
						))}
					</ul>
				) : (
					<p className="cfa-help">No named fields in the form HTML yet.</p>
				)}
			</div>
			<div className="cfa-stack-sm">
				<h4 className="cfa-label">Submission</h4>
				<dl className="cfa-variables">
					{DATA_VARIABLES.map((variable) => (
						<React.Fragment key={variable.token}>
							<dt>
								<button
									type="button"
									className="cfa-chip"
									onMouseDown={keepFocus}
									onClick={() => onInsert(variable.token)}
								>
									{variable.token}
								</button>
							</dt>
							<dd>{variable.description}</dd>
						</React.Fragment>
					))}
				</dl>
			</div>
		</aside>
	);
}

function actionSummary(action: KnownAction): string {
	switch (action.type) {
		case "email":
			return action.to?.trim() ? `to ${action.to.trim()}` : "no recipient yet";
		case "autoresponder":
			return action.email_field?.trim() ? `to the address in [${action.email_field.trim()}]` : "no recipient field yet";
		case "webhook":
			try {
				return action.url?.trim() ? `to ${new URL(action.url.trim()).host}` : "no URL yet";
			} catch {
				return "invalid URL";
			}
	}
}

function ActionCard({
	action,
	index,
	total,
	errors,
	fieldNames,
	datalistId,
	onUpdate,
	onMove,
	onRemove,
	remember,
}: {
	action: FormAction;
	index: number;
	total: number;
	errors: ActionFieldErrors | undefined;
	fieldNames: string[];
	datalistId: string;
	onUpdate: (patch: Patch) => void;
	onMove: (delta: number) => void;
	onRemove: () => void;
	remember: Remember;
}) {
	const id = action.id ?? String(index);
	const label = actionLabel(action);
	const known = isKnownAction(action) ? action : null;
	const position = `${label}, ${index + 1} of ${total}`;

	return (
		<section className="cfa-card cfa-stack" aria-labelledby={fieldId(id, "title")}>
			<div className="cfa-action-head">
				{known ? ACTION_ICONS[known.type] : null}
				<h3 id={fieldId(id, "title")} className="cfa-action-title cfa-grow" tabIndex={-1}>
					{index + 1}. {label}
					{known ? <span className="cfa-help cfa-inline-help"> {actionSummary(known)}</span> : null}
				</h3>
				{known ? (
					<Switch
						label="Enabled"
						checked={known.enabled !== false}
						onCheckedChange={(checked) => onUpdate({ enabled: checked })}
						aria-label={`Enabled: ${position}`}
					/>
				) : (
					<Badge variant="warning">Not run</Badge>
				)}
				<Button
					id={fieldId(id, "up")}
					variant="ghost"
					shape="square"
					size="sm"
					aria-label={`Move ${position} up`}
					disabled={index === 0}
					icon={<ArrowUp aria-hidden="true" />}
					onClick={() => onMove(-1)}
				/>
				<Button
					id={fieldId(id, "down")}
					variant="ghost"
					shape="square"
					size="sm"
					aria-label={`Move ${position} down`}
					disabled={index === total - 1}
					icon={<ArrowDown aria-hidden="true" />}
					onClick={() => onMove(1)}
				/>
				<Button
					variant="ghost"
					shape="square"
					size="sm"
					aria-label={`Remove ${position}`}
					icon={<Trash aria-hidden="true" />}
					onClick={onRemove}
				/>
			</div>

			{known?.type === "email" ? (
				<EmailFields id={id} action={known} errors={errors} onUpdate={onUpdate} remember={remember} />
			) : known?.type === "autoresponder" ? (
				<AutoresponderFields
					id={id}
					action={known}
					errors={errors}
					fieldNames={fieldNames}
					datalistId={datalistId}
					onUpdate={onUpdate}
					remember={remember}
				/>
			) : known?.type === "webhook" ? (
				<WebhookFields id={id} action={known} errors={errors} onUpdate={onUpdate} />
			) : (
				<UnsupportedFields action={action} />
			)}
		</section>
	);
}

/** Optional text: an empty input removes the key so the default applies. */
const optional = (value: string) => (value === "" ? undefined : value);

function EmailFields({
	id,
	action,
	errors,
	onUpdate,
	remember,
}: {
	id: string;
	action: EmailAction;
	errors: ActionFieldErrors | undefined;
	onUpdate: (patch: Patch) => void;
	remember: Remember;
}) {
	return (
		<>
			<div className="cfa-grid-2">
				<Input
					id={fieldId(id, "to")}
					label="Send to"
					required
					value={action.to ?? ""}
					placeholder="you@example.com"
					description="Comma-separated addresses. Variables like [email] work here."
					error={errors?.to}
					spellCheck={false}
					autoComplete="off"
					onFocus={remember("to")}
					onChange={(event) => onUpdate({ to: event.target.value })}
				/>
				<Input
					id={fieldId(id, "from")}
					label="From"
					value={action.from ?? ""}
					placeholder="Site name <noreply@example.com>"
					description="Kept from WordPress for reference. EmDash sends from the address set in your email provider."
					spellCheck={false}
					autoComplete="off"
					onFocus={remember("from")}
					onChange={(event) => onUpdate({ from: optional(event.target.value) })}
				/>
			</div>
			<Input
				id={fieldId(id, "subject")}
				label="Subject"
				required
				value={action.subject ?? ""}
				error={errors?.subject}
				onFocus={remember("subject")}
				onChange={(event) => onUpdate({ subject: event.target.value })}
			/>
			<InputArea
				id={fieldId(id, "message")}
				label="Message"
				required
				rows={8}
				value={action.message ?? ""}
				description="[all:label] lists every answer with its label."
				error={errors?.message}
				onFocus={remember("message")}
				onChange={(event) => onUpdate({ message: event.target.value })}
			/>
			<div className="cfa-grid-2">
				<Select
					label="Format"
					value={action.content_type ?? "text/html"}
					items={EMAIL_FORMATS}
					onValueChange={(value) => onUpdate({ content_type: value === "text/plain" ? "text/plain" : "text/html" })}
				/>
				<InputArea
					id={fieldId(id, "headers")}
					label="Extra headers"
					rows={3}
					value={action.headers ?? ""}
					placeholder={"Reply-To: [email]\nCc: team@example.com"}
					description="One per line. Only Reply-To, Cc and Bcc are used."
					spellCheck={false}
					onFocus={remember("headers")}
					onChange={(event) => onUpdate({ headers: optional(event.target.value) })}
				/>
			</div>
		</>
	);
}

function AutoresponderFields({
	id,
	action,
	errors,
	fieldNames,
	datalistId,
	onUpdate,
	remember,
}: {
	id: string;
	action: AutoresponderAction;
	errors: ActionFieldErrors | undefined;
	fieldNames: string[];
	datalistId: string;
	onUpdate: (patch: Patch) => void;
	remember: Remember;
}) {
	const field = action.email_field?.trim() ?? "";
	const unknownField = field !== "" && !fieldNames.includes(field);
	return (
		<>
			<Input
				id={fieldId(id, "email_field")}
				label="Recipient field"
				required
				list={datalistId}
				value={action.email_field ?? ""}
				placeholder="email"
				description={
					unknownField
						? `There's no field named “${field}” in the form HTML, so this autoresponder won't send.`
						: "The form field that holds the visitor's email address."
				}
				error={errors?.email_field}
				spellCheck={false}
				autoComplete="off"
				onChange={(event) => onUpdate({ email_field: event.target.value })}
			/>
			<div className="cfa-grid-2">
				<Input
					id={fieldId(id, "from_name")}
					label="From name"
					value={action.from_name ?? ""}
					placeholder="Your site"
					onFocus={remember("from_name")}
					onChange={(event) => onUpdate({ from_name: optional(event.target.value) })}
				/>
				<Input
					id={fieldId(id, "from_email")}
					label="From address"
					value={action.from_email ?? ""}
					placeholder="noreply@example.com"
					description="Kept from WordPress for reference. EmDash sends from the address set in your email provider."
					spellCheck={false}
					autoComplete="off"
					onFocus={remember("from_email")}
					onChange={(event) => onUpdate({ from_email: optional(event.target.value) })}
				/>
			</div>
			<Input
				id={fieldId(id, "reply_to")}
				label="Reply-To"
				value={action.reply_to ?? ""}
				placeholder="support@example.com"
				description="Where replies to the confirmation go."
				spellCheck={false}
				autoComplete="off"
				onFocus={remember("reply_to")}
				onChange={(event) => onUpdate({ reply_to: optional(event.target.value) })}
			/>
			<Input
				id={fieldId(id, "subject")}
				label="Subject"
				required
				value={action.subject ?? ""}
				error={errors?.subject}
				onFocus={remember("subject")}
				onChange={(event) => onUpdate({ subject: event.target.value })}
			/>
			<InputArea
				id={fieldId(id, "message")}
				label="Message"
				required
				rows={6}
				value={action.message ?? ""}
				error={errors?.message}
				onFocus={remember("message")}
				onChange={(event) => onUpdate({ message: event.target.value })}
			/>
			<Select
				label="Format"
				value={action.content_type ?? "text/html"}
				items={EMAIL_FORMATS}
				onValueChange={(value) => onUpdate({ content_type: value === "text/plain" ? "text/plain" : "text/html" })}
			/>
		</>
	);
}

function WebhookFields({
	id,
	action,
	errors,
	onUpdate,
}: {
	id: string;
	action: WebhookAction;
	errors: ActionFieldErrors | undefined;
	onUpdate: (patch: Patch) => void;
}) {
	return (
		<div className="cfa-grid-2">
			<Input
				id={fieldId(id, "url")}
				label="URL"
				required
				inputMode="url"
				value={action.url ?? ""}
				placeholder="https://hooks.example.com/forms"
				description="Core Forms sends a POST request here after each submission."
				error={errors?.url}
				spellCheck={false}
				autoComplete="off"
				onChange={(event) => onUpdate({ url: event.target.value })}
			/>
			<Select
				label="Format"
				value={action.content_type ?? "json"}
				items={WEBHOOK_FORMATS}
				description="A JSON body, or URL-encoded form fields."
				onValueChange={(value) => onUpdate({ content_type: value === "form" ? "form" : "json" })}
			/>
		</div>
	);
}

function UnsupportedFields({ action }: { action: FormAction }) {
	const { id: _id, enabled: _enabled, type, ...rest } = action;
	const hasSettings = Object.keys(rest).length > 0;
	return (
		<div className="cfa-stack-sm">
			<Notice variant="secondary" title="Imported, not run">
				This “{type}” action came from Core Forms for WordPress. EmDash keeps its settings so nothing is lost, but it
				doesn't run it. Remove it if you don't need it.
			</Notice>
			{hasSettings ? (
				<details>
					<summary className="cfa-label">Imported settings</summary>
					<pre className="cfa-pre">{JSON.stringify(rest, null, 2)}</pre>
				</details>
			) : null}
		</div>
	);
}
