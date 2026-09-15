/**
 * "What can I spend?" (0084, lane L3): the four questions answered for the
 * person asking, and the one action, Request approval, which opens a forum
 * decision pre-filled from the rule THROUGH the existing primitive: this
 * panel asks /api/resources/requests for the pre-fill, then posts it once
 * to /api/forum/threads with the same busy guard the forum composer uses.
 *
 * Amounts arrive as sentences in each rule's own unit. The amount input
 * formats through L2's formatter, and when the viewer's display currency
 * has no rate on file the panel says so in words instead of pretending.
 */
import { useEffect, useMemo, useState } from "react";
import { useModule } from "@/modules/ModuleProvider";
import { SignInDoors } from "@/components/modules/ModuleGate";
import { authToken } from "@/lib/gameApi";
import { crossRate, exponentOf, formatMoney } from "@shared/money";
import { storedDisplayCurrency, type FxTable } from "./CurrencyPicker";
import type { PowerCircle } from "./types";
import type { ResourcesData, ResourcesRule } from "./ResourcesLens";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

interface MeAnswers {
  alone: string[];
  withApproval: string[];
  paidFrom: string[];
  comesFrom: string[];
}

interface MePayload {
  answers: MeAnswers;
  rules: Array<ResourcesRule & { appliesToYou: boolean }>;
  viewer: { userId: string | null; canRequest: boolean };
}

/**
 * What each circle has left, read LIVE and stamped with the instant it
 * answers for. Nothing here is stored: a ballot that needs the warning to
 * survive review writes its own record, and that record belongs to the ballot.
 */
interface BurnRow {
  kind: "module_off" | "ungoverned" | "metered";
  circleId?: string;
  sentence: string;
}

/**
 * The burn readings, keyed by circle.
 *
 * A 404 here is the module being off, which is one of the four states and the
 * only one the route cannot answer in words, because a 404 carries no body. A
 * 401 is a member who is not signed in, which the panel already handles above
 * with its own doors, so it produces no sentence at all.
 */
