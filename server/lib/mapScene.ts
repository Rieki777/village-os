/**
 * Draft, publish, and undo for the Living Map (0063).
 *
 * ── THE SCENE IS A STRING HERE, EVERYWHERE ───────────────────────────────
 * Every function in this file takes and returns the scene as the exact JSON
 * TEXT the map sent. It is never parsed on the way in, never re-serialised on
 * the way out, and never rebuilt field by field. That is the one rule this
 * module exists to keep, and it is kept by never having a shape to lose parts
 * from: `shared/mapScene.ts` validates the envelope, `longtext` stores the
 * body, and the map is the only thing that ever interprets it.
 *
 * Round D ended with four bugs that were one bug, and the one bug was a value
 * losing the parts the far side had no slot for. A scene has twenty blocks and
 * hundreds of nested fields. The way to not be the fifth instance is to not
 * have a far side.
 *
 * ── THE RACE IS SETTLED BY THE DATABASE ──────────────────────────────────
 * `publishScene` does not read the live version and then write. It inserts
 * with `base_version` set to the version the draft forked from, and that
 * column is UNIQUE, so two admins publishing from the same base means the
 * second insert fails with ER_DUP_ENTRY and is told what moved. A read
 * followed by a write would have a window between them, and the window is
 * exactly where "I published and my change vanished" comes from.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { SceneChange } from "../../shared/mapScene";

export interface PublishedScene {
  version: number;
  /** The scene as stored: the map's own JSON text, untouched. */
  scene: string;
  actorUserId: string | null;
  note: string | null;
  summary: SceneChange[];
  restoredFrom: number | null;
  createdAt: string;
}

/** A history row WITHOUT the scene body, which is megabytes and never listed. */
export interface RevisionRow {
  version: number;
  baseVersion: number;
  actorUserId: string | null;
  note: string | null;
  summary: SceneChange[];
  restoredFrom: number | null;
  createdAt: string;
}

export interface DraftRow {
  scene: string;
  baseVersion: number;
  updatedAt: string;
}

export type PublishResult =
  | { ok: true; version: number }
  | {
      ok: false;
      reason: "stale";
      /** What is actually live now, so the caller can say who moved it. */
      live: { version: number; actorUserId: string | null; createdAt: string };
    };

/**
 * A `json` column arrives parsed from mysql2 in some configurations and as
 * text in others. Both are handled, and anything unreadable degrades to an
 * empty list: a missing changelog must never cost a founder their history.
 */
function readSummary(value: unknown): SceneChange[] {
  if (Array.isArray(value)) return value as SceneChange[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * The live map: the newest revision, or null when this village has never
 * published and is still running the artifact's own seed.
 */
export async function publishedScene(pool: Pool): Promise<PublishedScene | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT version, scene, actor_user_id, note, summary, restored_from, created_at " +
      "FROM map_scene_revisions ORDER BY version DESC LIMIT 1",
  );
  const r = rows[0];
  if (!r) return null;
  return {
    version: Number(r.version),
    scene: String(r.scene),
    actorUserId: r.actor_user_id ?? null,
    note: r.note ?? null,
    summary: readSummary(r.summary),
    restoredFrom: r.restored_from == null ? null : Number(r.restored_from),
    createdAt: String(r.created_at),
  };
}

/**
 * The live version number alone, without hauling a scene out of the database
 * to learn it. 0 means nothing has ever been published, which is the base a
 * first draft forks from.
 */
export async function publishedVersion(pool: Pool): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COALESCE(MAX(version), 0) AS v FROM map_scene_revisions",
  );
  return Number(rows[0]?.v ?? 0);
}

export async function getDraft(pool: Pool, userId: string): Promise<DraftRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT scene, base_version, updated_at FROM map_scene_drafts WHERE user_id = ?",
    [userId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    scene: String(r.scene),
    baseVersion: Number(r.base_version),
    updatedAt: String(r.updated_at),
  };
}

/**
 * The draft to OFFER, which is not the same as the draft that EXISTS.
 *
 * `publishScene` rebases the member's draft on success, deliberately: the
 * work under their hands is the same work a second later, now forked from
 * what they just made live, so pressing publish twice is harmless and
 * nothing vanishes at the moment they were told it worked.
 *
 * The cost is that a draft row then ALWAYS exists, and a reader that treats
 * "a row exists" as "there is unpublished work" is wrong every time after a
 * publish. Amora met this: the map drew
 *
 *   "You have an unpublished draft of the map: 23 buildings, 53 changes."
 *
 * over a draft byte-identical to the version just published, because the
 * count is the scene's whole edit log rather than a difference.
 *
 * It is worse than a wrong sentence. The artifact resolves a conflict by
 * letting the SERVER'S copy win over the browser-saved session, so a member
 * who kept editing after publishing is offered the published state as "my
 * draft", and taking it discards the newer work in front of them. That is
 * how a map that saved correctly is experienced as one that did not.
 *
 * Compared as TEXT. `publishScene` stores the exact string the map wrote and
 * the rebase writes that same string, so this is the same equality the
 * publish established; parsing both would spend megabytes to answer a
 * question the bytes already answer.
 */
export function pendingDraft<T extends { scene: string }>(
  draft: T | null,
  liveScene: string | null | undefined,
): T | null {
  if (!draft) return null;
  return draft.scene === liveScene ? null : draft;
}

