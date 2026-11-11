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
import { AboutYouView, type ServedAboutYou } from "@/components/openProposal/AboutYou";
import { AttachedView, type ServedAttachments } from "@/components/openProposal/ProposalAttachments";
import { useLingui } from "@lingui/react/macro";
import { APPLICANT_NOTE_MAX } from "@shared/applicantWords";
import { CardSideBySide } from "@/components/openProposal/RoleCardBridge";
import DecideDock from "@/components/openProposal/DecideDock";
import TermsWeOffer, { OpenTalksWarning, type ServedDeciderOffer } from "@/components/openProposal/TermsWeOffer";
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
import ReviewPanel from "@/components/review/ReviewPanel";
import type { ConsentAnswerOut, ConsentOut } from "@/components/roleProposal/proposalApi";
import { gameFetch } from "@/lib/gameApi";
import { DECIDE_WORDS, DOOR, type DoorReason } from "@shared/openProposalDecide";
import { CONSENT_WORDS, type ConsentAnswer } from "@shared/roleProposalConsent";
import { civilDayWords } from "@shared/seasonPlans";
import { WORLD } from "@/components/journey/look";

/** One proposal as the page reads it (`GET /api/governance/open-proposals/:id`). */
export interface ServedOpenProposal {
  id: string;
  href: string;
  status: "confirmed" | "adopted" | "declined" | "withdrawn";
  statusWords: string;
  proposer: string | null;
  season: { id: string; name: string | null; startsOn: string } | null;
  /** Set when the proposal is for a moon (shared/openProposalTerm.ts). */
  term?: { kind: "moon"; startsOn: string; endsOn: string } | null;
  roles: Array<{ id: string; name: string | null; circle: string | null; note: string; accountabilities?: string[]; commitmentPct?: number | null }>;
  /** The applicant's own role card (shared/openProposalCard.ts); null on a proposal sent before cards. */
  card?: Parameters<typeof CardSideBySide>[0]["card"];
  /** The membership letter, aligned with at application or from their account (Rye's answer 8). */
  membership?: { aligned: boolean };
  why: string;
  aim: string;
  confirmedOn: string | null;
  decidedOn: string | null;
  decided: string | null;
  consent: ConsentOut;
  door: { because: DoorReason; words: string };
  invitation: { state: "open" | "used" | "closed"; sentAt?: string | null; emailed?: boolean | null } | null;
  /** Links and files, sent to the people who decide it and nobody else (Rye, 10 Nov 2026). */
  attached?: ServedAttachments | null;
  /** About you: references, facts and the check, for the deciders only. */
  aboutYou?: ServedAboutYou | null;
  /** The terms we offer, with the history: deciders only. */
  offer?: ServedDeciderOffer | null;
  /** What is left before Adopt, for a decider (audit M10, B3): conversations not written up, roles with every seat taken. */
  beforeAdopt?: {
    conversations: Array<{ roleId: string; role: string; unheld: boolean; words: string }>;
    seatsFull: Array<{ name: string; seats: number; taken: number }>;
    seatsWords: string | null;
  } | null;
  /** An agent proposed by its keeper (0374): what it is, who keeps it, its reach and how to switch it off. */
  agent?: ServedAgent | null;
  /** Our review (Phase A): where it stands, and the conversations an invitation opens, in order (deciders only). */
  review?: { stage: "review" | "invited" | "not_invited"; conversations: Array<{ role: string; minutes: number }> } | null;
  you: { mayEditTerms?: boolean; holdsThePower: boolean; own: boolean; mayAdopt: boolean; mayDecline: boolean; mayReview?: boolean; mayReissue: boolean; formerMember?: boolean };
}

export interface ServedAgent {
  name: string;
  what: string;
  keeper: string | null;
  reach: Array<{ scope: string; words: string }>;
  stillAnAgent: boolean;
  switchOff: string;
  switchOffPlatform: string;
}

/** The page's heading for an agent's proposal: the agent never proposes itself, its keeper does. */
function AgentHeading({ name, roles }: { name: string; roles: string }) {
  const { t } = useLingui();
  return <>{t({ message: `${name}, an agent, proposed by its keeper for ${roles}`, context: "open proposal: an agent's proposal heading" })}</>;
}

