import type { CaptchaProvider } from "./types.js";

const VERIFY_URL: Record<Exclude<CaptchaProvider, "none">, string> = {
	turnstile: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
	recaptcha: "https://www.google.com/recaptcha/api/siteverify",
	hcaptcha: "https://api.hcaptcha.com/siteverify",
};

export const TOKEN_FIELD: Record<Exclude<CaptchaProvider, "none">, string> = {
	turnstile: "cf-turnstile-response",
	recaptcha: "g-recaptcha-response",
	hcaptcha: "h-captcha-response",
};

/** Hosts the plugin must be allowed to reach for verification. */
export const CAPTCHA_HOSTS = ["challenges.cloudflare.com", "www.google.com", "api.hcaptcha.com"];

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Verify a CAPTCHA token with its provider. reCAPTCHA v3 also has to clear
 * `minScore`. Network or provider failures count as not verified.
 */
export async function verifyCaptcha(
	provider: Exclude<CaptchaProvider, "none">,
	opts: { secret: string; token: string; ip?: string | null; fetch: Fetcher; minScore?: number },
): Promise<boolean> {
	if (!opts.token || !opts.secret) return false;
	const body = new URLSearchParams({ secret: opts.secret, response: opts.token });
	if (opts.ip) body.set("remoteip", opts.ip);
	try {
		const res = await opts.fetch(VERIFY_URL[provider], {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: body.toString(),
		});
		if (!res.ok) return false;
		const json = (await res.json()) as { success?: boolean; score?: number };
		if (!json.success) return false;
		if (provider === "recaptcha" && typeof json.score === "number") return json.score >= (opts.minScore ?? 0.5);
		return true;
	} catch {
		return false;
	}
}
