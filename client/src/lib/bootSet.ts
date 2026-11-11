/**
 * THE BOOT SET GUARD: a module only the lazy pages reach never rides the first page.
 *
 * WHY THIS EXISTS. `experimentalMinChunkSize` (vite.config.ts) merges small
 * chunks into a neighbour, and it does not ask whether the neighbour is loaded
 * on the first page. So one small static import in the boot graph can change
 * the shape of the chunk graph and pull modules that only lazy routes use into
 * a chunk the entry loads. That is how `AlignButton` importing `journey/look`
 * took `termsWords` and `seatSettings` into the boot chunk and first-page JS
 * from 750 KB to 1113 KB. The size budget caught it, but only as a number: it
 * could not say which module had moved, which is the one thing the next person
 * needs.
 *
 * THE RULE, structural and independent of any size. Work out the modules the
 * entry reaches by static imports, in the module graph and before any chunking
 * (the EAGER set). Work out the chunks index.html loads: the entry chunk and
 * everything it imports statically. Every module inside one of those chunks
 * must be in the eager set. A module that is not, is lazy-only code that joined
 * the first page, and the build fails naming it and the chunk it joined.
 *
 * The decision is a pure function so a test can hold it with no build; the
 * plugin in vite.config.ts feeds it the real bundle and module graph.
 */

export interface BootChunkFacts {
  fileName: string;
  /** Static imports only (rollup's `imports`, never `dynamicImports`). */
  imports: readonly string[];
  isEntry: boolean;
  /** The source modules rollup placed in this chunk. */
  moduleIds: readonly string[];
}

export interface BootIntruders {
  chunk: string;
  modules: string[];
}

/** Every chunk the first page loads: the entries and the closure of their static imports. */
export function bootChunks(chunks: readonly BootChunkFacts[]): BootChunkFacts[] {
  const byName = new Map(chunks.map((c) => [c.fileName, c]));
  const seen = new Set<string>();
  const stack = chunks.filter((c) => c.isEntry).map((c) => c.fileName);
  while (stack.length) {
    const name = stack.pop() as string;
    if (seen.has(name)) continue;
    seen.add(name);
    for (const dep of byName.get(name)?.imports ?? []) stack.push(dep);
  }
  return chunks.filter((c) => seen.has(c.fileName));
}

/** Rollup's own helper modules (`\0` ids) belong to no source file and are never named. */
const isVirtual = (id: string): boolean => id.startsWith("\0");

/**
 * The lazy-only modules sitting in boot chunks, grouped by chunk. Empty when the
 * first page carries only what the entry imports.
 *
 * A RATCHET, like the repository's other baselines. Some lazy-only modules are
 * already in boot chunks on purpose or by history (the natural kit's own chunk,
 * and small shared modules rollup folded into a boot chunk); they are listed by
 * path in scripts/boot-set-baseline.json and `known` holds that list. Only a
 * module NOT in it is an intruder, so the list can shrink and never grow.
 */
export function lazyModulesInBoot(
  chunks: readonly BootChunkFacts[],
  eager: ReadonlySet<string>,
  known: ReadonlySet<string> = new Set(),
  name: (id: string) => string = (id) => id,
): BootIntruders[] {
  const out: BootIntruders[] = [];
  for (const c of bootChunks(chunks)) {
    const modules = c.moduleIds.filter((id) => !isVirtual(id) && !eager.has(id) && !known.has(name(id)));
    if (modules.length) out.push({ chunk: c.fileName, modules });
  }
  return out;
}

/** Every lazy-only module in a boot chunk, known or not, by name. Sorted, so the baseline file is stable. */
export function allLazyInBoot(chunks: readonly BootChunkFacts[], eager: ReadonlySet<string>, name: (id: string) => string): string[] {
  const all = new Set<string>();
  for (const c of bootChunks(chunks)) for (const id of c.moduleIds) if (!isVirtual(id) && !eager.has(id)) all.add(name(id));
  return Array.from(all).sort();
}

/** Module ids as a repository path, so the failure names a file a person can open. */
export function shortId(id: string, root: string): string {
  const clean = id.split("?")[0];
  const rel = clean.startsWith(root) ? clean.slice(root.length).replace(/^[\\/]+/, "") : clean;
  return rel.replace(/^.*node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?/, "node_modules/");
}

export function bootIntrudersMessage(found: readonly BootIntruders[], root: string): string {
  const SHOWN = 12;
  const lines = found.flatMap((f) => [
    `  ${f.chunk} (loaded by index.html):`,
    ...f.modules.slice(0, SHOWN).map((m) => `    ${shortId(m, root)}`),
    ...(f.modules.length > SHOWN ? [`    ... and ${f.modules.length - SHOWN} more`] : []),
  ]);
  return [
    `The first page now carries ${found.reduce((n, f) => n + f.modules.length, 0)} module(s) that only lazy pages import:`,
    ...lines,
    "If one of these is meant to ride the first page, it belongs in scripts/boot-set-baseline.json; otherwise:",
    "A static import in the boot graph (a component the layout, the header or an eager page draws) changed how rollup groups chunks:",
    "either experimentalMinChunkSize merged these into a chunk the entry loads, or the import reaches a merged group (smalls, smallui,",
    "natural) that is now one of the entry's static imports. Find what the boot graph newly imports and make that import lazy, or move",
    "the shared piece it pulled in somewhere the boot graph does not import. Raising a budget is not the fix.",
  ].join("\n");
}
