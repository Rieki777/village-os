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
import { finerThanScale } from "@shared/tokenScale";
import { formatTokenAmount } from "@/lib/tokenAmount";
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
  /** The SEASON cap. */
  amountMinor: number;
  /** The CYCLE cap (0206). Null means the village set none. */
  cycleAmountMinor: number | null;
  /**
   * WHICH MODEL THIS CIRCLE RUNS ON (0200). A cap permits and holds nothing; a
   * treasury is real tokens the circle owns and keeps across a period.
   */
  mode: "cap" | "treasury";
  /** A change to that model, queued for a period boundary. It has not happened. */
  pending: { mode: "cap" | "treasury"; from: string; by: string | null; at: string | null } | null;
  /** What the treasury held when the circle last went dormant, or null. */
  dormant: { heldMinor: number; at: string; destination: string } | null;
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
  /** Every registry token, with the scale its `token:<slug>` amounts are minor units at. */
  tokens?: TokenScale[];
  circles: Array<{ id: string; name: string }>;
  seats: Array<{ id: string; name: string; circleId: string | null }>;
  measured: {
    fiat: Array<{ module: string; currency: string; count: number; totalMinor: number }>;
    tokens: Array<{ account: string; tokenType: string; direction: string; count: number; total: number }>;
  } | null;
}

interface TokenScale {
  slug: string;
  name: string;
  decimals: number;
}

function isIso(unit: string): boolean {
  return /^[A-Z]{3}$/.test(unit);
}

const TOKEN_UNIT = /^token:(.+)$/;

/**
 * HOW MANY DECIMAL PLACES A UNIT'S MINOR UNITS CARRY, OR NULL FOR "NOT KNOWN".
 *
 * Every `amountMinor` this panel reads or sends is minor units at the unit's
 * real scale: Intl's exponent for a currency, the registry's `decimals` for
 * `token:<slug>`. The server posts treasury amounts straight to the ledger and
 * formats rules and budgets with the registry scale (`amountWords`,
 * server/lib/resources.ts). This panel used 0 digits for every token, so a
 * steward typing 60 on a two-decimal token minted 0.60, and a treasury holding
 * 125.50 read as 12550.
 *
 * NULL IS A REFUSAL, NEVER A ZERO. A token missing from the payload's registry
 * has a scale this page cannot see, and guessing 0 is exactly the defect above.
 * A unit that is neither shape reads 0: the server refuses that unit by name
 * whatever the amount, so no scale can make it post.
 */
function digitsFor(unit: string, tokens: TokenScale[] | undefined): number | null {
  if (isIso(unit)) return exponentOf(unit);
  const m = TOKEN_UNIT.exec(unit);
  if (!m) return 0;
  const t = tokens?.find((x) => x.slug === m[1]);
  const d = Number(t?.decimals);
  return t && Number.isInteger(d) && d >= 0 ? d : null;
}

function moneyAt(amountMinor: number, unit: string, tokens: TokenScale[] | undefined): string {
  if (isIso(unit)) return formatMoney(amountMinor, unit);
  const slug = unit.replace(/^token:/, "");
  const digits = digitsFor(unit, tokens);
  if (digits === null) return `${amountMinor} ${slug} in its smallest unit, because this page could not read its scale`;
  return `${formatTokenAmount(amountMinor, digits)} ${slug}`;
}

/**
 * One submission's idempotency id.
 *
 * The ledger key the server builds from `requestId` is what dedupes, so the id
 * has to name ONE SUBMISSION: the same on a double click or a retry, different
 * the next time a steward funds the same amount for the same reason. It was
 * built from the amount and the note, so next month's identical funding and a
 * second identical payment were both answered `duplicate: true` and moved
 * nothing, while this panel said "funded" and "Paid".
 */
