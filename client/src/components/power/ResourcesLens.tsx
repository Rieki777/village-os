/**
 * The resources lens (0084, lane L3): how money flows, drawn OVER the power
 * map through PowerMap's `lenses` seam. No file of L2's changes: the layout
 * grows through `layoutForShape`'s pad argument and this `<g>` rides inside
 * the SVG after the seats.
 *
 * Declared and measured are different strokes ON PURPOSE (harm metric d):
 * a declared flow is dotted, because it is a promise the village wrote
 * down; a measured flow is solid, because the ledger and the charges table
 * counted it. The key says both words, and colour never stands alone.
 *
 * Reads /api/resources and draws:
 *   - funding sources on an outer ring, dotted arrows into the treasury
 *   - measured inflows (counts and totals only) as solid arrows
 *   - budget arcs treasury to circle centres, stroke scaled by amount
 *   - seat pills "up to X alone" where an approval-free rule applies
 *   - short approval marks from a scope to whoever says yes
 */
import { useEffect, useState } from "react";
import type { NestedLayout } from "@shared/mapLayout";
import { crossRate, formatMoney } from "@shared/money";
import { authToken } from "@/lib/gameApi";
import type { PowerCircle } from "./types";
import { storedDisplayCurrency, type FxTable } from "./CurrencyPicker";

/** The outer margin the layout grows by while this lens is on: room for
 *  the source ring outside the village line. */
export const RESOURCES_PAD = 150;

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

export interface ResourcesRule {
  id: string;
  scope: "circle" | "role";
  scopeId: string;
  amountMinor: number;
  unit: string;
  approval: string;
  approvalNote: string | null;
  paidFrom: string;
  visibility: "village" | "holders";
  note: string | null;
  isExample?: boolean;
}

export interface ResourcesSource {
  id?: string;
  name: string;
  kind: string;
  sharePct?: number | null;
  amountMinorPerYear?: number | null;
  unit?: string | null;
}

export interface ResourcesBudget {
  id: string;
  circleId: string;
  seasonId: string | null;
  amountMinor: number;
  unit: string;
}

export interface ResourcesMeasured {
  fiat: Array<{ module: string; currency: string; count: number; totalMinor: number }>;
  tokens: Array<{ account: string; tokenType: string; direction: "in" | "out"; count: number; total: number }>;
}

export interface ResourcesData {
  tier: "public" | "member" | "declarer";
  rules: ResourcesRule[];
  sources: ResourcesSource[];
  budgets: ResourcesBudget[];
  measured: ResourcesMeasured | null;
  vocab: {
    approvals: Array<{ id: string; label: string }>;
    paidFrom: Array<{ id: string; label: string }>;
    sourceKinds: Array<{ id: string; label: string }>;
  };
  defaultUnit?: string;
  circleLeads?: Record<string, string>;
  seatNames?: Record<string, string>;
  viewer: { userId: string | null; canRequest: boolean; canDeclare: boolean };
}

/** Fetch the resources picture while the lens is on. 401 and 404 read as
 *  "nothing to draw": the module gate already said what it wanted to say. */
