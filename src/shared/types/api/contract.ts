/**
 * Route contract machinery (architecture §5.9, §8.1).
 *
 * Every plugin route has exactly one entry in a module contract file `src/shared/types/api/<module>.ts`:
 *   1. an I/O interface member: `"forms/get": RouteContract<{ id: NumericId }, { form: FormDTO }>`
 *   2. a `RouteSpec` in the module's `defineRouteSpecs<ModuleApi>()({...})` table (kind, method, body, owner…)
 * The compiler enforces that (1) and (2) list the same names. The server binds handlers by name
 * (src/server/routes/registry.ts), ROUTES.md is generated from the specs (scripts/gen-routes.mjs), and the admin
 * calls routes through `callRoute()` typed by these interfaces (src/admin/lib/route.ts).
 *
 * This file holds runtime values (the spec tables) on purpose: route access rules are part of the contract.
 * It stays pure (no imports outside src/shared).
 */

/** Input and output of one route. For raw routes `output` is the exact body (WP shape). */
export interface RouteContract<I, O> {
	input: I;
	output: O;
}

/**
 * Route kinds (architecture §8.1):
 * - public: `public: true`; per-route rate limit; reached by browsers and servers.
 * - internal: private, `plugins:manage`; HTTP calls without the dispatcher marker are rejected; reached only through
 *   `locals.emdash.handlePluginApiRoute` from our Astro components and companion endpoints.
 * - workspace: private, `plugins:read` (Editor+); admin or a user with an access grant (D-091), plus form scope.
 * - admin: private, `plugins:manage` (Admin only).
 */
export type RouteKind = "public" | "internal" | "workspace" | "admin";

/** EmDash permission declared per kind (null = public route). */
export const ROUTE_PERMISSIONS = {
	public: null,
	internal: "plugins:manage",
	workspace: "plugins:read",
	admin: "plugins:manage",
} as const satisfies Record<RouteKind, string | null>;

/** Marker header our trusted dispatch calls add to internal routes (architecture §8.1). */
export const INTERNAL_ROUTE_HEADER = "x-core-forms-internal";

export type RouteMethod = "GET" | "HEAD" | "POST";
export type RouteBody = "json" | "form-data" | "bytes" | "text" | "none";
export type RoutePhase = 1 | 2 | 3 | 4;

/** How a workspace route is scoped to forms (D-091): which input field carries the form id(s) to check. */
export type FormScope =
	| { by: "formId" }
	| { by: "id" }
	| { by: "ids" }
	| { by: "submissionId" }
	| { by: "submissionIds" }
	| { by: "none"; reason: string };

export interface RouteSpec {
	kind: RouteKind;
	/** Default ["POST"]. GET routes take query params (no path params on the platform). */
	methods: readonly RouteMethod[];
	/** Request body mode (EmDash `request.body`). "none" for GET. */
	body: RouteBody;
	/** "raw": the handler returns the exact WP body and status (no envelope). Default "json" = `{success, data}`. */
	response: "json" | "raw";
	/** EmDash `request.maxBytes` (default 1 MiB, max 8 MiB). */
	maxBytes?: number;
	/** Request headers the handler reads (documentation; native plugins get the full Request). */
	headers?: readonly string[];
	phase: RoutePhase;
	/** Work package that implements the handler (12-plan.md). */
	owner: string;
	/** Server module file that binds the handler: src/server/routes/<module>.ts. */
	module: string;
	/** One line for ROUTES.md. */
	summary: string;
	/** Spec section(s) that define the behaviour. */
	spec: string;
	/** Admin write of secret leaves: also requires EMDASH_ENCRYPTION_KEY or explicit plaintext acknowledgment. */
	secretWrite?: boolean;
	/** Workspace routes: how the form scope is checked (all ids are checked before any mutation). */
	scope?: FormScope;
	/** Public routes: the rate limit applied, in words (e.g. "submit_rate_limit per form/IP, sliding 1 h"). */
	rateLimit?: string;
	/** Exposed as an MCP tool (architecture §8.2). Requires a private, non-raw, POST-JSON route. */
	mcp?: { tool: string; description: string; destructive: boolean };
}

/** A partial spec as written in contract tables; `defineRouteSpecs` fills the defaults. */
export type RouteSpecInput = Omit<RouteSpec, "methods" | "body" | "response"> &
	Partial<Pick<RouteSpec, "methods" | "body" | "response">>;

type ExactKeys<Api, S> = S & Record<Exclude<keyof S, keyof Api>, never>;

/**
 * Define the spec table of one API module. Keys must match the module's API interface exactly (missing or extra
 * names fail to compile). Defaults: methods ["POST"], body "json", response "json".
 */
export function defineRouteSpecs<Api>() {
	return <const S extends { [K in keyof Api]: RouteSpecInput }>(
		specs: ExactKeys<Api, S>,
	): { readonly [K in keyof S]: RouteSpec & S[K] } => {
		const out: Record<string, RouteSpec> = {};
		for (const [name, spec] of Object.entries(specs as Record<string, RouteSpecInput>)) {
			out[name] = { methods: ["POST"], body: "json", response: "json", ...spec };
		}
		return out as { readonly [K in keyof S]: RouteSpec & S[K] };
	};
}

/** Names of the routes in a spec table whose kind is one of `K`. */
export type RoutesOfKind<Specs, K extends RouteKind> = {
	[N in keyof Specs]: Specs[N] extends { kind: infer Kind } ? (Kind extends K ? N : never) : never;
}[keyof Specs];

/** A raw form-data body as EmDash passes it (`PluginFormData`), for raw public routes. */
export interface FormDataBody {
	entries: ({ name: string; kind: "text"; value: string } | { name: string; kind: "file"; filename: string; contentType: string; bytes: Uint8Array })[];
}

/** A GET query as EmDash passes it (`PluginRouteQuery`). */
export type QueryInput = Record<string, string | string[]>;

/** Cursor pagination used by list routes (D-074). */
export interface CursorPage {
	cursor?: string;
	limit?: number;
}
