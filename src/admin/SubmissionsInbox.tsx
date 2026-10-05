/**
 * Submissions inbox: filters, cursor pagination, bulk actions, a detail panel
 * and CSV export. Used by the Submissions page (filters in the URL) and the
 * form editor's Submissions tab (fixed to one form).
 */

import { Button, Checkbox, Select } from "@cloudflare/kumo";
import { ArrowClockwise, DownloadSimple, Tray, X } from "@phosphor-icons/react";
import * as React from "react";

import type { FieldValue, FormSummary, Submission, SubmissionStatus } from "../core/types.js";
import {
	deleteSubmissions,
	exportSubmissions,
	getSubmission,
	isAbortError,
	listForms,
	listSubmissions,
	updateSubmissions,
} from "./api.js";
import {
	csvFilename,
	errorMessage,
	formatDateTime,
	formatFieldValue,
	pluralize,
	relativeTime,
	SUBMISSION_STATUS_LABELS,
	submissionPreview,
} from "./helpers.js";
import { setSearchParams, useSearchParams } from "./navigation.js";
import {
	ConfirmDialog,
	downloadBlob,
	EmptyState,
	ErrorNotice,
	LiveRegion,
	LoadingState,
	SubmissionStatusBadge,
	useAnnouncer,
} from "./ui.js";

const PAGE_SIZE = 25;
const ALL = "all";
const STATUSES: SubmissionStatus[] = ["new", "read", "spam", "trash"];

const STATUS_ITEMS = [
	{ value: ALL, label: "All statuses" },
	...STATUSES.map((status) => ({ value: status, label: SUBMISSION_STATUS_LABELS[status] })),
];

const isStatus = (value: unknown): value is SubmissionStatus => STATUSES.includes(value as SubmissionStatus);

export interface InboxForm {
	id: string;
	title: string;
	slug: string;
}

interface Filters {
	formId: string;
	status: SubmissionStatus | "";
	openId: string | null;
}

interface Detail {
	submission: Submission;
	form: FormSummary | null;
}

