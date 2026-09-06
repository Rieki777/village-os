/**
 * THE PUBLIC GAME MECHANICS PAGE (Game Mechanics initiative, 2026-07-31).
 *
 * Everything the game runs on, visible to everyone — and, since the
 * propose-on-the-page phase, the place any member changes it from:
 *
 *   1. The constitution — the laws no vote can change, in plain language.
 *   2. The dials — every mechanic of every running module. Community-ring
 *      dials are EDITABLE in place for signed-in members: adjusting one
 *      stages a change, staged changes become a proposal with a title and a
 *      rationale, and the proposal walks the village's own path — sensing
 *      support in-game, then the binding vote, then the amendment ledger
 *      when it applies.
 *   3. Open proposals — support, sponsor a draft, take one to the binding
 *      vote, and (admins) apply one that carried.
 *      A proposal here may have BEEN to a vote and come back: a missed quorum
 *      and a called-off ballot both send it to `open` holding its ballot id,
 *      and both settle nothing. The card says which, in the bell's own words,
 *      and links to the vote (`ballotReturn`, gameMechanicsBallotCopy.ts).
 *   4. The amendment history.
 *
 * WHERE THE BINDING VOTE HAPPENS IS THIS VILLAGE'S OWN ANSWER, and the page
 * had no way to ask. It shipped saying "the binding vote happens on the
 * village's Hypha" in two places and offering exactly two doors, both of them
 * to Hypha, while `governance.default_method` ships as `custom`: a village
 * that turned the governance engine on decided its own mechanics, and the
 * only route that could open that vote had no caller in this whole client.
 * `snapshot.governance` now carries the venue, the method and the auto-apply
 * brake, so every sentence here is true under either setting and the door to
 * the village's own vote exists.
 *
 * The page RENDERS the server's answers and computes no rule of its own:
 * eligibility comes from /standing (the same function the routes enforce
 * with), the venue comes from /api/game/mechanics (the same helpers the
 * open-ballot route conducts by), validation problems come back from the
 * server, and the proposal document is fetched, never rebuilt here — what is
 * voted on is what was checked.
 */
import Layout from "@/components/Layout";
import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Scale,
  SlidersHorizontal,
  ScrollText,
  ChevronDown,
  Lock,
  Users,
  Megaphone,
  Copy,
  X,
} from "lucide-react";
import { Link } from "wouter";
import InfoTip from "@/components/InfoTip";
import { useCatalyst, useGameConfig, authToken } from "@/lib/gameApi";
import { ballotReturn } from "./gameMechanicsBallotCopy";
import { useAuth } from "@/contexts/AuthContext";
import { useFocusTarget } from "@/lib/useFocusTarget";

interface MechanicsVariable {
  key: string;
  category: string;
  label: string;
  description: string;
  type: string;
  unit: string | null;
  min: number | null;
  max: number | null;
  choices: Array<{ value: string; label: string; hint?: string }> | null;
  default: string;
  value: string;
  parsed: number | boolean | string;
  isDefault: boolean;
  ring: "open" | "founder";
  applyTiming: "instant" | "cycle-close";
}

/**
 * How THIS village decides a mechanics proposal, served whole so the page
 * states it and never infers it. `decidesBy` already folds in whether the
 * on-site engine is running at all: a village with the governance module off
 * decides on Hypha whatever its stored method says, because the route that
 * would open a village ballot is not mounted.
 */
interface MechanicsGovernance {
  decidesBy: "onsite" | "hypha";
  /** The method an on-site ballot conducts. Null when the vote is on Hypha. */
  method: "majority" | "custom" | "consensus" | "consent" | null;
  /** `governance.auto_apply_enabled`: off holds a carried proposal for a hand. */
  autoApply: boolean;
  supportThreshold: number;
}

interface MechanicsSnapshot {
  constitution: Array<{ title: string; plain: string; enforcedBy: string }>;
  variables: MechanicsVariable[];
  modules: Array<{ id: string; name: string; core: boolean }>;
  governance: MechanicsGovernance;
}

/**
 * THE VOTE INSIDE AN AMENDMENT'S REFERENCE.
 *
 * `applyMechanicsProposal` stamps every governance-sourced ledger row with
 * `gm:<proposal>[ <hypha ref>][ bal:<ballot>]`, so the decision that made a
 * change has been written next to the change since the on-site engine
 * shipped. This page rendered the whole thing as dead monospace: a member
 * reading their village's amendment history could see that a vote decided a
 * dial and had no way to reach it.
 *
 * Returns null when there is no `bal:` segment, which is every amendment an
 * admin made directly and every one that went to Hypha, and the row then
 * renders exactly as it did before. Nothing is inferred: no segment means no
 * link, never a guess at which vote it might have been.
 */
export function ballotIdIn(proposalRef: string | null | undefined): string | null {
  const m = /(?:^|\s)bal:(\S+)/.exec(String(proposalRef ?? ""));
  return m ? m[1] : null;
}

interface Amendment {
  id: string;
  key: string;
  label: string;
  from: string | null;
  fromWasDefault: boolean;
  to: string | null;
  toIsDefault: boolean;
  by: string | null;
  source: string;
  proposalRef: string | null;
  note: string | null;
  at: string;
}

interface ProposalChange {
  key: string;
  label: string;
  from: string;
  fromDisplay: string;
  to: string;
  toDisplay: string;
  applyTiming: string;
  currentValue: string | null;
}

/** Every value `mechanics_proposals.status` can hold (0089 widened the enum to
 *  ten and this list carried eight, and 0172 added an eleventh; see STATUS_COPY). */
type ProposalStatus =
  | "draft"
  | "open"
  | "withdrawn"
  | "to_hypha"
  | "onsite_vote"
  | "passed_claimed"
  | "passed_verified"
  | "passed_onsite"
  | "failed" | "vetoed"
  | "applied";

/** How the last ballot on a proposal ended (`ballots.status`). */
export type BallotStatus = "open" | "passed" | "failed" | "no_quorum" | "withdrawn";

interface Proposal {
  id: string;
  title: string;
  rationale: string;
  status: ProposalStatus;
  /** The vote this proposal last went to, null if it has never been to one. */
  ballotId: string | null;
  /** How that vote ended. Null while it is still open, and null with no vote. */
  lastBallotStatus: BallotStatus | null;
  hyphaRef: string | null;
  hyphaProposalId: string | null;
  hyphaProposalUrl: string | null;
  hubLinkSynced: boolean;
  createdAt: string;
  proposer: string;
  supports: number;
  sponsors: number;
  changes: ProposalChange[];
}

