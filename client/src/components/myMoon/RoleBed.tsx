/**
 * ONE GARDEN BED PER ROLE (Phase C, lane C2; sitewide plan E).
 *
 * Each kept piece of work on the role is a plant on the sunflower's spiral,
 * the first at the centre: flowered (done), in bud (partly), sprouting (no
 * ending yet) or a seed kept (carried). A role with no work this moon is
 * resting soil, said plainly. The plants describe the work; the bed never
 * carries a percent, a ring or a comparison, and it stays on the member's own
 * board (Room view hides it with the score).
 */
import { MOON_GARDEN_WORDS as W, bedSpots, bedWords, type BedPlant } from "./moonGarden";

const SIZE = 100;

function Plant({ kind, x, y }: { kind: BedPlant; x: number; y: number }) {
  return (
    <g transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`} data-plant={kind}>
      {kind === "seed" ? (
        <ellipse rx="3.4" ry="2.4" className="fill-muted-foreground" />
      ) : (
        <>
          <path d="M0 7 V-1" className="stroke-open" strokeWidth="1.4" fill="none" />
          <path d="M0 4 C-4 3.5,-5.5 1,-5 -0.5 C-2.5 0,-0.8 2,0 4 Z" className="fill-open" />
          {kind === "sprout" ? (
            <path d="M0 2 C4 1.5,5.5 -1,5 -2.5 C2.5 -2,0.8 0,0 2 Z" className="fill-open" />
          ) : kind === "bud" ? (
            <ellipse cy="-4" rx="2.6" ry="3.6" className="fill-open" />
          ) : (
            <g className="fill-notice">
              {[0, 72, 144, 216, 288].map((a) => (
                <circle key={a} cx={(3.2 * Math.cos(((a - 90) * Math.PI) / 180)).toFixed(2)} cy={(-4 + 3.2 * Math.sin(((a - 90) * Math.PI) / 180)).toFixed(2)} r="2.5" />
              ))}
              <circle cy="-4" r="1.7" className="fill-background" />
            </g>
          )}
        </>
      )}
    </g>
  );
}

export default function RoleBed({ role, plants }: { role: string; plants: readonly BedPlant[] }) {
  const spots = bedSpots(plants.length, SIZE * 0.82);
  const words = plants.length === 0 ? W.emptyBed : bedWords(plants);
  return (
    <figure className="m-0 flex flex-col items-center gap-2" data-testid="role-bed">
      <svg viewBox={`${-SIZE - 6} ${-SIZE - 6} ${2 * SIZE + 12} ${2 * SIZE + 12}`} role="img" aria-label={`${W.bedLabel(role)}: ${words}`} className="block h-auto w-full max-w-[13rem] sm:max-w-[15rem]">
        <circle r={SIZE} className="fill-open stroke-border" fillOpacity="0.07" strokeWidth="1.2" />
        {plants.length === 0 ? (
          [0, 1, 2, 3, 4, 5].map((i) => {
            const a = (i * 137.5 * Math.PI) / 180;
            const r = 22 + i * 9;
            return <ellipse key={i} cx={(r * Math.cos(a)).toFixed(2)} cy={(r * Math.sin(a)).toFixed(2)} rx="5" ry="1.2" className="fill-muted-foreground" fillOpacity="0.35" />;
          })
        ) : (
          plants.map((p, i) => <Plant key={i} kind={p} x={spots[i].x} y={spots[i].y} />)
        )}
      </svg>
      <figcaption className="text-center text-xs text-muted-foreground" data-testid="role-bed-words">{words}</figcaption>
    </figure>
  );
}
