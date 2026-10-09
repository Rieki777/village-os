/**
 * WHICH STEPS A JOURNEY HAS, FOR THE VILLAGE AND FOR EACH PERSON ON IT
 * (the comms build spec 5.6, "Village state").
 *
 * ── THE VILLAGE'S JOURNEY ──────────────────────────────────────────────────
 *
 * `comms_journeys` holds a row once the village acts on a journey. `state` is
 * off or on (every journey ships off). `definition` is NULL while the
 * platform's steps apply, and then the platform's steps are built from the
 * village's reminder dials (`withReminderDials`, shared/comms/journeySteps.ts),
 * so a founder who changes "When gathering reminders go out" changes the
 * reminders of everybody still waiting for one.
 *
 * ── VERSIONS ────────────────────────────────────────────────────────────────
 *
 * While the platform's steps apply, the journey's version is the platform
 * default's (1 today). Every save of an edit writes `comms_journey_versions`
 * and moves the row to the next number, counted past every number already in
 * use, so a village version can never collide with a platform one. The first
 * save also writes down the steps the village is leaving, under their own
 * number, so the people already walking them keep them.
 *
 * AN ENROLLMENT KEEPS ITS VERSION. A person enrolled on version 2 walks
 * version 2's steps after the journey is edited to version 3
 * (`definitionForEnrollment`). The one exception is a version nothing wrote
 * down: the platform's own steps before any edit, which follow the platform
 * and its dials.
 *
 * Turning a journey on adopts the words of every email it sends
 * (`ensureAdopted`, lane B3), so the village holds its own copy from then on,
 * and asks the next tick to look at everybody already on it.
 */
import type { Pool } from "mysql2/promise";
import { JOURNEY_KINDS, type JourneyDefinition } from "../../../shared/comms/contracts";
import { DEFAULT_PATH_IDS, platformTemplate } from "../../../shared/comms/defaults/templates";
import { DEFAULT_JOURNEYS, defaultJourney, pathJourney } from "../../../shared/comms/defaults/journeys";
import { editStep, parseReminderMinutes, withReminderDials, type ReminderDials, type StepPatch } from "../../../shared/comms/journeySteps";
import { GAME_CONFIG } from "../../../shared/gameConfig";
import { liveTemplateRows } from "../../repos/commsTemplates";
import {
  journeyRow,
  journeyRows,
  journeyVersionDefinition,
  saveJourneyVersion,
  touchJourney,
  writeJourneyState,
  type JourneyRow,
} from "../../repos/commsJourneys";
import { numberVar, stringVar } from "../variables";
import { ensureAdopted } from "./templates";

export interface DefinitionDeps {
  getPool(): Pool;
  /** The reminder dials. Absent: the game variables. Tests pass their own. */
  reminderDials?(): ReminderDials;
}

/** The village's reminder dials, read from the game variables. */
export function readReminderDials(deps: Pick<DefinitionDeps, "reminderDials">): ReminderDials {
  if (deps.reminderDials) return deps.reminderDials();
  let reminderMinutes: number[] | null = null;
  let hostNudgeMinutes: number | null = null;
  try {
    reminderMinutes = parseReminderMinutes(stringVar("comms.event_reminder_minutes"));
  } catch {
    reminderMinutes = null;
  }
  try {
    const n = numberVar("comms.host_nudge_minutes");
    hostNudgeMinutes = Number.isFinite(n) ? n : null;
  } catch {
    hostNudgeMinutes = null;
  }
  return { reminderMinutes, hostNudgeMinutes };
}

/** The paths a village has: the four every village is born with, then its own. */
export function villagePathIds(): string[] {
  const shipped: readonly string[] = DEFAULT_PATH_IDS;
  return [...shipped, ...GAME_CONFIG.paths.map((p) => p.id).filter((id) => !shipped.includes(id))];
}

/** The platform's own steps for a key, before any dial: a default journey, or a path's. */
export function platformDefinition(key: string): JourneyDefinition | null {
  const def = defaultJourney(key);
  if (def) return def;
  const pathId = key.match(/^path\.([a-z0-9-]+)$/)?.[1];
  return pathId && villagePathIds().includes(pathId) ? pathJourney(pathId) : null;
}

/** Every journey key the village has, in the order the screen lists them. */
export function journeyKeys(extra: readonly string[] = []): string[] {
  const keys: string[] = DEFAULT_JOURNEYS.map((j) => j.key);
  for (const id of villagePathIds()) if (!keys.includes(`path.${id}`)) keys.push(`path.${id}`);
  for (const k of extra) if (!keys.includes(k)) keys.push(k);
  return keys;
}

/** A stored definition, when it has the shape of one for this key. */
export function parseDefinition(raw: unknown, key: string): JourneyDefinition | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Partial<JourneyDefinition>;
  if (d.key !== key || !Array.isArray(d.steps) || !(JOURNEY_KINDS as readonly string[]).includes(String(d.kind))) return null;
  if (!d.steps.every((s) => s && typeof s.key === "string" && typeof s.templateKey === "string" && Array.isArray(s.skipIf))) return null;
  return { ...(d as JourneyDefinition), stops: Array.isArray(d.stops) ? d.stops : [] };
}

