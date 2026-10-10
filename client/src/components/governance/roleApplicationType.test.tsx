// @vitest-environment jsdom
/**
 * "APPLY FOR A SEAT" PUBLISHES NOW (seat settings PR4).
 *
 * PR1 held this type to a practice vote until its route existed, and this file
 * held that lock. The route has landed (server/routes/seatApplications.ts), so
 * the lock is gone and what this file holds instead is that the type is real:
 *
 *  1. It is conductable on the server, and the rendered type card starts a
 *     wizard walk rather than a practice vote.
 *  2. It picks one to five seats, and its publish body is what the route reads.
 *  3. `?type=role_application&seat=<id>` opens it with that seat picked, and the
 *     seat's terms on offer are the terms step's starting point.
 *  4. The old terms are gone: no commitment, deferred share, token or amount per
 *     cycle, and neither false tip. Drafts still load under the same id.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CONDUCTABLE_TYPES, WIZARD_TYPES as SERVER_WIZARD_TYPES } from "../../../../server/lib/proposalDrafts";
import { parseApplicationInput } from "@shared/seatApplications";
import TypeCards from "./TypeCards";
import { typeConfig } from "./wizardConfig";
import { fieldsFor } from "./wizardWalk";
import { offerPrefill, ROLE_APPLICATION_TYPE, roleApplicationStart, seatsProblem, settingsProblem } from "./roleApplicationType";

const cardFor = () => screen.getByRole("button", { name: /Apply for a seat/ });

describe("role_application publishes", () => {
  it("is conductable on the server", () => {
    expect(CONDUCTABLE_TYPES).toContain("role_application");
  });

  it("renders a card that starts the wizard walk, never a practice vote", () => {
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
    expect(card).not.toBeDisabled();
    fireEvent.click(card);
    expect(onChoose).toHaveBeenCalledWith("role_application");
    expect(onPractice).not.toHaveBeenCalled();
  });

  it("CONTROL: a type outside the conductable list is still practice locked on the same screen", () => {
    const onChoose = vi.fn();
    render(
      <TypeCards
        chosen={null}
        conductable={CONDUCTABLE_TYPES.filter((t) => t !== "role_application")}
        advisory={[]}
        mayOpenAdvisory={false}
        onChoose={onChoose}
        onPractice={vi.fn()}
      />,
    );
    const card = cardFor();
    expect(card).toBeDisabled();
    fireEvent.click(card);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("PR5: the candidate aligns as they propose, and the button says so", () => {
    expect(ROLE_APPLICATION_TYPE.aligns).toBe(true);
    expect(ROLE_APPLICATION_TYPE.publishLabel).toBe("Propose and align");
  });

  it("opens the vote itself, so the review step leaves out the sensing sentences", () => {
    expect(ROLE_APPLICATION_TYPE.opensVote).toBe(true);
    expect(ROLE_APPLICATION_TYPE.publish.path).toBe("/api/governance/role-applications");
  });

  it("publishes a body the route reads as one application over every picked seat", () => {
    const body = ROLE_APPLICATION_TYPE.publish.body({
      seatIds: ["s-1", "s-2", "s-3"],
      deliverables: "By the end of the season two more people can keep the orchard ledger.",
      fitStatement: "I kept the ledger last season and know where it goes wrong.",
      seatSettings: { v: 1, pay: { kind: "none" } },
      startsNoEarlierThan: "2027-03-21",
    });
    const parsed = parseApplicationInput(body);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.input.seatIds).toEqual(["s-1", "s-2", "s-3"]);
      expect(parsed.input.startsOn).toBe("2027-03-21");
      expect(parsed.input.note).toMatch(/kept the ledger/);
    }
    // No first day picked: none is sent.
    expect(ROLE_APPLICATION_TYPE.publish.body({ seatIds: ["s-1"] })).not.toHaveProperty("startsNoEarlierThan");
  });

  it("picks one to five seats", () => {
    expect(fieldsFor("role_application", "subject").map((f) => [f.key, f.kind])).toEqual([["seatIds", "seatPicks"]]);
    expect(seatsProblem([])).toMatch(/Pick the seat/);
    expect(seatsProblem(["a"])).toBeNull();
    expect(seatsProblem(["a", "b", "c", "d", "e"])).toBeNull();
    expect(seatsProblem(["a", "b", "c", "d", "e", "f"])).toMatch(/at most 5/);
  });
});

describe("a wizard opened from a seat", () => {
  it("starts on this type with the seat picked", () => {
    expect(roleApplicationStart("?type=role_application&seat=seat-lead")).toEqual({
      type: "role_application",
      answers: { seatIds: ["seat-lead"] },
    });
    expect(roleApplicationStart("?module=events")).toBeNull();
    expect(roleApplicationStart("")).toBeNull();
  });

  it("opens from a season plan: renew picks the held seat and the season rides to the route", () => {
    expect(roleApplicationStart("?type=role_application&seat=seat-lead&renew=seat-lead&season=s-next")).toEqual({
      type: "role_application",
      answers: { seatIds: ["seat-lead"], seasonId: "s-next" },
    });
    expect(roleApplicationStart("?type=role_application&renew=seat-lead")).toEqual({
      type: "role_application",
      answers: { seatIds: ["seat-lead"] },
    });
    const body = ROLE_APPLICATION_TYPE.publish.body({ seatIds: ["seat-lead"], seasonId: "s-next" });
    const parsed = parseApplicationInput(body);
    expect(parsed.ok && parsed.input.seasonId).toBe("s-next");
    // No season: none is sent.
    expect(ROLE_APPLICATION_TYPE.publish.body({ seatIds: ["s-1"] })).not.toHaveProperty("seasonId");
  });

  it("starts the terms from the first seat's terms on offer, and from the preset when there are none", () => {
    const org = {
      roles: [
        { id: "seat-lead", termsOffer: { v: 1, pay: { kind: "honorary" } } },
        { id: "seat-quiet", termsOffer: null },
        // A reader without terms.read is served the seat with no termsOffer key at all.
        { id: "seat-hidden" },
      ],
    };
    expect(offerPrefill(["seat-lead", "seat-quiet"], org)).toEqual({ v: 1, pay: { kind: "honorary" } });
    expect(offerPrefill(["seat-quiet"], org)).toBeUndefined();
    expect(offerPrefill(["seat-hidden"], org)).toBeUndefined();
    expect(offerPrefill([], org)).toBeUndefined();
  });
});

describe("role_application after the move", () => {
  it("keeps its id, so stored drafts still load", () => {
    expect(SERVER_WIZARD_TYPES).toContain("role_application");
    expect(typeConfig("role_application")).toBe(ROLE_APPLICATION_TYPE);
  });

  it("asks its terms as one seatSettings field, with an optional first day", () => {
    expect(fieldsFor("role_application", "terms").map((f) => [f.key, f.kind])).toEqual([
      ["seatSettings", "seatSettings"],
      ["startsNoEarlierThan", "date"],
    ]);
  });

  it("drops the old fields and their tips everywhere", () => {
    const text = JSON.stringify(ROLE_APPLICATION_TYPE.steps);
    for (const gone of ["commitmentPct", "deferredPct", "tokenSlug", "tokenPerCycle", "cashNote"]) {
      expect(text, gone).not.toContain(gone);
    }
    expect(text).not.toMatch(/scales both the pay and the voice/);
    expect(text).not.toMatch(/never costs you a say/);
    // An old draft's keys are carried, unread, and never published. Its one seat still is.
    const body = ROLE_APPLICATION_TYPE.publish.body({ seatId: "s-1", commitmentPct: 40, tokenSlug: "x", seatSettings: { v: 1 } });
    expect(Object.keys(body).sort()).toEqual(["deliverables", "fitStatement", "seatIds", "seatSettings"]);
    expect(body.seatIds).toEqual(["s-1"]);
  });

  it("judges the terms with the shared parser", () => {
    expect(settingsProblem(undefined)).toBeNull();
    expect(settingsProblem({ v: 1, pay: { kind: "none" } })).toBeNull();
    expect(settingsProblem({ v: 1, voice: 2 })).toMatch(/Voice is never a term/);
  });
});
