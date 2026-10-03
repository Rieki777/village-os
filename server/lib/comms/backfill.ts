/**
 * THE ADDRESS BOOK'S FIRST FILL, run once at boot (the comms build spec 5.3).
 *
 * The village already holds addresses in four places: members' accounts, the
 * data of every form ever submitted (the investor packet requests among
 * them, which are submissions of type `investor-doc-request`), and housing
 * requests. This makes each of them a contact, so the People screen shows
 * everybody the village could already write to, and the post office knows
 * them when it first does.
 *
 * IT GRANTS NOTHING. "A backfilled address gains no kind beyond what its
 * source implies" (5.3), and this file holds that by construction: it calls
 * `ensureContact`, which cannot write a permission, and nothing else. What a
 * source implies is read live from the source itself: a member's account
 * implies their notification emails (their own `users.prefs`) and, when they
 * chose a path, path emails (server/lib/comms/permissions.ts). A form
 * submitted before this existed had no box to tick, so it implies nothing,
 * and a housing request implies nothing either.
 *
 * THE FIRST SOURCE IS THE EARLIEST ONE. Every candidate is gathered first and
 * written oldest first, so a person who sent a form in spring and joined in
 * autumn is recorded as first met through the form, which is true.
 *
 * NO ACCOUNT IS LINKED FROM A FORM. A member may submit a form carrying
 * somebody else's address, so a submission's `userId` says who pressed send,
 * never whose address it is. Only the account's own address links to it.
 *
 * Counted and logged in one line, so a founder reading the boot log can see
 * what the address book was born holding.
 */
import type { Pool } from "mysql2/promise";
import { housingAddresses } from "../../repos/commsPeople";
import { isExampleUser } from "../examples";
import { isTombstone } from "../oauthAccounts";
import { ensureContact } from "./contacts";

export interface BackfillDeps {
  getPool(): Pool;
  members: { all(): Promise<any[]> };
  submissions: { all(): unknown[] };
  log?: (line: string) => void;
}

export interface BackfillCounts {
  /** Addresses looked at, across every source. */
  seen: number;
  /** New contacts, by the source each was first met through. */
  created: Record<string, number>;
  /** Addresses that already had a contact. */
  known: number;
  /** Addresses nobody could write to. */
  unusable: number;
}

interface Candidate {
  at: number;
  email: string;
  name: string | null;
  userId: string | null;
  source: string;
  family: "members" | "forms" | "housing";
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const when = (v: unknown): number => {
  const t = typeof v === "string" || v instanceof Date ? new Date(v as any).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
};

/** Make every address the village already holds a contact, and say what that came to. */
export async function backfillContacts(deps: BackfillDeps): Promise<BackfillCounts> {
  const candidates: Candidate[] = [];
  for (const m of await deps.members.all()) {
    const email = text(m?.email);
    if (!email || isExampleUser(m) || isTombstone({ email })) continue;
    candidates.push({ at: when(m.joinedAt), email, name: text(m.name), userId: String(m.id), source: "account", family: "members" });
  }
  for (const raw of deps.submissions.all()) {
    const s = (raw ?? {}) as Record<string, any>;
    const data = s.data && typeof s.data === "object" ? (s.data as Record<string, unknown>) : {};
    const email = text(data.email);
    if (!email) continue;
    candidates.push({
      at: when(s.submittedAt),
      email,
      name: text(data.name) ?? text(data.firstName),
      userId: null,
      source: text(s.type) ?? "form",
      family: "forms",
    });
  }
  for (const h of await housingAddresses(deps.getPool())) {
    const email = text(h.email);
    if (!email) continue;
    candidates.push({ at: h.createdAt * 1000, email, name: h.name, userId: null, source: "housing", family: "housing" });
  }
  // Oldest first, so the first source written is the first meeting.
  candidates.sort((a, b) => a.at - b.at);

  const counts: BackfillCounts = { seen: candidates.length, created: {}, known: 0, unusable: 0 };
  for (const c of candidates) {
    const row = await ensureContact(deps, { email: c.email, name: c.name, userId: c.userId, source: c.source });
    if (!row) counts.unusable += 1;
    else if (row.created) counts.created[c.family] = (counts.created[c.family] ?? 0) + 1;
    else counts.known += 1;
  }
  const made = Object.values(counts.created).reduce((a, b) => a + b, 0);
  const parts = Object.entries(counts.created).map(([family, n]) => `${family} ${n}`);
  (deps.log ?? console.log)(
    `[comms] address book backfill: ${counts.seen} address(es) seen, ${made} new contact(s)` +
      (parts.length ? ` (${parts.join(", ")})` : "") +
      `, ${counts.known} already known, ${counts.unusable} unusable. No permission was granted.`,
  );
  return counts;
}
