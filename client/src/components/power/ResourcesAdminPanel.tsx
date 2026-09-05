/**
 * Admin, The Game, How Resources Flow (0084, lane L3).
 *
 * The founder's surface for the three declaration tables: spending rules,
 * funding sources, circle budgets, plus the labels editor that lets a
 * village say the vocabulary in its own words (R29 P4). Everything here is
 * a declaration; nothing debits, credits or settles anything, and the
 * measured strip at the bottom is counts and totals the ledger and the
 * charges table already knew.
 *
 * Self-contained like EventsAdminPanel, for the same reason: Admin.tsx is
 * a large file other workstreams edit, so the mount is one line. Admin
 * tabs are not filtered by module lifecycle; the off state is handled
 * here, in words.
 */
import { useCallback, useEffect, useState } from "react";
import { exponentOf, formatMoney } from "@shared/money";
import { ResourcesRoutingEditor } from "@/components/admin/ModuleConfigPanels";

interface Rule {
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
}

interface Source {
  id: string;
  name: string;
  kind: string;
  sharePct: number | null;
  amountMinorPerYear: number | null;
  unit: string | null;
  note: string | null;
  sortOrder: number;
}

interface Budget {
  id: string;
  circleId: string;
  seasonId: string | null;
  amountMinor: number;
  unit: string;
  note: string | null;
}

interface AdminPayload {
  rules: Rule[];
  sources: Source[];
  budgets: Budget[];
  vocab: {
    approvals: Array<{ id: string; label: string }>;
    paidFrom: Array<{ id: string; label: string }>;
    sourceKinds: Array<{ id: string; label: string }>;
  };
  config: { requestCategory: string; measuredVisibleTo: string; labels: Record<string, string> };
  defaultUnit: string;
  circles: Array<{ id: string; name: string }>;
  seats: Array<{ id: string; name: string; circleId: string | null }>;
  measured: {
    fiat: Array<{ module: string; currency: string; count: number; totalMinor: number }>;
    tokens: Array<{ account: string; tokenType: string; direction: string; count: number; total: number }>;
  } | null;
}

function isIso(unit: string): boolean {
  return /^[A-Z]{3}$/.test(unit);
}

function money(amountMinor: number, unit: string): string {
  if (isIso(unit)) return formatMoney(amountMinor, unit);
  return `${amountMinor} ${unit.replace(/^token:/, "")}`;
}

/** Major-unit text to minor units for the unit's own exponent. */
function toMinor(text: string, unit: string): number {
  const major = Number(text);
  if (!Number.isFinite(major) || major <= 0) return 0;
  const digits = isIso(unit) ? exponentOf(unit) : 0;
  return Math.round(major * Math.pow(10, digits));
}

const EMPTY_RULE = {
  scope: "circle",
  scopeId: "",
  amount: "",
  unit: "",
  approval: "none",
  approvalNote: "",
  paidFrom: "circle-budget",
  visibility: "village",
  note: "",
};

const EMPTY_SOURCE = { name: "", kind: "donations", sharePct: "", amountPerYear: "", unit: "", note: "" };
const EMPTY_BUDGET = { circleId: "", seasonId: "", amount: "", unit: "", note: "" };

