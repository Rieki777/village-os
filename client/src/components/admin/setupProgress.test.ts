/**
 * The checklist has to read the record, and this is the test that says so.
 *
 * The first case below is the outage in miniature: a brand document with every
 * box ticked and every field empty. That is the state a live village was
 * actually in, and the old checklist scored it six of six on the one screen a
 * founder opens to ask whether the village is set up. If that case ever goes
 * green again, the checklist has gone back to reading the founder's memory.
 */
import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "@shared/gameConfig";
import {
  SETUP_STEPS,
  measureSetup,
  needsObservation,
  setupCounts,
  setupIsComplete,
  type BrandLike,
  type SetupObservations,
} from "./setupProgress";

const ALL_TICKED = { identity: true, needs: true, images: true, numbers: true, content: true, map: true, technical: true };

/**
 * The needs step is READ, never ticked, so every fixture that means "this
 * village finished setup" has to supply the reading as well as the record.
 * A tick cannot carry it: `SETUP_STEPS` gives it no fields and
 * `needsObservation` always answers `measured`, so the box that carries the
 * other four is never rendered for this one.
 */
const NEEDS_IN_SCOPE: SetupObservations = needsObservation({ answered: true, adopted: 4, customAdopted: 0 });

/** The shape `GET /api/admin/brand` returns for a village that has saved nothing. */
function emptyBrand(): BrandLike {
  return {
    project: { name: "", tagline: "", memberName: "", location: "", footerBlurb: "", siteUrl: "", eventsUrl: "", contactEmail: "" },
    images: Object.fromEntries(Object.keys(GAME_CONFIG.images).map((k) => [k, ""])),
    setup: { ...ALL_TICKED },
  };
}

/** Every measured field filled, built from the step list so a field added there
 *  is filled here too rather than quietly leaving this fixture incomplete. */
function filledBrand(): BrandLike {
  const brand = emptyBrand();
  for (const step of SETUP_STEPS) {
    for (const field of step.fields) {
      (brand[field.group] as Record<string, unknown>)[field.key] = `a ${field.label}`;
    }
  }
  return brand;
}

const row = (brand: BrandLike | null | undefined, key: string) =>
  measureSetup(brand, NEEDS_IN_SCOPE).find((r) => r.key === key)!;

describe("measureSetup", () => {
  it("does not let a ticked box stand in for an empty field", () => {
    const brand = emptyBrand();
    expect(row(brand, "identity").done).toBe(false);
    expect(row(brand, "identity").filled).toBe(0);
    expect(row(brand, "images").done).toBe(false);
    expect(row(brand, "images").filled).toBe(0);
    expect(setupIsComplete(brand, NEEDS_IN_SCOPE)).toBe(false);
  });

  it("counts a measured row up as fields are saved", () => {
    // The positive control for the case above: the same reader, the same
    // record shape, reporting done on a village that really did fill it in.
    const brand = filledBrand();
    expect(row(brand, "identity")).toMatchObject({ done: true, filled: 5, total: 5, blank: [] });
    expect(row(brand, "images")).toMatchObject({ done: true, filled: 9, total: 9, blank: [] });
    expect(setupIsComplete(brand, NEEDS_IN_SCOPE)).toBe(true);
  });

  it("names the fields still empty, and goes back to unfinished when one is cleared", () => {
    const brand = filledBrand();
    (brand.images as Record<string, unknown>).hero = "";
    (brand.images as Record<string, unknown>).favicon = "";
    expect(row(brand, "images").done).toBe(false);
    expect(row(brand, "images").filled).toBe(7);
    expect(row(brand, "images").blank).toEqual(["Homepage hero", "Browser tab icon"]);
    expect(setupIsComplete(brand)).toBe(false);
  });

  it("does not accept whitespace as a village name", () => {
    const brand = filledBrand();
    (brand.project as Record<string, unknown>).name = "   ";
    expect(row(brand, "identity").done).toBe(false);
    expect(row(brand, "identity").blank).toEqual(["Project name"]);
  });

  it("leaves the optional identity fields out of the count", () => {
    // siteUrl, eventsUrl and contactEmail each say in their own label that
    // blank is a real answer, so a village that wants no outside links still
    // finishes this step.
    const brand = filledBrand();
    expect((brand.project as Record<string, string>).siteUrl).toBe("");
    expect((brand.project as Record<string, string>).contactEmail).toBe("");
    expect(row(brand, "identity").done).toBe(true);
  });

  it("carries a ticked box, and says it was a founder who said so", () => {
    const brand = emptyBrand();
    for (const key of ["numbers", "content", "map", "technical"]) {
      expect(row(brand, key)).toMatchObject({
        measured: false,
        source: "declared",
        state: "done",
        done: true,
        declaredDone: true,
        // Nothing was counted, so nothing is reported as counted. A zero here
        // would read as "none of them are set".
        filled: null,
        total: null,
      });
    }
  });

  it("reads an untouched box as nobody having looked, not as unfinished", () => {
    // The two are different facts. An empty box means the founder has not made
    // a note; it never means this screen went and checked.
    const brand = emptyBrand();
    brand.setup = { ...ALL_TICKED, map: false };
    expect(row(brand, "map")).toMatchObject({
      state: "unknown",
      done: false,
      declaredDone: false,
      filled: null,
      total: null,
    });
  });

  it("reads a record that never arrived as unknown, and counts nothing", () => {
    // THE SILENT ZERO. Before this, `measureSetup(null)` answered
    // "0 of 9 filled in" for the pictures row, which is what a village with
    // nine empty slots is told. A document nobody has read says nothing.
    for (const brand of [null, undefined]) {
      expect(row(brand, "identity")).toMatchObject({
        state: "unknown",
        done: false,
        filled: null,
        total: null,
      });
      expect(row(brand, "images")).toMatchObject({ state: "unknown", filled: null, total: null });
      expect(row(brand, "numbers")).toMatchObject({ state: "unknown", declaredDone: false });
      expect(setupIsComplete(brand)).toBe(false);
      // Seven, and the needs row is one of them EVEN WITH a reading passed
      // in: an observation of one step cannot make the screen knowledgeable
      // about a record that never arrived.
      expect(setupCounts(brand, NEEDS_IN_SCOPE)).toMatchObject({ done: 0, todo: 0, unknown: 7 });
    }
  });

  it("reads an empty record as counted and empty, which is a different fact", () => {
    // `{}` is a document that arrived carrying nothing. That IS the outage
    // state and it must still count to zero out loud.
    expect(row({}, "identity")).toMatchObject({ state: "todo", filled: 0, total: 5 });
    expect(row({}, "images")).toMatchObject({ state: "todo", filled: 0, total: 9 });
    expect(setupIsComplete({})).toBe(false);
  });
});

