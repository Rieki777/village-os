/**
 * WHO THE SERVICE'S WORDS MIGHT NAME, for the snapshot and the differences list
 * (spec R9), as two matches built on the one name-swap engine in nameSwap.ts.
 *
 * ── WHY TWO, AND WHICH ONE REWRITES ──────────────────────────────────────
 *
 * The journal bridge swaps with `namesOf`: a member's whole display name, its
 * first word, its last word, the handle with and without its "@", and the email
 * address. That match is right for text LEAVING the village, where an
 * over-swap only costs readability. It over-matches ordinary words: a member
 * whose surname is Wells turns "keep the wells clear" into "keep the a member
 * clear". Stored as the service's words and offered back to the chart, that is
 * a corrupted role description. The journal bridge uses this same wide match,
 * so it is no safer.
 *
 * So the snapshot REWRITES only with a narrow list: whole display names of two
 * or more words, "@handle", and email addresses. None of those is an ordinary
 * word. The wide list (first names, surnames, bare handles) is a FLAG only,
 * never a stored swap: the difference says "Names a member: check this one",
 * and the value cannot be taken until a person edits it. A first name in the
 * service's prose is therefore kept as sent, and flagged.
 *
 * The same narrow swap runs over our side and the base in shared/seraDifferences.ts
 * (`swap`), so a full name on one side and its stand-in on the other compare
 * equal.
 */
import { createHash } from "crypto";
import { mentionedMembers, namesOf, swapNames, type NamedMember } from "./nameSwap";
import { isTombstone } from "./oauthAccounts";
import type { RosterRow } from "../repos/peopleRoster";

export interface NameCheck {
  /** The stored swap, by the narrow list: each to "a member". */
  swap: (text: string) => string;
  /** The wide match: true when the text may name a member. A flag, never a rewrite. */
  names: (text: string) => boolean;
  /** Who the check knows, as a hash, for a cache key. */
  fingerprint: string;
}

const clean = (v: unknown): string => (typeof v === "string" ? v.normalize("NFC").replace(/\s+/g, " ").trim() : "");

/** The names safe to rewrite: none of them is an ordinary word. */
function narrowNames(r: RosterRow): string[] {
  const out: string[] = [];
  const name = clean(r.name);
  if (name.split(" ").length >= 2) out.push(name);
  const handle = clean(r.handle).replace(/^@+/, "");
  if (handle) out.push(`@${handle}`);
  const email = clean(r.email);
  if (email) out.push(email);
  return out;
}

/** Both matches for a roster: members present here, and holders written on a role by hand. */
export function nameCheckFor(rows: readonly RosterRow[]): NameCheck {
  const people = rows.filter((r) => !(r.email && isTombstone({ email: r.email })));
  const narrow: NamedMember[] = [];
  const wide: NamedMember[] = [];
  people.forEach((r, i) => {
    const id = r.id ?? `documented:${i}`;
    const n = narrowNames(r);
    if (n.length) narrow.push({ id, names: n });
    const w = namesOf(r);
    if (w.length) wide.push({ id, names: w });
  });
  const known = narrow.flatMap((m) => m.names).sort();
  return {
    swap: (text) => (narrow.length ? swapNames(text, narrow, new Map()) : text),
    // A name two members share counts too: `swapNames` replaces it even where `mentionedMembers` cannot say whose it is.
    names: (text) => wide.length > 0 && (mentionedMembers([text], wide).size > 0 || swapNames(text, wide, new Map()) !== text),
    fingerprint: createHash("sha256").update(JSON.stringify([known, wide.flatMap((m) => m.names).sort()])).digest("hex").slice(0, 16),
  };
}
