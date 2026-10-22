/**
 * A ROLE'S HEALTH AND ITS HANDOVER, in words. Pure, and node-tested
 * (`playerCardHealth.test.ts`).
 *
 * HEALTH is three facts and one dot, never a score: whether the holding is
 * within its term; whether a review date is set and where it stands; and
 * whether the role's signs are on track, which is said only for a sign that
 * names both what counts it (`countedBy`) and a number to reach
 * (`targetCount`). Anything else is "No target set". The dot is the worst of
 * the three, and it carries its own words for a reader who cannot see colour.
 *
 * HANDOVER is the four checks Rye approved, read as "2 of 4 ready" and never
 * as a percentage:
 *   1. Card complete: `handoverChecks(role).cardComplete` (shared/roleHandover.ts),
 *      with the five card parts listed under it as detail.
 *   2. Runbook written: `handoverChecks(role).runbook`.
 *   3. Decisions recorded in the role's circle over the last three moons.
 *   4. Someone ready to step in: a second holder, or a deputy or successor
 *      written down as a covering relation (`coveredSeatIds`).
 * The first two come from the shared contract, so the card and the org chart
 * cannot count a role's words two ways. A check whose input was not read
 * says "Not counted yet".
 *
 * A fact whose input was not read is left out, never guessed: a stranger who
 * may not read a role's terms sees no review fact and no sign fact.
 */
import { formatDay, type Read } from "./roleSheet";
import type { SignOut, Slot } from "./playerCard";
import type { SeatSettings } from "./seatSettings";
import { HANDOVER_CARD_KEYS, HANDOVER_CHECK_WORDS, handoverChecks, type HandoverCardKey } from "./roleHandover";

export type HealthDot = "steady" | "look" | "act";

export interface HealthFact {
  key: "term" | "review" | "signs";
  words: string;
  dot: HealthDot;
}

export interface HealthOut {
  facts: HealthFact[];
  dot: HealthDot;
  /** The dot, said in words. */
  dotWords: string;
}

/** One of the five card parts, under "Card complete". */
export interface HandoverPart {
  key: HandoverCardKey;
  done: boolean;
  /** HANDOVER_CHECK_WORDS: the done words or the missing words. */
  words: string;
}

export interface HandoverCheck {
  key: "card" | "runbook" | "decisions" | "stepIn";
  label: string;
  state: "ready" | "not-yet" | "not-counted";
  words: string;
  /** The card check only: each of the five parts, in card order. */
  parts?: HandoverPart[];
}

export interface HandoverOut {
  heading: string;
  checks: HandoverCheck[];
  /** "2 of 4 ready". */
  summary: string;
  ready: { n: number; source: string };
  of: { n: number; source: string };
}

export const HEALTH_WORDS = {
  withinTerm: (day: string) => `Within term, to ${day}`,
  termEnded: (day: string) => `Term ended ${day}`,
  noTerm: "No term set",
  reviewDue: (day: string) => `Review due ${day}`,
  reviewPassed: (day: string) => `Review date passed ${day}`,
  noReview: "No review date set",
  signsOnTrack: "Signs on track",
  someOnTrack: (n: number, of: number) => `${n} of ${of} signs on track`,
  noTarget: "No target set",
  notCountedYet: "Not counted yet",
  dot: { steady: "Steady", look: "Worth a look", act: "Needs attention" } as Record<HealthDot, string>,
  handover: "Ready to hand over",
  readyOf: (n: number, of: number) => `${n} of ${of} ready`,
  card: "Card complete",
  partsWritten: (n: number, of: number, missing: string) =>
    missing ? `${n} of ${of} parts written: ${missing} missing` : `All ${of} parts written`,
  runbook: "Runbook written",
  decisions: "Decisions recorded in the circle, last 3 moons",
  decisionsN: (n: number) => (n === 1 ? "1 decision recorded" : `${n} decisions recorded`),
  noCircle: "The role sits in no circle",
  stepIn: "Someone ready to step in",
  secondHolder: "A second holder holds it too",
  covered: "A deputy or successor is written down",
  nobodyYet: "Nobody named yet",
} as const;

const RANK: Record<HealthDot, number> = { steady: 0, look: 1, act: 2 };
const worst = (a: HealthDot, b: HealthDot): HealthDot => (RANK[b] > RANK[a] ? b : a);

