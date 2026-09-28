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
import type { AgreementPractice, LadderRung, LadderRungNumber, OutsideContact } from "@shared/conflictAgreement";

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

/**
 * AN OUTSIDE CONTACT'S ID IS NEVER REUSED FOR ANOTHER PERSON (Wave 3a audit,
 * 2026-09-28).
 *
 * The ombuds door's record keeps the contact's id, and the members' card says
 * "the village has a note that you asked" wherever a member's asks carry the
 * same id. Ids were `oc-1`, `oc-2`, counted from the list on screen, so
 * removing the only contact and adding another handed the new person `oc-1`,
 * and every member who had asked the old one was told they had asked the new
 * one. A new id is now made from the clock, so it was never anybody's.
 */
export function freshContactId(taken: readonly string[], now: number = Date.now()): string {
  const base = `oc-${now.toString(36)}`;
  let id = base;
  for (let n = 1; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * The contacts as they are sent: a contact whose name or way of reaching them
 * changed since the agreement was loaded is a different person to the ombuds
 * door, so it goes with a fresh id, and the power clause follows it. Typing a
 * new person over an old row used to keep the old id, with the same false
 * "you asked" as above. A typo fixed in a name also takes a fresh id: the
 * members who asked see "Ask to talk" again, which is the safe mistake.
 */
export function contactsWithFreshIds<D extends { outsideContacts: OutsideContact[]; whenPowerInvolved: { outsideContactId: string } }>(
  draft: D,
  loaded: readonly OutsideContact[],
  now: number = Date.now(),
): D {
  const taken: string[] = [];
  for (const c of loaded) taken.push(c.id);
  for (const c of draft.outsideContacts) taken.push(c.id);
  const moved = new Map<string, string>();
  const outsideContacts: OutsideContact[] = [];
  for (const c of draft.outsideContacts) {
    const was = loaded.find((o) => o.id === c.id);
    if (!was || (was.name.trim() === c.name.trim() && was.howToReach.trim() === c.howToReach.trim())) {
      outsideContacts.push(c);
      continue;
    }
    const id = freshContactId(taken, now);
    taken.push(id);
    moved.set(c.id, id);
    outsideContacts.push({ ...c, id });
  }
  const powerId = moved.get(draft.whenPowerInvolved.outsideContactId);
  return {
    ...draft,
    outsideContacts,
    whenPowerInvolved: powerId ? { ...draft.whenPowerInvolved, outsideContactId: powerId } : draft.whenPowerInvolved,
  };
}
