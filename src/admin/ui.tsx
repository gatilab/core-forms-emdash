/**
 * Small shared building blocks for the admin pages, built on Kumo.
 */

import { Badge, Banner, Button, Checkbox, Dialog, Empty, LinkButton, Loader, Switch, type LinkButtonProps } from "@cloudflare/kumo";
import { Check, CopySimple } from "@phosphor-icons/react";
import * as React from "react";

import type { FormStatus, SubmissionStatus } from "../core/types.js";
import { SUBMISSION_STATUS_LABELS } from "./helpers.js";
import { interceptLinkClick } from "./navigation.js";
import { AdminStyles } from "./styles.js";

// =============================================================================
// Links styled as buttons
// =============================================================================

/** Kumo's LinkButton, navigating inside the admin on a plain click. */
export function AdminLinkButton({ href, onClick, target, ...props }: LinkButtonProps & { href: string }) {
	return (
		<LinkButton
			href={href}
			target={target}
			onClick={(event) => {
				onClick?.(event);
				interceptLinkClick(event, href, { target });
			}}
			{...props}
		/>
	);
}

// =============================================================================
// Page shell
// =============================================================================

export function AdminPage({ children }: { children: React.ReactNode }) {
	return (
		<div className="cfa-admin cfa-page">
			<AdminStyles />
			{children}
		</div>
	);
}

export function PageHeader({
	title,
	description,
	actions,
	before,
	badge,
}: {
	title: React.ReactNode;
	description?: React.ReactNode;
	actions?: React.ReactNode;
	/** Rendered above the title row, e.g. a back link. */
	before?: React.ReactNode;
	badge?: React.ReactNode;
}) {
	return (
		<header className="cfa-page-header">
			{before}
			<div className="cfa-row cfa-between">
				<div className="cfa-stack-sm cfa-grow">
					<div className="cfa-row">
						<h1 className="cfa-title">{title}</h1>
						{badge}
					</div>
					{description ? <p className="cfa-help">{description}</p> : null}
				</div>
				{actions ? <div className="cfa-row">{actions}</div> : null}
			</div>
		</header>
	);
}

// =============================================================================
// States
// =============================================================================

export function LoadingState({ label = "Loading…", compact = false }: { label?: string; compact?: boolean }) {
	return (
		<div className={compact ? "cfa-loading cfa-loading-compact" : "cfa-loading"} role="status">
			<Loader aria-label={label} />
			<span className="sr-only">{label}</span>
		</div>
	);
}

export function ErrorNotice({
	title = "Something went wrong",
	message,
	onRetry,
}: {
	title?: string;
	message: string;
	onRetry?: () => void;
}) {
	return (
		<div role="alert">
			<Banner
				variant="error"
				title={title}
				description={message}
				action={
					onRetry ? (
						<Button size="sm" variant="secondary" onClick={onRetry}>
							Try again
						</Button>
					) : undefined
				}
			/>
		</div>
	);
}

export function Notice({
	variant = "default",
	title,
	children,
	onDismiss,
}: {
	variant?: "default" | "alert" | "error" | "secondary";
	title?: string;
	children?: React.ReactNode;
	onDismiss?: () => void;
}) {
	return (
		<Banner
			variant={variant}
			title={title}
			description={children}
			action={
				onDismiss ? (
					<Button size="sm" variant="ghost" onClick={onDismiss}>
						Dismiss
					</Button>
				) : undefined
			}
		/>
	);
}

export function EmptyState({
	icon,
	title,
	description,
	children,
}: {
	icon?: React.ReactNode;
	title: string;
	description?: string;
	children?: React.ReactNode;
}) {
	return <Empty icon={icon} title={title} description={description} contents={children} />;
}

// =============================================================================
// Badges
// =============================================================================

const SUBMISSION_BADGE = {
	new: "info",
	read: "secondary",
	spam: "warning",
	trash: "error",
} as const satisfies Record<SubmissionStatus, string>;