interface Standing {
  qualified: boolean;
  mayDraft: boolean;
  denied: boolean;
  recognitionRequired: number;
  recognitionHeld: number;
  supportThreshold: number;
  backed: Array<{ proposalId: string; kind: string }>;
  /** Holds `proposal.open`, so may take ANY proposal to the village vote. */
  mayOpenBallot: boolean;
  /** Proposals this viewer raised. The other half of who the route admits. */
  mine: string[];
}

export const STATUS_COPY: Record<ProposalStatus, { label: string; cls: string }> = {
  draft: { label: "draft, needs a sponsor", cls: "bg-amber-50 text-amber-700" },
  open: { label: "open for support", cls: "bg-emerald-50 text-emerald-700" },
  withdrawn: { label: "withdrawn", cls: "bg-stone-100 text-stone-500" },
  to_hypha: { label: "at Hypha for the vote", cls: "bg-sky-50 text-sky-700" },
  onsite_vote: { label: "at the village vote", cls: "bg-sky-50 text-sky-700" },
  passed_claimed: { label: "passed, awaiting verification", cls: "bg-violet-50 text-violet-700" },
  // ", applying" came off this one too. Whether it is applying depends on the
  // same brake and the same cycle timing as the on-site sibling below, and
  // the chip asserted the happy branch of both.
  passed_verified: { label: "verified on-chain", cls: "bg-violet-50 text-violet-700" },
  // No ", applying" on this one. Whether it IS applying depends on the landing
  // instant, the brake and the cycle timing, so the chip states the fact that
  // never varies and WaitingNote below says which of the three is holding it.
  passed_onsite: { label: "carried at the village vote", cls: "bg-violet-50 text-violet-700" },
  failed: { label: "did not pass", cls: "bg-stone-100 text-stone-500" },
  vetoed: { label: "stopped by a steward, back with the proposer", cls: "bg-amber-50 text-amber-700" }, // 0172
  applied: { label: "applied", cls: "bg-teal-deep/10 text-teal-deep" },
};

/**
 * The statuses an admin may apply from, mirroring the ONE apply route
 * (`POST /api/admin/mechanics/proposals/:id/apply`, server/index.ts).
 *
 * `passed_onsite` shipped in that route's accepted set and NOT in this page's
 * button, so a proposal the village carried at its own vote and the brake was
 * holding had no way to be applied from the only surface that shows it. The
 * route's own comment already said a ballot-passed proposal is applied by the
 * same human hand as a Hypha-verified one; the button disagreed in silence.
 * gameMechanicsStates.test.ts reads the route's set out of the server source
 * and holds this to it, the same way it reads the status enum off the
 * migration instead of trusting a union kept by hand.
 */
export const APPLYABLE: ReadonlySet<ProposalStatus> = new Set<ProposalStatus>([
  "to_hypha",
  "passed_claimed",
  "passed_verified",
  "passed_onsite",
]);

/**
 * The state chip, never undefined. `STATUS_COPY[p.status].cls` used to be read
 * straight, and the enum in the database is the authority for what arrives
 * here: 0089 added `onsite_vote` and `passed_onsite` and this map kept eight
 * keys, so the first proposal to reach the village's own vote threw a
 * TypeError inside the list and took the whole page down for everyone. A
 * status nobody has taught this page yet now reads as itself instead.
 */
function statusChip(status: ProposalStatus): { label: string; cls: string } {
  return STATUS_COPY[status] ?? { label: String(status).replace(/_/g, " "), cls: "bg-stone-100 text-stone-500" };
}

/**
 * The chip that says a proposal has been to a vote and come back, beside the
 * chip that says where it stands now. Two chips, because they answer two
 * questions and folding them into one is how "waiting" became "rejected".
 *
 * A proposal that has never been to a vote carries nothing here. Its status
 * chip is the whole of its state, and hanging a badge on it for a thing that
 * has not happened is the scorecard R55 rules out.
 */
