/**
 * Core Forms admin entry (`@gatilab/emdash-core-forms/admin`).
 *
 * Page keys are paths under /_emdash/admin/plugins/core-forms. "/" and
 * "/submissions" are listed in the sidebar by the runtime's `admin.pages`;
 * "/form" (the editor) is reached from links only, so it isn't listed.
 */

import type { PluginAdminExports } from "emdash";

import { FormEditorPage } from "./FormEditorPage.js";
import { FormsPage } from "./FormsPage.js";
import { RecentSubmissionsWidget } from "./RecentSubmissionsWidget.js";
import { SubmissionsPage } from "./SubmissionsPage.js";

export const pages: PluginAdminExports["pages"] = {
	"/": FormsPage,
	"/form": FormEditorPage,
	"/submissions": SubmissionsPage,
};

export const widgets: PluginAdminExports["widgets"] = {
	"recent-submissions": RecentSubmissionsWidget,
};