/**
 * Write a member's working copy.
 *
 * One row per person, replaced wholesale on every autosave. There is no
 * history of drafts on purpose: a draft is the state of someone's hands, and
 * the thing worth keeping forever is what they decided to make live.
 */
export async function saveDraft(
  pool: Pool,
  userId: string,
  scene: string,
  baseVersion: number,
): Promise<void> {
  await pool.query(
    "INSERT INTO map_scene_drafts (user_id, scene, base_version) VALUES (?,?,?) " +
      "ON DUPLICATE KEY UPDATE scene = VALUES(scene), base_version = VALUES(base_version)",
    [userId, scene, baseVersion],
  );
}

/** Returns whether there was one to discard, so the caller can be honest. */
export async function discardDraft(pool: Pool, userId: string): Promise<boolean> {
  const [r]: any = await pool.query("DELETE FROM map_scene_drafts WHERE user_id = ?", [userId]);
  return (r?.affectedRows ?? 0) > 0;
}

/**
 * Make a scene the live map.
 *
 * `baseVersion` is the version the draft forked from. If the live map has
 * moved since, the UNIQUE index on `base_version` refuses the insert and this
 * returns what is live instead, WITHOUT writing anything. The caller turns
 * that into a sentence naming who published and when.
 *
 * The draft is deliberately NOT deleted here. A publish that succeeds leaves
 * the member's copy where it is, rebased by the route, so the thing under
 * their hands never disappears at the moment they were told it worked.
 */
export async function publishScene(
  pool: Pool,
  input: {
    scene: string;
    baseVersion: number;
    actorUserId: string | null;
    note?: string | null;
    summary?: SceneChange[];
    restoredFrom?: number | null;
  },
): Promise<PublishResult> {
  try {
    const [r]: any = await pool.query(
      "INSERT INTO map_scene_revisions (scene, base_version, actor_user_id, note, summary, restored_from) " +
        "VALUES (?,?,?,?,?,?)",
      [
        input.scene,
        input.baseVersion,
        input.actorUserId,
        input.note ?? null,
        JSON.stringify(input.summary ?? []),
        input.restoredFrom ?? null,
      ],
    );
    return { ok: true, version: Number(r.insertId) };
  } catch (e: any) {
    if (e?.code !== "ER_DUP_ENTRY") throw e;
    /*
     * Someone else published from the same base between this member opening
     * their draft and pressing the button. Report the live map as it now
     * stands. A null here would mean the row vanished, which cannot happen
     * (nothing deletes revisions), so the fallback is defensive only.
     */
    const live = await publishedScene(pool);
    return {
      ok: false,
      reason: "stale",
      live: live
        ? { version: live.version, actorUserId: live.actorUserId, createdAt: live.createdAt }
        : { version: 0, actorUserId: null, createdAt: "" },
    };
  }
}

/**
 * The history, newest first, WITHOUT the scenes.
 *
 * Selecting `scene` here would pull every published megabyte into memory to
 * render a list of dates. The body is fetched one version at a time by
 * `revisionScene`, which is the only thing that needs it.
 */
export async function listRevisions(pool: Pool, limit = 50): Promise<RevisionRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT version, base_version, actor_user_id, note, summary, restored_from, created_at " +
      "FROM map_scene_revisions ORDER BY version DESC LIMIT ?",
    [Math.min(200, Math.max(1, limit))],
  );
  return rows.map((r) => ({
    version: Number(r.version),
    baseVersion: Number(r.base_version),
    actorUserId: r.actor_user_id ?? null,
    note: r.note ?? null,
    summary: readSummary(r.summary),
    restoredFrom: r.restored_from == null ? null : Number(r.restored_from),
    createdAt: String(r.created_at),
  }));
}

export async function revisionScene(pool: Pool, version: number): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT scene FROM map_scene_revisions WHERE version = ?",
    [version],
  );
  return rows[0] ? String(rows[0].scene) : null;
}

/**
 * Put an earlier version back.
 *
 * An undo is a PUBLISH carrying an old scene, never a delete and never a
 * mutation. The history keeps growing forwards, `restored_from` records what
 * this row is putting back, and the version that was live when someone
 * decided to undo it is still there to go back to. Same append-only rule the
 * ledger and badge_events keep, and it is what makes an undo safe to press
 * when you are not certain.
 *
 * The race is handled exactly as an ordinary publish: the base is read here,
 * and if another publish lands in between, the UNIQUE index refuses this one.
 */
export async function restoreRevision(
  pool: Pool,
  version: number,
  actorUserId: string | null,
): Promise<PublishResult | { ok: false; reason: "missing" }> {
  const scene = await revisionScene(pool, version);
  if (scene === null) return { ok: false, reason: "missing" };
  const base = await publishedVersion(pool);
  if (base === version) {
    // Already live. Publishing an identical scene would add a revision that
    // changed nothing, so say it landed and write no row.
    return { ok: true, version };
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT summary FROM map_scene_revisions WHERE version = ?",
    [version],
  );
  return publishScene(pool, {
    scene,
    baseVersion: base,
    actorUserId,
    note: `Restored version ${version}`,
    summary: readSummary(rows[0]?.summary),
    restoredFrom: version,
  });
}
