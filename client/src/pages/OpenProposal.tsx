/**
 * `/open-proposals/:id`: ONE ROLE PROPOSAL FROM SOMEBODY WITH NO ACCOUNT YET
 * (open proposals part B). The server is server/routes/openProposalDecide.ts
 * and every sentence is shared/openProposalDecide.ts.
 *
 * Members only, as an application's page is: the read answers 401 to a visitor
 * and to a signed-in guest, and this page says so in a sentence. It reaches
 * members from the task board ("Waiting on you" and "Asked to consent"), from
 * the bell, and from the admin desk's list of confirmed proposals.
 *
 * What a member reads, in the order they ask it:
 *
 *   WHO AND WHICH ROLES   the proposer by first name (never their address),
 *                         the roles with their circles, and what the person
 *                         brings to each
 *   IN THEIR WORDS        why them, and their aim for the season
 *   THE CIRCLE'S ANSWER   where consent stands, and an asked holder's Consent
 *                         or Object (CircleConsent.tsx, the member proposals'
 *                         own panel, posting to this proposal's route)
 *   FOR THE VILLAGE       a live holder of the power that seats people adopts
 *                         it or declines it. After an adoption with no account
 *                         behind the address, the invitation's link is shown
 *                         with whether it went, and can be made again while
 *                         nobody has used it. Once the village holds the power,
 *                         or nobody holds it, the card says so and offers nothing.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, Check, Copy, Mail, X } from "lucide-react";
import { toast } from "sonner";
import Layout from "@/components/Layout";
import ModuleGate, { SignInDoors } from "@/components/modules/ModuleGate";
import { PAGE_GATE_LINES } from "@/components/modules/gateCopy";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { useAuth } from "@/contexts/AuthContext";
import { BreathingLoader } from "@/components/natural";
import CircleConsent from "@/components/roleProposal/CircleConsent";
import type { ConsentAnswerOut, ConsentOut } from "@/components/roleProposal/proposalApi";
import { gameFetch } from "@/lib/gameApi";
import { DECIDE_WORDS, type DoorReason } from "@shared/openProposalDecide";
import { CONSENT_WORDS, type ConsentAnswer } from "@shared/roleProposalConsent";
import { civilDayWords } from "@shared/seasonPlans";

/** One proposal as the page reads it (`GET /api/governance/open-proposals/:id`). */
export interface ServedOpenProposal {
  id: string;
  href: string;
  status: "confirmed" | "adopted" | "declined" | "withdrawn";
  statusWords: string;
  proposer: string | null;
  season: { id: string; name: string | null; startsOn: string } | null;
  roles: Array<{ id: string; name: string | null; circle: string | null; note: string }>;
  why: string;
  aim: string;
  confirmedOn: string | null;
  decidedOn: string | null;
  decided: string | null;
  consent: ConsentOut;
  door: { because: DoorReason; words: string };
  invitation: { state: "open" | "used" | "closed" } | null;
  you: { holdsThePower: boolean; own: boolean; mayAdopt: boolean; mayDecline: boolean; mayReissue: boolean };
}

type Answer<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

const base = (id: string) => `/api/governance/open-proposals/${encodeURIComponent(id)}`;

/** One call with the member's token, answering the server's own sentence when it refuses. */
async function ask<T>(path: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<Answer<T>> {
  try {
    const res = await gameFetch(path, { method, cache: "no-store", ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}) });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, error: String(data?.message ?? data?.error ?? DECIDE_WORDS.failed) };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: 0, error: DECIDE_WORDS.failed };
  }
}

const PRIMARY =
  "inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-teal-deep px-5 text-sm font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2 disabled:opacity-50";
const SECONDARY =
  "inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-stone-400 px-5 text-sm font-semibold text-stone-800 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep disabled:opacity-50";

/** What a decision answered: its sentence, and the invitation's link when there is one to hand on. */
interface Said {
  ok: boolean;
  text: string;
  link?: string | null;
}

