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
import { useLocation, useParams } from "wouter";
import Layout from "@/components/Layout";
import ModuleGate, { SignInDoors } from "@/components/modules/ModuleGate";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { useAuth } from "@/contexts/AuthContext";
import { BreathingLoader } from "@/components/natural";
import ProposalEditor from "@/components/roleProposal/ProposalEditor";
import SharedProposal from "@/components/roleProposal/SharedProposal";
import { fetchProposal, fetchShared, startFromCard, type ProposalOut, type SharedOut } from "@/components/roleProposal/proposalApi";
import { RP_WORDS } from "@/components/roleProposal/proposalWords";

const GATE_LINE = "Each member's proposal for the roles they will hold next season, shared for feedback before it goes to the circle.";

function Page({ children }: { children: ReactNode }) {
  return (
    <Layout>
      <div className="container max-w-3xl px-4 py-8">{children}</div>
    </Layout>
  );
}

function Notice({ heading, line, next }: { heading: string; line?: string; next?: string }) {
  return (
    <Page>
      <div className="mt-6 rounded-xl border border-stone-200 bg-white p-6 text-center sm:p-8">
        <h1 className="font-display text-2xl font-bold text-stone-900">{heading}</h1>
        {line && <p className="mx-auto mt-2 max-w-md leading-relaxed text-stone-600">{line}</p>}
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

/** `/role-proposals/new`: a draft from the current card, then its steps. */
export function NewRoleProposal() {
  const gate = useGate(RP_WORDS.title);
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const [error, setError] = useState<{ status: number; text: string } | null>(null);
  useEffect(() => {
    if (!user || gate) return;
    let alive = true;
    void startFromCard().then((r) => {
      if (!alive) return;
      if (r.ok) setLocation(r.data.proposal.href, { replace: true });
      // One draft at a time: the one already open is where the member carries on.
      else if (r.status === 409 && typeof r.body?.href === "string" && r.body.href.startsWith("/role-proposals/")) setLocation(r.body.href, { replace: true });
      else setError({ status: r.status, text: r.error });
    });
    return () => {
      alive = false;
    };
  }, [user, gate, setLocation]);
  if (gate) return <>{gate}</>;
  if (!user && !loading) return <Notice heading={RP_WORDS.signIn} line={RP_WORDS.signInLine} next="/role-proposals/new" />;
  if (error) return <Notice heading={error.status === 403 ? RP_WORDS.membersOnly : error.text} />;
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
