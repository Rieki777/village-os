/**
 * FUNDING ROUNDS, at /funding-rounds and /funding-rounds/:id.
 *
 * The village chooses together which quests the season funds, within a pot.
 * Seed: members share an idea (named, or without a name by their own tick)
 * and read the others, each with its forum thread. Grow: the author shapes
 * their own into a quest. Choose: members tick every quest they would fund,
 * privately. Harvest: the deciding count, the other count beside it, and any
 * disagreement between them, with who chose what. The pot's holder (whoever
 * holds pot.steward, the Treasury role by default) opens a pot and a round
 * from the same page until the season board arrives.
 *
 * Behind the `funding-rounds` module and a session. An anonymous idea's
 * author never reaches this page: the server sends "a member" in its place.
 *
 * Every string goes through Lingui (`<Trans>`, `t`, `<Plural>`), so Spanish
 * and every other language can translate it; values sit in variables first so
 * each placeholder has a name.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useRoute } from "wouter";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import Layout from "@/components/Layout";
import BreathingLoader from "@/components/natural/BreathingLoader";
import ModuleGate, { SignInToSee } from "@/components/modules/ModuleGate";
import { BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY } from "@/components/journal/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useModules } from "@/modules/ModuleProvider";
import { gameFetch } from "@/lib/gameApi";
import { GROW_LIMITS, IDEA_LIMITS, ROUND_STAGES, type RoundStage } from "@shared/fundingRounds";

interface Pot {
  id: string;
  name: string;
  purpose: string | null;
  unitKind: "currency" | "token";
  unit: string;
  balanceMinor: number;
  freeMinor: number;
}

interface Round {
  id: string;
  potId: string;
  title: string;
  stage: RoundStage;
  acceptsIdeas: boolean;
  stageEndsAt: string | null;
  ideasPerMember: number;
  anonymousOffered: boolean;
  ideaCount: number;
}

interface Idea {
  id: string;
  title: string;
  what: string;
  whoHelps: string | null;
  roughCostMinor: number | null;
  whoMight: string | null;
  status: string;
  deliverable: string | null;
  askMinor: number | null;
  sharedImpact: boolean;
  byline: { kind: "named" | "anonymous"; text: string };
  mine: boolean;
  threadId: string | null;
  questId: string | null;
  /** First names of those who ticked it; sent only once choosing has closed. */
  markedBy?: string[];
  backing?: {
    pledgedMinor: number;
    backers: number;
    firmMinor: number;
    withdrawnMinor: number;
    mine: { id: string; amountMinor: number; status: string } | null;
    pledges: Array<{ id: string; name: string; amountMinor: number; status: string }>;
  };
}

interface CountView {
  funded: string[];
  steps: Array<{ order: number; option: string; cost: number; backers: number }>;
  spentMinor: number;
  leftoverMinor: number;
}

interface Outcome {
  decider: "power" | "people";
  quorumMet: boolean;
  quorumPct: number;
  markers: number;
  electorate: number;
  availableMinor: number;
  power: CountView;
  people: CountView;
  divergence: Array<{ ideaId: string; fundedBy: "power" | "people"; costMinor: number }>;
  /** Absent on a round counted before backing existed. */
  backerFunded?: string[];
}

interface Detail {
  round: Round;
  pot: Pot;
  ideas: Idea[];
  ballot: Idea[];
  myMarks: string[];
  outcome: Outcome | null;
}

/**
 * The stage words, as a hook. The Lingui macro only transforms a `t` taken
 * from `useLingui()` in the same scope; a `t` passed in as an argument is left
 * as a plain call and renders nothing (found on this page, 2026-11-08).
 */
function useStageText() {
  const { t } = useLingui();
  const word = (stage: RoundStage): string => {
    const words: Record<RoundStage, string> = {
      seed: t({ message: "Seed", context: "funding round stage" }),
      grow: t({ message: "Grow", context: "funding round stage" }),
      choose: t({ message: "Choose", context: "funding round stage" }),
      harvest: t({ message: "Harvest", context: "funding round stage" }),
      closed: t({ message: "Closed", context: "funding round stage" }),
    };
    return words[stage];
  };
  const line = (stage: RoundStage, endsAt: string | null): string => {
    const day = endsAt ? new Date(endsAt).toLocaleDateString(undefined, { day: "numeric", month: "long" }) : null;
    const lines: Record<RoundStage, string> = {
      seed: day ? t({ message: `Ideas welcome until ${day}`, context: "funding round stage" }) : t({ message: `Ideas welcome until the pot's holder sets the next stage`, context: "funding round stage" }),
      grow: day ? t({ message: `Ideas are being shaped into quests until ${day}`, context: "funding round stage" }) : t({ message: `Ideas are being shaped into quests`, context: "funding round stage" }),
      choose: day ? t({ message: `Choosing which quests to fund until ${day}`, context: "funding round stage" }) : t({ message: `Choosing which quests to fund`, context: "funding round stage" }),
      harvest: t({ message: `The village has chosen`, context: "funding round stage" }),
      closed: t({ message: `This round is closed`, context: "funding round stage" }),
    };
    return lines[stage];
  };
  return { word, line };
}

