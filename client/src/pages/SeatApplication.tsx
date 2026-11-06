/**
 * `/role-applications/:id`: ONE APPLICATION TO HOLD ROLES, ON TERMS (seat settings PR4).
 * `/seat-applications/:id` is its old spelling and redirects here (App.tsx).
 *
 * Members only. The read behind it answers 401 to a visitor and to a signed-in
 * guest (terms.read opens at the member rung), and this page says so in a
 * sentence rather than as an error.
 *
 * What a member reads, in the order they ask it:
 *
 *   WHICH ROLES, ON WHAT TERMS   the candidate's player card in proposal mode
 *                                (PR 3): one card for up to five roles, its
 *                                live sections reading "Starts once adopted",
 *                                then the Settings drawer OPEN on the terms.
 *                                Should the card fail to load, each role as its
 *                                live card, stacked, as before.
 *   IN THE MEMBER'S WORDS        what will be true at the season's end, and why them
 *   THE CIRCLE'S ANSWER          for a role proposal (role proposals PR D): where
 *                                the circle's consent stands, who was asked and
 *                                answered by role title, and an asked holder's
 *                                Consent or Object (CircleConsent.tsx). Once the
 *                                circle has consented, the holder's adopt button
 *                                reads "Record the adoption".
 *   WHO ADOPTS IT                while it waits, who in this village can adopt
 *                                it, as the server read it from who holds the
 *                                power (E8): the role as "Role (FirstName)", what
 *                                has to happen first when nobody holds it, or the
 *                                village's vote once the village holds it
 *   WHERE IT STANDS              waiting for a seat holder, the village voting
 *                                (with a link to the vote), adopted, held
 *   WHAT YOU CAN DO              the holder's card: "Align for the village" and
 *                                "Put it to the village"; the candidate's withdraw
 *
 * A HOLDER WHO IS THE CANDIDATE never sees an adopt button: their own terms go
 * to the village, and the card says so. The server refuses it too.
 *
 * Money in the terms is a record: the drawer prints "Recorded here. Paid
 * outside the platform." beside every money row.
 */
import WorkPayBlock from "@/components/WorkPayBlock";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, Send, Undo2 } from "lucide-react";
import Layout from "@/components/Layout";
import ModuleGate, { SignInDoors } from "@/components/modules/ModuleGate";
import { PAGE_GATE_LINES } from "@/components/modules/gateCopy";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { useAuth } from "@/contexts/AuthContext";
import { BreathingLoader } from "@/components/natural";
import SeatTradingCard from "@/components/power/SeatTradingCard";
import SeatTermsDrawer from "@/components/power/SeatTermsDrawer";
import PlayerRoleCard from "@/components/playerCard/PlayerRoleCard";
import { loadOrg } from "@/components/governance/pickSources";
import {
  fetchApplication,
  putApplicationToVillage,
  withdrawApplication,
  type ServedApplication,
} from "@/components/governance/seatApplicationsApi";
import { useSeason } from "@/lib/gameApi";
import { useVillagePresets } from "@/lib/seatPresetsRead";
import { fromOrgSeat, seasonForSheet } from "@shared/roleSheetInputs";
import { parseSeatSettings } from "@shared/seatSettings";
import { applicationHref, seatList } from "@shared/seatApplications";
import { civilDayWords } from "@shared/seasonPlans";
import { ALIGN_WORDS, intentSentence } from "@shared/alignments";
import AlignButton from "@/components/alignment/AlignButton";
import AlignmentCard from "@/components/alignment/AlignmentCard";
import { call as alignCall } from "@/components/alignment/alignmentsApi";

import { ApplicantGeneKeys } from "@/components/geneKeys/ProfileGeneKeys";
import CircleConsent from "@/components/roleProposal/CircleConsent";
import { CONSENT_WORDS } from "@shared/roleProposalConsent";

export const APPLICATION_WORDS = {
  membersOnly: "Members read role applications.",
  membersOnlyLine: "An application carries its terms, money included, so it opens at the member rung.",
  signIn: "Sign in to read this application",
  wordsHeading: "In their words",
  deliverables: "By the end of the season",
  why: "Why them",
  wordsRemoved: "These words were removed at the member's request.",
  holderHeading: "For the village",
  holderLine: "You hold the power that seats people. Adopt it for the village, or send it to the village to decide.",
  /** A role proposal that changes roles never goes to a village vote (role proposals PR B). */
  powerLine: "You hold the power that seats people. Adopt it for the village.",
  ownTerms: "Your own terms go to the village to adopt.",
  align: "Align for the village",
  putToVillage: "Put it to the village",
  withdraw: "Withdraw my application",
  withdrawAsk: "Withdraw it? Votes already cast are set aside, and the village is told nothing more about it.",
  withdrawYes: "Yes, withdraw it",
  withdrawNo: "Keep it",
  votingLine: "The village is voting on this application.",
  amends: "These terms amend earlier ones. The earlier terms stay in force until these are.",
  readEarlier: "Read the earlier terms",
  readTheVote: "Read the vote",
  laterLine: "Adopted. The roles are taken up on the first day it names.",
  packageTerms: "One set of terms covers every role above.",
} as const;

