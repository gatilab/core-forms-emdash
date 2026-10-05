/**
 * Every route contract. Contract packages (P2.0, P3.0, P4.0) add their modules here.
 */
import type { RoutesOfKind } from "./contract.js";
import { type DangerApi, dangerRoutes } from "./danger.js";
import { type DataApi, dataRoutes } from "./data.js";
import { type DoctorApi, doctorRoutes } from "./doctor.js";
import { type DraftsApi, draftsRoutes } from "./drafts.js";
import { type EmailLogsApi, emailLogsRoutes } from "./email-logs.js";
import { type FieldGroupsApi, fieldGroupsRoutes } from "./field-groups.js";
import { type FilesApi, filesRoutes } from "./files.js";
import { type FormsApi, formsRoutes } from "./forms.js";
import { type HeadlessApi, headlessRoutes } from "./headless.js";
import { type JobsApi, jobsRoutes } from "./jobs.js";
import { type MaintenanceApi, maintenanceRoutes } from "./maintenance.js";
import { type MigrateApi, migrateRoutes } from "./migrate.js";
import { type PollsApi, pollsRoutes } from "./polls.js";
import { type PrivacyApi, privacyRoutes } from "./privacy.js";
import { type RenderApi, renderRoutes } from "./render.js";
import { type RepliesApi, repliesRoutes } from "./replies.js";
import { type RetentionApi, retentionRoutes } from "./retention.js";
import { type SettingsApi, settingsRoutes } from "./settings.js";
import { type SubmissionsApi, submissionsRoutes } from "./submissions.js";
import { type SubmitApi, submitRoutes } from "./submit.js";
import { type TeamApi, teamRoutes } from "./team.js";
import { type ThemeApi, themeRoutes } from "./theme.js";
import { type UsersApi, usersRoutes } from "./users.js";

export * from "./contract.js";

/** Every route's I/O. */
export interface CoreFormsApi
	extends SubmitApi,
		RenderApi,
		HeadlessApi,
		DraftsApi,
		PollsApi,
		FilesApi,
		FormsApi,
		FieldGroupsApi,
		SettingsApi,
		ThemeApi,
		SubmissionsApi,
		RepliesApi,
		TeamApi,
		UsersApi,
		EmailLogsApi,
		PrivacyApi,
		RetentionApi,
		DataApi,
		MigrateApi,
		DoctorApi,
		MaintenanceApi,
		JobsApi,
		DangerApi {}

/** Every route's spec, keyed by route name. */
export const ROUTE_SPECS = {
	...submitRoutes,
	...renderRoutes,
	...headlessRoutes,
	...draftsRoutes,
	...pollsRoutes,
	...filesRoutes,
	...formsRoutes,
	...fieldGroupsRoutes,
	...settingsRoutes,
	...themeRoutes,
	...submissionsRoutes,
	...repliesRoutes,
	...teamRoutes,
	...usersRoutes,
	...emailLogsRoutes,
	...privacyRoutes,
	...retentionRoutes,
	...dataRoutes,
	...migrateRoutes,
	...doctorRoutes,
	...maintenanceRoutes,
	...jobsRoutes,
	...dangerRoutes,
} as const;

export type RouteName = keyof typeof ROUTE_SPECS;

/** Routes the admin UI may call (workspace + admin kinds), typed for `callRoute`. */
export type AdminRouteName = RoutesOfKind<typeof ROUTE_SPECS, "workspace" | "admin"> & keyof CoreFormsApi;
export type AdminApi = Pick<CoreFormsApi, AdminRouteName>;

export type PublicRouteName = RoutesOfKind<typeof ROUTE_SPECS, "public"> & keyof CoreFormsApi;
export type InternalRouteName = RoutesOfKind<typeof ROUTE_SPECS, "internal"> & keyof CoreFormsApi;
export type InternalApi = Pick<CoreFormsApi, InternalRouteName>;
