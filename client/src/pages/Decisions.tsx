/**
 * DECISIONS: what the village is deciding, right now.
 *
 * The review that commissioned this lane named the trap by name: `/governance`
 * is a beautiful static explainer of how decisions get made, and a governance
 * interface that looks like it makes the engine's rigor read as paperwork. So
 * this page is the opposite of that page. It explains nothing. It shows live
 * ballots with running clocks and filling bars, it says which ones are waiting
 * on YOU, and everything a member needs to know about the machinery is
 * attached to the decision it applies to.
 *
 * The order on the page is the order of a member's attention:
 *
 *   1. Waiting on you       open, in your electorate, unvoted. Usually empty,
 *                           and that emptiness is a good thing to be able to
 *                           see at a glance.
 *   2. Awaiting a human     the period ended and nobody has closed it. This is
 *                           the state the engine deliberately creates, because
 *                           closing is a human act, and a page that did not
 *                           surface it would leave decisions rotting.
 *   3. Being decided        everything else that is open.
 *   4. Decided              the record, most recent first, each one carrying
 *                           the human sentence it closed with.
 *
 * The rail beside it is one descent, from the reader outward: what YOU weigh,
 * then how anyone's weight got where it is, then how much of the village turns
 * out, then how a decision travels. Weights are power, and power a member
 * cannot find is the thing the constitution's new law was written against.
 *
 * The first two of those used to overlap. "Your weight" printed the reader's
 * own weight-change rows and "The weight record" printed the village's trail,
 * which holds those same rows, and the headings were four words apart. The
 * trail is one list now and it marks the reader's rows; see `WeightRecord`.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { PenLine, Scale } from "lucide-react";
import Layout from "@/components/Layout";
import ModuleGate, { SignInDoors } from "@/components/modules/ModuleGate";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { useAuth } from "@/contexts/AuthContext";
import { BreathingLoader } from "@/components/natural";
import InfoTip from "@/components/InfoTip";
import DecisionCard from "@/components/governance/DecisionCard";
import MyStanding from "@/components/governance/MyStanding";
import QuorumField from "@/components/governance/QuorumField";
import WeightRecord from "@/components/governance/WeightRecord";
import {
  fetchBallots,
  fetchStanding,
  fetchWeightRecord,
  type BallotCard,
  type Standing,
  type WeightRecord as WeightRecordData,
} from "@/components/governance/governanceApi";
import { quorumPctOf } from "@shared/governanceEngine";

/**
 * How much of the record one read buys. The route's own default, stated here
 * because this page is the thing that decides when to ask for more of it.
 */
const RECORD_PAGE = 100;