/**
 * The application's terms in the Settings drawer, open. The card prints pay in
 * words only, so the drawer is where a holder reads the figures they adopt.
 */
function TermsDrawer({ app }: { app: ServedApplication }) {
  const villagePresets = useVillagePresets();
  const parsed = parseSeatSettings(app.settings);
  const marks = app.alignment ? { state: app.alignment.state, sealed: app.alignment.sealed, parties: app.alignment.parties } : null;
  const adopted =
    app.status === "adopted" && app.decidedAt
      ? {
          how: app.adoptedVia === "holder" ? ("holder" as const) : ("vote" as const),
          holderName: app.adoptedBy,
          // The day in the village's calendar, as the server read it (red team U6).
          on: app.decidedOn ?? app.decidedAt.slice(0, 10),
          href: app.adoptedVia === "ballot" && app.ballotId ? `/decisions/${app.ballotId}` : null,
        }
      : null;
  /*
   * ONE SET OF TERMS, ONE DRAWER (red team U11). An application for several
   * seats asks for them on one set of terms, so the drawer is drawn once: in
   * the card's tray when there is one seat, under the cards when there are
   * more. Three identical drawers read as three sets of terms.
   */
  return (
    <SeatTermsDrawer
      settings={parsed.ok ? parsed.settings : null}
      unreadable={!parsed.ok}
      villagePresets={villagePresets}
      adopted={adopted}
      alignment={marks}
      defaultOpen
    />
  );
}

/** The card the application asks for, then its terms. */
function ApplicationCard({ app }: { app: ServedApplication }) {
  return (
    <>
    <ApplicantGeneKeys userId={app.candidate.id} firstName={(app.candidate.name ?? "The candidate").split(" ")[0]} />
    <PlayerRoleCard
      applicationId={app.id}
      mode="proposal"
      fallback={<SeatCards app={app} />}
      footer={
        <div data-package-terms="" className="sheet-night mt-6 rounded-xl bg-card p-4 text-foreground">
          {app.seats.length > 1 && <p className="mb-3 text-sm text-muted-foreground">{APPLICATION_WORDS.packageTerms}</p>}
          <TermsDrawer app={app} />
        </div>
      }
    />
    </>
  );
}