export function useResources(on: boolean): ResourcesData | null {
  const [data, setData] = useState<ResourcesData | null>(null);
  useEffect(() => {
    if (!on || data) return;
    fetch("/api/resources", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);
  return on ? data : null;
}

const DECLARED_DASH = "5 4";
const FLOW_TONE = "var(--color-teal-deep)";
const MEASURED_TONE = "var(--color-sage)";

/** Budget stroke: 1.5 to 8, scaled inside this view's own amounts. */
function budgetStroke(amountMinor: number, maxMinor: number): number {
  if (maxMinor <= 0) return 1.5;
  return 1.5 + 6.5 * Math.min(1, amountMinor / maxMinor);
}

function shortMoney(amountMinor: number, unit: string): string {
  if (/^[A-Z]{3}$/.test(unit)) return formatMoney(amountMinor, unit);
  return `${amountMinor} ${unit.replace(/^token:/, "")}`;
}

export default function ResourcesLens({
  layout,
  circles,
  resources,
}: {
  layout: NestedLayout;
  circles: PowerCircle[];
  resources: ResourcesData;
}) {
  const v = layout.village;
  // The treasury stands at 12 o'clock on the village line.
  const treasury = { x: v.x, y: v.y - v.r };
  const circleById = new Map(circles.map((c) => [c.id, c]));
  const posById = new Map(layout.circles.map((p) => [p.id, p]));

  // Where a seat sits, looked up across every circle plus the village ring.
  const seatPos = (roleId: string): { x: number; y: number } | null => {
    for (const c of layout.circles) {
      const s = c.roles.find((r) => r.id === roleId);
      if (s) return { x: s.x, y: s.y };
    }
    const vs = v.roles.find((r) => r.id === roleId);
    return vs ? { x: vs.x, y: vs.y } : null;
  };

  // Sources fan across the top arc OUTSIDE the village line, in the pad.
  const sourceRing = v.r + RESOURCES_PAD * 0.55;
  const declared = resources.sources;
  const sourceNodes = declared.map((s, i) => {
    const span = Math.min(Math.PI * 0.8, Math.max(0.5, declared.length * 0.32));
    const a = -Math.PI / 2 + (declared.length === 1 ? 0 : span * (i / (declared.length - 1) - 0.5));
    return { ...s, x: v.x + sourceRing * Math.cos(a), y: v.y + sourceRing * Math.sin(a) };
  });

  // Measured inflows gather on the right shoulder, solid.
  const measuredRows = [
    ...(resources.measured?.fiat ?? []).map((f) => ({
      key: `fiat-${f.module}-${f.currency}`,
      label: `${f.module}: ${formatMoney(f.totalMinor, f.currency)} in ${f.count} payment${f.count === 1 ? "" : "s"}`,
    })),
    ...(resources.measured?.tokens ?? [])
      .filter((t) => t.direction === "in" && t.count > 0)
      .map((t) => ({
        key: `tok-${t.account}-${t.tokenType}`,
        label: `${t.account.replace(/^sys:/, "")}: ${t.total} ${t.tokenType} in ${t.count} move${t.count === 1 ? "" : "s"}`,
      })),
  ].slice(0, 6);

  const maxBudget = Math.max(0, ...resources.budgets.map((b) => b.amountMinor));

  // The alone pill for a seat: its own role rule first, else its circle's.
  const aloneRules = resources.rules.filter((r) => r.approval === "none");
  const roleAlone = new Map(aloneRules.filter((r) => r.scope === "role").map((r) => [r.scopeId, r]));
  const circleAlone = new Map(aloneRules.filter((r) => r.scope === "circle").map((r) => [r.scopeId, r]));

  // Approval marks: one per rule that needs a yes, from its scope's anchor.
  const approvalRules = resources.rules.filter((r) => r.approval !== "none");

  const anchorFor = (rule: ResourcesRule): { x: number; y: number } | null => {
    if (rule.scope === "role") return seatPos(rule.scopeId);
    const p = posById.get(rule.scopeId);
    return p ? { x: p.x, y: p.y } : null;
  };

  const approverPoint = (rule: ResourcesRule): { x: number; y: number; chip?: string } | null => {
    if (rule.approval === "founders") return { x: v.x, y: v.y };
    if (rule.approval === "treasury") return treasury;
    if (rule.approval === "lead") {
      const circleId = rule.scope === "circle" ? rule.scopeId : (circleById.get(rule.scopeId)?.id ?? null);
      const leadRole = circleId ? resources.circleLeads?.[circleId] : undefined;
      const p = leadRole ? seatPos(leadRole) : null;
      if (p) return p;
      const c = rule.scope === "circle" ? posById.get(rule.scopeId) : null;
      return c ? { x: c.x, y: c.y } : null;
    }
    return null; // circle-consent draws an arc; hypha and other draw chips
  };

  return (
    <g data-resources-lens aria-hidden="true" pointerEvents="none">
      {/* Declared source arrows: dotted, because they are a story told. */}
      {sourceNodes.map((s) => (
        <g key={`src-${s.name}-${s.kind}`}>
          <line
            x1={s.x}
            y1={s.y}
            x2={treasury.x}
            y2={treasury.y - 16}
            stroke={FLOW_TONE}
            strokeWidth={1.6}
            strokeDasharray={DECLARED_DASH}
            opacity={0.7}
            data-resources-declared
          />
          <circle cx={s.x} cy={s.y} r={9} fill="var(--color-card, #fff)" stroke={FLOW_TONE} strokeWidth={1.6} strokeDasharray={DECLARED_DASH} />
          <text x={s.x} y={s.y - 14} textAnchor="middle" className="fill-foreground" style={{ fontSize: 11, fontWeight: 600 }}>
            {s.name}
          </text>
          <text x={s.x} y={s.y + 22} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 9 }}>
            {resources.vocab.sourceKinds.find((k) => k.id === s.kind)?.label ?? s.kind}
            {s.sharePct !== null && s.sharePct !== undefined ? ` · ${s.sharePct}%` : ""}
          </text>
        </g>
      ))}

      {/* Measured inflows: solid, because somebody counted them. */}
      {measuredRows.map((m, i) => {
        const a = -Math.PI / 6 + i * 0.22;
        const x = v.x + (v.r + RESOURCES_PAD * 0.45) * Math.cos(a);
        const y = v.y + (v.r + RESOURCES_PAD * 0.45) * Math.sin(a);
        return (
          <g key={m.key}>
            <line x1={x} y1={y} x2={treasury.x + 14} y2={treasury.y} stroke={MEASURED_TONE} strokeWidth={2} opacity={0.85} data-resources-measured />
            <text x={x + 6} y={y + 3} textAnchor="start" className="fill-muted-foreground" style={{ fontSize: 9 }}>
              {m.label}
            </text>
          </g>
        );
      })}

      {/* The treasury node. */}
      <g>
        <circle cx={treasury.x} cy={treasury.y} r={13} fill="var(--color-amber)" fillOpacity={0.25} stroke={FLOW_TONE} strokeWidth={2} />
        <text x={treasury.x} y={treasury.y + 3.5} textAnchor="middle" style={{ fontSize: 10, fontWeight: 700 }} className="fill-foreground">
          $
        </text>
        <text x={treasury.x} y={treasury.y - 18} textAnchor="middle" className="fill-foreground" style={{ fontSize: 11, fontWeight: 600 }}>
          Treasury
        </text>
      </g>

      {/* Budget arcs treasury to circle centres: declared envelopes, dotted,
          stroke carrying the size. */}
      {resources.budgets.map((b) => {
        const p = posById.get(b.circleId);
        if (!p) return null;
        const mx = (treasury.x + p.x) / 2;
        const my = Math.min(treasury.y, p.y) - 30;
        return (
          <g key={b.id}>
            <path
              d={`M ${treasury.x} ${treasury.y} Q ${mx} ${my} ${p.x} ${p.y}`}
              fill="none"
              stroke={FLOW_TONE}
              strokeWidth={budgetStroke(b.amountMinor, maxBudget)}
              strokeDasharray={DECLARED_DASH}
              opacity={0.55}
              data-resources-declared
              data-resources-budget={b.circleId}
            />
            <text x={p.x} y={p.y - (posById.get(b.circleId)?.r ?? 0) - 6} textAnchor="middle" className="fill-foreground" style={{ fontSize: 10, fontWeight: 600 }}>
              {shortMoney(b.amountMinor, b.unit)}
              {b.seasonId ? ` · ${b.seasonId}` : ""}
            </text>
          </g>
        );
      })}

      {/* Seat pills: "up to X alone", the role's own rule before the circle's. */}
      {layout.circles.map((pos) =>
        pos.roles.map((rp) => {
          const rule = roleAlone.get(rp.id) ?? circleAlone.get(pos.id);
          if (!rule) return null;
          const label = `up to ${shortMoney(rule.amountMinor, rule.unit)} alone`;
          const w = label.length * 4.6 + 10;
          return (
            <g key={`pill-${rp.id}`} data-resources-pill={rp.id}>
              <rect x={rp.x - w / 2} y={rp.y + 12} width={w} height={13} rx={6.5} fill="var(--color-card, #fff)" stroke={FLOW_TONE} strokeWidth={0.8} opacity={0.92} />
              <text x={rp.x} y={rp.y + 21.5} textAnchor="middle" className="fill-foreground" style={{ fontSize: 8.5 }}>
                {label}
              </text>
            </g>
          );
        }),
      )}

      {/* Approval marks. Consent is an arc on the circle itself; a named
          approver gets a short arrow; hypha and other wear a chip. */}
      {approvalRules.map((rule) => {
        const from = anchorFor(rule);
        if (!from) return null;
        if (rule.approval === "circle-consent") {
          const p = rule.scope === "circle" ? posById.get(rule.scopeId) : null;
          if (!p) return null;
          const r = Math.max(6, p.r - 6);
          return (
            <path
              key={`ap-${rule.id}`}
              d={`M ${p.x - r * 0.7} ${p.y - r * 0.7} A ${r} ${r} 0 0 1 ${p.x + r * 0.7} ${p.y - r * 0.7}`}
              fill="none"
              stroke={FLOW_TONE}
              strokeWidth={2.2}
              strokeDasharray="2 3"
              opacity={0.8}
              data-resources-approval="circle-consent"
            />
          );
        }
        if (rule.approval === "hypha" || rule.approval === "other") {
          const word = rule.approval === "hypha" ? "Hypha" : (rule.approvalNote ?? "other");
          const w = word.length * 5.4 + 12;
          return (
            <g key={`ap-${rule.id}`} data-resources-approval={rule.approval}>
              <rect x={from.x - w / 2} y={from.y - 34} width={w} height={14} rx={7} fill={FLOW_TONE} opacity={0.85} />
              <text x={from.x} y={from.y - 24} textAnchor="middle" fill="var(--color-card, #fff)" style={{ fontSize: 9 }}>
                {word}
              </text>
            </g>
          );
        }
        const to = approverPoint(rule);
        if (!to) return null;
        return (
          <line
            key={`ap-${rule.id}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={FLOW_TONE}
            strokeWidth={1.4}
            strokeDasharray="1.5 3"
            opacity={0.6}
            data-resources-approval={rule.approval}
          />
        );
      })}
    </g>
  );
}

/**
 * The words beside the strokes. Declared and measured are said in words as
 * well as drawn in dashes, and a currency pair with no rate on file is said
 * PLAINLY: until 2026-09-25 the daily list carried no CRC, so a colones amount stayed a
 * colones amount until an admin records a manual rate. Reads the viewer's
 * stored display choice and the fx table itself, so the page passes nothing.
 */
export function ResourcesKey({ resources }: { resources: ResourcesData }) {
  const [fx, setFx] = useState<FxTable | null>(null);
  useEffect(() => {
    fetch("/api/fx/rates")
      .then((r) => (r.ok ? r.json() : null))
      .then(setFx)
      .catch(() => {});
  }, []);
  const units = new Set<string>();
  for (const r of resources.rules) if (/^[A-Z]{3}$/.test(r.unit)) units.add(r.unit);
  for (const b of resources.budgets) if (/^[A-Z]{3}$/.test(b.unit)) units.add(b.unit);
  for (const s of resources.sources) if (s.unit && /^[A-Z]{3}$/.test(s.unit)) units.add(s.unit);
  const chosen = storedDisplayCurrency() || resources.defaultUnit || null;
  const unconverted = chosen
    ? Array.from(units).filter((u) => u !== chosen && crossRate(fx?.rates ?? {}, u, chosen) === null)
    : [];
  return (
    <div className="space-y-1" data-resources-key>
      <div className="flex items-center gap-3 flex-wrap text-xs text-foreground">
        <span className="inline-flex items-center gap-1.5">
          <svg width="26" height="6" aria-hidden="true">
            <line x1="0" y1="3" x2="26" y2="3" stroke="var(--color-teal-deep)" strokeWidth="2" strokeDasharray="5 4" />
          </svg>
          declared
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="26" height="6" aria-hidden="true">
            <line x1="0" y1="3" x2="26" y2="3" stroke="var(--color-sage)" strokeWidth="2.5" />
          </svg>
          measured
        </span>
        <span className="text-muted-foreground">Dotted is what the village declares. Solid is what the ledger counted.</span>
      </div>
      {unconverted.length > 0 && chosen && (
        <p className="text-xs text-muted-foreground" data-resources-unconverted>
          No exchange rate is on file to show {unconverted.join(", ")} in {chosen} yet, so those amounts stay in their own currency.
        </p>
      )}
    </div>
  );
}
