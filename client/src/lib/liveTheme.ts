/**
 * THE VILLAGE'S PALETTE, LIVE. Admin > Make it yours > Look (and Typography,
 * and the identity pack) save the brand document; the server turns it into
 * /api/brand/theme.css, which client/index.html links render-blocking with a
 * `?v=<version>` the shell stamps (server/routes/brandTheme.ts).
 *
 * Until 2026-11-09 a save reached a page only on its next full load, and the
 * Look panel said so. Rye's brief that day: "all pages should be responsive in
 * real time to the design palette in admin". Every colour the app paints from
 * a token reads a custom property, so swapping the one stylesheet re-themes
 * the whole open page with no React work at all. This file does that swap:
 *
 *   - the tab that saved calls `announceThemeChange()`, which re-links its own
 *     sheet at once and tells the village's other open tabs in this browser
 *     (BroadcastChannel);
 *   - every page checks, when it comes back into view, whether the sheet's
 *     version moved (a `no-cache` request answered 304 while nothing changed),
 *     so a member with the site open on another device re-themes when they
 *     return to it.
 *
 * The new sheet is attached BEFORE the old one is removed, and the old one
 * goes only when the new one has loaded, so a swap never flashes the platform
 * default palette.
 */

export const THEME_PATH = "/api/brand/theme.css";
const CHANNEL = "village-theme";

const themeLinks = (): HTMLLinkElement[] =>
  Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).filter((l) => {
    try {
      return new URL(l.href, location.href).pathname === THEME_PATH;
    } catch {
      return false;
    }
  });

/** The version the page's sheet was loaded at, from its `?v=`, or null. */
export function currentThemeVersion(): string | null {
  const link = themeLinks().at(-1);
  if (!link) return null;
  try {
    return new URL(link.href, location.href).searchParams.get("v");
  } catch {
    return null;
  }
}

/** Swap the page's theme sheet for the one at `version` (or a fresh, unversioned one). */
export function relinkTheme(version?: string | null): void {
  const old = themeLinks();
  const next = document.createElement("link");
  next.rel = "stylesheet";
  next.href = version ? `${THEME_PATH}?v=${encodeURIComponent(version)}` : `${THEME_PATH}?t=${Date.now()}`;
  const anchor = old.at(-1);
  if (anchor?.parentNode) anchor.parentNode.insertBefore(next, anchor.nextSibling);
  else document.head.appendChild(next);
  const drop = () => old.forEach((l) => l.remove());
  next.addEventListener("load", drop, { once: true });
  // A failed load keeps the old sheet: the page stays as it was rather than unthemed.
  next.addEventListener("error", () => next.remove(), { once: true });
}

/** Ask the server for the sheet's current version; re-link only when it moved. */
export async function checkThemeVersion(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(THEME_PATH, { method: "HEAD", cache: "no-cache" });
    const etag = res.headers.get("etag")?.replace(/^W\//, "").replace(/"/g, "") ?? null;
    if (!etag || etag === currentThemeVersion()) return false;
    relinkTheme(etag);
    return true;
  } catch {
    return false;
  }
}

/** Call after a save that changes the brand document: this tab and the village's other open tabs re-theme now. */
export function announceThemeChange(): void {
  void checkThemeVersion().then((moved) => {
    if (!moved) relinkTheme();
  });
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage("changed");
    ch.close();
  } catch {
    /* no BroadcastChannel: the other tabs catch up when they come back into view */
  }
}

/** Installed once at boot (main.tsx). Returns its own teardown, for tests. */
export function listenForThemeChanges(): () => void {
  const onVisible = () => {
    if (document.visibilityState === "visible") void checkThemeVersion();
  };
  document.addEventListener("visibilitychange", onVisible);
  let ch: BroadcastChannel | null = null;
  try {
    ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = () => void checkThemeVersion();
  } catch {
    ch = null;
  }
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    ch?.close();
  };
}
