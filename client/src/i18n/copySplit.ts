/**
 * LONG ENGLISH LEAVES THE LAZY CHUNKS (dist headroom, Rye 2026-11-09: "move
 * long copy out of the bundle").
 *
 * BUILD-TIME ONLY. vite.config.ts imports this; nothing in the app does, so it
 * never ships. It lives under client/src so `pnpm check` type-checks it.
 *
 * English is the source language and the Lingui macro keeps each message in
 * the chunk that renders it (linguiMacros.ts). That is right for a short label
 * and wasteful for a paragraph: every word of every page sat in dist/public,
 * which CI caps. So the production build moves each message of
 * LONG_MESSAGE_CHARS or more out of its descriptor (precompileEnglish.ts,
 * which leaves `{ id }`) and decides per CHUNK where its English goes:
 *
 *  - A chunk the first page loads (the entry and everything it imports
 *    statically) gets its English back INLINE, pushed onto a queue the i18n
 *    runtime drains. The first paint never waits on a fetch, and those bytes
 *    simply stay where they were.
 *  - Every other chunk gets one statement before any of its code:
 *    `await globalThis.__villageCopyLoad("<part>")`. The part is a JSON file in
 *    dist/i18n/parts/en, outside dist/public, served by the i18n catalog route
 *    (server/routes/i18n.ts). A lazy page's dynamic import therefore resolves only
 *    once its words are registered, the Suspense fallback the page already has
 *    covers the wait, and no text is ever drawn missing. route-preload.js
 *    fetches the part beside the chunk, so the wait is the chunk's own.
 *
 * English stays the fallback under every language: client/src/i18n/i18n.ts
 * keeps every part it loaded and merges it beneath the active catalog.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import type { LongCopySink } from "./precompileEnglish";

export { LONG_MESSAGE_CHARS } from "./precompileEnglish";

/** The part names a chunk can carry and the server accepts: 12 base64url characters. */
export const PART_NAME = /^[A-Za-z0-9_-]{12}$/;

/** Every moved message, per module, and every part the chunks were given. */
export class CopyCollector implements LongCopySink {
  readonly byModule = new Map<string, Map<string, string>>();
  readonly parts = new Map<string, Record<string, unknown>>();

  record(moduleId: string, id: string, compiledJson: string): void {
    let m = this.byModule.get(moduleId);
    if (!m) this.byModule.set(moduleId, (m = new Map()));
    m.set(id, compiledJson);
  }

  forget(moduleId: string): void {
    this.byModule.delete(moduleId);
  }

  /** The moved messages of these modules, id -> compiled, or null when there are none. */
  messagesOf(moduleIds: readonly string[]): Record<string, unknown> | null {
    const out: Record<string, unknown> = {};
    let any = false;
    for (const mod of moduleIds) {
      const m = this.byModule.get(mod);
      if (!m) continue;
      for (const [id, json] of Array.from(m)) {
        out[id] = JSON.parse(json);
        any = true;
      }
    }
    return any ? out : null;
  }
}

/** The facts this needs about a chunk, as rollup's renderChunk sees it. */
export interface ChunkShape {
  fileName: string;
  isEntry: boolean;
  /** Static imports, by file name. */
  imports: readonly string[];
  moduleIds: readonly string[];
}

/** What index.html loads before the first paint: each entry and its static imports, transitively. */
export function bootChunks(chunks: Record<string, ChunkShape>): Set<string> {
  const boot = new Set<string>();
  const walk = (name: string) => {
    if (boot.has(name)) return;
    boot.add(name);
    for (const next of chunks[name]?.imports ?? []) walk(next);
  };
  for (const c of Object.values(chunks)) if (c.isEntry) walk(c.fileName);
  return boot;
}

function partName(messages: Record<string, unknown>): string {
  const sorted = Object.fromEntries(Object.entries(messages).sort(([a], [b]) => (a < b ? -1 : 1)));
  return crypto.createHash("sha256").update(JSON.stringify(sorted)).digest("base64url").slice(0, 12);
}

/**
 * The chunk's code with its English put back (boot) or awaited (lazy), or
 * null when no message in it moved. Records each lazy part on `collector`.
 */
export function renderChunkCopy(
  code: string,
  chunk: ChunkShape,
  chunks: Record<string, ChunkShape>,
  collector: CopyCollector,
  boot: Set<string> = bootChunks(chunks),
): string | null {
  const messages = collector.messagesOf(chunk.moduleIds);
  if (!messages) return null;
  if (boot.has(chunk.fileName)) {
    return `(globalThis.__villageCopyInline=globalThis.__villageCopyInline||[]).push(${JSON.stringify(messages)});\n${code}`;
  }
  const part = partName(messages);
  collector.parts.set(part, messages);
  return `await globalThis.__villageCopyLoad(${JSON.stringify(part)});\n${code}`;
}

/** Write each part as `{ messages }`, after clearing what an earlier build left. */
export function writeCopyParts(collector: CopyCollector, dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [part, messages] of Array.from(collector.parts)) {
    fs.writeFileSync(path.join(dir, `${part}.json`), JSON.stringify({ messages }));
  }
}

/**
 * The renderChunk half (the transform half is precompileEnglish(collector)).
 * `partsDir` is dist/i18n/parts/en: beside the catalogs, outside dist/public.
 */
export function splitLongCopy(collector: CopyCollector, partsDir: string): Plugin {
  let boot: Set<string> | null = null;
  let bootOf: unknown = null;
  return {
    name: "village-split-long-copy",
    apply: "build",
    renderChunk(code, chunk, _options, meta) {
      const all = meta.chunks as unknown as Record<string, ChunkShape>;
      if (bootOf !== meta.chunks) {
        boot = bootChunks(all);
        bootOf = meta.chunks;
      }
      const out = renderChunkCopy(code, chunk as unknown as ChunkShape, all, collector, boot!);
      return out === null ? null : { code: out, map: null };
    },
    writeBundle() {
      writeCopyParts(collector, partsDir);
    },
  };
}
