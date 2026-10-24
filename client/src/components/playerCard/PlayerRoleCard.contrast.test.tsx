// @vitest-environment jsdom
/**
 * THE PLAYER CARD'S CONTRAST, in the approved design's night palette.
 *
 * The card is a theme-frozen surface (playerCard.css): it is drawn in the
 * design's night whatever the page around it, so it is measured once per
 * case, against its own stylesheet, by client/src/test/cardContrast.ts. That
 * instrument reads the `pc-` rules the way the browser does (the cascade,
 * inheritance, every gradient stop at its worst), because the token
 * instrument sees no colour on the card's classes and would have measured
 * every line as the body's ink on the body's ground.
 *
 * Floors: body text 4.5, large text 3. Two controls keep the green honest:
 * the dim ink and the gold are actually read off the stylesheet, and a dim ink
 * darkened toward the ground makes the same measurement fail.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describeFailures } from "@/test/tokenContrast";
import { measureCard } from "@/test/cardContrast";
import { fixturePayload, fixtureRole } from "@/test/playerCardFixture";
import { PlayerRoleCardView } from "./PlayerRoleCard";

afterEach(() => cleanup());

const root = () => document.querySelector("[data-player-card]")!;

const CCOS = {
  existsWhile: "people are still arriving and need a clear way in.",
  authorities: ["Manage applicant onboarding and role invitations."],
  responsibilities: ["Answer role applications within 2 business days."],
  signsStretched: "Applications waiting longer than 2 business days.",
  flowsBack: "Runbooks and the intake agent from the Operations role.",
  stepBack: "Name it at the Friday check-in.",
  timeCommitment: "Part of a full-time season",
};

const CASES: Array<[string, number, "self" | "member" | "stranger"]> = [
  ["no roles, the owner", 0, "self"],
  ["one role, a member", 1, "member"],
  ["six roles, the owner", 6, "self"],
  ["one role, a stranger", 1, "stranger"],
];

describe("the player card clears every floor in its night palette", () => {
  for (const [label, n, level] of CASES) {
    it(label, () => {
      render(<PlayerRoleCardView data={fixturePayload(n, level)} />);
      const results = measureCard(root());
      expect(results.length).toBeGreaterThan(10);
      expect(describeFailures(results)).toEqual([]);
    });
  }

  it("with every CCOS word written and the terms shown", () => {
    render(<PlayerRoleCardView data={fixturePayload(1, "self", { roles: [{ ...fixtureRole(1), ...CCOS }], frameworkTerms: true })} />);
    expect(describeFailures(measureCard(root()))).toEqual([]);
  });

  it("in edit mode, with every edit control showing", () => {
    render(<PlayerRoleCardView data={fixturePayload(1, "self")} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit my card" }));
    expect(describeFailures(measureCard(root()))).toEqual([]);
  });

  it("as a proposal, with its changed words framed in gold", () => {
    render(<PlayerRoleCardView data={fixturePayload(1, "member")} mode="proposal" changed={{ r1: { keys: ["purpose", "countOnMe", "bringMe"], isNew: false } }} />);
    expect(root().querySelector(".pc-changed")).not.toBeNull();
    expect(describeFailures(measureCard(root()))).toEqual([]);
  });

  it("is the same in the light and the dark page themes: the surface is frozen", () => {
    render(<PlayerRoleCardView data={fixturePayload(1, "self")} />);
    expect(measureCard(root(), "dark")).toEqual(measureCard(root(), "light"));
  });
});

describe("the instrument reads the card's own stylesheet", () => {
  it("measures the design's dim ink and gold, on the design's grounds", () => {
    render(<PlayerRoleCardView data={fixturePayload(1, "self")} />);
    const results = measureCard(root());
    const purpose = results.find((r) => r.text === "Purpose")!;
    expect(purpose.fg).toBe("#dfab4d");
    const eyebrow = results.find((r) => r.text === "What I look after")!;
    expect(eyebrow).toMatchObject({ fg: "#9cb0a3", bg: "#16221c" });
    expect(results.find((r) => r.text === "Lena Ortiz")).toMatchObject({ fg: "#e9efe6", bg: "#0d1411", floor: 3 });
  });

  it("fails when the dim ink is darkened toward the ground", () => {
    render(<PlayerRoleCardView data={fixturePayload(1, "self")} />);
    const failures = describeFailures(measureCard(root(), "light", { "--pc-dim": "#4a5a50" }));
    expect(failures.some((f) => f.includes("What I look after"))).toBe(true);
  });
});
