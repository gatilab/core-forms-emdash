/**
 * Route handlers. Contract: ROUTES.md. Public: `submit`, `render`.
 * Everything else is admin-only (EmDash checks the session before dispatch).
 */
import { after, PluginRouteError, pluginResponse } from "emdash";
import type { RouteContext, StorageCollection } from "emdash";

import { runActions } from "./core/actions.js";
import { verifyCaptcha } from "./core/captcha.js";
import { submissionsToCsv } from "./core/csv.js";
import { parseFields } from "./core/markup.js";
import { normalizeForm, slugify } from "./core/normalize.js";
import { processSubmission, type BlockReason, type ProcessDeps } from "./core/process.js";
import { renderForm } from "./core/render.js";
import type { RawEntry } from "./core/validate.js";
import type { CaptchaProvider, FormDefinition, FormSummary, GlobalSettings, Submission, SubmissionStatus, SubmitResponse } from "./core/types.js";

type Ctx = RouteContext<unknown>;

const forms = (ctx: Ctx) => ctx.storage.forms as StorageCollection<FormDefinition>;
const submissions = (ctx: Ctx) => ctx.storage.submissions as StorageCollection<Submission>;

function obj(input: unknown): Record<string, unknown> {
	return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

async function sha256(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function settings(ctx: Ctx): Promise<GlobalSettings> {
	const keys = [
		"turnstileSiteKey", "turnstileSecretKey", "recaptchaSiteKey", "recaptchaSecretKey",
		"hcaptchaSiteKey", "hcaptchaSecretKey", "defaultFrom", "storeIp",
	] as const;
	const values = await Promise.all(keys.map((k) => ctx.settings.get<string | boolean>(k)));
	return Object.fromEntries(keys.map((k, i) => [k, values[i] ?? undefined])) as GlobalSettings;
}

function siteKey(s: GlobalSettings, provider: CaptchaProvider | undefined): string | undefined {
	if (provider === "turnstile") return s.turnstileSiteKey;
	if (provider === "recaptcha") return s.recaptchaSiteKey;
	if (provider === "hcaptcha") return s.hcaptchaSiteKey;
	return undefined;
}

function secretKey(s: GlobalSettings, provider: CaptchaProvider): string | undefined {
	if (provider === "turnstile") return s.turnstileSecretKey;
	if (provider === "recaptcha") return s.recaptchaSecretKey;
	if (provider === "hcaptcha") return s.hcaptchaSecretKey;
	return undefined;
}

export async function findForm(ctx: Ctx, idOrSlug: string): Promise<FormDefinition | null> {
	if (!idOrSlug) return null;
	const byId = await forms(ctx).get(idOrSlug);
	if (byId) return byId;
	const { items } = await forms(ctx).query({ where: { slug: idOrSlug }, limit: 1 });
	return items[0]?.data ?? null;
}

// ---------------------------------------------------------------- KV helpers

/** Fixed-window counter, atomic per key via compare-and-set. */
async function incrementCounter(ctx: Ctx, key: string, windowMs: number): Promise<number> {
	for (let attempt = 0; attempt < 4; attempt++) {
		const current = await ctx.kv.getVersioned<{ start: number; count: number }>(key);
		const now = Date.now();
		const fresh = !current?.value || now - current.value.start >= windowMs;
		const next = fresh ? { start: now, count: 1 } : { start: current!.value.start, count: current!.value.count + 1 };
		const res = await ctx.kv.compareAndSet(key, current?.revision ?? null, next);
		if (res.applied) return next.count;
	}
	return Number.MAX_SAFE_INTEGER; // persistent contention: treat as over the limit
}

async function seen(ctx: Ctx, key: string, ttlMs: number): Promise<boolean> {
	const until = await ctx.kv.get<number>(key);
	if (until && until > Date.now()) return true;
	await ctx.kv.set(key, Date.now() + ttlMs);
	return false;
}

function recordBlocked(ctx: Ctx, reason: BlockReason) {
	after(() => incrementCounter(ctx, `stats:blocked:${reason}`, Number.MAX_SAFE_INTEGER).then(() => undefined));
}

// ---------------------------------------------------------------- public

function entriesFrom(input: unknown): RawEntry[] {
	const data = obj(input);
	if (Array.isArray(data.entries)) {
		// form-data body: { entries: [{ name, kind, value | bytes }] }; files are not accepted yet
		return (data.entries as { name: string; kind: string; value?: string }[])
			.filter((e) => e.kind === "text" && typeof e.value === "string")
			.map((e) => ({ name: e.name, value: e.value! }));
	}
	return Object.entries(data).flatMap(([name, v]) =>
		Array.isArray(v) ? v.map((x) => ({ name, value: String(x) })) : [{ name, value: String(v ?? "") }],
	);
}

function sameOrigin(url: string, base: string): string | null {
	try {
		const u = new URL(url, base);
		return u.origin === new URL(base).origin ? u.toString() : null;
	} catch {
		return null;
	}
}

export async function submitRoute(ctx: Ctx) {
	const entries = entriesFrom(ctx.input);
	const control = Object.fromEntries(entries.filter((e) => e.name.startsWith("_")).map((e) => [e.name, e.value]));
	const ajax = control._cf_ajax === "1";
	const form = await findForm(ctx, control._cf_form_id ?? "");
	const global = await settings(ctx);

	const deps: ProcessDeps = {
		now: () => new Date(),
		newId: () => crypto.randomUUID(),
		countSubmissions: (formId) => submissions(ctx).count({ formId }),
		saveSubmission: (s) => submissions(ctx).put(s.id, s),
		incrementCounter: (key, windowMs) => incrementCounter(ctx, key, windowMs),
		seen: (key, ttl) => seen(ctx, key, ttl),
		verifyCaptcha: async (provider, token, ip) => {
			const secret = secretKey(global, provider);
			if (!secret || !ctx.http) return false;
			return verifyCaptcha(provider, { secret, token, ip, fetch: ctx.http.fetch.bind(ctx.http) });
		},
		afterSuccess: (data) => {
			after(async () => {
				await runActions(form?.settings.actions, { ...data, site: { name: ctx.site?.name, url: ctx.site?.url } }, {
					sendEmail: ctx.email ? (m) => ctx.email!.send(m) : undefined,
					fetch: ctx.http ? ctx.http.fetch.bind(ctx.http) : undefined,
					log: ctx.log,
				});
			});
		},
		recordBlocked: (_formId, reason) => recordBlocked(ctx, reason),
		hash: sha256,
	};

	const meta = ctx.requestMeta;
	const result = await processSubmission(form, entries, {
		ip: meta.ip,
		userAgent: meta.userAgent,
		refererUrl: control._cf_source_url || meta.referer,
		country: meta.geo?.country ?? null,
		storeIp: global.storeIp !== false,
	}, deps);

	if (ajax) {
		return pluginResponse({
			status: result.status,
			headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
			body: { kind: "text", value: JSON.stringify(result.response) },
		});
	}

	// No JavaScript: Post/Redirect/Get back to the page, carrying the reply.
	const base = ctx.request.url;
	const redirect = !result.response.error && result.response.redirect_url ? sameOrigin(result.response.redirect_url, base) : null;
	if (redirect) return pluginResponse({ status: 303, headers: { location: redirect } });
	const source = sameOrigin(control._cf_source_url || meta.referer || "/", base) ?? new URL("/", base).toString();
	const token = crypto.randomUUID().replace(/-/g, "");
	await ctx.kv.set(`resp:${token}`, { formId: form?.id ?? "", response: result.response, exp: Date.now() + 300_000 });
	const target = new URL(source);
	target.searchParams.set("cf_response", token);
	target.hash = form ? `cf-form-${form.id}` : "";
	return pluginResponse({ status: 303, headers: { location: target.toString() } });
}

export async function renderRoute(ctx: Ctx) {
	const input = obj(ctx.input);
	const form = await findForm(ctx, str(input.id) || str(input.slug));
	if (!form || form.status !== "publish") return null;
	const global = await settings(ctx);
	let response: SubmitResponse | null = null;
	const token = str(input.responseToken);
	if (/^[a-f0-9]{32}$/.test(token)) {
		const stored = await ctx.kv.get<{ formId: string; response: SubmitResponse; exp: number }>(`resp:${token}`);
		if (stored && stored.formId === form.id && stored.exp > Date.now()) {
			response = stored.response;
			await ctx.kv.delete(`resp:${token}`);
		}
	}
	let pageUrl: URL | undefined;
	try {
		pageUrl = input.pageUrl ? new URL(str(input.pageUrl)) : undefined;
	} catch {}
	const key = siteKey(global, form.settings.captcha);
	if (pageUrl) pageUrl.searchParams.delete("cf_response");
	const html = renderForm(form, {
		sourceUrl: pageUrl?.toString(),
		urlParams: pageUrl?.searchParams,
		response,
		captchaSiteKey: key,
		idPrefix: str(input.idPrefix) || undefined,
	});
	return {
		html,
		form: { id: form.id, slug: form.slug, title: form.title },
		theme: !!form.settings.load_form_theme,
		...(key && form.settings.captcha && form.settings.captcha !== "none" ? { captcha: { provider: form.settings.captcha, siteKey: key } } : {}),
	};
}

// ---------------------------------------------------------------- admin

async function summary(ctx: Ctx, form: FormDefinition): Promise<FormSummary> {
	const [count, unread] = await Promise.all([
		submissions(ctx).count({ formId: form.id }),
		submissions(ctx).count({ formId: form.id, status: "new" }),
	]);
	return { id: form.id, slug: form.slug, title: form.title, status: form.status, updatedAt: form.updatedAt, submissions: count, unread };
}

async function allForms(ctx: Ctx): Promise<FormDefinition[]> {
	const out: FormDefinition[] = [];
	let cursor: string | undefined;
	do {
		const page = await forms(ctx).query({ orderBy: { updatedAt: "desc" }, limit: 100, cursor });
		out.push(...page.items.map((i) => i.data));
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	return out;
}

async function uniqueSlug(ctx: Ctx, slug: string, ownId: string): Promise<string> {
	let candidate = slug;
	for (let n = 2; n < 100; n++) {
		const { items } = await forms(ctx).query({ where: { slug: candidate }, limit: 1 });
		if (!items[0] || items[0].id === ownId) return candidate;
		candidate = `${slug}-${n}`;
	}
	return `${slug}-${crypto.randomUUID().slice(0, 6)}`;
}

export const adminRoutes = {
	"forms/list": async (ctx: Ctx) => ({ items: await Promise.all((await allForms(ctx)).map((f) => summary(ctx, f))) }),

	"forms/get": async (ctx: Ctx) => {
		const form = await forms(ctx).get(str(obj(ctx.input).id));
		if (!form) throw new PluginRouteError("NOT_FOUND", "Form not found", 404);
		return { form };
	},

	"forms/save": async (ctx: Ctx) => {
		const raw = obj(obj(ctx.input).form);
		if (!str(raw.title) || typeof raw.markup !== "string") throw new PluginRouteError("VALIDATION_ERROR", "A form needs a title and markup", 400);
		const existing = str(raw.id) ? await forms(ctx).get(str(raw.id)) : null;
		const now = new Date().toISOString();
		const form = normalizeForm({ ...(existing ?? {}), ...raw, id: existing?.id ?? crypto.randomUUID(), createdAt: existing?.createdAt ?? now, updatedAt: now });
		form.slug = await uniqueSlug(ctx, form.slug, form.id);
		await forms(ctx).put(form.id, form);
		return { form };
	},

	"forms/delete": async (ctx: Ctx) => {
		const input = obj(ctx.input);
		const id = str(input.id);
		await forms(ctx).delete(id);
		if (input.deleteSubmissions === true) {
			let cursor: string | undefined;
			do {
				const page = await submissions(ctx).query({ where: { formId: id }, limit: 100, cursor });
				await submissions(ctx).deleteMany(page.items.map((i) => i.id));
				cursor = page.hasMore ? page.cursor : undefined;
			} while (cursor);
		}
		return { deleted: true };
	},

	"forms/duplicate": async (ctx: Ctx) => {
		const source = await forms(ctx).get(str(obj(ctx.input).id));
		if (!source) throw new PluginRouteError("NOT_FOUND", "Form not found", 404);
		const now = new Date().toISOString();
		const id = crypto.randomUUID();
		const form: FormDefinition = { ...source, id, title: `${source.title} (copy)`, status: "draft", createdAt: now, updatedAt: now, slug: await uniqueSlug(ctx, `${source.slug}-copy`, id) };
		await forms(ctx).put(id, form);
		return { form };
	},

	"forms/preview": async (ctx: Ctx) => {
		const form = normalizeForm({ id: "preview", title: "Preview", ...obj(obj(ctx.input).form) });
		return { html: renderForm(form) };
	},

	"forms/options": async (ctx: Ctx) => ({
		// the editor's select `optionsRoute` contract: { items: [{ id, name }] }
		items: (await allForms(ctx)).map((f) => ({ id: f.id, name: f.status === "draft" ? `${f.title} (draft)` : f.title })),
	}),

	"forms/import": async (ctx: Ctx) => {
		const list = obj(ctx.input).forms;
		if (!Array.isArray(list)) throw new PluginRouteError("VALIDATION_ERROR", "Expected { forms: [...] }", 400);
		let created = 0;
		let updated = 0;
		const skipped: string[] = [];
		for (const item of list) {
			const form = normalizeForm(obj(item));
			if (!form.id || !form.markup.trim()) {
				skipped.push(form.slug || form.title);
				continue;
			}
			const existing = await forms(ctx).get(form.id);
			form.slug = await uniqueSlug(ctx, form.slug || slugify(form.title), form.id);
			await forms(ctx).put(form.id, form);
			if (existing) updated++;
			else created++;
		}
		return { created, updated, skipped };
	},

	"submissions/list": async (ctx: Ctx) => {
		const input = obj(ctx.input);
		const where: Record<string, string> = {};
		if (str(input.formId)) where.formId = str(input.formId);
		if (str(input.status)) where.status = str(input.status);
		const limit = Math.min(100, Math.max(1, Number(input.limit) || 50));
		const page = await submissions(ctx).query({
			where: Object.keys(where).length ? where : undefined,
			orderBy: { submittedAt: "desc" },
			limit,
			cursor: str(input.cursor) || undefined,
		});
		return { items: page.items.map((i) => i.data), ...(page.hasMore && page.cursor ? { nextCursor: page.cursor } : {}) };
	},

	"submissions/get": async (ctx: Ctx) => {
		const submission = await submissions(ctx).get(str(obj(ctx.input).id));
		if (!submission) throw new PluginRouteError("NOT_FOUND", "Submission not found", 404);
		const form = await forms(ctx).get(submission.formId);
		return { submission, form: form ? await summary(ctx, form) : null };
	},

	"submissions/update": async (ctx: Ctx) => {
		const input = obj(ctx.input);
		const status = str(input.status) as SubmissionStatus;
		if (!["new", "read", "spam", "trash"].includes(status)) throw new PluginRouteError("VALIDATION_ERROR", "Unknown status", 400);
		const ids = Array.isArray(input.ids) ? input.ids.map(String) : [];
		let updated = 0;
		for (const id of ids) {
			const res = await submissions(ctx).updateIf(id, { where: {}, set: { status } });
			if (res.applied) updated++;
		}
		return { updated };
	},

	"submissions/delete": async (ctx: Ctx) => {
		const ids = Array.isArray(obj(ctx.input).ids) ? (obj(ctx.input).ids as unknown[]).map(String) : [];
		return { deleted: await submissions(ctx).deleteMany(ids) };
	},

	"submissions/export": async (ctx: Ctx) => {
		const form = await forms(ctx).get(str(obj(ctx.input).formId));
		if (!form) throw new PluginRouteError("NOT_FOUND", "Form not found", 404);
		const rows: Submission[] = [];
		let cursor: string | undefined;
		do {
			const page = await submissions(ctx).query({ where: { formId: form.id }, orderBy: { submittedAt: "desc" }, limit: 100, cursor });
			rows.push(...page.items.map((i) => i.data).filter((s) => s.status !== "trash"));
			cursor = page.hasMore ? page.cursor : undefined;
		} while (cursor);
		const filename = `${form.slug}-submissions-${new Date().toISOString().slice(0, 10)}.csv`;
		return pluginResponse({
			status: 200,
			headers: {
				"content-type": "text/csv; charset=utf-8",
				"content-disposition": `attachment; filename="${filename}"`,
				"cache-control": "no-store",
			},
			body: { kind: "text", value: submissionsToCsv(rows, parseFields(form.markup)) },
		});
	},

	stats: async (ctx: Ctx) => {
		const [formCount, total, unread, ...blocked] = await Promise.all([
			forms(ctx).count(),
			submissions(ctx).count(),
			submissions(ctx).count({ status: "new" }),
			...(["honeypot", "rateLimit", "captcha", "duplicate"] as const).map((r) =>
				ctx.kv.get<{ count: number }>(`stats:blocked:${r}`).then((v) => v?.count ?? 0),
			),
		]);
		return {
			forms: formCount,
			submissions: total,
			unread,
			blocked: { honeypot: blocked[0], rateLimit: blocked[1], captcha: blocked[2], duplicate: blocked[3] },
		};
	},
};