describe("observations, for the steps whose values live elsewhere", () => {
  it("takes the reading over the box when the reading says done", () => {
    const brand = emptyBrand();
    brand.setup = { ...ALL_TICKED, numbers: false };
    const rows = measureSetup(brand, {
      numbers: { state: "done", filled: 3, total: 3, detail: "3 figures stated" },
    });
    expect(rows.find((r) => r.key === "numbers")).toMatchObject({
      source: "measured",
      state: "done",
      done: true,
      declaredDone: false,
      filled: 3,
      total: 3,
      detail: "3 figures stated",
    });
  });

  it("lets a founder carry a step the reading calls unfinished, visibly", () => {
    // A blank is sometimes the real answer: a village states its own land
    // figures or states none. The tick still carries the step, and the row says
    // whose word carried it.
    const brand = emptyBrand();
    const rows = measureSetup(brand, { numbers: { state: "todo", filled: 0, total: 7 } });
    expect(rows.find((r) => r.key === "numbers")).toMatchObject({
      source: "declared",
      state: "done",
      done: true,
      declaredDone: true,
      measured: false,
    });
  });

  it("reports the reading when the founder has not ticked", () => {
    const brand = emptyBrand();
    brand.setup = { ...ALL_TICKED, numbers: false };
    const rows = measureSetup(brand, { numbers: { state: "todo", filled: 1, total: 7 } });
    expect(rows.find((r) => r.key === "numbers")).toMatchObject({
      source: "measured",
      state: "todo",
      done: false,
      declaredDone: false,
      filled: 1,
      total: 7,
    });
  });

  it("ignores an observation for a record that never arrived", () => {
    // Nothing was read, so a reading of one step cannot make the screen
    // knowledgeable about it.
    const rows = measureSetup(null, { numbers: { state: "done" } });
    expect(rows.every((r) => r.state === "unknown")).toBe(true);
  });
});

describe("setupCounts", () => {
  it("tells still-to-do apart from nobody-has-looked", () => {
    const counts = setupCounts(emptyBrand(), NEEDS_IN_SCOPE);
    // Two counted rows sit empty; the four boxes are all ticked; the needs
    // row is read from the scope and is done, and is never one of the four
    // declared rows because it has a reading of its own.
    expect(counts).toEqual({ done: 5, todo: 2, unknown: 0, declared: 4, total: 7 });
  });

  it("counts a finished village as finished", () => {
    expect(setupCounts(filledBrand(), NEEDS_IN_SCOPE)).toMatchObject({ done: 7, todo: 0, unknown: 0 });
    expect(setupIsComplete(filledBrand(), NEEDS_IN_SCOPE)).toBe(true);
  });
});

