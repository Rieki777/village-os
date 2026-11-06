/**
 * The page's rules for the outside service's differences (spec section 8.6),
 * each one a case here: what the headline counts (R29), how the list groups
 * and sorts (R31, R37), what a member is told about who decides (R38), the
 * read-trouble lines (R36) and the merged diff a conflict shows (R33).
 *
 * The rows are built with the server's own sentence builders
 * (shared/seraDifferenceWords.ts), so the words under test are the words the
 * route sends.
 */
import { describe, expect, it } from "vitest";
import { listed, type Over } from "@/test/seraDifferences";
import {
  GROUP_OPEN_MAX,
  aheadWords,
  factsWords,
  groupByCircle,
  groupHeading,
  headlineWords,
  inStep,
  mergedDiff,
  readCount,
  readList,
  readTrouble,
  smallWords,
  splitWaiting,
} from "./seraReview";

const aim = (over: Over = {}) => listed({ kind: "textField", field: "aim", lane: "lowRisk", ...over });
const fact = (over: Over = {}) => listed({ kind: "valueField", field: "Next Review Date", lane: "facts", sera: "1 Dec", ours: null, ...over });

describe("what waits for a person (R29)", () => {
  const list = [
    listed(),
    listed({ kind: "roleMove", field: "circle", params: { from: "Water", to: ["Land"] } }),
    aim({ state: "conflict", sera: "Keeps the water clean", ours: "Keeps the water" }),
    aim({ sera: "Runs the kitchen", ours: "Cooks" }),
    fact(),
    fact(),
    listed({ state: "oursAhead" }),
  ];

  it("counts decisions and every conflict in the headline, and nothing else", () => {
    const w = splitWaiting(list);
    expect(w.toDecide).toHaveLength(3);
    expect(w.small).toHaveLength(1);
    expect(w.facts).toHaveLength(2);
    expect(w.oursAhead).toHaveLength(1);
    expect(headlineWords("Sera", w, false)).toBe("Sera suggests 3 changes for you to decide");
  });

  it("says the small changes and the facts on lines of their own", () => {
    const w = splitWaiting(list);
    expect(smallWords(w)).toBe("1 small change also waits for you, because automatic apply is off.");
    expect(factsWords(w)).toBe("2 facts updated by themselves since yesterday.");
    expect(aheadWords("Sera", w.oursAhead.length)).toBe(
      "1 thing you changed here is still the old way in Sera. Sera doesn't hear about changes made here, so update it in Sera if you want both to match.",
    );
  });

  it("leads with the small changes when nothing else waits", () => {
    const w = splitWaiting([aim(), aim()]);
    expect(headlineWords("Sera", w, false)).toBe("Sera suggests 2 small changes");
    expect(smallWords(w)).toBe("They wait for you, because automatic apply is off.");
  });

  it("is in step only when the last read was whole, nothing waits, and no draft is open", () => {
    const w = splitWaiting([fact(), listed({ state: "oursAhead" })]);
    const read = { lastReadAt: "2026-11-06T14:05:00.000Z", lastReadWhole: true };
    expect(inStep(read, w, false)).toBe(true);
    expect(headlineWords("Sera", w, true)).toBe("The chart and Sera are in step");
    expect(inStep(read, w, true)).toBe(false);
    expect(inStep({ ...read, lastReadWhole: false }, w, false)).toBe(false);
    expect(inStep({ ...read, lastReadAt: null }, w, false)).toBe(false);
    expect(inStep(read, splitWaiting([aim()]), false)).toBe(false);
    expect(headlineWords("Sera", w, false)).toBe("Nothing from Sera waits for you");
  });
});

