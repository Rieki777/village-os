/**
 * Strings this platform once seeded into a village's content document, and
 * what each one becomes.
 *
 * The "Hearts" era survives inside the seeded content document (journey step
 * details, circle focus lines), where a code change cannot reach it. The boot
 * step `retire-blended-token-copy` (server/index.ts) walks the document and
 * swaps a string only while it is character for character a value this
 * platform seeded. Anything a person has since written is left exactly as it is.
 *
 * GRATITUDE IS THE RECOGNITION TOKEN'S NAME AND NOTHING ELSE'S (Rye,
 * 2026-11-01: "Gratitude ONLY for the recognition token and NOT for the credit
 * or earned equity tokens"). These swaps wrote "Earn Gratitude for
 * contributions" and "Gratitude Economy" until then. The contribution line now
 * becomes the line a fresh village's seed carries in its place (e23471e), and
 * the circle focus names the economy without naming a token.
 * server/lib/retiredContentCopy.test.ts holds every target to that.
 */
export const RETIRED_CONTENT_COPY: ReadonlyMap<string, string> = new Map([
  ["Earn Hearts for contributions", "See what each quest pays"],
  ["Learn about Hearts currency", "Learn how Gratitude and the value pool work"],
  ["Hearts Economy", "Village Economy"],
]);

/**
 * What `retire-blended-token-copy` itself wrote before 2026-11-01, which every
 * live village already ran once and so still holds. Swapped by its own
 * once-only step, `retire-gratitude-pay-copy-2026-11-01` (server/index.ts),
 * character for character, so a sentence a person wrote is never touched.
 */
export const GRATITUDE_PAY_COPY_RETIRED: ReadonlyMap<string, string> = new Map([
  ["Earn Gratitude for contributions", "See what each quest pays"],
  ["Gratitude Economy", "Village Economy"],
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