const instant = (iso: string | null | undefined): number | null => {
  const s = String(iso ?? "").trim();
  if (!s) return null;
  const civil = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00Z` : s;
  const t = new Date(civil).getTime();
  return Number.isNaN(t) ? null : t;
};

export interface HealthIn {
  termEndsAt: Read<string | null>;
  settings: Read<SeatSettings | null>;
}

/** Three facts and a dot. Null when nothing about the role could be read. */
export function roleHealth(role: HealthIn, signs: Slot<SignOut[]>, now: Date, timeZone: string): HealthOut | null {
  const facts: HealthFact[] = [];
  const at = now.getTime();
  const day = (iso: string) => formatDay(iso, true, timeZone) ?? iso;

  if (role.termEndsAt !== undefined) {
    const t = instant(role.termEndsAt);
    if (t === null) facts.push({ key: "term", words: HEALTH_WORDS.noTerm, dot: "look" });
    else if (t > at) facts.push({ key: "term", words: HEALTH_WORDS.withinTerm(day(role.termEndsAt!)), dot: "steady" });
    else facts.push({ key: "term", words: HEALTH_WORDS.termEnded(day(role.termEndsAt!)), dot: "act" });
  }

  if (role.settings !== undefined) {
    const reviewOn = role.settings?.term?.reviewOn ?? null;
    const t = instant(reviewOn);
    if (t === null) facts.push({ key: "review", words: HEALTH_WORDS.noReview, dot: "look" });
    else if (t >= at) facts.push({ key: "review", words: HEALTH_WORDS.reviewDue(day(reviewOn!)), dot: "steady" });
    else facts.push({ key: "review", words: HEALTH_WORDS.reviewPassed(day(reviewOn!)), dot: "act" });

    const targeted = (role.settings?.scoreboard?.measures ?? []).filter(
      (m) => m.countedBy !== undefined && m.targetCount !== undefined,
    );
    if (!targeted.length) facts.push({ key: "signs", words: HEALTH_WORDS.noTarget, dot: "look" });
    else {
      const shown = signs.kind === "shown" ? signs.value : [];
      const counted = shown.filter((s) => s.target !== null && s.reading.kind === "counted");
      if (!counted.length) facts.push({ key: "signs", words: HEALTH_WORDS.notCountedYet, dot: "look" });
      else {
        const on = counted.filter((s) => s.reading.kind === "counted" && s.reading.now.n >= s.target!.n).length;
        facts.push(
          on === counted.length
            ? { key: "signs", words: HEALTH_WORDS.signsOnTrack, dot: "steady" }
            : { key: "signs", words: HEALTH_WORDS.someOnTrack(on, counted.length), dot: "look" },
        );
      }
    }
  }

  if (!facts.length) return null;
  const dot = facts.reduce<HealthDot>((d, f) => worst(d, f.dot), "steady");
  return { facts, dot, dotWords: HEALTH_WORDS.dot[dot] };
}

/** What the meter reads about a role. Word field names match `/api/org`. */
export interface HandoverIn {
  aim: string | null;
  domain: string | null;
  accountabilities: string[];
  bringMe: Read<string[] | null>;
  notMine: Read<string[] | null>;
  runbook: Read<string | null>;
  circle: Read<{ id: string; name: string } | null>;
  /** Decisions recorded in the role's circle over the last three moons. */
  circleDecisions?: Read<number>;
  /** Live holders of the role, the owner included. */
  holderCount?: Read<number>;
  /** A deputy or successor relation covers the role (`coveredSeatIds`). */
  covered?: Read<boolean>;
}

/** The four checks. Never a percentage. */
export function roleHandover(role: HandoverIn): HandoverOut {
  const h = handoverChecks({
    aim: role.aim,
    domain: role.domain,
    accountabilities: role.accountabilities,
    bringMe: role.bringMe ?? null,
    notMine: role.notMine ?? null,
    runbook: role.runbook ?? null,
  });
  const checks: HandoverCheck[] = [];

  const parts: HandoverPart[] = HANDOVER_CARD_KEYS.map((key) => ({
    key,
    done: h[key],
    words: h[key] ? HANDOVER_CHECK_WORDS[key].done : HANDOVER_CHECK_WORDS[key].missing,
  }));
  const missing = parts.filter((p) => !p.done).map((p) => HANDOVER_CHECK_WORDS[p.key].label);
  checks.push({
    key: "card",
    label: HEALTH_WORDS.card,
    state: h.cardComplete ? "ready" : "not-yet",
    words: HEALTH_WORDS.partsWritten(parts.length - missing.length, parts.length, missing.join(", ")),
    parts,
  });

  checks.push({
    key: "runbook",
    label: HEALTH_WORDS.runbook,
    state: h.runbook ? "ready" : "not-yet",
    words: h.runbook ? HANDOVER_CHECK_WORDS.runbook.done : HANDOVER_CHECK_WORDS.runbook.missing,
  });

  if (role.circle === undefined || role.circleDecisions === undefined) {
    checks.push({ key: "decisions", label: HEALTH_WORDS.decisions, state: "not-counted", words: HEALTH_WORDS.notCountedYet });
  } else if (role.circle === null) {
    checks.push({ key: "decisions", label: HEALTH_WORDS.decisions, state: "not-yet", words: HEALTH_WORDS.noCircle });
  } else {
    const n = role.circleDecisions;
    checks.push({ key: "decisions", label: HEALTH_WORDS.decisions, state: n > 0 ? "ready" : "not-yet", words: HEALTH_WORDS.decisionsN(n) });
  }

  if (role.holderCount === undefined && role.covered === undefined) {
    checks.push({ key: "stepIn", label: HEALTH_WORDS.stepIn, state: "not-counted", words: HEALTH_WORDS.notCountedYet });
  } else if ((role.holderCount ?? 0) >= 2) {
    checks.push({ key: "stepIn", label: HEALTH_WORDS.stepIn, state: "ready", words: HEALTH_WORDS.secondHolder });
  } else if (role.covered === true) {
    checks.push({ key: "stepIn", label: HEALTH_WORDS.stepIn, state: "ready", words: HEALTH_WORDS.covered });
  } else {
    checks.push({ key: "stepIn", label: HEALTH_WORDS.stepIn, state: "not-yet", words: HEALTH_WORDS.nobodyYet });
  }

  const ready = checks.filter((c) => c.state === "ready").length;
  return {
    heading: HEALTH_WORDS.handover,
    checks,
    summary: HEALTH_WORDS.readyOf(ready, checks.length),
    ready: { n: ready, source: "handover.checks.state" },
    of: { n: checks.length, source: "handover.checks.length" },
  };
}