describe("groups by circle (R31, R37)", () => {
  it("groups by the circle a difference concerns, with the count in the heading", () => {
    const groups = groupByCircle([
      listed(),
      listed({ subject: { circleId: "c-kitchen", circleName: "Kitchen" } }),
      listed(),
      listed({ kind: "circleRest", field: null, subject: { kind: "circle", ourId: "c-kitchen", name: "Kitchen", circleId: null, circleName: null } }),
    ]);
    expect(groups.map(groupHeading)).toEqual(["Kitchen: 2 changes", "Water: 2 changes"]);
  });

  it("puts the groups in chart order, circles not here yet after them, and roles in no circle last", () => {
    const groups = groupByCircle(
      [
        listed({ subject: { circleId: "none", circleName: null } }),
        listed({ subject: { circleId: "c-kitchen", circleName: "Kitchen" } }),
        listed({ kind: "roleAdd", field: null, subject: { ourId: null, circleId: "sera:new", circleName: "Bees" } }),
        listed(),
      ],
      ["c-water", "c-kitchen"],
    );
    expect(groups.map((g) => g.name)).toEqual(["Water", "Kitchen", "Bees", null]);
  });

  it("sorts by the flags shown: a flag the screen leaves off never lifts a row", () => {
    const pay = listed({ kind: "pay", field: "pay", flags: [{ key: "baseUnknown" }], subject: { name: "Cook" } });
    const plain = listed({ subject: { name: "Alpha" } });
    const [g] = groupByCircle([plain, pay]);
    expect(g.rows.map((r) => r.d.key)).toEqual([plain.key, pay.key]);
    expect(pay.flags.map((f) => f.key)).toEqual(["baseUnknown"]);
  });

  it("sorts Check first rows to the top of their group, the rest in the order sent", () => {
    const plain = listed({ subject: { name: "Alpha" } });
    const flagged = listed({ subject: { name: "Beta" }, flags: [{ key: "matchedByName" }] });
    const later = listed({ subject: { name: "Gamma" } });
    const [g] = groupByCircle([plain, flagged, later]);
    expect(g.rows.map((r) => r.d.key)).toEqual([flagged.key, plain.key, later.key]);
  });

  it("nests the roles of a new circle under it, and they count in the group", () => {
    const circle = listed({
      kind: "circleAdd",
      field: null,
      params: { roles: 2 },
      subject: { kind: "circle", pageId: "landpage", ourId: null, name: "Land Stewardship", circleId: null, circleName: null },
    });
    const roleA = listed({ kind: "roleAdd", field: null, subject: { ourId: null, name: "Soil Keeper", circleId: "sera:landpage", circleName: "Land Stewardship" } });
    const roleB = listed({ kind: "roleAdd", field: null, subject: { ourId: null, name: "Seed Saver", circleId: "sera:landpage", circleName: "Land Stewardship" } });
    const groups = groupByCircle([roleA, circle, roleB]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(1);
    expect(groups[0].rows[0].d.key).toBe(circle.key);
    expect(groups[0].rows[0].nested.map((d) => d.subject.name)).toEqual(["Soil Keeper", "Seed Saver"]);
    expect(groupHeading(groups[0])).toBe("Land Stewardship: 3 changes");
  });

  it("collapses a group of more than eight", () => {
    expect(GROUP_OPEN_MAX).toBe(8);
  });
});

describe("what the last read could not bring (R36)", () => {
  const now = new Date(2026, 10, 6, 15, 0);
  const at = (h: number, m = 0) => new Date(2026, 10, 6, h, m).toISOString();

  it("says the service did not answer, and which check the list is from", () => {
    const t = readTrouble(
      { lastReadAt: at(14, 5), reads: { circles: "failed", roles: "failed" }, lastWholeAt: { circles: at(9), roles: at(9) } },
      now,
    );
    expect(t).toEqual({ noAnswer: true, lines: ["This list is from the last full check, at 09:00. Nothing changed on the chart."] });
  });

  it("names the kind that did not come through, and the one that is current", () => {
    const t = readTrouble({ lastReadAt: at(14, 5), reads: { circles: "whole", roles: "failed" }, lastWholeAt: { circles: at(14, 5), roles: at(9) } }, now);
    expect(t?.noAnswer).toBe(false);
    expect(t?.lines).toEqual(["Roles didn't come through at 14:05, so roles show the 09:00 check.", "Circles are current."]);
  });

  it("says nothing when the read was whole", () => {
    expect(readTrouble({ lastReadAt: at(14), reads: { circles: "whole", roles: "whole" } }, now)).toBeNull();
  });
});

describe("the merged diff (R33)", () => {
  const here = "Keeps the village's water running: the pumps, the tanks and the lines from the spring, so every house has water every day.";
  const sera = "Keeps the village's water running: the pumps, the storage tanks, the filters and the lines from the spring, so every house has clean water every day.";

  it("strikes what is only here and underlines what is only in theirs, in one text", () => {
    const parts = mergedDiff(here, sera);
    const only = (side: string) => parts.filter((p) => p.side === side).map((p) => p.text);
    expect(only("sera").join(" ")).toContain("clean");
    expect(only("sera").join(" ")).toContain("filters");
    // Reading the struck and the shared words gives our text back, and the
    // underlined and the shared give theirs: one diff, nothing lost.
    const ours = parts.filter((p) => p.side !== "sera").map((p) => p.text).join(" ");
    const theirs = parts.filter((p) => p.side !== "here").map((p) => p.text).join(" ");
    expect(ours).toBe(here);
    expect(theirs).toBe(sera);
  });

  it("puts each change's struck words before its underlined ones", () => {
    expect(mergedDiff("the old way", "the new way")).toEqual([
      { text: "the", side: "both" },
      { text: "old", side: "here" },
      { text: "new", side: "sera" },
      { text: "way", side: "both" },
    ]);
  });

  it("treats words nobody had as wholly the other side's", () => {
    expect(mergedDiff("", "Fresh words")).toEqual([{ text: "Fresh words", side: "sera" }]);
  });
});

describe("reading the answers", () => {
  it("refuses a body meant for another read", () => {
    expect(readCount({ batches: [], counts: { proposals: 0 } })).toBeNull();
    expect(readList({ batches: [] })).toBeNull();
  });

  it("keeps only an https link to the service's page, and drops a row with no words", () => {
    const good = listed();
    const out = readList({
      agent: "Sera",
      lastReadAt: null,
      lastReadWhole: false,
      reads: null,
      count: { total: 1, lanes: { facts: 0, lowRisk: 0, decision: 1 }, conflicts: 0, checkFirst: 0, oursAhead: 0 },
      differences: [{ ...good, words: { ...good.words, open: "javascript:alert(1)" } }, { ...good, key: "x", words: { sentence: "" } }],
    });
    expect(out?.differences).toHaveLength(1);
    expect(out?.differences[0].words.open).toBeNull();
  });
});
