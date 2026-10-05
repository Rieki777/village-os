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
    title: "Read a decision",
    todo: "Open the quiet-hours thread and read it to the end, including who paid.",
    teaches: "A decision is a thread with its outcome written on it, so the reasons outlive the meeting.",
    href: "/forum/ex-thread-decision",
    cta: "Open the thread",
  },
  {
    id: "see-announcement",
    needs: ["forum"],
    title: "Find the pinned post",
    todo: "In Projects and Work, one announcement stays on top until someone unpins it.",
    teaches: "Only a role can post an announcement, so the top stays for news everyone needs.",
    href: "/forum?category=projects",
    cta: "Open Projects and Work",
  },
  {
    id: "try-to-buy",
    needs: ["exchange"],
    title: "Try to buy Example Credits",
    todo: "Tap Buy on the Exchange and read the answer.",
    teaches: "Examples can't take real money, and they say so right where you tap.",
    href: "/tokens",
    cta: "Open the Exchange",
  },
  {
    id: "open-steward",
    needs: ["badges"],
    title: "Read what a badge grants",
    todo: "Open Village Steward and read its three powers, and who holds it until when.",
    teaches: "Powers travel with a badge and leave with it.",
    href: "/badges",
    cta: "Open the badges",
  },
  {
    id: "find-open-seat",
    needs: ["map"],
    title: "Find an open role",
    todo: "On the map, a dashed circle is an open role. Click one.",
    teaches: "Every gap on the map is an invitation.",
    href: "/map",
    cta: "Open the map",
  },
  {
    id: "read-the-shelf",
    needs: ["library"],
    title: "Spot an item out on loan",
    todo: "In the library, the item out on loan has no Borrow button.",
    teaches: "The shelf keeps track of every loan for you.",
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