export default function Decisions() {
  const { user } = useAuth();
  const modules = useModules();
  const governance = useModule("governance");

  const [ballots, setBallots] = useState<BallotCard[] | null>(null);
  /**
   * HOW FAR INTO THE RECORD THIS PAGE HAS READ.
   *
   * The list route answered a bare hundred rows and said nothing about there
   * being more, so a village four years in opened its own record and found
   * its founding decisions absent, on a page that looked exactly like the
   * page of a village that has held ninety. `more` is the honest version of
   * that fact: a full page came back, so there is at least one more row.
   */
  const [read, setRead] = useState(0);
  const [more, setMore] = useState(false);
  const [readingMore, setReadingMore] = useState(false);
  const [standing, setStanding] = useState<Standing | null>(null);
  // The village-wide trail. Member-readable by design, so it rides the same
  // load as the rest of the rail instead of hiding behind an admin door.
  const [record, setRecord] = useState<WeightRecordData | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!governance || !user) return;
    let alive = true;
    (async () => {
      const [b, s, w] = await Promise.all([
        fetchBallots({ limit: RECORD_PAGE }),
        fetchStanding(),
        fetchWeightRecord(),
      ]);
      if (!alive) return;
      if (b.ok) {
        setBallots(b.data);
        setRead(b.data.length);
        setMore(b.data.length === RECORD_PAGE);
      } else setProblem(b.error);
      if (s.ok) setStanding(s.data);
      if (w.ok) setRecord(w.data);
    })();
    return () => {
      alive = false;
    };
  }, [governance, user]);

  /**
   * The next page of the record, when a member asks for it.
   *
   * Merged by id rather than appended. Offset paging over a list that grows
   * at the head can hand back a row this page already holds, and a village
   * seeing one of its own decisions twice would be the page inventing a vote.
   */
  const readMore = async () => {
    if (readingMore) return;
    setReadingMore(true);
    const next = await fetchBallots({ limit: RECORD_PAGE, offset: read });
    if (next.ok) {
      setBallots((prev) => {
        const byId = new Map((prev ?? []).map((b) => [b.id, b]));
        for (const b of next.data) byId.set(b.id, b);
        return Array.from(byId.values());
      });
      setRead((n) => n + next.data.length);
      setMore(next.data.length === RECORD_PAGE);
    } else setProblem(next.error);
    setReadingMore(false);
  };

  const groups = useMemo(() => {
    const all = ballots ?? [];
    const now = Date.now();
    const open = all.filter((b) => b.status === "open");
    const expired = open.filter((b) => Date.parse(b.closesAt) <= now);
    const running = open.filter((b) => Date.parse(b.closesAt) > now);
    return {
      mine: running.filter((b) => b.myWeight !== null && !b.myVote),
      awaitingClose: expired,
      running: running.filter((b) => !(b.myWeight !== null && !b.myVote)),
      decided: all.filter((b) => b.status !== "open"),
    };
  }, [ballots]);

  if (modules.loaded && !governance) return <ModuleGate moduleId="governance" name="Decisions" />;

  return (
    <Layout>
      <section className="bg-teal-band text-white py-10">
        <div className="container max-w-6xl px-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="text-amber-on-band text-sm font-medium uppercase tracking-widest">The village decides</span>
              <h1 className="mt-1 font-display text-3xl font-bold sm:text-4xl">Decisions</h1>
              <p className="mt-2 max-w-2xl text-white leading-relaxed">
                Every vote this village is holding, and every one it has held. Votes stay changeable until they close,
                and nothing closes on a timer.
              </p>
            </div>
            <Link
              href="/propose"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-white px-5 font-semibold text-teal-band hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-teal-band"
            >
              <PenLine className="w-4 h-4" aria-hidden="true" />
              Start a proposal
            </Link>
          </div>
        </div>
      </section>

      <div className="container max-w-6xl px-4 py-8">
        {!user ? (
          <div className="rounded-xl border border-stone-200 bg-white p-8 text-center">
            <h2 className="font-display text-2xl font-bold text-stone-900">Sign in to see what is being decided</h2>
            <p className="mx-auto mt-2 max-w-md text-stone-600 leading-relaxed">
              Votes here carry names, so the page opens for members.
            </p>
            {/* This card is deliberate and stays: the hero above it is this
                page's own, and SignInToSee would replace the whole thing with
                a bare column. What was missing is the second door, for the
                visitor with no account to sign in with. */}
            <div className="mt-5">
              <SignInDoors next="/decisions" />
            </div>
          </div>
        ) : ballots === null ? (
          <div className="flex justify-center py-16">
            <BreathingLoader label="Reading the village's decisions" />
          </div>
        ) : (
          <div className="lg:grid lg:grid-cols-[1fr_20rem] lg:gap-8">
            <div className="min-w-0 space-y-10">
              {problem && (
                <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-coral">
                  {problem}
                </p>
              )}

              {ballots.length === 0 && (
                <div className="rounded-xl border-2 border-dashed border-stone-300 p-8 text-center">
                  <h2 className="text-lg font-bold text-stone-900">Nothing is being decided right now</h2>
                  <p className="mx-auto mt-2 max-w-md text-stone-600 leading-relaxed">
                    That is a real state, not an empty page. When somebody takes a proposal to a vote, it appears here
                    with a clock on it.
                  </p>
                  <Link
                    href="/propose"
                    className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-teal-deep px-5 font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2"
                  >
                    <PenLine className="w-4 h-4" aria-hidden="true" />
                    Start one
                  </Link>
                </div>
              )}

              <Group
                title="Waiting on you"
                blurb="You are on the roll for these and have not voted yet."
                ballots={groups.mine}
                emptyNote={ballots.length > 0 ? "You have voted in everything that is open to you." : null}
              />
              <Group
                title="Waiting to be closed"
                blurb="The voting period ended. Nothing here closes itself: a person has to close it and say what the village decided."
                ballots={groups.awaitingClose}
              />
              <Group title="Being decided" blurb="Open, and still taking votes." ballots={groups.running} />
              <Chronicle ballots={groups.decided} />

              {/* The rest of the record, when somebody wants it. No count, no
                  total and no sense of a page left unfinished: a village's
                  history is not a task with a remainder (R55). */}
              {more && (
                <div>
                  <button
                    type="button"
                    onClick={() => void readMore()}
                    disabled={readingMore}
                    className="min-h-[44px] rounded-lg border border-stone-300 px-5 text-sm font-semibold text-stone-700 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2 disabled:opacity-60"
                  >
                    {readingMore ? "Reading earlier decisions…" : "Show earlier decisions"}
                  </button>
                  <p className="mt-1.5 text-sm text-stone-600 leading-relaxed">
                    The record goes back as far as the village does.
                  </p>
                </div>
              )}
            </div>

            <aside className="mt-10 space-y-6 lg:mt-0">
              {standing && <MyStanding standing={standing} />}
              {/* One trail, and it knows which rows are the reader's. `MyStanding`
                  above states what they weigh; this states how anyone's weight got
                  where it is, the reader's rows included and marked. */}
              {record && <WeightRecord record={record} mine={standing?.history ?? []} />}
              <TurnoutCard ballots={ballots} />
              <div className="rounded-xl border border-stone-200 bg-white p-4">
                <h3 className="flex items-center gap-2 text-base font-bold text-stone-900">
                  <Scale className="w-4 h-4 text-teal-deep" aria-hidden="true" />
                  How this works
                  <InfoTip
                    tip="A proposal gathers support first. Once it has enough, someone opens a ballot, which freezes who may vote and how much each vote weighs."
                    label="How a decision travels"
                  />
                </h3>
                <p className="mt-2 text-sm text-stone-600 leading-relaxed">
                  Thresholds and weights freeze the moment a ballot opens, so nothing anyone changes later can rewrite a
                  vote in flight.
                </p>
                <Link
                  href="/governance"
                  className="mt-3 inline-flex min-h-[44px] items-center text-sm font-semibold text-teal-deep hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
                >
                  Read how the village governs
                </Link>
              </div>
            </aside>
          </div>
        )}
      </div>
    </Layout>
  );
}

