/**
 * The record of "List only these" (role journey PR-A).
 *
 * Each run keeps what every role read as before, so a steward can put the
 * earlier listing back. Stored as one `app_config` document of ids and flags:
 * it names no person.
 */
import type { Pool } from "mysql2/promise";
import { dbDocument } from "./store-db";
import { pushRecord, type ListingRecord, type ListOnlyPlan } from "../../shared/roleListing";

export const ROLE_LISTING_DOC = "role-listing-records";

function doc(pool: Pool) {
  return dbDocument<{ records: ListingRecord[] }>(pool, ROLE_LISTING_DOC, { records: [] });
}

export async function readListingRecords(pool: Pool): Promise<ListingRecord[]> {
  const d = doc(pool);
  await d.load();
  const records = d.get().records;
  return Array.isArray(records) ? records : [];
}

async function writeListingRecords(pool: Pool, records: ListingRecord[]): Promise<void> {
  const d = doc(pool);
  await d.load();
  await d.put({ records });
}

async function setListed(pool: Pool, ids: readonly string[], value: 0 | 1 | null): Promise<void> {
  if (!ids.length) return;
  await pool.query(
    `UPDATE org_roles SET \`listed\` = ? WHERE id IN (${ids.map(() => "?").join(",")}) AND is_example = 0`,
    [value, ...ids],
  );
}

/** Writes the plan and keeps the record. Returns the record. */
export async function applyListOnly(pool: Pool, plan: ListOnlyPlan, kept: readonly string[], now = new Date()): Promise<ListingRecord> {
  await setListed(pool, plan.list, 1);
  await setListed(pool, plan.unlist, 0);
  const record: ListingRecord = { at: now.toISOString(), kept: [...kept], before: plan.before, undoneAt: null };
  await writeListingRecords(pool, pushRecord(await readListingRecords(pool), record));
  return record;
}

/** Puts the newest run that has not been undone back. Null when there is nothing to put back. */
export async function undoListOnly(pool: Pool, now = new Date()): Promise<ListingRecord | null> {
  const records = await readListingRecords(pool);
  let i = records.length - 1;
  while (i >= 0 && records[i].undoneAt) i -= 1;
  if (i < 0) return null;
  const rec = records[i];
  await setListed(pool, rec.before.filter((b) => b.listed).map((b) => b.id), 1);
  await setListed(pool, rec.before.filter((b) => !b.listed).map((b) => b.id), 0);
  const next = records.map((r, j) => (j === i ? { ...r, undoneAt: now.toISOString() } : r));
  await writeListingRecords(pool, next);
  return next[i];
}
