/**
 * Form theme customizer (P1.7 routes over the P1.5 sanitizer and generator; spec 02 §4.7; architecture §7.3;
 * DV-54). Admin only.
 */
import { defineRouteSpecs, type RouteContract } from "./contract.js";

export type ThemeWarningCode = "low_text_contrast" | "low_focus_contrast";

export interface ThemeWarning {
	code: ThemeWarningCode;
	message: string;
	/** Contrast ratio to 2 decimals. */
	ratio: number;
}

export interface ThemePreset {
	/** "classic" | "compact" | "warm" | "contrast". */
	id: string;
	label: string;
	tokens: Record<string, string>;
}

export interface ThemeOutput {
	/** Stored overrides only (`cf_form_theme_tokens`), e.g. {"--cf-bg": "#ffffff"}. */
	tokens: Record<string, string>;
	/** The 13 tokens with their defaults, in generator order. */
	defaults: Record<string, string>;
	presets: ThemePreset[];
	/** Generated `FormTheme::css` (inlined as <style id="core-forms-theme-custom">). */
	css: string;
	warnings: ThemeWarning[];
}

export interface ThemeApi {
	"theme/get": RouteContract<Record<string, never>, ThemeOutput>;
	/** Invalid values are dropped silently (WP sanitizer); warnings are non-blocking. */
	"theme/save": RouteContract<{ tokens: Record<string, string> }, ThemeOutput>;
}

const THEME = { phase: 1, owner: "P1.7", module: "theme", kind: "admin", spec: "02 §4.7; architecture §7.3; DV-54" } as const;

export const themeRoutes = defineRouteSpecs<ThemeApi>()({
	"theme/get": { ...THEME, summary: "Theme tokens, defaults, presets, CSS and contrast warnings." },
	"theme/save": { ...THEME, summary: "Sanitize and save theme tokens; regenerate the CSS." },
});
