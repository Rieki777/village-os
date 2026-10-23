/**
 * `update_circle`: A CIRCLE'S WORDS, CHANGED BY CONSENT THROUGH AN ORG DRAFT.
 *
 * Rye, 2026-10-22: a circle card's words (the CCOS Circle Charter in plain
 * words) belong to the circle, so they change the way a role's words do: a
 * proposal opens an org draft, and the draft is adopted through the doors
 * every reorganisation uses (an admin, the role holding the power to change
 * the structure, or a village vote; server/lib/orgDraftDecide.ts).
 *
 * The draft machinery (server/lib/orgDrafts.ts) calls the four hooks below:
 *
 *   previewCircleWords   the line a reader sees, and why it is blocked
 *   captureCircleWords   what was there, for `before_json`
 *   applyCircleWords     the write, after the payload is parsed again
 *   revertCircleWords    put back what was there, only while it still stands
 *
 * The change names its circle as `circle:<id>`, the convention every circle
 * op keeps (0208). The payload names only the fields it changes, parsed by
 * the one parser (shared/circleCharterParse.ts) at every door.
 */
import type { PoolConnection } from "mysql2/promise";
import { charterFromRow, type CharterField } from "../../shared/circleCharter";
import { CIRCLE_WORD_REFUSALS } from "../../shared/circleCardWords";
import { circleWordLabel, circleWordKeysOf, parseCircleWords, type CircleWordKey, type CircleWordsPayload } from "../../shared/circleCharterParse";
import { readCircleWords, writeCharterFields, writeCirclePurpose, type CircleWordsBefore } from "../repos/circleCharters";

export const UPDATE_CIRCLE = "update_circle" as const;

const circleIdOf = (orgRoleId: string): string => (orgRoleId.startsWith("circle:") ? orgRoleId.slice("circle:".length) : orgRoleId);

/** "New words for the circle "Garden circle": why it exists and what we look after". */
export function circleWordsLine(circleName: string, payload: unknown): string {
  const keys = circleWordKeysOf(payload);
  const named = keys.map((k) => circleWordLabel(k).toLowerCase());
  return named.length ? `New words for the circle "${circleName}": ${named.join(", ")}` : `New words for the circle "${circleName}"`;
}

/**
 * The preview line for an `update_circle` change, checked against the circles
 * as this draft has left them so far, so a draft that creates a circle may
 * also give it words.
 */
export function previewCircleWords(
  change: { orgRoleId: string; payload: unknown },
  circles: ReadonlyArray<{ id: string; name: string; isExample?: boolean }>,
): { reads: string; blocked: string | null } {
  const circleId = circleIdOf(change.orgRoleId);
  const circle = circles.find((x) => x.id === circleId);
  const reads = circleWordsLine(circle?.name ?? circleId, change.payload);
  if (!circle) return { reads, blocked: "That circle does not exist" };
  if (circle.isExample) return { reads, blocked: CIRCLE_WORD_REFUSALS.example };
  const parsed = parseCircleWords(change.payload);
  return { reads, blocked: parsed.ok ? null : parsed.problem };
}

/** `before_json` for an `update_circle` change: the purpose and the charter row as they stood. */
export async function captureCircleWords(conn: PoolConnection, orgRoleId: string): Promise<CircleWordsBefore> {
  return readCircleWords(conn, circleIdOf(orgRoleId));
}

function charterValues(p: CircleWordsPayload): Partial<Record<CharterField, unknown>> {
  const out: Partial<Record<CharterField, unknown>> = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === "purpose") continue;
    out[k as CharterField] = v;
  }
  return out;
}

/**
 * The write. The payload is parsed again inside the transaction, so a change
 * that would not preview cannot publish by any other door, and a refusal
 * throws, which rolls the whole draft back with its reason.
 */
export async function applyCircleWords(conn: PoolConnection, change: { orgRoleId: string; draftId: string; payload: unknown }): Promise<void> {
  const circleId = circleIdOf(change.orgRoleId);
  const parsed = parseCircleWords(change.payload);
  if (!parsed.ok) throw new Error(parsed.problem);
  const now = await readCircleWords(conn, circleId);
  if (!now.exists) throw new Error("That circle does not exist");
  if (now.isExample) throw new Error(CIRCLE_WORD_REFUSALS.example);
  if (parsed.value.purpose !== undefined) await writeCirclePurpose(conn, circleId, parsed.value.purpose);
  await writeCharterFields(conn, circleId, charterValues(parsed.value), change.draftId);
}

/** A field's value as the card reads it, so "what this draft wrote" and "what stands now" compare like for like. */
function standing(words: CircleWordsBefore, key: CircleWordKey): string {
  if (key === "purpose") return JSON.stringify(words.purpose?.trim() || null);
  return JSON.stringify(charterFromRow(words.charter)[key] ?? null);
}

/**
 * Put back what was there, for the fields this draft named.
 *
 * UNDO ONLY WHAT IS STILL THERE, the rule `move_circle` keeps: if a later
 * draft has changed one of these words since, putting the old words back
 * would silently throw that later change away while it goes on saying it was
 * adopted. The revert refuses with the field's name instead.
 */
export async function revertCircleWords(
  conn: PoolConnection,
  change: { orgRoleId: string; draftId: string; payload: unknown; beforeJson: unknown },
): Promise<void> {
  const before = change.beforeJson as CircleWordsBefore | null;
  if (!before) return;
  const circleId = circleIdOf(change.orgRoleId);
  const parsed = parseCircleWords(change.payload);
  if (!parsed.ok) return;
  const now = await readCircleWords(conn, circleId);
  if (!now.exists) throw new Error(`These words cannot be undone: the circle "${circleId}" is no longer in the village.`);
  for (const key of circleWordKeysOf(parsed.value)) {
    const wrote = JSON.stringify((parsed.value as Record<string, unknown>)[key] ?? null);
    if (standing(now, key) !== wrote) {
      throw new Error(`These words cannot be undone as things stand. "${circleWordLabel(key)}" has changed again since, and undoing this would throw that later change away.`);
    }
  }
  if (parsed.value.purpose !== undefined) await writeCirclePurpose(conn, circleId, before.purpose ?? null);
  const old = charterFromRow(before.charter);
  const back: Partial<Record<CharterField, unknown>> = {};
  for (const key of Object.keys(charterValues(parsed.value)) as CharterField[]) back[key] = old[key];
  await writeCharterFields(conn, circleId, back, null);
}
