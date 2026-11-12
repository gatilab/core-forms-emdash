import { describe, expect, it } from "vitest";

import { STORAGE } from "../src/index.js";
import { adminRoutes } from "../src/routes.js";
import type { FormDefinition } from "../src/core/types.js";

/**
 * EmDash builds a unique index over the whole shared `_plugin_storage` table,
 * as (plugin_id, collection, $.field). A unique index on `slug` therefore also
 * rejects repeated `slug` values in every other plugin's collections: with it
 * declared here, Link Manager could keep only one click record per link.
 */
describe("plugin storage declaration", () => {
	it("declares no unique indexes", () => {
		for (const [collection, config] of Object.entries(STORAGE)) {
			expect((config as { uniqueIndexes?: unknown[] }).uniqueIndexes ?? [], collection).toEqual([]);
		}
	});

	it("still indexes the form slug, which the routes query by", () => {
		expect(STORAGE.forms?.indexes).toContain("slug");
	});
});

/** The smallest `forms` collection the save and duplicate routes need. */
function fakeContext(input: unknown, rows: Map<string, FormDefinition>) {
	const forms = {
		get: async (id: string) => rows.get(id) ?? null,
		put: async (id: string, data: FormDefinition) => void rows.set(id, data),
		query: async ({ where, limit = 50 }: { where?: Record<string, unknown>; limit?: number }) => {
			const items = [...rows.entries()]
				.filter(([, data]) => Object.entries(where ?? {}).every(([key, value]) => (data as unknown as Record<string, unknown>)[key] === value))
				.slice(0, limit)
				.map(([id, data]) => ({ id, data }));
			return { items, hasMore: false };
		},
	};
	return { input, storage: { forms } } as unknown as Parameters<(typeof adminRoutes)["forms/save"]>[0];
}

describe("form slugs stay unique without a database constraint", () => {
	const markup = '<p><label for="e">Email</label> <input id="e" type="email" name="email"></p><button type="submit">Send</button>';

	it("gives a second form with the same slug a suffix", async () => {
		const rows = new Map<string, FormDefinition>();
		const first = await adminRoutes["forms/save"](fakeContext({ form: { title: "Contact", slug: "contact", markup } }, rows));
		const second = await adminRoutes["forms/save"](fakeContext({ form: { title: "Contact", slug: "contact", markup } }, rows));
		expect(first.form.slug).toBe("contact");
		expect(second.form.slug).toBe("contact-2");
		expect(new Set([...rows.values()].map((form) => form.slug)).size).toBe(2);
	});

	it("keeps a form's own slug when it is saved again", async () => {
		const rows = new Map<string, FormDefinition>();
		const { form } = await adminRoutes["forms/save"](fakeContext({ form: { title: "Contact", slug: "contact", markup } }, rows));
		const again = await adminRoutes["forms/save"](fakeContext({ form: { ...form, title: "Contact us" } }, rows));
		expect(again.form.id).toBe(form.id);
		expect(again.form.slug).toBe("contact");
		expect(rows.size).toBe(1);
	});

	it("gives a duplicated form its own slug", async () => {
		const rows = new Map<string, FormDefinition>();
		const { form } = await adminRoutes["forms/save"](fakeContext({ form: { title: "Contact", slug: "contact", markup } }, rows));
		const copy = await adminRoutes["forms/duplicate"](fakeContext({ id: form.id }, rows));
		expect(copy.form.slug).not.toBe(form.slug);
		expect(copy.form.slug).toBe("contact-copy");
	});
});
