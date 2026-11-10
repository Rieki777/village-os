/**
 * "On", for the canvas modules' side effects, means open to members
 * (server/lib/canvasModules.ts). Preview is an admin's trial: a member's bell,
 * the public exit policy and the guide's prompt must not act as if the module
 * were on (review of 2026-11-05).
 */
import { describe, expect, it } from "vitest";
import type { ModuleLifecycle } from "../../shared/modules";
import { openToMembers } from "./canvasModules";

describe("openToMembers", () => {
  it("is true for members and public, and false for off and preview", () => {
    expect(openToMembers("members")).toBe(true);
    expect(openToMembers("public")).toBe(true);
    expect(openToMembers("off")).toBe(false);
    expect(openToMembers("preview")).toBe(false);
  });

  it("answers for every lifecycle the platform has: a new one fails to compile here until it is decided", () => {
    const expected: Record<ModuleLifecycle, boolean> = { off: false, preview: false, members: true, public: true };
    for (const [lc, open] of Object.entries(expected)) expect(openToMembers(lc as ModuleLifecycle)).toBe(open);
  });
});
