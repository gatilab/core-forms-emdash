/**
 * Storage query shapes used by repository ports. They mirror EmDash plugin storage semantics (spec 00 §3):
 * AND-only, indexed fields only, limit ≤ 100, cursor pagination, no OR / neq / substring.
 */
import type { WpScalar } from "./primitives.js";

/** Range filter on one indexed field. */
export interface WhereRange<V> {
	gt?: V;
	gte?: V;
	lt?: V;
	lte?: V;
}

/** Filter for one field: equality, `in`, range, `startsWith`, or null. */
export type WhereValue<V> = V | null | { in: readonly V[] } | WhereRange<V> | { startsWith: string };

/** AND-only filter over the indexed fields `F` of a record. */
export type Where<F extends Record<string, WpScalar>> = { [K in keyof F]?: WhereValue<F[K]> };

export interface PageQuery<F extends Record<string, WpScalar>> {
	where?: Where<F>;
	orderBy?: { [K in keyof F]?: "asc" | "desc" };
	/** ≤ 100 (platform cap). */
	limit?: number;
	cursor?: string;
}

export interface Page<T> {
	items: T[];
	nextCursor?: string;
}
