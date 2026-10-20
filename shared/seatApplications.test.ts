/**
 * The member door's pure rules (seat settings PR4): what an application must
 * carry, who adopts it, and what a public ballot about it may say.
 *
 * The route test (server/routes/seatApplications.test.ts) proves the wiring
 * over HTTP and a schema; this one proves the rules with nothing in the way.
 */
import { describe, expect, it } from "vitest";
import { whoMayPutHandToVillage } from "./powerHands";
import { kindOfSubject } from "./governanceKinds";
import {
  adoptionPath,
  adoptRefusal,
  applicationBallotDoc,
  applicationBallotTitle,
  APPLICATION_STATUSES,
  parseApplicationInput,
  putToVillageRefusal,
  ROLE_APPLICATION,
  seatList,
  STATUS_WORDS,
} from "./seatApplications";

const body = (over: Record<string, unknown> = {}) => ({
  seatIds: ["seat-a"],
  deliverables: "By the end of the season the orchard ledger balances every moon.",
  fitStatement: "I kept it last season.",
  seatSettings: { v: 1 },
  ...over,
});

describe("parseApplicationInput", () => {
  it("reads one to five distinct seats, and an old draft's single seat", () => {
    expect(parseApplicationInput(body()).ok).toBe(true);
    expect(parseApplicationInput(body({ seatIds: ["a", "b", "c", "d", "e"] })).ok).toBe(true);
    const old = parseApplicationInput({ ...body(), seatIds: undefined, orgRoleId: "seat-old" });
    expect(old.ok && old.input.seatIds).toEqual(["seat-old"]);
  });

  it("refuses no seat, six seats and a seat named twice", () => {
    expect(parseApplicationInput(body({ seatIds: [] }))).toMatchObject({ ok: false, field: "seatIds" });
    expect(parseApplicationInput(body({ seatIds: ["a", "b", "c", "d", "e", "f"] }))).toMatchObject({ ok: false, field: "seatIds" });
    expect(parseApplicationInput(body({ seatIds: ["a", "a"] }))).toMatchObject({ ok: false, field: "seatIds" });
  });

  it("refuses terms the shared parser refuses, in its own words", () => {
    const r = parseApplicationInput(body({ seatSettings: { v: 1, commitmentPct: 40 } }));
    expect(r).toMatchObject({ ok: false, field: "seatSettings" });
    if (!r.ok) expect(r.error).toMatch(/held whole/);
  });

  it("refuses payment details in the member's words, and lets a date through", () => {
    expect(parseApplicationInput(body({ fitStatement: "My account is GB33BUKB20201555555555." }))).toMatchObject({ ok: false, field: "note" });
    expect(parseApplicationInput(body({ deliverables: "Card 4111 1111 1111 1111 for the stipend, and the ledger balanced." }))).toMatchObject({
      ok: false,
      field: "deliverables",
    });
    expect(parseApplicationInput(body({ fitStatement: "I started on 2026-03-21 and kept going." })).ok).toBe(true);
  });

  it("reads a first day as a civil date or refuses it", () => {
    const r = parseApplicationInput(body({ startsNoEarlierThan: "2027-03-21" }));
    expect(r.ok && r.input.startsOn).toBe("2027-03-21");
    expect(parseApplicationInput(body({ startsNoEarlierThan: "next spring" }))).toMatchObject({ ok: false, field: "startsNoEarlierThan" });
  });
});

describe("who adopts", () => {
  const rule = (villageHolds: boolean, holders: string[]) => whoMayPutHandToVillage(villageHolds, holders);

  it("the village votes when it holds the power, and when nobody holds it live", () => {
    expect(adoptionPath(rule(true, ["u-hal"]), "u-ana")).toBe("ballot");
    expect(adoptionPath(rule(false, []), "u-ana")).toBe("ballot");
  });

  it("a live holder who is not the candidate adopts", () => {
    expect(adoptionPath(rule(false, ["u-hal"]), "u-ana")).toBe("holder");
    expect(adoptionPath(rule(false, ["u-ana", "u-hal"]), "u-ana")).toBe("holder");
  });

  it("SELF-DEALING: a candidate who is the only live holder falls through to a ballot", () => {
    expect(adoptionPath(rule(false, ["u-ana"]), "u-ana")).toBe("ballot");
  });

  it("a holder never adopts their own terms, and a non-holder never adopts", () => {
    const r = rule(false, ["u-ana", "u-hal"]);
    expect(adoptRefusal(r, "u-ana", "u-ana")).toMatchObject({ status: 403, error: "own_terms", message: "Your own terms go to the village to adopt." });
    expect(adoptRefusal(r, "u-ivo", "u-ana")).toMatchObject({ status: 403, error: "not_a_holder" });
    expect(adoptRefusal(r, "u-hal", "u-ana")).toBeNull();
    // When the village holds it, nobody adopts by hand: it is the vote's.
    expect(adoptRefusal(rule(true, ["u-hal"]), "u-hal", "u-ana")).toMatchObject({ error: "not_a_holder" });
  });

  it("any live holder may send it to the village, the candidate included", () => {
    const r = rule(false, ["u-ana", "u-hal"]);
    expect(putToVillageRefusal(r, "u-ana")).toBeNull();
    expect(putToVillageRefusal(r, "u-hal")).toBeNull();
    expect(putToVillageRefusal(r, "u-ivo")).toMatchObject({ error: "not_a_holder" });
  });
});

describe("the ballot's words", () => {
  const seats = [
    { name: "Lead steward", aim: "Hold the village's whole picture." },
    { name: "Platform steward", aim: null },
    { name: "Design facilitator", aim: "Keep how we decide clear." },
  ];

  it("name the seats and their aims, as plain lines", () => {
    expect(applicationBallotTitle(seats)).toBe("Who holds Lead steward, Platform steward and Design facilitator");
    const doc = applicationBallotDoc(seats, "sa-00112233445566aa");
    expect(doc).toContain("  Lead steward\n    Hold the village's whole picture.");
    expect(doc).toContain("  Platform steward\n");
    expect(doc).toContain("/seat-applications/sa-00112233445566aa");
    expect(doc).not.toMatch(/^#|\*\*/m);
  });

  it("are built from the seats alone, so nothing else has a way in", () => {
    // The functions take seat names and aims and an id; there is no parameter
    // for a person, a note or the terms. Their arity is the guarantee.
    expect(applicationBallotTitle.length).toBe(1);
    expect(applicationBallotDoc.length).toBe(2);
  });

  it("lists names the way a sentence does", () => {
    expect(seatList(["A"])).toBe("A");
    expect(seatList(["A", "B"])).toBe("A and B");
    expect(seatList([])).toBe("a seat");
  });
});

describe("the subject", () => {
  it("is a game change, so it waits its window like any other", () => {
    expect(kindOfSubject(ROLE_APPLICATION)).toBe("game_change");
    expect(ROLE_APPLICATION.length).toBeLessThanOrEqual(24);
  });

  it("has words for every status", () => {
    for (const s of APPLICATION_STATUSES) expect(STATUS_WORDS[s], s).toBeTruthy();
  });
});
