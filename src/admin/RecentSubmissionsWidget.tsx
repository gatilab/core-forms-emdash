/**
 * Dashboard widget `recent-submissions`: unread count and the latest
 * submissions. The host draws the card and its title.
 */

import { Button } from "@cloudflare/kumo";
import * as React from "react";

import type { FormSummary, Submission } from "../core/types.js";
import { getStats, isAbortError, listForms, listSubmissions, type FormStats } from "./api.js";
import { errorMessage, formatDateTime, pluralize, relativeTime, submissionPreview } from "./helpers.js";
import { AdminLink, pluginHref } from "./navigation.js";
import { AdminStyles } from "./styles.js";
import { LoadingState } from "./ui.js";

const SHOWN = 5;

interface WidgetData {
	stats: FormStats | null;
	submissions: Submission[];
	forms: Map<string, FormSummary>;
}

export function RecentSubmissionsWidget() {
	const [data, setData] = React.useState<WidgetData | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [attempt, setAttempt] = React.useState(0);

	React.useEffect(() => {
		const controller = new AbortController();
		const signal = controller.signal;
		setError(null);
		Promise.all([
			getStats({ signal }).catch((cause: unknown) => (isAbortError(cause) ? Promise.reject(cause) : null)),
			// The list has every status; ask for a few extra so spam and trash can be skipped.
			listSubmissions({ limit: SHOWN * 3 }, { signal }),
			listForms({ signal }),
		])
			.then(([stats, page, forms]) =>
				setData({
					stats,
					submissions: page.items.filter((s) => s.status === "new" || s.status === "read").slice(0, SHOWN),
					forms: new Map(forms.items.map((f) => [f.id, f])),
				}),
			)
			.catch((cause: unknown) => {
				if (!isAbortError(cause)) setError(errorMessage(cause, "Could not load submissions."));
			});
		return () => controller.abort();
	}, [attempt]);

	if (error) {
		return (
			<div className="cfa-admin cfa-stack-sm" role="alert">
				<AdminStyles />
				<p className="cfa-error-text">{error}</p>
				<div>
					<Button size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
						Try again
					</Button>
				</div>
			</div>
		);
	}

	if (!data) {
		return (
			<div className="cfa-admin">
				<AdminStyles />
				<LoadingState compact label="Loading recent submissions…" />
			</div>
		);
	}

	const unread = data.stats?.unread ?? data.submissions.filter((s) => s.status === "new").length;

	return (
		<div className="cfa-admin cfa-stack">
			<AdminStyles />
			<p className="cfa-help">
				{unread > 0 ? (
					<AdminLink href={pluginHref("/submissions", { status: "new" })} className="cfa-link-accent">
						{pluralize(unread, "unread submission")}
					</AdminLink>
				) : (
					"No unread submissions."
				)}
				{data.stats ? ` · ${pluralize(data.stats.submissions, "submission")} in total` : null}
			</p>

			{data.submissions.length === 0 ? (
				<p className="cfa-help">
					{data.forms.size === 0 ? (
						<>
							No forms yet.{" "}
							<AdminLink href={pluginHref("/form")} className="cfa-link-accent">
								Create a form
							</AdminLink>
						</>
					) : (
						"No submissions yet."
					)}
				</p>
			) : (
				<ul className="cfa-widget-list">
					{data.submissions.map((submission) => {
						const formTitle = data.forms.get(submission.formId)?.title ?? "Deleted form";
						const preview = submissionPreview(submission.data, 60) || "(empty submission)";
						return (
							<li key={submission.id} className="cfa-widget-item">
								<AdminLink
									href={pluginHref("/submissions", { id: submission.id })}
									className={submission.status === "new" ? "cfa-link cfa-unread cfa-truncate" : "cfa-link cfa-truncate"}
								>
									{submission.status === "new" ? <span className="sr-only">Unread: </span> : null}
									{preview}
								</AdminLink>
								<time
									className="cfa-widget-meta"
									dateTime={submission.submittedAt}
									title={formatDateTime(submission.submittedAt)}
								>
									{relativeTime(submission.submittedAt)}
								</time>
								<span className="cfa-widget-meta">{formTitle}</span>
							</li>
						);
					})}
				</ul>
			)}

			<AdminLink href={pluginHref("/submissions")} className="cfa-link-accent cfa-help">
				View all submissions
			</AdminLink>
		</div>
	);
}
