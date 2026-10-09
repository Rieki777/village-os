// @vitest-environment jsdom
/**
 * "APPLY FOR A SEAT" AFTER THE MOVE: terms as one object, and still locked.
 *
 * Two promises this lane makes until PR4 mounts the route:
 *
 *  1. Publishing stays a practice vote. `role_application` is out of the
 *     server's CONDUCTABLE_TYPES, so the type card can never start a wizard
 *     walk that ends in a POST to a route nobody mounted. It is asserted on
 *     the RENDERED card, against the server's own list.
 *  2. The old terms are gone: no commitment, deferred share, token or amount
 *     per cycle, and neither false tip. Drafts still load under the same id.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CONDUCTABLE_TYPES, WIZARD_TYPES as SERVER_WIZARD_TYPES } from "../../../../server/lib/proposalDrafts";
import TypeCards from "./TypeCards";
import { typeConfig } from "./wizardConfig";
import { fieldsFor } from "./wizardWalk";
import { ROLE_APPLICATION_TYPE, settingsProblem } from "./roleApplicationType";

const cardFor = () => screen.getByRole("button", { name: /Apply for a seat/ });

describe("role_application publish is practice locked", () => {
  it("is not conductable on the server", () => {
    expect(CONDUCTABLE_TYPES).not.toContain("role_application");
    // Control: the list is real and carries the kinds that are live.
    expect(CONDUCTABLE_TYPES).toContain("role_seat");
  });

  it("renders a locked card that cannot start a wizard walk", () => {
    const onChoose = vi.fn();
    const onPractice = vi.fn();
    render(
      <TypeCards
        chosen={null}
        conductable={[...CONDUCTABLE_TYPES]}
        advisory={[]}
        mayOpenAdvisory={false}
        onChoose={onChoose}
        onPractice={onPractice}
      />,
    );
    const card = cardFor();
    expect(card).toBeDisabled();
    fireEvent.click(card);
    expect(onChoose).not.toHaveBeenCalled();
    // Control: a live kind on the same screen is choosable.
    fireEvent.click(screen.getByRole("button", { name: /Seat someone in a role/ }));
    expect(onChoose).toHaveBeenCalledWith("role_seat");
  });

  it("offers only a practice vote where the village may open one", () => {
    const onChoose = vi.fn();
    const onPractice = vi.fn();
    render(
      <TypeCards
        chosen={null}
        conductable={[...CONDUCTABLE_TYPES]}
        advisory={["role_application"]}
        mayOpenAdvisory
        onChoose={onChoose}
        onPractice={onPractice}
      />,
    );
    const card = cardFor();
    expect(card).not.toHaveAttribute("aria-pressed");
    fireEvent.click(card);
    expect(onPractice).toHaveBeenCalledWith("role_application");
    expect(onChoose).not.toHaveBeenCalled();
  });
});

describe("role_application after the move", () => {
  it("keeps its id, so stored drafts still load", () => {
    expect(SERVER_WIZARD_TYPES).toContain("role_application");
    expect(typeConfig("role_application")).toBe(ROLE_APPLICATION_TYPE);
  });

  it("asks its terms as one seatSettings field", () => {
    expect(fieldsFor("role_application", "terms").map((f) => [f.key, f.kind])).toEqual([["seatSettings", "seatSettings"]]);
  });

  it("drops the old fields and their tips everywhere", () => {
    const text = JSON.stringify(ROLE_APPLICATION_TYPE.steps);
    for (const gone of ["commitmentPct", "deferredPct", "tokenSlug", "tokenPerCycle", "cashNote"]) {
      expect(text, gone).not.toContain(gone);
    }
    expect(text).not.toMatch(/scales both the pay and the voice/);
    expect(text).not.toMatch(/never costs you a say/);
    // An old draft's keys are carried, unread, and never published.
    const body = ROLE_APPLICATION_TYPE.publish.body({ seatId: "s-1", commitmentPct: 40, tokenSlug: "x", seatSettings: { v: 1 } });
    expect(Object.keys(body).sort()).toEqual(["deliverables", "fitStatement", "orgRoleId", "seatSettings"]);
  });

  it("judges the terms with the shared parser", () => {
    expect(settingsProblem(undefined)).toBeNull();
    expect(settingsProblem({ v: 1, pay: { kind: "none" } })).toBeNull();
    expect(settingsProblem({ v: 1, voice: 2 })).toMatch(/Voice is never a term/);
  });
});
