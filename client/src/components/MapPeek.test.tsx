// @vitest-environment jsdom
/**
 * THE LANDING PAGE'S WINDOW ONTO THE MAP PROMISES NOTHING ABOUT THE LAND.
 *
 * It said every building "traces to something true: a funded build, a claimed
 * quest, a filled role", the same promise the map's own guide made in her
 * first line, the council stop, the Sanctuary card and the Now tip. On
 * 2026-10-02 those four were taken back (shared/mapArtifactWelcomeWalk.test.ts),
 * because the map's seed is sample data, and this was their twin on the
 * village's front page.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";

vi.mock("@/modules/ModuleProvider", () => ({
  useModule: (id: string) => ({ id, lifecycle: "public" }),
}));

import MapPeek from "./MapPeek";

describe("MapPeek", () => {
  it("invites a visitor in and says how the map works, with no promise about what is on it", () => {
    render(<Router><MapPeek /></Router>);
    expect(screen.getByRole("heading", { name: "See the village" })).toBeTruthy();
    const words = document.body.textContent ?? "";
    expect(words).toContain("The village drawn as a map you can walk. Step in and tap any building to open its door.");
    expect(words).not.toMatch(/traces to something true|funded build|claimed quest/);
  });
});
