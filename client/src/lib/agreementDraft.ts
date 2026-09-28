/**
 * ROW EDITS FOR THE CONFLICT AGREEMENT'S EDITOR, kept out of the canvas view.
 *
 * Everything under client/src/components/canvas is held by
 * client/src/lib/canvasCopy.test.ts to the canvas's number rule (R55): no
 * sifting and no sorting there, because sifting the blocks is how "7 blocks
 * read" gets counted and sorting them by level draws a league table. The
 * agreement editor lives in that directory, since block 8's Say frame mounts
 * it, and it edits rows of ONE document: steps, contacts, rungs, practices.
 * None of these touches a canvas block, a level or a count, and none of them
 * is ever shown as a number.
 */
import type { AgreementPractice, LadderRung, LadderRungNumber } from "@shared/conflictAgreement";

/** The list without its `index`th row. */
export function removeAt<T>(list: readonly T[], index: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < list.length; i++) if (i !== index) out.push(list[i]);
  return out;
}

/** Every role but one, for a picker that must not offer the care role twice. */
export function rolesOtherThan<R extends { id: string }>(roles: readonly R[], id: string): R[] {
  const out: R[] = [];
  for (const r of roles) if (r.id !== id) out.push(r);
  return out;
}

/** The outside contacts that carry a name, which are the ones a power clause may name. */
export function namedContacts<C extends { name: string }>(contacts: readonly C[]): C[] {
  const out: C[] = [];
  for (const c of contacts) if (c.name.trim()) out.push(c);
  return out;
}

/** The ladder with one rung's words set, in rung order, the order the page prints them. */
export function withRungWords(rungs: readonly LadderRung[], rung: LadderRungNumber, words: string): LadderRung[] {
  const out: LadderRung[] = [];
  for (const n of [1, 2, 3, 4] as LadderRungNumber[]) {
    if (n === rung) out.push({ rung, words });
    else {
      const kept = rungs.find((r) => r.rung === n);
      if (kept) out.push(kept);
    }
  }
  return out;
}

/** The offered practices a village has not added yet. */
export function ideasNotYetAdded<I extends { name: string }>(ideas: readonly I[], practices: readonly AgreementPractice[]): I[] {
  const out: I[] = [];
  for (const idea of ideas) if (!practices.some((p) => p.name === idea.name)) out.push(idea);
  return out;
}
