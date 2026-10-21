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
vi.mock("@/hooks/useVillageName", () => ({ useVillageName: () => "Testville" }));
vi.mock("@/hooks/useTokenNames", () => ({ useTokenName: (fallback: string) => fallback, useValueTokenName: () => "Credits" }));
vi.mock("@/lib/moneyClaims", () => ({ useValueConversion: () => "" }));

import StewardRights from "./StewardRights";

describe("StewardRights doors", () => {
  it("are one link each, with no control nested inside", () => {
    render(<StewardRights />);
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
