import { describe, expect, it } from "vitest";
import { CONDITION_KEYS, JOURNEY_TRIGGERS, STOP_KEYS } from "../contracts";
import { EMAIL_KINDS } from "../kinds";
import { DEFAULT_JOURNEYS, DEFAULT_JOURNEYS_BY_KEY, defaultJourney, pathJourney } from "./journeys";
import { DEFAULT_PATH_IDS, DEFAULT_TEMPLATES, DEFAULT_TEMPLATES_BY_KEY, defaultTemplate } from "./templates";

/**
 * The default words and the default journeys are the behaviour every village
 * inherits, so the keys and the numbers are pinned against the spec itself
 * (docs/comms/BUILD_SPEC.md 5.5, 5.6 and 5.11) rather than against a copy of
 * this file's own output.
 */

/** 5.5, written out by hand from the spec. A key the spec names and the registry lacks fails here. */
const SPEC_TEMPLATE_KEYS = [
  "gathering.confirm", "gathering.guest_confirm", "gathering.reminder_day", "gathering.reminder_soon",
  "gathering.changed", "gathering.cancelled", "gathering.waitlisted", "gathering.promoted",
  "gathering.host_nudge", "gathering.recap_came", "gathering.recap_missed",
  "poll.invite", "poll.locked", "poll.moved",
  ...["resident", "investor", "steward", "prosperity-creator"].flatMap((p) =>
    ["welcome", "first_step", "meet_us", "stories", "check_in"].map((s) => `path.${p}.${s}`),
  ),
  "member.welcome.day0", "member.welcome.first_quest", "member.welcome.meet_us", "member.welcome.check_in",
  "joining.received", "joining.meet_us", "joining.check_in",
  "letters.confirm", "letter.layout",
];

const DAY = 1440;

describe("the default templates", () => {
  it("hold exactly the keys the spec names, each once, each at version 1", () => {
    const keys = DEFAULT_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size, "a key appears twice").toBe(keys.length);
    expect([...keys].sort()).toEqual([...SPEC_TEMPLATE_KEYS].sort());
    for (const t of DEFAULT_TEMPLATES) expect(t.version, t.key).toBe(1);
  });

  it("give every template a subject and a body, and only well-formed merge tokens", () => {
    for (const t of DEFAULT_TEMPLATES) {
      expect(t.subject.trim(), t.key).not.toBe("");
      expect(t.bodyMd.trim(), t.key).not.toBe("");
      const text = `${t.subject}\n${t.bodyMd}`;
      // Every `{{` opens a token of dotted lowercase words and closes.
      const opens = text.split("{{").length - 1;
      const tokens = text.match(/\{\{[a-z][a-zA-Z]*(\.[a-z][a-zA-Z]*)+\}\}/g) ?? [];
      expect(tokens.length, `${t.key} has a malformed merge token`).toBe(opens);
    }
  });

  it("answers a known key and refuses an unknown one", () => {
    expect(defaultTemplate("gathering.confirm")?.subject).toContain("{{gathering.title}}");
    expect(defaultTemplate("no.such.template")).toBeNull();
    expect(Object.keys(DEFAULT_TEMPLATES_BY_KEY)).toHaveLength(DEFAULT_TEMPLATES.length);
  });
});