/** The agent's own parts, in place of a person's About you (0374). Read from the proposal and the agent's live tokens. */
function AgentView({ agent }: { agent: ServedAgent }) {
  const { t } = useLingui();
  return (
    <section aria-labelledby="op-agent" className="rounded-xl border border-border bg-card p-4" data-testid="op-agent">
      <h2 id="op-agent" className="text-lg font-bold text-foreground">
        {t({ message: "The agent", context: "open proposal: an agent's proposal" })}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t({ message: "Proposed by the member who keeps it. The circle decides by consent, as for a person.", context: "open proposal: an agent's proposal" })}
      </p>
      <dl className="mt-3 space-y-4">
        <div>
          <dt className="text-sm font-semibold text-muted-foreground">{t({ message: "What it is", context: "open proposal: an agent's proposal" })}</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words text-foreground">{agent.what}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted-foreground">{t({ message: "Who keeps it", context: "open proposal: an agent's proposal" })}</dt>
          <dd className="mt-1 text-foreground">{agent.keeper ?? t({ message: "A member", context: "open proposal: an agent's keeper with no name" })}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted-foreground">{t({ message: "What it can reach", context: "open proposal: an agent's proposal" })}</dt>
          <dd className="mt-1 text-foreground">
            {!agent.stillAnAgent ? (
              t({ message: "This account is no longer marked as an agent's, so it cannot be seated.", context: "open proposal: an agent's proposal" })
            ) : agent.reach.length ? (
              <ul className="list-disc space-y-0.5 pl-5">
                {agent.reach.map((x) => (
                  <li key={x.scope}>{x.words}</li>
                ))}
              </ul>
            ) : (
              t({ message: "It holds no live access token, so it reaches nothing through the village's connector today.", context: "open proposal: an agent's proposal" })
            )}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-muted-foreground">{t({ message: "How to switch it off", context: "open proposal: an agent's proposal" })}</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words text-foreground">{agent.switchOff}</dd>
          <dd className="mt-1 text-sm text-muted-foreground">{agent.switchOffPlatform}</dd>
        </div>
      </dl>
    </section>
  );
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
  "inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-teal-deep px-5 text-sm font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50";
const SECONDARY =
  "inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-border px-5 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/** What a decision answered: its sentence, and the invitation's link when there is one to hand on. */
interface Said {
  ok: boolean;
  text: string;
  link?: string | null;
}

