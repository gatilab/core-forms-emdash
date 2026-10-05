/**
 * Analytics storage records (architecture §6.2, D-120). Phase 3: P3.0 refines these and owns
 * `api/analytics.ts`; they are declared now because the collections exist from Phase 1 (D-016).
 */
import type { IsoDateTime, NumericId, WpValue } from "./primitives.js";

export type AnalyticsEventType = "view" | "start" | "submit" | "abandon" | "spam" | "blocked" | "field_interaction";

/** `analyticsEvents`, id `evt_<ulid>` (WP `cf_analytics` + `day`, `pageHost`). Raw events, 30 days. */
export interface AnalyticsEventRecord {
	id: string;
	formId: NumericId;
	eventType: AnalyticsEventType | (string & {});
	pageUrl: string | null;
	pageHost: string | null;
	utmSource: string | null;
	utmMedium: string | null;
	utmCampaign: string | null;
	fieldName: string | null;
	meta: Record<string, WpValue> | null;
	ipHash: string | null;
	createdAt: IsoDateTime;
	/** YYYY-MM-DD (UTC). */
	day: string;
}

/** `analyticsDaily`, id `<formId>:<YYYY-MM-DD|all>`. */
export interface AnalyticsDailyRecord {
	formId: NumericId;
	day: string;
	view: number;
	start: number;
	submit: number;
	abandon: number;
	spam: number;
	blocked: number;
	fieldInteraction: number;
}

/** `analyticsDims`, id `<formId>:<day|all>:<dim>:<sha1(key)>`. */
export interface AnalyticsDimRecord {
	formId: NumericId;
	day: string;
	dim: "field" | "utm" | "host" | "blocked";
	key: string;
	n: number;
}
