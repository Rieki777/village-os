// @vitest-environment jsdom
/**
 * A SAVE IN ADMIN REACHES THE TAB IT WAS MADE IN (audit item 24).
 *
 * The config is fetched once per page load and cached, so a founder who
 * renamed the village or changed its pictures kept seeing the old ones in the
 * shell, the tab title and every page until a full reload.
 * `refreshGameConfig()` reads it again and hands it to every mounted reader.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { refreshGameConfig, useBrandImages, useGameConfig } from "./gameApi";

function Shell() {
  const config = useGameConfig();
  const images = useBrandImages();
  return (
    <p>
      <span>{config?.project?.name ?? "loading"}</span>
      <span>{images.logo ?? "no logo"}</span>
    </p>
  );
}

const answers = (...bodies: unknown[]) => {
  const queue = [...bodies];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => queue.shift() ?? null }) as unknown as Response),
  );
};

describe("refreshing the village's config", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("repaints every reader with what the server now serves, and keeps the old one on a failed read", async () => {
    answers(
      { project: { name: "Old Name" }, images: { logo: "/old.webp" } },
      { project: { name: "New Name" }, images: { logo: "/new.webp" } },
    );
    render(<Shell />);
    expect(await screen.findByText("Old Name")).toBeTruthy();
    expect(await screen.findByText("/old.webp")).toBeTruthy();

    await act(async () => {
      await refreshGameConfig();
    });
    expect(screen.getByText("New Name")).toBeTruthy();
    expect(screen.getByText("/new.webp")).toBeTruthy();

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => null }) as unknown as Response));
    await act(async () => {
      expect(await refreshGameConfig()).toBeNull();
    });
    expect(screen.getByText("New Name")).toBeTruthy();
  });
});
