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
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useRoute } from "wouter";
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

const STAGE_WORD: Record<RoundStage, string> = {
  seed: "Seed",
  grow: "Grow",
  choose: "Choose",
  harvest: "Harvest",
  closed: "Closed",
};

const STAGE_LINE: Record<RoundStage, string> = {
  seed: "Ideas welcome",
  grow: "Ideas are being shaped into quests",
  choose: "Choosing which quests to fund",
  harvest: "The village has chosen",
  closed: "This round is closed",
};

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

function when(iso: string | null): string {
  if (!iso) return "until the pot's holder sets the next stage";
  return `until ${new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long" })}`;
}

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

const FIELD = "mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground";
const LABEL = "block text-sm font-medium text-foreground";

function StageRail({ stage }: { stage: RoundStage }) {
  const shown = ROUND_STAGES.filter((s) => s !== "closed");
  const at = shown.indexOf(stage as (typeof shown)[number]);
  return (
    <ol aria-label="Round stages" className="mt-3 flex flex-wrap items-center gap-2 text-sm">
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
            {STAGE_WORD[s]}
          </span>
          {i < shown.length - 1 && <span aria-hidden className="text-muted-foreground">·</span>}
        </li>
      ))}
    </ol>
  );
}

function IdeaForm({ round, pot, onShared }: { round: Round; pot: Pot; onShared: () => void }) {
  const [title, setTitle] = useState("");
  const [what, setWhat] = useState("");
  const [whoHelps, setWhoHelps] = useState("");
  const [cost, setCost] = useState("");
  const [whoMight, setWhoMight] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const whole = cost.trim() === "" ? null : Number(cost.replace(/[\s,]/g, ""));
    if (whole != null && (!Number.isFinite(whole) || whole < 0)) {
      setProblem("The rough cost must be a number.");
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
        setProblem(typeof body.error === "string" && /\s/.test(body.error) ? body.error : "Your idea was not shared. Try again.");
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
        Share an idea
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        A rough idea is enough. Each member may share {round.ideasPerMember} in this round.
      </p>
      <label className={`${LABEL} mt-4`}>
        A short name
        <input className={FIELD} value={title} maxLength={IDEA_LIMITS.title} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <label className={`${LABEL} mt-3`}>
        What would you do?
        <textarea className={FIELD} rows={4} value={what} maxLength={IDEA_LIMITS.what} onChange={(e) => setWhat(e.target.value)} required />
      </label>
      <label className={`${LABEL} mt-3`}>
        Who would it help?
        <textarea className={FIELD} rows={2} value={whoHelps} maxLength={IDEA_LIMITS.whoHelps} onChange={(e) => setWhoHelps(e.target.value)} />
      </label>
      <label className={`${LABEL} mt-3`}>
        Roughly what would it cost, in {pot.unit}?
        <input className={FIELD} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
      </label>
      <label className={`${LABEL} mt-3`}>
        Who might do it?
        <input className={FIELD} value={whoMight} maxLength={IDEA_LIMITS.whoMight} onChange={(e) => setWhoMight(e.target.value)} />
      </label>
      {round.anonymousOffered && (
        <div className="mt-4 rounded-xl bg-muted/60 p-3">
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input type="checkbox" className="mt-1" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
            <span>
              Share it without my name. It shows as "a member" everywhere, and its forum thread is posted for you. In a small
              village people may still guess who wrote it.
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
          Your idea is shared. Others can comment on it in its thread.
        </p>
      )}
      <button type="submit" className={`${BTN_PRIMARY} mt-4`} disabled={busy}>
        {busy ? "Sharing" : "Share this idea"}
      </button>
    </form>
  );
}

