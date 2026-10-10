/**
 * `/seat-applications/:id`: ONE APPLICATION TO HOLD SEATS, ON TERMS (seat settings PR4).
 *
 * Members only. The read behind it answers 401 to a visitor and to a signed-in
 * guest (terms.read opens at the member rung), and this page says so in a
 * sentence rather than as an error.
 *
 * What a member reads, in the order they ask it:
 *
 *   WHICH SEATS, ON WHAT TERMS   each seat as its live card, stacked, with the
 *                                Settings drawer OPEN on the application's terms
 *   IN THE MEMBER'S WORDS        what will be true at the season's end, and why them
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
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, Check, Send, Undo2 } from "lucide-react";
import Layout from "@/components/Layout";
import ModuleGate, { SignInDoors } from "@/components/modules/ModuleGate";
import { PAGE_GATE_LINES } from "@/components/modules/gateCopy";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { useAuth } from "@/contexts/AuthContext";
import { BreathingLoader } from "@/components/natural";
import SeatTradingCard from "@/components/power/SeatTradingCard";
import SeatTermsDrawer from "@/components/power/SeatTermsDrawer";
import { loadOrg } from "@/components/governance/pickSources";
import {
  adoptApplication,
  fetchApplication,
  putApplicationToVillage,
  withdrawApplication,
  type ServedApplication,
} from "@/components/governance/seatApplicationsApi";
import { useSeason } from "@/lib/gameApi";
import { useVillagePresets } from "@/lib/seatPresetsRead";
import { fromOrgSeat, seasonForSheet } from "@shared/roleSheetInputs";
import { parseSeatSettings } from "@shared/seatSettings";
import { seatList } from "@shared/seatApplications";

export const APPLICATION_WORDS = {
  membersOnly: "Members read seat applications.",
  membersOnlyLine: "An application carries its terms, money included, so it opens at the member rung.",
  signIn: "Sign in to read this application",
  wordsHeading: "In their words",
  deliverables: "By the end of the season",
  why: "Why them",
  wordsRemoved: "These words were removed at the member's request.",
  holderHeading: "For the village",
  holderLine: "You hold the power that seats people. Adopt it for the village, or send it to the village to decide.",
  ownTerms: "Your own terms go to the village to adopt.",
  align: "Align for the village",
  putToVillage: "Put it to the village",
  withdraw: "Withdraw my application",
  votingLine: "The village is voting on this application.",
  readTheVote: "Read the vote",
  laterLine: "Adopted. The seats are taken up on the first day it names.",
} as const;

function SeatCards({ app }: { app: ServedApplication }) {
  const [org, setOrg] = useState<any | null>(null);
  const season = useSeason();
  const villagePresets = useVillagePresets();
  useEffect(() => {
    let alive = true;
    void loadOrg().then((o) => {
      if (alive) setOrg(o);
    });
    return () => {
      alive = false;
    };
  }, []);
  const parsed = parseSeatSettings(app.settings);
  const roles: any[] = Array.isArray(org?.roles) ? org.roles : [];
  const adopted =
    app.status === "adopted" && app.decidedAt
      ? {
          how: app.adoptedVia === "holder" ? ("holder" as const) : ("vote" as const),
          holderName: app.adoptedBy,
          on: app.decidedAt.slice(0, 10),
          href: app.adoptedVia === "ballot" && app.ballotId ? `/decisions/${app.ballotId}` : null,
        }
      : null;
  return (
    <ul className="space-y-6">
      {app.seats.map((seat) => {
        const row = roles.find((r) => String(r?.id ?? "") === seat.id);
        return (
          <li key={seat.id}>
            {row ? (
              <SeatTradingCard
                input={{ ...fromOrgSeat(row, org?.circles, org?.people, org?.village), mode: "proposal" as const }}
                ctx={{ now: new Date(), season: seasonForSheet(season), classNames: null }}
                faces="stacked"
                settings={
                  <SeatTermsDrawer
                    settings={parsed.ok ? parsed.settings : null}
                    unreadable={!parsed.ok}
                    villagePresets={villagePresets}
                    adopted={adopted}
                    defaultOpen
                  />
                }
              />
            ) : (
              <div className="sheet-night rounded-xl bg-card p-4 text-foreground">
                <p className="font-display text-lg font-bold">{seat.name}</p>
                {seat.aim && <p className="mt-1 text-sm text-muted-foreground">{seat.aim}</p>}
                <div className="mt-3">
                  <SeatTermsDrawer
                    settings={parsed.ok ? parsed.settings : null}
                    unreadable={!parsed.ok}
                    villagePresets={villagePresets}
                    adopted={adopted}
                    defaultOpen
                  />
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
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
                <SignInDoors next={`/seat-applications/${encodeURIComponent(id)}`} />
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
                {app.term.followsSeason ? `Until the season ends on ${app.term.endsOn}.` : `Until ${app.term.endsOn}.`}
                {app.startsOn ? ` From ${app.startsOn} at the earliest.` : ""}
              </p>
            </header>

            <SeatCards app={app} />

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

            {app.status === "voting" && app.ballotId && (
              <section className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                <p className="text-stone-800">{APPLICATION_WORDS.votingLine}</p>
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
                  <p className="mt-1 text-stone-700">{APPLICATION_WORDS.holderLine}</p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {app.you.mayAdopt && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void act(() => adoptApplication(app.id), "Adopted for the village.")}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-teal-deep px-5 text-sm font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2 disabled:opacity-50"
                    >
                      <Check className="w-4 h-4" aria-hidden="true" />
                      {APPLICATION_WORDS.align}
                    </button>
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

            {app.you?.mayWithdraw && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void act(() => withdrawApplication(app.id), "Withdrawn.")}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-4 text-sm font-medium text-stone-700 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep disabled:opacity-50"
              >
                <Undo2 className="w-4 h-4" aria-hidden="true" />
                {APPLICATION_WORDS.withdraw}
              </button>
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
