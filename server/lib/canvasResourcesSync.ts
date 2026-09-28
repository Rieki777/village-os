/**
 * READING THE GOVERNANCE CANVAS DATABASE INTO A VILLAGE'S SHELF (plan 5.1,
 * 5.8; Wave 4 of the canvas build, 2026-09-28).
 *
 *   syncCanvasResources    the nightly job `canvas-resources-sync`
 *   checkResourceLinks     the nightly job `canvas-resources-link-check`
 *   loadSnapshotIfEmpty    the shipped copy, for a village that has not read
 *                          the database itself (or cannot reach it)
 *   resourcesForBlock      what the Learn frame shows under one block
 *
 * Both jobs are registered by server/routes/canvasResources.ts, beside the
 * route that reads what they write.
 *
 * ── WHAT ONE NIGHT'S READ DOES ─────────────────────────────────────────────
 *
 *   1. Asks the dial `canvas.resources_sync` (ON by default: Rye ruled the
 *      canvas pieces built AND switched on, the resource sync among them). Off
 *      means no request leaves the village, and the job says so.
 *   2. Fetches the five public columns (CANVAS_DATABASE.csvUrl, or
 *      CANVAS_DB_URL when set) through `guardedFetchText`: https only, the
 *      address pinned after its range check, 15 seconds, 1 MB.
 *   3. Parses the CSV by hand (shared/csv.ts) and reads it by header NAME
 *      (shared/canvasResources.ts). A missing header, an empty sheet or text
 *      that is not clean CSV is REFUSED: nothing is written, the shelf keeps
 *      the rows it had, and the job fails with the reason, which is how it
 *      reaches the failures report (server/lib/failedActions.ts reads a
 *      failed job's last result) and the admins' notice (the scheduler calls
 *      `reportError`).
 *   4. Upserts every resource on its key and marks every row the read did
 *      not carry as withdrawn, in one transaction. Nothing is deleted.
 *
 * If the read fails and the shelf is EMPTY, the snapshot is loaded first, so
 * a village whose server has no way out still has the shelf. That is the
 * whole of "hosting is a mix" here: the shelf works with no ReGen service and
 * no network, and gets fresher where the network allows.
 *
 * ── WHAT THE VILLAGE IS TOLD ABOUT FRESHNESS ───────────────────────────────
 *
 * `canvas-resources-sync` in app_config (server/repos/appConfigDocs.ts, a key
 * nothing caches) records where the shelf came from and when: the date of the
 * last good read of the database, or the date the shipped snapshot was taken.
 * The Learn frame prints that date, so "is this up to date?" (Rye's question,
 * plan 5.8) is answered on the page.
 */
import crypto from "node:crypto";
import type { Pool } from "mysql2/promise";
import snapshot from "../seeds/canvas-resources.json";
import { parseCsvDetailed } from "../../shared/csv";
import {
  CANVAS_DATABASE,
  readCanvasDatabase,
  type CanvasResourceInput,
  type CanvasResourceView,
  type ResourceSurface,
} from "../../shared/canvasResources";
import { confirmedBlocksFor, placingOf, safetyExcluded, suggestBlocks } from "../../shared/canvasResourceTags";
import type { CanvasBlockId } from "../../shared/governanceCanvas";
import { checkToolLink, guardedFetchText, type LinkCheckResult } from "./toolcheck";
import { boolVar, stringVar } from "./variables";
import { readConfigDocument, writeConfigDocument } from "../repos/appConfigDocs";
import {
  linkCheckTargets,
  liveResources,
  recordLinkCheck,
  shelfIsEmpty,
  writeShelf,
  type ShelfRow,
  type StoredResource,
} from "../repos/canvasResources";

export const SYNC_JOB = "canvas-resources-sync";
export const LINK_CHECK_JOB = "canvas-resources-link-check";
export const DAY_MS = 24 * 60 * 60 * 1000;
/** The dial that lets the village read the database at all, and check its links. */
export const SYNC_DIAL = "canvas.resources_sync";
/** The dial holding BWL's suggestion form, empty until a village sets it. */
export const SUGGEST_DIAL = "canvas.suggest_url";
/** The app_config key the freshness record lives under. */
export const SYNC_STATE_KEY = "canvas-resources-sync";

/** The CSV address: CANVAS_DB_URL when set (tests, or a fork's own mirror), otherwise the database's own. */
export function canvasDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.CANVAS_DB_URL?.trim() || CANVAS_DATABASE.csvUrl;
}

/** The table's primary key: the SHA-1 of the resource's normalised name and address. */
export function resourceKey(identity: string): string {
  return crypto.createHash("sha1").update(identity, "utf8").digest("hex");
}