function IdeaCard({ idea, pot }: { idea: Idea; pot: Pot }) {
  return (
    <li className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-semibold text-foreground">{idea.title}</h3>
        <span className="text-sm text-muted-foreground">
          {idea.mine ? (idea.byline.kind === "anonymous" ? "Yours, shared without your name" : "Yours") : `From ${idea.byline.text}`}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-line text-sm text-foreground">{idea.what}</p>
      {(idea.whoHelps || idea.roughCostMinor != null || idea.whoMight) && (
        <dl className="mt-3 grid gap-1 text-sm">
          {idea.whoHelps && (
            <div>
              <dt className="inline font-medium text-foreground">Who it helps: </dt>
              <dd className="inline text-foreground">{idea.whoHelps}</dd>
            </div>
          )}
          {idea.roughCostMinor != null && (
            <div>
              <dt className="inline font-medium text-foreground">Rough cost: </dt>
              <dd className="inline text-foreground">{amount(idea.roughCostMinor, pot)}</dd>
            </div>
          )}
          {idea.whoMight && (
            <div>
              <dt className="inline font-medium text-foreground">Who might do it: </dt>
              <dd className="inline text-foreground">{idea.whoMight}</dd>
            </div>
          )}
        </dl>
      )}
      {idea.threadId && (
        <Link href={`/forum/${idea.threadId}`} className="mt-3 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">
          Talk about it
        </Link>
      )}
    </li>
  );
}