/** How many minor units one whole unit holds, for a currency; a token counts whole. */
function minorDigits(unitKind: Pot["unitKind"], unit: string): number {
  if (unitKind !== "currency") return 0;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: unit }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

function amount(minor: number, pot: Pick<Pot, "unitKind" | "unit">): string {
  const digits = minorDigits(pot.unitKind, pot.unit);
  if (pot.unitKind === "currency") {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: pot.unit, maximumFractionDigits: 0 }).format(minor / 10 ** digits);
    } catch {
      /* falls through to the plain form */
    }
  }
  return `${minor.toLocaleString()} ${pot.unit}`;
}

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/** A server refusal a member can act on is a sentence; a code is not shown. */
const sentenceOf = (body: any): string | null => (typeof body?.error === "string" && /\s/.test(body.error) ? body.error : null);

const FIELD = "mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground";
const LABEL = "block text-sm font-medium text-foreground";

function StageRail({ stage }: { stage: RoundStage }) {
  const { t } = useLingui();
  const text = useStageText();
  const shown = ROUND_STAGES.filter((s) => s !== "closed");
  const at = shown.indexOf(stage as (typeof shown)[number]);
  return (
    <ol aria-label={t({ message: "Round stages", context: "funding rounds" })} className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      {shown.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span
            aria-current={s === stage ? "step" : undefined}
            className={
              s === stage
                ? "rounded-full bg-primary px-3 py-1 font-semibold text-primary-foreground"
                : i < at
                  ? "rounded-full bg-muted px-3 py-1 text-foreground"
                  : "rounded-full border border-border px-3 py-1 text-muted-foreground"
            }
          >
            {text.word(s)}
          </span>
          {i < shown.length - 1 && <span aria-hidden className="text-muted-foreground">·</span>}
        </li>
      ))}
    </ol>
  );
}

function IdeaForm({ round, pot, onShared }: { round: Round; pot: Pot; onShared: () => void }) {
  const { t } = useLingui();
  const [title, setTitle] = useState("");
  const [what, setWhat] = useState("");
  const [whoHelps, setWhoHelps] = useState("");
  const [cost, setCost] = useState("");
  const [whoMight, setWhoMight] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const allowance = round.ideasPerMember;
  const unit = pot.unit;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const whole = cost.trim() === "" ? null : Number(cost.replace(/[\s,]/g, ""));
    if (whole != null && (!Number.isFinite(whole) || whole < 0)) {
      setProblem(t`The rough cost must be a number.`);
      return;
    }
    setBusy(true);
    try {
      const res = await gameFetch(`/api/funding-rounds/rounds/${round.id}/ideas`, {
        method: "POST",
        body: JSON.stringify({
          title,
          what,
          whoHelps,
          whoMight,
          roughCostMinor: whole == null ? null : Math.round(whole * 10 ** minorDigits(pot.unitKind, pot.unit)),
          shownAs: anonymous ? "anonymous" : "named",
          locale: typeof navigator !== "undefined" ? navigator.language : null,
        }),
      });
      const body = await readJson(res);
      if (!res.ok) {
        setProblem(sentenceOf(body) ?? t`Your idea was not shared. Try again.`);
        return;
      }
      setTitle("");
      setWhat("");
      setWhoHelps("");
      setCost("");
      setWhoMight("");
      setAnonymous(false);
      setDone(true);
      onShared();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border bg-card p-5" aria-labelledby="share-idea">
      <h2 id="share-idea" className="font-display text-xl font-semibold text-foreground">
        <Trans context="funding rounds">Share an idea</Trans>
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        <Trans>A rough idea is enough. Each member may share {allowance} in this round.</Trans>
      </p>
      <label className={`${LABEL} mt-4`}>
        <Trans context="funding rounds">A short name</Trans>
        <input className={FIELD} value={title} maxLength={IDEA_LIMITS.title} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <label className={`${LABEL} mt-3`}>
        <Trans>What would you do?</Trans>
        <textarea className={FIELD} rows={4} value={what} maxLength={IDEA_LIMITS.what} onChange={(e) => setWhat(e.target.value)} required />
      </label>
      <label className={`${LABEL} mt-3`}>
        <Trans context="funding rounds">Who would it help?</Trans>
        <textarea className={FIELD} rows={2} value={whoHelps} maxLength={IDEA_LIMITS.whoHelps} onChange={(e) => setWhoHelps(e.target.value)} />
      </label>
      <label className={`${LABEL} mt-3`}>
        <Trans>Roughly what would it cost, in {unit}?</Trans>
        <input className={FIELD} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
      </label>
      <label className={`${LABEL} mt-3`}>
        <Trans context="funding rounds">Who might do it?</Trans>
        <input className={FIELD} value={whoMight} maxLength={IDEA_LIMITS.whoMight} onChange={(e) => setWhoMight(e.target.value)} />
      </label>
      {round.anonymousOffered && (
        <div className="mt-4 rounded-xl bg-muted/60 p-3">
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input type="checkbox" className="mt-1" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
            <span>
              <Trans>
                Share it without my name. It shows as "a member" everywhere, and its forum thread is posted for you. In a small
                village people may still guess who wrote it.
              </Trans>
            </span>
          </label>
        </div>
      )}
      {problem && (
        <p role="alert" className="mt-3 text-sm font-medium text-destructive">
          {problem}
        </p>
      )}
      {done && !problem && (
        <p role="status" className="mt-3 text-sm text-foreground">
          <Trans>Your idea is shared. Others can comment on it in its thread.</Trans>
        </p>
      )}
      <button type="submit" className={`${BTN_PRIMARY} mt-4`} disabled={busy}>
        {busy ? <Trans context="funding rounds">Sharing</Trans> : <Trans context="funding rounds">Share this idea</Trans>}
      </button>
    </form>
  );
}

