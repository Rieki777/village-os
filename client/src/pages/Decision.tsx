/**
 * ONE DECISION, live.
 *
 * This is the page a member lands on when the village is deciding something
 * and they want to know where it stands. Its order answers the questions in
 * the order people ask them:
 *
 *   WHAT is being decided       the title, the kind, and the document exactly
 *                               as it was snapshotted when the ballot opened.
 *                               What is voted on is what was checked.
 *   WHERE does it stand         the two bars, the weight that has spoken
 *                               against the weight that could, the clock.
 *   WHAT DO I DO                the vote widget, with the change permission
 *                               stated rather than implied.
 *   WHO ELSE                    the frozen roll: who has spoken, who has not.
 *   WHAT HAPPENS NEXT           who may close it, and the close beat itself.
 *
 * A closed decision replaces the first three with the outcome card, because a
 * decided question is not a live one and pretending otherwise is how a record
 * page becomes a scoreboard.
 *
 * Everything here re-reads from the server after any act, rather than patching
 * local state: the tallies, the objection statuses and the outcome are the
 * engine's to compute, and a page that guessed at them would eventually show a
 * member a number the close route did not agree with.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, FileText, Scale } from "lucide-react";
import type { BallotMethod, VoteChoice } from "@shared/governanceEngine";
import Layout from "@/components/Layout";
import ModuleGate from "@/components/modules/ModuleGate";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { useAuth } from "@/contexts/AuthContext";
import { BreathingLoader } from "@/components/natural";
import InfoTip from "@/components/InfoTip";
import CloseBeat from "@/components/governance/CloseBeat";
import DecisionOutcome, { DECISION_OUTCOME_COPY } from "@/components/governance/DecisionOutcome";
import MyStanding from "@/components/governance/MyStanding";
import ObjectionPanel from "@/components/governance/ObjectionPanel";
import TransferCeremony from "@/components/governance/TransferCeremony";
import VoteClock from "@/components/governance/VoteClock";
import VoteResult from "@/components/governance/VoteResult";
import VoteWidget from "@/components/governance/VoteWidget";
import VoterRoll from "@/components/governance/VoterRoll";
import WeightRecord from "@/components/governance/WeightRecord";
import { subjectNoun } from "@/components/governance/wizardConfig";
import { useCatalyst } from "@/lib/gameApi";
import { weightText } from "@/components/governance/voteBars";
import {
  castVote,
  closeBallot,
  fetchBallot,
  fetchStanding,
  fetchWeightRecord,
  fileObjection,
  ruleObjection,
  withdrawBallot,
  type Ballot,
  type CloseResult,
  type PriorAttempt,
  type Standing,
  type WeightRecord as WeightRecordData,
} from "@/components/governance/governanceApi";

/**
 * WHAT EACH METHOD MEANS, and its authority is `BALLOT_METHODS` in
 * `shared/governanceEngine.ts`. Typed against `BallotMethod` rather than
 * `string`, so a fifth method added there turns this declaration red instead
 * of shipping a tooltip that quietly describes a different method.
 */
const METHOD_TIP: Record<BallotMethod, string> = {
  majority: "More than half of the weight that took a side carries it.",
  consensus: "Everyone who takes a side has to agree. One no stops it.",
  consent: "Nobody has to agree. It carries unless somebody names a consequence the village should avoid.",
  custom: "The village set its own bar for agreement and for turnout, and this ballot froze both when it opened.",
};

/**
 * A method this build has not been taught. It used to fall back to the
 * `custom` sentence, which told a member a specific and possibly false thing
 * about how their decision carries. Saying the rule is on the ballot is the
 * only sentence that stays true whatever the method turns out to be.
 */
const UNKNOWN_METHOD_TIP =
  "This ballot was decided by a method this page has not been taught to explain. Its rule was frozen when the ballot opened and is on the decision's record.";