function RoundPage({ id }: { id: string }) {
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
        <p className="text-foreground">This round could not be found.</p>
        <Link href="/funding-rounds" className="mt-2 inline-block text-primary underline-offset-4 hover:underline">
          Back to funding rounds
        </Link>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <BreathingLoader label="Opening the round" />
      </div>
    );
  }
  const { round, pot, ideas } = data;
  return (
    <>
      <section className="bg-gradient-to-b from-teal-deep/5 to-background py-8 md:py-12">
        <div className="container max-w-3xl">
          <Link href="/funding-rounds" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            Funding rounds
          </Link>
          <h1 className="mt-1 font-display text-4xl font-bold text-foreground">{round.title}</h1>
          <p className="mt-2 text-muted-foreground">
            {pot.name}. {STAGE_LINE[round.stage]}, {when(round.stageEndsAt)}.
          </p>
          <StageRail stage={round.stage} />
        </div>
      </section>
      <div className="container grid max-w-3xl gap-6 pb-16">
        {round.acceptsIdeas && <IdeaForm round={round} pot={pot} onShared={load} />}
        <section aria-labelledby="ideas-heading">
          <h2 id="ideas-heading" className="font-display text-xl font-semibold text-foreground">
            {ideas.length === 1 ? "1 idea so far" : `${ideas.length} ideas so far`}
          </h2>
          {ideas.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No ideas yet. The first one can be yours.</p>
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
      setMessage(res.ok ? ok : typeof out.error === "string" && /\s/.test(out.error) ? out.error : "That did not save. Try again.");
      if (res.ok) onChanged();
      return res.ok;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="steward-heading" className="rounded-2xl border border-dashed border-border p-5">
      <h2 id="steward-heading" className="font-display text-xl font-semibold text-foreground">
        For the pot's holder
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">You hold the village's funding pots, so you can open a pot and a round.</p>
      <form
        className="mt-4 grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await send("/api/funding-rounds/pots", { name: potName, unitCode: unit.trim().toUpperCase(), unitKind: "currency", purpose }, "The pot is open.")) {
            setPotName("");
            setUnit("");
            setPurpose("");
          }
        }}
      >
        <h3 className="text-base font-semibold text-foreground">Open a pot</h3>
        <label className={LABEL}>
          Name
          <input className={FIELD} value={potName} onChange={(e) => setPotName(e.target.value)} required />
        </label>
        <label className={LABEL}>
          Currency code, such as CRC
          <input className={FIELD} value={unit} maxLength={3} onChange={(e) => setUnit(e.target.value)} required />
        </label>
        <label className={LABEL}>
          What it is for
          <textarea className={FIELD} rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </label>
        <button type="submit" className={BTN_SECONDARY} disabled={busy}>
          Open the pot
        </button>
      </form>
      {pots.length > 0 && (
        <form
          className="mt-6 grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const chosen = potId || pots[0].id;
            const body = { title: roundTitle, growAt: growAt ? new Date(growAt).toISOString() : null };
            if (await send(`/api/funding-rounds/pots/${chosen}/rounds`, body, "The round is open for ideas.")) {
              setRoundTitle("");
              setGrowAt("");
            }
          }}
        >
          <h3 className="text-base font-semibold text-foreground">Open a round for ideas</h3>
          <label className={LABEL}>
            Pot
            <select className={FIELD} value={potId || pots[0].id} onChange={(e) => setPotId(e.target.value)}>
              {pots.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            Round name, such as the season it funds
            <input className={FIELD} value={roundTitle} onChange={(e) => setRoundTitle(e.target.value)} required />
          </label>
          <label className={LABEL}>
            When shaping starts (leave empty to keep the round in Seed)
            <input type="date" className={FIELD} value={growAt} onChange={(e) => setGrowAt(e.target.value)} />
          </label>
          <button type="submit" className={BTN_SECONDARY} disabled={busy}>
            Open the round
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

function Overview() {
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
  const potOf = (id: string) => data?.pots.find((p) => p.id === id);
  return (
    <>
      <section className="bg-gradient-to-b from-teal-deep/5 to-background py-8 md:py-12">
        <div className="container max-w-3xl">
          <h1 className="font-display text-4xl font-bold text-foreground">Funding rounds</h1>
          <p className="mt-2 text-muted-foreground">Choose together which quests the season funds, within a pot.</p>
        </div>
      </section>
      <div className="container grid max-w-3xl gap-6 pb-16">
        {failed && <p className="text-foreground">The rounds could not be read just now. Try again in a moment.</p>}
        {!data && !failed && (
          <div className="flex min-h-[30vh] items-center justify-center">
            <BreathingLoader label="Reading the rounds" />
          </div>
        )}
        {data && open.length === 0 && (
          <p className="text-foreground">No round is open yet. When the pot's holder opens one, ideas are welcome here.</p>
        )}
        {open.length > 0 && (
          <ul className="grid gap-3">
            {open.map((r) => (
              <li key={r.id} className="rounded-2xl border border-border bg-card p-5">
                <Link href={`/funding-rounds/${r.id}`} className="font-display text-xl font-semibold text-foreground underline-offset-4 hover:underline">
                  {r.title}
                </Link>
                <p className="mt-1 text-sm text-muted-foreground">
                  {potOf(r.potId)?.name ?? "A pot"}. {STAGE_LINE[r.stage]}, {when(r.stageEndsAt)}.{" "}
                  {r.ideaCount === 1 ? "1 idea so far." : `${r.ideaCount} ideas so far.`}
                </p>
                <Link href={`/funding-rounds/${r.id}`} className={`${BTN_QUIET} mt-3 inline-flex`}>
                  {r.acceptsIdeas ? "Share or read ideas" : "Open the round"}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {data?.canSteward && <StewardPanel pots={data.pots} onChanged={load} />}
      </div>
    </>
  );
}

export default function FundingRounds() {
  const { user } = useAuth();
  const modules = useModules();
  const [isRound, params] = useRoute("/funding-rounds/:id");
  const on = (modules.modules ?? []).some((m) => m.id === "funding-rounds" && m.lifecycle !== "off");

  if (!modules.loaded) {
    return (
      <Layout>
        <div className="flex min-h-[50vh] items-center justify-center">
          <BreathingLoader label="Opening funding rounds" />
        </div>
      </Layout>
    );
  }
  if (!on) return <ModuleGate moduleId="funding-rounds" name="Funding rounds" />;
  if (!user) return <SignInToSee moduleId="funding-rounds" name="Funding rounds" />;
  return <Layout>{isRound && params?.id ? <RoundPage id={params.id} /> : <Overview />}</Layout>;
}
