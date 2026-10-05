import { describe, expect, it } from "vitest";

import {
	buildPreviewDocument,
	createAction,
	csvFilename,
	detectFieldNames,
	draftSnapshot,
	draftToPayload,
	ensureActionIds,
	fieldSnippet,
	filenameFromContentDisposition,
	firstTabWithErrors,
	formsFromImportJson,
	hasErrors,
	insertBlock,
	insertText,
	isoToLocalInput,
	localInputToIso,
	moveItem,
	newDraft,
	relativeTime,
	submissionPreview,
	uniqueFieldName,
	validateDraft,
	withDefaultSlug,
	type FormDraft,
} from "../src/admin/helpers.js";

const draft = (overrides: Partial<FormDraft> = {}): FormDraft => ({
	...newDraft(),
	title: "Contact",
	slug: "contact",
	...overrides,
});

describe("detectFieldNames", () => {
	it("lists data fields in document order, once each", () => {
		const markup = `
			<input type="text" name="name">
			<input type='email' name='email'>
			<textarea name="message"></textarea>
			<input type="checkbox" name="topics[]" value="a">
			<input type="checkbox" name="topics[]" value="b">
			<select name="plan"><option value="pro">Pro</option></select>
			<input type="text" name="name">`;
		expect(detectFieldNames(markup)).toEqual(["name", "email", "message", "topics", "plan"]);
	});

	it("leaves out buttons and underscore-prefixed names", () => {
		const markup = `
			<input type="hidden" name="_internal" value="x">
			<input type="hidden" name="source" value="ad">
			<button type="submit" name="go">Send</button>
			<input type="submit" name="submit_button" value="Send">`;
		expect(detectFieldNames(markup)).toEqual(["source"]);
	});

	it("ignores data-name and similar attributes", () => {
		expect(detectFieldNames('<input data-name="nope" type="text" name="yes">')).toEqual(["yes"]);
	});

	it("returns nothing for markup without fields", () => {
		expect(detectFieldNames("")).toEqual([]);
		expect(detectFieldNames("<p>Hello</p>")).toEqual([]);
	});
});

describe("validateDraft", () => {
	it("accepts the starter form", () => {
		expect(hasErrors(validateDraft(draft()))).toBe(false);
	});

	it("requires a title and markup", () => {
		const errors = validateDraft(draft({ title: "  ", markup: " " }));
		expect(errors.title).toBeTruthy();
		expect(errors.markup).toBeTruthy();
		expect(firstTabWithErrors(errors)).toBe("fields");
	});

	it("enforces the slug pattern", () => {
		expect(validateDraft(draft({ slug: "" })).slug).toBeTruthy();
		expect(validateDraft(draft({ slug: "Contact Us" })).slug).toBeTruthy();
		expect(validateDraft(draft({ slug: "contact_us" })).slug).toBeTruthy();
		expect(validateDraft(draft({ slug: "contact-us-2" })).slug).toBeUndefined();
	});

	it("fills an empty slug from the title before validating", () => {
		const filled = withDefaultSlug(draft({ title: "Get a Quote!", slug: "" }));
		expect(filled.slug).toBe("get-a-quote");
		expect(validateDraft(filled).slug).toBeUndefined();
	});

	it("checks the redirect URL and schedule", () => {
		const errors = validateDraft(
			draft({
				settings: {
					redirect_url: "//evil.example",
					schedule_open: "2026-10-05T10:00:00.000Z",
					schedule_close: "2026-10-05T09:00:00.000Z",
				},
			}),
		);
		expect(errors.redirect_url).toBeTruthy();
		expect(errors.schedule).toBeTruthy();
		expect(firstTabWithErrors(errors)).toBe("settings");
		expect(validateDraft(draft({ settings: { redirect_url: "/thank-you" } })).redirect_url).toBeUndefined();
		expect(validateDraft(draft({ settings: { redirect_url: "https://example.com/x" } })).redirect_url).toBeUndefined();
	});

	it("validates enabled actions only", () => {
		const email = { ...createAction("email", []), id: "a1" };
		const webhook = { ...createAction("webhook", []), id: "a2", url: "ftp://example.com" };
		const disabled = { ...createAction("webhook", []), id: "a3", enabled: false };
		const imported = { id: "a4", type: "create_comment", post_id: 4 };
		const errors = validateDraft(draft({ settings: { actions: [email, webhook, disabled, imported] } }));
		expect(errors.actions).toEqual({ a1: { to: expect.any(String) }, a2: { url: expect.any(String) } });
		expect(firstTabWithErrors(errors)).toBe("actions");
	});
});

describe("csv filenames", () => {
	it("matches the export route's naming", () => {
		expect(csvFilename("contact", new Date("2026-10-05T12:00:00Z"))).toBe("contact-submissions-2026-10-05.csv");
	});

	it("sanitises odd slugs", () => {
		expect(csvFilename("../We ird", new Date("2026-01-02T00:00:00Z"))).toBe("we-ird-submissions-2026-01-02.csv");
		expect(csvFilename(undefined, new Date("2026-01-02T00:00:00Z"))).toBe("form-submissions-2026-01-02.csv");
	});

	it("reads Content-Disposition", () => {
		expect(filenameFromContentDisposition('attachment; filename="contact-submissions-2026-10-05.csv"')).toBe(
			"contact-submissions-2026-10-05.csv",
		);
		expect(filenameFromContentDisposition("attachment; filename=plain.csv")).toBe("plain.csv");
		expect(filenameFromContentDisposition("attachment; filename=\"a.csv\"; filename*=UTF-8''r%C3%A9sum%C3%A9.csv")).toBe(
			"résumé.csv",
		);
		expect(filenameFromContentDisposition('attachment; filename="../../etc/passwd"')).toBe(".._.._etc_passwd");
		expect(filenameFromContentDisposition("attachment")).toBeNull();
		expect(filenameFromContentDisposition(null)).toBeNull();
	});
});

