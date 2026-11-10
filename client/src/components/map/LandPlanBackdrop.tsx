/**
 * The land, drawn as a plan, behind the Enter the Land gate (landPlan.ts says
 * what it reads and why). Theme classes only, so each village's palette
 * colours its own land: no hex or rgba literals.
 *
 * It fades in when the published scene arrives and stays blank when there is
 * none, so a slow or failed read costs nothing but the picture. The drift,
 * the creeks' flow and the buildings' breathing all stop under
 * prefers-reduced-motion.
 */
import { useEffect, useId, useState } from "react";
import { landPlan, type LandPlan } from "./landPlan";

/** Read the published scene once and turn it into a plan. */
export function useLandPlan(enabled: boolean): LandPlan | null {
  const [plan, setPlan] = useState<LandPlan | null>(null);
  useEffect(() => {
    if (!enabled || plan) return;
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/map/config");
        if (!res.ok) return;
        const body = await res.json().catch(() => null);
        const next = landPlan(body?.scene);
        if (live && next) setPlan(next);
      } catch {
        /* No picture: the gate stands on its own background, as it always did. */
      }
    })();
    return () => { live = false; };
  }, [enabled, plan]);
  return plan;
}

const MOTION = `
@keyframes landplan-drift{from{transform:scale(1) translate(0,0)}to{transform:scale(1.07) translate(-1.2%,-.8%)}}
@keyframes landplan-flow{to{stroke-dashoffset:-28}}
@keyframes landplan-breathe{50%{transform:scale(1.6);opacity:0}}
.landplan-drift{animation:landplan-drift 60s ease-in-out infinite alternate}
.landplan-flow{animation:landplan-flow 3s linear infinite}
.landplan-halo{transform-box:fill-box;transform-origin:center;animation:landplan-breathe 4s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.landplan-drift,.landplan-flow,.landplan-halo{animation:none}}
`;

export default function LandPlanBackdrop({ plan }: { plan: LandPlan | null }) {
  const id = useId().replace(/:/g, "");
  const canopy = `landplan-canopy-${id}`;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!plan) return;
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, [plan]);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true" data-testid="land-plan">
      {plan && (
        <svg
          viewBox={plan.viewBox}
          preserveAspectRatio="xMidYMid slice"
          className={`landplan-drift absolute -inset-[6%] h-[112%] w-[112%] transition-opacity duration-[1600ms] ease-out ${shown ? "opacity-100" : "opacity-0"}`}
        >
          <style>{MOTION}</style>
          <defs>
            <pattern id={canopy} width="22" height="22" patternUnits="userSpaceOnUse">
              <circle cx="5" cy="6" r="5" className="fill-sage" opacity=".14" />
              <circle cx="17" cy="4" r="4" className="fill-sage" opacity=".2" />
              <circle cx="12" cy="15" r="5.5" className="fill-sage" opacity=".14" />
              <circle cx="3" cy="19" r="3.5" className="fill-sage" opacity=".2" />
              <circle cx="20" cy="19" r="3" className="fill-sage" opacity=".14" />
            </pattern>
          </defs>

          {plan.boundary && (
            <>
              <path d={plan.boundary} className="fill-sage" opacity=".22" />
              <path d={plan.boundary} fill={`url(#${canopy})`} />
            </>
          )}
          {plan.clearings.map((c, i) => (
            <path key={`c${i}`} d={c.d} className="fill-background" opacity={c.future ? 0.5 : 0.8} />
          ))}
          {plan.ponds.map((p, i) => (
            <path key={`p${i}`} d={p.d} className="fill-aqua-light stroke-aqua" strokeWidth={2} opacity={p.future ? 0.5 : 1} />
          ))}
          {plan.creeks.map((d, i) => (
            <g key={`k${i}`}>
              <path d={d} fill="none" className="stroke-aqua" strokeWidth={6} strokeLinecap="round" />
              <path d={d} fill="none" className="landplan-flow stroke-background" strokeWidth={2} strokeLinecap="round" strokeDasharray="2 26" />
            </g>
          ))}
          {plan.roads.map((r, i) => (
            <path key={`rc${i}`} d={r.d} fill="none" className="stroke-border" strokeWidth={(r.paved ? 10 : 7) + 4} strokeLinecap="round" strokeLinejoin="round" opacity={r.future ? 0.6 : 1} />
          ))}
          {plan.roads.map((r, i) => (
            <path key={`r${i}`} d={r.d} fill="none" className="stroke-background" strokeWidth={r.paved ? 10 : 7} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={r.future ? "10 8" : undefined} opacity={r.future ? 0.6 : 1} />
          ))}
          {plan.boundary && (
            <path d={plan.boundary} fill="none" className="stroke-sage" strokeWidth={3} strokeDasharray="14 8" strokeLinecap="round" opacity=".45" />
          )}
          {plan.marks.map((m, i) =>
            m.standing ? (
              <g key={`m${i}`}>
                <circle cx={m.x} cy={m.y} r={16} className="landplan-halo fill-teal-deep" opacity=".12" style={{ animationDelay: `${-((m.x * 7 + m.y) % 40) / 10}s` }} />
                <circle cx={m.x} cy={m.y} r={7} className="fill-teal-deep stroke-background" strokeWidth={2.5} />
              </g>
            ) : (
              <circle key={`m${i}`} cx={m.x} cy={m.y} r={5} className="fill-background stroke-teal-deep" strokeWidth={2} strokeDasharray="3 3" />
            ),
          )}
        </svg>
      )}
      {/* A veil so the words read: clear at the edges, the page's own colour in the middle. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_46%_40%_at_50%_50%,color-mix(in_srgb,var(--background)_88%,transparent)_0%,color-mix(in_srgb,var(--background)_55%,transparent)_55%,transparent_80%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,color-mix(in_srgb,var(--background)_70%,transparent),transparent_22%,transparent_78%,color-mix(in_srgb,var(--background)_80%,transparent))]" />
    </div>
  );
}