function SeatCards({ app }: { app: ServedApplication }) {
  const [org, setOrg] = useState<any | null>(null);
  const season = useSeason();
  useEffect(() => {
    let alive = true;
    void loadOrg().then((o) => {
      if (alive) setOrg(o);
    });
    return () => {
      alive = false;
    };
  }, []);
  const roles: any[] = Array.isArray(org?.roles) ? org.roles : [];
  const drawer = <TermsDrawer app={app} />;
  const single = app.seats.length === 1;
  return (
    <div className="space-y-6">
      <ul className="space-y-6">
        {app.seats.map((seat) => {
          const row = roles.find((r) => String(r?.id ?? "") === seat.id);
          return (
            <li key={seat.id}>
              {row ? (
                // The seat as it stands in the village today, held or open (red team U11): never "Proposed".
                <SeatTradingCard
                  input={fromOrgSeat(row, org?.circles, org?.people, org?.village)}
                  ctx={{ now: new Date(), season: seasonForSheet(season), classNames: null }}
                  faces="stacked"
                  settings={
                    // What the seat pays sits above the terms asked for (Rye, 2026-10-30).
                    row.pay ? (
                      <div className="space-y-2">
                        <WorkPayBlock pay={row.pay} variant="full" />
                        {single ? drawer : null}
                      </div>
                    ) : single ? (
                      drawer
                    ) : undefined
                  }
                />
              ) : (
                <div className="sheet-night rounded-xl bg-card p-4 text-foreground">
                  <p className="font-display text-lg font-bold">{seat.name}</p>
                  {seat.aim && <p className="mt-1 text-sm text-muted-foreground">{seat.aim}</p>}
                  {single && <div className="mt-3">{drawer}</div>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {!single && (
        <div data-package-terms="" className="sheet-night rounded-xl bg-card p-4 text-foreground">
          <p className="text-sm text-muted-foreground">{APPLICATION_WORDS.packageTerms}</p>
          <div className="mt-3">{drawer}</div>
        </div>
      )}
    </div>
  );
}

export default function SeatApplication() {
  const params = useParams<{ id: string }>();
  const id = String(params.id ?? "");
  const { user } = useAuth();
  const modules = useModules();
  const governance = useModule("governance");
  const [app, setApp] = useState<ServedApplication | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "members" | "missing" | "error">("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  // Withdraw asks once before it acts (red team U1).
  const [asking, setAsking] = useState(false);

  const load = useCallback(async () => {
    const answer = await fetchApplication(id);
    if (answer.ok) {
      setApp(answer.data.application);
      setState("ready");
    } else if (answer.status === 401) setState("members");
    else if (answer.status === 404) setState("missing");
    else {
      setError(answer.error);
      setState("error");
    }
  }, [id]);

  useEffect(() => {
    if (!user) return;
    void load();
  }, [user, load]);

  const act = async (run: () => Promise<{ ok: true; data: any } | { ok: false; status: number; error: string }>, done: string) => {
    setBusy(true);
    setSaid(null);
    const answer = await run();
    if (answer.ok) {
      const message = typeof answer.data?.message === "string" ? answer.data.message : done;
      setSaid({ ok: true, text: message });
      await load();
    } else {
      setSaid({ ok: false, text: answer.error });
    }
    setBusy(false);
  };

  if (modules.loaded && !governance) {
    return <ModuleGate moduleId="governance" name="Seat applications" behind={PAGE_GATE_LINES.propose} />;
  }

  // "Record the adoption", once the circle has consented to a role proposal (role proposals PR D).
  const record = app?.proposal?.consent?.record ?? null;

  const back = (
    <Link
      href="/decisions"
      className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-stone-600 hover:text-teal-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
    >
      <ArrowLeft className="w-4 h-4" aria-hidden="true" />
      Every decision
    </Link>
  );

  if (!user || state === "members") {
    return (
      <Layout>
        <div className="container max-w-3xl px-4 py-8">
          {back}
          <div className="mt-6 rounded-xl border border-stone-200 bg-white p-8 text-center">
            <h1 className="font-display text-2xl font-bold text-stone-900">{APPLICATION_WORDS.membersOnly}</h1>
            <p className="mx-auto mt-2 max-w-md text-stone-600 leading-relaxed">{APPLICATION_WORDS.membersOnlyLine}</p>
            {!user && (
              <div className="mt-5">
                <SignInDoors next={`/role-applications/${encodeURIComponent(id)}`} />
              </div>
            )}
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container max-w-3xl px-4 py-8">
        {back}
        {state === "loading" && (
          <div className="flex justify-center py-16">
            <BreathingLoader label="Reading the application" />
          </div>
        )}
        {state === "missing" && <p className="mt-6 text-stone-700">There is no application at this address.</p>}
        {state === "error" && (
          <p role="alert" className="mt-6 text-coral">
            {error}
          </p>
        )}
        {state === "ready" && app && (
          <article className="mt-3 space-y-8">
            <header>
              <p className="text-sm font-semibold text-teal-deep">{app.statusWords}</p>
              <h1 className="mt-1 font-display text-3xl font-bold text-stone-900">
                {app.candidate.name ?? "A former member"} applies for {seatList(app.seats.map((s) => s.name))}
              </h1>
              <p className="mt-2 text-stone-600 leading-relaxed">
                {app.term.followsSeason
                  ? `Until the season ends on ${civilDayWords(app.term.endsOn)}.`
                  : `Until ${civilDayWords(app.term.endsOn)}.`}
                {app.startsOn ? ` From ${civilDayWords(app.startsOn)} at the earliest.` : ""}
              </p>
            </header>

            <ApplicationCard app={app} />

            {/* THE WORDS EVERY PARTY ALIGNS WITH (PR5), as stored, with the parties' chips and, for a party, Align. */}
            {app.alignment && <AlignmentCard alignment={app.alignment} applicationId={app.id} onChanged={() => void load()} />}
            {app.supersedesId && (
              <p className="text-sm text-stone-700">
                {APPLICATION_WORDS.amends}{" "}
                <a href={applicationHref(app.supersedesId)} className="inline-flex min-h-11 items-center font-semibold text-teal-deep underline underline-offset-2">
                  {APPLICATION_WORDS.readEarlier}
                </a>
              </p>
            )}

            <section aria-labelledby="sa-words">
              <h2 id="sa-words" className="text-lg font-bold text-stone-900">
                {APPLICATION_WORDS.wordsHeading}
              </h2>
              {app.deliverables || app.note ? (
                <dl className="mt-3 space-y-4">
                  {app.deliverables && (
                    <div>
                      <dt className="text-sm font-semibold text-stone-700">{APPLICATION_WORDS.deliverables}</dt>
                      <dd className="mt-1 whitespace-pre-wrap text-stone-900">{app.deliverables}</dd>
                    </div>
                  )}
                  {app.note && (
                    <div>
                      <dt className="text-sm font-semibold text-stone-700">{APPLICATION_WORDS.why}</dt>
                      <dd className="mt-1 whitespace-pre-wrap text-stone-900">{app.note}</dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="mt-2 text-stone-600">{APPLICATION_WORDS.wordsRemoved}</p>
              )}
            </section>

            {/* A role proposal: where the circle's consent stands, and an asked holder's Consent or Object (PR D). */}
            {app.proposal?.consent && (
              <CircleConsent
                applicationId={app.id}
                consent={app.proposal.consent}
                decided={app.proposal.decided}
                waiting={app.status === "awaiting-holder"}
                onAnswered={() => void load()}
              />
            )}

            {/* Who adopts it in this village, read on the server from who holds the power (E8). */}
            {app.status === "awaiting-holder" && app.whoAdopts && (
              <p className="text-sm text-stone-700" data-who-adopts="">
                {app.whoAdopts}
              </p>
            )}

            {app.status === "voting" && app.ballotId && (
              <section className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                <p className="text-stone-800">{app.carried ? `${app.statusWords}.` : APPLICATION_WORDS.votingLine}</p>
                <Link
                  href={`/decisions/${app.ballotId}`}
                  className="mt-2 inline-flex min-h-[44px] items-center font-semibold text-teal-deep hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
                >
                  {APPLICATION_WORDS.readTheVote}
                </Link>
              </section>
            )}
            {app.status === "adopted" && app.startsOn && <p className="text-stone-700">{APPLICATION_WORDS.laterLine}</p>}

            {app.you && app.status === "awaiting-holder" && app.you.holdsThePower && (
              <section aria-labelledby="sa-holder" className="rounded-xl border-2 border-teal-deep/40 bg-white p-5">
                <h2 id="sa-holder" className="text-lg font-bold text-stone-900">
                  {APPLICATION_WORDS.holderHeading}
                </h2>
                {app.you.isCandidate ? (
                  <p className="mt-1 text-stone-700">{APPLICATION_WORDS.ownTerms}</p>
                ) : (
                  <p className="mt-1 text-stone-700">
                    {record ? CONSENT_WORDS.recordLine : app.proposal?.changesRoles ? APPLICATION_WORDS.powerLine : APPLICATION_WORDS.holderLine}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {app.you.mayAdopt && (
                    // The holder's adopt click IS the village's alignment. Money terms may ask the re-confirm first.
                    // Once the circle has consented, the same click records the adoption (role proposals PR D).
                    <AlignButton
                      label={record ?? ALIGN_WORDS.forTheVillage}
                      sentence={intentSentence(app.seats.map((x) => x.name), true)}
                      disabled={busy}
                      onAlign={() => alignCall<any>(`/api/governance/role-applications/${encodeURIComponent(app.id)}/adopt`, "POST")}
                      onDone={(data) => {
                        // A role proposal answers with its decision record, which names a role, never a person.
                        const text = typeof data?.decided === "string" ? data.decided : typeof data?.message === "string" ? data.message : "Adopted for the village.";
                        setSaid({ ok: true, text });
                        void load();
                      }}
                    />
                  )}
                  {app.you.mayPutToVillage && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void act(() => putApplicationToVillage(app.id), "The village is voting on it now.")}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-stone-400 px-5 text-sm font-semibold text-stone-800 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
                    >
                      <Send className="w-4 h-4" aria-hidden="true" />
                      {APPLICATION_WORDS.putToVillage}
                    </button>
                  )}
                </div>
              </section>
            )}

            {app.you?.mayWithdraw && !asking && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setAsking(true)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-4 text-sm font-medium text-stone-700 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep disabled:opacity-50"
              >
                <Undo2 className="w-4 h-4" aria-hidden="true" />
                {APPLICATION_WORDS.withdraw}
              </button>
            )}
            {app.you?.mayWithdraw && asking && (
              <div role="group" aria-label={APPLICATION_WORDS.withdraw} className="rounded-xl border border-stone-300 bg-white p-4">
                <p className="text-stone-800">{APPLICATION_WORDS.withdrawAsk}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setAsking(false);
                      void act(() => withdrawApplication(app.id), "Withdrawn.");
                    }}
                    className="inline-flex min-h-[44px] items-center rounded-lg bg-coral px-4 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep disabled:opacity-50"
                  >
                    {APPLICATION_WORDS.withdrawYes}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAsking(false)}
                    className="inline-flex min-h-[44px] items-center rounded-lg border border-stone-300 px-4 text-sm font-medium text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
                  >
                    {APPLICATION_WORDS.withdrawNo}
                  </button>
                </div>
              </div>
            )}

            {said && (
              <p role={said.ok ? "status" : "alert"} className={`text-sm font-medium ${said.ok ? "text-sage" : "text-coral"}`}>
                {said.text}
              </p>
            )}
          </article>
        )}
      </div>
    </Layout>
  );
}