/** A normalised row, with its key and its block tags, as the shelf stores it. */
export function toShelfRow(r: CanvasResourceInput): ShelfRow {
  return {
    resourceKey: resourceKey(r.identity),
    nameSlug: r.nameSlug,
    name: r.name,
    type: r.type,
    authors: r.authors,
    description: r.description,
    keywords: r.keywords,
    url: r.url,
    linkPending: r.linkPending,
    tagsSuggested: suggestBlocks(r.keywords),
    tagsConfirmed: confirmedBlocksFor(r.nameSlug),
  };
}

// ── The freshness record ────────────────────────────────────────────────────

export interface SyncState {
  /** Where the rows on the shelf came from last. */
  source: "database" | "snapshot";
  /** ISO instant of the last good read of the database, or null when there has been none. */
  lastReadAt: string | null;
  /** The date the shipped snapshot was taken, once it has been loaded. */
  snapshotTaken: string | null;
  /** ISO instant of the last attempt to read the database. */
  lastAttemptAt: string | null;
  lastOutcome: "read" | "refused" | "failed" | "snapshot";
  /** Why the last attempt wrote nothing, in words, or null. */
  lastProblem: string | null;
}

export async function readSyncState(pool: Pool): Promise<SyncState | null> {
  return readConfigDocument<SyncState>(pool, SYNC_STATE_KEY);
}

async function recordState(pool: Pool, change: Partial<SyncState>): Promise<void> {
  const was = await readSyncState(pool);
  const next: SyncState = {
    source: "snapshot",
    lastReadAt: null,
    snapshotTaken: null,
    lastAttemptAt: null,
    lastOutcome: "snapshot",
    lastProblem: null,
    ...(was ?? {}),
    ...change,
  };
  await writeConfigDocument(pool, SYNC_STATE_KEY, next as unknown as Record<string, unknown>);
}

// ── The snapshot ────────────────────────────────────────────────────────────

interface SnapshotDoc {
  taken: string;
  header: string[];
  rows: string[][];
}

/** The shipped snapshot as a table, header first: the shape `parseCsv` returns. */
export function snapshotTable(doc: SnapshotDoc = snapshot as SnapshotDoc): string[][] {
  return [doc.header, ...doc.rows];
}

/** The date the shipped snapshot was taken. */
export const SNAPSHOT_TAKEN: string = (snapshot as SnapshotDoc).taken;

/**
 * A snapshot's date as an instant the page can print: noon UTC, so the day
 * printed is the day it was taken in every zone from UTC-11 to UTC+11. A bare
 * date parses as midnight UTC and prints as the day before across the Americas.
 */
