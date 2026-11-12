/**
 * OUR FIRST 14 DAYS, as days: the model under the strip on Profile Today.
 *
 * Pure, so the rules a person feels are held by tests with no page:
 *   - the strip is for someone newly seated: their OWN path, on day 1 to 14
 *     (`FIRST_DAYS`). A buddy or the onboarding role reading somebody else's
 *     path sees the list, never the strip;
 *   - each step sits on the day it is due, in the order the path holds it;
 *   - the next step is the earliest open one, whoever it waits on, so a
 *     welcome the onboarding role still owes is named as the next thing;
 *   - a step due after day 14 stays in the list under the strip, never on it.
 *
 * Nothing here counts a person: the strip shows steps (work) on days (time).
 */
/**
 * How many days the first stretch is: the same 14 as `FIRST_DAYS` in
 * shared/roleStartWords.ts (fourteenDays.test.ts holds the two together). Not
 * imported from there, because that file pulls the seat-application rules
 * into the lazy onboarding chunk, and the extra weight regroups the boot chunks.
 */
export const FIRST_DAYS = 14;

export interface StripStep {
  key: string;
  title: string;
  dueDay: number;
  doneAt: string | null;
  owner: string;
  ownerName?: string;
  mayTick: boolean;
  doneWhen: string;
  link?: { label: string; href: string };
}

export interface StripPath {
  mine: boolean;
  day: number;
  openedOn: string;
  items: StripStep[];
}

export interface StripDay {
  /** 1 to 14. */
  day: number;
  /** The calendar date, YYYY-MM-DD. */
  date: string;
  steps: StripStep[];
  today: boolean;
  past: boolean;
}

export interface Strip {
  days: StripDay[];
  next: StripStep | null;
  /** True when every step on the strip is done: the fern. */
  whole: boolean;
  /** The day the strip opens on: the next step's day, or today. */
  focus: number;
}

/** True while this path is the reader's own and inside its first fourteen days. */
export const showsStrip = (p: Pick<StripPath, "mine" | "day">): boolean => p.mine && p.day >= 1 && p.day <= FIRST_DAYS;

/** The calendar date of a path day: day 1 is the day it opened. */
export function dateOfDay(openedOn: string, day: number): string {
  const t = Date.parse(`${openedOn.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(t)) return openedOn.slice(0, 10);
  return new Date(t + (day - 1) * 86_400_000).toISOString().slice(0, 10);
}

/** The steps that live on the strip (due by day 14) and the ones that stay in the list. */
export function splitSteps<T extends Pick<StripStep, "dueDay">>(items: readonly T[]): { onStrip: T[]; later: T[] } {
  return { onStrip: items.filter((i) => i.dueDay <= FIRST_DAYS), later: items.filter((i) => i.dueDay > FIRST_DAYS) };
}

export function fourteenDays(p: StripPath): Strip {
  const { onStrip } = splitSteps(p.items);
  const days: StripDay[] = Array.from({ length: FIRST_DAYS }, (_, i) => {
    const day = i + 1;
    return { day, date: dateOfDay(p.openedOn, day), steps: onStrip.filter((s) => Math.max(1, s.dueDay) === day), today: day === p.day, past: day < p.day };
  });
  const open = onStrip.filter((s) => !s.doneAt);
  const next = open.reduce<StripStep | null>((best, s) => (best === null || s.dueDay < best.dueDay ? s : best), null);
  const whole = onStrip.length > 0 && open.length === 0;
  const focus = next ? Math.min(FIRST_DAYS, Math.max(1, next.dueDay)) : Math.min(FIRST_DAYS, Math.max(1, p.day));
  return { days, next, whole, focus };
}

/** The roving-focus move on the 2 x 7 grid: arrows step a day, up and down a week. */
export function moveDay(from: number, key: string): number | null {
  const to = key === "ArrowRight" ? from + 1 : key === "ArrowLeft" ? from - 1 : key === "ArrowDown" ? from + 7 : key === "ArrowUp" ? from - 7 : key === "Home" ? 1 : key === "End" ? FIRST_DAYS : null;
  if (to === null) return null;
  return Math.min(FIRST_DAYS, Math.max(1, to));
}
