/**
 * WHAT THE LAUNCH HANDS TO THE VILLAGE: the stewards' own selection (Rye,
 * 2026-11-01).
 *
 * "At launch the stewards select WHAT powers are being passed over. It
 * doesn't pass none; they select which powers the launch passes over." The
 * selection may be none, some or all of `HANDOVER_SET`. Before this, the
 * launch closer crossed all nineteen at once, hardcoded.
 *
 * One document in `app_config`, written whole by the one hand-over control
 * (server/routes/stewardHandover.ts) and read once by the launch closer
 * (`seatCatalystsAsStewards`, step 3), which moves exactly what it names.
 *
 * NOTHING SELECTED MOVES NOTHING. An absent document, an unreadable one, and a
 * key that is not a power the stewards hold all read as "not selected", so a
 * failure here leaves every power with the stewards: the state a village is in
 * after launch anyway, and one the stewards change by their own act.
 */
import type { Pool } from "mysql2/promise";
import { HANDOVER_SET, type Capability } from "../../shared/capabilities";
import { readConfigDocument, writeConfigDocument } from "../repos/appConfigDocs";

export const LAUNCH_HANDOVER_KEY = "launch-handover";

export interface LaunchSelection {
  /** The powers the launch hands to the village, in `HANDOVER_SET` order. */
  capabilities: Capability[];
  chosenBy: string | null;
  chosenAt: string | null;
}

const NONE: LaunchSelection = { capabilities: [], chosenBy: null, chosenAt: null };

/** Keep only powers the stewards hold, once each, in the set's own order. */
export function onlyHandoverPowers(raw: unknown): Capability[] {
  const asked = new Set(Array.isArray(raw) ? raw.map(String) : []);
  return HANDOVER_SET.filter((c) => asked.has(c));
}

export async function readLaunchSelection(pool: Pool): Promise<LaunchSelection> {
  try {
    const doc = await readConfigDocument<{ capabilities?: unknown; chosenBy?: unknown; chosenAt?: unknown }>(pool, LAUNCH_HANDOVER_KEY);
    if (!doc) return { ...NONE };
    return {
      capabilities: onlyHandoverPowers(doc.capabilities),
      chosenBy: doc.chosenBy ? String(doc.chosenBy) : null,
      chosenAt: doc.chosenAt ? String(doc.chosenAt) : null,
    };
  } catch (e) {
    console.error("[launch handover] could not read the launch selection, so the launch hands nothing over", e);
    return { ...NONE };
  }
}

export async function writeLaunchSelection(
  pool: Pool,
  capabilities: readonly string[],
  chosenBy: string,
  at: Date = new Date(),
): Promise<LaunchSelection> {
  const selection: LaunchSelection = { capabilities: onlyHandoverPowers(capabilities), chosenBy, chosenAt: at.toISOString() };
  await writeConfigDocument(pool, LAUNCH_HANDOVER_KEY, { ...selection });
  return selection;
}
