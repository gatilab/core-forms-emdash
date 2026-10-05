import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
	normalizeForm,
	parseFields,
	processSubmission,
	renderForm,
	enhanceFields,
	autocompleteFor,
	replaceDataVariables,
	runActions,
	submissionsToCsv,
	validate,
	fillMarkupTags,
	type FormDefinition,
	type ProcessDeps,
	type RawEntry,
	type Submission,
} from "../src/core/index.js";

const wp = JSON.parse(readFileSync(new URL("./fixtures/wp-form.json", import.meta.url), "utf8"));
const form: FormDefinition = normalizeForm(wp, "2026-10-05T00:00:00.000Z");

const valid: RawEntry[] = [
	{ name: "_cf_form_id", value: form.id },
	{ name: `_cf_h${form.id}`, value: "" },
	{ name: "name", value: "Asha Rao" },
	{ name: "email", value: "asha@example.com" },
	{ name: "website", value: "https://asha.example" },
	{ name: "service", value: "Web Development" },
	{ name: "project_type", value: "Ecommerce store" },
	{ name: "budget", value: "Not sure yet" },
	{ name: "timeline", value: "Within a month" },
	{ name: "details", value: "Line one\nLine two <b>bold</b>" },
	{ name: "consent", value: "yes" },
];

function deps(overrides: Partial<ProcessDeps> = {}) {
	const store = new Map<string, Submission>();
	const counters = new Map<string, number>();
	const remembered = new Set<string>();
	const after = vi.fn();
	const blocked = vi.fn();
	const d: ProcessDeps = {
		now: () => new Date("2026-10-05T10:00:00Z"),
		newId: () => `sub-${store.size + 1}`,
		countSubmissions: async () => store.size,
		saveSubmission: async (s) => void store.set(s.id, s),
		incrementCounter: async (key) => {
			counters.set(key, (counters.get(key) ?? 0) + 1);
			return counters.get(key)!;
		},
		seen: async (key) => {
			if (remembered.has(key)) return true;
			remembered.add(key);
			return false;
		},
		verifyCaptcha: async () => true,
		afterSuccess: after,
		recordBlocked: blocked,
		hash: async (v) => `h${v.length}`,
		...overrides,
	};
	return { d, store, after, blocked };
}

const request = { ip: "203.0.113.9", userAgent: "vitest", refererUrl: "https://gatilab.com/services/web-development/" };