const WEIGHT_MODE_TIP: Record<Ballot["weightMode"], string> = {
  equal: "Every member on the roll weighs the same here.",
  token: "Weight came from token balances, read once when this ballot opened and frozen there.",
  custom: "Weight was allocated by the stewards, and every allocation is on the record.",
};

/**
 * Same rule for weight. Falling back to the `equal` sentence told a member
 * "every member on the roll weighs the same here" about a ballot that may
 * have been weighted by token, which is a false statement about their own
 * standing in a vote.
 */
const UNKNOWN_WEIGHT_TIP =
  "Weight on this ballot was decided by a mode this page has not been taught to explain. It was frozen when the ballot opened, and the weight record shows what each member carried.";

/**
 * WHICH ANSWER ABOUT WHAT CHANGED THIS PAGE SHOWS.
 *
 * Two sources, and they are not interchangeable. The close response is the
 * ACT's own answer and it exists for one browser session; the ledger is the
 * permanent record and it is all a reader has on any later visit. Before this
 * the card had only the first, so a carried decision knew what it changed for
 * about a minute and then forgot, on exactly the decisions worth returning to.
 *
 * The close wins where it exists, INCLUDING when its answer is that nothing
 * moved: a pass that applied nothing and said why in `held` must not have an
 * empty list quietly replaced by a ledger read from a different moment. Absent
 * on both sides returns undefined, which renders no section at all rather than
 * an empty "What changed" heading over nothing.
 */
export function appliedToShow(
  justClosed: { applied: string[] } | null,
  chronicle: { appliedKeys: string[] } | null,
): string[] | undefined {
  if (justClosed) return justClosed.applied;
  return chronicle?.appliedKeys;
}

export const DECISION_METHOD_TIPS = METHOD_TIP;
export const DECISION_WEIGHT_TIPS = WEIGHT_MODE_TIP;