function BallotReturnChip({ proposal }: { proposal: Proposal }) {
  const catalyst = useCatalyst();
  const back = proposal.lastBallotStatus ? ballotReturn(catalyst.aName)[proposal.lastBallotStatus] : null;
  if (!proposal.ballotId || !back?.chip) return null;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${back.cls}`}>
      {back.chip}
      {back.tip && <InfoTip tip={back.tip} label={`What ${back.chip} means`} />}
    </span>
  );
}

/**
 * What the vote left behind, in the card body, and the way to the vote itself.
 * The link is the point of the sentence: the ballot holds the frozen roll, the
 * tallies and the reason it was called off, so a member can read the thing
 * being described instead of taking this page's word for it.
 */
function BallotReturnNote({ proposal }: { proposal: Proposal }) {
  const catalyst = useCatalyst();
  if (!proposal.ballotId) return null;
  const back = proposal.lastBallotStatus ? ballotReturn(catalyst.aName)[proposal.lastBallotStatus] : null;
  const live = proposal.lastBallotStatus === "open";
  const to = (
    <Link
      href={`/decisions/${proposal.ballotId}`}
      className={`text-sm text-teal-deep font-medium hover:underline ${back?.line ? "mt-1 inline-block" : ""}`}
    >
      {live ? "See the vote" : "See that vote"}
    </Link>
  );
  // No box around a bare link. The band is there to hold a sentence, and an
  // empty one reads as something that failed to load.
  if (!back?.line) return <p className="mb-3">{to}</p>;
  return (
    <div className="mb-3 rounded-lg bg-stone-50 border border-stone-200 px-3 py-2">
      <p className="text-sm text-stone-600 leading-relaxed">{back.line}</p>
      {to}
    </div>
  );
}

/**
 * WHY A PROPOSAL THAT CARRIED IS STILL SITTING THERE.
 *
 * A proposal at `passed_onsite` or `passed_verified` has won its vote and
 * changed nothing yet, and the page had no words for that at all. Two things
 * hold one: the founder's auto-apply brake, and a change-set touching a
 * cycle-timed dial (the whole set waits together, because a set applies
 * atomically or not at all). Both are facts the server already knows and the
 * member could not see, so the chip said "applying" and the ledger stayed
 * empty and nothing on the page joined those up.
 *
 * The order matches the server's: the brake is checked before the cycle
 * timing, because with the brake on a human applies it whatever the timing
 * says. That ordering is also why the brake line says nothing about WHEN: a
 * hand-applied set writes through immediately, so the "(at next cycle close)"
 * note beside a change describes the auto path the brake has switched off,
 * and a sentence promising a timing here would contradict the line under it.
 * A third case is left deliberately vague, and honestly so: with the brake
 * off and every dial instant, the apply already ran and refused every change,
 * and this page cannot know which registry rule refused it. It says what it
 * knows and points at the person who can look.
 *
 * R56: every line here is a fact the member cannot otherwise see. None of it
 * argues for an outcome, and none of it asks anybody to hurry.
 */
function WaitingNote({ proposal, gov }: { proposal: Proposal; gov: MechanicsGovernance | null }) {
  if (proposal.status !== "passed_onsite" && proposal.status !== "passed_verified") return null;
  const carried =
    proposal.status === "passed_onsite"
      ? "The village carried this at its own vote."
      : "This carried on Hypha and the verified result has come home.";
  const why =
    gov && !gov.autoApply
      ? "Applying it is a steward's own act while the founders' auto-apply brake is off."
      : proposal.changes.some((c) => c.applyTiming === "cycle-close")
        ? "One of these dials only moves at a cycle close, so the whole set applies together at the next one."
        : "Nothing has reached the amendment ledger under it yet, and a steward can see why from the apply.";
  return (
    <div className="mb-3 rounded-lg bg-violet-50/60 border border-violet-200 px-3 py-2">
      <p className="text-sm text-stone-700 leading-relaxed">
        {carried} {why}
      </p>
    </div>
  );
}

/**
 * Does this dial answer what somebody typed?
 *
 * R79's second half. The Dials list is every tunable rule in the Game, grouped
 * into categories that all start shut, and until now there was no way to look
 * anything up. A founder setting up a Game opens drawers hunting for a switch
 * whose key they have never seen.
 *
 * THE DESCRIPTION IS PART OF THE HAYSTACK, and that is the whole design.
 * Somebody looking for the feedback switch types "bug report" or "sharing" or
 * "platform team". The key is `platform.feedback_relay`, and "relay" is the one
 * word a founder has no reason to know. Every sentence that would help them
 * lives in the description, so searching only the key and the label would find
 * the dials whose names already gave them away and miss the rest.
 *
 * Every word has to land somewhere, so adding a word narrows the list. Order
 * does not matter, because nobody types a description back in sequence.
 *
 * Exported so `gameMechanicsStates.test.ts` can hold that line.
 */
export function dialMatches(
  v: { key: string; label: string; description: string; category: string },
  query: string,
): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${v.key} ${v.label} ${v.description} ${v.category}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

function displayValue(v: MechanicsVariable, raw: string): string {
  if (v.type === "boolean") return raw === "true" || raw === "1" ? "On" : "Off";
  if (v.type === "choice") {
    const c = v.choices?.find((c) => c.value === raw);
    return c?.label ?? raw;
  }
  if (raw === "" || raw == null) return "not set";
  return v.unit ? `${raw} ${v.unit}` : raw;
}

const authHeaders = (): Record<string, string> => {
  const t = authToken();
  return t
    ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
};

/**
 * An objection a new proposal may say it answers, as the server offers it.
 *
 * No person in this shape, and there never may be one. Where an objection led
 * is a fact about a decision, and one member-shaped field here is the whole
 * distance between that and a scoreboard.
 * `server/lib/objectionLineageShape.test.ts` holds the line across the tree,
 * and it is the reason this comment describes the forward edge instead of
 * spelling its column name: that guard keeps the lineage SHAPE inside the
 * governance components, and it is right to be strict about it.
 */
interface AnswerableObjection {
  id: string;
  text: string;
  status: string;
  ballotId: string;
  ballotTitle: string;
  closedAt: string | null;
}

/** Enough of an objection to recognise it in a list, and no more. */
function objectionSummary(o: AnswerableObjection): string {
  const words = o.text.trim().replace(/\s+/g, " ");
  const shown = words.length > 90 ? `${words.slice(0, 89)}…` : words;
  return `${shown} (on "${o.ballotTitle}")`;
}

/** The per-dial editor: the input a member adjusts to stage a change. */
function DialEditor({
  v,
  staged,
  onStage,
}: {
  v: MechanicsVariable;
  staged: string | undefined;
  onStage: (key: string, value: string | undefined) => void;
}) {
  const current = staged ?? v.value;
  const cls = "border border-stone-200 rounded-lg px-2 py-1 text-sm w-full max-w-[220px]";
  if (v.type === "boolean") {
    return (
      <select
        aria-label={`Proposed value for ${v.label}`}
        value={current === "true" || current === "1" ? "true" : "false"}
        onChange={(e) => onStage(v.key, e.target.value === v.value ? undefined : e.target.value)}
        className={cls}
      >
        <option value="true">On</option>
        <option value="false">Off</option>
      </select>
    );
  }
  if (v.type === "choice") {
    return (
      <select
        aria-label={`Proposed value for ${v.label}`}
        value={current}
        onChange={(e) => onStage(v.key, e.target.value === v.value ? undefined : e.target.value)}
        className={cls}
      >
        {(v.choices ?? []).map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    );
  }
  if (v.type === "text") {
    return (
      <input
        aria-label={`Proposed value for ${v.label}`}
        value={current}
        onChange={(e) => onStage(v.key, e.target.value === v.value ? undefined : e.target.value)}
        className={cls}
      />
    );
  }
  return (
    <input
      type="number"
      aria-label={`Proposed value for ${v.label}`}
      min={v.min ?? undefined}
      max={v.max ?? undefined}
      step={v.type === "integer" ? 1 : "any"}
      value={current}
      onChange={(e) => onStage(v.key, e.target.value === v.value ? undefined : e.target.value)}
      className={cls}
    />
  );
}

export default function GameMechanics() {
  const cfg = useGameConfig();
  // A LABEL. Who may withdraw is unchanged: the route still checks
  // proposal.decide and isAdmin, and this only says the village's word for it.
  const catalyst = useCatalyst();
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<MechanicsSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [history, setHistory] = useState<Amendment[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});
  const [dialQuery, setDialQuery] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [standing, setStanding] = useState<Standing | null>(null);
  const [staged, setStaged] = useState<Record<string, string>>({});
  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [rationale, setRationale] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [problems, setProblems] = useState<Array<{ key: string; problem: string }>>([]);
  /*
   * The objections a proposal opened today may say it answers, and the one the
   * proposer picked for each proposal. Both come from the server: the list is
   * exactly what `objectionLineageProblem` will accept, so nobody is offered a
   * choice that comes back refused.
   */
  const [answerable, setAnswerable] = useState<AnswerableObjection[]>([]);
  const [answersFor, setAnswersFor] = useState<Record<string, string>>({});

  // A notification about a proposal lands ON the proposal. The dependency is
  // the list length because the target arrives with the fetch, not with the
  // first paint.
  useFocusTarget([proposals.length]);

  const loadProposals = useCallback(() => {
    fetch("/api/game/mechanics/proposals")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setProposals(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  const loadStanding = useCallback(() => {
    if (!authToken()) return;
    fetch("/api/game/mechanics/standing", { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then(setStanding)
      .catch(() => {});
  }, []);

  /*
   * A failed read leaves the list empty and the picker simply does not appear,
   * which is the honest outcome: naming an objection is optional, so a page
   * that cannot reach the record offers nothing and every proposal still
   * opens. A guess about which objections exist would be worse than silence.
   */
  const loadAnswerable = useCallback(() => {
    if (!authToken()) return;
    fetch("/api/governance/objections/answerable", { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setAnswerable(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/game/mechanics")
      .then((r) => {
        if (!r.ok) throw new Error(`mechanics ${r.status}`);
        return r.json();
      })
      .then(setSnapshot)
      .catch(() => setFailed(true));
    loadProposals();
  }, [loadProposals]);

  useEffect(() => {
    loadStanding();
    loadAnswerable();
  }, [user, loadStanding, loadAnswerable]);

  const openHistory = () => {
    setHistoryOpen((v) => !v);
    if (history === null) {
      fetch("/api/game/mechanics/history")
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => setHistory(Array.isArray(d) ? d : []))
        .catch(() => setHistory([]));
    }
  };

  const stage = (key: string, value: string | undefined) => {
    setStaged((s) => {
      const next = { ...s };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  };

  const stagedCount = Object.keys(staged).length;

  const submitProposal = async () => {
    setSubmitting(true);
    setFeedback(null);
    setProblems([]);
    try {
      const res = await fetch("/api/game/mechanics/proposals", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          title,
          rationale,
          changes: Object.entries(staged).map(([key, to]) => ({ key, to })),
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setProblems(Array.isArray(d.problems) ? d.problems : []);
        setFeedback({ ok: false, text: d.message ?? d.error ?? "Something went wrong" });
      } else {
        setFeedback({ ok: true, text: d.message ?? "Proposed." });
        setStaged({});
        setTitle("");
        setRationale("");
        setComposerOpen(false);
        loadProposals();
      }
    } catch {
      setFeedback({ ok: false, text: "Something went wrong. Try again." });
    }
    setSubmitting(false);
  };

  const act = async (path: string, body?: unknown) => {
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: authHeaders(),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setFeedback({ ok: false, text: d?.message ?? d?.error ?? "That did not work" });
        return null;
      }
      loadProposals();
      loadStanding();
      return d;
    } catch {
      setFeedback({ ok: false, text: "That did not work. Try again." });
      return null;
    }
  };

  const copyDocument = async (id: string) => {
    try {
      const res = await fetch(`/api/game/mechanics/proposals/${id}/document`);
      const d = await res.json();
      await navigator.clipboard.writeText(d.markdown);
      setFeedback({ ok: true, text: "Proposal document copied. Paste it into the Hypha proposal, and keep the [gm:…] marker in the title." });
    } catch {
      setFeedback({ ok: false, text: "Couldn't copy. Open the document and copy it by hand." });
    }
  };

  /** Copy ALWAYS, then open Hypha when the village has one configured — the
   *  clipboard is the fallback for create pages that don't read prefill
   *  params yet, and the [gm:] marker in the title is the thread home. */
  const continueToHypha = async (id: string) => {
    try {
      const res = await fetch(`/api/game/mechanics/proposals/${id}/handoff`);
      const d = await res.json();
      await navigator.clipboard.writeText(d.markdown).catch(() => {});
      if (d.configured && d.url) {
        window.open(d.url, "_blank", "noopener,noreferrer");
        setFeedback({
          ok: true,
          text: `Hypha opened and the document is on your clipboard. Keep ${d.title.slice(0, 24)}… in the title, and when the proposal exists, paste its URL back here with "Link the on-chain proposal". The chain reports outcomes by number, and that link is how the result finds its way home.`,
        });
      } else {
        setFeedback({
          ok: true,
          text: "Document copied. This village has no Hypha configured yet. A founder sets it under Admin → Game Mechanics → Hypha.",
        });
      }
    } catch {
      setFeedback({ ok: false, text: "Couldn't prepare the handoff. Try again." });
    }
  };

  /**
   * Take a proposal to the village's own vote. The route this reaches had no
   * caller anywhere in the client until now, so the shipped default posture
   * (`governance.default_method` at `custom`, the governance engine on) had
   * every door to Hypha and none to the vote the village had chosen to hold.
   *
   * The confirm states the two consequences a member cannot undo and cannot
   * see coming: the whole roll is asked, and the weights freeze as they stand
   * today. Both are the snapshot law, and both belong in front of the person
   * pressing the button.
   */
  const openBallot = async (p: Proposal) => {
    if (
      !window.confirm(
        `Open the village vote on "${p.title}"? Everyone on the roll is asked, and the voting weights freeze as they stand today.`,
      )
    )
      return;
    /*
     * THE OBJECTION THIS VERSION ANSWERS, IF THE PROPOSER NAMES ONE (0102).
     *
     * Optional, and it has to stay optional: the route's own comment says a
     * proposer who names nothing still opens, and most proposals name nothing
     * because most decisions never carried an objection in the first place.
     * The field is left OFF the body entirely when nothing is chosen, so a
     * vote opened without it is byte-identical to every vote opened before
     * this picker existed.
     */
    const answers = answersFor[p.id];
    const d = await act(
      `/api/governance/mechanics/${p.id}/open-ballot`,
      answers ? { answersObjectionId: answers } : undefined,
    );
    /*
     * ASK THE RECORD AGAIN EITHER WAY. Self-audit after this was green: the
     * refresh sat inside the success branch, so the one case that most needs
     * it kept a stale list. A proposer who names an objection somebody else's
     * proposal claimed first meets "already points at", and the picker would
     * then still be offering the objection that refusal is about, so trying
     * again gets the same answer. The list is the server's to state.
     */
    loadAnswerable();
    if (d) {
      setAnswersFor((s) => {
        const next = { ...s };
        delete next[p.id];
        return next;
      });
      setFeedback({
        ok: true,
        text: answers
          ? "The village vote is open, everyone on the roll has been asked, and the objection you named now points at it."
          : "The village vote is open, and everyone on the roll has been asked.",
      });
    }
  };

  const villageName = cfg?.project?.name ?? "";
  const allDials = snapshot?.variables ?? [];
  /**
   * An amendment's before and after, in the words its dial uses.
   *
   * `mechanics_changes` stores raw strings, and the page printed them raw, so
   * the one amendment the live village has ever recorded reads `1 -> 0` on a
   * public page. That is the same decoding R79 took out of the dial itself,
   * and it survives the flip because the ledger keeps what was stored.
   *
   * The registry is already loaded here, so the type is there to read and the
   * row can say "On" and "Off" the way the dial above it does.
   *
   * A key the snapshot does not carry (a dial belonging to a module this
   * village keeps in preview, which the route hides) falls back to the stored
   * string. That is the literal truth of what was recorded, and never a value
   * this page made up.
   */
  const amendmentValue = (key: string, raw: string | null): string => {
    if (raw == null) return "default";
    const def = allDials.find((v) => v.key === key);
    return def ? displayValue(def, raw) : raw;
  };

  const dialSearch = dialQuery.trim();
  const matchedDials = allDials.filter((v) => dialMatches(v, dialSearch));
  const categories = Array.from(new Set(matchedDials.map((v) => v.category)));
  const allCategoryCount = new Set(allDials.map((v) => v.category)).size;
  const backedIds = new Set((standing?.backed ?? []).filter((b) => b.kind === "support").map((b) => b.proposalId));
  const isAdminViewer = user?.role === "admin" || user?.role === "founder";
  const gov = snapshot?.governance ?? null;
  const onSite = gov?.decidesBy === "onsite";
  // The public answer, with the signed-in one as the fallback for the moment
  // before the snapshot lands. They read the same variable.
  const supportThreshold = gov?.supportThreshold ?? standing?.supportThreshold ?? 0;
  /**
   * Whether THIS viewer may take THIS proposal to the vote, answered from the
   * standing payload the routes enforce with. The open-ballot route admits
   * the proposer or a `proposal.open` holder and refuses below the support
   * threshold, so all three halves of its answer are asked here and a member
   * never meets the button by being told no.
   */
  const mayOpenBallotOn = (p: Proposal) =>
    onSite &&
    p.status === "open" &&
    !!standing &&
    !standing.denied &&
    (standing.mayOpenBallot || standing.mine.includes(p.id)) &&
    p.supports >= supportThreshold;
  const activeProposals = proposals.filter(
    (p) => p.status !== "withdrawn" && p.status !== "applied" && p.status !== "failed",
  );
  const settledProposals = proposals.filter(
    (p) => p.status === "withdrawn" || p.status === "applied" || p.status === "failed",
  );

  return (
    <Layout>
      <section className="bg-teal-deep text-white py-16">
        <div className="container max-w-3xl mx-auto px-4 text-center">
          <Scale className="w-8 h-8 text-amber mx-auto mb-3" />
          <h1 className="font-display text-4xl md:text-5xl font-bold mb-3">Game Mechanics</h1>
          {/* No venue in this sentence. It renders before the snapshot lands,
              and where the binding vote happens is this village's own answer:
              the old wording named Hypha as a flat fact and was false for
              every village running its own ballots. The Proposals section
              says which, once the page knows. */}
          <p className="text-white/80 max-w-2xl mx-auto">
            Every rule this Game runs on, in the open, and yours to change. Adjust a dial to
            start a proposal; the village senses it here, then votes on it, and every
            change lands on the permanent record.
            {villageName ? ` This is how ${villageName} plays.` : ""}
          </p>
        </div>
      </section>

      <section className="bg-stone-50 py-14">
        <div className="container max-w-3xl mx-auto px-4 space-y-12">
          {feedback && (
            <p
              role={feedback.ok ? "status" : "alert"}
              className={`text-sm rounded-lg px-4 py-2.5 ${feedback.ok ? "text-teal-deep bg-teal-deep/10" : "text-red-600 bg-red-50"}`}
            >
              {feedback.text}
            </p>
          )}
          {failed && (
            <p role="alert" className="text-center text-muted-foreground">
              The mechanics couldn't be loaded just now. Reload to try again.
            </p>
          )}
          {!snapshot && !failed && <p className="text-center text-muted-foreground">Loading the rules of the Game…</p>}

          {snapshot && (
            <>
              {/* 1 — The constitution */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Lock className="w-5 h-5 text-teal-deep" />
                  <h2 className="font-display text-2xl font-bold text-teal-deep">The Constitution</h2>
                </div>
                <p className="text-sm text-stone-600 mb-5 max-w-2xl">
                  These are enforced by the platform itself and cannot be changed by any vote,
                  admin, or founder. Everything below them is tunable <em>because</em> these are not.
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                  {snapshot.constitution.map((law) => (
                    <motion.div
                      key={law.title}
                      initial={{ opacity: 0, y: 8 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      className="bg-white rounded-xl border border-stone-200 p-4"
                    >
                      <h3 className="font-semibold text-stone-900 mb-1.5">{law.title}</h3>
                      <p className="text-sm text-stone-600 leading-relaxed">{law.plain}</p>
                      <p className="text-[11px] text-stone-400 mt-2 font-mono">{law.enforcedBy}</p>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* 2 — The dials, now editable */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <SlidersHorizontal className="w-5 h-5 text-teal-deep" />
                  <h2 className="font-display text-2xl font-bold text-teal-deep">The Dials</h2>
                </div>
                <p className="text-sm text-stone-600 mb-2 max-w-2xl">
                  Every tunable rule, grouped by the part of the Game it shapes.{" "}
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-xs align-middle">
                    <Users className="w-3 h-3" /> community
                  </span>{" "}
                  dials can be changed by proposal. Adjust one below to begin.{" "}
                  <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 text-stone-600 px-2 py-0.5 text-xs align-middle">
                    <Lock className="w-3 h-3" /> founder-held
                  </span>{" "}
                  dials stay with the founders. Every dial only ever moves within the bounds shown.
                </p>
                {!user && (
                  <p className="text-xs text-stone-500 mb-5">
                    Sign in to stage changes and propose. Reading is open to everyone.
                  </p>
                )}
                {standing?.denied && (
                  <p role="alert" className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-5 inline-block">
                    A standing warning currently suspends your proposal rights. Talk to a steward.
                  </p>
                )}
                {standing && !standing.denied && !standing.qualified && (
                  <p className="text-xs text-stone-500 mb-5">
                    You can draft proposals; a qualified member's sponsorship opens them.
                    {standing.recognitionRequired > 0 &&
                      ` Full standing takes ${standing.recognitionRequired} earned recognition (you have ${standing.recognitionHeld}).`}
                  </p>
                )}
                {/*
                  * FINDING A DIAL YOU CANNOT NAME (R79).
                  *
                  * THE COLLAPSE DEFAULT IS DELIBERATE AND IT STAYS SHUT. This
                  * list holds every tunable rule in the Game, spread over more
                  * than two dozen categories. Opening them all makes the
                  * headings scenery to scroll past. Shut, they are a map of
                  * the Game a founder can steer by.
                  *
                  * TYPING IS THE FOUNDER'S INTENT, SO THE SEARCH MOVES THE
                  * DEFAULT FOR THEM. A category holding a match opens itself,
                  * and the header button still wins if they want it closed.
                  * Every match is really rendered, so Tab walks the results
                  * and nobody has to find a control and press it first.
                  */}
                <div className="mb-4 max-w-md">
                  <label htmlFor="dial-search" className="sr-only">
                    Search the dials
                  </label>
                  <input
                    id="dial-search"
                    type="search"
                    value={dialQuery}
                    onChange={(e) => setDialQuery(e.target.value)}
                    placeholder="Search dials by name, key, or what they do"
                    className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
                  />
                  <p aria-live="polite" className="text-xs text-stone-500 mt-1">
                    {dialSearch
                      ? `${matchedDials.length} of ${allDials.length} dials match.`
                      : `${allDials.length} dials in ${allCategoryCount} categories.`}
                  </p>
                </div>
                {dialSearch && categories.length === 0 && (
                  <p className="text-sm text-stone-500">
                    No dial matches that. The search reads each dial's name, its key, its
                    category, and the description under it.
                  </p>
                )}
                <div className="space-y-3">
                  {categories.map((cat) => {
                    const vars = matchedDials.filter((v) => v.category === cat);
                    // A search opens what it found; an explicit toggle still wins.
                    const open = dialSearch ? (openCategories[cat] ?? true) : !!openCategories[cat];
                    const tuned = vars.filter((v) => !v.isDefault).length;
                    const stagedHere = vars.filter((v) => staged[v.key] !== undefined).length;
                    return (
                      <div key={cat} className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setOpenCategories((s) => ({ ...s, [cat]: !open }))}
                          aria-expanded={open}
                          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-stone-50"
                        >
                          <span className="font-semibold text-stone-900">
                            {cat}
                            <span className="ml-2 text-xs font-normal text-stone-400">
                              {vars.length} {dialSearch ? "matching " : ""}dial{vars.length === 1 ? "" : "s"}
                              {tuned > 0 ? ` · ${tuned} village-tuned` : ""}
                              {stagedHere > 0 ? ` · ${stagedHere} staged` : ""}
                            </span>
                          </span>
                          <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform ${open ? "rotate-180" : ""}`} />
                        </button>
                        {open && (
                          <ul className="divide-y divide-stone-100">
                            {vars.map((v) => {
                              const stagedValue = staged[v.key];
                              const editable = !!user && v.ring === "open" && !standing?.denied;
                              return (
                                <li key={v.key} className={`px-4 py-3 ${stagedValue !== undefined ? "bg-amber-50/40" : ""}`}>
                                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                    <span className="font-medium text-stone-900">{v.label}</span>
                                    <span className="text-teal-deep font-semibold">
                                      {displayValue(v, v.value)}
                                      {stagedValue !== undefined && (
                                        <span className="ml-2 text-amber-700 font-semibold">→ {displayValue(v, stagedValue)}</span>
                                      )}
                                      {!v.isDefault && stagedValue === undefined && (
                                        <span className="ml-2 text-[11px] font-normal text-teal-deep/70 align-middle">
                                          village-tuned · default {displayValue(v, v.default)}
                                        </span>
                                      )}
                                    </span>
                                  </div>
                                  <p className="text-sm text-stone-600 mt-1 leading-relaxed">{v.description}</p>
                                  {editable && (
                                    <div className="mt-2 flex items-center gap-2">
                                      <DialEditor v={v} staged={stagedValue} onStage={stage} />
                                      {stagedValue !== undefined && (
                                        <button
                                          type="button"
                                          onClick={() => stage(v.key, undefined)}
                                          aria-label={`Unstage change to ${v.label}`}
                                          className="text-stone-400 hover:text-stone-600"
                                        >
                                          <X className="w-4 h-4" />
                                        </button>
                                      )}
                                    </div>
                                  )}
                                  <p className="text-[11px] text-stone-400 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                                    {v.ring === "open" ? (
                                      <span className="inline-flex items-center gap-1 text-emerald-700">
                                        <Users className="w-3 h-3" /> community dial
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1">
                                        <Lock className="w-3 h-3" /> founder-held
                                      </span>
                                    )}
                                    {v.min != null && v.max != null && (
                                      <span>
                                        bounds {v.min}-{v.max}
                                      </span>
                                    )}
                                    {v.applyTiming === "cycle-close" && <span>changes take effect at the next cycle close</span>}
                                    <span className="font-mono">{v.key}</span>
                                  </p>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 3 — Open proposals */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Megaphone className="w-5 h-5 text-teal-deep" />
                  <h2 className="font-display text-2xl font-bold text-teal-deep">Proposals</h2>
                </div>
                {/* The venue, from the server, in the one place the page has
                    room to say it. Both readings are true of a real village:
                    `governance.default_method` decides which, and a village
                    that chooses Hypha keeps every word of the shipped loop.

                    The threshold reads off the PUBLIC payload now. It came
                    from /standing, which needs a token, so the one sentence
                    saying what sends a proposal to the vote was invisible to
                    everybody who was not signed in, on a page whose whole
                    claim is that the rules are visible to everyone. It also
                    governs whether the door below appears, and a door that
                    comes and goes on a number nobody was shown is the kind of
                    thing a member reads as the page being broken. */}
                <p className="text-sm text-stone-600 mb-5 max-w-2xl">
                  Rule changes the village is weighing. Support gathers here
                  {supportThreshold > 0
                    ? ` (${supportThreshold} supporter${supportThreshold === 1 ? "" : "s"} sends one to the vote)`
                    : ""}
                  {onSite
                    ? "; the binding vote runs here, on this village's own ballot, and a proposal that carries is"
                    : "; the binding vote runs on the village's Hypha, and a proposal that carries is"}{" "}
                  applied and recorded on the amendment ledger.
                </p>
                {activeProposals.length === 0 && (
                  <p className="text-sm text-stone-500">
                    Nothing is being proposed right now. Adjust a community dial above to start.
                  </p>
                )}
                <div className="space-y-3">
                  {activeProposals.map((p) => {
                    // Proposer-only actions render for every signed-in member;
                    // the server answers an honest 403 for anyone else.
                    const status = statusChip(p.status);
                    return (
                      <div
                        key={p.id}
                        // The anchor a notification lands on. `scroll-mt-24`
                        // keeps it out from under the sticky header, which is
                        // SC 2.4.11 and not a preference.
                        id={`proposal-${p.id}`}
                        className="bg-white rounded-xl border border-stone-200 p-4 scroll-mt-24 focus:outline-none"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                          <h3 className="font-semibold text-stone-900">{p.title}</h3>
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${status.cls}`}>{status.label}</span>
                            <BallotReturnChip proposal={p} />
                          </span>
                        </div>
                        <p className="text-xs text-stone-400 mb-2">
                          by {p.proposer} · {new Date(p.createdAt).toLocaleDateString()} · {p.supports} supporter
                          {p.supports === 1 ? "" : "s"}
                          {p.sponsors > 0 ? ` · sponsored` : ""}
                        </p>
                        <p className="text-sm text-stone-600 mb-3 leading-relaxed">{p.rationale}</p>
                        <BallotReturnNote proposal={p} />
                        <WaitingNote proposal={p} gov={gov} />
                        <ul className="text-sm space-y-1 mb-3">
                          {p.changes.map((c) => (
                            <li key={c.key}>
                              <span className="text-stone-700">{c.label}:</span>{" "}
                              <span className="line-through text-stone-400">{c.fromDisplay}</span> →{" "}
                              <span className="font-semibold text-teal-deep">{c.toDisplay}</span>
                              {c.applyTiming === "cycle-close" && (
                                <span className="text-[11px] text-stone-400"> (at next cycle close)</span>
                              )}
                              {c.currentValue !== null && c.currentValue !== c.from && (
                                <span className="text-[11px] text-amber-700"> · baseline has since moved to {c.currentValue}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                        <div className="flex flex-wrap items-center gap-2">
                          {user && p.status === "open" && !backedIds.has(p.id) && (
                            <button
                              type="button"
                              onClick={() => act(`/api/game/mechanics/proposals/${p.id}/support`)}
                              className="text-sm bg-teal-deep text-white rounded-lg px-3 py-1.5 font-medium hover:bg-teal"
                            >
                              Support
                            </button>
                          )}
                          {user && p.status === "open" && backedIds.has(p.id) && (
                            <span className="text-xs text-emerald-700">You support this</span>
                          )}
                          {user && p.status === "draft" && standing?.qualified && (
                            <button
                              type="button"
                              onClick={() => act(`/api/game/mechanics/proposals/${p.id}/sponsor`)}
                              className="text-sm bg-teal-deep text-white rounded-lg px-3 py-1.5 font-medium hover:bg-teal"
                            >
                              Sponsor this draft
                            </button>
                          )}
                          {/* THE DOOR TO THE VILLAGE'S OWN VOTE. The route
                              behind it shipped complete and unreachable: no
                              caller anywhere in this client, so the shipped
                              default posture had every door leading to Hypha
                              and none to the ballot the village had chosen to
                              hold. Admin was the only way in, which is exactly
                              the shape R54 rules out. */}
                          {mayOpenBallotOn(p) && (
                            <button
                              type="button"
                              onClick={() => openBallot(p)}
                              className="text-sm bg-teal-deep text-white rounded-lg px-3 py-1.5 font-medium hover:bg-teal"
                            >
                              Open the village vote
                            </button>
                          )}
                          {/* THE PROPOSER NAMES WHAT THIS ANSWERS (0102).
                              An objection that changed a proposal should say
                              so on its own page, and the only person who knows
                              which objection this version answers is the
                              person opening the vote. The write path shipped
                              with no sender at all, so this was reachable by
                              curl and by nothing else.

                              Shown only when the record holds something to
                              name, so a village that has never carried an
                              objection sees the button exactly as it was.
                              Optional, and it stays optional: the empty choice
                              is first and it is the default. */}
                          {mayOpenBallotOn(p) && answerable.length > 0 && (
                            <label className="flex flex-col gap-1 basis-full text-xs text-stone-600">
                              <span>Does this answer an objection? Naming one is optional.</span>
                              <select
                                value={answersFor[p.id] ?? ""}
                                onChange={(e) =>
                                  setAnswersFor((s) => {
                                    const next = { ...s };
                                    if (e.target.value) next[p.id] = e.target.value;
                                    else delete next[p.id];
                                    return next;
                                  })
                                }
                                className="min-h-[44px] max-w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm text-stone-800"
                              >
                                <option value="">Nothing to name</option>
                                {answerable.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {objectionSummary(o)}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          <button
                            type="button"
                            onClick={() => copyDocument(p.id)}
                            className="inline-flex items-center gap-1.5 text-sm text-teal-deep font-medium hover:underline"
                          >
                            <Copy className="w-3.5 h-3.5" /> {onSite ? "Copy this proposal" : "Copy for Hypha"}
                          </button>
                          {/* The Hypha route-out is offered while this village
                              votes on Hypha, and for a proposal that is ALREADY
                              there whatever the village decided since. A
                              founder who moves the village on-site leaves
                              proposals mid-flight on the chain, and those keep
                              every door they need to come home. */}
                          {(p.status === "to_hypha" || (p.status === "open" && !onSite)) && (
                            <button
                              type="button"
                              onClick={() => continueToHypha(p.id)}
                              className="inline-flex items-center gap-1.5 text-sm text-teal-deep font-medium hover:underline"
                            >
                              Continue to Hypha ↗
                            </button>
                          )}
                          {user && p.status === "open" && !onSite && (
                            <button
                              type="button"
                              onClick={() => act(`/api/game/mechanics/proposals/${p.id}/to-hypha`)}
                              className="text-sm text-stone-600 hover:text-stone-900 hover:underline"
                              title="Proposer only: marks this as taken to Hypha for the binding vote"
                            >
                              I've taken it to Hypha
                            </button>
                          )}
                          {user && (p.status === "to_hypha" || p.status === "passed_claimed") && (
                            <button
                              type="button"
                              onClick={() => {
                                const url = window.prompt(
                                  p.hyphaProposalId
                                    ? `Linked to on-chain proposal #${p.hyphaProposalId}. Paste a corrected Hypha proposal URL to re-link:`
                                    : "Paste the Hypha proposal's URL (from your browser after creating it) so the on-chain vote can find this proposal:",
                                  p.hyphaProposalUrl ?? "",
                                );
                                if (url) act(`/api/game/mechanics/proposals/${p.id}/link-hypha`, { url });
                              }}
                              className={`text-sm font-medium hover:underline ${p.hyphaProposalId ? "text-emerald-700" : "text-amber-700"}`}
                              title="The chain reports outcomes by proposal number, not by title. This link is how the verified result finds its way home"
                            >
                              {p.hyphaProposalId
                                ? `On-chain #${p.hyphaProposalId} linked${p.hubLinkSynced ? " ✓" : " (hub sync pending, click to retry)"}`
                                : "Link the on-chain proposal"}
                            </button>
                          )}
                          {user && p.status === "to_hypha" && (
                            <button
                              type="button"
                              onClick={() => {
                                const ref = window.prompt(
                                  "It passed? Paste the Hypha proposal link (or id) so a steward can verify and apply:",
                                );
                                if (ref) act(`/api/game/mechanics/proposals/${p.id}/passed`, { ref });
                              }}
                              className="text-sm text-stone-600 hover:text-stone-900 hover:underline"
                            >
                              It passed on Hypha
                            </button>
                          )}
                          {/* APPLYABLE, not a list retyped here. This condition
                              read three statuses while the route accepted
                              four, so a proposal the village carried at its
                              own vote and the brake was holding could be
                              applied by nothing at all. The confirm asks the
                              right question for the vote that actually
                              happened: a Hypha result is a claim about
                              somebody else's chain and wants checking, and a
                              ballot this village ran and closed itself was
                              already counted here. */}
                          {isAdminViewer && APPLYABLE.has(p.status) && (
                            <button
                              type="button"
                              onClick={() => {
                                const onsiteVote = p.status === "passed_onsite";
                                if (
                                  window.confirm(
                                    onsiteVote
                                      ? `Apply "${p.title}" now? The village carried this at its own vote and it is waiting on a hand. Every change lands on the public ledger under this proposal's reference.`
                                      : `Apply "${p.title}" now? Verify it actually passed on Hypha first${p.hyphaRef ? ` (${p.hyphaRef})` : ""}. Every change lands on the public ledger under this proposal's reference.`,
                                  )
                                )
                                  act(`/api/admin/mechanics/proposals/${p.id}/apply`);
                              }}
                              className="text-sm bg-amber text-foreground rounded-lg px-3 py-1.5 font-medium"
                            >
                              {p.status === "passed_onsite" ? "Apply this" : "Verify & apply"}
                            </button>
                          )}
                          {user && (p.status === "open" || p.status === "draft") && (
                            <button
                              type="button"
                              onClick={() => act(`/api/game/mechanics/proposals/${p.id}/withdraw`)}
                              className="text-sm text-stone-400 hover:text-red-600 hover:underline"
                              title={`Proposer or ${catalyst.name} only`}
                            >
                              Withdraw
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {settledProposals.length > 0 && (
                  <details className="mt-4">
                    <summary className="text-sm text-stone-500 cursor-pointer">
                      {settledProposals.length} settled proposal{settledProposals.length === 1 ? "" : "s"} (applied,
                      withdrawn, or did not pass)
                    </summary>
                    <ul className="mt-2 space-y-1.5">
                      {settledProposals.map((p) => (
                        <li key={p.id} className="text-sm text-stone-500">
                          <span className={`text-xs px-1.5 py-0.5 rounded-full mr-2 ${statusChip(p.status).cls}`}>
                            {statusChip(p.status).label}
                          </span>
                          {p.title} · by {p.proposer}
                          {p.ballotId && (
                            <>
                              {" · "}
                              <Link href={`/decisions/${p.ballotId}`} className="text-teal-deep hover:underline">
                                see its vote
                              </Link>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>

              {/* 4 — The amendment history */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <ScrollText className="w-5 h-5 text-teal-deep" />
                  <h2 className="font-display text-2xl font-bold text-teal-deep">Amendment History</h2>
                </div>
                <p className="text-sm text-stone-600 mb-4 max-w-2xl">
                  Every change to the rules is on the permanent record: what moved, from what to
                  what, by whom, and under which passed proposal.
                </p>
                <button
                  type="button"
                  onClick={openHistory}
                  aria-expanded={historyOpen}
                  className="inline-flex items-center gap-2 bg-teal-deep text-white font-semibold px-5 py-2.5 rounded-xl hover:bg-teal transition-colors"
                >
                  <ScrollText className="w-4 h-4" />
                  {historyOpen ? "Hide the history" : "Explore the history"}
                </button>
                {historyOpen && (
                  <div className="mt-4 bg-white rounded-xl border border-stone-200 overflow-hidden">
                    {history === null ? (
                      <p className="px-4 py-6 text-sm text-stone-500">Loading the record…</p>
                    ) : history.length === 0 ? (
                      <p className="px-4 py-6 text-sm text-stone-500">
                        No rules have been changed yet. This Game still plays entirely by its platform defaults.
                      </p>
                    ) : (
                      <ul className="divide-y divide-stone-100">
                        {history.map((h) => (
                          <li key={h.id} className="px-4 py-3">
                            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                              <span className="font-medium text-stone-900">{h.label}</span>
                              <span className="text-xs text-stone-400">
                                {new Date(h.at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                              </span>
                            </div>
                            <p className="text-sm text-stone-600 mt-0.5">
                              <span className="line-through text-stone-400">
                                {amendmentValue(h.key, h.from)}
                                {h.fromWasDefault ? " (default)" : ""}
                              </span>{" "}
                              → <span className="font-semibold text-teal-deep">{amendmentValue(h.key, h.to)}</span>
                              {h.toIsDefault ? " (back to default)" : ""}
                              {h.by ? ` · by ${h.by}` : ""}
                              {h.source === "governance" ? " · by passed proposal" : ""}
                              {h.source === "platform" ? " · platform migration" : ""}
                            </p>
                            {h.proposalRef && (
                              <p className="text-[11px] text-stone-400 mt-0.5">
                                <span className="font-mono">proposal: {h.proposalRef}</span>
                                {ballotIdIn(h.proposalRef) && (
                                  <>
                                    {" · "}
                                    <Link
                                      href={`/decisions/${ballotIdIn(h.proposalRef)}`}
                                      className="text-teal-deep hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
                                    >
                                      read the vote that decided this
                                    </Link>
                                  </>
                                )}
                              </p>
                            )}
                            {h.note && <p className="text-[11px] text-stone-400 mt-0.5">{h.note}</p>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      {/* The proposal basket: staged changes become a proposal. Sticky above
          the mobile tab bar (z-[70] modal ladder, bar is z-50). */}
      {stagedCount > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-[70] bg-white border-t border-stone-200 shadow-lg pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
          <div className="container max-w-3xl mx-auto px-4 pt-3">
            {!composerOpen ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-stone-700">
                  <span className="font-semibold">{stagedCount}</span> change{stagedCount === 1 ? "" : "s"} staged
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStaged({})}
                    className="text-sm text-stone-500 hover:text-stone-700 hover:underline"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => setComposerOpen(true)}
                    className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium hover:bg-teal"
                  >
                    Write the proposal
                  </button>
                </div>
              </div>
            ) : (
              <div className="pb-2">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-stone-900">Propose these changes</h3>
                  <button type="button" onClick={() => setComposerOpen(false)} aria-label="Collapse the composer">
                    <ChevronDown className="w-4 h-4 text-stone-400" />
                  </button>
                </div>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="A title the village will recognize it by"
                  aria-label="Proposal title"
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm mb-2"
                />
                <textarea
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  placeholder="Why this change matters. The village votes on reasons, not numbers."
                  aria-label="Proposal rationale"
                  rows={3}
                  className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm mb-2 resize-y"
                />
                {problems.length > 0 && (
                  <ul role="alert" className="text-xs text-red-600 mb-2 space-y-0.5">
                    {problems.map((p) => (
                      <li key={p.key}>
                        <span className="font-mono">{p.key}</span>: {p.problem}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={submitting || !title.trim() || !rationale.trim()}
                    onClick={submitProposal}
                    className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-50"
                  >
                    {submitting ? "Proposing…" : standing?.qualified ? "Open the proposal" : "Save as draft"}
                  </button>
                  <span className="text-[11px] text-stone-400">
                    {standing?.qualified
                      ? "Opens for village support immediately."
                      : "A qualified member's sponsorship opens it."}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
