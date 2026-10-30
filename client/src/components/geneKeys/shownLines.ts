/**
 * Other members' shown lines, read in batches.
 *
 * A map draws a glyph per circle, and each asks for its own holders. Asked one
 * by one that is a request per circle; here every id asked for in the same
 * tick joins one read (at most 60 ids, the server's own cap, per request), and
 * an answer is kept for the page's life. A hidden member is simply absent from
 * the answer, so "absent" is remembered too and never asked twice.
 */
import type { GeneKeysView } from "@shared/geneKeys";
import { readPeopleGeneKeys } from "@/lib/geneKeysApi";

const BATCH_MAX = 60;
const known = new Map<string, GeneKeysView | null>();
const waiting = new Map<string, Array<() => void>>();
let queued: string[] = [];
let scheduled = false;

async function flush(): Promise<void> {
  scheduled = false;
  const ids = queued;
  queued = [];
  for (let i = 0; i < ids.length; i += BATCH_MAX) {
    const chunk = ids.slice(i, i + BATCH_MAX);
    const people = await readPeopleGeneKeys(chunk).catch(() => ({}) as Record<string, GeneKeysView>);
    for (const id of chunk) {
      known.set(id, people[id] ?? null);
      for (const done of waiting.get(id) ?? []) done();
      waiting.delete(id);
    }
  }
}

/** Every id's shown view (null when hidden or unknown), once all are known. */
export function shownLinesOf(ids: readonly string[]): Promise<Record<string, GeneKeysView | null>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const pending = unique.filter((id) => !known.has(id));
  const answer = () => Object.fromEntries(unique.map((id) => [id, known.get(id) ?? null]));
  if (!pending.length) return Promise.resolve(answer());
  return Promise.all(
    pending.map(
      (id) =>
        new Promise<void>((resolve) => {
          const list = waiting.get(id);
          if (list) return list.push(resolve);
          waiting.set(id, [resolve]);
          queued.push(id);
          if (!scheduled) {
            scheduled = true;
            queueMicrotask(() => void flush());
          }
        }),
    ),
  ).then(answer);
}

/** For tests: forget every answer. */
export function forgetShownLines(): void {
  known.clear();
  waiting.clear();
  queued = [];
  scheduled = false;
}

/** The lines a set of members holds between them, from their shown views, lowest first. */
export function heldLines(views: ReadonlyArray<GeneKeysView | null>): number[] {
  const held = new Set<number>();
  for (const v of views) for (const l of v?.lines ?? []) held.add(l);
  return Array.from(held).sort((a, b) => a - b);
}
