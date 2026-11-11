import { describe, expect, it } from "vitest";
import { baseWordsOf, counterOfferOf, currentCommitment, currentWords, editOffer, offerForCandidate, openTalks, replyToOffer } from "./counterOffer";

const by = { id: "u1", name: "A holder" };
const at = new Date("2026-11-10T10:00:00Z");
const base = { term: "We renew each moon.", ending: "One moon's notice." };

describe("counter-offer rules", () => {
  it("appends revisions, folds the current wording and the commitment, and ignores unchanged settings", () => {
    const one = editOffer({ base, theirs: 60, co: null, edit: { words: { term: "We renew each moon.", ending: "Two moons." }, commitmentPct: 80 }, by, now: at });
    if (!one.ok) throw new Error(one.error);
    expect(one.revision.changes.map((c) => c.key)).toEqual(["ending", "commitment"]);
    const two = editOffer({ base, theirs: 60, co: one.co, edit: { words: { ending: "" } }, by, now: at });
    if (!two.ok) throw new Error(two.error);
    expect(currentWords(base, two.co)).toEqual({ term: "We renew each moon." });
    expect(currentCommitment(60, two.co)).toBe(80);
    expect(two.co.revisions).toHaveLength(2);
    expect(counterOfferOf(JSON.parse(JSON.stringify(two.co)))?.revisions).toHaveLength(2);
  });

  it("refuses an empty edit, a bad commitment and a long wording", () => {
    expect(editOffer({ base, theirs: null, co: null, edit: { words: { term: base.term } }, by, now: at }).ok).toBe(false);
    expect(editOffer({ base, theirs: null, co: null, edit: { commitmentPct: 55 }, by, now: at }).ok).toBe(false);
    expect(editOffer({ base, theirs: null, co: null, edit: { words: { term: "x".repeat(601) } }, by, now: at }).ok).toBe(false);
  });

  it("asks again when a setting changes after the applicant answered, and leaves the rest accepted", () => {
    const one = editOffer({ base, theirs: 60, co: null, edit: { words: { ending: "Two moons." } }, by, now: at });
    if (!one.ok) throw new Error();
    const replied = replyToOffer(one.co, { ending: { choice: "accept", note: "" } }, at);
    if (!replied.ok) throw new Error();
    expect(openTalks({ answers: { term: { choice: "accept", note: "" } }, co: replied.co })).toEqual([]);
    const two = editOffer({ base, theirs: 60, co: replied.co, edit: { words: { ending: "Three moons." } }, by, now: at });
    if (!two.ok) throw new Error();
    expect(openTalks({ answers: {}, co: two.co })).toEqual(["ending"]);
    expect(offerForCandidate({ base, answers: {}, theirs: 60, co: two.co })?.rows.map((r) => r.key)).toEqual(["ending"]);
  });

  it("lists an unchanged setting the applicant still wants to talk about", () => {
    const one = editOffer({ base, theirs: 60, co: null, edit: { words: { ending: "Two moons." } }, by, now: at });
    if (!one.ok) throw new Error();
    expect(openTalks({ answers: { term: { choice: "talk", note: "" }, rhythm: { choice: "accept", note: "" } }, co: one.co })).toEqual(["term", "ending"]);
    expect(openTalks({ answers: { term: { choice: "talk", note: "" } }, co: null })).toEqual(["term"]);
  });

  it("takes the first role's wording for each setting", () => {
    expect(baseWordsOf([{ words: { term: "A" } }, { words: { term: "B", ending: "C" } }])).toEqual({ term: "A", ending: "C" });
  });
});
