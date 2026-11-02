/**
 * Strings this platform once seeded into a village's content document, and
 * what each one becomes.
 *
 * The "Hearts" era survives inside the seeded content document (journey step
 * details, circle focus lines), where a code change cannot reach it. The boot
 * step `retire-blended-token-copy` (server/index.ts) walks the document and
 * swaps a string only while it is character for character a value this
 * platform seeded. Anything a person has since written is left exactly as it is.
 */
export const RETIRED_CONTENT_COPY: ReadonlyMap<string, string> = new Map([
  ["Earn Hearts for contributions", "Earn Gratitude for contributions"],
  ["Learn about Hearts currency", "Learn how Gratitude and the value pool work"],
  ["Hearts Economy", "Gratitude Economy"],
]);

/**
 * Swap every retired string in `content`, in place, at any depth. Returns
 * whether anything changed, so the caller writes the document only then.
 */
export function retireContentCopy(content: unknown, swaps: ReadonlyMap<string, string> = RETIRED_CONTENT_COPY): boolean {
  let changed = false;
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach((v, i) => {
        if (typeof v === "string") {
          const next = swaps.get(v);
          if (next !== undefined) { node[i] = next; changed = true; }
        } else walk(v);
      });
    } else if (node && typeof node === "object") {
      const rec = node as Record<string, unknown>;
      for (const k of Object.keys(rec)) {
        const v = rec[k];
        if (typeof v === "string") {
          const next = swaps.get(v);
          if (next !== undefined) { rec[k] = next; changed = true; }
        } else walk(v);
      }
    }
  };
  walk(content);
  return changed;
}