export default function Decision() {
  const params = useParams<{ id: string }>();
  const { user } = useAuth();
  // The village's own word for whoever runs it. A LABEL and nothing more:
  // nothing on this page gates on it, and who may close still comes from
  // standing exactly as it did before.
  const catalyst = useCatalyst();
  const modules = useModules();
  const governance = useModule("governance");

  const [ballot, setBallot] = useState<Ballot | null>(null);
  /**
   * THE TWO FACTS THAT SURVIVE THE SESSION, held apart from the ballot.
   *
   * `ballot` is written by four routes: the read, the close, the withdrawal
   * and a vote. Only the read carries these two, so they live in their own
   * state rather than being declared on `Ballot` and then arriving undefined
   * from three of the four. Neither goes stale in a way that matters: a close
   * hands back its own `applied` for the session that did it, and calling a
   * vote off does not change what earlier votes on the subject decided.
   */
  const [chronicle, setChronicle] = useState<{ appliedKeys: string[]; priorAttempts: PriorAttempt[] } | null>(null);
  const [standing, setStanding] = useState<Standing | null>(null);
  // The village-wide weight trail. It rides along here because this page shows
  // "Your weight" too, and that card no longer carries a trail of its own: the
  // reader's own changes live in this one list, marked as theirs. Without this
  // read, a member who arrived on a decision could not see how the weights
  // deciding it were allocated, and hidden power is what the record exists to
  // prevent.
  const [record, setRecord] = useState<WeightRecordData | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");
  /** Votes discarded by the withdrawal that just happened, stated once. */
  const [withdrawn, setWithdrawn] = useState<number | null>(null);
  const [justClosed, setJustClosed] = useState<CloseResult | null>(null);
  const [showDoc, setShowDoc] = useState(false);

  const load = useCallback(async () => {
    if (!params.id) return;
    const answer = await fetchBallot(params.id);
    if (answer.ok) {
      setBallot(answer.data);
      setChronicle({
        appliedKeys: Array.isArray(answer.data.appliedKeys) ? answer.data.appliedKeys : [],
        priorAttempts: Array.isArray(answer.data.priorAttempts) ? answer.data.priorAttempts : [],
      });
    } else setMissing(true);
  }, [params.id]);

  useEffect(() => {
    if (!governance) return;
    void load();
    if (user) {
      void fetchStanding().then((s) => s.ok && setStanding(s.data));
      void fetchWeightRecord().then((w) => w.ok && setRecord(w.data));
    }
  }, [governance, load, user]);

  const act = async (run: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    setProblem(null);
    const answer = await run();
    if (!answer.ok) setProblem(answer.error ?? "That did not work");
    await load();
    setBusy(false);
  };

  const onVote = async (choice: VoteChoice, reason?: string) => {
    await act(() => castVote(params.id!, choice, reason));
  };

  /**
   * Call the vote off. Its own act rather than a `run` through `act`, because
   * the answer carries `votesDiscarded` and a member who just threw away other
   * people's votes is owed that number in words, once, from the act itself.
   */
  const onWithdraw = async () => {
    if (withdrawReason.trim().length < 10) {
      setProblem("Calling off a vote records why, in a sentence the roll will read.");
      return;
    }
    setBusy(true);
    setProblem(null);
    const answer = await withdrawBallot(params.id!, withdrawReason.trim());
    if (answer.ok) {
      setBallot(answer.data.ballot);
      setWithdrawing(false);
      setWithdrawReason("");
      setWithdrawn(answer.data.votesDiscarded);
    } else {
      setProblem(answer.error);
      await load();
    }
    setBusy(false);
  };

  const onClose = async (outcomeNote: string) => {
    setBusy(true);
    setProblem(null);
    const answer = await closeBallot(params.id!, outcomeNote);
    if (answer.ok) {
      setJustClosed(answer.data);
      setBallot(answer.data.ballot);
      setClosing(false);
    } else {
      setProblem(answer.error);
      await load();
    }
    setBusy(false);
  };

  if (modules.loaded && !governance) return <ModuleGate moduleId="governance" name="Decisions" />;

  if (missing) {
    return (
      <Layout>
        <div className="container max-w-2xl px-4 py-16 text-center">
          <h1 className="font-display text-3xl font-bold text-stone-900">No such decision</h1>
          <p className="mt-2 text-stone-600">It may have been withdrawn, or the link may be wrong.</p>
          <Link
            href="/decisions"
            className="mt-6 inline-flex min-h-[44px] items-center rounded-lg bg-teal-deep px-5 font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2"
          >
            Everything the village is deciding
          </Link>
        </div>
      </Layout>
    );
  }

  if (!ballot) {
    return (
      <Layout>
        <div className="flex justify-center py-24">
          <BreathingLoader label="Opening the decision" />
        </div>
      </Layout>
    );
  }

  const open = ballot.status === "open";
  const expired = Date.parse(ballot.closesAt) <= Date.now();
  const inRoll = ballot.myWeight !== null;
  const votedCount = ballot.votes.length;

  return (
    <Layout>
      <div className="container max-w-6xl px-4 py-8">
        <Link
          href="/decisions"
          className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-stone-600 hover:text-teal-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Every decision
        </Link>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-700">
            {subjectNoun(ballot.subjectType)}
          </span>
          <span className="text-xs text-stone-600">
            Decided by {ballot.method}
            <InfoTip tip={METHOD_TIP[ballot.method] ?? UNKNOWN_METHOD_TIP} label="What this method means" />
          </span>
          <span className="text-xs text-stone-600">
            {ballot.electorateCount} on the roll, {weightText(ballot.totalWeight)} weight between them
            <InfoTip tip={WEIGHT_MODE_TIP[ballot.weightMode] ?? UNKNOWN_WEIGHT_TIP} label="How weight was decided" />
          </span>
        </div>

        <h1 className="mt-2 font-display text-3xl font-bold leading-tight text-stone-900 sm:text-4xl">
          {ballot.title}
        </h1>

        {open && (
          <p className="mt-2">
            <VoteClock closesAt={ballot.closesAt} />
          </p>
        )}

        {/* WHETHER THIS BINDS, ABOVE EVERYTHING IT COULD BE MISTAKEN FOR.
            Everything below this line is identical for an advisory vote and a
            binding one, deliberately: the same frozen roll, the same weights,
            the same quorum to reach, because practising on a softer engine
            would teach a village the wrong thing. That is exactly why the
            fact has to be stated, and stated before the vote widget rather
            than beside the outcome. `binding` comes from the close route's
            own subject table, so this cannot drift from what closing does. */}
        {!ballot.binding && (
          /* AND IN THE TENSE THE BALLOT IS ACTUALLY IN. This banner sat in the
             present over a settled vote, so a closed advisory read "the
             village is being asked" directly above a badge saying it did not
             carry: two elements on one page in different tenses about the
             same ballot, and the live-sounding one on top. The fact that
             settles it is already here. */
          <div className="mt-3 rounded-lg border border-stone-200 bg-cream px-4 py-3">
            <p className="text-sm font-semibold text-stone-900">
              {open ? "The village is being asked, and nothing more" : "The village was asked, and nothing more"}
            </p>
            <p className="mt-0.5 text-sm text-stone-700 leading-relaxed">
              {open
                ? "This vote runs on the real engine, with the real roll and the real weights, and closing it changes nothing on its own. What it produces is an answer the village can act on, or not."
                : "This vote ran on the real engine, with the real roll and the real weights, and closing it changed nothing on its own. What it produced is an answer the village can act on, or not."}
            </p>
          </div>
        )}

        {problem && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-coral">
            {problem}
          </p>
        )}

        {/* What the withdrawal cost, said once, by the act that did it. The
            number comes back from the route rather than being counted here,
            because the votes are gone by the time this renders. */}
        {withdrawn !== null && (
          <p
            role="status"
            className="mt-4 rounded-lg border border-stone-200 bg-cream px-4 py-3 text-sm text-stone-800 leading-relaxed"
          >
            {withdrawn === 0
              ? "This vote is called off. Nobody had voted, so no vote was thrown away, and the subject can go to a vote again whenever it is ready."
              : `This vote is called off, and ${withdrawn} ${withdrawn === 1 ? "vote that had been cast is" : "votes that had been cast are"} discarded. The subject can go to a vote again whenever it is ready.`}
          </p>
        )}

        <div className="mt-6 lg:grid lg:grid-cols-[1fr_20rem] lg:gap-8">
          <div className="min-w-0 space-y-6">
            <PriorAttempts attempts={chronicle?.priorAttempts ?? []} />

            {!open && (
              <DecisionOutcome
                ballot={ballot}
                /* "WHAT CHANGED" IS WRITTEN IN DIALS, AND A POWER IS NOT ONE.
                   This card renders each applied key as "<key> now holds the
                   value the village voted for", which is exactly right for a
                   mechanics amendment and false for a handover: `event.manage`
                   holds no value, it moved house. A real crossing rendered as
                   a dial change is the quiet-lie shape all over again, so the
                   handover's own card says what changed, in the power's words,
                   for both the crossing and the refusal. */
                /* AND IT IS STILL TRUE TOMORROW. `justClosed` exists only in
                   the browser session that closed the vote, so this card used
                   to know what a decision changed for about a minute and then
                   forget: every reader after that got a carried decision with
                   no consequence attached, which is the half worth coming
                   back for. `appliedKeys` is the same fact read off the
                   amendment ledger, which is permanent and carries this
                   ballot's own id. The close response still wins where it
                   exists, because it is the act's own answer, including when
                   that answer is that nothing moved. */
                applied={ballot.transfer ? undefined : appliedToShow(justClosed, chronicle)}
                held={ballot.transfer ? null : justClosed?.held}
                /* ONE MOMENT PER PAGE. A power handover that carried plays its
                   own celebration inside TransferCeremony, on the crossing
                   itself, so this card stands down. Two moments side by side is
                   the wallpaper case the celebration ration exists to prevent
                   (docs/modules/natural-interface.md). */
                fresh={!!justClosed && ballot.transfer === null}
              />
            )}

            {/* THE CEREMONY. It renders above the frozen document and below
                the outcome, on an open handover and on a closed one, because
                what the village is being asked and what the village did are
                the same three facts read at two different times. It returns
                null for every other subject type. */}
            {ballot.transfer && <TransferCeremony ballot={ballot} fresh={!!justClosed} />}

            {/* A CLOSED BALLOT KEEPS THE PICTURE. The whole point of drawing
                the moon and the field is that a village can see how a decision
                actually landed, and a record page that dropped them would
                leave the numbers in the outcome card with nothing to read them
                against. The heading changes because a decided question is not
                a live one. */}
            <section className="rounded-xl border border-stone-200 bg-white p-5">
              <h2 className="text-base font-bold text-stone-900">{open ? "Where it stands" : "How it landed"}</h2>
              <p className="mt-0.5 text-sm text-stone-600 leading-relaxed">
                {!open
                  ? "The measurements this closed on. They are frozen here, exactly as the close route read them."
                  : ballot.method === "consent"
                    ? "Two measurements, never one. How much of the village has spoken, and whether anything still stands in the way."
                    : "Two measurements, never one. How much of the village has spoken, and how those who spoke divided."}
              </p>
              <div className="mt-4">
                <VoteResult
                  tallies={ballot.tallies}
                  totalWeight={ballot.totalWeight}
                  unityPct={ballot.unityPct}
                  quorumPct={ballot.quorumPct}
                  method={ballot.method}
                  electorateCount={ballot.electorateCount}
                  votedCount={votedCount}
                  openObjections={ballot.standingObjections}
                />
              </div>
            </section>

            {open && user && <VoteWidget ballot={ballot} onVote={onVote} busy={busy} />}

            {ballot.method === "consent" && (
              <ObjectionPanel
                objections={ballot.objections}
                standing={ballot.standingObjections}
                canFile={open && !expired && inRoll}
                canRule={open && !!standing?.mayDecide}
                busy={busy}
                onFile={async (text) => {
                  await act(() => fileObjection(ballot.id, text));
                }}
                onRule={async (objectionId, ruling, note) => {
                  await act(() => ruleObjection(ballot.id, objectionId, ruling, note));
                }}
              />
            )}

            {/* THE CLOSE BEAT, offered to whoever could plausibly take it.
                Who may close is `facilitator || (expired && proposer)`, and
                the client can settle only half of that: `mayDecide` comes from
                standing, and whether this viewer proposed the subject does
                not. So before the period ends, where only a facilitator may
                close, the section is hidden from everyone else; once it ends,
                it is offered with the sentence naming who may, because the
                proposer is somebody and hiding it from them would leave the
                decision waiting forever. */}
            {open && user && !closing && (expired || !!standing?.mayDecide) && (
              <section className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                <h2 className="text-base font-bold text-stone-900">Closing this</h2>
                <p className="mt-1 text-sm text-stone-600 leading-relaxed">
                  {expired
                    ? `The voting period has ended and this is waiting for a person. Its proposer, anyone who may decide proposals, or ${catalyst.aName} can close it.`
                    : "The period is still running, and closing it early is yours to do as someone who decides proposals."}{" "}
                  Closing always means writing what the village decided.
                </p>
                <button
                  type="button"
                  onClick={() => setClosing(true)}
                  className="mt-3 min-h-[44px] rounded-lg border border-teal-deep px-5 text-sm font-semibold text-teal-deep hover:bg-teal-deep/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2"
                >
                  Close this decision
                </button>
              </section>
            )}

            {open && closing && (
              <CloseBeat ballot={ballot} busy={busy} onClose={onClose} onCancel={() => setClosing(false)} />
            )}

            {/* CALLING IT OFF, which is not closing it.
                A withdrawal decides nothing, executes nothing, and frees the
                subject for a fresh vote. What it costs is other people's cast
                votes, and that is the whole shape of who may: whoever opened
                it may call off a ballot NOBODY has answered, and once even
                one vote stands it takes a proposal.decide holder or an admin.

                NEITHER PAYLOAD SAYS WHO OPENED IT, so this surface cannot
                check the opener half of that rule and does not pretend to. It
                shows the door whenever somebody of that class could walk
                through it (a facilitator always, anybody while no vote
                stands), states the rule in words above the button, and says
                what the act would discard. A member who did not open it reads
                who this is for and closes the panel; nobody meets the rule
                for the first time as a refusal. */}
            {open && user && !closing && (!!standing?.mayDecide || ballot.votes.length === 0) && (
              <section className="rounded-xl border border-stone-200 bg-white p-4">
                <h2 className="text-base font-bold text-stone-900">Calling this off</h2>
                <p className="mt-1 text-sm text-stone-600 leading-relaxed">
                  A vote opened by mistake can be called off. It decides nothing, records why, and leaves the subject
                  free to go to a vote again straight away.
                </p>
                <p className="mt-2 text-sm text-stone-700 leading-relaxed">
                  {ballot.votes.length === 0
                    ? "Nobody has voted yet, so whoever opened this can call it off and no vote is thrown away."
                    : `${ballot.votes.length} ${ballot.votes.length === 1 ? "member has" : "members have"} already voted. Calling it off discards ${ballot.votes.length === 1 ? "that vote" : "those votes"}, so it takes somebody who decides proposals or ${catalyst.aName}. Closing it and recording the outcome keeps them.`}
                </p>
                {!withdrawing ? (
                  <button
                    type="button"
                    onClick={() => setWithdrawing(true)}
                    className="mt-3 min-h-[44px] rounded-lg border border-stone-300 px-5 text-sm font-semibold text-stone-700 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
                  >
                    Call this vote off
                  </button>
                ) : (
                  <div className="mt-3">
                    <label htmlFor="withdraw-reason" className="block text-sm font-semibold text-stone-900">
                      Why is it being called off?
                    </label>
                    <p className="mt-0.5 text-xs text-stone-600 leading-relaxed">
                      The roll was told this vote was open and will be told it is not. This sentence is what they read.
                    </p>
                    <textarea
                      id="withdraw-reason"
                      rows={3}
                      value={withdrawReason}
                      maxLength={4000}
                      onChange={(e) => setWithdrawReason(e.target.value)}
                      placeholder="Opened against the wrong draft. The corrected one goes to a vote today."
                      className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={onWithdraw}
                        className="inline-flex min-h-[44px] items-center rounded-lg bg-coral px-5 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2 disabled:opacity-60"
                      >
                        Call it off
                      </button>
                      <button
                        type="button"
                        onClick={() => setWithdrawing(false)}
                        className="min-h-[44px] rounded-lg border border-stone-300 px-5 text-sm font-medium text-stone-700 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
                      >
                        Leave it running
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}

            <VoterRoll votes={ballot.votes} silent={ballot.silent} live={open} />

            {/* The document, exactly as it was when the ballot opened. */}
            <section className="rounded-xl border border-stone-200 bg-white p-4">
              <h2 className="flex items-center gap-2 text-base font-bold text-stone-900">
                <FileText className="w-4 h-4 text-teal-deep" aria-hidden="true" />
                What is being voted on
                <InfoTip
                  tip="This document was snapshotted when the ballot opened and cannot change while it runs. What is voted on is what was checked."
                  label="Why the document is frozen"
                />
              </h2>
              <button
                type="button"
                aria-expanded={showDoc}
                onClick={() => setShowDoc((v) => !v)}
                className="mt-2 min-h-[44px] rounded-lg border border-stone-300 px-4 text-sm font-medium text-stone-700 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
              >
                {showDoc ? "Hide the document" : "Read the document"}
              </button>
              {showDoc && (
                <pre className="mt-3 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-lg bg-stone-50 p-4 font-sans text-sm leading-relaxed text-stone-800">
                  {ballot.docMarkdown}
                </pre>
              )}
            </section>
          </div>

          <aside className="mt-8 space-y-6 lg:mt-0">
            {standing && <MyStanding standing={standing} />}
            <div className="rounded-xl border border-stone-200 bg-white p-4">
              <h3 className="flex items-center gap-2 text-base font-bold text-stone-900">
                <Scale className="w-4 h-4 text-teal-deep" aria-hidden="true" />
                This vote's own rules
              </h3>
              <dl className="mt-2 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-stone-600">Agreement needed</dt>
                  <dd className="font-semibold tabular-nums text-stone-900">
                    {ballot.method === "consent" ? "no objections" : `${ballot.unityPct}%`}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-stone-600">Turnout needed</dt>
                  <dd className="font-semibold tabular-nums text-stone-900">{ballot.quorumPct}%</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-stone-600">Opened</dt>
                  <dd className="text-stone-900">
                    {new Date(ballot.opensAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-stone-600">Period ends</dt>
                  <dd className="text-stone-900">
                    {new Date(ballot.closesAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 border-t border-stone-100 pt-3 text-xs text-stone-500 leading-relaxed">
                These numbers froze when this ballot opened. Changing the village's settings now does nothing to this
                vote, open or closed.
              </p>
            </div>
            {/* Last in the rail, because it is the widest thing here: this
                vote's rules are about this vote, and the record is about every
                weight that ever entered one. */}
            {record && <WeightRecord record={record} mine={standing?.history ?? []} />}
          </aside>
        </div>
      </div>
    </Layout>
  );
}

/**
 * THE VILLAGE HAS DECIDED THIS BEFORE.
 *
 * `ballotsFor(subjectType, subjectRef)` has returned every ballot a village
 * ever held on one subject since the engine shipped, newest first, and until
 * now nothing anywhere called it. So a member opening a decision could not
 * tell a first attempt from a fourth, and the fact that the village had been
 * round this question three times already, which is usually the single most
 * useful thing about it, lived in the database and in nobody's screen.
 *
 * Renders NOTHING when there is nothing. A first vote on a subject is the
 * ordinary case, and it gets no strip, no "0 earlier attempts", no empty
 * frame: the absence of a history is not a fact about a village that needs
 * announcing (R55).
 *
 * The word for each earlier outcome comes from the outcome card's own map,
 * so the record and the card cannot end up calling the same status two
 * different things. A status this build has not been taught gets no word at
 * all rather than a guessed one, and the date and the sentence carry the row.
 * That fallback is the whole lesson of the card that read "Did not carry"
 * over a decision the village carried.
 */
function PriorAttempts({ attempts }: { attempts: PriorAttempt[] }) {
  if (attempts.length === 0) return null;
  return (
    <section className="rounded-xl border border-stone-200 bg-cream p-4">
      <h2 className="text-base font-bold text-stone-900">The village has decided this before</h2>
      <p className="mt-0.5 text-sm text-stone-600 leading-relaxed">
        Earlier votes on this same question, each with the sentence it closed with.
      </p>
      <ol className="mt-3 space-y-2">
        {attempts.map((p) => {
          const word = DECISION_OUTCOME_COPY[p.status]?.word ?? null;
          const on = p.closedAt ?? p.opensAt;
          return (
            <li key={p.id} className="border-l-2 border-stone-300 pl-3">
              <Link
                href={`/decisions/${p.id}`}
                className="text-sm font-semibold text-teal-deep hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
              >
                {word ? `${word}, ` : ""}
                {new Date(on).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
              </Link>
              {p.outcomeNote && <p className="text-sm text-stone-700 leading-relaxed">{p.outcomeNote}</p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
