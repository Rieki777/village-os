/**
 * PROPOSE MY ROLES FOR NEXT SEASON, the pages (role proposals PR C). One lazy
 * chunk for three routes (App.tsx):
 *
 *   /role-proposals/new            starts a draft from the member's current
 *                                  card and moves to it; with a draft already
 *                                  open, moves to that one
 *   /role-proposals/shared/:token  the shared view, read only, with feedback
 *                                  for members (SharedProposal)
 *   /role-proposals/:id            the member's own proposal: the six steps,
 *                                  or where it stands once submitted
 *                                  (ProposalEditor)
 *
 * Members only, behind the governance module. Signed out, the steps say why
 * and offer the sign-in doors; a guest is told it opens at the member rung.
 * The shared view answers a signed-out reader of a members link the same
 * way, and reads "anyone with the link" to anybody.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "wouter";
import Layout from "@/components/Layout";
import ModuleGate, { SignInDoors } from "@/components/modules/ModuleGate";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { useAuth } from "@/contexts/AuthContext";
import { BreathingLoader } from "@/components/natural";
import ProposalEditor from "@/components/roleProposal/ProposalEditor";
import SharedProposal from "@/components/roleProposal/SharedProposal";
import { fetchMine, fetchProposal, fetchShared, startFromCard, type ProposalOut, type SharedOut } from "@/components/roleProposal/proposalApi";
import { proposalHref } from "@shared/roleProposals";
import { keepRoleOn } from "@/components/roleProposal/QuickPath";
import { RP_WORDS } from "@/components/roleProposal/proposalWords";
import AgentProposalForm from "@/components/roleProposal/AgentProposalForm";
import { AGENT_PROPOSAL_WORDS } from "@shared/agentHolders";
import { useLingui } from "@lingui/react/macro";
import { ArrowRight } from "lucide-react";
import { termOf } from "@shared/openProposalTerm";
import { civilDayWords } from "@shared/seasonPlans";
import { openProposalHref } from "@shared/openProposals";
import { BTN_PRIMARY, CARD, DOOR, EYEBROW, HINT } from "@/components/journey/look";

const GATE_LINE = "Each member's proposal for the roles they will hold next season, shared for feedback before it goes to the circle.";

function Page({ children }: { children: ReactNode }) {
  return (
    <Layout>
      <div className="sheet-night min-h-screen bg-background text-foreground">
        <div className="container min-w-0 max-w-3xl overflow-x-clip px-4 py-8">{children}</div>
      </div>
    </Layout>
  );
}

function Notice({ heading, line, next, children }: { heading: string; line?: string; next?: string; children?: ReactNode }) {
  return (
    <Page>
      <div className="mt-6 rounded-xl border border-border bg-card p-6 text-center sm:p-8">
        <h1 className="font-display text-2xl text-foreground">{heading}</h1>
        {line && <p className="mx-auto mt-2 max-w-md leading-relaxed text-muted-foreground">{line}</p>}
        {children}
        {next && (
          <div className="mt-5">
            <SignInDoors next={next} />
          </div>
        )}
      </div>
    </Page>
  );
}

/** The governance module's gate, or null when the page may draw. */
function useGate(name: string): ReactNode | null {
  const modules = useModules();
  const governance = useModule("governance");
  if (modules.loaded && !governance) return <ModuleGate moduleId="governance" name={name} behind={GATE_LINE} />;
  return null;
}

/** `/role-proposals/new?agent=1&role=`: the member door's agent side (0374). */
function agentAsked(): { roleId: string } | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  return q.get("agent") === "1" ? { roleId: q.get("role") ?? "" } : null;
}

function NewAgentProposal({ roleId }: { roleId: string }) {
  const gate = useGate(AGENT_PROPOSAL_WORDS.title);
  const { user, loading } = useAuth();
  if (gate) return <>{gate}</>;
  if (!user && !loading) return <Notice heading={AGENT_PROPOSAL_WORDS.signIn} next={`/role-proposals/new?agent=1&role=${encodeURIComponent(roleId)}`} />;
  if (!user) return <Page><div className="flex justify-center py-16"><BreathingLoader label={RP_WORDS.starting} /></div></Page>;
  return (
    <Page>
      {/* The compass steps out while the agent form is up: on a phone it sat over the fields (verify, 11 Nov). */}
      <div data-hides-fab="">
        <AgentProposalForm roleId={roleId} />
      </div>
    </Page>
  );
}