export default function OpenProposal() {
  const { t } = useLingui();
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
  // The not-invited letter asks once before it goes.
  const [notInviting, setNotInviting] = useState(false);
  // A note for the applicant, sent with an adoption or a decline.
  const [note, setNote] = useState("");
  // Adopting while a setting is still being talked about asks once more (joining lane PR 4).
  const [knowsOpenTalks, setKnowsOpenTalks] = useState(false);
  // Every seat taken: adopting is for when a seat opens, chosen on purpose (audit B3).
  const [forASeat, setForASeat] = useState(false);

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

  const act = async (path: string, body?: Record<string, unknown>, withNote = false) => {
    setBusy(true);
    setSaid(null);
    const payload = { ...(body ?? {}), ...(withNote && note.trim() ? { note: note.trim() } : {}) };
    const answer = await ask<{ message?: string; invitation?: { link: string } | null; link?: string }>(path, "POST", Object.keys(payload).length ? payload : undefined);
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
      className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-notice focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="w-4 h-4" aria-hidden="true" />
      Your profile
    </Link>
  );

  if (!user || state === "members") {
    return (
      <Layout><div className={WORLD}>
        <div className="container max-w-3xl px-4 py-8">
          {back}
          <div className="mt-6 rounded-xl border border-border bg-card p-8 text-center">
            <h1 className="font-display text-2xl font-bold text-foreground">{DECIDE_WORDS.membersOnly}</h1>
            <p className="mx-auto mt-2 max-w-md leading-relaxed text-muted-foreground">{DECIDE_WORDS.membersOnlyLine}</p>
            {!user && (
              <div className="mt-5">
                <SignInDoors next={`/open-proposals/${encodeURIComponent(id)}`} />
              </div>
            )}
          </div>
        </div>
      </div></Layout>
    );
  }

  const record = p?.consent.record ?? null;
  // Adopt waits on open talks not yet acknowledged, conversations still open, or a full role not chosen on purpose.
  const adoptWaits = !!p && ((!!p.offer?.openTalks.length && !knowsOpenTalks && !p.agent) || !!p.beforeAdopt?.conversations.length || (!!p.beforeAdopt?.seatsFull.length && !forASeat));
  // On a wide screen the decision sits in a panel beside the proposal, held in view while the steward reads (lead, 11 Nov 2026).
  const side = state === "ready" && !!p && (p.status === "confirmed" || (p.status === "adopted" && !!p.invitation) || !!said);

  return (
    <Layout><div className={WORLD}>
      <div className={`container max-w-3xl px-4 py-8${side ? " lg:max-w-6xl" : ""}`}>
        {back}
        {state === "loading" && (
          <div className="flex justify-center py-16">
            <BreathingLoader label={DECIDE_WORDS.loading} />
          </div>
        )}
        {state === "missing" && <p className="mt-6 text-foreground">{DECIDE_WORDS.missing}</p>}
        {state === "error" && (
          <p role="alert" className="mt-6 text-destructive">
            {error || DECIDE_WORDS.loadFailed}
          </p>
        )}
        {state === "ready" && p && (
          <article className={`mt-3${side ? " lg:grid lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start lg:gap-10" : ""}`} data-open-proposal={p.status}>
            <div className="min-w-0 space-y-8">
            <header>
              <p className="text-sm font-semibold text-notice">{p.statusWords}</p>
              <h1 className="mt-1 font-display text-3xl font-bold text-foreground">
                {p.agent
                  ? <AgentHeading name={p.agent.name} roles={p.roles.map((r) => r.name ?? DECIDE_WORDS.roleGone).join(", ")} />
                  : DECIDE_WORDS.heading(p.proposer, p.roles.map((r) => r.name ?? DECIDE_WORDS.roleGone), !!p.term)}
              </h1>
              <p className="mt-2 leading-relaxed text-muted-foreground">
                {p.agent ? (
                  t({ message: "An agent, proposed by the member who keeps it. Adopted, it is seated on these roles at once, marked as an agent, with its keeper beside it.", context: "open proposal: an agent's proposal" })
                ) : p.term ? (
                  DECIDE_WORDS.fromOutsideMoon(civilDayWords(p.term.startsOn), civilDayWords(p.term.endsOn))
                ) : (
                  <>
                    {DECIDE_WORDS.fromOutside}
                    {p.season ? ` ${p.season.name ?? "The season"} starts on ${civilDayWords(p.season.startsOn)}.` : ""}
                  </>
                )}
              </p>
            </header>

            {p.agent && <AgentView agent={p.agent} />}

            <section aria-labelledby="op-roles">
              <h2 id="op-roles" className="text-lg font-bold text-foreground">
                {DECIDE_WORDS.rolesHeading}
              </h2>
              <ul className="mt-3 space-y-3">
                {p.roles.map((r) => (
                  <li key={r.id} className="rounded-xl border border-border bg-card p-4">
                    <p className="font-semibold text-foreground">
                      {r.name ?? DECIDE_WORDS.roleGone}
                      {r.circle && <span className="font-normal text-muted-foreground"> · {r.circle}</span>}
                    </p>
                    {r.note && <p className="mt-1 whitespace-pre-wrap break-words text-foreground">{r.note}</p>}
                  </li>
                ))}
              </ul>
            </section>
            {/* The two cards side by side, gaps named (Rye, 9 Nov 2026; components/openProposal/RoleCardBridge.tsx). */}
            {!p.agent && <section aria-labelledby="op-cards" className="grid gap-3">
              <h2 id="op-cards" className="text-lg font-bold text-foreground">
                {t({ message: "Their card beside the open card", context: "open proposal side by side" })}
              </h2>
              <CardSideBySide roles={p.roles} card={p.card ?? null} membershipAligned={!!p.membership?.aligned} />
            </section>}

            {/* An agent is offered no pay, allowance or commitment (verify B153, B8): a person's terms never show for one. */}
            {p.offer && !p.agent && <TermsWeOffer offer={p.offer} mayEdit={!!p.you.mayEditTerms} savePath={`${base(p.id)}/terms`} onSaved={() => void load()} />}

            <section aria-labelledby="op-words">
              <h2 id="op-words" className="text-lg font-bold text-foreground">
                {DECIDE_WORDS.wordsHeading}
              </h2>
              <dl className="mt-3 space-y-4">
                <div>
                  <dt className="text-sm font-semibold text-foreground">{p.agent ? t({ message: "Why this agent, in its keeper's words", context: "open proposal: an agent's proposal" }) : DECIDE_WORDS.why}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words text-foreground">{p.why}</dd>
                </div>
                {p.aim && (
                  <div>
                    <dt className="text-sm font-semibold text-foreground">{DECIDE_WORDS.aim}</dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words text-foreground">{p.aim}</dd>
                  </div>
                )}
              </dl>
            </section>

            <AttachedView attached={p.attached} />
            <AboutYouView about={p.aboutYou} />

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
              <ReviewPanel
                applicationRef={p.id}
                onChanged={() => void load()}
                moonEnded={!!p.term && new Date().toISOString().slice(0, 10) > p.term.endsOn}
                mayAdopt={p.you.mayAdopt}
                nobodyAtTheDoor={p.door.because !== DOOR.aRoleHolds}
              />
            )}
            </div>

            {side && (
            <aside
              aria-label={DECIDE_WORDS.deciderHeading}
              className="mt-8 space-y-6 lg:sticky lg:top-28 lg:mt-0 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto lg:pb-1"
              data-decide-panel=""
            >

            {p.status === "confirmed" && (
              <section aria-labelledby="op-decide" className="rounded-xl border-2 border-notice/40 bg-card p-5" data-decider-card="">
                <h2 id="op-decide" className="text-lg font-bold text-foreground">
                  {DECIDE_WORDS.deciderHeading}
                </h2>
                {/* Beside the read on a wide screen: who and which roles, so the panel stands on its own once the heading has scrolled away. */}
                <p className="hidden text-sm text-muted-foreground lg:block" data-decide-summary="">
                  <span className="font-semibold text-foreground">{p.agent ? p.agent.name : (p.proposer ?? t({ message: "Somebody from outside the village", context: "open proposal: the side panel when the proposer has no name" }))}</span>
                  {" · "}
                  {p.roles.map((r) => r.name ?? DECIDE_WORDS.roleGone).join(", ")}
                </p>
                {p.you.mayReview && p.review ? (
                  <OurReview
                    review={p.review}
                    note={note}
                    onNote={setNote}
                    busy={busy}
                    asking={notInviting}
                    onAsk={setNotInviting}
                    onInvite={() => void act(`${base(p.id)}/invite`, undefined, true)}
                    onNotInvite={() => {
                      setNotInviting(false);
                      void act(`${base(p.id)}/not-invited`, undefined, true);
                    }}
                  />
                ) : p.you.mayAdopt || p.you.mayDecline ? (
                  <>
                    <p className="mt-1 text-foreground">{p.you.formerMember ? DECIDE_WORDS.formerMember : record ? CONSENT_WORDS.recordLine : DECIDE_WORDS.deciderLine}</p>
                    <div className="mt-4" data-applicant-note-field="">
                      <label htmlFor="op-note" className="mb-2 block text-sm font-semibold text-card-foreground">
                        {t`A note for the applicant (they will see this)`}
                      </label>
                      <textarea
                        id="op-note"
                        rows={3}
                        maxLength={APPLICANT_NOTE_MAX}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        aria-describedby="op-note-help"
                        className="w-full rounded-lg border border-border bg-background px-4 py-3 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <p id="op-note-help" className="mt-1 text-sm text-muted-foreground">
                        {t`Optional. Plain text. They read it on their status page and in our email. It is part of their own application, and nobody else sees it.`}
                      </p>
                    </div>
                    {p.you.mayAdopt && p.offer && !p.agent && <div className="mt-3"><OpenTalksWarning settings={p.offer.openTalks} confirmed={knowsOpenTalks} onConfirm={setKnowsOpenTalks} /></div>}
                    {p.you.mayAdopt && <BeforeAdopt left={p.beforeAdopt ?? null} forASeat={forASeat} onForASeat={setForASeat} />}
                    {!declining ? (
                      // On a wide screen the row stays at the foot of the side panel while its note and checks scroll above it.
                      <div className="mt-4 lg:sticky lg:bottom-0 lg:-mx-5 lg:-mb-5 lg:rounded-b-xl lg:bg-card lg:px-5 lg:py-4">
                      <DecideDock
                        label={DECIDE_WORDS.deciderHeading}
                        note={adoptWaits ? t({ message: "Something waits before you can adopt. It is in the card further down.", context: "open proposal: the floating decision row on a phone" }) : undefined}
                      >
                      <div className="flex flex-wrap gap-2">
                        {p.you.mayAdopt && (
                          <button
                            type="button"
                            disabled={busy || adoptWaits}
                            aria-describedby={p.beforeAdopt && (p.beforeAdopt.conversations.length || p.beforeAdopt.seatsFull.length) ? "op-before-adopt" : undefined}
                            onClick={() => void act(`${base(p.id)}/adopt`, { ...(knowsOpenTalks ? { confirmOpenTalks: true } : {}), ...(forASeat ? { whenASeatOpens: true } : {}) }, true)}
                            className={PRIMARY}
                          >
                            <Check className="h-4 w-4" aria-hidden="true" />
                            {p.beforeAdopt?.seatsFull.length ? DECIDE_WORDS.adoptWhenASeatOpens : (record ?? DECIDE_WORDS.adopt)}
                          </button>
                        )}
                        {p.you.mayDecline && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setDeclining(true);
                              // From the floating row on a phone, the question opens in the card.
                              document.getElementById("op-decide")?.scrollIntoView?.({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
                            }}
                            className={SECONDARY}
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                            {DECIDE_WORDS.decline}
                          </button>
                        )}
                      </div>
                      </DecideDock>
                      </div>
                    ) : (
                      <div role="group" aria-label={DECIDE_WORDS.decline} className="mt-4 rounded-xl border border-border bg-card p-4">
                        <p className="text-foreground">{DECIDE_WORDS.declineAsk}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setDeclining(false);
                              void act(`${base(p.id)}/decline`, undefined, true);
                            }}
                            className="inline-flex min-h-[44px] items-center rounded-lg bg-destructive px-4 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
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
                  <p className="mt-1 text-foreground" data-door={p.door.because}>
                    {p.you.own
                      ? p.agent
                        ? t({ message: "You keep this agent, so another holder of the power to place people in roles decides it.", context: "open proposal: the keeper reads their own agent's proposal" })
                        : DECIDE_WORDS.ownProposal
                      : p.door.words}
                  </p>
                )}
              </section>
            )}

            {p.status === "adopted" && p.invitation && (
              <section aria-labelledby="op-invitation" className="rounded-xl border border-border bg-card p-5" data-invitation={p.invitation.state}>
                <h2 id="op-invitation" className="text-lg font-bold text-foreground">
                  {DECIDE_WORDS.deciderHeading}
                </h2>
                {p.invitation.state === "used" ? (
                  <p className="mt-1 text-foreground">{DECIDE_WORDS.invitationUsed}</p>
                ) : (
                  <>
                    {p.invitation.sentAt && (
                      <p className="mt-1 text-foreground" data-invitation-sent="">
                        {DECIDE_WORDS.invitationSent(new Date(p.invitation.sentAt).toLocaleString(), p.invitation.emailed !== false)}
                      </p>
                    )}
                    <p className="mt-1 text-foreground">{DECIDE_WORDS.reissueLine}</p>
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
                <p className={`text-sm font-medium ${said.ok ? "text-open" : "text-destructive"}`}>{said.text}</p>
                {said.link && (
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="min-w-0 break-all rounded bg-muted px-2 py-1 text-sm text-foreground">{said.link}</code>
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
            </aside>
            )}
          </article>
        )}
      </div>
    </div></Layout>
  );
}

/**
 * OUR REVIEW (Phase A), in the founding register: quiet, a gold rule, one
 * primary act. A decider invites the applicant to the conversations, which
 * open in the order the role names them, or sends the not-invited letter,
 * which asks once before it goes. The note rides with either answer.
 */
function OurReview({ review, note, onNote, busy, asking, onAsk, onInvite, onNotInvite }: {
  review: NonNullable<ServedOpenProposal["review"]>;
  note: string;
  onNote: (v: string) => void;
  busy: boolean;
  asking: boolean;
  onAsk: (v: boolean) => void;
  onInvite: () => void;
  onNotInvite: () => void;
}) {
  const { t } = useLingui();
  const total = review.conversations.reduce((n, c) => n + c.minutes, 0);
  return (
    <div className="mt-3 space-y-5" data-our-review={review.stage}>
      <p className="font-display text-xl leading-snug text-foreground">{DECIDE_WORDS.review.heading}</p>
      <p className="leading-relaxed text-muted-foreground">{DECIDE_WORDS.review.line}</p>
      <div className="border-t border-notice/40 pt-4">
        <p className="text-sm font-semibold text-foreground">{DECIDE_WORDS.review.conversations}</p>
        {review.conversations.length ? (
          <ol className="mt-2 grid gap-1.5 text-foreground" data-review-conversations="">
            {review.conversations.map((c, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3">
                <span>{i + 1}. {c.role}</span>
                <span className="shrink-0 text-sm text-muted-foreground">{t({ message: `${c.minutes} minutes`, context: "open proposal: our review, a conversation's length" })}</span>
              </li>
            ))}
            <li className="text-sm text-muted-foreground">{t({ message: `${total} minutes in all`, context: "open proposal: our review, the conversations' total" })}</li>
          </ol>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">{DECIDE_WORDS.review.noConversations}</p>
        )}
      </div>
      <div className="border-t border-notice/40 pt-4" data-applicant-note-field="">
        <label htmlFor="op-review-note" className="mb-2 block text-sm font-semibold text-card-foreground">
          {t`A note for the applicant (they will see this)`}
        </label>
        <textarea
          id="op-review-note"
          rows={3}
          maxLength={APPLICANT_NOTE_MAX}
          value={note}
          onChange={(e) => onNote(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-4 py-3 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      {!asking ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={onInvite} className={PRIMARY} data-review-invite="">
            <Mail className="h-4 w-4" aria-hidden="true" />
            {DECIDE_WORDS.review.invite}
          </button>
          <button type="button" disabled={busy} onClick={() => onAsk(true)} className={SECONDARY} data-review-not-invite="">
            {DECIDE_WORDS.review.notInvite}
          </button>
        </div>
      ) : (
        <div role="group" aria-label={DECIDE_WORDS.review.notInvite} className="rounded-xl border border-border bg-card p-4">
          <p className="text-foreground">{DECIDE_WORDS.review.notInviteAsk}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={onNotInvite} className={PRIMARY} data-review-not-invite-yes="">
              {DECIDE_WORDS.review.notInviteYes}
            </button>
            <button type="button" onClick={() => onAsk(false)} className={SECONDARY}>
              {DECIDE_WORDS.review.notInviteNo}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * WHAT IS LEFT BEFORE YOU CAN ADOPT (audit M10, B3): each conversation not written up, by role,
 * with a door to the chart when nobody holds that role; and, when every seat of a role is taken,
 * the sentence with the seat count and the deliberate choice to adopt for when a seat opens.
 * Adopt stays disabled until the list is clear, so it never answers a refusal the page could have shown.
 */
function BeforeAdopt({ left, forASeat, onForASeat }: { left: ServedOpenProposal["beforeAdopt"] | null; forASeat: boolean; onForASeat: (v: boolean) => void }) {
  const { t } = useLingui();
  if (!left || (!left.conversations.length && !left.seatsFull.length)) return null;
  return (
    <div id="op-before-adopt" className="mt-3 rounded-xl border-2 border-notice/60 bg-card p-4" data-before-adopt="">
      <p className="font-semibold text-foreground">{DECIDE_WORDS.leftHeading}</p>
      {left.conversations.length > 0 && (
        <ul className="mt-2 grid gap-2 text-sm text-foreground">
          {left.conversations.map((c) => (
            <li key={c.roleId} data-conversation-left={c.unheld ? "unheld" : "missing"}>
              {c.words}
              {c.unheld && (
                <>
                  {" "}
                  <Link href="/map/circles" className="font-semibold text-notice underline underline-offset-2">
                    {DECIDE_WORDS.chartLink}
                  </Link>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {left.seatsWords && (
        <div className="mt-2" data-seats-full="">
          <p className="text-sm text-foreground">{left.seatsWords}</p>
          <label className="mt-2 flex min-h-11 items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={forASeat} onChange={(e) => onForASeat(e.target.checked)} className="size-5" />
            {t`Adopt them for when a place opens`}
          </label>
        </div>
      )}
    </div>
  );
}
