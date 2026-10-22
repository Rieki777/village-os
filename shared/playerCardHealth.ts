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
 * HANDOVER is the shared contract's six checks (`handoverChecks`,
 * shared/roleHandover.ts), read as "4 of 6 ready" and never as a percentage:
 * the five parts of the role card (purpose, what it decides, what people can
 * count on it for, "Bring me", "Not mine to hold") and the runbook. Each is a
 * fact: written or not. The same helper serves every reader of a role, so the
 * card and the org chart cannot count it two ways.
 *
 * A fact whose input was not read is left out, never guessed: a stranger who
 * may not read a role's terms sees no review fact and no sign fact.
 */
import { formatDay, type Read } from "./roleSheet";
import type { SignOut, Slot } from "./playerCard";
import type { SeatSettings } from "./seatSettings";
import { handoverChecks, type HandoverCheckKey } from "./roleHandover";

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

export interface HandoverCheck {
  key: HandoverCheckKey;
  label: string;
  state: "ready" | "not-yet";
  /** HANDOVER_CHECK_WORDS: the done words or the missing words. */
  words: string;
}

export interface HandoverOut {
  heading: string;
  checks: HandoverCheck[];
  /** "4 of 6 ready". */
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

/** A role's own words, as the meter reads them. Field names match `/api/org`. */
export interface HandoverIn {
  aim: string | null;
  domain: string | null;
  accountabilities: string[];
  bringMe: Read<string[] | null>;
  notMine: Read<string[] | null>;
  runbook: Read<string | null>;
}

/** The six checks of the shared contract, as a count. Never a percentage. */
export function roleHandover(role: HandoverIn): HandoverOut {
  const h = handoverChecks({
    aim: role.aim,
    domain: role.domain,
    accountabilities: role.accountabilities,
    bringMe: role.bringMe ?? null,
    notMine: role.notMine ?? null,
    runbook: role.runbook ?? null,
  });
  return {
    heading: HEALTH_WORDS.handover,
    checks: h.checks.map((c) => ({ key: c.key, label: c.label, state: c.done ? "ready" : "not-yet", words: c.words })),
    summary: HEALTH_WORDS.readyOf(h.done, h.total),
    ready: { n: h.done, source: "handoverChecks.done" },
    of: { n: h.total, source: "handoverChecks.total" },
  };
}
