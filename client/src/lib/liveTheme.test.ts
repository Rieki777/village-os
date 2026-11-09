// @vitest-environment jsdom
/**
 * A saved Look re-themes open pages without a reload (Rye, 2026-11-09).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { THEME_PATH, checkThemeVersion, currentThemeVersion, relinkTheme } from "./liveTheme";

const links = () => Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
const put = (href: string) => {
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = href;
  document.head.appendChild(l);
  return l;
};
const headers = (etag: string | null) => ({ headers: { get: (k: string) => (k.toLowerCase() === "etag" ? etag : null) } }) as unknown as Response;

afterEach(() => {
  document.head.innerHTML = "";
});

describe("liveTheme", () => {
  it("reads the version the shell stamped", () => {
    put(`${THEME_PATH}?v=abc123`);
    expect(currentThemeVersion()).toBe("abc123");
  });

  it("keeps the old sheet until the new one has loaded, so nothing flashes unthemed", () => {
    const old = put(`${THEME_PATH}?v=old`);
    put("/assets/index.css");
    relinkTheme("new");
    const theme = links().filter((l) => l.href.includes(THEME_PATH));
    expect(theme).toHaveLength(2);
    expect(old.isConnected).toBe(true);
    theme[1].dispatchEvent(new Event("load"));
    expect(old.isConnected).toBe(false);
    expect(currentThemeVersion()).toBe("new");
  });

  it("keeps the old sheet when the new one fails", () => {
    const old = put(`${THEME_PATH}?v=old`);
    relinkTheme("new");
    const fresh = links().find((l) => l.href.includes("v=new"))!;
    fresh.dispatchEvent(new Event("error"));
    expect(old.isConnected).toBe(true);
    expect(fresh.isConnected).toBe(false);
  });

  it("re-links only when the server's version moved", async () => {
    put(`${THEME_PATH}?v=same`);
    const f = vi.fn(async () => headers('"same"'));
    expect(await checkThemeVersion(f as unknown as typeof fetch)).toBe(false);
    expect(links()).toHaveLength(1);
    const g = vi.fn(async () => headers('"moved"'));
    expect(await checkThemeVersion(g as unknown as typeof fetch)).toBe(true);
    expect(links().some((l) => l.href.endsWith("v=moved"))).toBe(true);
  });

  it("does nothing on a network failure", async () => {
    put(`${THEME_PATH}?v=same`);
    const f = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await checkThemeVersion(f as unknown as typeof fetch)).toBe(false);
    expect(links()).toHaveLength(1);
  });
});