/** `/role-proposals/new`: a draft from the current card, then its steps; with `?agent=1`, an agent proposed by its keeper. */
export function NewRoleProposal() {
  const [agent] = useState(agentAsked);
  if (agent) return <NewAgentProposal roleId={agent.roleId} />;
  return <NewOwnRoleProposal />;
}

/**
 * THIS MOON OR NEXT SEASON (B7, verify 11 Nov 2026). A village that takes
 * proposals for this moon offers its open roles on the open form; the member
 * door used to offer next season only. When the open form is taking this
 * moon's roles, the door asks which first. `?season=1`, or a role the moon
 * does not offer, goes straight to next season as before.
 */
type MoonOffer = { from: string; to: string; roles: Array<{ id: string; name: string }> };

function useMoonOffer(): MoonOffer | null | "asking" {
  const [offer, setOffer] = useState<MoonOffer | null | "asking">(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("season") === "1" ? null : "asking";
  });
  useEffect(() => {
    if (offer !== "asking") return;
    let live = true;
    fetch("/api/open-proposals/form")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live) return;
        const term = termOf(d?.term);
        const roles: Array<{ id: string; name: string }> = Array.isArray(d?.roles) ? d.roles.filter((r: any) => r && typeof r.id === "string").map((r: any) => ({ id: r.id, name: String(r.name ?? r.id) })) : [];
        const asked = new URLSearchParams(window.location.search).get("role");
        // A link for one role the moon does not offer is a next-season link: nothing to ask.
        const roleElsewhere = !!asked && !roles.some((r) => r.id === asked);
        setOffer(d?.open && term && roles.length > 0 && !roleElsewhere ? { from: term.startsOn, to: term.endsOn, roles } : null);
      })
      .catch(() => live && setOffer(null));
    return () => {
      live = false;
    };
  }, [offer]);
  return offer;
}

function MoonOrSeason({ offer, onSeason }: { offer: MoonOffer; onSeason: () => void }) {
  const { t } = useLingui();
  const from = civilDayWords(offer.from);
  const to = civilDayWords(offer.to);
  const asked = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("role");
  const href = asked && offer.roles.some((r) => r.id === asked) ? openProposalHref(asked) : openProposalHref();
  const count = offer.roles.length;
  return (
    <Page>
      <div className="mt-6 grid gap-4" data-moon-or-season="">
        <h1 className="font-display text-3xl text-foreground">{t({ message: "Which roles are you proposing for?", context: "member door choice" })}</h1>
        <section className={`${CARD} grid gap-3`} data-door="moon">
          <p className={EYEBROW}>{t({ message: "This moon", context: "member door choice" })}</p>
          <p className="text-foreground">
            {count === 1
              ? t({ message: `1 role is open now, from ${from} to the next new moon on ${to}.`, context: "member door choice" })
              : t({ message: `${count} roles are open now, from ${from} to the next new moon on ${to}.`, context: "member door choice" })}
          </p>
          <p className={HINT}>{t({ message: "Your name and email come from your account.", context: "member door choice" })}</p>
          <Link href={href} className={`${BTN_PRIMARY} justify-self-start`}>
            {t({ message: "Propose for this moon", context: "member door choice" })}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </section>
        <button type="button" onClick={onSeason} className={`jw-btn min-h-14 ${DOOR}`} data-door="season">
          <span className="grid min-w-0 flex-1 text-left">
            <span>{t({ message: "Your roles for next season", context: "member door choice" })}</span>
            <span className="text-xs font-normal text-muted-foreground">{t({ message: "Change any words, share it for feedback, then send it to the circle.", context: "member door choice" })}</span>
          </span>
          <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
        </button>
      </div>
    </Page>
  );
}

