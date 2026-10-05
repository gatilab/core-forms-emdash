import { fieldLabel, type FieldInfo } from "./markup.js";
import { fieldValueText } from "./template.js";
import type { Submission } from "./types.js";

/** RFC 4180 cell; neutralises spreadsheet formulas (=, +, -, @). */
export function csvCell(value: string): string {
	const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
	return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Columns: metadata, then every field (markup order first, then any extras found in data). */
export function submissionsToCsv(submissions: Submission[], fields: FieldInfo[]): string {
	const names = fields.filter((f) => !["submit", "button", "reset", "image"].includes(f.type)).map((f) => f.name);
	for (const s of submissions) for (const k of Object.keys(s.data)) if (!names.includes(k)) names.push(k);
	const byName = new Map(fields.map((f) => [f.name, f]));
	const header = ["Submitted at", "Status", ...names.map((n) => fieldLabel(byName.get(n), n)), "IP address", "Referrer", "Submission ID"];
	const rows = submissions.map((s) => [
		s.submittedAt,
		s.status,
		...names.map((n) => fieldValueText(s.data[n])),
		s.ip ?? "",
		s.refererUrl ?? "",
		s.id,
	]);
	return `﻿${[header, ...rows].map((r) => r.map((c) => csvCell(String(c))).join(",")).join("\r\n")}\r\n`;
}
