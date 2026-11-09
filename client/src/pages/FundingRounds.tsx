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
import { useCallback, useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import Layout from "@/components/Layout";
import BreathingLoader from "@/components/natural/BreathingLoader";
import ModuleGate, { SignInToSee } from "@/components/modules/ModuleGate";
import { BTN_QUIET, BTN_SECONDARY } from "@/components/journal/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useModules } from "@/modules/ModuleProvider";
import { gameFetch } from "@/lib/gameApi";
import { FIELD, LABEL, readJson, sentenceOf, useStageText, type Detail, type Pot, type Round } from "@/components/fundingRounds/common";
import { Ballot, IdeaCard, IdeaForm, Results, StageRail } from "@/components/fundingRounds/RoundParts";

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