export default function OpenProposal() {
  const params = useParams<{ id: string }>();
  const id = String(params.id ?? "");
  const { user } = useAuth();
  const modules = useModules();
  const governance = useModule("governance");
  const [p, setP] = useState<ServedOpenProposal | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "members" | "missing" | "error">("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);
  // Decline asks once before it acts.
  const [declining, setDeclining] = useState(false);

  const load = useCallback(async () => {
    const answer = await ask<{ proposal: ServedOpenProposal }>(base(id));
    if (answer.ok) {
      setP(answer.data.proposal);
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

  const act = async (path: string) => {
    setBusy(true);
    setSaid(null);
    const answer = await ask<{ message?: string; invitation?: { link: string } | null; link?: string }>(path, "POST");
    setBusy(false);
    if (!answer.ok) {
      setSaid({ ok: false, text: answer.error });
      return;
    }
    const link = answer.data.invitation?.link ?? answer.data.link ?? null;
    setSaid({ ok: true, text: String(answer.data.message ?? ""), link });
    await load();
  };

  const answerConsent = async (answer: ConsentAnswer, reason?: string) => {
    const out = await ask<ConsentAnswerOut>(`${base(id)}/consent`, "POST", answer === "object" ? { answer, reason } : { answer });
    return out.ok ? out : { ok: false as const, error: out.error };
  };

  if (modules.loaded && !governance) {
    return <ModuleGate moduleId="governance" name="Role proposals" behind={PAGE_GATE_LINES.propose} />;
  }

  const back = (
    <Link
      href="/profile"
      className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-stone-600 hover:text-teal-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
    >
      <ArrowLeft className="w-4 h-4" aria-hidden="true" />
      Your profile
    </Link>
  );

  if (!user || state === "members") {
    return (
      <Layout>
        <div className="container max-w-3xl px-4 py-8">
          {back}
          <div className="mt-6 rounded-xl border border-stone-200 bg-white p-8 text-center">
            <h1 className="font-display text-2xl font-bold text-stone-900">{DECIDE_WORDS.membersOnly}</h1>
            <p className="mx-auto mt-2 max-w-md leading-relaxed text-stone-600">{DECIDE_WORDS.membersOnlyLine}</p>
            {!user && (
              <div className="mt-5">
                <SignInDoors next={`/open-proposals/${encodeURIComponent(id)}`} />
              </div>
            )}
          </div>
        </div>
      </Layout>
    );
  }

  const record = p?.consent.record ?? null;

  return (
    <Layout>
      <div className="container max-w-3xl px-4 py-8">
        {back}
        {state === "loading" && (
          <div className="flex justify-center py-16">
            <BreathingLoader label={DECIDE_WORDS.loading} />
          </div>
        )}
        {state === "missing" && <p className="mt-6 text-stone-700">{DECIDE_WORDS.missing}</p>}
        {state === "error" && (
          <p role="alert" className="mt-6 text-coral">
            {error || DECIDE_WORDS.loadFailed}
          </p>
        )}
        {state === "ready" && p && (
          <article className="mt-3 space-y-8" data-open-proposal={p.status}>
            <header>
              <p className="text-sm font-semibold text-teal-deep">{p.statusWords}</p>
              <h1 className="mt-1 font-display text-3xl font-bold text-stone-900">
                {DECIDE_WORDS.heading(p.proposer, p.roles.map((r) => r.name ?? DECIDE_WORDS.roleGone))}
              </h1>
              <p className="mt-2 leading-relaxed text-stone-600">
                {DECIDE_WORDS.fromOutside}
                {p.season ? ` ${p.season.name ?? "The season"} starts on ${civilDayWords(p.season.startsOn)}.` : ""}
              </p>
            </header>

            <section aria-labelledby="op-roles">
              <h2 id="op-roles" className="text-lg font-bold text-stone-900">
                {DECIDE_WORDS.rolesHeading}
              </h2>
              <ul className="mt-3 space-y-3">
                {p.roles.map((r) => (
                  <li key={r.id} className="rounded-xl border border-stone-200 bg-white p-4">
                    <p className="font-semibold text-stone-900">
                      {r.name ?? DECIDE_WORDS.roleGone}
                      {r.circle && <span className="font-normal text-stone-600"> · {r.circle}</span>}
                    </p>
                    {r.note && <p className="mt-1 whitespace-pre-wrap break-words text-stone-800">{r.note}</p>}
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="op-words">
              <h2 id="op-words" className="text-lg font-bold text-stone-900">
                {DECIDE_WORDS.wordsHeading}
              </h2>
              <dl className="mt-3 space-y-4">
                <div>
                  <dt className="text-sm font-semibold text-stone-700">{DECIDE_WORDS.why}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words text-stone-900">{p.why}</dd>
                </div>
                {p.aim && (
                  <div>
                    <dt className="text-sm font-semibold text-stone-700">{DECIDE_WORDS.aim}</dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words text-stone-900">{p.aim}</dd>
                  </div>
                )}
              </dl>
            </section>

            {/* The circle's answer while it waits and once adopted. A declined one has no adoption to record, and its line says so above. */}
            {(p.status === "confirmed" || p.status === "adopted") && (
              <CircleConsent
                applicationId={p.id}
                consent={p.consent}
                decided={p.status === "adopted" ? p.decided : null}
                waiting={p.status === "confirmed"}
                onAnswered={() => void load()}
                answer={answerConsent}
              />
            )}

            {p.status === "confirmed" && (
              <section aria-labelledby="op-decide" className="rounded-xl border-2 border-teal-deep/40 bg-white p-5" data-decider-card="">
                <h2 id="op-decide" className="text-lg font-bold text-stone-900">
                  {DECIDE_WORDS.deciderHeading}
                </h2>
                {p.you.mayAdopt ? (
                  <>
                    <p className="mt-1 text-stone-700">{record ? CONSENT_WORDS.recordLine : DECIDE_WORDS.deciderLine}</p>
                    {!declining ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button type="button" disabled={busy} onClick={() => void act(`${base(p.id)}/adopt`)} className={PRIMARY}>
                          <Check className="h-4 w-4" aria-hidden="true" />
                          {record ?? DECIDE_WORDS.adopt}
                        </button>
                        {p.you.mayDecline && (
                          <button type="button" disabled={busy} onClick={() => setDeclining(true)} className={SECONDARY}>
                            <X className="h-4 w-4" aria-hidden="true" />
                            {DECIDE_WORDS.decline}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div role="group" aria-label={DECIDE_WORDS.decline} className="mt-4 rounded-xl border border-stone-300 bg-white p-4">
                        <p className="text-stone-800">{DECIDE_WORDS.declineAsk}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setDeclining(false);
                              void act(`${base(p.id)}/decline`);
                            }}
                            className="inline-flex min-h-[44px] items-center rounded-lg bg-coral px-4 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep disabled:opacity-50"
                          >
                            {DECIDE_WORDS.declineYes}
                          </button>
                          <button type="button" onClick={() => setDeclining(false)} className={SECONDARY}>
                            {DECIDE_WORDS.declineNo}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-stone-700" data-door={p.door.because}>
                    {p.you.own ? DECIDE_WORDS.ownProposal : p.door.words}
                  </p>
                )}
              </section>
            )}

            {p.status === "adopted" && p.invitation && (
              <section aria-labelledby="op-invitation" className="rounded-xl border border-stone-200 bg-white p-5" data-invitation={p.invitation.state}>
                <h2 id="op-invitation" className="text-lg font-bold text-stone-900">
                  {DECIDE_WORDS.deciderHeading}
                </h2>
                {p.invitation.state === "used" ? (
                  <p className="mt-1 text-stone-700">{DECIDE_WORDS.invitationUsed}</p>
                ) : (
                  <>
                    <p className="mt-1 text-stone-700">{DECIDE_WORDS.reissueLine}</p>
                    {p.you.mayReissue && (
                      <button type="button" disabled={busy} onClick={() => void act(`${base(p.id)}/invitation`)} className={`${SECONDARY} mt-3`}>
                        <Mail className="h-4 w-4" aria-hidden="true" />
                        {DECIDE_WORDS.reissue}
                      </button>
                    )}
                  </>
                )}
              </section>
            )}

            {said && (
              <div role={said.ok ? "status" : "alert"} className="space-y-2" data-decision-said="">
                <p className={`text-sm font-medium ${said.ok ? "text-sage" : "text-coral"}`}>{said.text}</p>
                {said.link && (
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="min-w-0 break-all rounded bg-stone-50 px-2 py-1 text-sm text-stone-800">{said.link}</code>
                    <button
                      type="button"
                      className={SECONDARY}
                      onClick={() =>
                        void navigator.clipboard?.writeText(said.link as string).then(
                          () => toast.success(DECIDE_WORDS.copied),
                          () => toast.error(DECIDE_WORDS.failed),
                        )
                      }
                    >
                      <Copy className="h-4 w-4" aria-hidden="true" />
                      {DECIDE_WORDS.copy}
                    </button>
                  </div>
                )}
              </div>
            )}
          </article>
        )}
      </div>
    </Layout>
  );
}
