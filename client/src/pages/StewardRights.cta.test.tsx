// @vitest-environment jsdom
/**
 * The two doors at the end of the steward rights page were each a <button>
 * inside a <Link>: two tab stops for one action, read as "link, button", and
 * invalid HTML (axe measured the link obscured by its own button at 1280).
 * Each is one link now, and nothing interactive sits inside it.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// jsdom has no IntersectionObserver, and framer-motion's whileInView needs one.
vi.stubGlobal("IntersectionObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
});
vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
// The words come from the page spec's defaults (shared/pageContent/rights.ts):
// a village that has saved nothing, with its config loaded.
vi.mock("@/hooks/useVillageContent", () => ({ readVillageSection: () => Promise.resolve(null) }));
vi.mock("@/lib/gameApi", () => ({ useGameConfig: () => ({ project: { name: "Testville" } }) }));

import StewardRights from "./StewardRights";

describe("StewardRights doors", () => {
  it("are one link each, with no control nested inside", async () => {
    render(<StewardRights />);
    await screen.findByRole("link", { name: /return to/i });
    for (const [name, href] of [
      [/return to steward journey/i, "/steward"],
      [/explore quests/i, "/quests"],
    ] as const) {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(href);
      expect(link.querySelector("button, a, input, select, textarea, [tabindex]")).toBeNull();
    }
    expect(screen.queryByRole("button", { name: /return to steward journey|explore quests/i })).toBeNull();
  });
});
