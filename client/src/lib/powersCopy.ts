/**
 * The sentences the powers page says (0098). Pure, so they are testable.
 *
 * The page's whole job is to answer "who looks after this?" in words a member
 * would use out loud, and to answer it identically for a village holding one
 * power and a village holding every one. The R55 rules live in the page's own
 * header; what lives here is the wording, because wording is the part that
 * drifts and the part a test can hold still.
 */

export interface PowerHolderRow {
  roleName: string;
  byBallot: boolean;
  people: string[];
}

export interface PowerRow {
  capability: string;
  title: string;
  surface: string;
  consequence: string;
  /** Whether this power is one that can move to a role at all. */
  movable: boolean;
  heldBy: PowerHolderRow | null;
  /** Before the village holds it: who holds it today through a role, as "Role (FirstName)". */
  heldToday?: string[];
  /** The stage that gives it to every member, by its name. */
  stage?: string | null;
  /** The family it belongs to, by what it does (shared/powerBoard.ts). */
  family?: string;
  /** What a village usually does with it at launch. */
  guidance?: string;
  /** Where a suggested change goes. */
  suggestionsGoTo?: "holders" | "vote";
}

/** Names as a person would say them out loud. */
export function namesSentence(people: readonly string[]): string {
  if (people.length === 0) return "";
  if (people.length === 1) return people[0];
  if (people.length === 2) return `${people[0]} and ${people[1]}`;
  return `${people.slice(0, -1).join(", ")} and ${people[people.length - 1]}`;
}

/**
 * WHO HOLDS THIS, in one sentence.
 *
 * Three states and no fourth: the village holds it and people sit there, the
 * village holds it and the seats are empty, or the scaffolding is looking
 * after it.
 *
 * The empty-seat sentence is the one worth defending. A village that took a
 * power on and never seated anybody has a real problem, and the honest thing
 * is to say so plainly and then stop. It carries no exclamation and no call
 * to action: a fact is a fact, and a warning is an argument.
 */
export function holderSentence(power: PowerRow): string {
  if (power.heldBy) {
    const who = power.heldBy.roleName;
    if (power.heldBy.people.length === 0) {
      return `${who} holds this, and nobody is sitting there yet.`;
    }
    // The house form, Rye 2026-10-30: the role first, the holders' first names in parentheses.
    return `${who} (${namesSentence(power.heldBy.people)}) holds this.`;
  }
  // Role powers (2026-11-05): a power a role carries is held by that role's
  // holders today, for the stewards, and saying the panel has it would be false.
  const today = power.heldToday ?? [];
  if (today.length) {
    return `${namesSentence(today)} ${today.length === 1 ? "holds" : "hold"} this today, for the stewards.`;
  }
  if (power.stage) return `Everyone at the ${power.stage} stage or past it holds this.`;
  if (power.movable) return "The admin panel looks after this one. It is one the village can take on.";
  return "The admin panel looks after this one.";
}

/** Where a suggested change to this power goes, in one sentence. */
export function suggestionSentence(power: PowerRow): string {
  return power.suggestionsGoTo === "holders"
    ? "A suggested change to this goes to its holders to review."
    : "A suggested change to this goes to a village vote.";
}

/**
 * The powers in their families, in the families' own order and the server's
 * own order inside each. A family is what a power DOES, so this groups the
 * same way for a village holding none of them and one holding every one: it
 * never reads who holds what.
 */
export function inFamilies<T extends { family?: string }>(
  powers: readonly T[],
  families: ReadonlyArray<{ id: string; title: string }>,
): Array<{ id: string; title: string; powers: T[] }> {
  return families
    .map((f) => ({ ...f, powers: powers.filter((p) => p.family === f.id) }))
    .filter((f) => f.powers.length > 0);
}
