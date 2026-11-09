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
 * THE SUGGESTION BOX, WHEN THE CANVAS IS ON (sweep decision D3, Rye
 * 2026-11-06). With the Governance Canvas on, every signed-in member gets
 * "Suggest a change", which files a canvas suggestion on the `exit:closing`
 * door (`POST /api/canvas/proposals`) carrying the new words. Adoption keeps
 * its gate: before the Birthing the exit policy's writers adopt it from the
 * Team block's Adopt frame, and after it the words change only by the
 * closing policy vote (D6). With the canvas off, the advisory door below stays
 * as the fallback (spec C2).
 *
 * The question is FIXED for the reason `askDoor.ts` gives: an advisory
 * ballot's subject ref is server-made, so the title is the only thing a second
 * member can match on, and a fixed title is what lets this say "the village
 * is deciding this now" instead of ringing the roll twice about one question.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Landmark } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useAuth } from "@/contexts/AuthContext";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { fetchBallots, fetchWizardFacts } from "@/components/governance/governanceApi";
import {
  CLOSING_POLICIES,
  CLOSING_POLICY_IDS,
  closingNamed,
  closingPolicyDef,
  type ClosingSectionForReaders,
} from "@shared/closingPolicies";
import { parseCanvasProposal } from "@shared/canvasFrames";
import { authToken } from "@/lib/gameApi";
import { refusalText } from "@/lib/canvasFramesCopy";

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
        <p className="font-semibold text-foreground text-sm">
          <Trans context="heading of the closing policy card">If the village closes</Trans>
        </p>
      </div>
      {named && closing && def ? (
        <>
          <p className="text-sm text-foreground whitespace-pre-line">{closing.statement}</p>
          <p className="text-xs text-muted-foreground mt-3">
            <Trans>
              {def.name}. Adopted on {adoptedOn(String(closing.adoptedAt))}.
            </Trans>
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          <Trans>
            This village has not yet named what happens to its treasury and assets if it ever
            closes. The launch checklist asks for it before a village starts.
          </Trans>
        </p>
      )}
      <ClosingProposeDoor closing={named ? closing : null} />
    </div>
  );
}

/**
 * The door under the words: the canvas suggestion box when the canvas is on,
 * the advisory ask when it is off.
 */
export function ClosingProposeDoor({ closing = null }: { closing?: ClosingSectionForReaders | null }) {
  const canvas = useModule("canvas");
  return canvas ? <ClosingSuggestDoor closing={closing} /> : <ClosingAdvisoryDoor />;
}

