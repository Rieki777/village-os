/**
 * WHO A BUDGET LINE'S WORDS MIGHT NAME (budgets spec R15), for every source.
 *
 * Every member reads budget lines and their notes (R23), and a budget is a plan
 * for a role, never pay to a person (C6). So a label or note that names a
 * member is stopped before it is stored:
 *
 *   REFUSED  a full display name of two or more words from the roster, an
 *            "@handle", or an email address (any address at all, since an
 *            address is a person's whatever roster it is on). None of those is
 *            an ordinary word, so a refusal here is never a false alarm about
 *            a common word.
 *   HELD     a member's first name on its own. A first name is often an
 *            ordinary word too ("Will", "Rose", "Hope"), so it is not refused
 *            outright: the line waits for the writer to reword it, and the
 *            preview says which word.
 *
 * The matching is the one name-swap engine (server/lib/nameSwap.ts): whole
 * words, case and accents folded, possessives caught, longest name first. This
 * is the narrow-and-wide split the snapshot's name check draws, written here
 * on what main already holds, so a budget does not wait on that lane. Pure:
 * the roster comes in, a check comes out.
 */
import { swapNames, type NamedMember } from "./nameSwap";
import { isTombstone } from "./oauthAccounts";

export interface RosterPerson {
  id: string | null;
  name: string;
  handle: string | null;
  email: string | null;
}

export type NameFind = { kind: "refused" | "held"; what: "full_name" | "handle" | "email" | "first_name" };

export type NameCheck = (text: string) => NameFind | null;

const clean = (v: unknown): string => (typeof v === "string" ? v.normalize("NFC").replace(/\s+/g, " ").trim() : "");

/** An email address, whoever's. */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

/** A check over this roster. Tombstones are left out: an erased member has no name left to protect. */
export function budgetNameCheck(roster: readonly RosterPerson[]): NameCheck {
  const people = roster.filter((r) => !(r.email && isTombstone({ email: r.email })));
  const full: NamedMember[] = [];
  const handles: NamedMember[] = [];
  const first: NamedMember[] = [];
  people.forEach((r, i) => {
    const id = r.id ?? `documented:${i}`;
    const name = clean(r.name);
    const words = name ? name.split(" ") : [];
    if (words.length >= 2) full.push({ id, names: [name] });
    if (words.length >= 1) first.push({ id, names: [words[0]] });
    const handle = clean(r.handle).replace(/^@+/, "");
    if (handle) handles.push({ id, names: [`@${handle}`] });
  });
  const hit = (text: string, members: NamedMember[]) => members.length > 0 && swapNames(text, members, new Map()) !== text;
  return (text: string) => {
    const t = String(text ?? "");
    if (!t.trim()) return null;
    if (EMAIL.test(t)) return { kind: "refused", what: "email" };
    if (hit(t, full)) return { kind: "refused", what: "full_name" };
    if (hit(t, handles)) return { kind: "refused", what: "handle" };
    if (hit(t, first)) return { kind: "held", what: "first_name" };
    return null;
  };
}

/** The sentence the preview shows beside a name find. */
export function nameFindWords(find: NameFind): string {
  if (find.what === "email") return "Every member reads these lines and notes, so an email address cannot go in one. Take it out.";
  if (find.what === "full_name") return "Every member reads these lines and notes, and this one names a member in full. Name the role or the work instead.";
  if (find.what === "handle") return "Every member reads these lines and notes, and this one names a member by their handle. Name the role or the work instead.";
  return "This may name a member by their first name. Every member reads these lines, so reword it to name the role or the work, then preview again.";
}
