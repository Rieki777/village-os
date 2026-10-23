/**
 * What the four journey pages share once their words are resolved: where a
 * button goes, the words only a page can fill, and a step's points.
 *
 * The specs live in shared/pageContent/journeys.ts. Each page keeps its own
 * look; this file only answers questions about the words.
 */
import { fillVars } from "@shared/pageContent/resolve";
import { JOURNEY_TARGETS } from "@shared/pageContent/journeys";
import type { PageVars, ResolvedItem, ResolvedPage } from "@shared/pageContent/types";

/** Where one button goes, once its shortcut is read. Null draws no button. */
export type JourneyAction =
  | { kind: "route"; href: string }
  | { kind: "anchor"; href: string }
  | { kind: "external"; href: string }
  | { kind: "mail"; href: string }
  | { kind: "form"; form: string };

export interface TargetContext {
  /** The village's Events page URL, or blank. */
  eventsUrl: string;
  /** A mailto for the village's contact address with this subject, or blank. */
  mailTo: (subject: string) => string;
  /** The subject a `#contact` button writes. */
  subject: string;
  /** The `#name` forms this page can open. */
  forms?: readonly string[];
}

/**
 * Read a "goes to" box. Blank, or a shortcut whose setting is blank, is null:
 * no button rather than a button to nowhere, which is what the four `#`
 * buttons on /resident were.
 */
export function resolveTarget(raw: string | undefined, ctx: TargetContext): JourneyAction | null {
  const target = (raw ?? "").trim();
  if (!target || target === "#") return null;
  if (target === JOURNEY_TARGETS.events) return ctx.eventsUrl ? { kind: "external", href: ctx.eventsUrl } : null;
  if (target === JOURNEY_TARGETS.contact) {
    const href = ctx.mailTo(ctx.subject);
    return href ? { kind: "mail", href } : null;
  }
  if (target.startsWith("#")) {
    const name = target.slice(1);
    if (target === JOURNEY_TARGETS.packForm || target === JOURNEY_TARGETS.callForm) {
      return ctx.forms?.includes(name) ? { kind: "form", form: name } : null;
    }
    return { kind: "anchor", href: target };
  }
  if (/^mailto:/i.test(target)) return { kind: "mail", href: target };
  if (/^https?:\/\//i.test(target)) return { kind: "external", href: target };
  if (target.startsWith("/") && !target.startsWith("//")) return { kind: "route", href: target };
  return null;
}

/** A button's words and where it goes, or null when either is missing. */
export function buttonAction(label: string | undefined, raw: string | undefined, ctx: TargetContext): { label: string; action: JourneyAction } | null {
  const words = (label ?? "").trim();
  if (!words) return null;
  const action = resolveTarget(raw, { ...ctx, subject: ctx.subject || words });
  return action ? { label: words, action } : null;
}

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];

/** "seven" for 7, so "Follow these {count} steps" follows the list. */
export function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/**
 * Fill the words only this page knows ({count}, {range}, {guide}...) into
 * every field and row. Runs after the village's own words, so a word the page
 * has no value for stays visible as typed, the same honest failure
 * `fillVars` gives.
 */
export function withPageWords(page: ResolvedPage, words: PageVars): ResolvedPage {
  const out: Record<string, ResolvedPage[string]> = {};
  for (const [id, section] of Object.entries(page)) {
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(section.fields)) fields[k] = fillVars(v, words);
    const lists: Record<string, ResolvedItem[]> = {};
    for (const [k, rows] of Object.entries(section.lists)) {
      lists[k] = rows.map((row) => {
        const item: Record<string, string> = {};
        for (const [fk, fv] of Object.entries(row)) item[fk] = fk === "id" ? fv : fillVars(fv, words);
        return item;
      });
    }
    out[id] = { hidden: section.hidden, fields, lists };
  }
  return out;
}

/** A step's points, blanks left out. */
export function stepPoints(step: ResolvedItem): string[] {
  return [step.bullet1, step.bullet2, step.bullet3, step.bullet4].filter((p): p is string => !!p && p.trim() !== "");
}

/** A whole number from 0 to 100 from a founder's box; anything else is 0. */
export function percent(raw: string | undefined): number {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
}