function Group({
  title,
  blurb,
  ballots,
  emptyNote,
}: {
  title: string;
  blurb: string;
  ballots: BallotCard[];
  emptyNote?: string | null;
}) {
  if (ballots.length === 0 && !emptyNote) return null;
  return (
    <section>
      <h2 className="font-display text-xl font-bold text-stone-900">{title}</h2>
      <p className="mt-0.5 text-sm text-stone-600 leading-relaxed">{blurb}</p>
      {ballots.length === 0 ? (
        <p className="mt-3 rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm text-stone-600">{emptyNote}</p>
      ) : (
        <div className="mt-3 space-y-3">
          {ballots.map((b) => (
            <DecisionCard key={b.id} ballot={b} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * THE RECORD AS A CHRONICLE, NOT A TABLE.
 *
 * A flat list newest-first is the right shape for a queue and the wrong one
 * for a history: it says what happened last and nothing at all about when a
 * village was busy, when it was quiet, and what it went through in between.
 * Grouped by the year each decision was settled, the same rows tell a village
 * its own story, and a village reading its founding year is reading the part
 * a flat list buries.
 *
 * TIME IS THE ONLY GROUPING ALLOWED HERE (R55). Not by outcome, which sorts a
 * village's decisions into wins and losses. Not by how many, which turns a
 * quiet year into a shortfall. There is no count on a year, no busiest year,
 * no comparison between years and no cadence anybody is behind on. A year
 * with one decision and a year with forty get the same heading in the same
 * size, and the year is a fact about when, never a score.
 */
function Chronicle({ ballots }: { ballots: BallotCard[] }) {
  const years = useMemo(() => {
    const by = new Map<string, BallotCard[]>();
    for (const b of ballots) {
      /*
       * The day the village settled it. Every route that leaves `open` writes
       * `closed_at`, the withdrawal included, so the fallback is for a row
       * some later state produces rather than for anything shipping today,
       * and it names the year the vote OPENED instead of guessing at one.
       */
      const when = b.closedAt ?? b.closesAt;
      const t = Date.parse(when);
      const year = Number.isNaN(t) ? "Undated" : String(new Date(t).getFullYear());
      const list = by.get(year);
      if (list) list.push(b);
      else by.set(year, [b]);
    }
    return Array.from(by.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [ballots]);

  if (ballots.length === 0) return null;

  return (
    <section>
      <h2 className="font-display text-xl font-bold text-stone-900">What the village has decided</h2>
      <p className="mt-0.5 text-sm text-stone-600 leading-relaxed">
        The record, by the year the village settled each one. Each carries the sentence it closed with.
      </p>
      {years.map(([year, list]) => (
        <div key={year} className="mt-5">
          <h3 className="border-b border-stone-200 pb-1 font-display text-lg font-bold text-stone-800">{year}</h3>
          <div className="mt-3 space-y-3">
            {list.map((b) => (
              <DecisionCard key={b.id} ballot={b} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

/**
 * How much of the village has been showing up, drawn as the field.
 *
 * THIS USED TO BE A MOON, and that was wrong the moment the founder's design
 * landed. The vocabulary a member learns on a decision is that the MOON is
 * agreement and the SILHOUETTES are participation. A moon standing over a
 * turnout figure in the rail beside those decisions teaches the opposite of
 * the page next to it, and the number underneath cannot undo a shape.
 *
 * NO NOTCH HERE. Every closed vote froze its own quorum threshold, so an
 * average of them has no single bar to reach, and drawing one would invent a
 * line no ballot ever carried. `QuorumField` takes a null threshold for
 * exactly this case.
 */
function TurnoutCard({ ballots }: { ballots: BallotCard[] }) {
  /*
   * A VOTE THE VILLAGE CALLED OFF IS NOT A TURNOUT OF ZERO.
   *
   * This counted every ballot that was not open, withdrawals included, and a
   * withdrawn ballot is closed with whatever turnout it had reached at the
   * moment somebody decided it should not have been opened. Usually that is
   * nothing, so each one dropped a zero into the average and made a village
   * look less willing to show up than it is. Under R55 a wrong number here is
   * worse than a wrong sentence: it is a scorecard the village is failing on
   * a technicality nobody chose.
   *
   * `no_quorum` STAYS, and that is the line between the two. Too few people
   * answered is a real turnout, measured on a vote the village was genuinely
   * asked, and leaving it out would flatter the number in the other
   * direction. A withdrawal is the village saying the question should not
   * have been put at all.
   */
  const decided = ballots.filter((b) => b.status !== "open" && b.status !== "withdrawn");
  if (decided.length === 0) return null;
  const average =
    decided.reduce((sum, b) => sum + quorumPctOf(b.tallies, b.totalWeight), 0) / decided.length;
  const votes = `${decided.length} closed ${decided.length === 1 ? "vote" : "votes"}`;
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <h3 className="text-base font-bold text-stone-900">How much the village turns out</h3>
      <div className="mt-3">
        <QuorumField
          valuePct={average}
          thresholdPct={null}
          title="Average turnout across closed votes"
          reading={`Across ${votes}, this much of the village's weight has spoken`}
          detail="Each silhouette is a twentieth of the weight on the roll."
        />
      </div>
      <p className="mt-2 text-sm text-stone-600 leading-relaxed">
        Across {votes}, an average of {Math.round(average)}% of the village's weight has spoken.
      </p>
    </div>
  );
}