export function SubmissionsInbox({ fixedForm, syncUrl = false }: { fixedForm?: InboxForm; syncUrl?: boolean }) {
	// ---- filters: from the URL on the Submissions page, local state elsewhere
	const params = useSearchParams();
	const [localFilters, setLocalFilters] = React.useState<Filters>({ formId: "", status: "", openId: null });
	const filters: Filters = syncUrl
		? {
				formId: params.get("formId") ?? "",
				status: isStatus(params.get("status")) ? (params.get("status") as SubmissionStatus) : "",
				openId: params.get("id"),
			}
		: localFilters;
	const formId = fixedForm?.id ?? filters.formId;
	const { status, openId } = filters;

	const setFilters = React.useCallback(
		(patch: Partial<Filters>) => {
			if (syncUrl) {
				setSearchParams({
					...("formId" in patch ? { formId: patch.formId || undefined } : {}),
					...("status" in patch ? { status: patch.status || undefined } : {}),
					...("openId" in patch ? { id: patch.openId ?? undefined } : {}),
				});
			} else {
				setLocalFilters((current) => ({ ...current, ...patch }));
			}
		},
		[syncUrl],
	);

	// ---- data
	const [forms, setForms] = React.useState<FormSummary[] | null>(null);
	const [items, setItems] = React.useState<Submission[] | null>(null);
	const [nextCursor, setNextCursor] = React.useState<string | undefined>();
	const [loadError, setLoadError] = React.useState<string | null>(null);
	const [loadingMore, setLoadingMore] = React.useState(false);
	const [reloadKey, setReloadKey] = React.useState(0);
	const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
	const [busy, setBusy] = React.useState(false);
	const [actionError, setActionError] = React.useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = React.useState<string[] | null>(null);
	const [deleting, setDeleting] = React.useState(false);
	const [deleteError, setDeleteError] = React.useState<string | null>(null);
	const [exporting, setExporting] = React.useState(false);
	const [announcement, announce] = useAnnouncer();

	React.useEffect(() => {
		if (fixedForm) return;
		const controller = new AbortController();
		listForms({ signal: controller.signal })
			.then(({ items: list }) => setForms([...list].sort((a, b) => a.title.localeCompare(b.title))))
			.catch((error: unknown) => {
				if (!isAbortError(error)) setForms([]);
			});
		return () => controller.abort();
	}, [fixedForm]);

	React.useEffect(() => {
		const controller = new AbortController();
		setItems(null);
		setNextCursor(undefined);
		setLoadError(null);
		setSelected(new Set());
		listSubmissions(
			{ formId: formId || undefined, status: status || undefined, limit: PAGE_SIZE },
			{ signal: controller.signal },
		)
			.then((page) => {
				setItems(page.items);
				setNextCursor(page.nextCursor);
			})
			.catch((error: unknown) => {
				if (!isAbortError(error)) setLoadError(errorMessage(error, "Could not load submissions."));
			});
		return () => controller.abort();
	}, [formId, status, reloadKey]);

	const loadMore = async () => {
		if (!nextCursor) return;
		setLoadingMore(true);
		try {
			const page = await listSubmissions({
				formId: formId || undefined,
				status: status || undefined,
				limit: PAGE_SIZE,
				cursor: nextCursor,
			});
			setItems((current) => {
				const seen = new Set((current ?? []).map((s) => s.id));
				return [...(current ?? []), ...page.items.filter((s) => !seen.has(s.id))];
			});
			setNextCursor(page.nextCursor);
			announce(`Loaded ${pluralize(page.items.length, "more submission")}.`);
		} catch (error) {
			setActionError(errorMessage(error, "Could not load more submissions."));
		} finally {
			setLoadingMore(false);
		}
	};

	// ---- detail
	const [detail, setDetail] = React.useState<Detail | null>(null);
	const [detailError, setDetailError] = React.useState<string | null>(null);
	/** Submissions this inbox already marked read on open. */
	const markedRead = React.useRef(new Set<string>());

	// `items` is read only for the instant preview, so the effect keys on `openId` alone.
	React.useEffect(() => {
		if (!openId) {
			setDetail(null);
			setDetailError(null);
			return;
		}
		const controller = new AbortController();
		setDetailError(null);
		// Show what the list already has while the full record loads.
		setDetail((current) => {
			if (current?.submission.id === openId) return current;
			const fromList = items?.find((s) => s.id === openId);
			return fromList ? { submission: fromList, form: null } : null;
		});
		getSubmission(openId, { signal: controller.signal })
			.then((result) => {
				// The read-marking request may have finished after this fetch started.
				const stale = result.submission.status === "new" && markedRead.current.has(result.submission.id);
				setDetail(stale ? { ...result, submission: { ...result.submission, status: "read" } } : result);
			})
			.catch((error: unknown) => {
				if (!isAbortError(error)) setDetailError(errorMessage(error, "Could not load the submission."));
			});
		return () => controller.abort();
	}, [openId]);

	const formsById = React.useMemo(() => {
		const map = new Map<string, InboxForm>();
		if (fixedForm) map.set(fixedForm.id, fixedForm);
		for (const form of forms ?? []) map.set(form.id, form);
		return map;
	}, [forms, fixedForm]);

	const formTitle = (id: string) => formsById.get(id)?.title ?? "Deleted form";

	// ---- mutations
	const applyStatus = async (ids: string[], next: SubmissionStatus, options: { quiet?: boolean } = {}) => {
		if (!ids.length) return;
		setBusy(true);
		setActionError(null);
		try {
			await updateSubmissions(ids, next);
			const changed = new Set(ids);
			setItems((current) => {
				if (!current) return current;
				const updated = current.map((s) => (changed.has(s.id) ? { ...s, status: next } : s));
				// Items that no longer match the status filter leave the list, except quiet read-marking.
				return status && status !== next && !options.quiet ? updated.filter((s) => !changed.has(s.id)) : updated;
			});
			setDetail((current) =>
				current && changed.has(current.submission.id)
					? { ...current, submission: { ...current.submission, status: next } }
					: current,
			);
			if (!options.quiet) {
				setSelected((current) => new Set([...current].filter((id) => !changed.has(id))));
				announce(`${pluralize(ids.length, "submission")} marked as ${SUBMISSION_STATUS_LABELS[next].toLowerCase()}.`);
			}
		} catch (error) {
			setActionError(errorMessage(error, "Could not update the submissions."));
		} finally {
			setBusy(false);
		}
	};

	const runDelete = async () => {
		if (!confirmDelete) return;
		setDeleting(true);
		setDeleteError(null);
		try {
			await deleteSubmissions(confirmDelete);
			const removed = new Set(confirmDelete);
			setItems((current) => current?.filter((s) => !removed.has(s.id)) ?? current);
			setSelected((current) => new Set([...current].filter((id) => !removed.has(id))));
			if (openId && removed.has(openId)) setFilters({ openId: null });
			announce(`Deleted ${pluralize(confirmDelete.length, "submission")}.`);
			setConfirmDelete(null);
		} catch (error) {
			setDeleteError(errorMessage(error, "Could not delete the submissions."));
		} finally {
			setDeleting(false);
		}
	};

	const runExport = async () => {
		if (!formId) return;
		setExporting(true);
		setActionError(null);
		try {
			const { blob, filename } = await exportSubmissions(formId);
			downloadBlob(blob, filename ?? csvFilename(formsById.get(formId)?.slug));
			announce("CSV export downloaded.");
		} catch (error) {
			setActionError(errorMessage(error, "Could not export submissions."));
		} finally {
			setExporting(false);
		}
	};

	// ---- open / close the detail panel
	const lastOpener = React.useRef<string | null>(null);
	const open = (submission: Submission) => {
		lastOpener.current = submission.id;
		setFilters({ openId: submission.id });
	};
	const close = () => {
		const id = openId ?? lastOpener.current;
		setFilters({ openId: null });
		if (id) window.requestAnimationFrame(() => document.getElementById(`cfa-open-${id}`)?.focus());
	};

	// Opening a submission marks it read, like an email inbox. Only once per
	// submission, so "Mark unread" sticks.
	const detailId = detail?.submission.id;
	const detailStatus = detail?.submission.status;
	const applyStatusRef = React.useRef(applyStatus);
	React.useLayoutEffect(() => {
		applyStatusRef.current = applyStatus;
	});
	React.useEffect(() => {
		if (!detailId || detailStatus !== "new" || markedRead.current.has(detailId)) return;
		markedRead.current.add(detailId);
		void applyStatusRef.current([detailId], "read", { quiet: true });
	}, [detailId, detailStatus]);

	// ---- selection
	const visibleIds = items?.map((s) => s.id) ?? [];
	const selectedVisible = visibleIds.filter((id) => selected.has(id));
	const allSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
	const someSelected = selectedVisible.length > 0 && !allSelected;
	const toggleAll = (checked: boolean) => setSelected(checked ? new Set(visibleIds) : new Set());
	const toggleOne = (id: string, checked: boolean) =>
		setSelected((current) => {
			const next = new Set(current);
			if (checked) next.add(id);
			else next.delete(id);
			return next;
		});

	const exportForm = formId ? formsById.get(formId) : undefined;
	const formItems = [{ value: ALL, label: "All forms" }, ...(forms ?? []).map((f) => ({ value: f.id, label: f.title || f.slug }))];

	return (
		<div className="cfa-stack">
			<LiveRegion message={announcement} />

			<div className="cfa-row">
				{fixedForm ? null : (
					<div className="cfa-filter">
						<Select
							aria-label="Filter by form"
							value={formId || ALL}
							items={formItems}
							disabled={forms === null}
							onValueChange={(value) => setFilters({ formId: value && value !== ALL ? String(value) : "", openId: null })}
						/>
					</div>
				)}
				<div className="cfa-filter">
					<Select
						aria-label="Filter by status"
						value={status || ALL}
						items={STATUS_ITEMS}
						onValueChange={(value) => setFilters({ status: isStatus(value) ? value : "", openId: null })}
					/>
				</div>
				<Button
					variant="ghost"
					shape="square"
					aria-label="Refresh submissions"
					icon={<ArrowClockwise aria-hidden="true" />}
					onClick={() => setReloadKey((n) => n + 1)}
				/>
				<span className="cfa-grow" />
				<Button
					variant="secondary"
					icon={<DownloadSimple aria-hidden="true" />}
					loading={exporting}
					disabled={!formId || exporting}
					aria-describedby={formId ? undefined : "cfa-export-help"}
					onClick={() => void runExport()}
				>
					Export CSV
				</Button>
			</div>
			{formId ? (
				exportForm ? (
					<p className="cfa-help">The CSV includes every submission for “{exportForm.title}” except those in the trash.</p>
				) : null
			) : (
				<p id="cfa-export-help" className="cfa-help">
					Choose a form to export its submissions as CSV.
				</p>
			)}

			{actionError ? <ErrorNotice title="That didn't work" message={actionError} /> : null}

			{selected.size > 0 ? (
				<div className="cfa-bulkbar" role="region" aria-label="Bulk actions">
					<span className="cfa-label">{pluralize(selected.size, "submission")} selected</span>
					<Button size="sm" variant="secondary" disabled={busy} onClick={() => void applyStatus([...selected], "read")}>
						Mark read
					</Button>
					<Button size="sm" variant="secondary" disabled={busy} onClick={() => void applyStatus([...selected], "new")}>
						Mark unread
					</Button>
					{status === "spam" || status === "trash" ? (
						<Button size="sm" variant="secondary" disabled={busy} onClick={() => void applyStatus([...selected], "read")}>
							{status === "spam" ? "Not spam" : "Restore"}
						</Button>
					) : null}
					{status !== "spam" ? (
						<Button size="sm" variant="secondary" disabled={busy} onClick={() => void applyStatus([...selected], "spam")}>
							Spam
						</Button>
					) : null}
					{status !== "trash" ? (
						<Button size="sm" variant="secondary" disabled={busy} onClick={() => void applyStatus([...selected], "trash")}>
							Trash
						</Button>
					) : null}
					<Button
						size="sm"
						variant="secondary-destructive"
						disabled={busy}
						onClick={() => {
							setDeleteError(null);
							setConfirmDelete([...selected]);
						}}
					>
						Delete permanently
					</Button>
					<Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
						Clear selection
					</Button>
				</div>
			) : null}

			<div className="cfa-inbox" data-detail-open={openId ? "" : undefined}>
				<div className="cfa-stack" style={{ minWidth: 0 }}>
					{loadError ? (
						<ErrorNotice title="Could not load submissions" message={loadError} onRetry={() => setReloadKey((n) => n + 1)} />
					) : items === null ? (
						<LoadingState label="Loading submissions…" />
					) : items.length === 0 ? (
						<EmptyState
							icon={<Tray size={40} aria-hidden="true" />}
							title={status ? `No ${SUBMISSION_STATUS_LABELS[status].toLowerCase()} submissions` : "No submissions yet"}
							description={
								status || (formId && !fixedForm)
									? "Nothing matches these filters."
									: "Submissions appear here as soon as someone sends a form."
							}
						/>
					) : (
						<>
							<div className="cfa-table-wrap">
								<table className="cfa-table" aria-busy={busy || undefined}>
									<caption className="sr-only">Submissions, newest first</caption>
									<thead>
										<tr>
											<th scope="col" className="cfa-check">
												<Checkbox
													aria-label="Select all submissions shown"
													checked={allSelected}
													indeterminate={someSelected}
													onCheckedChange={(checked) => toggleAll(checked === true)}
												/>
											</th>
											<th scope="col">Submission</th>
											{fixedForm ? null : <th scope="col">Form</th>}
											<th scope="col">Status</th>
											<th scope="col">Received</th>
										</tr>
									</thead>
									<tbody>
										{items.map((submission) => {
											const preview = submissionPreview(submission.data) || "(empty submission)";
											const received = formatDateTime(submission.submittedAt);
											return (
												<tr
													key={submission.id}
													data-active={submission.id === openId ? "" : undefined}
													onClick={(event) => {
														if ((event.target as HTMLElement).closest("a,button,input,label")) return;
														open(submission);
													}}
												>
													<td className="cfa-check" onClick={(event) => event.stopPropagation()}>
														<Checkbox
															aria-label={`Select submission received ${received}`}
															checked={selected.has(submission.id)}
															onCheckedChange={(checked) => toggleOne(submission.id, checked === true)}
														/>
													</td>
													<td>
														<button
															type="button"
															id={`cfa-open-${submission.id}`}
															className={submission.status === "new" ? "cfa-link-button cfa-unread" : "cfa-link-button"}
															aria-current={submission.id === openId ? "true" : undefined}
															onClick={() => open(submission)}
														>
															<span className="cfa-truncate">{preview}</span>
														</button>
													</td>
													{fixedForm ? null : <td>{formTitle(submission.formId)}</td>}
													<td>
														<SubmissionStatusBadge status={submission.status} />
													</td>
													<td>
														<time dateTime={submission.submittedAt} title={received}>
															{relativeTime(submission.submittedAt)}
														</time>
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
							<div className="cfa-row cfa-between">
								<p className="cfa-help">
									Showing {pluralize(items.length, "submission")}
									{nextCursor ? "" : " (all)"}
								</p>
								{nextCursor ? (
									<Button variant="secondary" loading={loadingMore} disabled={loadingMore} onClick={() => void loadMore()}>
										Load more
									</Button>
								) : null}
							</div>
						</>
					)}
				</div>

				{openId ? (
					<SubmissionDetail
						key={openId}
						detail={detail?.submission.id === openId ? detail : null}
						error={detailError}
						formTitle={detail?.form?.title ?? (detail ? formTitle(detail.submission.formId) : "")}
						busy={busy}
						onClose={close}
						onStatus={(next) => void applyStatus([openId], next)}
						onDelete={() => {
							setDeleteError(null);
							setConfirmDelete([openId]);
						}}
					/>
				) : null}
			</div>

			<ConfirmDialog
				open={confirmDelete !== null}
				title={
					confirmDelete && confirmDelete.length > 1
						? `Delete ${pluralize(confirmDelete.length, "submission")} permanently?`
						: "Delete this submission permanently?"
				}
				description="This can't be undone. Move submissions to the trash instead if you might need them later."
				confirmLabel="Delete permanently"
				pendingLabel="Deleting…"
				pending={deleting}
				error={deleteError}
				onConfirm={() => void runDelete()}
				onClose={() => setConfirmDelete(null)}
			/>
		</div>
	);
}

// =============================================================================
// Detail panel
// =============================================================================

const EMAIL_VALUE = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/;
const URL_VALUE = /^https?:\/\/\S+$/i;

function FieldValueView({ value }: { value: FieldValue | null | undefined }) {
	const text = formatFieldValue(value);
	if (!text.trim()) return <span className="cfa-help">(empty)</span>;
	if (EMAIL_VALUE.test(text)) return <a className="cfa-link-accent" href={`mailto:${text}`}>{text}</a>;
	if (URL_VALUE.test(text)) {
		return (
			<a className="cfa-link-accent" href={text} target="_blank" rel="noopener noreferrer">
				{text}
			</a>
		);
	}
	return <>{text}</>;
}

function SubmissionDetail({
	detail,
	error,
	formTitle,
	busy,
	onClose,
	onStatus,
	onDelete,
}: {
	detail: Detail | null;
	error: string | null;
	formTitle: string;
	busy: boolean;
	onClose: () => void;
	onStatus: (status: SubmissionStatus) => void;
	onDelete: () => void;
}) {
	const heading = React.useRef<HTMLHeadingElement>(null);
	React.useEffect(() => {
		heading.current?.focus();
	}, []);

	const submission = detail?.submission;
	const entries = submission ? Object.entries(submission.data) : [];
	const meta: [string, React.ReactNode][] = submission
		? [
				[
					"Received",
					<time key="t" dateTime={submission.submittedAt}>
						{formatDateTime(submission.submittedAt)}
					</time>,
				],
				["Form", formTitle || "Deleted form"],
				["IP address", submission.ip || "Not stored"],
				["Country", submission.country || "Unknown"],
				["Page", submission.refererUrl ? <FieldValueView key="r" value={submission.refererUrl} /> : "Unknown"],
				["Browser", submission.userAgent || "Unknown"],
			]
		: [];

	return (
		<aside
			className="cfa-card cfa-detail"
			aria-labelledby="cfa-detail-title"
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.stopPropagation();
					onClose();
				}
			}}
		>
			<div className="cfa-row cfa-between">
				<h2 id="cfa-detail-title" ref={heading} tabIndex={-1} className="cfa-section-title">
					Submission
				</h2>
				<Button variant="ghost" shape="square" aria-label="Close submission" icon={<X aria-hidden="true" />} onClick={onClose} />
			</div>

			{error ? (
				<ErrorNotice title="Could not load the submission" message={error} />
			) : !submission ? (
				<LoadingState compact label="Loading submission…" />
			) : (
				<>
					<div className="cfa-row">
						<SubmissionStatusBadge status={submission.status} />
						<span className="cfa-help">{relativeTime(submission.submittedAt)}</span>
					</div>

					<section className="cfa-stack-sm" aria-labelledby="cfa-detail-fields">
						<h3 id="cfa-detail-fields" className="cfa-label">
							Fields
						</h3>
						{entries.length ? (
							<dl className="cfa-dl">
								{entries.map(([name, value]) => (
									<div key={name}>
										<dt>{name}</dt>
										<dd>
											<FieldValueView value={value} />
										</dd>
									</div>
								))}
							</dl>
						) : (
							<p className="cfa-help">This submission has no field data.</p>
						)}
					</section>

					<section className="cfa-stack-sm" aria-labelledby="cfa-detail-meta">
						<h3 id="cfa-detail-meta" className="cfa-label">
							Details
						</h3>
						<dl className="cfa-dl cfa-dl-meta">
							{meta.map(([label, value]) => (
								<div key={label}>
									<dt>{label}</dt>
									<dd>{value}</dd>
								</div>
							))}
						</dl>
					</section>

					<div className="cfa-row" role="group" aria-label="Submission actions">
						{submission.status === "new" ? (
							<Button size="sm" variant="secondary" disabled={busy} onClick={() => onStatus("read")}>
								Mark read
							</Button>
						) : submission.status === "read" ? (
							<Button size="sm" variant="secondary" disabled={busy} onClick={() => onStatus("new")}>
								Mark unread
							</Button>
						) : null}
						{submission.status === "spam" ? (
							<Button size="sm" variant="secondary" disabled={busy} onClick={() => onStatus("read")}>
								Not spam
							</Button>
						) : (
							<Button size="sm" variant="secondary" disabled={busy} onClick={() => onStatus("spam")}>
								Mark as spam
							</Button>
						)}
						{submission.status === "trash" ? (
							<Button size="sm" variant="secondary" disabled={busy} onClick={() => onStatus("read")}>
								Restore
							</Button>
						) : (
							<Button size="sm" variant="secondary" disabled={busy} onClick={() => onStatus("trash")}>
								Move to trash
							</Button>
						)}
						<Button size="sm" variant="secondary-destructive" disabled={busy} onClick={onDelete}>
							Delete permanently
						</Button>
					</div>
				</>
			)}
		</aside>
	);
}