describe("the default journeys", () => {
  it("are the five the spec names, with one journey per default path", () => {
    expect(DEFAULT_JOURNEYS.map((j) => j.key)).toEqual([
      "gathering.going",
      "gathering.host",
      "member.welcome",
      "joining.request",
      ...DEFAULT_PATH_IDS.map((p) => `path.${p}`),
    ]);
    expect(Object.keys(DEFAULT_JOURNEYS_BY_KEY)).toHaveLength(DEFAULT_JOURNEYS.length);
  });

  it("name only templates that exist, and only keys the vocabulary knows", () => {
    for (const j of DEFAULT_JOURNEYS) {
      expect(JOURNEY_TRIGGERS, j.key).toContain(j.trigger);
      for (const t of j.alsoOn ?? []) expect(JOURNEY_TRIGGERS, j.key).toContain(t);
      expect(EMAIL_KINDS, j.key).toContain(j.emailKind);
      expect(j.version, j.key).toBe(1);
      for (const s of j.stops) expect(STOP_KEYS, `${j.key} stop`).toContain(s);
      const stepKeys = j.steps.map((s) => s.key);
      expect(new Set(stepKeys).size, `${j.key} repeats a step key`).toBe(stepKeys.length);
      for (const s of j.steps) {
        expect(DEFAULT_TEMPLATES_BY_KEY[s.templateKey], `${j.key}.${s.key} names ${s.templateKey}`).toBeTruthy();
        for (const c of s.skipIf) expect(CONDITION_KEYS, `${j.key}.${s.key}`).toContain(c);
        expect(s.maxLateMinutes, `${j.key}.${s.key}`).toBeGreaterThan(0);
      }
      // Every journey ends for somebody who said no or whose address stopped working.
      expect(j.stops, j.key).toEqual(expect.arrayContaining(["unsubscribed", "suppressed"]));
    }
  });

  it("confirm a yes at once, then remind a day and two hours before, and wait while the time is voted", () => {
    const going = defaultJourney("gathering.going")!;
    expect(going.trigger).toBe("rsvp_going");
    expect(going.alsoOn).toEqual(["guest_confirmed"]);
    expect(going.emailKind).toBe("events");
    expect(going.steps.map((s) => [s.key, s.anchor, s.offsetMinutes, s.window])).toEqual([
      ["confirm", "enrolled", 0, "any"],
      ["day", "event_start", -DAY, "any"],
      ["soon", "event_start", -120, "any"],
    ]);
    expect(going.steps[0].urgent).toBe(true);
    for (const s of going.steps) expect(s.skipIf, s.key).toContain("time_still_being_voted");
    expect(going.steps[1].skipIf).toContain("signed_up_within_36_hours");
    expect(going.stops).toEqual(expect.arrayContaining(["withdrew", "gathering_cancelled", "gathering_removed"]));
  });

  it("nudge the host an hour after the end, unless there is nothing to write about", () => {
    const host = defaultJourney("gathering.host")!;
    expect(host.trigger).toBe("gathering_published");
    expect(host.steps).toHaveLength(1);
    expect(host.steps[0]).toMatchObject({ anchor: "event_end", offsetMinutes: 60, templateKey: "gathering.host_nudge" });
    expect(host.steps[0].skipIf).toEqual(["recap_already_sent", "nobody_answered"]);
  });

  it("welcome a member on day 0, 3, 7 and 14, and a join request on day 0, 5 and 14, in daytime", () => {
    const days = (key: string) => defaultJourney(key)!.steps.map((s) => s.offsetMinutes / DAY);
    expect(days("member.welcome")).toEqual([0, 3, 7, 14]);
    expect(days("joining.request")).toEqual([0, 5, 14]);
    for (const key of ["member.welcome", "joining.request"]) {
      for (const s of defaultJourney(key)!.steps) {
        expect(s.window, `${key}.${s.key}`).toBe("daytime");
        expect(s.anchor).toBe("enrolled");
        expect(s.catchUp).toBe("latest");
        // Longer than the widest night quiet hours can hold, or a morning
        // deferral would read as lateness and skip the step.
        expect(s.maxLateMinutes).toBeGreaterThan(12 * 60);
      }
    }
    expect(defaultJourney("joining.request")!.stops).toEqual(
      expect.arrayContaining(["joining_admitted", "joining_declined"]),
    );
  });

  it("walk every path on day 0, 2, 5, 10 and 21, skipping the first step once it is done", () => {
    for (const p of DEFAULT_PATH_IDS) {
      const j = defaultJourney(`path.${p}`)!;
      expect(j.trigger).toBe("path_joined");
      expect(j.steps.map((s) => [s.key, s.offsetMinutes / DAY])).toEqual([
        ["welcome", 0], ["first_step", 2], ["meet_us", 5], ["stories", 10], ["check_in", 21],
      ]);
      expect(j.steps[1].skipIf.some((c) => c.endsWith("_first_step_done")), p).toBe(true);
      expect(j.steps[2].skipIf, p).toContain("going_to_next_gathering");
      expect(j.stops, p).toContain("left_path");
      // Each default path has a goal that ends it.
      expect(j.stops.length, `${p} has no goal`).toBe(4);
    }
  });

  it("hold the investor path to its welcome and its hand-off until the words are reviewed", () => {
    const steps = defaultJourney("path.investor")!.steps;
    const held = steps.filter((s) => s.skipIf.includes("investor_words_unreviewed")).map((s) => s.key);
    expect(held).toEqual(["first_step", "meet_us", "stories"]);
    for (const p of DEFAULT_PATH_IDS.filter((x) => x !== "investor")) {
      for (const s of defaultJourney(`path.${p}`)!.steps) expect(s.skipIf, `${p}.${s.key}`).not.toContain("investor_words_unreviewed");
    }
  });

  it("gives a path a fork adds the same five emails, with no goal it cannot measure", () => {
    const j = pathJourney("beekeeper");
    expect(j.key).toBe("path.beekeeper");
    expect(j.steps.map((s) => s.templateKey)).toEqual([
      "path.beekeeper.welcome", "path.beekeeper.first_step", "path.beekeeper.meet_us",
      "path.beekeeper.stories", "path.beekeeper.check_in",
    ]);
    expect(j.stops).toEqual(["left_path", "unsubscribed", "suppressed"]);
  });
});
