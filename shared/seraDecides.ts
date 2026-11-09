/**
 * Who decides what waits from the outside service, and who sets pay, in words
 * (spec R38, R23; review S2).
 *
 * The server works the answer out from the code's own holder test, the inputs
 * the publish door uses (server/lib/seraDoors.ts), and sends it on the count
 * every member reads. It carries role names and holders' first names only:
 * chart facts a member already sees, never the service's data. These are its
 * words, the same on the member view and the pay row.
 */

/**
 * The door a decision goes through:
 *   holders  the live holders, by role in the house form "Role (FirstName)",
 *            at most three roles and `more` beside; `stewards` when the steward
 *            role is among them; `others` holders no role names; `admins` before
 *            launch, when the admin panel holds the door beside them;
 *   admins   before launch, with nobody holding the power: the admin panel;
 *   vote     after launch, with the door open to nobody: the village decides.
 */
export type Door =
  | { by: "holders"; labels: string[]; more: number; stewards: boolean; others: number; admins: boolean }
  | { by: "admins" }
  | { by: "vote" };

/** R38: when nobody holds the power to decide, after launch. */
export const NO_HOLDER_WORDS = "Nobody holds the power to decide these right now, so the village decides by vote.";
/** R23: when nobody holds the power to set pay, after launch. */
export const NO_PAY_HOLDER_WORDS = "Nobody holds the power to set pay right now.";

const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
const listOf = (xs: readonly string[]): string =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/** The holders as parts of a sentence, and whether they read as one (a singular verb). */
function parts(d: Extract<Door, { by: "holders" }>, prefix: string): { words: string[]; one: boolean } {
  const words = d.labels.map((l) => `${prefix}${l}`);
  if (d.more > 0 && words.length) words[words.length - 1] += ` +${d.more}`;
  if (d.others > 0) words.push(d.others === 1 ? "1 member" : `${d.others} members`);
  if (d.stewards) words.push("the stewards");
  if (d.admins) words.push("the admins");
  // One role with nobody beside it, or one member: a singular verb (review N4).
  const one = words.length === 1 && ((d.labels.length === 1 && d.more === 0) || (d.labels.length === 0 && d.others === 1));
  return { words, one };
}

/** Until the village launches, the admins' share of the door ends at launch. */
const untilLaunch = (d: Extract<Door, { by: "holders" }>): string => (d.admins ? " until the village launches" : "");

/** Who decides what waits, for a count of `n`. */
export function whoDecidesWords(d: Door, n: number): string {
  const it = n === 1 ? "it" : "them";
  if (d.by === "vote") return NO_HOLDER_WORDS;
  if (d.by === "admins") return `The admins decide ${it} until the village launches.`;
  const p = parts(d, "");
  return cap(`${listOf(p.words)} ${p.one ? "decides" : "decide"} ${it}${untilLaunch(d)}.`);
}

/** Who sets pay: "The Treasurer (Rick) sets pay." */
export function whoSetsPayWords(d: Door): string {
  if (d.by === "vote") return NO_PAY_HOLDER_WORDS;
  if (d.by === "admins") return "The admins set pay until the village launches.";
  const p = parts(d, "the ");
  return cap(`${listOf(p.words)} ${p.one ? "sets" : "set"} pay${untilLaunch(d)}.`);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A door read without trusting it: null when it is not one. */
export function readDoor(v: unknown): Door | null {
  if (!isObj(v)) return null;
  if (v.by === "admins" || v.by === "vote") return { by: v.by };
  if (v.by !== "holders" || !Array.isArray(v.labels)) return null;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);
  return {
    by: "holders",
    labels: v.labels.filter((l): l is string => typeof l === "string"),
    more: n(v.more),
    stewards: v.stewards === true,
    others: n(v.others),
    admins: v.admins === true,
  };
}
