/**
 * A VILLAGE'S WORDS: which version of each email is live, every version it
 * has saved, and the platform's own words beside them (the comms build spec
 * 5.5). The Words screen's routes and every render read through here.
 *
 * WHERE WORDS COME FROM. A village's live row when it holds one, else the
 * platform default (`shared/comms/defaults/templates.ts`), else, for a path a
 * fork added of its own, the platform's generic path words. A key that is
 * none of these has no words, and saying so is the caller's answer.
 *
 * ADOPTING. A village holds no copy of anything until it acts. Saving an edit
 * copies the platform words in first (with `platform_version` set) and then
 * the edit, in one transaction, so its history starts where its words did.
 * Turning a journey on calls `ensureAdopted`, which copies the platform words
 * of every email the journey sends and touches nothing the village already
 * holds. From then on the village's words are its own: a newer platform
 * default never replaces them by itself (5.5).
 *
 * THE UPGRADE FLAG. "An improved version is available" is true exactly when
 * the village holds a live copy and the platform default for that key has a
 * higher version than the copy came from. A village still reading the
 * platform's words already has the newest; a village whose words came from no
 * platform default has nothing to upgrade to.
 *
 * NO RAW SQL HERE. Every statement is in server/repos/commsTemplates.ts.
 */
import type { Pool } from "mysql2/promise";
import { platformTemplate, type DefaultTemplate } from "../../../shared/comms/defaults/templates";
import { fieldProblems } from "../../../shared/comms/mergeFields";
import {
  appendTemplateVersions,
  insertFirstVersion,
  liveTemplateRow,
  liveTemplateRows,
  makeVersionLive,
  templateVersionRows,
  type TemplateRow,
} from "../../repos/commsTemplates";

/** The words of one email, wherever they came from. */
export interface TemplateWords {
  subject: string;
  preheader: string | null;
  bodyMd: string;
  layout: string;
  /** The version rendered: the village's own row, or the platform default's. Null for an unsaved draft. */
  version: number | null;
  source: "village" | "platform" | "draft";
  /** The platform default these came from. */
  platformVersion: number | null;
}

/** Longest words a template may hold. The columns are wider; an email is not. */
export const WORDS_LIMITS = { subject: 200, preheader: 200, bodyMd: 20_000 } as const;

const fromDefault = (d: DefaultTemplate): TemplateWords => ({
  subject: d.subject,
  preheader: d.preheader,
  bodyMd: d.bodyMd,
  layout: d.layout,
  version: d.version,
  source: "platform",
  platformVersion: d.version,
});

const fromRow = (r: TemplateRow): TemplateWords => ({
  subject: r.subject,
  preheader: r.preheader,
  bodyMd: r.bodyMd,
  layout: r.layout,
  version: r.version,
  source: "village",
  platformVersion: r.platformVersion,
});

/** The words that would be sent for a key right now, or null when the key has none anywhere. */
export async function readLiveWords(pool: Pool, templateKey: string): Promise<TemplateWords | null> {
  const row = await liveTemplateRow(pool, templateKey);
  if (row) return fromRow(row);
  const def = platformTemplate(templateKey);
  return def ? fromDefault(def) : null;
}

/** True when the platform has newer words than the village's live copy came from. */
export function upgradeAvailable(live: { source: string; platformVersion: number | null } | null, def: { version: number } | null): boolean {
  if (!live || live.source !== "village" || !def) return false;
  if (live.platformVersion === null) return false;
  return def.version > live.platformVersion;
}

export interface WordsSummary {
  key: string;
  subject: string;
  source: "village" | "platform";
  version: number;
  platformVersion: number | null;
  upgradeAvailable: boolean;
}

/** One line per key for the Words list: the given keys in order, then any key only the village holds. */
export async function listWords(pool: Pool, keys: readonly string[]): Promise<WordsSummary[]> {
  const live = new Map((await liveTemplateRows(pool)).map((r) => [r.templateKey, r]));
  const out: WordsSummary[] = [];
  const seen = new Set<string>();
  for (const key of [...keys, ...Array.from(live.keys()).sort()]) {
    if (seen.has(key)) continue;
    seen.add(key);
    const row = live.get(key);
    const def = platformTemplate(key);
    if (row) {
      const words = fromRow(row);
      out.push({ key, subject: row.subject, source: "village", version: row.version, platformVersion: row.platformVersion, upgradeAvailable: upgradeAvailable(words, def) });
    } else if (def) {
      out.push({ key, subject: def.subject, source: "platform", version: def.version, platformVersion: def.version, upgradeAvailable: false });
    }
  }
  return out;
}

export interface WordsDetail {
  key: string;
  live: TemplateWords;
  /** The platform's current words for this key, when it has any. */
  platform: TemplateWords | null;
  upgradeAvailable: boolean;
  versions: Array<{
    version: number;
    state: "live" | "retired";
    subject: string;
    preheader: string | null;
    bodyMd: string;
    platformVersion: number | null;
    editedBy: string | null;
    editedByName: string | null;
    /** Epoch seconds. */
    createdAt: number;
  }>;
}