export function snapshotInstant(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00.000Z` : date;
}

/**
 * Load the shipped snapshot, if and only if the shelf holds no row at all.
 * A shelf that has ever been read keeps what it has: a snapshot is older than
 * any read and would only move it backwards. Returns whether it loaded.
 */
export async function loadSnapshotIfEmpty(pool: Pool): Promise<boolean> {
  if (!(await shelfIsEmpty(pool))) return false;
  const read = readCanvasDatabase(snapshotTable());
  // The snapshot is ours and a test holds it to the header check, so this is a broken build.
  if (!read.ok) throw new Error(`The shipped canvas resources snapshot does not read: ${read.refusal}`);
  await writeShelf(pool, read.resources.map(toShelfRow), "snapshot", false);
  const was = await readSyncState(pool);
  await recordState(pool, {
    snapshotTaken: SNAPSHOT_TAKEN,
    ...(was?.lastReadAt ? {} : { source: "snapshot" as const, lastOutcome: "snapshot" as const }),
  });
  return true;
}

// ── The nightly read ────────────────────────────────────────────────────────

export interface SyncDeps {
  pool: Pool;
  /** The fetch. Defaults to `guardedFetchText` with the plan's 15 seconds and 1 MB. */
  fetchText?: (url: string) => Promise<string>;
  /** Whether the dial allows a read. Defaults to `canvas.resources_sync`. */
  syncOn?: () => boolean;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

const defaultFetch = (url: string) => guardedFetchText(url, 15_000, 1_000_000);
const said = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200);

/**
 * One read of the database. Resolves to the line the scheduler records when
 * it wrote (or was switched off); THROWS with the reason when it wrote
 * nothing, so the failures report and the admins hear about it.
 */
export async function syncCanvasResources(deps: SyncDeps): Promise<string> {
  const { pool } = deps;
  const syncOn = deps.syncOn ?? (() => boolVar(SYNC_DIAL));
  if (!syncOn()) return `off: the dial ${SYNC_DIAL} is off, so the database was not read`;

  const attemptAt = (deps.now?.() ?? new Date()).toISOString();
  const refuse = async (problem: string, outcome: "refused" | "failed"): Promise<never> => {
    const loaded = await loadSnapshotIfEmpty(pool);
    await recordState(pool, { lastAttemptAt: attemptAt, lastOutcome: outcome, lastProblem: problem });
    throw new Error(
      problem + (loaded ? " The shelf was empty, so the snapshot shipped with the platform was loaded instead." : ""),
    );
  };

  let text: string;
  try {
    text = await (deps.fetchText ?? defaultFetch)(canvasDatabaseUrl(deps.env));
  } catch (e) {
    return refuse(
      `Could not read the Governance Canvas Database (${said(e)}). Nothing was written, and the shelf keeps the resources it had.`,
      "failed",
    );
  }

  const parsed = parseCsvDetailed(text);
  if (parsed.problems.length) {
    return refuse(
      `The Governance Canvas Database answered with text that is not clean CSV (${parsed.problems[0]}). ` +
        "Nothing was written, and the shelf keeps the resources it had.",
      "refused",
    );
  }
  const read = readCanvasDatabase(parsed.rows);
  if (!read.ok) return refuse(read.refusal, "refused");

  const { withdrawn } = await writeShelf(pool, read.resources.map(toShelfRow), "database", true);
  await recordState(pool, { source: "database", lastReadAt: attemptAt, lastAttemptAt: attemptAt, lastOutcome: "read", lastProblem: null });
  return `read ${read.resources.length} resources from the database; ${withdrawn} newly withdrawn`;
}

// ── The link check ──────────────────────────────────────────────────────────

export interface LinkCheckDeps {
  pool: Pool;
  /** Defaults to `checkToolLink`, the tools registry's own guarded checker. */
  check?: (url: string) => Promise<LinkCheckResult>;
  syncOn?: () => boolean;
  /** Stop starting new checks after this long. Whatever is left waits for tomorrow. */
  budgetMs?: number;
  concurrency?: number;
}

/**
 * Check every live address once. Four at a time and inside a budget, because
 * a scheduler tick runs its jobs one after another and a slow host must not
 * hold the village's other jobs back. Covered by the same dial as the read:
 * a village that switched the database off sends no request to the
 * resources' hosts either.
 */
export async function checkResourceLinks(deps: LinkCheckDeps): Promise<string> {
  const syncOn = deps.syncOn ?? (() => boolVar(SYNC_DIAL));
  if (!syncOn()) return `off: the dial ${SYNC_DIAL} is off, so no address was checked`;
  const check = deps.check ?? checkToolLink;
  const targets = await linkCheckTargets(deps.pool);
  const until = Date.now() + (deps.budgetMs ?? 90_000);
  const found = { ok: 0, broken: 0, refused: 0 };
  let next = 0;
  const worker = async () => {
    while (next < targets.length && Date.now() < until) {
      const target = targets[next++];
      let result: LinkCheckResult;
      try {
        result = await check(target.url);
      } catch {
        result = { ok: false, status: null };
      }
      const state = result.refused ? "refused" : result.ok ? "ok" : "broken";
      found[state] += 1;
      await recordLinkCheck(deps.pool, target.resourceKey, state);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, deps.concurrency ?? 4) }, worker));
  const left = targets.length - found.ok - found.broken - found.refused;
  return (
    `checked ${targets.length - left} addresses: ${found.ok} answered, ${found.broken} did not, ${found.refused} refused by the guard` +
    (left ? `; ${left} left for the next run` : "")
  );
}

// ── What the Learn frame reads ──────────────────────────────────────────────

const PLACING_ORDER = { village: 0, platform: 1, suggested: 2 } as const;

/**
 * The resources that show under `block` in this village, as the page renders
 * them: the village's own placings first, then the platform's, then the
 * suggestions, each by name. A safety surface never carries an NVC row
 * (`safetyExcluded`, shared/canvasResourceTags.ts).
 */
export function resourcesForBlock(
  rows: readonly StoredResource[],
  block: CanvasBlockId,
  surface: ResourceSurface,
): CanvasResourceView[] {
  const out: Array<CanvasResourceView & { rank: number }> = [];
  for (const r of rows) {
    if (surface === "safety" && safetyExcluded(r)) continue;
    const placing = placingOf({ nameSlug: r.nameSlug, local: r.tagsLocal, keywords: r.keywords });
    if (!placing.blocks.includes(block)) continue;
    out.push({
      rank: PLACING_ORDER[placing.by],
      key: r.resourceKey,
      name: r.name,
      type: r.type,
      authors: r.authors,
      description: r.description,
      keywords: r.keywords,
      url: r.url,
      linkPending: r.linkPending,
      link: r.link,
      linkCheckedAt: r.linkCheckedAt,
      placing: { by: placing.by, keyword: placing.keywords[block] ?? null },
      blocks: placing.blocks,
    });
  }
  out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return out.map(({ rank: _rank, ...view }) => view);
}

/** BWL's suggestion form, when the village has set one and it is an https address. Null otherwise. */
export function suggestFormUrl(read: () => string = () => stringVar(SUGGEST_DIAL)): string | null {
  const raw = String(read() ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw).protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

/** The live shelf, loading the snapshot first when the shelf has never held a row. */
export async function shelfForReading(pool: Pool): Promise<StoredResource[]> {
  await loadSnapshotIfEmpty(pool);
  return liveResources(pool);
}