function useCircleBurn(on: boolean): Map<string, BurnRow> | null {
  const [rows, setRows] = useState<Map<string, BurnRow> | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    fetch("/api/resources/burn", { headers: headers() })
      .then(async (r) => {
        if (r.status === 404) return { readings: [{ kind: "module_off", sentence: MODULE_OFF_SENTENCE }] };
        return r.ok ? r.json() : null;
      })
      .then((d) => {
        if (!live || !d) return;
        const next = new Map<string, BurnRow>();
        for (const row of (d.readings ?? []) as BurnRow[]) {
          if (row.circleId) next.set(row.circleId, row);
        }
        setRows(next);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [on]);
  return rows;
}

/** Held here so the 404 branch says the same thing the server would say. */
const MODULE_OFF_SENTENCE =
  "This village is not keeping circle budgets. Nothing here says what a circle may issue, so an ask is measured against nothing.";

function isIso(unit: string): boolean {
  return /^[A-Z]{3}$/.test(unit);
}

function money(amountMinor: number, unit: string): string {
  if (isIso(unit)) return formatMoney(amountMinor, unit);
  return `${amountMinor} ${unit.replace(/^token:/, "")}`;
}

function ruleAmount(rule: ResourcesRule): string {
  return money(rule.amountMinor, rule.unit);
}

export default function ResourcesPanel({
  resources,
  circles,
}: {
  resources: ResourcesData | null;
  circles: PowerCircle[];
}) {
  const forumOn = !!useModule("forum");
  const burn = useCircleBurn(!!resources);
  const [me, setMe] = useState<MePayload | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [fx, setFx] = useState<FxTable | null>(null);

  const [askRuleId, setAskRuleId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [purpose, setPurpose] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [openedThread, setOpenedThread] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/resources/me", { headers: headers() })
      .then((r) => {
        if (r.status === 401) {
          setSignedOut(true);
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((d) => d && setMe(d))
      .catch(() => {});
    fetch("/api/fx/rates")
      .then((r) => (r.ok ? r.json() : null))
      .then(setFx)
      .catch(() => {});
  }, []);

  const askable = useMemo(
    () => (me?.rules ?? []).filter((r) => r.appliesToYou && r.approval !== "none"),
    [me],
  );
  const askRule = askable.find((r) => r.id === askRuleId) ?? askable[0] ?? null;

  const display = storedDisplayCurrency() || null;
  const amountMinor = useMemo(() => {
    if (!askRule) return 0;
    const major = Number(amount);
    if (!Number.isFinite(major) || major <= 0) return 0;
    const digits = isIso(askRule.unit) ? exponentOf(askRule.unit) : 0;
    return Math.round(major * Math.pow(10, digits));
  }, [amount, askRule]);

  const converted = useMemo(() => {
    if (!askRule || !amountMinor || !display || !isIso(askRule.unit) || display === askRule.unit) return null;
    const rate = crossRate(fx?.rates ?? {}, askRule.unit, display);
    if (rate === null) return { words: null as string | null, unconverted: true };
    return { words: formatMoney(amountMinor, askRule.unit, { currency: display, rate }), unconverted: false };
  }, [askRule, amountMinor, display, fx]);

  const submit = async () => {
    if (!askRule || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const asked = await fetch("/api/resources/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers() },
        body: JSON.stringify({ ruleId: askRule.id, amountMinor, purpose }),
      });
      const askedJson = await asked.json().catch(() => null);
      if (asked.status === 409 && askedJson?.threadId) {
        setOpenedThread(String(askedJson.threadId));
        setProblem("You already have this ask open. The link below goes to it.");
        return;
      }
      if (!asked.ok) {
        setProblem(String(askedJson?.error ?? "That did not go through"));
        return;
      }
      const posted = await fetch("/api/forum/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers() },
        body: JSON.stringify(askedJson.prefill),
      });
      const thread = await posted.json().catch(() => null);
      if (!posted.ok) {
        setProblem(String(thread?.error ?? "The forum did not take the proposal"));
        return;
      }
      setOpenedThread(String(thread.id));
      setAmount("");
      setPurpose("");
    } finally {
      setBusy(false);
    }
  };

  const circleName = (id: string) => circles.find((c) => c.id === id)?.name ?? id;

  if (signedOut) {
    return (
      <div className="bg-card border border-border rounded-2xl p-5" data-resources-panel>
        <h2 className="font-display text-lg font-bold text-foreground mb-1">What can I spend?</h2>
        <p className="text-sm text-muted-foreground mb-3">Sign in to see which rules name you.</p>
        {/* This one had no link at all, so the sentence was the whole offer.
            It stays a panel: it sits inside the map beside the lens controls,
            and SignInToSee carries a Layout that would nest a second site
            shell in the middle of the page. Only the doors are shared. */}
        <SignInDoors align="start" />
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4" data-resources-panel>
      <div>
        <h2 className="font-display text-lg font-bold text-foreground mb-1">What can I spend?</h2>
        <p className="text-xs text-muted-foreground">
          Declared rules, read for you. Nothing here moves money; it says who may, and with whose yes.
        </p>
      </div>

      {!me && <p className="text-sm text-muted-foreground">Reading the rules…</p>}

      {me && (
        <>
          <section aria-label="Alone">
            <h3 className="text-sm font-semibold text-foreground mb-1">Without asking</h3>
            {me.answers.alone.map((s) => (
              <p key={s} className="text-sm text-foreground/90">{s}</p>
            ))}
          </section>

          {me.answers.withApproval.length > 0 && (
            <section aria-label="With approval">
              <h3 className="text-sm font-semibold text-foreground mb-1">With a yes</h3>
              {me.answers.withApproval.map((s) => (
                <p key={s} className="text-sm text-foreground/90">{s}</p>
              ))}
            </section>
          )}

          {me.answers.paidFrom.length > 0 && (
            <section aria-label="The pots">
              <h3 className="text-sm font-semibold text-foreground mb-1">The pots</h3>
              {me.answers.paidFrom.map((s) => (
                <p key={s} className="text-sm text-foreground/90">{s}</p>
              ))}
            </section>
          )}

          <section aria-label="Where the money comes from">
            <h3 className="text-sm font-semibold text-foreground mb-1">Where the money comes from</h3>
            {me.answers.comesFrom.map((s) => (
              <p key={s} className="text-sm text-foreground/90">{s}</p>
            ))}
          </section>

          {forumOn && askable.length > 0 && (
            <section aria-label="Request approval" className="border-t border-border pt-3 space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Request approval</h3>
              {!me.viewer.canRequest && (
                <p className="text-xs text-muted-foreground">
                  Opening a decision requires the co-creator stage or a role that grants it.
                </p>
              )}
              {me.viewer.canRequest && (
                <>
                  <label className="block text-xs text-muted-foreground">
                    Under which rule
                    <select
                      className="mt-1 w-full border border-border rounded-lg px-2 py-1.5 text-sm bg-background text-foreground"
                      value={askRule?.id ?? ""}
                      onChange={(e) => setAskRuleId(e.target.value)}
                    >
                      {askable.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.scope === "circle" ? circleName(r.scopeId) : (resources?.seatNames?.[r.scopeId] ?? r.scopeId)}: up to {ruleAmount(r)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs text-muted-foreground">
                    How much{askRule ? ` (${isIso(askRule.unit) ? askRule.unit : askRule.unit.replace(/^token:/, "")})` : ""}
                    <input
                      type="number"
                      min="0"
                      step="any"
                      className="mt-1 w-full border border-border rounded-lg px-2 py-1.5 text-sm bg-background text-foreground"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </label>
                  {converted?.words && (
                    <p className="text-xs text-muted-foreground">About {converted.words} in your display currency.</p>
                  )}
                  {converted?.unconverted && askRule && (
                    <p className="text-xs text-muted-foreground" data-resources-unconverted>
                      This stays in {askRule.unit}: no exchange rate is on file for it yet.
                    </p>
                  )}
                  <label className="block text-xs text-muted-foreground">
                    What for
                    <textarea
                      className="mt-1 w-full border border-border rounded-lg px-2 py-1.5 text-sm bg-background text-foreground"
                      rows={2}
                      value={purpose}
                      onChange={(e) => setPurpose(e.target.value)}
                    />
                  </label>
                  {problem && <p role="alert" className="text-xs text-red-600">{problem}</p>}
                  <button
                    type="button"
                    disabled={busy || !amountMinor || !purpose.trim()}
                    onClick={submit}
                    className="w-full text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-semibold disabled:opacity-50"
                  >
                    {busy ? "Opening the decision…" : "Request approval"}
                  </button>
                </>
              )}
              {openedThread && (
                <p className="text-xs text-foreground">
                  The decision is open.{" "}
                  <a href={`/forum/${openedThread}`} className="text-teal-deep font-medium underline underline-offset-2">
                    Read the proposal
                  </a>
                </p>
              )}
            </section>
          )}

          {resources && resources.budgets.length + resources.rules.length > 0 && (
            <section aria-label="By circle" className="border-t border-border pt-3">
              <h3 className="text-sm font-semibold text-foreground mb-1">By circle, in words</h3>
              <div className="space-y-2" data-resources-circle-words>
                {circles
                  .filter(
                    (c) =>
                      resources.budgets.some((b) => b.circleId === c.id) ||
                      resources.rules.some((r) => r.scope === "circle" && r.scopeId === c.id),
                  )
                  .map((c) => {
                    const budget = resources.budgets.find((b) => b.circleId === c.id);
                    const rules = resources.rules.filter((r) => r.scope === "circle" && r.scopeId === c.id);
                    return (
                      <div key={c.id} className="text-xs text-foreground/90">
                        <span className="font-semibold">{c.name}.</span>{" "}
                        {budget ? `Holds ${money(budget.amountMinor, budget.unit)}${budget.seasonId ? ` for season ${budget.seasonId}` : " as a standing envelope"}. ` : ""}
                        {rules
                          .map((r) =>
                            r.approval === "none"
                              ? `Up to ${ruleAmount(r)} alone`
                              : `Up to ${ruleAmount(r)} with ${resources.vocab.approvals.find((a) => a.id === r.approval)?.label.toLowerCase() ?? r.approval}`,
                          )
                          .join(". ")}
                        {rules.length ? "." : ""}
                        {burn?.get(c.id) && (
                          <div className="mt-0.5 text-foreground/70" data-circle-burn={c.id}>
                            {burn.get(c.id)!.sentence}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