describe("normalizeForm (WordPress export)", () => {
	it("converts WordPress strings to real types and keeps keys", () => {
		expect(form.id).toBe(String(wp.id));
		expect(form.slug).toBe("web-development-project-brief");
		expect(form.settings.save_submissions).toBe(true);
		expect(form.settings.enable_honeypot).toBe(true);
		expect(typeof form.settings.rate_limit).toBe("number");
		expect(form.settings.ajax_submit).toBe(true);
		expect(form.settings.actions?.map((a) => a.type)).toEqual(["email", "autoresponder"]);
		expect(form.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});
});

describe("parseFields", () => {
	it("reads names, types, required flags, labels and options", () => {
		const fields = parseFields(form.markup);
		const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
		expect(byName.name).toMatchObject({ type: "text", required: true, maxlength: 100, label: "Your name" });
		expect(byName.email).toMatchObject({ type: "email", required: true, label: "Work email" });
		expect(byName.project_type!.type).toBe("select");
		expect(byName.project_type!.options).toContain("Ecommerce store");
		expect(byName.service).toMatchObject({ type: "hidden" });
	});

	it("handles checkbox groups, wrapping labels and attribute quoting", () => {
		const fields = parseFields(`<label><input type='checkbox' name="topics[]" value="seo"> SEO</label><input type=checkbox name=topics[] value=ads><textarea name="note" required></textarea>`);
		expect(fields.find((f) => f.name === "topics")).toMatchObject({ multiple: true, options: ["seo", "ads"] });
		expect(fields.find((f) => f.name === "note")).toMatchObject({ type: "textarea", required: true });
	});
});

describe("renderForm", () => {
	const html = renderForm(form, { sourceUrl: "https://gatilab.com/x/", idPrefix: "p1-" });

	it("renders the Core Forms wrapper", () => {
		expect(html).toContain(`class="cf-form cf-form-${form.id}"`);
		expect(html).toContain(`name="_cf_form_id" value="${form.id}"`);
		expect(html).toContain(`name="_cf_h${form.id}"`);
		expect(html).toContain('class="cf-messages" role="status" aria-live="polite"');
		expect(html).toContain('data-ajax="1"');
		expect(html).toContain('action="/_emdash/api/plugins/core-forms/submit"');
		expect(html).toContain('name="_cf_source_url" value="https://gatilab.com/x/"');
	});

	it("prefixes ids and label targets together, but not data-id", () => {
		expect(html).toContain('id="p1-cf-name"');
		expect(html).toContain('for="p1-cf-name"');
		expect(html).toContain(`data-id="${form.id}"`);
	});

	it("shows a stored reply and hides fields after success", () => {
		const out = renderForm(
			{ ...form, settings: { ...form.settings, hide_after_success: true } },
			{ response: { message: { type: "success", text: "Got it <3" }, hide_form: true } },
		);
		expect(out).toContain('<p class="cf-message cf-message-success" role="status">Got it &lt;3</p>');
		expect(out).toContain('class="cf-fields-wrap" hidden');
	});

	it("closes the form outside its schedule", () => {
		const out = renderForm({ ...form, settings: { ...form.settings, schedule_close: "2026-01-01T00:00:00Z" } }, { now: new Date("2026-10-05T00:00:00Z") });
		expect(out).toContain("not accepting submissions");
		expect(out).toContain("cf-fields-wrap\" hidden");
	});

	it("scopes custom CSS and blocks script breakouts", () => {
		const out = renderForm({ ...form, settings: { ...form.settings, custom_css: "color:red}</style><script>x()</script>", custom_js: "console.log('</script>')" } });
		expect(out).not.toContain("<script>x()");
		expect(out.match(/<\/style>/g)).toHaveLength(1);
		expect(out).toContain("<\\/script");
	});

	it("fills markup tags from the page URL", () => {
		expect(fillMarkupTags(`<input name="src" value="{{url_params.utm_source || direct}}">`, { urlParams: new URLSearchParams("utm_source=<x>") })).toBe(
			`<input name="src" value="&lt;x&gt;">`,
		);
		expect(fillMarkupTags(`{{url_params.utm_source || direct}}`)).toBe("direct");
	});
});

describe("validate", () => {
	const fields = parseFields(form.markup);
	it("requires markup-required fields and settings fields", () => {
		const r = validate(form, fields, { email: "asha@example.com" });
		expect(r.error).toBe("required_field_missing");
		expect(r.fields).toContain("name");
	});
	it("checks email fields", () => {
		const data = Object.fromEntries(valid.filter((e) => !e.name.startsWith("_")).map((e) => [e.name, e.value]));
		expect(validate(form, fields, { ...data, email: "not-an-email" }).error).toBe("invalid_email");
		expect(validate(form, fields, data).error).toBeUndefined();
	});
	it("enforces maxlength from the markup", () => {
		const data = Object.fromEntries(valid.filter((e) => !e.name.startsWith("_")).map((e) => [e.name, e.value]));
		expect(validate(form, fields, { ...data, name: "x".repeat(101) })).toMatchObject({ error: "too_long", fields: ["name"] });
	});
});

describe("processSubmission", () => {
	it("stores a valid submission and schedules actions", async () => {
		const { d, store, after } = deps();
		const r = await processSubmission(form, valid, request, d);
		expect(r.status).toBe(200);
		expect(r.response.message.type).toBe("success");
		expect(store.size).toBe(1);
		const saved = [...store.values()][0]!;
		expect(saved.data.details).toBe("Line one\nLine two <b>bold</b>");
		expect(saved).toMatchObject({ formId: form.id, status: "new", ip: "203.0.113.9" });
		expect(after).toHaveBeenCalledOnce();
	});

	it("drops keys the markup does not declare", async () => {
		const { d, store } = deps();
		await processSubmission(form, [...valid, { name: "is_admin", value: "1" }], request, d);
		expect([...store.values()][0]!.data).not.toHaveProperty("is_admin");
	});

	it("answers bots with a fake success and stores nothing", async () => {
		for (const entries of [valid.filter((e) => !e.name.startsWith("_cf_h")), valid.map((e) => (e.name.startsWith("_cf_h") ? { ...e, value: "spam" } : e))]) {
			const { d, store, blocked } = deps();
			const r = await processSubmission(form, entries, request, d);
			expect(r.response.message.type).toBe("success");
			expect(store.size).toBe(0);
			expect(blocked).toHaveBeenCalledWith(form.id, "honeypot");
		}
	});

	it("rate limits per IP", async () => {
		const limited = { ...form, settings: { ...form.settings, rate_limit: 2, prevent_duplicates: false } };
		const { d } = deps();
		const codes = [];
		for (let i = 0; i < 3; i++) codes.push((await processSubmission(limited, valid, request, d)).status);
		expect(codes).toEqual([200, 200, 429]);
	});

	it("treats a duplicate as success without storing it twice", async () => {
		const dup = { ...form, settings: { ...form.settings, prevent_duplicates: true, rate_limit: 0 } };
		const { d, store } = deps();
		await processSubmission(dup, valid, request, d);
		const second = await processSubmission(dup, valid, request, d);
		expect(second.response.message.type).toBe("success");
		expect(store.size).toBe(1);
	});

	it("rejects failed CAPTCHA, closed forms, drafts and full forms", async () => {
		expect((await processSubmission({ ...form, settings: { ...form.settings, captcha: "turnstile" } }, valid, request, deps({ verifyCaptcha: async () => false }).d)).status).toBe(400);
		expect((await processSubmission({ ...form, status: "draft" }, valid, request, deps().d)).status).toBe(404);
		expect((await processSubmission({ ...form, settings: { ...form.settings, schedule_open: "2027-01-01T00:00:00Z" } }, valid, request, deps().d)).status).toBe(403);
		const full = deps({ countSubmissions: async () => 5 });
		expect((await processSubmission({ ...form, settings: { ...form.settings, submission_limit: 5 } }, valid, request, full.d)).response.message.text).toMatch(/limit/);
	});

	it("returns redirect and hide flags", async () => {
		const r = await processSubmission({ ...form, settings: { ...form.settings, hide_after_success: true, redirect_url: "/thanks/" } }, valid, request, deps().d);
		expect(r.response).toMatchObject({ hide_form: true, redirect_url: "/thanks/" });
	});
});

describe("data variables and actions", () => {
	const submission: Submission = {
		id: "sub-1", formId: form.id, status: "new", submittedAt: "2026-10-05T10:00:00.000Z", ip: "203.0.113.9",
		refererUrl: "https://gatilab.com/services/web-development/",
		data: { name: "Asha <Rao>", email: "asha@example.com", project_type: "Ecommerce store", topics: ["seo", "ads"] },
	};
	const ctx = { form, submission, fields: parseFields(form.markup) };

	it("fills tokens, escaping for HTML", () => {
		expect(replaceDataVariables("Hi [name] from [CF_REFERRER_HOST] ([topics]) [unknown] [website]", ctx)).toBe("Hi Asha <Rao> from gatilab.com (seo, ads)  ");
		expect(replaceDataVariables("<p>[name]</p>", ctx, (v) => v.replace(/</g, "&lt;").replace(/>/g, "&gt;"))).toBe("<p>Asha &lt;Rao&gt;</p>");
		expect(replaceDataVariables("[all:label]", ctx)).toContain("Your name: Asha <Rao>");
	});

	it("matches WordPress for metadata and unknown tags", () => {
		const meta = { ...ctx, site: { name: "Gatilab", url: "https://gatilab.com" } };
		expect(replaceDataVariables("[CF_TIMESTAMP] | [CF_DATE] | [CF_TIME]", meta)).toBe("2026-10-05 10:00:00 | October 5, 2026 | 10:00 AM");
		expect(replaceDataVariables("Source: [CF_REFERER] [CF_USER_EMAIL]|[CF_SITE_NAME] [CF_SITE_URL]", meta)).toBe("Source:  |Gatilab https://gatilab.com");
		expect(replaceDataVariables("[project type]", meta)).toBe("Ecommerce store");
		// empty values are left out of [all], as in WordPress
		const sparse = { ...ctx, submission: { ...submission, data: { name: "Asha", website: "" } } };
		expect(replaceDataVariables("[all]", sparse)).toBe("name: Asha");
	});

	it("sends the notification and autoresponder", async () => {
		const sent: unknown[] = [];
		const results = await runActions(form.settings.actions, ctx, { sendEmail: async (m) => void sent.push(m) });
		expect(results.every((r) => r.ok)).toBe(true);
		expect(sent).toHaveLength(2);
		const [notify, reply] = sent as { to: string; subject: string; html?: string; text: string; replyTo?: string }[];
		expect(notify!.to).toBe("owner@example.com");
		expect(notify!.subject).toContain("Ecommerce store from Asha <Rao>");
		expect(notify!.html).toContain("Asha &lt;Rao&gt;");
		expect(notify!.text).not.toContain("<p>");
		expect(reply!.to).toBe("asha@example.com");
	});

	it("posts webhooks as JSON and survives failures", async () => {
		const fetch = vi.fn(async () => new Response("nope", { status: 500 }));
		const results = await runActions([{ type: "webhook", url: "https://hooks.example.com/x", content_type: "json" }], ctx, { fetch });
		expect(results[0]).toMatchObject({ ok: false, error: "HTTP 500" });
		const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
		expect(body).toMatchObject({ form: { id: form.id }, data: { email: "asha@example.com" } });
	});

	it("exports CSV with labels and formula protection", () => {
		const csv = submissionsToCsv([{ ...submission, data: { ...submission.data, name: "=HYPERLINK(1)" } }], parseFields(form.markup));
		expect(csv).toContain("Your name");
		expect(csv).toContain("'=HYPERLINK(1)");
		expect(csv.startsWith("﻿")).toBe(true);
	});
});

describe("field enhancement", () => {
	it("adds ids, label targets and autocomplete like WordPress", () => {
		const out = enhanceFields('<label>Your name</label> <input name="name"><label>Email</label><input type="email" name="email" autocomplete="off"><input name="name"><select name="country"></select>');
		expect(out).toContain('<label for="name">Your name</label> <input name="name" id="name" autocomplete="name">');
		expect(out).toContain('<label for="email">Email</label><input type="email" name="email" autocomplete="off" id="email">');
		expect(out).toContain('<input name="name" id="name_1" autocomplete="name">');
		expect(out).toContain('<select name="country" id="country" autocomplete="country-name">');
	});

	it("keeps author ids and wrapping labels, skips hidden and choice fields", () => {
		const out = enhanceFields('<label>Pick <input type="checkbox" name="topics[]"></label><input type="hidden" name="src"><input id="w" name="website_type">');
		expect(out).toContain('<label>Pick <input type="checkbox" name="topics[]" id="topics__">');
		expect(out).toContain('<input type="hidden" name="src">');
		expect(out).toContain('<input id="w" name="website_type">');
	});

	it("reads the last word of the field name", () => {
		expect(autocompleteFor("first_name")).toBe("given-name");
		expect(autocompleteFor("company_name")).toBe("organization");
		expect(autocompleteFor("your_website")).toBe("url");
		expect(autocompleteFor("website_type")).toBeUndefined();
		expect(autocompleteFor("pincode", "number")).toBe("postal-code");
		expect(autocompleteFor("budget", "select")).toBeUndefined();
	});
});
