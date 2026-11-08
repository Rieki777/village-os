/**
 * FUNDING ROUNDS, at /funding-rounds and /funding-rounds/:id.
 *
 * The village chooses together which quests the season funds, within a pot.
 * This page holds the seed stage today: members see the open round, share an
 * idea (named, or without a name by their own tick), and read the ideas
 * others have shared, each with its forum thread. The pot's holder (whoever
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
import { IDEA_LIMITS, ROUND_STAGES, type RoundStage } from "@shared/fundingRounds";

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
  byline: { kind: "named" | "anonymous"; text: string };
  mine: boolean;
  threadId: string | null;
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

function IdeaCard({ idea, pot }: { idea: Idea; pot: Pot }) {
  const author = idea.byline.text;
  const cost = idea.roughCostMinor != null ? amount(idea.roughCostMinor, pot) : null;
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
      <p className="mt-2 whitespace-pre-line text-sm text-foreground">{idea.what}</p>
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
    </li>
  );
}

function RoundPage({ id }: { id: string }) {
  const { t } = useLingui();
  const stageText = useStageText();
  const [data, setData] = useState<{ round: Round; pot: Pot; ideas: Idea[] } | null>(null);
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
                <IdeaCard key={i.id} idea={i} pot={pot} />
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
