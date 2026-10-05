/**
 * Server-side loading for the Astro components: calls the plugin's public
 * `render` route in-process (no HTTP round trip) through EmDash's dispatcher.
 */
import { getPublicPluginApiRouteHandler } from "emdash/plugin-utils";

export interface RenderedForm {
	html: string;
	form: { id: string; slug: string; title: string };
	theme: boolean;
	captcha?: { provider: "turnstile" | "recaptcha" | "hcaptcha"; siteKey: string };
}

interface AstroLike {
	locals: unknown;
	url: URL;
}

let renderCount = 0;

/** Render a form by id or slug. Returns null for a missing or draft form. */
export async function loadForm(astro: AstroLike, ref: { id?: string | number | null; slug?: string | null }): Promise<RenderedForm | null> {
	const id = ref.id != null && ref.id !== "" ? String(ref.id) : undefined;
	const slug = ref.slug || undefined;
	if (!id && !slug) return null;
	const handler = getPublicPluginApiRouteHandler(astro.locals as never);
	if (!handler) {
		console.warn("[core-forms] EmDash public route dispatcher unavailable; is the plugin registered?");
		return null;
	}
	const body = {
		id,
		slug,
		pageUrl: astro.url.toString(),
		responseToken: astro.url.searchParams.get("cf_response") ?? undefined,
		// unique per render, so two copies of one form on a page keep distinct ids
		idPrefix: `cf${(++renderCount % 100000).toString(36)}-`,
	};
	try {
		const payload = await handler(
			"core-forms",
			"POST",
			"/render",
			new Request(new URL("/_emdash/api/plugins/core-forms/render", astro.url), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			}),
		);
		const data = (payload && typeof payload === "object" && "data" in (payload as object) ? (payload as { data: unknown }).data : payload) as RenderedForm | null;
		return data && typeof data.html === "string" ? data : null;
	} catch (error) {
		console.warn("[core-forms] could not render form", ref, error);
		return null;
	}
}

const SHORTCODE_RE = /\[cf_form\s+([^\]]*)\]/g;
const PLACEHOLDER_RE = /<div\s+data-core-form="([^"]*)"(?:\s+data-core-form-slug="([^"]*)")?\s*><\/div>/g;

function shortcodeRef(attrs: string): { id?: string; slug?: string } {
	const get = (name: string) => attrs.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(\\S+))`))?.slice(1).find((v) => v !== undefined);
	return { id: get("id"), slug: get("slug") };
}

/**
 * Expand `[cf_form slug="…"]` / `[cf_form id="…"]` shortcodes and
 * `<div data-core-form="…">` placeholders inside an HTML string, e.g. a
 * page-builder section migrated from WordPress.
 */
export async function renderFormsInHtml(astro: AstroLike, html: string): Promise<{ html: string; forms: RenderedForm[] }> {
	if (!html.includes("[cf_form") && !html.includes("data-core-form=")) return { html, forms: [] };
	const jobs: { match: string; ref: { id?: string; slug?: string } }[] = [];
	for (const m of html.matchAll(SHORTCODE_RE)) jobs.push({ match: m[0], ref: shortcodeRef(m[1]!) });
	for (const m of html.matchAll(PLACEHOLDER_RE)) jobs.push({ match: m[0], ref: { id: m[1] || undefined, slug: m[2] || undefined } });
	const rendered = await Promise.all(jobs.map((j) => loadForm(astro, j.ref)));
	let out = html;
	jobs.forEach((j, i) => {
		// a function replacer, so "$&" or "$'" inside form markup stays literal
		out = out.replace(j.match, () => rendered[i]?.html ?? "");
	});
	return { html: out, forms: rendered.filter((r): r is RenderedForm => !!r) };
}
