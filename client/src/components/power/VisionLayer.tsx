/**
 * Power Now | Vision (0083, P1, N2): the structure the village is growing
 * toward, drawn as ghosts over the structure it has.
 *
 * Vision = the OPEN drafts. Each seat a draft would create appears as a
 * dashed ghost at its target circle's rim; the panel lists every draft's
 * objectives with live progress, and when every objective is met it says
 * "Vision conditions met" and LINKS to the existing publish button in
 * Admin. That link is the whole apply path: nothing in this file, the
 * vision routes or the progress arithmetic calls publishDraft, and
 * visionNeverApplies.test.ts pins that sentence to the code.
 */
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { NestedLayout } from "@shared/mapLayout";
import { authToken, useCatalyst } from "@/lib/gameApi";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

export interface VisionDraft {
  id: string;
  title: string;
  rationale: string | null;
  vision: {
    objectives: Array<{
      text: string;
      metric: string | null;
      target: number | null;
      current: number | null;
      source: "measured" | "declared";
      done: boolean;
    }>;
    trigger: { all_objectives_done: boolean; by?: string | null };
  } | null;
  progress: { done: number; total: number; allDone: boolean } | null;
  changes: Array<{
    op: string;
    orgRoleId: string;
    name?: string | null;
    circleId?: string | null;
    seats?: number | null;
    holder?: string;
  }>;
}

export function useVision(enabled: boolean): { drafts: VisionDraft[]; loaded: boolean } {
  const [drafts, setDrafts] = useState<VisionDraft[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    fetch("/api/org/vision", { headers: headers() })
      .then((r) => (r.ok ? r.json() : { drafts: [] }))
      .then((d) => {
        setDrafts(d.drafts ?? []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [enabled]);
  return { drafts, loaded };
}

/** The ghosts, rendered through PowerMap's `lenses` seam: a dashed seat per
 *  create_seat change, on an arc under its target circle. */
export function VisionGhosts({ layout, drafts }: { layout: NestedLayout; drafts: VisionDraft[] }) {
  const posById = new Map(layout.circles.map((c) => [c.id, c]));
  const ghosts: Array<{ key: string; x: number; y: number; label: string }> = [];
  const perCircle = new Map<string, number>();
  for (const d of drafts) {
    for (const ch of d.changes) {
      if (ch.op !== "create_seat") continue;
      const pos = ch.circleId ? posById.get(ch.circleId) : null;
      if (!pos) continue;
      const i = perCircle.get(pos.id) ?? 0;
      perCircle.set(pos.id, i + 1);
      const a = Math.PI / 2 + (i - 1) * 0.5;
      ghosts.push({
        key: `${d.id}-${ch.orgRoleId}`,
        x: pos.x + (pos.r + 10) * Math.cos(a),
        y: pos.y + (pos.r + 10) * Math.sin(a),
        label: ch.name ?? ch.orgRoleId,
      });
    }
  }
  if (!ghosts.length) return null;
  return (
    <g data-power-vision-ghosts>
      {ghosts.map((g) => (
        <g key={g.key} opacity={0.75}>
          <circle cx={g.x} cy={g.y} r={10} fill="white" stroke="var(--color-teal-deep)" strokeWidth={1.6} strokeDasharray="2 3" />
          <text x={g.x} y={g.y + 3} textAnchor="middle" fontSize={9} className="fill-teal-deep pointer-events-none">
            +
          </text>
          <title>{`${g.label}: a role this vision would create`}</title>
        </g>
      ))}
    </g>
  );
}

/** The panel: every open draft, its objectives, its progress, and the prompt
 *  that hands a HUMAN the existing publish button when conditions are met. */
export function VisionPanel({ drafts, isAdmin }: { drafts: VisionDraft[]; isAdmin: boolean }) {
  // Above the early return, as every hook must be. `isAdmin` still decides
  // which half of the card renders; this only supplies the word.
  const catalyst = useCatalyst();
  if (!drafts.length) {
    return (
      <div className="bg-card border border-border rounded-xl p-4 text-sm text-muted-foreground" data-power-vision-panel>
        No vision is drawn yet. A structural draft with objectives becomes the ghost layer here.
      </div>
    );
  }
  return (
    <div className="space-y-3" data-power-vision-panel>
      {drafts.map((d) => (
        <div key={d.id} className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold text-sm text-foreground">{d.title}</h3>
              {d.rationale && <p className="text-xs text-muted-foreground mt-0.5">{d.rationale}</p>}
            </div>
            {d.progress && (
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {d.progress.done} of {d.progress.total}
              </span>
            )}
          </div>

          {d.vision && (
            <ul className="mt-2 space-y-1.5">
              {d.vision.objectives.map((o, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 w-3.5 h-3.5 rounded-full border inline-flex items-center justify-center text-[9px] ${
                      o.done ? "bg-sage/80 border-sage text-white" : "border-border text-transparent"
                    }`}
                  >
                    ✓
                  </span>
                  <span className={o.done ? "text-foreground" : "text-muted-foreground"}>
                    {o.text}
                    {o.source === "measured" && o.target !== null && (
                      <span className="text-muted-foreground"> · {o.current ?? 0} of {o.target}</span>
                    )}
                    {o.source === "declared" && <span className="text-muted-foreground"> · a human ticks this</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {!d.vision && (
            <p className="text-xs text-muted-foreground mt-2">
              This draft has no objectives yet, so nothing can say when it is ready.
            </p>
          )}

          {d.progress?.allDone && (
            <div className="mt-3 bg-sage/10 border border-sage/40 rounded-lg px-3 py-2 text-xs" data-power-vision-met>
              <p className="font-medium text-foreground">Vision conditions met: apply this structure?</p>
              {isAdmin ? (
                <a href="/admin" className="inline-flex items-center gap-1 text-teal-deep font-medium mt-1">
                  Open the draft's publish button <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              ) : (
                <p className="text-muted-foreground mt-1">{catalyst.aNameCap} applies it from the drafts panel. Nothing applies itself.</p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
