/**
 * A WEEK TO THINK AGAIN BEFORE A MATURE-ONLY POWER CROSSES (ROLE_POWERS_DESIGN.md
 * §4.1b; the coordinator's go of 2026-11-05).
 *
 * Rye, 2026-11-01: every power can pass to the village, and the riskiest are for
 * "the most mature" villages only. They are never locked. #772 already asks a
 * second, explicit confirm for them (`MATURE_ONLY`); this adds the design's
 * other half: once the stewards have signed, a mature-only power waits SEVEN
 * DAYS before it lands, in the open, and any steward may stop it inside that
 * week with a reason.
 *
 * WHAT WAITS AND WHAT DOES NOT. Only a hand-over after the Game starts, and only
 * its mature-only powers; the rest of the same list crosses at once, as before.
 * A launch selection does not wait here, because the launch vote is its window.
 *
 * WHERE IT LIVES. One `app_config` document, the shape #772's pending request
 * uses, so the record is a single row any reader can find. A power lands when
 * its week is up: a job checks hourly, and the hand-over route checks on every
 * read, so a village with the scheduler off still lands it the next time a
 * steward opens the checklist.
 */
import type { Pool } from "mysql2/promise";
import type { Capability } from "../../shared/capabilities";
import { readConfigDocument, writeConfigDocument } from "../repos/appConfigDocs";
import { onlyHandoverPowers } from "./launchHandover";

export const HANDOVER_COOLING_KEY = "handover-cooling";
export const COOLING_DAYS = 7;

export interface CoolingEntry {
  capability: Capability;
  /** Who signed it, as the hand-over records it ("a" or "a+b"). */
  signedBy: string;
  startedAt: string;
  landsAt: string;
}

/** The entries on record, well formed only, in the order they were signed. */
export async function readCooling(pool: Pool): Promise<CoolingEntry[]> {
  const doc = await readConfigDocument<{ entries?: unknown }>(pool, HANDOVER_COOLING_KEY);
  const raw = Array.isArray(doc?.entries) ? (doc!.entries as any[]) : [];
  const out: CoolingEntry[] = [];
  for (const e of raw) {
    const [capability] = onlyHandoverPowers([e?.capability]);
    if (!capability || !e?.landsAt || out.some((o) => o.capability === capability)) continue;
    out.push({ capability, signedBy: String(e.signedBy ?? ""), startedAt: String(e.startedAt ?? ""), landsAt: String(e.landsAt) });
  }
  return out;
}

async function writeCooling(pool: Pool, entries: readonly CoolingEntry[]): Promise<void> {
  await writeConfigDocument(pool, HANDOVER_COOLING_KEY, { entries: entries.map((e) => ({ ...e })) });
}

/** Split a list into what is due now and what still waits. Pure. */
export function splitDue(entries: readonly CoolingEntry[], now: Date): { due: CoolingEntry[]; waiting: CoolingEntry[] } {
  const due: CoolingEntry[] = [];
  const waiting: CoolingEntry[] = [];
  for (const e of entries) (new Date(e.landsAt).getTime() <= now.getTime() ? due : waiting).push(e);
  return { due, waiting };
}

/** Start the week for each power not already waiting. Returns the ones it started. */
export async function startCooling(pool: Pool, capabilities: readonly string[], signedBy: string, now: Date = new Date()): Promise<CoolingEntry[]> {
  const entries = await readCooling(pool);
  const started: CoolingEntry[] = [];
  for (const capability of onlyHandoverPowers(capabilities)) {
    if (entries.some((e) => e.capability === capability)) continue;
    const e: CoolingEntry = {
      capability,
      signedBy,
      startedAt: now.toISOString(),
      landsAt: new Date(now.getTime() + COOLING_DAYS * 86400000).toISOString(),
    };
    entries.push(e);
    started.push(e);
  }
  if (started.length) await writeCooling(pool, entries);
  return started;
}

/** Stop one power's week. Returns the entry stopped, or null when nothing waited. */
export async function stopCooling(pool: Pool, capability: string): Promise<CoolingEntry | null> {
  const entries = await readCooling(pool);
  const hit = entries.find((e) => e.capability === capability) ?? null;
  if (!hit) return null;
  await writeCooling(pool, entries.filter((e) => e !== hit));
  return hit;
}

/**
 * Take the entries whose week is up off the record and hand them to `land`,
 * one by one. An entry `land` fails on stays on the record for the next try.
 */
export async function landDueCooling(
  pool: Pool,
  land: (entry: CoolingEntry) => Promise<boolean>,
  now: Date = new Date(),
): Promise<CoolingEntry[]> {
  const entries = await readCooling(pool);
  const { due, waiting } = splitDue(entries, now);
  if (!due.length) return [];
  const landed: CoolingEntry[] = [];
  const kept = [...waiting];
  for (const e of due) {
    if (await land(e)) landed.push(e);
    else kept.push(e);
  }
  await writeCooling(pool, kept);
  return landed;
}
