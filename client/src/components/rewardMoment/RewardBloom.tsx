/**
 * THE REWARD MOMENT'S DRAWING (game feel wave 2, 11 Nov 2026): a Seed of Life
 * opening its petals once in the gold halo, and a few fireflies in the night
 * around it. It replaces the scattered gold sparks and the seed burst: a
 * ceremony is a bloom, never a burst.
 *
 * Its own small module, loaded with React.lazy from RewardMoment, because
 * RewardMoment rides in the app shell (Layout.tsx) and the nature kit must
 * never reach the first page. Under reduced motion the kit draws the same
 * bloom, still.
 */
import { Fireflies, SeedOfLife } from "@/components/journey/nature";

export function RewardSky() {
  return (
    <span className="sheet-night pointer-events-none absolute inset-0" aria-hidden="true" data-reward-sky="">
      <Fireflies count={7} size="lg" inner={0.2} reach={0.9} />
    </span>
  );
}

export default function RewardBloom() {
  return (
    <span className="sheet-night grid size-full place-items-center" aria-hidden="true" data-reward-bloom="">
      <SeedOfLife total={7} walked={7} bloom size="fill" label="" />
    </span>
  );
}
