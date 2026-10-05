/**
 * THE ADDRESS BOOK'S FRONT DOOR: `ensureContact` (the comms build spec 5.3).
 *
 * Every lane that meets a person by email (a guest saying yes, a form with a
 * ticked box, a path chosen at sign-up, the backfill) makes sure the person
 * has their one row here before anything else, and gets its id back.
 *
 * THE KEY IS THE ADDRESS TRIMMED AND LOWERCASED, and nothing else is folded
 * (`emailKeyOf`, shared/comms/address.ts). Dots and plus tags are left alone:
 * merging two people into one row is worse than keeping one person twice.
 *
 * WHAT A SECOND MEETING ADDS, AND WHAT IT NEVER CHANGES. A later call fills a
 * missing name and links a user id the first call did not know. It NEVER
 * replaces the first source, which is the record of how the village first met
 * this address. A time zone is the one fact that updates: it is read from the
 * person's own device, and the newest reading is the best one.
 *
 * NOTHING HERE GRANTS ANYTHING. A contact is an address and nothing more;
 * what the person agreed to receive lives in `comms_permissions`, written only
 * through server/lib/comms/permissions.ts. "A newly seen address gains no
 * kind beyond what its source implies" holds because this file cannot write
 * one at all.
 *
 * Every write is a repository call (server/repos/commsContacts.ts).
 */
import crypto from "node:crypto";
import type { Pool } from "mysql2/promise";
import { addressProblem, emailKeyOf } from "../../../shared/comms/address";
import { setContactTimezone, upsertContact } from "../../repos/commsContacts";

export interface ContactDeps {
  getPool(): Pool;
}

export interface EnsureContactInput {
  email: string;
  name?: string | null;
  userId?: string | null;
  /** Where the address was met: `account`, a form type, `housing`, `guest`, and so on. */
  source: string;
  /** An IANA zone from the person's own device, such as `Europe/Lisbon`. */
  timezone?: string | null;
}

const newContactId = (): string => `ct_${crypto.randomBytes(12).toString("hex")}`;

/**
 * A zone the platform can actually format a time in, or null. A zone that
 * Intl refuses would make every "in your time" line throw later, at the
 * worst moment, so it is refused here, at the door.
 */
export function validTimezone(tz: unknown): string | null {
  if (typeof tz !== "string") return null;
  const zone = tz.trim();
  if (!zone || zone.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/**
 * Make sure this address has its row, and answer the row's id. Null when the
 * address cannot be written to at all, which is data and not a caller's bug,
 * so it is an answer and never a throw.
 */
export async function ensureContact(
  deps: ContactDeps,
  input: EnsureContactInput,
): Promise<{ id: string; created: boolean } | null> {
  const email = String(input.email ?? "").trim();
  if (addressProblem(email) !== null) return null;
  const source = String(input.source ?? "").trim() || "unknown";
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : null;
  const userId = typeof input.userId === "string" && input.userId.trim() ? input.userId.trim() : null;
  const timezone = validTimezone(input.timezone);
  const pool = deps.getPool();
  const row = await upsertContact(pool, {
    id: newContactId(),
    emailKey: emailKeyOf(email),
    email,
    name,
    userId,
    source,
    timezone,
  });
  // The upsert keeps the first zone it heard; a newer reading from the
  // person's own device replaces it.
  if (timezone && !row.created) await setContactTimezone(pool, row.id, timezone);
  return row;
}