/** Where a journey stands for the village. */
export interface JourneyStatus {
  key: string;
  state: "on" | "off";
  /** The version new enrollments start on. */
  version: number;
  /** The steps in force: the village's own, or the platform's with the dials applied. */
  definition: JourneyDefinition;
  /** True once the village has saved steps of its own. */
  own: boolean;
  /** The platform's steps with the dials applied, for comparison. */
  platform: JourneyDefinition | null;
  row: JourneyRow | null;
}

function statusOf(key: string, row: JourneyRow | null, dials: ReminderDials): JourneyStatus | null {
  const base = platformDefinition(key);
  const platform = base ? withReminderDials(base, dials) : null;
  const own = row ? parseDefinition(row.definition, key) : null;
  const definition = own ? { ...own, version: row!.version } : platform;
  if (!definition) return null;
  return {
    key,
    state: row?.state === "on" ? "on" : "off",
    version: own ? row!.version : definition.version,
    definition,
    own: Boolean(own),
    platform,
    row,
  };
}

/** One journey's standing, or null for a key the village has no journey by. */
export async function journeyStatus(deps: DefinitionDeps, key: string): Promise<JourneyStatus | null> {
  return statusOf(key, await journeyRow(deps.getPool(), key), readReminderDials(deps));
}

/** Every journey's standing, read once. */
export async function allJourneyStatuses(deps: DefinitionDeps): Promise<JourneyStatus[]> {
  const rows = await journeyRows(deps.getPool());
  const byKey = new Map(rows.map((r) => [r.journeyKey, r]));
  const dials = readReminderDials(deps);
  const out: JourneyStatus[] = [];
  for (const key of journeyKeys(rows.map((r) => r.journeyKey))) {
    const s = statusOf(key, byKey.get(key) ?? null, dials);
    if (s) out.push(s);
  }
  return out;
}

/** The steps one person walks: those of the version they started on (see the header). */
export async function definitionForEnrollment(
  deps: DefinitionDeps,
  status: JourneyStatus,
  journeyVersion: number,
): Promise<JourneyDefinition> {
  if (journeyVersion === status.version) return status.definition;
  const stored = parseDefinition(await journeyVersionDefinition(deps.getPool(), status.key, journeyVersion), status.key);
  if (stored) return { ...stored, version: journeyVersion };
  if (status.platform && status.platform.version === journeyVersion) return status.platform;
  return status.definition;
}

/** Every words key a definition sends. */
export const templateKeysOf = (def: JourneyDefinition): string[] => Array.from(new Set(def.steps.map((s) => s.templateKey)));

/**
 * Turn a journey on or off. On adopts its words and asks the next tick to look
 * at everybody already on it, so catch-up decides what they still get. Null
 * for a key the village has no journey by.
 */
export async function setJourneyState(
  deps: DefinitionDeps,
  key: string,
  state: "on" | "off",
  by: string | null,
): Promise<{ status: JourneyStatus; adopted: string[]; touched: number } | null> {
  const before = await journeyStatus(deps, key);
  if (!before) return null;
  const pool = deps.getPool();
  await writeJourneyState(pool, key, state, before.version, by);
  let adopted: string[] = [];
  let touched = 0;
  if (state === "on") {
    adopted = await ensureAdopted(pool, templateKeysOf(before.definition), by);
    touched = await touchJourney(pool, key);
  }
  const status = await journeyStatus(deps, key);
  return status ? { status, adopted, touched } : null;
}

/** Whether words exist for a key: the platform's own, or the village's. */
export async function templateKnownPredicate(pool: Pool): Promise<(key: string) => boolean> {
  const live = new Set((await liveTemplateRows(pool)).map((r) => r.templateKey));
  return (key: string) => live.has(key) || platformTemplate(key) !== null;
}

/**
 * Save one edited step as the journey's next version. Answers the new standing
 * and version, or the reasons the edit cannot be saved.
 */
export async function saveJourneyStep(
  deps: DefinitionDeps,
  key: string,
  stepKey: string,
  patch: StepPatch,
  by: string | null,
): Promise<{ status: JourneyStatus; version: number } | { problems: string[] } | null> {
  const before = await journeyStatus(deps, key);
  if (!before) return null;
  const pool = deps.getPool();
  const edit = editStep(before.definition, stepKey, patch, { templateKnown: await templateKnownPredicate(pool) });
  if ("problems" in edit) return edit;
  const version = await saveJourneyVersion(pool, {
    journeyKey: key,
    platformVersion: before.platform?.version ?? before.definition.version,
    leaving: { version: before.version, definition: before.definition },
    definition: (v) => ({ ...edit.definition, version: v }),
    by,
  });
  // A journey already on sends words the village holds, including newly chosen ones.
  if (before.state === "on") await ensureAdopted(pool, templateKeysOf(edit.definition), by);
  const status = await journeyStatus(deps, key);
  return status ? { status, version } : null;
}