export function SubmissionStatusBadge({ status }: { status: SubmissionStatus }) {
	return <Badge variant={SUBMISSION_BADGE[status] ?? "secondary"}>{SUBMISSION_STATUS_LABELS[status] ?? status}</Badge>;
}

export function FormStatusBadge({ status }: { status: FormStatus }) {
	return status === "publish" ? <Badge variant="success">Published</Badge> : <Badge variant="secondary">Draft</Badge>;
}

// =============================================================================
// Announcements
// =============================================================================

/** A polite live region plus a function to announce through it. */
export function useAnnouncer(): [message: string, announce: (text: string) => void] {
	const [message, setMessage] = React.useState("");
	const timer = React.useRef<number | undefined>(undefined);
	const announce = React.useCallback((text: string) => {
		window.clearTimeout(timer.current);
		// Clear first so the same text is announced again.
		setMessage("");
		timer.current = window.setTimeout(() => setMessage(text), 60);
	}, []);
	React.useEffect(() => () => window.clearTimeout(timer.current), []);
	return [message, announce];
}

export function LiveRegion({ message }: { message: string }) {
	return (
		<p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
			{message}
		</p>
	);
}

// =============================================================================
// Dialogs
// =============================================================================

export function ConfirmDialog({
	open,
	title,
	description,
	confirmLabel,
	pendingLabel,
	pending,
	error,
	onConfirm,
	onClose,
	children,
	variant = "destructive",
}: {
	open: boolean;
	title: string;
	description: React.ReactNode;
	confirmLabel: string;
	pendingLabel: string;
	pending: boolean;
	error?: string | null;
	onConfirm: () => void;
	onClose: () => void;
	children?: React.ReactNode;
	variant?: "destructive" | "primary";
}) {
	return (
		<Dialog.Root
			role="alertdialog"
			open={open}
			onOpenChange={(next) => {
				if (!next && !pending) onClose();
			}}
		>
			<Dialog size="sm" className="p-6">
				<div className="cfa-stack-sm">
					<Dialog.Title className="cfa-dialog-title">{title}</Dialog.Title>
					<Dialog.Description className="cfa-help">{description}</Dialog.Description>
				</div>
				{children ? <div className="cfa-dialog-body">{children}</div> : null}
				{error ? (
					<p role="alert" className="cfa-error-text cfa-dialog-body">
						{error}
					</p>
				) : null}
				<div className="cfa-dialog-actions">
					<Button variant="secondary" disabled={pending} onClick={onClose}>
						Cancel
					</Button>
					<Button variant={variant} loading={pending} disabled={pending} onClick={onConfirm}>
						{pending ? pendingLabel : confirmLabel}
					</Button>
				</div>
			</Dialog>
		</Dialog.Root>
	);
}

// =============================================================================
// Controls
// =============================================================================

export function ToggleField({
	label,
	description,
	checked,
	onChange,
	disabled,
}: {
	label: string;
	description?: React.ReactNode;
	checked: boolean;
	onChange: (checked: boolean) => void;
	disabled?: boolean;
}) {
	const descriptionId = React.useId();
	return (
		<div className="cfa-stack-xs">
			<Switch
				label={label}
				checked={checked}
				disabled={disabled}
				onCheckedChange={onChange}
				aria-describedby={description ? descriptionId : undefined}
			/>
			{description ? (
				<p id={descriptionId} className="cfa-help">
					{description}
				</p>
			) : null}
		</div>
	);
}

export function CheckboxField({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	return <Checkbox label={label} checked={checked} onCheckedChange={(value) => onChange(value === true)} />;
}

async function writeClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		// Clipboard API unavailable (insecure context or denied): use a hidden textarea.
		const area = document.createElement("textarea");
		area.value = text;
		area.setAttribute("readonly", "");
		area.style.position = "fixed";
		area.style.opacity = "0";
		document.body.appendChild(area);
		area.select();
		let ok = false;
		try {
			ok = document.execCommand("copy");
		} catch {
			ok = false;
		}
		area.remove();
		return ok;
	}
}