/** Whole units typed by a person, as minor units; null when empty, NaN when unreadable. */
function toMinor(typed: string, pot: Pot): number | null {
  if (typed.trim() === "") return null;
  const whole = Number(typed.replace(/[\s,]/g, ""));
  return Number.isFinite(whole) && whole >= 0 ? Math.round(whole * 10 ** minorDigits(pot.unitKind, pot.unit)) : Number.NaN;
}

/** The author shapes their idea into a quest: what it delivers, what it asks. Seed and grow only. */
function GrowForm({ idea, pot, onChanged }: { idea: Idea; pot: Pot; onChanged: () => void }) {
  const { t } = useLingui();
  const digits = minorDigits(pot.unitKind, pot.unit);
  const [deliverable, setDeliverable] = useState(idea.deliverable ?? "");
  const [ask, setAsk] = useState(idea.askMinor != null ? String(idea.askMinor / 10 ** digits) : "");
  const [shared, setShared] = useState(idea.sharedImpact);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const unit = pot.unit;

  const send = async (path: string, init: RequestInit, ok: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await gameFetch(path, init);
      const body = await readJson(res);
      setMessage(res.ok ? ok : (sentenceOf(body) ?? t`That did not save. Try again.`));
      if (res.ok) onChanged();
    } finally {
      setBusy(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const askMinor = toMinor(ask, pot);
    if (Number.isNaN(askMinor)) {
      setMessage(t`The amount must be a number.`);
      return;
    }
    await send(`/api/funding-rounds/ideas/${idea.id}`, { method: "PATCH", body: JSON.stringify({ deliverable, askMinor, sharedImpact: shared }) }, t({ message: "Saved.", context: "funding rounds" }));
  };

  return (
    <form onSubmit={save} className="mt-4 grid gap-3 rounded-xl bg-muted/60 p-3" aria-label={t({ message: "Shape your idea into a quest", context: "funding rounds" })}>
      <p className="text-sm text-foreground">
        <Trans>Shape it into a quest. Once it says what it delivers and what it asks, it goes on the ballot.</Trans>
      </p>
      <label className={LABEL}>
        <Trans>What will be done when it is finished?</Trans>
        <textarea className={FIELD} rows={3} value={deliverable} maxLength={GROW_LIMITS.deliverable} onChange={(e) => setDeliverable(e.target.value)} />
      </label>
      <label className={LABEL}>
        <Trans>What does it ask from the pot, in {unit}?</Trans>
        <input className={FIELD} inputMode="decimal" value={ask} onChange={(e) => setAsk(e.target.value)} />
      </label>
      <label className="flex items-start gap-2 text-sm text-foreground">
        <input type="checkbox" className="mt-1" checked={shared} onChange={(e) => setShared(e.target.checked)} />
        <span>
          <Trans>It changes something everyone shares, such as a path, the water or a common building.</Trans>
        </span>
      </label>
      {message && (
        <p role="status" className="text-sm text-foreground">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={BTN_SECONDARY} disabled={busy}>
          <Trans context="funding rounds">Save</Trans>
        </button>
        <button
          type="button"
          className={BTN_QUIET}
          disabled={busy}
          onClick={() => send(`/api/funding-rounds/ideas/${idea.id}/withdraw`, { method: "POST" }, t`Your idea is withdrawn.`)}
        >
          <Trans context="funding rounds">Withdraw it</Trans>
        </button>
      </div>
    </form>
  );
}

/** While choosing: tick every quest you would fund. Your ticks stay private until choosing closes. */
function Ballot({ detail, onChanged }: { detail: Detail; onChanged: () => void }) {
  const { t } = useLingui();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(detail.myMarks));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { ballot, pot } = detail;
  const toggle = (id: string) =>
    setPicked((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await gameFetch(`/api/funding-rounds/rounds/${detail.round.id}/marks`, { method: "PUT", body: JSON.stringify({ ideaIds: Array.from(picked) }) });
      const body = await readJson(res);
      setMessage(res.ok ? t`Your choices are saved. You can change them until choosing closes.` : (sentenceOf(body) ?? t`That did not save. Try again.`));
      if (res.ok) onChanged();
    } finally {
      setBusy(false);
    }
  };
  if (ballot.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        <Trans>No quest reached the ballot in this round.</Trans>
      </p>
    );
  }
  return (
    <form onSubmit={save} className="rounded-2xl border border-border bg-card p-5" aria-labelledby="ballot-heading">
      <h2 id="ballot-heading" className="font-display text-xl font-semibold text-foreground">
        <Trans context="funding rounds">Choose what to fund</Trans>
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        <Trans>Tick every quest you would fund. Nobody sees your ticks until choosing closes; then they are shown with your name.</Trans>
      </p>
      <ul className="mt-4 grid gap-2">
        {ballot.map((i) => {
          const ask = i.askMinor != null ? amount(i.askMinor, pot) : "";
          return (
            <li key={i.id}>
              <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm text-foreground">
                <input type="checkbox" className="mt-1" checked={picked.has(i.id)} onChange={() => toggle(i.id)} />
                <span>
                  <span className="font-semibold">{i.title}</span> <span className="text-muted-foreground">{ask}</span>
                  {i.deliverable && <span className="mt-1 block text-muted-foreground">{i.deliverable}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {message && (
        <p role="status" className="mt-3 text-sm text-foreground">
          {message}
        </p>
      )}
      <button type="submit" className={`${BTN_PRIMARY} mt-4`} disabled={busy}>
        <Trans context="funding rounds">Save my choices</Trans>
      </button>
    </form>
  );
}

/** What the village chose: the deciding count, the other count beside it, and any disagreement, kept in the record. */
function Results({ detail }: { detail: Detail }) {
  const { outcome, pot, ideas } = detail;
  if (!outcome) {
    return (
      <p className="text-sm text-muted-foreground">
        <Trans>The count is being made. Open this page again in a moment.</Trans>
      </p>
    );
  }
  const titleOf = (id: string) => ideas.find((i) => i.id === id)?.title ?? id;
  const markers = outcome.markers;
  const electorate = outcome.electorate;
  const quorum = outcome.quorumPct;
  if (!outcome.quorumMet) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="font-display text-xl font-semibold text-foreground">
          <Trans context="funding rounds">Too few chose</Trans>
        </h2>
        <p className="mt-1 text-sm text-foreground">
          <Trans>
            {markers} of {electorate} members chose, and this round needed {quorum}% of the village. Nothing was funded, and the pot keeps its money for the next round.
          </Trans>
        </p>
      </section>
    );
  }
  const deciding = outcome[outcome.decider];
  const other = outcome.decider === "power" ? outcome.people : outcome.power;
  const spent = amount(deciding.spentMinor, pot);
  const left = amount(deciding.leftoverMinor, pot);
  const differ = outcome.divergence.length;
  return (
    <section className="rounded-2xl border border-border bg-card p-5" aria-labelledby="results-heading">
      <h2 id="results-heading" className="font-display text-xl font-semibold text-foreground">
        <Trans context="funding rounds">What the village chose</Trans>
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {outcome.decider === "power" ? (
          <Trans>Counted by Voice, with each person's share capped. One member, one vote is shown beside it.</Trans>
        ) : (
          <Trans>Counted by one member, one vote. The count by Voice is shown beside it.</Trans>
        )}
      </p>
      {deciding.steps.length === 0 ? (
        <p className="mt-3 text-sm text-foreground">
          <Trans>No quest gathered enough support to be funded.</Trans>
        </p>
      ) : (
        <ol className="mt-3 grid gap-2">
          {deciding.steps.map((s) => {
            const title = titleOf(s.option);
            const cost = amount(s.cost, pot);
            const n = s.backers;
            return (
              <li key={s.option} className="rounded-xl bg-muted/60 p-3 text-sm text-foreground">
                <span className="font-semibold">
                  {s.order}. {title}
                </span>{" "}
                {cost}. <Plural value={n} one="# person chose it." other="# people chose it." />
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-3 text-sm text-foreground">
        <Trans>
          {spent} goes to these quests, held for them until each one is done. {left} stays in the pot.
        </Trans>
      </p>
      {differ > 0 && (
        <div role="note" className="mt-4 rounded-xl border border-amber-500/60 bg-amber-50 p-3 text-sm text-foreground">
          <p className="font-semibold">
            <Plural value={differ} one="Voice and one member, one vote disagree on # quest." other="Voice and one member, one vote disagree on # quests." />
          </p>
          <ul className="mt-2 grid gap-1">
            {outcome.divergence.map((d) => {
              const title = titleOf(d.ideaId);
              const cost = amount(d.costMinor, pot);
              return (
                <li key={`${d.fundedBy}:${d.ideaId}`}>
                  {d.fundedBy === "power" ? <Trans>Only Voice funds {title} ({cost}).</Trans> : <Trans>Only one member, one vote funds {title} ({cost}).</Trans>}
                </li>
              );
            })}
          </ul>
          <p className="mt-2">
            <Trans>This disagreement stays in the round's record for everyone to see.</Trans>
          </p>
        </div>
      )}
      {other.funded.length > 0 && differ === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          <Trans context="funding rounds">Both counts agree.</Trans>
        </p>
      )}
      {(outcome.backerFunded ?? []).length > 0 && (
        <ul className="mt-3 grid gap-1 text-sm text-foreground">
          {(outcome.backerFunded ?? []).map((id) => {
            const title = titleOf(id);
            return (
              <li key={id}>
                <Trans>{title} is fully backed by pledges, so it goes ahead without the pot.</Trans>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Backing, shown openly (R19): who pledged what, and a way to back it. A
 * pledge stands until choosing closes, then it is firm and lowers what the pot
 * pays. Nothing is collected yet, and the page says so.
 */
function BackingPanel({ idea, pot, stage, onChanged }: { idea: Idea; pot: Pot; stage: RoundStage; onChanged: () => void }) {
  const { t } = useLingui();
  const [amountText, setAmountText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const b = idea.backing;
  const open = stage === "seed" || stage === "grow" || stage === "choose" || (stage === "harvest" && idea.status === "funded");
  if (!b || (!open && b.pledges.length === 0)) return null;
  const pledged = amount(b.pledgedMinor, pot);
  const n = b.backers;
  const mine = b.mine;
  const canWithdraw = mine?.status === "pledged" && (stage === "seed" || stage === "grow" || stage === "choose");
  const unit = pot.unit;

  const send = async (path: string, init: RequestInit, ok: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await gameFetch(path, init);
      const body = await readJson(res);
      setMessage(res.ok ? ok : (sentenceOf(body) ?? t`That did not save. Try again.`));
      if (res.ok) {
        setAmountText("");
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  };
  const pledge = async (e: FormEvent) => {
    e.preventDefault();
    const minor = toMinor(amountText, pot);
    if (minor == null || Number.isNaN(minor) || minor <= 0) {
      setMessage(t`The amount must be a number above zero.`);
      return;
    }
    await send(`/api/funding-rounds/ideas/${idea.id}/pledges`, { method: "POST", body: JSON.stringify({ amountMinor: minor }) }, t`Thank you. Your pledge is shown on this quest.`);
  };

  return (
    <div className="mt-3 rounded-xl border border-border p-3 text-sm">
      {b.pledgedMinor > 0 ? (
        <p className="font-medium text-foreground">
          <Plural value={n} one={`${pledged} pledged by # backer`} other={`${pledged} pledged by # backers`} />
        </p>
      ) : (
        <p className="text-muted-foreground">
          <Trans>Nobody has backed this yet.</Trans>
        </p>
      )}
      {b.pledges.length > 0 && (
        <ul className="mt-1 grid gap-0.5 text-muted-foreground">
          {b.pledges.map((p) => {
            const who = p.name;
            const much = amount(p.amountMinor, pot);
            return (
              <li key={p.id}>
                {p.status === "withdrawn" ? (
                  <Trans>{who} pledged {much}, then withdrew it</Trans>
                ) : p.status === "released_to_backer" ? (
                  <Trans>{who} pledged {much}, returned when the quest was not funded</Trans>
                ) : p.status === "pledged" ? (
                  <Trans context="funding rounds">{who} pledged {much}</Trans>
                ) : (
                  <Trans context="funding rounds">{who} pledged {much}, firm</Trans>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {mine && (
        <p className="mt-2 text-foreground">
          <Trans>You are backing this quest (pending). The Backer badge comes when the quest is done.</Trans>
        </p>
      )}
      {open && (
        <form onSubmit={pledge} className="mt-2 flex flex-wrap items-end gap-2">
          <label className={`${LABEL} min-w-[10rem] flex-1`}>
            <Trans>Back this quest, in {unit}</Trans>
            <input className={FIELD} inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
          </label>
          <button type="submit" className={BTN_SECONDARY} disabled={busy}>
            <Trans context="funding rounds">Pledge</Trans>
          </button>
          {canWithdraw && (
            <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => send(`/api/funding-rounds/pledges/${mine!.id}`, { method: "DELETE" }, t`Your pledge is withdrawn.`)}>
              <Trans context="funding rounds">Withdraw my pledge</Trans>
            </button>
          )}
        </form>
      )}
      {open && (
        <p className="mt-2 text-xs text-muted-foreground">
          {stage === "harvest" ? (
            <Trans>A pledge now is firm at once and lowers what the pot pays for this quest. Nothing is collected yet.</Trans>
          ) : (
            <Trans>You can withdraw a pledge until choosing closes. Then it is firm and lowers what the pot pays. Nothing is collected yet.</Trans>
          )}
        </p>
      )}
      {message && (
        <p role="status" className="mt-2 text-foreground">
          {message}
        </p>
      )}
    </div>
  );
}

function IdeaCard({ idea, pot, stage, onChanged }: { idea: Idea; pot: Pot; stage: RoundStage; onChanged: () => void }) {
  const author = idea.byline.text;
  const cost = idea.roughCostMinor != null ? amount(idea.roughCostMinor, pot) : null;
  const ask = idea.askMinor != null ? amount(idea.askMinor, pot) : null;
  const names = (idea.markedBy ?? []).join(", ");
  const shaping = idea.mine && (stage === "seed" || stage === "grow") && idea.status !== "withdrawn";
  return (
    <li className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-semibold text-foreground">{idea.title}</h3>
        <span className="text-sm text-muted-foreground">
          {idea.mine ? (
            idea.byline.kind === "anonymous" ? (
              <Trans>Yours, shared without your name</Trans>
            ) : (
              <Trans context="funding rounds">Yours</Trans>
            )
          ) : (
            <Trans context="funding rounds">From {author}</Trans>
          )}
        </span>
      </div>
      {idea.status === "funded" && (
        <p className="mt-1 text-sm font-semibold text-foreground">
          <Trans context="funding rounds">Funded</Trans>
        </p>
      )}
      {idea.status === "not_funded" && (
        <p className="mt-1 text-sm text-muted-foreground">
          <Trans context="funding rounds">Not funded this round</Trans>
        </p>
      )}
      {idea.status === "withdrawn" && (
        <p className="mt-1 text-sm text-muted-foreground">
          <Trans context="funding rounds">Withdrawn</Trans>
        </p>
      )}
      <p className="mt-2 whitespace-pre-line text-sm text-foreground">{idea.what}</p>
      {(idea.deliverable || ask) && (
        <dl className="mt-3 grid gap-1 text-sm">
          {idea.deliverable && (
            <div>
              <dt className="inline font-medium text-foreground">
                <Trans context="funding rounds">When it is done:</Trans>{" "}
              </dt>
              <dd className="inline text-foreground">{idea.deliverable}</dd>
            </div>
          )}
          {ask && (
            <div>
              <dt className="inline font-medium text-foreground">
                <Trans context="funding rounds">It asks:</Trans>{" "}
              </dt>
              <dd className="inline text-foreground">{ask}</dd>
            </div>
          )}
        </dl>
      )}
      {(idea.whoHelps || cost || idea.whoMight) && (
        <dl className="mt-3 grid gap-1 text-sm">
          {idea.whoHelps && (
            <div>
              <dt className="inline font-medium text-foreground">
                <Trans context="funding rounds">Who it helps:</Trans>{" "}
              </dt>
              <dd className="inline text-foreground">{idea.whoHelps}</dd>
            </div>
          )}
          {cost && (
            <div>
              <dt className="inline font-medium text-foreground">
                <Trans context="funding rounds">Rough cost:</Trans>{" "}
              </dt>
              <dd className="inline text-foreground">{cost}</dd>
            </div>
          )}
          {idea.whoMight && (
            <div>
              <dt className="inline font-medium text-foreground">
                <Trans context="funding rounds">Who might do it:</Trans>{" "}
              </dt>
              <dd className="inline text-foreground">{idea.whoMight}</dd>
            </div>
          )}
        </dl>
      )}
      {idea.threadId && (
        <Link href={`/forum/${idea.threadId}`} className="mt-3 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">
          <Trans context="funding rounds">Talk about it</Trans>
        </Link>
      )}
      {idea.markedBy && idea.markedBy.length > 0 && (
        <p className="mt-2 text-sm text-muted-foreground">
          <Trans context="funding rounds">Chosen by {names}.</Trans>
        </p>
      )}
      {idea.questId && (
        <Link href="/quests" className="mt-2 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">
          <Trans context="funding rounds">Find it on the quest board</Trans>
        </Link>
      )}
      {idea.status !== "withdrawn" && <BackingPanel idea={idea} pot={pot} stage={stage} onChanged={onChanged} />}
      {shaping && <GrowForm idea={idea} pot={pot} onChanged={onChanged} />}
    </li>
  );
}

function RoundPage({ id }: { id: string }) {
  const { t } = useLingui();
  const stageText = useStageText();
  const [data, setData] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    const res = await gameFetch(`/api/funding-rounds/rounds/${encodeURIComponent(id)}`);
    if (!res.ok) {
      setMissing(true);
      return;
    }
    setData(await readJson(res));
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (missing) {
    return (
      <div className="container max-w-3xl py-10">
        <p className="text-foreground">
          <Trans>This round could not be found.</Trans>
        </p>
        <Link href="/funding-rounds" className="mt-2 inline-block text-primary underline-offset-4 hover:underline">
          <Trans context="funding rounds">Back to funding rounds</Trans>
        </Link>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <BreathingLoader label={t({ message: "Opening the round", context: "funding rounds" })} />
      </div>
    );
  }
  const { round, pot, ideas } = data;
  const potName = pot.name;
  const line = stageText.line(round.stage, round.stageEndsAt);
  const count = ideas.length;
  return (
    <>
      <section className="bg-gradient-to-b from-teal-deep/5 to-background py-8 md:py-12">
        <div className="container max-w-3xl">
          <Link href="/funding-rounds" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            <Trans context="funding rounds">Funding rounds</Trans>
          </Link>
          <h1 className="mt-1 font-display text-4xl font-bold text-foreground">{round.title}</h1>
          <p className="mt-2 text-muted-foreground">
            <Trans context="funding rounds">
              {potName}. {line}.
            </Trans>
          </p>
          <StageRail stage={round.stage} />
        </div>
      </section>
      <div className="container grid max-w-3xl gap-6 pb-16">
        {round.acceptsIdeas && <IdeaForm round={round} pot={pot} onShared={load} />}
        {round.stage === "choose" && <Ballot detail={data} onChanged={load} />}
        {(round.stage === "harvest" || round.stage === "closed") && <Results detail={data} />}
        <section aria-labelledby="ideas-heading">
          <h2 id="ideas-heading" className="font-display text-xl font-semibold text-foreground">
            <Plural value={count} one="# idea so far" other="# ideas so far" />
          </h2>
          {count === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              <Trans>No ideas yet. The first one can be yours.</Trans>
            </p>
          ) : (
            <ul className="mt-3 grid gap-3">
              {ideas.map((i) => (
                <IdeaCard key={i.id} idea={i} pot={pot} stage={round.stage} onChanged={load} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function StewardPanel({ pots, onChanged }: { pots: Pot[]; onChanged: () => void }) {
  const { t } = useLingui();
  const [potName, setPotName] = useState("");
  const [unit, setUnit] = useState("");
  const [purpose, setPurpose] = useState("");
  const [potId, setPotId] = useState("");
  const [roundTitle, setRoundTitle] = useState("");
  const [growAt, setGrowAt] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (path: string, body: unknown, ok: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await gameFetch(path, { method: "POST", body: JSON.stringify(body) });
      const out = await readJson(res);
      setMessage(res.ok ? ok : (sentenceOf(out) ?? t`That did not save. Try again.`));
      if (res.ok) onChanged();
      return res.ok;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="steward-heading" className="rounded-2xl border border-dashed border-border p-5">
      <h2 id="steward-heading" className="font-display text-xl font-semibold text-foreground">
        <Trans>For the pot's holder</Trans>
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        <Trans>You hold the village's funding pots, so you can open a pot and a round.</Trans>
      </p>
      <form
        className="mt-4 grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await send("/api/funding-rounds/pots", { name: potName, unitCode: unit.trim().toUpperCase(), unitKind: "currency", purpose }, t`The pot is open.`)) {
            setPotName("");
            setUnit("");
            setPurpose("");
          }
        }}
      >
        <h3 className="text-base font-semibold text-foreground">
          <Trans context="funding rounds">Open a pot</Trans>
        </h3>
        <label className={LABEL}>
          <Trans context="funding rounds">Name</Trans>
          <input className={FIELD} value={potName} onChange={(e) => setPotName(e.target.value)} required />
        </label>
        <label className={LABEL}>
          <Trans>Currency code, such as CRC</Trans>
          <input className={FIELD} value={unit} maxLength={3} onChange={(e) => setUnit(e.target.value)} required />
        </label>
        <label className={LABEL}>
          <Trans context="funding rounds">What it is for</Trans>
          <textarea className={FIELD} rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </label>
        <button type="submit" className={BTN_SECONDARY} disabled={busy}>
          <Trans context="funding rounds">Open the pot</Trans>
        </button>
      </form>
      {pots.length > 0 && (
        <form
          className="mt-6 grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const chosen = potId || pots[0].id;
            const body = { title: roundTitle, growAt: growAt ? new Date(growAt).toISOString() : null };
            if (await send(`/api/funding-rounds/pots/${chosen}/rounds`, body, t`The round is open for ideas.`)) {
              setRoundTitle("");
              setGrowAt("");
            }
          }}
        >
          <h3 className="text-base font-semibold text-foreground">
            <Trans context="funding rounds">Open a round for ideas</Trans>
          </h3>
          <label className={LABEL}>
            <Trans context="funding rounds">Pot</Trans>
            <select className={FIELD} value={potId || pots[0].id} onChange={(e) => setPotId(e.target.value)}>
              {pots.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            <Trans>Round name, such as the season it funds</Trans>
            <input className={FIELD} value={roundTitle} onChange={(e) => setRoundTitle(e.target.value)} required />
          </label>
          <label className={LABEL}>
            <Trans>When shaping starts (leave empty to keep the round in Seed)</Trans>
            <input type="date" className={FIELD} value={growAt} onChange={(e) => setGrowAt(e.target.value)} />
          </label>
          <button type="submit" className={BTN_SECONDARY} disabled={busy}>
            <Trans context="funding rounds">Open the round</Trans>
          </button>
        </form>
      )}
      {message && (
        <p role="status" className="mt-3 text-sm text-foreground">
          {message}
        </p>
      )}
    </section>
  );
}

function RoundCard({ round, potName }: { round: Round; potName: string }) {
  const stageText = useStageText();
  const line = stageText.line(round.stage, round.stageEndsAt);
  const count = round.ideaCount;
  return (
    <li className="rounded-2xl border border-border bg-card p-5">
      <Link href={`/funding-rounds/${round.id}`} className="font-display text-xl font-semibold text-foreground underline-offset-4 hover:underline">
        {round.title}
      </Link>
      <p className="mt-1 text-sm text-muted-foreground">
        <Trans context="funding rounds">
          {potName}. {line}.
        </Trans>{" "}
        <Plural value={count} one="# idea so far." other="# ideas so far." />
      </p>
      <Link href={`/funding-rounds/${round.id}`} className={`${BTN_QUIET} mt-3 inline-flex`}>
        {round.acceptsIdeas ? <Trans context="funding rounds">Share or read ideas</Trans> : <Trans context="funding rounds">Open the round</Trans>}
      </Link>
    </li>
  );
}

function Overview() {
  const { t } = useLingui();
  const [data, setData] = useState<{ pots: Pot[]; rounds: Round[]; canSteward: boolean } | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const res = await gameFetch("/api/funding-rounds");
    if (!res.ok) {
      setFailed(true);
      return;
    }
    setData(await readJson(res));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (data?.rounds ?? []).filter((r) => r.stage !== "closed");
  const aPot = t({ message: "A pot", context: "funding rounds" });
  const potName = (id: string) => data?.pots.find((p) => p.id === id)?.name ?? aPot;
  return (
    <>
      <section className="bg-gradient-to-b from-teal-deep/5 to-background py-8 md:py-12">
        <div className="container max-w-3xl">
          <h1 className="font-display text-4xl font-bold text-foreground">
            <Trans context="funding rounds">Funding rounds</Trans>
          </h1>
          <p className="mt-2 text-muted-foreground">
            <Trans>Choose together which quests the season funds, within a pot.</Trans>
          </p>
        </div>
      </section>
      <div className="container grid max-w-3xl gap-6 pb-16">
        {failed && (
          <p className="text-foreground">
            <Trans>The rounds could not be read just now. Try again in a moment.</Trans>
          </p>
        )}
        {!data && !failed && (
          <div className="flex min-h-[30vh] items-center justify-center">
            <BreathingLoader label={t({ message: "Reading the rounds", context: "funding rounds" })} />
          </div>
        )}
        {data && open.length === 0 && (
          <p className="text-foreground">
            <Trans>No round is open yet. When the pot's holder opens one, ideas are welcome here.</Trans>
          </p>
        )}
        {open.length > 0 && (
          <ul className="grid gap-3">
            {open.map((r) => (
              <RoundCard key={r.id} round={r} potName={potName(r.potId)} />
            ))}
          </ul>
        )}
        {data?.canSteward && <StewardPanel pots={data.pots} onChanged={load} />}
      </div>
    </>
  );
}

export default function FundingRounds() {
  const { t } = useLingui();
  const { user } = useAuth();
  const modules = useModules();
  const [isRound, params] = useRoute("/funding-rounds/:id");
  const on = (modules.modules ?? []).some((m) => m.id === "funding-rounds" && m.lifecycle !== "off");
  const name = t({ message: "Funding rounds", context: "funding rounds" });

  if (!modules.loaded) {
    return (
      <Layout>
        <div className="flex min-h-[50vh] items-center justify-center">
          <BreathingLoader label={t({ message: "Opening funding rounds", context: "funding rounds" })} />
        </div>
      </Layout>
    );
  }
  if (!on) return <ModuleGate moduleId="funding-rounds" name={name} />;
  if (!user) return <SignInToSee moduleId="funding-rounds" name={name} />;
  return <Layout>{isRound && params?.id ? <RoundPage id={params.id} /> : <Overview />}</Layout>;
}
