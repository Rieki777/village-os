/**
 * WHAT THE BELL ITSELF ANSWERED, so a notice marked done still says so when
 * the panel is opened again.
 *
 * The bell's panel unmounts when it closes, and a notice answered with "It's
 * done" is still a single row, so without this the same unanswered button came
 * back and a member checking that it saved saw nothing to say it had. Here the
 * bell keeps, for the one signed-in member, the card each "It's done" handed
 * back. "Open it again" takes it out.
 *
 * NEVER ACROSS MEMBERS. Every read and write names the member it is for. A
 * different member, or nobody (signed out), empties the whole store before
 * anything is read or kept, so one member's answers can never show on the next
 * member's bell in the same browser. Nothing is written to storage: a reload
 * starts empty, and the board is the record.
 */
import type { TaskCard } from "@shared/sessionTasks";

let owner: string | null = null;
const answered = new Map<number, TaskCard>();

/** Make the store belong to `who`, emptying it if it held anyone else's. */
function claim(who: string | null | undefined): string | null {
  const me = who ? String(who) : null;
  if (me !== owner) {
    answered.clear();
    owner = me;
  }
  return me;
}

/** The card the bell's own "It's done" handed back for this task, or null. */
export function bellAnswerFor(who: string | null | undefined, entryId: number): TaskCard | null {
  if (!claim(who)) return null;
  return answered.get(entryId) ?? null;
}

/** Keep the card "It's done" handed back. Nobody signed in keeps nothing. */
export function rememberBellAnswer(who: string | null | undefined, card: TaskCard): void {
  if (!claim(who)) return;
  answered.set(card.entryId, card);
}

/** Opened again, or answered elsewhere: the bell no longer speaks for it. */
export function forgetBellAnswer(who: string | null | undefined, entryId: number): void {
  if (!claim(who)) return;
  answered.delete(entryId);
}

/** The board answered this task itself: whatever the bell kept for it is old now. */
export function dropBellAnswer(entryId: number): void {
  answered.delete(entryId);
}

/** Signed out: empty it. */
export function forgetAllBellAnswers(): void {
  answered.clear();
  owner = null;
}