const jsonHeaders = (): Record<string, string> => {
  const token = authToken();
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

/**
 * Suggest new closing words, for any signed-in member. The suggestion is the
 * canvas's own (`exit:closing` on the Team block), validated by the same
 * `parseCanvasProposal` the route runs, so the box and the server refuse alike.
 */
export function ClosingSuggestDoor({ closing }: { closing: ClosingSectionForReaders | null }) {
  const { user, loading } = useAuth();
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [policyId, setPolicyId] = useState<string>(closing?.policyId ?? "own-words");
  const [statement, setStatement] = useState<string>(closing?.statement ?? "");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  if (loading || !user) return null;

  if (sent) {
    return (
      <p className="mt-4 pt-3 border-t border-border text-sm text-muted-foreground" role="status">
        <Trans>
          Your suggestion is with the village. It waits on the canvas Team block, where whoever may adopt it decides.
        </Trans>
      </p>
    );
  }
  if (!open) {
    return (
      <div className="mt-4 pt-3 border-t border-border">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-[44px] rounded-lg border border-teal-deep px-4 text-sm font-medium text-teal-deep hover:bg-teal-deep/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
        >
          <Trans context="button that suggests a change to what closing means">Suggest a change</Trans>
        </button>
      </div>
    );
  }

  const body = {
    blockId: "team",
    target: "setting",
    door: "exit:closing",
    change: { policyId, statement },
    body: why,
  };
  const submit = async () => {
    const parsed = parseCanvasProposal(body);
    if (!parsed.ok) return setError(parsed.error);
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/canvas/proposals", { method: "POST", headers: jsonHeaders(), body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setError(refusalText(d, t`That suggestion was not kept.`));
      setSent(true);
    } catch {
      setError(t`That suggestion did not reach the server, so nothing was kept.`);
    } finally {
      setBusy(false);
    }
  };
  const field = "mt-1 w-full min-h-[44px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground";
  return (
    <form
      aria-label={t`Suggest a change to what closing means`}
      className="mt-4 pt-3 border-t border-border space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="block text-sm">
        <span className="font-medium text-foreground">
          <Trans context="label of the closing policy choice">Which policy</Trans>
        </span>
        <select className={field} value={policyId} onChange={(e) => setPolicyId(e.target.value)}>
          {CLOSING_POLICY_IDS.map((id) => (
            <option key={id} value={id}>
              {CLOSING_POLICIES[id].name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="font-medium text-foreground">
          <Trans>The words you suggest, whole, as members would read them</Trans>
        </span>
        <textarea className={`${field} min-h-[120px]`} value={statement} onChange={(e) => setStatement(e.target.value)} />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-foreground">
          <Trans>Why this change, in a sentence or more</Trans>
        </span>
        <textarea className={`${field} min-h-[88px]`} value={why} onChange={(e) => setWhy(e.target.value)} />
      </label>
      <p className="text-xs text-muted-foreground">
        <Trans>Everyone in the village can read what you write here.</Trans>
      </p>
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="min-h-[44px] rounded-lg bg-teal-deep px-4 text-sm font-medium text-white disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
        >
          <Trans context="button that sends a closing policy suggestion">Send the suggestion</Trans>
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-[44px] rounded-lg border border-border px-4 text-sm text-foreground"
        >
          <Trans context="button that closes the closing policy suggestion">Not now</Trans>
        </button>
      </div>
    </form>
  );
}

/**
 * Propose a change with the canvas off: the advisory ask, or the sentence that
 * says why there is none for this reader.
 *
 * A read that did not answer leaves the door QUIET, never closed: telling a
 * member their account cannot open votes because a request was dropped would
 * be the page inventing a fact about them (ModuleAskDoor.tsx says the same).
 */
export function ClosingAdvisoryDoor() {
  const { user, loading } = useAuth();
  const { t } = useLingui();
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
        <Trans>
          Proposing a change puts it to a village vote, and this village has not turned governance on yet.
          Whoever keeps the exit policy can change these words, so say what you would change to them.
        </Trans>
      </p>
    );
  }
  if (running) {
    return (
      <p className={line}>
        <Trans>The village is deciding a change to this right now.</Trans>{" "}
        <Link href={`/decisions/${running}`} className="font-medium text-teal-deep underline">
          <Trans>Go to the vote</Trans>
        </Link>
      </p>
    );
  }
  if (mayOpen === null) return null;
  if (!mayOpen) {
    return (
      <p className={line}>
        {forum ? (
          <Trans>
            Putting a change to the whole village opens a vote every member is rung about, and this
            account does not open those yet. Say what you would change to whoever keeps the exit
            policy, or in the forum.
          </Trans>
        ) : (
          <Trans>
            Putting a change to the whole village opens a vote every member is rung about, and this
            account does not open those yet. Say what you would change to whoever keeps the exit
            policy.
          </Trans>
        )}
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
          <Trans context="button that proposes a change to what closing means">Propose a change</Trans>
        </button>
      </div>
    );
  }
  return (
    <div className="mt-4">
      <Suspense fallback={<p className="text-sm text-muted-foreground"><Trans context="the closing-policy vote form is loading">Loading...</Trans></p>}>
        <PracticeVote
          about={null}
          asking={{
            question: CLOSING_CHANGE_QUESTION,
            heading: t`Propose a change to what closing means`,
            lead: t`The whole village is asked this one line, on the real roll with the weights your village uses. Closing the vote records the answer. The words themselves are rewritten by whoever keeps the exit policy, and this is how they hear what the village wants.`,
            detailLabel: t`The change you propose`,
            detailHelp: t`Write the words you would like in place of the current ones, and why. They are frozen into the document when the vote opens, so they cannot change while people are voting.`,
            submitLabel: t({ message: "Ask the village", context: "button that opens the closing-policy vote" }),
            cancelLabel: t({ message: "Not now", context: "button that closes the closing-policy ask" }),
          }}
          onOpened={(ballotId) => navigate(`/decisions/${ballotId}`)}
          onCancel={() => setAsking(false)}
        />
      </Suspense>
    </div>
  );
}
