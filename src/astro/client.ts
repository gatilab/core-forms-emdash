/**
 * Browser side of Core Forms: AJAX submission with inline messages. Mirrors
 * Core Forms for WordPress so existing listeners keep working: it fires
 * `cf-submit`, `cf-submitted`, `cf-success`, `cf-error` and `cf-message`
 * (bubbling CustomEvents on the form) and toggles `.cf-loading`.
 * Forms with data-ajax="0" are left to submit natively.
 */
import type { SubmitResponse } from "../core/types.js";

declare global {
	interface Window {
		grecaptcha?: { ready(cb: () => void): void; execute(key: string, opts: { action: string }): Promise<string> };
		turnstile?: { reset(el?: Element | string): void };
		hcaptcha?: { reset(id?: string): void };
	}
}

function emit(form: HTMLFormElement, name: string, detail: Record<string, unknown> = {}) {
	form.dispatchEvent(new CustomEvent(`cf-${name}`, { bubbles: true, detail: { form, ...detail } }));
}

function showMessage(form: HTMLFormElement, type: "success" | "error", text: string) {
	const box = form.querySelector<HTMLElement>(".cf-messages");
	if (!box) return;
	box.innerHTML = "";
	const p = document.createElement("p");
	p.className = `cf-message cf-message-${type}`;
	p.setAttribute("role", type === "error" ? "alert" : "status");
	p.textContent = text;
	box.appendChild(p);
	emit(form, "message", { message: { type, text } });
	if (type === "error" || form.dataset.successScroll !== "0") {
		const rect = box.getBoundingClientRect();
		if (rect.top < 0 || rect.bottom > window.innerHeight) {
			box.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
		}
	}
}

function markInvalid(form: HTMLFormElement, names: string[] = []) {
	for (const el of form.querySelectorAll<HTMLElement>("[aria-invalid='true']")) el.removeAttribute("aria-invalid");
	let first: HTMLElement | null = null;
	for (const name of names) {
		for (const el of form.querySelectorAll<HTMLElement>(`[name="${CSS.escape(name)}"], [name="${CSS.escape(name)}[]"]`)) {
			el.setAttribute("aria-invalid", "true");
			first ??= el;
		}
	}
	first?.focus({ preventScroll: true });
}

function setLoading(form: HTMLFormElement, loading: boolean) {
	form.classList.toggle("cf-loading", loading);
	form.setAttribute("aria-busy", String(loading));
	for (const btn of form.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button[type=submit], button:not([type]), input[type=submit]")) {
		btn.disabled = loading;
		const loadingText = form.dataset.loadingText;
		if (!loadingText) continue;
		if (loading) {
			btn.dataset.cfLabel = btn instanceof HTMLInputElement ? btn.value : btn.textContent ?? "";
			if (btn instanceof HTMLInputElement) btn.value = loadingText;
			else btn.textContent = loadingText;
		} else if (btn.dataset.cfLabel !== undefined) {
			if (btn instanceof HTMLInputElement) btn.value = btn.dataset.cfLabel;
			else btn.textContent = btn.dataset.cfLabel;
		}
	}
}

async function recaptchaToken(form: HTMLFormElement): Promise<void> {
	const field = form.querySelector<HTMLInputElement>("input[data-recaptcha-sitekey]");
	const key = field?.dataset.recaptchaSitekey;
	if (!field || !key || !window.grecaptcha) return;
	await new Promise<void>((resolve) => window.grecaptcha!.ready(resolve));
	field.value = await window.grecaptcha.execute(key, { action: "submit" });
}

function resetCaptcha(form: HTMLFormElement) {
	const turnstile = form.querySelector(".cf-turnstile");
	if (turnstile && window.turnstile) window.turnstile.reset(turnstile);
	if (form.querySelector(".h-captcha") && window.hcaptcha) window.hcaptcha.reset();
}

async function submit(form: HTMLFormElement) {
	emit(form, "submit");
	setLoading(form, true);
	let reply: SubmitResponse;
	try {
		await recaptchaToken(form);
		const body = new FormData(form);
		body.set("_cf_ajax", "1");
		const res = await fetch(form.action, { method: "POST", body, headers: { Accept: "application/json", "X-EmDash-Request": "1" }, credentials: "same-origin" });
		reply = (await res.json()) as SubmitResponse;
	} catch {
		reply = { error: true, message: { type: "error", text: form.dataset.messageError || "Oops. An error occurred." } };
	} finally {
		setLoading(form, false);
	}
	emit(form, "submitted", { response: reply });
	emit(form, reply.error ? "error" : "success", { response: reply });
	showMessage(form, reply.message.type, reply.message.text);
	markInvalid(form, reply.fields);
	if (reply.error) {
		resetCaptcha(form);
		return;
	}
	if (reply.hide_form) form.querySelector<HTMLElement>(".cf-fields-wrap")?.setAttribute("hidden", "");
	if (reply.redirect_url) {
		window.location.assign(reply.redirect_url);
		return;
	}
	form.reset();
	resetCaptcha(form);
}

export function initCoreForms(root: Document | HTMLElement = document): void {
	for (const form of root.querySelectorAll<HTMLFormElement>("form.cf-form[data-ajax='1']:not([data-cf-ready])")) {
		form.dataset.cfReady = "1";
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			if (form.classList.contains("cf-loading")) return;
			// native constraint messages first; the server validates again
			if (form.checkValidity()) void submit(form);
			else form.reportValidity();
		});
	}
}
