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
 *   HELD     a member's first name on its own, or their surname on its own
 *            or after an initial ("A. Gomez"). Either is often an ordinary
 *            word too ("Will", "Rose", "Hope", "Baker"), so it is not refused
 *            outright: the line waits for the writer to reword it, and the
 *            preview says which word.
 *
 * READ PAST A DISGUISE (S6). A name is matched on what a reader sees, never on
 * the code points that draw it: an invisible format character (Unicode's Cf,
 * like a zero-width space) is refused outright, other default-ignorable code
 * points are dropped, compatibility forms are folded (NFKC, so a full-width
 * letter is its plain letter), and the Cyrillic and Greek letters that look
 * like Latin ones are read as those Latin letters (a small skeleton map in the
 * spirit of Unicode's UTS #39, for the letters names are written in).
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

export type NameFind = { kind: "refused" | "held"; what: "full_name" | "handle" | "email" | "first_name" | "surname" | "hidden_characters" };

export type NameCheck = (text: string) => NameFind | null;

/** An invisible format character (S6): refused, because nobody reading the line can see it. */
const FORMAT = new RegExp(String.raw`\p{Cf}`, "u");
const IGNORABLE = new RegExp(String.raw`\p{Default_Ignorable_Code_Point}`, "gu");

/** Cyrillic and Greek letters that draw as Latin ones, read as those Latin letters (S6). */
const LOOKALIKE = new Map<string, string>(
  (
    [
      // Cyrillic
      [0x0430, "a"], [0x0410, "A"], [0x0412, "B"], [0x0432, "b"], [0x0435, "e"], [0x0415, "E"], [0x0451, "e"], [0x0401, "E"],
      [0x043a, "k"], [0x041a, "K"], [0x041c, "M"], [0x043c, "m"], [0x041d, "H"], [0x043d, "h"], [0x043e, "o"], [0x041e, "O"],
      [0x0440, "p"], [0x0420, "P"], [0x0441, "c"], [0x0421, "C"], [0x0422, "T"], [0x0442, "t"], [0x0443, "y"], [0x0423, "Y"],
      [0x0445, "x"], [0x0425, "X"], [0x0456, "i"], [0x0406, "I"], [0x0457, "i"], [0x0407, "I"], [0x0458, "j"], [0x0408, "J"],
      [0x0455, "s"], [0x0405, "S"], [0x0501, "d"], [0x051b, "q"], [0x051d, "w"], [0x04cf, "l"], [0x04bb, "h"], [0x04ba, "H"],
      [0x0475, "v"], [0x0474, "V"], [0x0461, "w"], [0x0460, "W"],
      // Greek
      [0x0391, "A"], [0x03b1, "a"], [0x0392, "B"], [0x03b2, "b"], [0x0395, "E"], [0x03b5, "e"], [0x0396, "Z"], [0x0397, "H"],
      [0x0399, "I"], [0x03b9, "i"], [0x039a, "K"], [0x03ba, "k"], [0x039c, "M"], [0x039d, "N"], [0x03bd, "v"], [0x039f, "O"],
      [0x03bf, "o"], [0x03a1, "P"], [0x03c1, "p"], [0x03a4, "T"], [0x03c4, "t"], [0x03a5, "Y"], [0x03c5, "u"], [0x03a7, "X"],
      [0x03c7, "x"], [0x03b3, "y"], [0x03f2, "c"], [0x03f9, "C"], [0x037f, "J"], [0x03f3, "j"],
    ] as Array<[number, string]>
  ).map(([cp, latin]) => [String.fromCodePoint(cp), latin]),
);

/** The text as a reader sees it (S6): ignorables dropped, compatibility forms folded, lookalike letters read as Latin. */
export function foldForNames(text: string): string {
  const plain = String(text ?? "").replace(IGNORABLE, "").normalize("NFKC").replace(IGNORABLE, "");
  return Array.from(plain, (ch) => LOOKALIKE.get(ch) ?? ch).join("").normalize("NFC");
}

const clean = (v: unknown): string => (typeof v === "string" ? foldForNames(v).replace(/\s+/g, " ").trim() : "");

/** An email address, whoever's. */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

/** A check over this roster. Tombstones are left out: an erased member has no name left to protect. */
export function budgetNameCheck(roster: readonly RosterPerson[]): NameCheck {
  const people = roster.filter((r) => !(r.email && isTombstone({ email: r.email })));
  const full: NamedMember[] = [];
  const handles: NamedMember[] = [];
  const first: NamedMember[] = [];
  const last: NamedMember[] = [];
  people.forEach((r, i) => {
    const id = r.id ?? `documented:${i}`;
    const name = clean(r.name);
    const words = name ? name.split(" ") : [];
    if (words.length >= 2) full.push({ id, names: [name] });
    if (words.length >= 1) first.push({ id, names: [words[0]] });
    // A surname alone, or after an initial, is held like a first name (S6).
    if (words.length >= 2) last.push({ id, names: [words[words.length - 1]] });
    const handle = clean(r.handle).replace(/^@+/, "");
    if (handle) handles.push({ id, names: [`@${handle}`] });
  });
  const hit = (text: string, members: NamedMember[]) => members.length > 0 && swapNames(text, members, new Map()) !== text;
  return (text: string) => {
    const raw = String(text ?? "");
    if (!raw.trim()) return null;
    if (FORMAT.test(raw)) return { kind: "refused", what: "hidden_characters" };
    const t = foldForNames(raw);
    if (EMAIL.test(t)) return { kind: "refused", what: "email" };
    if (hit(t, full)) return { kind: "refused", what: "full_name" };
    if (hit(t, handles)) return { kind: "refused", what: "handle" };
    if (hit(t, first)) return { kind: "held", what: "first_name" };
    if (hit(t, last)) return { kind: "held", what: "surname" };
    return null;
  };
}

/** The sentence the preview shows beside a name find. */
export function nameFindWords(find: NameFind): string {
  if (find.what === "email") return "Every member reads these lines and notes, so an email address cannot go in one. Take it out.";
  if (find.what === "full_name") return "Every member reads these lines and notes, and this one names a member in full. Name the role or the work instead.";
  if (find.what === "handle") return "Every member reads these lines and notes, and this one names a member by their handle. Name the role or the work instead.";
  if (find.what === "hidden_characters") return "This carries invisible characters, which nobody reading it can see. Type it again as plain text.";
  if (find.what === "surname") return "This may name a member by their surname. Every member reads these lines, so reword it to name the role or the work, then preview again.";
  return "This may name a member by their first name. Every member reads these lines, so reword it to name the role or the work, then preview again.";
}
