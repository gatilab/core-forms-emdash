/**
 * Package options (architecture §2.2). Shared by `coreForms()` (plugin descriptor) and `coreFormsSite()`
 * (companion integration): sites pass the SAME object to both (D-005).
 */

export interface CoreFormsSiteOptions {
	/** Standalone base path segment: /<standaloneBase>/<slug>/. Build-time (D-052). Default "collect". */
	standaloneBase?: string;
	/** Customer portal base. Default "/account". Migrated WP stores use "/license-dashboard". */
	portalBase?: string;
	/** Native checkout page path. Default "/core-checkout". */
	checkoutPath?: string;
	/**
	 * Serve WordPress-compatible paths: /wp-json/core-forms/v1/*, /wp-json/cf/v1/*, and the ?edd_action, ?cf-form,
	 * ?cf_payment_return, ?product, ?cf_license_access query handlers. Default true.
	 */
	wpCompat?: boolean;
	/** R2 binding name for private files (uploads, packages, staged imports). Default "CORE_FORMS_PRIVATE". */
	privateBucket?: string;
	/** Optional Astro layout component (module path) that wraps standalone and portal pages. */
	layout?: string;
	/** Optional module path, imported once per isolate, that calls registerCoreFormsExtension(). */
	extensions?: string;
}

export interface CoreFormsOptions {
	/** Pass the SAME object given to coreFormsSite(). `false`/absent means no companion integration (D-005). */
	site?: CoreFormsSiteOptions | false;
	/** Overrides site.privateBucket for the plugin runtime. */
	privateBucket?: string;
	/** Optional Workers Analytics Engine binding for raw analytics events (D-120). */
	analyticsEngine?: string;
	/** Cron schedule for the single recurring task. Default "* * * * *". */
	tickSchedule?: string;
}

/** Defaults applied to `CoreFormsSiteOptions` (architecture §2.2). */
export const SITE_OPTION_DEFAULTS = {
	standaloneBase: "collect",
	portalBase: "/account",
	checkoutPath: "/core-checkout",
	wpCompat: true,
	privateBucket: "CORE_FORMS_PRIVATE",
} as const satisfies Required<Pick<CoreFormsSiteOptions, "standaloneBase" | "portalBase" | "checkoutPath" | "wpCompat" | "privateBucket">>;

/** Default cron schedule of the single `tick` task (D-040). */
export const DEFAULT_TICK_SCHEDULE = "* * * * *";