export function copyToClipboard(text: string): Promise<boolean> {
	return writeClipboard(text);
}

export function CopyButton({ text, label = "Copy", srLabel }: { text: string; label?: string; srLabel?: string }) {
	const [state, setState] = React.useState<"idle" | "copied" | "failed">("idle");
	const timer = React.useRef<number | undefined>(undefined);
	React.useEffect(() => () => window.clearTimeout(timer.current), []);
	const copy = async () => {
		const ok = await writeClipboard(text);
		setState(ok ? "copied" : "failed");
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => setState("idle"), 2000);
	};
	return (
		<>
			<Button
				size="sm"
				variant="secondary"
				icon={state === "copied" ? <Check aria-hidden="true" /> : <CopySimple aria-hidden="true" />}
				onClick={() => void copy()}
				aria-label={srLabel}
			>
				{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
			</Button>
			<span className="sr-only" role="status">
				{state === "copied" ? "Copied to the clipboard" : state === "failed" ? "Could not copy. Select the text and copy it manually." : ""}
			</span>
		</>
	);
}

/** Focus an element by id once React has committed the next render. */
export function focusSoon(id: string): void {
	window.requestAnimationFrame(() => {
		window.requestAnimationFrame(() => {
			document.getElementById(id)?.focus();
		});
	});
}

/** Trigger a browser download for a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.rel = "noopener";
	anchor.style.display = "none";
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// =============================================================================
// Tabs (WAI-ARIA tabs pattern, manual activation by click or arrow keys)
// =============================================================================

export interface TabItem<T extends string> {
	id: T;
	label: string;
	hasError?: boolean;
}

export function TabList<T extends string>({
	tabs,
	active,
	onChange,
	idBase,
	label,
}: {
	tabs: readonly TabItem<T>[];
	active: T;
	onChange: (id: T) => void;
	idBase: string;
	label: string;
}) {
	const refs = React.useRef(new Map<T, HTMLButtonElement>());
	const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
		let next = -1;
		if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
		else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
		else if (event.key === "Home") next = 0;
		else if (event.key === "End") next = tabs.length - 1;
		const tab = tabs[next];
		if (!tab) return;
		event.preventDefault();
		onChange(tab.id);
		refs.current.get(tab.id)?.focus();
	};
	return (
		<div role="tablist" aria-label={label} className="cfa-tabs">
			{tabs.map((tab, index) => {
				const selected = tab.id === active;
				return (
					<button
						key={tab.id}
						ref={(node) => {
							if (node) refs.current.set(tab.id, node);
							else refs.current.delete(tab.id);
						}}
						type="button"
						role="tab"
						id={`${idBase}-tab-${tab.id}`}
						aria-selected={selected}
						aria-controls={`${idBase}-panel-${tab.id}`}
						tabIndex={selected ? 0 : -1}
						className="cfa-tab"
						onClick={() => onChange(tab.id)}
						onKeyDown={(event) => onKeyDown(event, index)}
					>
						{tab.label}
						{tab.hasError ? (
							<>
								<span className="cfa-tab-dot" aria-hidden="true" />
								<span className="sr-only">(has errors)</span>
							</>
						) : null}
					</button>
				);
			})}
		</div>
	);
}

/** Panels for every tab exist so `aria-controls` resolves; only the active one renders content. */
export function TabPanel<T extends string>({
	idBase,
	id,
	active,
	children,
}: {
	idBase: string;
	id: T;
	active: T;
	children: () => React.ReactNode;
}) {
	const selected = id === active;
	return (
		<div
			role="tabpanel"
			id={`${idBase}-panel-${id}`}
			aria-labelledby={`${idBase}-tab-${id}`}
			hidden={!selected}
			tabIndex={selected ? 0 : -1}
			className="cfa-tabpanel"
		>
			{selected ? children() : null}
		</div>
	);
}