/** Everything the editor shows for one key, or null when the key has no words anywhere. */
export async function wordsDetail(pool: Pool, templateKey: string): Promise<WordsDetail | null> {
  const live = await readLiveWords(pool, templateKey);
  if (!live) return null;
  const def = platformTemplate(templateKey);
  const versions = (await templateVersionRows(pool, templateKey)).map((r) => ({
    version: r.version,
    state: r.state,
    subject: r.subject,
    preheader: r.preheader,
    bodyMd: r.bodyMd,
    platformVersion: r.platformVersion,
    editedBy: r.editedBy,
    editedByName: r.editedByName,
    createdAt: r.createdAt,
  }));
  return { key: templateKey, live, platform: def ? fromDefault(def) : null, upgradeAvailable: upgradeAvailable(live, def), versions };
}

/** A draft as an editor sends it. */
export interface WordsDraft {
  subject: string;
  preheader: string | null;
  bodyMd: string;
}

/**
 * Read a draft out of a request body, trimmed and typed, or the reasons it
 * cannot be saved. Every token is checked against the catalogue for THIS
 * email, so a field the email never knows is refused with a sentence before
 * it can render its fallback to every reader.
 */
export function readDraft(templateKey: string, body: unknown): { draft: WordsDraft } | { problems: string[] } {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const subject = typeof b.subject === "string" ? b.subject.trim() : "";
  const preheaderRaw = typeof b.preheader === "string" ? b.preheader.trim() : "";
  const bodyMd = typeof b.bodyMd === "string" ? b.bodyMd.replace(/\r\n?/g, "\n").trim() : "";
  const problems: string[] = [];
  if (!subject) problems.push("Write a subject line.");
  if (subject.length > WORDS_LIMITS.subject) problems.push(`Keep the subject under ${WORDS_LIMITS.subject} characters.`);
  if (preheaderRaw.length > WORDS_LIMITS.preheader) problems.push(`Keep the preview line under ${WORDS_LIMITS.preheader} characters.`);
  if (!bodyMd) problems.push("Write the email itself.");
  if (bodyMd.length > WORDS_LIMITS.bodyMd) problems.push(`Keep the email under ${WORDS_LIMITS.bodyMd} characters.`);
  const { unknown, unavailable } = fieldProblems(templateKey, `${subject}\n${preheaderRaw}\n${bodyMd}`);
  for (const key of unknown) problems.push(`{{${key}}} is not a field. Pick one from the list.`);
  for (const key of unavailable) problems.push(`{{${key}}} is never known when this email is sent. Pick one from the list.`);
  if (problems.length) return { problems };
  return { draft: { subject, preheader: preheaderRaw || null, bodyMd } };
}

const versionOf = (words: { subject: string; preheader: string | null; bodyMd: string; layout: string }, platformVersion: number | null, editedBy: string | null) => ({
  subject: words.subject,
  preheader: words.preheader,
  bodyMd: words.bodyMd,
  layout: words.layout,
  platformVersion,
  editedBy,
});

/**
 * Save an edit as a new live version, retiring the old one. A village saving
 * its first edit of a key adopts the platform words first, in the same
 * transaction, so its history starts at the platform's version. Answers the
 * new live version, or null when the key has no words to start from.
 */
export async function saveWords(pool: Pool, templateKey: string, draft: WordsDraft, editedBy: string | null): Promise<number | null> {
  const live = await readLiveWords(pool, templateKey);
  if (!live) return null;
  const edit = versionOf({ ...draft, layout: live.layout }, live.platformVersion, editedBy);
  const batch = live.source === "platform" ? [versionOf(live, live.platformVersion, null), edit] : [edit];
  const written = await appendTemplateVersions(pool, templateKey, batch);
  return written[written.length - 1] ?? null;
}

/** Make an old version live again. False when there is no such version. */
export function restoreWords(pool: Pool, templateKey: string, version: number): Promise<boolean> {
  return makeVersionLive(pool, templateKey, version);
}

/**
 * Take the platform's current words as a new live version, keeping every old
 * one. Answers the new version, or null when the platform has no words for
 * this key.
 */
export async function adoptPlatformWords(pool: Pool, templateKey: string, editedBy: string | null): Promise<number | null> {
  const def = platformTemplate(templateKey);
  if (!def) return null;
  const [version] = await appendTemplateVersions(pool, templateKey, [versionOf(def, def.version, editedBy)]);
  return version ?? null;
}

/**
 * Copy the platform words of each key the village does not yet hold, so a
 * journey being turned on runs on words the village owns. Keys it already
 * holds are left exactly as they are. Answers the keys it copied. For the
 * journeys lane, which calls it from the "Turn on" button.
 */
export async function ensureAdopted(pool: Pool, keys: readonly string[], editedBy: string | null = null): Promise<string[]> {
  const copied: string[] = [];
  for (const key of keys) {
    const def = platformTemplate(key);
    if (!def) continue;
    if (await insertFirstVersion(pool, key, versionOf(def, def.version, editedBy))) copied.push(key);
  }
  return copied;
}