describe("markup editing", () => {
	it("inserts text at a selection and reports the caret", () => {
		expect(insertText("Hello world", "[name]", 6, 11)).toEqual({ value: "Hello [name]", caret: 12 });
		expect(insertText("abc", "X")).toEqual({ value: "abcX", caret: 4 });
	});

	it("puts snippets on their own lines", () => {
		expect(insertBlock("<p>a</p>", "<p>b</p>").value).toBe("<p>a</p>\n<p>b</p>");
		expect(insertBlock("<p>a</p>\n", "<p>b</p>").value).toBe("<p>a</p>\n<p>b</p>");
		expect(insertBlock("<p>a</p>", "<p>b</p>", 0).value).toBe("<p>b</p>\n<p>a</p>");
		expect(insertBlock("", "<p>b</p>")).toEqual({ value: "<p>b</p>", caret: 8 });
	});

	it("gives inserted fields names that don't clash", () => {
		expect(uniqueFieldName("email", ["email", "email_2"])).toBe("email_3");
		const snippet = fieldSnippet("email", ["email"]);
		expect(snippet).toContain('name="email_2"');
		expect(snippet).toContain('id="cf-email_2"');
		expect(detectFieldNames(fieldSnippet("radio", []))).toEqual(["option"]);
		expect(detectFieldNames(fieldSnippet("submit", []))).toEqual([]);
	});
});

describe("drafts", () => {
	it("compares drafts by content, not key order or empty messages", () => {
		const a = draft({ settings: { rate_limit: 5, captcha: "none" }, messages: { success: "Thanks", error: "" } });
		const b = draft({ settings: { captcha: "none", rate_limit: 5, redirect_url: "" }, messages: { success: "Thanks" } });
		expect(draftSnapshot(a)).toBe(draftSnapshot(b));
		expect(draftSnapshot(a)).not.toBe(draftSnapshot({ ...a, title: "Other" }));
	});

	it("builds the save payload", () => {
		const payload = draftToPayload(draft({ id: "f1", title: "  Contact  ", messages: { success: " ", spam: "No" } }));
		expect(payload).toMatchObject({ id: "f1", title: "Contact", slug: "contact", messages: { spam: "No" } });
		expect(draftToPayload(newDraft())).not.toHaveProperty("id");
	});

	it("gives every action a unique id", () => {
		const actions = ensureActionIds([
			{ type: "webhook", url: "https://a.example" },
			{ id: "x", type: "email", to: "a@b.c", subject: "s", message: "m" },
			{ id: "x", type: "email", to: "a@b.c", subject: "s", message: "m" },
		]);
		const ids = actions.map((a) => a.id);
		expect(ids.every(Boolean)).toBe(true);
		expect(new Set(ids).size).toBe(3);
		expect(ids[1]).toBe("x");
	});

	it("picks the email field for new autoresponders", () => {
		expect(createAction("autoresponder", ["name", "email"])).toMatchObject({ email_field: "email" });
		expect(createAction("autoresponder", ["work_email"])).toMatchObject({ email_field: "work_email" });
	});

	it("moves items within bounds", () => {
		expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
		expect(moveItem(["a", "b", "c"], 2, -2)).toEqual(["c", "a", "b"]);
		expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
	});
});

describe("dates and display", () => {
	it("round-trips schedule values through datetime-local", () => {
		const iso = "2026-10-05T14:30:00.000Z";
		expect(localInputToIso(isoToLocalInput(iso))).toBe(iso);
		expect(isoToLocalInput(undefined)).toBe("");
		expect(isoToLocalInput("not a date")).toBe("");
		expect(localInputToIso("")).toBeUndefined();
	});

	it("formats relative times", () => {
		const now = Date.parse("2026-10-05T12:00:00Z");
		expect(relativeTime("2026-10-05T11:59:40Z", now, "en")).toBe("just now");
		expect(relativeTime("2026-10-05T11:55:00Z", now, "en")).toBe("5 minutes ago");
		expect(relativeTime("2026-10-05T09:00:00Z", now, "en")).toBe("3 hours ago");
		expect(relativeTime("2026-10-04T10:00:00Z", now, "en")).toBe("yesterday");
	});

	it("previews the first non-empty field", () => {
		expect(submissionPreview({ name: "", topics: ["a", "b"], message: "hi" })).toBe("a, b");
		expect(submissionPreview({ message: "line one\n\n  line two" })).toBe("line one line two");
		expect(submissionPreview({ message: "x".repeat(100) }, 10)).toBe(`${"x".repeat(9)}…`);
		expect(submissionPreview({})).toBe("");
	});
});

describe("import and preview", () => {
	it("accepts the export shapes forms/import understands", () => {
		expect(formsFromImportJson([{ id: 1 }])).toEqual([{ id: 1 }]);
		expect(formsFromImportJson({ forms: [{ id: 2 }] })).toEqual([{ id: 2 }]);
		expect(formsFromImportJson({ id: 3 })).toEqual([{ id: 3 }]);
		expect(formsFromImportJson("nope")).toEqual([]);
	});

	it("locks scripts out of the preview document", () => {
		const doc = buildPreviewDocument('<form class="cf-form"></form>');
		expect(doc).toContain("default-src 'none'");
		expect(doc).not.toContain("script-src");
		expect(doc).toContain('<form class="cf-form"></form>');
	});
});
