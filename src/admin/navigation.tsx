/**
 * Navigation between the plugin's admin pages.
 *
 * Plugin pages get no router props, so links are plain anchors with real
 * hrefs (open-in-new-tab works). A plain left click is turned into
 * `history.pushState`: the admin's TanStack history patches pushState and
 * re-routes on it, so the page swaps without a reload. If that patch isn't
 * there, cross-page links fall back to a normal page load.
 */

import * as React from "react";

import { PLUGIN_ID } from "./api.js";

/** The admin router's basepath. */
export const ADMIN_ROOT = "/_emdash/admin";
const PLUGIN_ROOT = `${ADMIN_ROOT}/plugins/${PLUGIN_ID}`;
const LOCATION_EVENT = "core-forms:locationchange";

export type SearchParamsInit = Record<string, string | null | undefined>;

/** Href for a plugin page, e.g. `pluginHref("/form", { id })`. */
export function pluginHref(path: string, params?: SearchParamsInit): string {
	const clean = path === "/" || path === "" ? "" : path.startsWith("/") ? path : `/${path}`;
	return `${PLUGIN_ROOT}${clean}${toQuery(params)}`;
}

/** The auto-generated plugin settings page (CAPTCHA keys, default sender). */
export const SETTINGS_HREF = `${ADMIN_ROOT}/plugins-manager/${PLUGIN_ID}/settings`;

function toQuery(params?: SearchParamsInit): string {
	if (!params) return "";
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null && value !== "") search.set(key, value);
	}
	const query = search.toString();
	return query ? `?${query}` : "";
}

function hostRoutesOnPushState(): boolean {
	try {
		return !/\[native code\]/.test(Function.prototype.toString.call(window.history.pushState));
	} catch {
		return false;
	}
}

function notify(): void {
	window.dispatchEvent(new Event(LOCATION_EVENT));
}

/** Go to `href` inside the admin without a page load. */
export function navigate(href: string, options: { replace?: boolean } = {}): void {
	const target = new URL(href, window.location.href);
	if (target.origin !== window.location.origin) {
		window.location.assign(target.href);
		return;
	}
	const samePage = target.pathname === window.location.pathname;
	if (!samePage && !hostRoutesOnPushState()) {
		if (options.replace) window.location.replace(target.href);
		else window.location.assign(target.href);
		return;
	}
	// TanStack history keys its entries; keep the index it uses for back/forward.
	const current = (window.history.state ?? {}) as { __TSR_index?: unknown };
	const index = typeof current.__TSR_index === "number" ? current.__TSR_index : 0;
	const key = Math.random().toString(36).slice(2, 10);
	const state = { key, __TSR_key: key, __TSR_index: options.replace ? index : index + 1 };
	const url = `${target.pathname}${target.search}${target.hash}`;
	if (options.replace) window.history.replaceState(state, "", url);
	else window.history.pushState(state, "", url);
	notify();
}

/** Merge `patch` into the current query string (replacing the history entry by default). */
export function setSearchParams(patch: SearchParamsInit, options: { replace?: boolean } = { replace: true }): void {
	const search = new URLSearchParams(window.location.search);
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined || value === null || value === "") search.delete(key);
		else search.set(key, value);
	}
	const query = search.toString();
	const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
	if (next === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
	navigate(next, options);
}

function subscribe(onChange: () => void): () => void {
	window.addEventListener("popstate", onChange);
	window.addEventListener(LOCATION_EVENT, onChange);
	// The Navigation API also reports pushState calls made by the host router.
	const nav = (window as Window & { navigation?: EventTarget }).navigation;
	nav?.addEventListener("currententrychange", onChange);
	return () => {
		window.removeEventListener("popstate", onChange);
		window.removeEventListener(LOCATION_EVENT, onChange);
		nav?.removeEventListener("currententrychange", onChange);
	};
}

const getSearch = () => window.location.search;
const getServerSearch = () => "";

/** The current query string, kept in sync with in-admin navigation. */
export function useSearchParams(): URLSearchParams {
	const search = React.useSyncExternalStore(subscribe, getSearch, getServerSearch);
	return React.useMemo(() => new URLSearchParams(search), [search]);
}

export interface AdminLinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
	href: string;
	replace?: boolean;
}

/**
 * Click handler for admin links: a plain left click navigates in place;
 * modified clicks (new tab, new window) keep the browser default.
 */
export function interceptLinkClick(
	event: React.MouseEvent<HTMLAnchorElement>,
	href: string,
	options: { replace?: boolean; target?: string } = {},
): void {
	if (
		event.defaultPrevented ||
		event.button !== 0 ||
		event.metaKey ||
		event.ctrlKey ||
		event.shiftKey ||
		event.altKey ||
		(options.target && options.target !== "_self")
	) {
		return;
	}
	event.preventDefault();
	navigate(href, { replace: options.replace });
}

/** An anchor that navigates inside the admin on a plain left click. */
export const AdminLink = React.forwardRef<HTMLAnchorElement, AdminLinkProps>(function AdminLink(
	{ href, replace, onClick, target, ...props },
	ref,
) {
	const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
		onClick?.(event);
		interceptLinkClick(event, href, { replace, target });
	};
	return <a ref={ref} href={href} target={target} onClick={handleClick} {...props} />;
});
