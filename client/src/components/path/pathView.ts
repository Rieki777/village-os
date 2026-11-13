/**
 * What the path's surfaces share: the chapters of the walk, and the
 * companion's one line for the step (the Root). Pure, so the strip, the card
 * and the whole-path page cannot draw three different walks.
 */
import { companionLine, type CompanionLine } from "@shared/companionLine";
import { MILESTONE_CHAPTER, PATH_CHAPTERS, PATH_MILESTONES, companionStepFor, type PathAnswer, type PathChapter, type PathMilestone } from "@shared/yourPath";

export type StopState = "walked" | "now" | "ahead";

export interface ChapterView {
  chapter: PathChapter;
  state: StopState;
  milestones: Array<{ milestone: PathMilestone; walked: boolean }>;
}

/**
 * The chapters in order. A chapter is walked once every milestone in it is;
 * the first one that is not is where the reader stands now. Somebody who has
 * walked none of a chapter's milestones and none after it has that chapter
 * ahead of them.
 */
export function chaptersOf(walked: readonly PathMilestone[]): ChapterView[] {
  const has = new Set(walked);
  let nowSeen = false;
  return PATH_CHAPTERS.map((chapter) => {
    const milestones = PATH_MILESTONES.filter((m) => MILESTONE_CHAPTER[m] === chapter).map((milestone) => ({ milestone, walked: has.has(milestone) }));
    const done = milestones.every((m) => m.walked);
    const state: StopState = done ? "walked" : nowSeen ? "ahead" : "now";
    if (!done) nowSeen = true;
    return { chapter, state, milestones };
  });
}

/** The Seed of Life's numbers: one circle per milestone, the walked ones closed. */
export function seedOf(a: Pick<PathAnswer, "walked">): { total: number; walked: number } {
  return { total: PATH_MILESTONES.length, walked: a.walked.length };
}

const SHOWN_KEY = "village.path.companion.screens";

/** How many OTHER screens of this visit already showed a visitor the companion's line. */
function visitorScreens(here: string): number {
  try {
    const seen: string[] = JSON.parse(window.sessionStorage.getItem(SHOWN_KEY) ?? "[]");
    return Array.isArray(seen) ? seen.filter((p) => p !== here).length : 0;
  } catch {
    return 0;
  }
}

/** Remember that this screen showed a visitor the line, so the fourth screen of a visit stays quiet. */
export function noteVisitorScreen(here: string): void {
  try {
    const seen: string[] = JSON.parse(window.sessionStorage.getItem(SHOWN_KEY) ?? "[]");
    const list = Array.isArray(seen) ? seen : [];
    if (!list.includes(here)) window.sessionStorage.setItem(SHOWN_KEY, JSON.stringify([...list, here].slice(-12)));
  } catch {
    /* private browsing: the limit simply does not hold across screens */
  }
}

/** The companion's line for the path's step, or null where it has none to say. */
export function companionFor(a: Pick<PathAnswer, "state" | "fresh">, o: { locale: string; visitor: boolean; here: string; heading?: string | null; commitment?: string | null }): CompanionLine | null {
  return companionLine({
    step: companionStepFor(a.state),
    locale: o.locale,
    isNew: a.fresh,
    visitor: o.visitor,
    shownThisVisit: o.visitor ? visitorScreens(o.here) : 0,
    heading: o.heading,
    commitment: o.commitment,
  });
}
