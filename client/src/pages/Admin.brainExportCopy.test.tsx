// @vitest-environment jsdom
/**
 * WHAT THE BRAIN TAB TELLS A STEWARD ABOUT THE CANVAS EXPORT (plan 5.6;
 * review of 2026-09-28, R2#2).
 *
 * The sentence once ended "and nothing kept to admins leaves this village".
 * That is false: the admin Setup Studio sends admin-audience brief rows to the
 * model provider with its prompt. The copy may only claim what the export
 * does, so it names the sections the export's fence refuses and says the
 * export carries nothing kept to admins, and makes no claim about the whole
 * village.
 *
 * The fence is `ADMIN_ONLY_BRIEF_SECTIONS` (shared/canvasPublicLines.ts). The
 * words below are keyed by it, so a section added to the fence and left out
 * of the sentence fails here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ADMIN_ONLY_BRIEF_SECTIONS } from "@shared/canvasPublicLines";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { VillageBrainTab } from "./Admin";

/** How the sentence names each section the export never carries. */
const NAMED_AS: Record<string, string> = { people: "people", legal: "legal", land: "land", constraints: "red lines" };

describe("the Brain tab's sentence about the canvas export", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ sections: [], record: [] }) })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names every section the export's fence refuses, and claims nothing about what leaves the village", async () => {
    render(<VillageBrainTab password="pw" />);
    const line = (await screen.findByText(/A member may export the canvas/)).textContent ?? "";
    // The Setup Studio sends admin rows to the model provider, so no sentence here may promise they stay.
    expect(line).not.toMatch(/leaves? this village/);
    expect(Object.keys(NAMED_AS).sort()).toEqual(Array.from(ADMIN_ONLY_BRIEF_SECTIONS).sort());
    const never = line.slice(line.indexOf("never"));
    for (const section of Array.from(ADMIN_ONLY_BRIEF_SECTIONS)) expect(never, section).toContain(NAMED_AS[section]);
    expect(never).toContain("anything kept to admins");
  });
});
