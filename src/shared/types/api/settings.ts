/**
 * Global settings (P1.7; architecture §7.1; D-030, D-031, DV-02). Admin only. Secrets are masked in responses and a
 * posted mask keeps the stored value.
 */
import type { GlobalSettingsDocument } from "../settings.js";
import { defineRouteSpecs, type RouteContract } from "./contract.js";

/** Platform facts the Settings page shows next to the fields. */
export interface SettingsStatus {
	/** EMDASH_ENCRYPTION_KEY configured; otherwise secrets are stored "plain:" and a warning shows (D-030). */
	encryptionKey: boolean;
	/** Mail transports and whether each is usable (true or the reason). */
	transports: { id: string; label: string; available: true | string }[];
	/** Companion integration detected (D-005). */
	companion: boolean;
	/** Private R2 bucket bound (D-110). */
	privateBucket: boolean;
	/** Build-time standalone base (D-052); shown next to the imported `standalone_base_slug`. */
	standaloneBase: string | null;
}

export interface SettingsOutput {
	settings: GlobalSettingsDocument;
	status: SettingsStatus;
}

export interface SettingsSaveInput {
	/** WP merge semantics: providers not posted keep their keys; `license_server` is preserved. */
	settings: GlobalSettingsDocument;
	/** Required to store secrets without EMDASH_ENCRYPTION_KEY. */
	acknowledgePlaintext?: boolean;
}

export interface SettingsApi {
	"settings/get": RouteContract<Record<string, never>, SettingsOutput>;
	"settings/save": RouteContract<SettingsSaveInput, SettingsOutput>;
}

const SETTINGS = { phase: 1, owner: "P1.7", module: "settings", kind: "admin", spec: "architecture §7.1; 04 §3; D-031" } as const;

export const settingsRoutes = defineRouteSpecs<SettingsApi>()({
	"settings/get": { ...SETTINGS, summary: "Global settings (secrets masked) and platform status." },
	"settings/save": { ...SETTINGS, secretWrite: true, summary: "Save global settings with WP deep-merge rules." },
});
