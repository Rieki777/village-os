/**
 * THE ROOTS SLOT on the full role card: where the archetypes a role grows from
 * render, drawn as roots (build list 10.4), through the roots kit's `RootTags`.
 *
 * Every card passes its archetype keys here, so a card with none draws nothing.
 */
import RootTags from "@/components/roots/RootTags";

export default function RootsSlot({ roots }: { roots: string[] }) {
  return roots.length ? <RootTags roots={roots} /> : null;
}