function newRequestId(): string {
  const uuid = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.();
  return uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** What a steward reads when the server already had this exact submission. */
const ALREADY_RECORDED = "This exact request was already recorded, so nothing new moved.";

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
const EMPTY_BUDGET = { circleId: "", seasonId: "", amount: "", cycleAmount: "", unit: "", note: "", mode: "cap" };

/**
 * One row's treasury inputs. Kept per budget so two rows cannot share a draft.
 * `requestId` is minted on every edit (see `setDraft`), so it names what is in
 * the boxes when the button is pressed.
 */
const EMPTY_MOVE = { amount: "", toUserId: "", note: "", requestId: "" };

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
  const [move, setMove] = useState<Record<string, typeof EMPTY_MOVE>>({});
  /**
   * What each treasury holds, keyed by BUDGET id.
   *
   * Its own fetch, because the balance belongs to the treasury domain and the
   * declaration payload belongs to the resources module. One owner per
   * surface is what stops a lane widening somebody else's response.
   */
  const [treasuries, setTreasuries] = useState<Record<string, { account: string; balanceMinor: number; slug: string }>>({});
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
    // A treasury balance is a separate read and a FAILED one leaves the map
    // empty rather than showing a zero: an empty state and a real zero are
    // different facts, and the row prints "not read" for the first.
    const held = await fetch("/api/admin/resources/treasuries", { headers: auth });
    setTreasuries(held.ok ? ((await held.json())?.treasuries ?? {}) : {});

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

  /** The answer's body on success (so a caller can read `duplicate`), or null. */
  const act = async (route: string, method: string, body?: unknown): Promise<Record<string, any> | null> => {
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
      return null;
    }
    await load();
    return json ?? {};
  };

  /**
   * Typed major units into minor units at the unit's REAL scale, or null after
   * saying why nothing was sent. Blank, zero and junk come back as 0 so the
   * server's own sentence answers them, which is what they always did.
   */
  const minorOrRefuse = (text: string, unit: string): number | null => {
    const digits = digitsFor(unit, data?.tokens);
    if (digits === null) {
      setNote(null);
      setProblem(`This page could not read how many decimal places ${unit} carries, so it sent nothing. Reload the page. If this stays, that token is missing from the registry.`);
      return null;
    }
    const major = Number(text);
    if (!Number.isFinite(major) || major <= 0) return 0;
    if (finerThanScale(major, digits)) {
      setNote(null);
      setProblem(`${unit} goes to ${digits} decimal places, so ${text} cannot be sent exactly. Nothing was sent.`);
      return null;
    }
    return Math.round(major * 10 ** digits);
  };

  const saveRule = async () => {
    const amountMinor = minorOrRefuse(rule.amount, rule.unit.trim());
    if (amountMinor === null) return;
    const ok = await act("/api/admin/resources/rules", "POST", {
      id: editingRuleId ?? undefined,
      scope: rule.scope,
      scopeId: rule.scopeId,
      amountMinor,
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
    const perYear = source.amountPerYear.trim() ? minorOrRefuse(source.amountPerYear, source.unit.trim()) : 0;
    if (perYear === null) return;
    const amountMinorPerYear = source.amountPerYear.trim() ? perYear : null;
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
    const amountMinor = minorOrRefuse(budget.amount, budget.unit.trim());
    if (amountMinor === null) return;
    // Blank leaves the cycle cap unset. "0" is a real cap and means zero.
    const cycleAmountMinor = budget.cycleAmount.trim() === "" ? null : minorOrRefuse(budget.cycleAmount, budget.unit.trim());
    if (budget.cycleAmount.trim() !== "" && cycleAmountMinor === null) return;
    const ok = await act("/api/admin/resources/budgets", "POST", {
      circleId: budget.circleId,
      seasonId: budget.seasonId.trim() || undefined,
      amountMinor,
      cycleAmountMinor,
      unit: budget.unit.trim(),
      note: budget.note.trim() || undefined,
      // A mode is a STARTING CONDITION and only reaches the INSERT. Changing
      // the model of a budget that already exists waits for a period boundary
      // and goes through the schedule control below.
      mode: budget.mode,
    });
    if (ok) {
      setBudget({ ...EMPTY_BUDGET, unit: data?.defaultUnit ?? "", circleId: data?.circles?.[0]?.id ?? "" });
      setNote("The budget is written.");
    }
  };

  /** The draft for one budget row's treasury moves. */
  const draft = (id: string) => move[id] ?? EMPTY_MOVE;
  /**
   * EVERY EDIT IS A NEW SUBMISSION, so every edit mints a new `requestId`.
   * Pressing the button twice, or again after a failure, without touching the
   * boxes sends the same id and the ledger dedupes it. Clearing the boxes after
   * a success is an edit too, so the next identical funding is a new one.
   */
  const setDraft = (id: string, patch: Partial<Omit<typeof EMPTY_MOVE, "requestId">>) =>
    setMove((m) => ({ ...m, [id]: { ...(m[id] ?? EMPTY_MOVE), ...patch, requestId: newRequestId() } }));

  /**
   * SCHEDULE A MODE CHANGE. It lands at the period boundary and never now, so
   * the button says what will happen and the answer says when.
   */
  const scheduleMode = async (b: Budget) => {
    const asked = (b.pending?.mode ?? b.mode) === "treasury" ? "cap" : "treasury";
    const res = await fetch(`/api/admin/resources/budgets/${b.id}/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ mode: asked }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setProblem(String(json?.error ?? json?.message ?? "That did not go through"));
      return;
    }
    setNote(String(json?.message ?? "The change is queued."));
    await load();
  };

  /** MINT INTO A TREASURY. This is issuance and the village's cap binds it. */
  const fundTreasury = async (b: Budget) => {
    const d = draft(b.id);
    const amountMinor = minorOrRefuse(d.amount, b.unit);
    if (amountMinor === null) return;
    const answer = await act(`/api/admin/resources/budgets/${b.id}/fund`, "POST", {
      amountMinor,
      note: d.note.trim() || "Funding the circle's treasury",
      requestId: d.requestId || undefined,
    });
    if (answer) {
      setDraft(b.id, { amount: "" });
      setNote(answer.duplicate
        ? ALREADY_RECORDED
        : "The treasury is funded. Those tokens are minted, so they spent the village's issuance room for this cycle.");
    }
  };

  /** PAY SOMEBODY FROM A TREASURY. This moves tokens that already exist. */
  const spendTreasury = async (b: Budget) => {
    const d = draft(b.id);
    const amountMinor = minorOrRefuse(d.amount, b.unit);
    if (amountMinor === null) return;
    const answer = await act(`/api/admin/resources/budgets/${b.id}/spend`, "POST", {
      toUserId: d.toUserId.trim(),
      amountMinor,
      note: d.note.trim() || "Paid from the circle's treasury",
      requestId: d.requestId || undefined,
    });
    if (answer) {
      setDraft(b.id, { amount: "", toUserId: "" });
      setNote(answer.duplicate
        ? ALREADY_RECORDED
        : "Paid. A treasury spend moves tokens the circle already holds, so the village's issuance cap did not move.");
    }
  };

  /** HAND A TREASURY BACK. The issuance room comes back with the tokens. */
  const returnTreasury = async (b: Budget) => {
    const d = draft(b.id);
    const asked = d.amount.trim() ? minorOrRefuse(d.amount, b.unit) : undefined;
    if (asked === null) return;
    const res = await fetch(`/api/admin/resources/budgets/${b.id}/return`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({
        amountMinor: asked,
        note: d.note.trim() || "Handed back to the village",
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setProblem(String(json?.error ?? "That did not go through"));
      return;
    }
    setDraft(b.id, { amount: "" });
    setNote(String(json?.message ?? "Handed back."));
    await load();
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

  /** Minor units at the unit's real scale, into what a steward reads. */
  const money = (amountMinor: number, unit: string) => moneyAt(amountMinor, unit, data.tokens);
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
                      // The same scale both ways. An unreadable one leaves the
                      // box blank, so the save stays disabled.
                      const digits = digitsFor(r.unit, data.tokens);
                      setRule({
                        scope: r.scope,
                        scopeId: r.scopeId,
                        amount: digits === null ? "" : formatTokenAmount(r.amountMinor, digits),
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
              <div key={b.id} className="space-y-2 text-sm bg-muted/40 rounded-lg px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-foreground/90">
                    {b.mode === "treasury" ? (
                      <>
                        <span className="font-semibold">{circleName(b.circleId)}</span> holds a treasury of{" "}
                        {treasuries[b.id] ? money(treasuries[b.id]!.balanceMinor, b.unit) : "an amount this page could not read"}.
                        It keeps whatever it does not spend.
                      </>
                    ) : (
                      <>
                        <span className="font-semibold">{circleName(b.circleId)}</span> may issue up to {money(b.amountMinor, b.unit)}
                        {b.seasonId ? ` in season ${b.seasonId}` : " a season"}
                        {b.cycleAmountMinor === null
                          ? ", with no cap on any one cycle"
                          : `, and up to ${money(b.cycleAmountMinor, b.unit)} in any one cycle`}
                      </>
                    )}
                  </span>
                  <button type="button" className="text-xs text-red-600 font-medium shrink-0" onClick={() => act(`/api/admin/resources/budgets/${b.id}`, "DELETE")}>
                    Remove
                  </button>
                </div>

                {b.dormant && (
                  <p className="text-xs text-muted-foreground">
                    This circle went dormant on {b.dormant.at.slice(0, 10)} and its treasury of{" "}
                    {money(b.dormant.heldMinor, b.unit)} was{" "}
                    {b.dormant.destination === "retired" ? "retired, so those tokens are gone" : "returned to the village treasury"}.
                    Funding it again is a new mint, so it meets the village's issuance cap for the cycle it happens in.
                  </p>
                )}

                {b.pending ? (
                  <p className="text-xs text-muted-foreground">
                    Queued: this circle moves to a {b.pending.mode === "treasury" ? "treasury" : "spending cap"} on{" "}
                    {b.pending.from.slice(0, 10)}. It finishes this period on the model it started with.{" "}
                    <button type="button" className="underline font-medium" onClick={() => act(`/api/admin/resources/budgets/${b.id}/mode`, "DELETE")}>
                      Withdraw that
                    </button>
                  </p>
                ) : (
                  <button type="button" className="text-xs underline font-medium text-foreground/80" onClick={() => scheduleMode(b)}>
                    {b.mode === "treasury" ? "Move to a spending cap next period" : "Move to a treasury next period"}
                  </button>
                )}

                {b.mode === "treasury" && (
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <input
                      className={input}
                      type="number"
                      min="0"
                      step="any"
                      placeholder={`Amount in ${b.unit}`}
                      value={draft(b.id).amount}
                      onChange={(e) => setDraft(b.id, { amount: e.target.value })}
                    />
                    <input
                      className={input}
                      placeholder="Member id, to pay somebody"
                      value={draft(b.id).toUserId}
                      onChange={(e) => setDraft(b.id, { toUserId: e.target.value })}
                    />
                    <input
                      className={input}
                      placeholder="Why"
                      value={draft(b.id).note}
                      onChange={(e) => setDraft(b.id, { note: e.target.value })}
                    />
                    <button type="button" className={button} disabled={!draft(b.id).amount} onClick={() => fundTreasury(b)}>
                      Mint into it
                    </button>
                    <button
                      type="button"
                      className={button}
                      disabled={!draft(b.id).amount || !draft(b.id).toUserId.trim()}
                      onClick={() => spendTreasury(b)}
                    >
                      Pay from it
                    </button>
                    <button type="button" className={button} onClick={() => returnTreasury(b)}>
                      Hand it back
                    </button>
                  </div>
                )}
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
            Most it may issue in a season (major units)
            <input className={input} type="number" min="0" step="any" value={budget.amount} onChange={(e) => setBudget({ ...budget, amount: e.target.value })} />
          </label>
          <label className={label}>
            Most it may issue in one cycle (blank for no cycle cap, 0 for none at all)
            <input className={input} type="number" min="0" step="any" value={budget.cycleAmount} onChange={(e) => setBudget({ ...budget, cycleAmount: e.target.value })} />
          </label>
          <label className={label}>
            Unit
            <input className={input} value={budget.unit} onChange={(e) => setBudget({ ...budget, unit: e.target.value })} />
          </label>
          <label className={label}>
            How this circle runs
            <select className={input} value={budget.mode} onChange={(e) => setBudget({ ...budget, mode: e.target.value })}>
              <option value="cap">A spending cap: it may issue up to the amounts above and holds nothing</option>
              <option value="treasury">A treasury: mint it tokens up front and it keeps what it does not spend</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Choose per circle. Some circles can run on a cap while others hold a treasury, in the same season. Changing
          the model of a budget that already exists waits for the next period, so a circle finishes its season on the
          model it started with.
        </p>
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
