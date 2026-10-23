// @vitest-environment jsdom
/**
 * The two doors at the end of the resident rights page were each a <button>
 * inside a <Link>: two tab stops for one action, read as "link, button", and
 * invalid HTML (axe also measured the link as obscured by its own button).
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
vi.mock("@/hooks/useVillageContent", () => ({
  useVillageContent: () => ({ content: null }),
  readVillageSection: () => Promise.resolve(null),
}));
vi.mock("@/lib/gameApi", () => ({ useGameConfig: () => ({ project: { name: "Testville" } }) }));

import ResidentRights from "./ResidentRights";

describe("ResidentRights doors", () => {
  it("are one link each, with no control nested inside", async () => {
    render(<ResidentRights />);
    await screen.findByRole("link", { name: /return to/i });
    for (const [name, href] of [
      [/return to resident journey/i, "/resident"],
      [/read good neighbor principles/i, "/good-neighbor"],
    ] as const) {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(href);
      expect(link.querySelector("button, a, input, select, textarea, [tabindex]")).toBeNull();
    }
    expect(screen.queryByRole("button", { name: /return to resident journey|read good neighbor principles/i })).toBeNull();
  });
});
