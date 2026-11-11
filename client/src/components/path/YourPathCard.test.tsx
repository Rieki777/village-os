// @vitest-environment jsdom
/**
 * "YOUR PATH" on the profile: one step, what comes after, the walk as a seed,
 * and fireflies on the one next act. No rank, no count, no bar.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { visitorFacts, yourPathAll, type PathFacts } from "@shared/yourPath";

vi.mock("wouter", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useLocation: () => ["/profile", () => {}],
}));
vi.mock("@/lib/gameApi", () => ({ useGameConfig: () => ({ project: { commitmentName: "Love Letter" } }) }));
vi.mock("@/hooks/useGuideName", () => ({ useGuideName: () => ({ name: "the village guide", named: false, loaded: true, audience: "member" }) }));

import YourPathCard from "./YourPathCard";
import type { PathView } from "@/lib/usePath";

const NOW = new Date("2026-11-11T18:00:00Z");
const view = (over: Partial<PathFacts>): PathView => {
  const all = yourPathAll({
    ...visitorFacts(NOW, "UTC"),
    person: { kind: "account", role: "user", founderPowerStands: false, proposals: [] },
    member: { trained: false, joining: "unsigned", claims: [], budget: { remaining: 100, total: 100 } },
    commitment: "Love Letter",
    ...over,
  });
  return { ...all[0], today: "2026-11-11", also: all.slice(1), dates: {}, visitor: false };
};

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Your path card", () => {
  it("leads a new holder with the agreement, an in-page act, and the agreements drawn inside it", () => {
    const path = view({ applications: [{ id: "a1", roles: ["Lead Financial Steward"], status: "adopted", steps: [{ step: "confidentiality", href: "/aligned" }], firstDay: null }] });
    render(
      <YourPathCard path={path}>
        <p>the agreements</p>
      </YourPathCard>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Align with the confidentiality agreement" })).toBeInTheDocument();
    expect(screen.getByText("Your role as Lead Financial Steward starts once the last one is aligned.")).toBeInTheDocument();
    // On the profile the step is on this very page, so the act is a plain in-page link.
    const act = document.querySelector("[data-next-act]") as HTMLAnchorElement;
    expect(act.getAttribute("href")).toBe("#before-you-start");
    expect(act.textContent).toContain("Read and align");
    // Fireflies on that one act, and nowhere else on the card.
    expect(screen.getAllByTestId("fireflies")).toHaveLength(1);
    expect(act.closest(".nk-ff-host")).not.toBeNull();
    expect(screen.getByText("the agreements")).toBeInTheDocument();
    expect(screen.getByText("Your move")).toBeInTheDocument();
  });

  it("names what else waits after the step, once each, and never the catch-all", () => {
    const path = view({ applications: [{ id: "a1", roles: ["Land Steward"], status: "adopted", steps: [{ step: "terms", href: "/role-applications/a1" }], firstDay: null }] });
    render(<YourPathCard path={path} />);
    const also = document.querySelector("[data-path-also]")!;
    expect(also.textContent).toContain("Finish your community training");
    expect(also.textContent).not.toContain("Find your next quest");
    expect(also.querySelectorAll("li").length).toBeLessThanOrEqual(3);
  });

  it("shows no stage, rank, level or bar, and no count of the person in view", () => {
    const path = view({ seatings: [{ roleId: "r", role: "Land Steward", startedOn: "2026-11-10", termEndsOn: null, warningOpen: false, lapsed: false, renewing: false }], moon: { today: "2026-11-11", walkthroughDay: "2026-12-04", sendBy: "2026-12-07", recap: "none", returnedNote: false } });
    const { container } = render(<YourPathCard path={path} />);
    expect(screen.getByText("Your role has taken root.")).toBeInTheDocument();
    expect(container.querySelector("[role='progressbar']")).toBeNull();
    const seen = container.textContent ?? "";
    expect(seen).not.toMatch(/\bStage\b|\bRank\b|\bLevel\b|\bXP\b|Next: /);
    expect(seen).not.toMatch(/\d+ of \d+/);
    // The count lives only in the drawing's own label, for a screen reader.
    expect(container.querySelector(".nk-life svg")?.getAttribute("aria-label")).toBe("Your path: 8 of 10 steps walked");
  });

  it("our move draws no act when the step has no door", () => {
    const path: PathView = { ...view({}), state: "invitation", whose: "yours", step: { key: "path.invitation.step", href: null, vars: {} }, after: { key: "path.invitation.after", vars: { day: "2026-11-25" } } };
    render(<YourPathCard path={path} />);
    expect(document.querySelector("[data-next-act]")).toBeNull();
    expect(screen.getByText("It works until 25 November.")).toBeInTheDocument();
  });
});