export default function ResourcesAdminPanel({ password }: { password: string }) {
  const auth = { Authorization: `Bearer ${password}` };
  const [data, setData] = useState<AdminPayload | null>(null);
  const [moduleOff, setModuleOff] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [rule, setRule] = useState({ ...EMPTY_RULE });
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [source, setSource] = useState({ ...EMPTY_SOURCE });
  const [budget, setBudget] = useState({ ...EMPTY_BUDGET });
  const [labelDraft, setLabelDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/resources", { headers: auth });
    if (res.status === 404) {
      setModuleOff(true);
      return;
    }
    if (!res.ok) {
      setProblem("The resources surface did not answer. Check the admin password.");
      return;
    }
    const d = (await res.json()) as AdminPayload;
    setModuleOff(false);
    setData(d);
    setLabelDraft(d.config.labels ?? {});
    setRule((r) => ({ ...r, unit: r.unit || d.defaultUnit, scopeId: r.scopeId || (d.circles[0]?.id ?? "") }));
    setSource((s) => ({ ...s, unit: s.unit || d.defaultUnit }));
    setBudget((b) => ({
      ...b,
      unit: b.unit || d.defaultUnit,
      circleId: b.circleId || (d.circles[0]?.id ?? ""),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (route: string, method: string, body?: unknown) => {
    setProblem(null);
    setNote(null);
    const res = await fetch(route, {
      method,
      headers: { "Content-Type": "application/json", ...auth },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setProblem(String(json?.error ?? "That did not go through"));
      return false;
    }
    await load();
    return true;
  };

  const saveRule = async () => {
    const ok = await act("/api/admin/resources/rules", "POST", {
      id: editingRuleId ?? undefined,
      scope: rule.scope,
      scopeId: rule.scopeId,
      amountMinor: toMinor(rule.amount, rule.unit.trim()),
      unit: rule.unit.trim(),
      approval: rule.approval,
      approvalNote: rule.approvalNote.trim() || undefined,
      paidFrom: rule.paidFrom,
      visibility: rule.visibility,
      note: rule.note.trim() || undefined,
    });
    if (ok) {
      setRule({ ...EMPTY_RULE, unit: data?.defaultUnit ?? "", scopeId: data?.circles?.[0]?.id ?? "" });
      setEditingRuleId(null);
      setNote("The rule is written.");
    }
  };

  const saveSource = async () => {
    const amountMinorPerYear = source.amountPerYear.trim() ? toMinor(source.amountPerYear, source.unit.trim()) : null;
    const ok = await act("/api/admin/resources/sources", "POST", {
      name: source.name,
      kind: source.kind,
      sharePct: source.sharePct.trim() ? Number(source.sharePct) : null,
      amountMinorPerYear,
      unit: amountMinorPerYear ? source.unit.trim() : undefined,
      note: source.note.trim() || undefined,
    });
    if (ok) {
      setSource({ ...EMPTY_SOURCE, unit: data?.defaultUnit ?? "" });
      setNote("The source is written.");
    }
  };

  const saveBudget = async () => {
    const ok = await act("/api/admin/resources/budgets", "POST", {
      circleId: budget.circleId,
      seasonId: budget.seasonId.trim() || undefined,
      amountMinor: toMinor(budget.amount, budget.unit.trim()),
      unit: budget.unit.trim(),
      note: budget.note.trim() || undefined,
    });
    if (ok) {
      setBudget({ ...EMPTY_BUDGET, unit: data?.defaultUnit ?? "", circleId: data?.circles?.[0]?.id ?? "" });
      setNote("The budget is written.");
    }
  };

  const saveLabels = async () => {
    if (!data) return;
    const labels: Record<string, string> = {};
    for (const [k, v] of Object.entries(labelDraft)) if (v.trim()) labels[k] = v.trim();
    const ok = await act("/api/admin/modules/resources/config", "PUT", {
      config: { ...data.config, labels },
    });
    if (ok) setNote("The labels are yours now.");
  };

  if (moduleOff) {
    return (
      <div className="max-w-2xl">
        <h1 className="font-display text-2xl font-bold text-foreground mb-2">How Resources Flow</h1>
        <p className="text-sm text-muted-foreground">
          The resources module is off. Turn it on under Module Library and this tab becomes the
          place to declare who may spend what, with whose approval, paid from where, and where the
          money comes from.
        </p>
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground">{problem ?? "Reading the declarations…"}</p>;
  }

  const circleName = (id: string) => data.circles.find((c) => c.id === id)?.name ?? id;
  const seatName = (id: string) => data.seats.find((s) => s.id === id)?.name ?? id;
  const scopeName = (r: Rule) => (r.scope === "circle" ? circleName(r.scopeId) : seatName(r.scopeId));
  const approvalLabel = (id: string) => data.vocab.approvals.find((a) => a.id === id)?.label ?? id;
  const paidFromLabel = (id: string) => data.vocab.paidFrom.find((p) => p.id === id)?.label ?? id;

  const empty = data.rules.length + data.sources.length + data.budgets.length === 0;

  const input = "mt-1 w-full border border-border rounded-lg px-2 py-1.5 text-sm bg-background text-foreground";
  const label = "block text-xs text-muted-foreground";
  const button = "text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-semibold disabled:opacity-50";

  return (
    <div className="max-w-3xl space-y-8" data-resources-admin>
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground mb-1">How Resources Flow</h1>
        <p className="text-sm text-muted-foreground">
          Declarations, never movements: these rows say who may spend what and where money comes
          from. Nothing here touches a balance.
        </p>
        {empty && (
          <div className="mt-3 text-sm text-foreground bg-amber/10 border border-amber/40 rounded-lg px-3 py-2">
            Nothing is declared yet. Three rows make the map speak: one spending rule for a circle
            (what its people may spend alone), one funding source (where the money comes from), and
            one circle budget (what the circle holds this season).
          </div>
        )}
        {problem && <p role="alert" className="mt-2 text-sm text-red-600">{problem}</p>}
        {note && <p role="status" className="mt-2 text-sm text-teal-deep">{note}</p>}
      </div>

      {/* ── Spending rules ── */}
      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold text-foreground">Spending rules</h2>
        {data.rules.length > 0 && (
          <div className="space-y-1.5">
            {data.rules.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-sm bg-muted/40 rounded-lg px-3 py-2">
                <span className="text-foreground/90">
                  <span className="font-semibold">{scopeName(r)}</span>: up to {money(r.amountMinor, r.unit)},{" "}
                  {approvalLabel(r.approval).toLowerCase()}, paid from {paidFromLabel(r.paidFrom).toLowerCase()}
                  {r.visibility === "holders" ? ", holders only" : ""}
                </span>
                <span className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    className="text-xs text-teal-deep font-medium"
                    onClick={() => {
                      setEditingRuleId(r.id);
                      setRule({
                        scope: r.scope,
                        scopeId: r.scopeId,
                        amount: String(r.amountMinor / Math.pow(10, isIso(r.unit) ? exponentOf(r.unit) : 0)),
                        unit: r.unit,
                        approval: r.approval,
                        approvalNote: r.approvalNote ?? "",
                        paidFrom: r.paidFrom,
                        visibility: r.visibility,
                        note: r.note ?? "",
                      });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-xs text-red-600 font-medium"
                    onClick={() => act(`/api/admin/resources/rules/${r.id}`, "DELETE")}
                  >
                    Remove
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className={label}>
            Scope
            <select className={input} value={rule.scope} onChange={(e) => setRule({ ...rule, scope: e.target.value, scopeId: "" })}>
              <option value="circle">A circle</option>
              <option value="role">A seat</option>
            </select>
          </label>
          <label className={label}>
            {rule.scope === "circle" ? "Which circle" : "Which seat"}
            <select className={input} value={rule.scopeId} onChange={(e) => setRule({ ...rule, scopeId: e.target.value })}>
              <option value="">Pick one</option>
              {(rule.scope === "circle"
                ? data.circles.map((c) => ({ id: c.id, label: c.name }))
                : data.seats.map((s) => ({ id: s.id, label: s.circleId ? `${s.name} (${circleName(s.circleId)})` : s.name }))
              ).map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className={label}>
            Up to (major units)
            <input className={input} type="number" min="0" step="any" value={rule.amount} onChange={(e) => setRule({ ...rule, amount: e.target.value })} />
          </label>
          <label className={label}>
            Unit (CHF, CRC, or token:slug)
            <input className={input} value={rule.unit} onChange={(e) => setRule({ ...rule, unit: e.target.value })} />
          </label>
          <label className={label}>
            Approval
            <select className={input} value={rule.approval} onChange={(e) => setRule({ ...rule, approval: e.target.value })}>
              {data.vocab.approvals.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </label>
          {rule.approval === "other" && (
            <label className={label}>
              Who says yes, in your words
              <input className={input} value={rule.approvalNote} onChange={(e) => setRule({ ...rule, approvalNote: e.target.value })} />
            </label>
          )}
          <label className={label}>
            Paid from
            <select className={input} value={rule.paidFrom} onChange={(e) => setRule({ ...rule, paidFrom: e.target.value })}>
              {data.vocab.paidFrom.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>
          <label className={label}>
            Who sees it
            <select className={input} value={rule.visibility} onChange={(e) => setRule({ ...rule, visibility: e.target.value })}>
              <option value="village">The whole village</option>
              <option value="holders">Holders of this scope only</option>
            </select>
          </label>
          <label className={`${label} col-span-2`}>
            Note{rule.paidFrom === "other" ? " (required: which pot is this)" : ""}
            <input className={input} value={rule.note} onChange={(e) => setRule({ ...rule, note: e.target.value })} />
          </label>
        </div>
        <button type="button" className={button} disabled={!rule.scopeId || !rule.amount} onClick={saveRule}>
          {editingRuleId ? "Save the rule" : "Declare the rule"}
        </button>
        {editingRuleId && (
          <button
            type="button"
            className="ml-2 text-sm text-muted-foreground underline underline-offset-2"
            onClick={() => {
              setEditingRuleId(null);
              setRule({ ...EMPTY_RULE, unit: data.defaultUnit, scopeId: data.circles[0]?.id ?? "" });
            }}
          >
            Stop editing
          </button>
        )}
      </section>

      {/* ── Funding sources ── */}
      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold text-foreground">Where the money comes from</h2>
        {data.sources.length > 0 && (
          <div className="space-y-1.5">
            {data.sources.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 text-sm bg-muted/40 rounded-lg px-3 py-2">
                <span className="text-foreground/90">
                  <span className="font-semibold">{s.name}</span>
                  {": "}
                  {data.vocab.sourceKinds.find((k) => k.id === s.kind)?.label.toLowerCase() ?? s.kind}
                  {s.sharePct !== null ? `, about ${s.sharePct}% of the whole` : ""}
                  {s.amountMinorPerYear !== null && s.unit ? `, about ${money(s.amountMinorPerYear, s.unit)} a year` : ""}
                </span>
                <button type="button" className="text-xs text-red-600 font-medium shrink-0" onClick={() => act(`/api/admin/resources/sources/${s.id}`, "DELETE")}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className={label}>
            Name
            <input className={input} value={source.name} onChange={(e) => setSource({ ...source, name: e.target.value })} />
          </label>
          <label className={label}>
            Kind
            <select className={input} value={source.kind} onChange={(e) => setSource({ ...source, kind: e.target.value })}>
              {data.vocab.sourceKinds.map((k) => (
                <option key={k.id} value={k.id}>{k.label}</option>
              ))}
            </select>
          </label>
          <label className={label}>
            Share of the whole (%, optional)
            <input className={input} type="number" min="0" max="100" step="any" value={source.sharePct} onChange={(e) => setSource({ ...source, sharePct: e.target.value })} />
          </label>
          <label className={label}>
            Or an amount a year (major units, optional)
            <input className={input} type="number" min="0" step="any" value={source.amountPerYear} onChange={(e) => setSource({ ...source, amountPerYear: e.target.value })} />
          </label>
          <label className={label}>
            Unit for that amount
            <input className={input} value={source.unit} onChange={(e) => setSource({ ...source, unit: e.target.value })} />
          </label>
          <label className={label}>
            Note{source.kind === "other" ? " (required: what is this source)" : ""}
            <input className={input} value={source.note} onChange={(e) => setSource({ ...source, note: e.target.value })} />
          </label>
        </div>
        <button type="button" className={button} disabled={!source.name.trim()} onClick={saveSource}>
          Declare the source
        </button>
      </section>

      {/* ── Circle budgets ── */}
      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold text-foreground">Circle budgets</h2>
        {data.budgets.length > 0 && (
          <div className="space-y-1.5">
            {data.budgets.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-2 text-sm bg-muted/40 rounded-lg px-3 py-2">
                <span className="text-foreground/90">
                  <span className="font-semibold">{circleName(b.circleId)}</span> holds {money(b.amountMinor, b.unit)}
                  {b.seasonId ? ` for season ${b.seasonId}` : " as a standing envelope"}
                </span>
                <button type="button" className="text-xs text-red-600 font-medium shrink-0" onClick={() => act(`/api/admin/resources/budgets/${b.id}`, "DELETE")}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className={label}>
            Circle
            <select className={input} value={budget.circleId} onChange={(e) => setBudget({ ...budget, circleId: e.target.value })}>
              {data.circles.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className={label}>
            Season id (blank for a standing envelope)
            <input className={input} value={budget.seasonId} onChange={(e) => setBudget({ ...budget, seasonId: e.target.value })} />
          </label>
          <label className={label}>
            Amount (major units)
            <input className={input} type="number" min="0" step="any" value={budget.amount} onChange={(e) => setBudget({ ...budget, amount: e.target.value })} />
          </label>
          <label className={label}>
            Unit
            <input className={input} value={budget.unit} onChange={(e) => setBudget({ ...budget, unit: e.target.value })} />
          </label>
        </div>
        <button type="button" className={button} disabled={!budget.circleId || !budget.amount} onClick={saveBudget}>
          Declare the budget
        </button>
      </section>

      {/* ── Labels (R29 P4) ── */}
      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold text-foreground">Your words for the vocabulary</h2>
        <p className="text-xs text-muted-foreground">
          The ids never change; the words are yours. Blank keeps the platform wording.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {[
            ...data.vocab.approvals.map((a) => ({ key: `approval.${a.id}`, fallback: a.label })),
            ...data.vocab.paidFrom.map((p) => ({ key: `paidFrom.${p.id}`, fallback: p.label })),
            ...data.vocab.sourceKinds.map((k) => ({ key: `sourceKind.${k.id}`, fallback: k.label })),
          ].map(({ key, fallback }) => (
            <label key={key} className={label}>
              {key}
              <input
                className={input}
                placeholder={fallback}
                value={labelDraft[key] ?? ""}
                onChange={(e) => setLabelDraft({ ...labelDraft, [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <button type="button" className={button} onClick={saveLabels}>
          Save the labels
        </button>
      </section>

      {/* ── Routing and visibility: two config keys with no control until now ── */}
      <ResourcesRoutingEditor password={password} />

      {/* ── Measured, read only ── */}
      {data.measured && (data.measured.fiat.length > 0 || data.measured.tokens.length > 0) && (
        <section className="space-y-2">
          <h2 className="font-display text-lg font-bold text-foreground">Measured inflows</h2>
          <p className="text-xs text-muted-foreground">
            Counts and totals the ledger and the charges table already knew. Read only, no names.
          </p>
          <div className="text-sm text-foreground/90 space-y-1">
            {data.measured.fiat.map((f) => (
              <p key={`${f.module}-${f.currency}`}>
                {f.module}: {money(f.totalMinor, f.currency)} across {f.count} payment{f.count === 1 ? "" : "s"}
              </p>
            ))}
            {data.measured.tokens
              .filter((t) => t.direction === "in")
              .map((t) => (
                <p key={`${t.account}-${t.tokenType}`}>
                  {t.account.replace(/^sys:/, "")}: {t.total} {t.tokenType} across {t.count} move{t.count === 1 ? "" : "s"}
                </p>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
