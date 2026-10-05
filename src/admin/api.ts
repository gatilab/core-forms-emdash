/**
 * Typed client for the plugin's admin routes. One function per route in
 * ROUTES.md; every call is a JSON POST through EmDash's `apiFetch`, which adds
 * the `X-EmDash-Request` header private routes require.
 */

import { apiFetch, getErrorMessage, parseApiResponse } from "emdash/plugin-utils";

import type { FormDefinition, FormSummary, Submission, SubmissionStatus } from "../core/types.js";
import { filenameFromContentDisposition, type FormPayload } from "./helpers.js";

export const PLUGIN_ID = "core-forms";
export const API_BASE = `/_emdash/api/plugins/${PLUGIN_ID}`;

export interface ListSubmissionsInput {
	formId?: string;
	status?: SubmissionStatus;
	cursor?: string;
	limit?: number;
}

export interface SubmissionPage {
	items: Submission[];
	nextCursor?: string;
}

export interface FormStats {
	forms: number;
	submissions: number;
	unread: number;
	blocked: { honeypot: number; rateLimit: number; captcha: number; duplicate: number };
}

export interface ImportResult {
	created: number;
	updated: number;
	skipped: string[];
}

export interface CsvExport {
	blob: Blob;
	filename: string | null;
}

interface CallOptions {
	signal?: AbortSignal;
}

function post(route: string, body: unknown, options: CallOptions = {}): Promise<Response> {
	return apiFetch(`${API_BASE}/${route}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body ?? {}),
		signal: options.signal,
	});
}

async function call<T>(route: string, body: unknown, fallback: string, options?: CallOptions): Promise<T> {
	const response = await post(route, body, options);
	return parseApiResponse<T>(response, fallback);
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export function listForms(options?: CallOptions): Promise<{ items: FormSummary[] }> {
	return call("forms/list", {}, "Could not load forms.", options);
}

export function getForm(id: string, options?: CallOptions): Promise<{ form: FormDefinition }> {
	return call("forms/get", { id }, "Could not load the form.", options);
}

export function saveForm(form: FormPayload): Promise<{ form: FormDefinition }> {
	return call("forms/save", { form }, "Could not save the form.");
}

export function deleteForm(id: string, deleteSubmissions = false): Promise<{ deleted: true }> {
	return call("forms/delete", { id, deleteSubmissions }, "Could not delete the form.");
}

export function duplicateForm(id: string): Promise<{ form: FormDefinition }> {
	return call("forms/duplicate", { id }, "Could not duplicate the form.");
}

export function previewForm(form: Partial<FormDefinition>, options?: CallOptions): Promise<{ html: string }> {
	return call("forms/preview", { form }, "Could not render the preview.", options);
}

export function formOptions(options?: CallOptions): Promise<{ items: { id: string; name: string }[] }> {
	return call("forms/options", {}, "Could not load forms.", options);
}

export function importForms(forms: unknown[]): Promise<ImportResult> {
	return call("forms/import", { forms }, "Could not import the forms.");
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

export function listSubmissions(input: ListSubmissionsInput = {}, options?: CallOptions): Promise<SubmissionPage> {
	return call("submissions/list", input, "Could not load submissions.", options);
}

export function getSubmission(
	id: string,
	options?: CallOptions,
): Promise<{ submission: Submission; form: FormSummary | null }> {
	return call("submissions/get", { id }, "Could not load the submission.", options);
}

export function updateSubmissions(ids: string[], status: SubmissionStatus): Promise<{ updated: number }> {
	return call("submissions/update", { ids, status }, "Could not update the submissions.");
}

export function deleteSubmissions(ids: string[]): Promise<{ deleted: number }> {
	return call("submissions/delete", { ids }, "Could not delete the submissions.");
}

/** `submissions/export` answers with raw CSV, not the JSON envelope. */
export async function exportSubmissions(formId: string): Promise<CsvExport> {
	const response = await post("submissions/export", { formId });
	if (!response.ok) throw new Error(await getErrorMessage(response, "Could not export submissions."));
	return {
		blob: await response.blob(),
		filename: filenameFromContentDisposition(response.headers.get("content-disposition")),
	};
}

export function getStats(options?: CallOptions): Promise<FormStats> {
	return call("stats", {}, "Could not load form stats.", options);
}

/** True for the error `fetch` throws when an AbortController cancels a call. */
export function isAbortError(error: unknown): boolean {
	return error instanceof DOMException ? error.name === "AbortError" : (error as { name?: string })?.name === "AbortError";
}
