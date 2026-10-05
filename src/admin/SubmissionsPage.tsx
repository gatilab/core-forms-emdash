/**
 * Submissions page (`/submissions`): the inbox across all forms. Filters and
 * the open submission live in the URL (`?formId=&status=&id=`), so links from
 * the forms list and the dashboard widget land on the right view.
 */

import { SubmissionsInbox } from "./SubmissionsInbox.js";
import { AdminPage, PageHeader } from "./ui.js";

export function SubmissionsPage() {
	return (
		<AdminPage>
			<PageHeader
				title="Submissions"
				description="Everything sent through your forms. Open a submission to read it; opening marks it read."
			/>
			<SubmissionsInbox syncUrl />
		</AdminPage>
	);
}
