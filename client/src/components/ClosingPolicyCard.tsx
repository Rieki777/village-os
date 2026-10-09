/**
 * WHAT CLOSING THIS VILLAGE MEANS, as every member reads it on /exit-policy,
 * and the door to propose a change to it.
 *
 * Rye, 2026-09-25: a village names what closing means before it launches, and
 * villagers see every dial and may propose a change to any of them from day
 * one. So the words are printed to anybody who can read the exit policy,
 * signed in or not, and the door sits under them.
 *
 * ONLY ADOPTED WORDS ARE PRINTED AS THE VILLAGE'S. A draft is the pen holder
 * thinking aloud, and the pre-filled default is the platform's suggestion:
 * printing either under "If the village closes" would tell a member the
 * village had promised something it has not. `closingNamed` is the same
 * question the launch checklist asks, so the page and the checklist can never
 * disagree about whether the village has answered.
 *
 * ── THE DOOR, AND WHICH MACHINERY IT USES ────────────────────────────────
 *
 * It opens an ADVISORY vote (`POST /api/governance/advisory`, the practice
 * vote the module library's ask already uses) with the question fixed, and
 * the member writes the change they want as the detail. Closing the vote
 * records the village's answer; the words are then rewritten by whoever keeps
 * the exit policy, because no vote in this repository writes that document.
 * That is "propose freely, adopt by power" with the machinery that exists:
 * any holder of `proposal.open` may put it to the village, and the holder of
 * the document acts on the answer.
 *
 * WAVE 3a SLOT. The canvas proposals lane (`POST /api/canvas/proposals`, any
 * member, the pen adopts or declines) is where a proposal carrying the new
 * words and adoptable in one step belongs. When it lands, this door should
 * offer that instead: it reaches every member where this one reaches only
 * `proposal.open` holders, and adopting it would write the section directly.
 *
 * The question is FIXED for the reason `askDoor.ts` gives: an advisory
 * ballot's subject ref is server-made, so the title is the only thing a second
 * member can match on, and a fixed title is what lets this say "the village
 * is deciding this now" instead of ringing the roll twice about one question.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Landmark } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { fetchBallots, fetchWizardFacts } from "@/components/governance/governanceApi";
import { closingNamed, closingPolicyDef, type ClosingSectionForReaders } from "@shared/closingPolicies";

const PracticeVote = lazy(() => import("@/components/governance/PracticeVote"));

/** The one sentence the village is asked. Fixed, so a second ask can find the first. */
export const CLOSING_CHANGE_QUESTION = "Should this village change what closing means?";

const adoptedOn = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

export default function ClosingPolicyCard({ closing }: { closing: ClosingSectionForReaders | null | undefined }) {
  const named = closingNamed(closing);
  const def = named && closing ? closingPolicyDef(closing.policyId) : null;
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-2">
        <Landmark className="w-4 h-4 text-teal-deep" aria-hidden="true" />
        <p className="font-semibold text-foreground text-sm">If the village closes</p>
      </div>
      {named && closing && def ? (
        <>
          <p className="text-sm text-foreground whitespace-pre-line">{closing.statement}</p>
          <p className="text-xs text-muted-foreground mt-3">
            {def.name}. Adopted on {adoptedOn(String(closing.adoptedAt))}.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          This village has not yet named what happens to its treasury and assets if it ever
          closes. The launch checklist asks for it before a village starts.
        </p>
      )}
      <ClosingProposeDoor />
    </div>
  );
}

/**
 * Propose a change: the advisory ask, or the sentence that says why there is
 * none for this reader.
 *
 * A read that did not answer leaves the door QUIET, never closed: telling a
 * member their account cannot open votes because a request was dropped would
 * be the page inventing a fact about them (ModuleAskDoor.tsx says the same).
 */
export function ClosingProposeDoor() {
  const { user, loading } = useAuth();
  const modules = useModules();
  const governance = useModule("governance");
  const forum = useModule("forum");
  const [, navigate] = useLocation();
  const [mayOpen, setMayOpen] = useState<boolean | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const worthAsking = !loading && !!user && !!governance;

  useEffect(() => {
    if (!worthAsking) return;
    let alive = true;
    void (async () => {
      const [facts, list] = await Promise.all([fetchWizardFacts(), fetchBallots({ limit: 200 })]);
      if (!alive) return;
      if (list.ok) {
        const open = list.data.find(
          (b) => b.subjectType === "advisory" && b.status === "open" && b.title === CLOSING_CHANGE_QUESTION,
        );
        setRunning(open?.id ?? null);
      }
      if (facts.ok) setMayOpen(facts.data.mayOpenAdvisory);
    })();
    return () => {
      alive = false;
    };
  }, [worthAsking]);

  const line = "mt-4 pt-3 border-t border-border text-sm text-muted-foreground";
  if (loading || !user) return null;
  // Wave 2 audit, 2026-09-28: this said "A change to this goes to a village
  // vote", and no vote writes the closing section. Whoever keeps the exit
  // policy can adopt new words at any time (PUT /api/admin/exit-policy/closing),
  // so only a PROPOSED change goes to a vote, and the line says so.
  if (modules.loaded && !governance) {
    return (
      <p className={line}>
        Proposing a change puts it to a village vote, and this village has not turned governance on yet.
        Whoever keeps the exit policy can change these words, so say what you would change to them.
      </p>
    );
  }
  if (running) {
    return (
      <p className={line}>
        The village is deciding a change to this right now.{" "}
        <Link href={`/decisions/${running}`} className="font-medium text-teal-deep underline">
          Go to the vote
        </Link>
      </p>
    );
  }
  if (mayOpen === null) return null;
  if (!mayOpen) {
    return (
      <p className={line}>
        Putting a change to the whole village opens a vote every member is rung about, and this
        account does not open those yet. Say what you would change to whoever keeps the exit
        policy{forum ? ", or in the forum" : ""}.
      </p>
    );
  }
  if (!asking) {
    return (
      <div className="mt-4 pt-3 border-t border-border">
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="min-h-[44px] rounded-lg border border-teal-deep px-4 text-sm font-medium text-teal-deep hover:bg-teal-deep/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
        >
          Propose a change
        </button>
      </div>
    );
  }
  return (
    <div className="mt-4">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <PracticeVote
          about={null}
          asking={{
            question: CLOSING_CHANGE_QUESTION,
            heading: "Propose a change to what closing means",
            lead:
              "The whole village is asked this one line, on the real roll with the weights your village uses. " +
              "Closing the vote records the answer. The words themselves are rewritten by whoever keeps the exit " +
              "policy, and this is how they hear what the village wants.",
            detailLabel: "The change you propose",
            detailHelp:
              "Write the words you would like in place of the current ones, and why. They are frozen into the " +
              "document when the vote opens, so they cannot change while people are voting.",
            submitLabel: "Ask the village",
            cancelLabel: "Not now",
          }}
          onOpened={(ballotId) => navigate(`/decisions/${ballotId}`)}
          onCancel={() => setAsking(false)}
        />
      </Suspense>
    </div>
  );
}
