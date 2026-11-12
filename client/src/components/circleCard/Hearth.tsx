/**
 * THE HEARTH: a circle drawn as roles sitting round a warm fire (Phase D,
 * lane D1). The fire is a Seed of Life in embers, the roles are stones on a
 * ring around it, and mycelial threads reach out to the circles this one is
 * linked to. The geometry is `hearthModel.ts`; this file only draws it.
 *
 * Still by design. The embers glow softly and do not move: fireflies on this
 * page belong to the one next act ("I'll be there"), and a second light here
 * would make two. Under reduced motion it is the same drawing.
 *
 * Phone and desktop, each at its best:
 *   - a phone gets the hearth full-bleed near the top; tapping a stone jumps
 *     to that role in "Who holds what";
 *   - a desktop keeps it in view on the left while the page reads, larger,
 *     and hovering or focusing a stone names its role and whether it is held.
 *
 * Nothing here names a person: a stone carries its ROLE's first letter.
 */
import { Link } from "wouter";
import { useLingui } from "@lingui/react/macro";
import { fx } from "@/components/journey/nature/geometry";
import { HEARTH_CENTRE, HEARTH_VIEW, STONE_RING, emberSeed, embers, type Stone, type ThreadDrawing } from "./hearthModel";

/** The id a stone's row carries in "Who holds what", so a tap on the stone lands on it. */
export const roleRowId = (roleId: string) => `role-stone-${roleId}`;

/** A name on the drawing, shortened so it never crowds a neighbour. */
const short = (s: string, n = 18) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export default function Hearth({
  circleName,
  stones,
  threads,
  className = "",
}: {
  circleName: string;
  stones: readonly Stone[];
  threads: readonly ThreadDrawing[];
  className?: string;
}) {
  const { t } = useLingui();
  const held = stones.filter((s) => s.held).length;
  const label =
    stones.length === 0
      ? t({ message: `The ${circleName} hearth. No roles sit here yet.`, context: "circle hearth, the drawing" })
      : t({
          message: `The ${circleName} hearth: ${stones.length} roles around the fire, ${held} held. Threads reach to ${threads.length} linked circles.`,
          context: "circle hearth, the drawing",
        });
  const seed = emberSeed(22);

  return (
    <figure className={`relative mx-auto w-full max-w-md ${className}`.trim()} data-hearth="" data-stones={stones.length} data-threads={threads.length}>
      <svg viewBox={`0 0 ${HEARTH_VIEW} ${HEARTH_VIEW}`} role="img" aria-label={label} className="block h-auto w-full overflow-visible">
        <defs>
          <radialGradient id="hearth-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.42} />
            <stop offset="55%" stopColor="currentColor" stopOpacity={0.12} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* The warmth: a soft ember light under the seed, and the ring the stones sit on. */}
        <circle cx={HEARTH_CENTRE} cy={HEARTH_CENTRE} r={STONE_RING * 0.78} fill="url(#hearth-glow)" className="text-notice" />
        <circle
          cx={HEARTH_CENTRE}
          cy={HEARTH_CENTRE}
          r={STONE_RING}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.5}
          strokeWidth={1}
          strokeDasharray="2 6"
          className="text-border"
        />

        {/* Threads to linked circles: mycelium, each with one side hypha, and the circle at its end. */}
        <g className="text-open" fill="none" stroke="currentColor" strokeLinecap="round" data-threads-layer="">
          {threads.map((th) => (
            <g key={th.id} data-thread={th.id}>
              <path d={th.path} strokeWidth={1.2} strokeOpacity={0.75} />
              <path d={th.hypha} strokeWidth={0.8} strokeOpacity={0.5} />
            </g>
          ))}
        </g>
        {threads.map((th) => (
          <Link key={th.id} href={th.href} aria-label={t({ message: `Linked circle: ${th.name}`, context: "circle hearth, a thread" })} className="group outline-none">
            <circle cx={fx(th.end.x)} cy={fx(th.end.y)} r={14} fill="transparent" />
            <circle
              cx={fx(th.end.x)}
              cy={fx(th.end.y)}
              r={6}
              className="text-open group-hover:fill-current group-focus-visible:fill-current"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.4}
            />
            <text x={fx(th.label.x)} y={fx(th.label.y)} textAnchor={th.anchor} className="fill-muted-foreground text-xs group-hover:fill-foreground group-focus-visible:fill-foreground">
              {short(th.name, 16)}
            </text>
          </Link>
        ))}

        {/* The fire: a Seed of Life in embers, whole and still. */}
        <g className="text-notice" fill="none" stroke="currentColor" data-ember-seed="">
          {seed.map((p, i) => (
            <circle key={i} cx={fx(p.x)} cy={fx(p.y)} r={22} strokeWidth={1.3} fill="currentColor" fillOpacity={0.05} />
          ))}
          <circle cx={HEARTH_CENTRE} cy={HEARTH_CENTRE} r={44} strokeWidth={0.8} strokeOpacity={0.45} />
        </g>
        <g className="text-notice" fill="currentColor">
          {embers().map((p, i) => (
            <circle key={i} cx={fx(p.x)} cy={fx(p.y)} r={i % 3 === 0 ? 1.8 : 1.2} fillOpacity={0.55 + (i % 3) * 0.15} />
          ))}
        </g>

        {/* The stones: held is solid, open is a dotted ring waiting for hands. */}
        {stones.map((s) => {
          const said = s.held
            ? t({ message: `${s.name}, held`, context: "circle hearth, a stone" })
            : t({ message: `${s.name}, open`, context: "circle hearth, a stone" });
          return (
            <a key={s.id} href={`#${roleRowId(s.id)}`} aria-label={said} className="group outline-none" data-stone={s.id} data-held={s.held ? "true" : "false"}>
              <title>{said}</title>
              <circle cx={fx(s.x)} cy={fx(s.y)} r={s.r + 6} fill="transparent" />
              <circle
                cx={fx(s.x)}
                cy={fx(s.y)}
                r={s.r}
                className={s.held ? "fill-card text-open" : "fill-background text-muted-foreground"}
                stroke="currentColor"
                strokeWidth={s.held ? 1.6 : 1.2}
                strokeDasharray={s.held ? undefined : "2 4"}
              />
              <circle
                cx={fx(s.x)}
                cy={fx(s.y)}
                r={s.r + 3}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.4}
                className="text-notice opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              />
              <text
                x={fx(s.x)}
                y={fx(s.y + s.r * 0.36)}
                textAnchor="middle"
                className={`font-display ${s.held ? "fill-foreground" : "fill-muted-foreground"}`}
                fontSize={fx(s.r * 0.95)}
              >
                {s.initial}
              </text>
              <text x={fx(s.x)} y={fx(s.labelY)} textAnchor="middle" className="fill-muted-foreground text-xs group-hover:fill-foreground group-focus-visible:fill-foreground">
                {short(s.name)}
              </text>
            </a>
          );
        })}
      </svg>
    </figure>
  );
}
