/**
 * THE ROOTS SLOT on the full role card: where the archetypes a role grows from
 * render, drawn as roots (build list 10.4). Lane A4 builds the drawing as
 * `client/src/components/roots/RootTags` (props `{ roots: string[] }`).
 *
 * That component is not on this branch's base, so this slot is a tiny local
 * stand-in that renders NOTHING. When A4 lands, the integrator replaces the
 * body with:
 *
 *   import RootTags from "@/components/roots/RootTags";
 *   export default function RootsSlot({ roots }: { roots: string[] }) {
 *     return roots.length ? <RootTags roots={roots} /> : null;
 *   }
 *
 * Every card already passes its archetype keys here, so nothing else changes.
 */
export default function RootsSlot(_props: { roots: string[] }) {
  return null;
}
