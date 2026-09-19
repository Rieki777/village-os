/**
 * What an accept on /review left behind, read into lines a steward can act on.
 *
 * Moved out of client/src/pages/Review.tsx unchanged, when the consent section
 * and the batch change limit met on that page and it crossed the 1000-line
 * threshold scripts/check-file-lines.mjs holds client files to. These are pure
 * readers of the server's `ignored` and `blockedLines` lists. The page keeps
 * every state and every card that uses them.
 */
/** One line per proposal whose accept left keys out of the draft. */
export interface NotReadLine {
  label: string;
  keys: string[];
}

/**
 * The server's `ignored` list, as lines a steward can read.
 *
 * Each proposal is named by its seat where the payload gives one, under the
 * same spellings the server reads, so a vendor record that says `role_name`
 * is still called by its name. An absent or malformed list is no lines, which
 * is what an older server that never sent one should produce.
 */
export function notReadLines(
  ignored: unknown,
  payloadOf: (proposalId: string) => Record<string, unknown> | undefined,
): NotReadLine[] {
  if (!Array.isArray(ignored)) return [];
  const lines: NotReadLine[] = [];
  for (const entry of ignored as { proposalId?: unknown; keys?: unknown }[]) {
    const keys = Array.isArray(entry?.keys) ? entry.keys.map(String) : [];
    if (!entry?.proposalId || keys.length === 0) continue;
    const id = String(entry.proposalId);
    const payload = payloadOf(id);
    let label = id;
    for (const k of ["name", "role_name", "roleName", "title"]) {
      const v = payload?.[k];
      if (typeof v === "string" && v.trim() !== "") {
        label = v.trim();
        break;
      }
    }
    lines.push({ label, keys });
  }
  return lines;
}

/** What the last accept left out, and the draft it made, so a withdraw of that draft clears it. */
export interface NotRead {
  draftId: string | null;
  lines: NotReadLine[];
  /** That draft went live, so these fields cannot ride in on a withdraw any more. */
  published?: boolean;
}

export const NOTHING_LEFT_OUT: NotRead = { draftId: null, lines: [] };

/**
 * The server's `blockedLines`, one sentence per seat that cannot apply. An
 * older server sends none, which is no lines and the count alone.
 */
export function blockedReasons(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return (v as { reads?: unknown; blocked?: unknown }[])
    .filter((l) => typeof l?.blocked === "string" && l.blocked !== "")
    .map((l) => (typeof l.reads === "string" && l.reads !== "" ? `${l.reads}: ${l.blocked}` : String(l.blocked)));
}
