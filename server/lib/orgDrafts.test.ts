/**
 * The vision block (0083, P1, N2): objectives with a metric and a target,
 * progress derived on read, and the rule the whole feature hangs on: meeting
 * every objective PROMPTS a human, it never applies the draft.
 */
import { describe, expect, it } from "vitest";
import {
  neutralObjectiveText,
  tierDraftWords,
  visionMetricKnown,
  visionProblem,
  visionProgress,
  type VisionBlock,
} from "./orgDrafts";

const vision = (over: Partial<VisionBlock> = {}): VisionBlock => ({
  objectives: [
    { text: "Every seat in the kitchen held", metric: "seats_filled_in:kitchen", target: 3, current: null, source: "measured", done: false },
    { text: "The council has met and said yes", metric: null, target: null, current: null, source: "declared", done: false },
  ],
  trigger: { all_objectives_done: true },
  ...over,
});

describe("what a vision may say", () => {
  it("accepts the two-objective shape the brief draws", () => {
    expect(visionProblem(vision())).toBeNull();
  });

  it("accepts clearing the block entirely", () => {
    expect(visionProblem(null)).toBeNull();
    expect(visionProblem(undefined)).toBeNull();
  });

  it("needs at least one objective, or it can never be met", () => {
    expect(visionProblem(vision({ objectives: [] }))).toContain("at least one");
  });

  it("refuses a metric the platform cannot count, by name", () => {
    const v = vision();
    v.objectives[0] = { ...v.objectives[0], metric: "vibes_per_moon" };
    expect(visionProblem(v)).toContain("vibes_per_moon");
  });

  it("knows the four measured families and nothing else", () => {
    expect(visionMetricKnown("seats_filled")).toBe(true);
    expect(visionMetricKnown("seats_filled_in:kitchen")).toBe(true);
    expect(visionMetricKnown("members_at_stage:member")).toBe(true);
    expect(visionMetricKnown("seasons_completed")).toBe(true);
    expect(visionMetricKnown("seats_filled_in:")).toBe(false);
    expect(visionMetricKnown("revenue")).toBe(false);
  });

  it("needs a target above zero on a measured objective", () => {
    const v = vision();
    v.objectives[0] = { ...v.objectives[0], target: 0 };
    expect(visionProblem(v)).toContain("target above zero");
  });

  it("needs text on every objective and the one v1 trigger", () => {
    const noText = vision();
    noText.objectives[1] = { ...noText.objectives[1], text: "  " };
    expect(visionProblem(noText)).toContain("its own text");
    expect(visionProblem({ objectives: vision().objectives })).toContain("trigger");
    expect(visionProblem({ objectives: vision().objectives, trigger: { all_objectives_done: false } }))
      .toContain("all_objectives_done");
  });
});

describe("where a vision stands", () => {
  const measures: Record<string, number> = {
    "seats_filled_in:kitchen": 3,
    seats_filled: 12,
  };
  const measure = (m: string) => (m in measures ? measures[m] : null);

  it("derives measured objectives from the measurement, never the stored tick", () => {
    const p = visionProgress(vision(), measure);
    expect(p.objectives[0].done).toBe(true);
    expect(p.objectives[0].current).toBe(3);
    // The declared one keeps its human tick.
    expect(p.objectives[1].done).toBe(false);
    expect(p.allDone).toBe(false);
    expect(p.done).toBe(1);
    expect(p.total).toBe(2);
  });

  it("meets only when every objective is done", () => {
    const v = vision();
    v.objectives[1] = { ...v.objectives[1], done: true };
    expect(visionProgress(v, measure).allDone).toBe(true);
  });

  it("can UN-meet when seats empty out, so the prompt says what is true today", () => {
    const v = vision();
    v.objectives[0] = { ...v.objectives[0], done: true, current: 3 };
    v.objectives[1] = { ...v.objectives[1], done: true };
    const p = visionProgress(v, () => 1);
    expect(p.objectives[0].done).toBe(false);
    expect(p.allDone).toBe(false);
  });

  it("keeps the stored reading when the metric cannot be measured right now", () => {
    const v = vision();
    v.objectives[0] = { ...v.objectives[0], current: 2 };
    const p = visionProgress(v, () => null);
    expect(p.objectives[0].current).toBe(2);
    expect(p.objectives[0].done).toBe(false);
  });

  it("returns a NEW block and never mutates the stored one", () => {
    const v = vision();
    const before = JSON.stringify(v);
    visionProgress(v, measure);
    expect(JSON.stringify(v)).toBe(before);
  });
});

/*
 * WHO MAY READ THE WORDS ON A DRAFT.
 *
 * `/api/org/vision` answers ANONYMOUS callers whenever `map.public_structure`
 * is on. It tiered the holder NAME behind `map.viewPeople` and then published
 * the sentences next to it: the draft title, its rationale, and every
 * objective in the village's own words.
 *
 * Survivable only while nothing but an admin could draft. The org editor opens
 * drafting to any member, and the first "Move Sarah out of Finance, she keeps
 * missing meetings" is then a signed-out stranger's to read and to cache.
 */
describe("the words on a draft, and who gets them", () => {
  const objectives = [
    { text: "Every seat in the kitchen held", metric: "seats_filled_in:kitchen" },
    { text: "Sarah agrees to step back", metric: null },
  ];
  const draft = { title: "Move Sarah out of Finance", rationale: "She keeps missing meetings" };

  it("gives a member every word, because that is village life", () => {
    const w = tierDraftWords(true, draft, objectives);
    expect(w.title).toBe("Move Sarah out of Finance");
    expect(w.rationale).toBe("She keeps missing meetings");
    expect(w.objectives[1].text).toBe("Sarah agrees to step back");
  });

  it("gives a stranger the SHAPE and none of the sentences", () => {
    const w = tierDraftWords(false, draft, objectives);
    expect(w.title).not.toContain("Sarah");
    expect(w.rationale).toBeNull();
    for (const o of w.objectives) expect(o.text).not.toContain("Sarah");
  });

  it("still says something true below the tier, from platform vocabulary", () => {
    // Blanking the line would make the panel useless to a visitor. The
    // fallback is the METRIC, which the platform owns; the village never
    // typed it, so it can carry no name.
    const w = tierDraftWords(false, draft, objectives);
    expect(w.objectives[0].text).toBe("Seats filled in a circle");
    expect(w.objectives[1].text).toBe("An objective the village has set");
  });

  it("names every metric family it knows, and degrades for one it does not", () => {
    expect(neutralObjectiveText("seats_filled")).toBe("Seats filled");
    expect(neutralObjectiveText("seasons_completed")).toBe("Seasons completed");
    expect(neutralObjectiveText("members_at_stage:steward")).toBe("Members at a stage");
    // A metric added later must not fall through to a village's own words.
    expect(neutralObjectiveText("something_new:x")).toBe("An objective the village is measuring");
  });

  it("does not mutate the objectives it was handed", () => {
    // The route reuses `progress.objectives`, so a tiering that wrote through
    // would leak the neutral text back into a member's own view.
    const mine = [{ text: "Sarah agrees to step back", metric: null }];
    tierDraftWords(false, draft, mine);
    expect(mine[0].text).toBe("Sarah agrees to step back");
  });
});
