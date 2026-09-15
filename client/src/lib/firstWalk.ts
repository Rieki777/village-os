/**
 * The first walk: what a founder should go and look at, in what order.
 *
 * The standing examples demonstrate every module, and they still wait to be
 * found. A founder who turns eleven modules on has eleven pages of worked
 * content and no reason to visit any of them. This is the reason: a short
 * list of specific things to go and see, each one a stop that teaches a rule
 * the platform runs on.
 *
 * Steps are DATA, mirroring shared/launchRequirements.ts, so the walk is one
 * array to read rather than a component to reverse-engineer. Each step names
 * the module it needs, so a village that never enabled the library is never
 * told to go and look at a shelf it does not have.
 *
 * Progress lives in localStorage, per browser and per person, like the
 * landing preference next door. It is a reading list, not a permission: no
 * server state, nothing to migrate, and a founder who clears their browser
 * loses nothing that matters.
 */

import { storedText, writeStored } from "./safeStorage";

export interface WalkStep {
  id: string;
  /** Modules that must ALL be showing examples for this stop to make sense. */
  needs: string[];
  title: string;
  /** What to do when you get there. */
  todo: string;
  /** The rule the stop teaches, in one line. */
  teaches: string;
  href: string;
  cta: string;
}

/**
 * Ordered from "read something" to "try something and be refused", because
 * the refusal only lands once you believe the content is real.
 */
export const WALK_STEPS: WalkStep[] = [
  {
    id: "read-decision",
    needs: ["forum"],
    title: "Read a decision the village already made",
    todo: "Open the quiet-hours thread and read to the end, including who paid for it.",
    teaches: "A decision is a thread with an outcome recorded on it, so the reasoning survives the meeting.",
    href: "/forum/ex-thread-decision",
    cta: "Open the thread",
  },
  {
    id: "see-announcement",
    needs: ["forum"],
    title: "See what sits at the top, and why",
    todo: "The pinned announcement in Projects and Work stays above everything until someone unpins it.",
    teaches: "Announcements need a role that carries them, which is how the top of a forum stays for things that concern everyone.",
    href: "/forum?category=projects",
    cta: "Open Projects and Work",
  },
  {
    id: "try-to-buy",
    needs: ["exchange"],
    title: "Try to buy something, and be refused",
    todo: "Tap Buy on Example Credits. Read what comes back.",
    teaches: "Every example is inert. Nothing here can take your money, and the refusal says so where you tapped.",
    href: "/tokens",
    cta: "Open Tokens",
  },
  {
    id: "open-steward",
    needs: ["badges"],
    title: "See what a badge actually grants",
    todo: "Find Village Steward and read the three powers it carries, and who holds it until when.",
    teaches: "Powers travel with a badge and leave with it, and a village can lend trust for a season.",
    href: "/badges",
    cta: "Open the badges",
  },
  {
    id: "find-open-seat",
    needs: ["map"],
    title: "Find a role nobody holds",
    todo: "The dashed circles on the map are open calls. Click one.",
    teaches: "The map shows the shape of the village and the gaps in it, so an open role is an invitation.",
    href: "/map",
    cta: "Open the map",
  },
  {
    id: "read-the-shelf",
    needs: ["library"],
    title: "Look at a shelf mid-use",
    todo: "One item is out on loan. Notice it has no Borrow button and the others do.",
    teaches: "The library tracks what is out without anyone filing a report, and a deposit is held while it travels.",
    href: "/library",
    cta: "Open the library",
  },
];

const DONE_KEY = "village.firstWalk.done";
const DISMISSED_KEY = "village.firstWalk.dismissed";

/**
 * Every accessor fails to "nothing done yet", which is the safe direction:
 * the worst case is a founder being offered the walk again. The reasoning
 * about a browser that refuses lives in `./safeStorage`, which this and two
 * other modules each used to hold a private copy of.
 */
function read(key: string): string | null {
  return storedText("local", key);
}

function write(key: string, value: string): void {
  /* private browsing: the walk simply never remembers */
  writeStored("local", key, value);
}

export function getDoneSteps(): string[] {
  const raw = read(DONE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function setStepDone(id: string, done: boolean): string[] {
  const next = done
    ? Array.from(new Set([...getDoneSteps(), id]))
    : getDoneSteps().filter((x) => x !== id);
  write(DONE_KEY, JSON.stringify(next));
  return next;
}

export function isWalkDismissed(): boolean {
  return read(DISMISSED_KEY) === "yes";
}

export function dismissWalk(): void {
  write(DISMISSED_KEY, "yes");
}

/**
 * Which steps apply, given what this village is actually showing.
 *
 * PURE, so it is testable without a DOM: the same reason chooseLanding next
 * door takes its inputs as plain values.
 */
export function applicableSteps(showing: string[]): WalkStep[] {
  return WALK_STEPS.filter((s) => s.needs.every((m) => showing.includes(m)));
}

/** Done, of applicable. Both zero when a village shows no examples at all. */
export function walkProgress(showing: string[], done: string[]): { done: number; total: number } {
  const steps = applicableSteps(showing);
  return { done: steps.filter((s) => done.includes(s.id)).length, total: steps.length };
}