describe("the needs step reads the scope", () => {
  /* The completion predicate for step 2. What a founder ticked has no say in
     it: the scope is readable, so it is read. */

  it("ticks when one need is in scope and unticks when every one is retired", () => {
    const brand = filledBrand();
    const inScope = needsObservation({ answered: true, adopted: 1, customAdopted: 0 });
    expect(measureSetup(brand, inScope).find((r) => r.key === "needs")).toMatchObject({
      state: "done",
      done: true,
      measured: true,
      source: "measured",
      declaredDone: false,
      filled: 1,
      total: 10,
    });
    expect(setupIsComplete(brand, inScope)).toBe(true);

    const allRetired = needsObservation({ answered: true, adopted: 0, customAdopted: 0 });
    expect(measureSetup(brand, allRetired).find((r) => r.key === "needs")).toMatchObject({
      state: "todo",
      done: false,
      filled: 0,
      total: 10,
    });
    expect(setupIsComplete(brand, allRetired)).toBe(false);
  });

  it("keeps a scope nobody has read apart from a scope that is empty", () => {
    /* The whole reason this is three states. An unread scope and a village
       that took on nothing are different facts, and a screen that prints one
       for the other is how nine empty picture slots read as finished. */
    const unread = needsObservation(null).needs!;
    expect(unread.state).toBe("unknown");
    expect(unread.filled).toBeUndefined();
    expect(unread.total).toBeUndefined();

    const answeredNone = needsObservation({ answered: true, adopted: 0, customAdopted: 0 }).needs!;
    const neverAnswered = needsObservation({ answered: false, adopted: 0, customAdopted: 0 }).needs!;
    expect(answeredNone.state).toBe("todo");
    expect(neverAnswered.state).toBe("todo");
    expect(answeredNone.detail).not.toBe(neverAnswered.detail);
  });

  it("counts against the list this village chose from, custom needs included", () => {
    /* A fixed ten would print "11 of 10" the day a village adopts its own
       need alongside all ten platform ones. */
    expect(needsObservation({ answered: true, adopted: 11, customAdopted: 1 }).needs).toMatchObject({
      filled: 11,
      total: 11,
    });
  });

  it("cannot be carried by a founder's tick", () => {
    /* Every other unmeasured step lets a tick stand in. This one never does,
       because it has a reading, and SetupSection renders no box for a measured
       row. A brand document with every box ticked and nothing in scope is the
       outage this file exists for, in its newest shape. */
    const brand = filledBrand();
    brand.setup = { ...ALL_TICKED };
    const rows = measureSetup(brand, needsObservation({ answered: false, adopted: 0, customAdopted: 0 }));
    expect(rows.find((r) => r.key === "needs")).toMatchObject({
      state: "todo",
      done: false,
      declaredDone: false,
      source: "measured",
    });
    expect(setupIsComplete(brand, needsObservation({ answered: false, adopted: 0, customAdopted: 0 }))).toBe(false);
  });
});

describe("the step list", () => {
  it("keeps the seven steps in the order a founder works", () => {
    // What the village is FOR sits second, ahead of what it looks like and
    // ahead of its numbers, because the scope orients the scale (R1).
    expect(SETUP_STEPS.map((s) => s.key)).toEqual([
      "identity",
      "needs",
      "images",
      "numbers",
      "content",
      "map",
      "technical",
    ]);
  });

  it("measures every picture the platform has a slot for", () => {
    // A tenth image added to the platform would otherwise sit uncounted, which
    // is the same silence the empty nine lived in.
    const platform = Object.keys(GAME_CONFIG.images).filter((k) => !k.endsWith("Alt"));
    const measured = SETUP_STEPS.find((s) => s.key === "images")!.fields.map((f) => f.key);
    expect(platform).toHaveLength(9);
    expect(platform).toContain("hero");
    expect([...measured].sort()).toEqual([...platform].sort());
  });

  it("names identity fields the config actually carries", () => {
    const known = { project: Object.keys(GAME_CONFIG.project) };
    expect(known.project).toContain("tagline");
    for (const field of SETUP_STEPS.find((s) => s.key === "identity")!.fields) {
      expect(known[field.group as "project"]).toContain(field.key);
    }
  });

  it("measures no currency field, because no box here sets one", () => {
    // The wizard's "Recognition currency name" and "Currency, lowercase" boxes
    // were dead: mergedConfig() reads that name from the token registry ahead
    // of the brand document, so nothing typed there ever showed anywhere. Both
    // boxes are gone and so is their count. A token is named under Admin then
    // Tokens, which is not part of the brand record.
    for (const step of SETUP_STEPS) {
      for (const field of step.fields) {
        expect(field.group, `${step.key}.${field.key}`).not.toBe("currency");
      }
    }
  });
});