function NewOwnRoleProposal() {
  const { t } = useLingui();
  const gate = useGate(RP_WORDS.title);
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const [error, setError] = useState<{ status: number; text: string } | null>(null);
  const moon = useMoonOffer();
  const [season, setSeason] = useState(false);
  const choosing = !season && moon !== null;
  useEffect(() => {
    if (!user || gate || choosing) return;
    let alive = true;
    // Read first: a member with a draft goes to it without a refused POST, which a browser logs as an error on every visit (audit M14).
    void (async () => {
      const mine = await fetchMine();
      if (!alive) return;
      if (mine.ok && typeof mine.data.draftId === "string" && mine.data.draftId) {
        setLocation(keepRoleOn(proposalHref(mine.data.draftId)), { replace: true });
        return;
      }
      const r = await startFromCard();
      if (!alive) return;
      if (r.ok) setLocation(keepRoleOn(r.data.proposal.href), { replace: true });
      // One draft at a time: the one already open is where the member carries on.
      else if (r.status === 409 && typeof r.body?.href === "string" && r.body.href.startsWith("/role-proposals/")) setLocation(keepRoleOn(r.body.href), { replace: true });
      else setError({ status: r.status, text: r.error });
    })();
    return () => {
      alive = false;
    };
  }, [user, gate, setLocation, choosing]);
  if (gate) return <>{gate}</>;
  // Signed out: this moon, and the open form beside the sign-in, so a visitor is never walled off (final verification).
  if (!user && !loading)
    return (
      <Notice heading={RP_WORDS.signIn} line={t`Members sign in here to propose the roles they will hold this moon.`} next="/role-proposals/new">
        <p className="mt-4">
          <Link href={openProposalHref()} className="inline-flex min-h-11 items-center gap-2 font-semibold text-foreground underline underline-offset-4" data-open-form-door="">
            {t`Propose a role for this moon without an account`}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </p>
      </Notice>
    );
  if (error) return <Notice heading={error.status === 403 ? RP_WORDS.membersOnly : error.text} />;
  if (user && !season && moon && moon !== "asking") return <MoonOrSeason offer={moon} onSeason={() => setSeason(true)} />;
  return (
    <Page>
      <div className="flex justify-center py-16">
        <BreathingLoader label={RP_WORDS.starting} />
      </div>
    </Page>
  );
}

/** `/role-proposals/:id`: the member's own proposal. */
export default function RoleProposalPage() {
  const gate = useGate(RP_WORDS.title);
  const { user, loading } = useAuth();
  const { id = "" } = useParams<{ id: string }>();
  const [proposal, setProposal] = useState<ProposalOut | null>(null);
  const [error, setError] = useState<{ status: number; text: string } | null>(null);
  useEffect(() => {
    if (!user || gate) return;
    let alive = true;
    setProposal(null);
    setError(null);
    void fetchProposal(id).then((r) => {
      if (!alive) return;
      if (r.ok) setProposal(r.data.proposal);
      else setError({ status: r.status, text: r.error });
    });
    return () => {
      alive = false;
    };
  }, [id, user, gate]);
  if (gate) return <>{gate}</>;
  if (!user && !loading) return <Notice heading={RP_WORDS.signIn} line={RP_WORDS.signInLine} next={`/role-proposals/${encodeURIComponent(id)}`} />;
  if (error) return <Notice heading={error.status === 403 ? RP_WORDS.membersOnly : error.status === 404 ? RP_WORDS.missing : error.text} />;
  if (!proposal || !user) {
    return (
      <Page>
        <div className="flex justify-center py-16">
          <BreathingLoader label={RP_WORDS.reading} />
        </div>
      </Page>
    );
  }
  return (
    <Page>
      <ProposalEditor key={proposal.id} initial={proposal} me={String(user.id ?? "")} />
    </Page>
  );
}

/** `/role-proposals/shared/:token`: the shared view. */
export function SharedRoleProposal() {
  const gate = useGate(RP_WORDS.sharedTitle);
  const { user, loading } = useAuth();
  const { token = "" } = useParams<{ token: string }>();
  const [shared, setShared] = useState<SharedOut | null>(null);
  const [error, setError] = useState<{ status: number; text: string } | null>(null);
  const signedIn = !!user;
  useEffect(() => {
    if (gate || loading) return;
    let alive = true;
    setShared(null);
    setError(null);
    void fetchShared(token).then((r) => {
      if (!alive) return;
      if (r.ok) setShared(r.data);
      else setError({ status: r.status, text: r.error });
    });
    return () => {
      alive = false;
    };
  }, [token, gate, loading, signedIn]);
  if (gate) return <>{gate}</>;
  if (error?.status === 401) return <Notice heading={RP_WORDS.sharedSignIn} next={signedIn ? undefined : `/role-proposals/shared/${encodeURIComponent(token)}`} />;
  if (error) return <Notice heading={error.status === 404 ? RP_WORDS.linkOff : error.text} />;
  if (!shared) {
    return (
      <Page>
        <div className="flex justify-center py-16">
          <BreathingLoader label={RP_WORDS.reading} />
        </div>
      </Page>
    );
  }
  return (
    <Page>
      <SharedProposal token={token} shared={shared} />
    </Page>
  );
}
