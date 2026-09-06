/**
 * /review: what a machine proposed, and what a steward does about it.
 *
 * ── NOT /steward, AND THE REASON IS STRUCTURAL ───────────────────────────
 *
 * `/steward` is a public brochure page. The brand guard lists it on the
 * SHOPFRONT, where a fork replaces the page wholesale and its own village name
 * is not debt. Mounting product machinery there would force it off that list
 * and make every fork inherit somebody else's copy on a page they were meant
 * to rewrite.
 *
 * ── GATED BY CAPABILITY AND NEVER BY ROLE ────────────────────────────────
 *
 * A steward who is not an admin is who this page is for. The dead end it is
 * careful not to repeat: the server already accepts a non-admin holding
 * `quest.consent` on three routes, and the only client surface for it sits
 * behind an `isAdmin` check, so that capability is exercisable today only with
 * curl. This page asks the server what it may do and renders that answer.
 *
 * ── A FAILED READ IS NEVER AN EMPTY QUEUE ────────────────────────────────
 *
 * Copied from the draft queue in Admin.tsx, which states the reasoning inline
 * and is right. A queue of proposals sitting on the server while the page says
 * positively that there is nothing to review is a governance failure and not a
 * cosmetic one. THREE states are told apart here and never collapsed: the read
 * failed, the person may not open it, and there is genuinely nothing waiting.
 *
 * ── THE CARD BODY COPIES THE CALLS TAB ───────────────────────────────────
 *
 * That surface renders machine suggestions the right way round: the evidence
 * is a quoted verbatim string with a formatted time, and the number of records
 * dropped for failing the evidence rule is printed out loud. Both are here.
 * The drop count matters most on an empty queue, where it is the difference
 * between "nothing arrived" and "everything arrived and all of it was
 * refused".
 *
 * ── EDITING BEFORE ACCEPTING IS THE CENTRE OF THIS PAGE ──────────────────
 *
 * The server has re-validated an edited payload at accept since the draft
 * queue was written, and no client has ever sent one. It is the only path by
 * which a proposal naming a person can be redacted before it lands. The
 * textarea is the point of the screen.
 */
import Layout from "@/components/Layout";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { authToken } from "@/lib/gameApi";
import { toast } from "sonner";
import { Inbox } from "lucide-react";

interface ProposalCard {
  id: string;
  batchId: string;
  moduleId: string;
  kind: string;
  payload: Record<string, unknown>;
  quote: string | null;
  sourceRef: string | null;
  sourceOccurredAt: string | null;
  evidence: "quoted" | "anchored" | "absent";
  audience: "steward" | "member";
  trustTier: string;
  confidence: number | null;
  significance: number | null;
  subjectRef: string | null;
  receivedAt: string;
  correlationId: string | null;
}

interface Batch {
  batchId: string;
  moduleId: string | null;
  receivedAt: string | null;
  items: ProposalCard[];
}

interface QuestCard {
  id: string;
  batchId: string;
  moduleId: string;
  prose: Record<string, unknown> & { title?: string; description?: string | null };
  rationale: string | null;
  quote: string | null;
  sourceRef: string | null;
  proposedByKind: string;
  receivedAt: string;
}

interface Drop {
  moduleId: string;
  reason: string;
  dropped: number;
  lastAt: string | null;
}

interface Queue {
  batches: Batch[];
  quests: QuestCard[];
  drops: Drop[];
  counts: { proposals: number; quests: number };
}

/**
 * A hand-kept map keyed by the server's own union, which is the shape
 * `check-mirror-annotations.mjs` asks for. A key added on the server without
 * a sentence here is a compile error and never an empty paragraph.
 */
const EVIDENCE_WORDS: Record<ProposalCard["evidence"], string> = {
  quoted: "Quoted from the source, with an anchor",
  anchored: "Anchored to a source, with no verbatim quote",
  absent: "No quote and no source. Held to stewards, never shown to members",
};

const DROP_WORDS: Record<string, string> = {
  contained_an_email: "carried an email address",
  unknown_kind: "were a kind this village does not know",
  unknown_trust_tier: "named a trust tier this village does not read",
  empty_payload: "arrived with nothing in them",
};

/** A time somebody can read, in the reader's own zone. */
function when(iso: string | null): string {
  if (!iso) return "no time given";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "no time given";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Which stores are still owed from, as a sentence a steward can act on.
 * "saberra" gives them somebody to press; a bare count gives them nobody.
 */
function waitingSentence(waitingOn: Record<string, number>): string {
  const names = Object.keys(waitingOn).sort();
  if (names.length === 0) return "A connected service";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** How long the OLDEST obligation has been outstanding, in whole days. */
function agedFor(oldestSince: string | null): string {
  if (!oldestSince) return "";
  const days = Math.floor((Date.now() - new Date(oldestSince).getTime()) / 86400000);
  if (!Number.isFinite(days) || days < 1) return ", asked today";
  return days === 1 ? ", asked one day ago" : `, the oldest ${days} days ago`;
}

export default function Review() {
  const { user } = useAuth();
  const [queue, setQueue] = useState<Queue | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * The three failure states, told apart on purpose. See the header.
   * `loadError` is "the read failed". `forbidden` is "you may not open this".
   * Neither ever renders as an empty queue.
   */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [rewards, setRewards] = useState<Record<string, { gratitude: string; stayCreditReward: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // A draft this queue just made that cannot publish. Held so the steward has
  // a way out of it without leaving the page, because until they withdraw it
  // the draft occupies one of the village's open-draft slots.
  const [stuck, setStuck] = useState<{ draftId: string; blocked: number } | null>(null);

  /**
   * Members whose erasure this village could not finish, because a connected
   * store never confirmed it deleted its copy. Kept state that nobody watches
   * is how "we still owe you a confirmation" becomes "kept forever".
   */
  const [owed, setOwed] = useState<{ count: number; oldestSince: string | null; waitingOn: Record<string, number> } | null>(null);
  const [asking, setAsking] = useState(false);

  const headers = useCallback((): Record<string, string> => {
    const t = authToken();
    return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
  }, []);

  /**
   * Ask every unconfirmed store again. This is the only thing that can finish
   * one of these, because nothing will erase these members a second time.
   */
  const askAgain = async () => {
    setAsking(true);
    try {
      const r = await fetch("/api/review/erasure/retry", { method: "POST", headers: headers() });
      const d = (await r.json().catch(() => ({}))) as { asked?: number; finished?: number; error?: string };
      if (!r.ok) {
        toast.error(d?.error ?? "That did not go through");
        return;
      }
      const finished = d.finished ?? 0;
      toast.success(
        finished > 0
          ? `${finished} of ${d.asked ?? 0} finished. The rest have still not confirmed.`
          : `Asked about ${d.asked ?? 0}. None of them confirmed yet.`,
      );
      await load();
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setAsking(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/review/queue", { headers: headers() });
      if (r.status === 401 || r.status === 403 || r.status === 409) {
        setForbidden(true);
        setLoadError(null);
        return;
      }
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setLoadError((d as { error?: string })?.error ?? "Could not read the queue");
        return;
      }
      setForbidden(false);
      setLoadError(null);
      setQueue(await r.json());
      // A separate read, so a failure here can never empty the queue above it.
      try {
        const e = await fetch("/api/review/erasure", { headers: headers() });
        setOwed(e.ok ? await e.json() : null);
      } catch {
        setOwed(null);
      }
    } catch {
      setLoadError("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    void load();
  }, [load, user?.id]);

  /**
   * The edited payload for one card, or a sentence saying why it cannot be
   * read. Nothing is sent while the text does not parse: a silent fallback to
   * the original would accept the version the steward was trying to correct,
   * which on a redaction is the whole harm.
   */
  const editedPayload = (id: string, original: Record<string, unknown>): Record<string, unknown> | string => {
    const raw = edits[id];
    if (raw === undefined) return original;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return "An edited proposal is an object with named fields.";
      }
      return parsed as Record<string, unknown>;
    } catch {
      return "That edit is not valid JSON yet, so nothing was sent.";
    }
  };

  const post = async (path: string, body: unknown): Promise<boolean> => {
    // The Response is held before anything says a change landed, which is what
    // `check-save-honesty.mjs` asks of every control that reports success.
    const res = await fetch(path, { method: "POST", headers: headers(), body: JSON.stringify(body) }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      toast.error((d as { error?: string })?.error ?? "That did not go through");
      return false;
    }
    return true;
  };

  const acceptOne = async (card: ProposalCard) => {
    const payload = editedPayload(card.id, card.payload);
    if (typeof payload === "string") {
      toast.error(payload);
      return;
    }
    setBusy(card.id);
    try {
      if (await post(`/api/review/proposals/${card.id}/accept`, { payload })) {
        toast.success("Accepted");
        await load();
      }
    } finally {
      setBusy(null);
    }
  };

  const rejectOne = async (card: ProposalCard) => {
    setBusy(card.id);
    try {
      if (await post(`/api/review/proposals/${card.id}/reject`, { note: "" })) {
        toast.success("Rejected");
        await load();
      }
    } finally {
      setBusy(null);
    }
  };

  /**
   * One decision for a whole batch, after per-item edits.
   *
   * The first import from an outside service is one screen and one decision.
   * Every edit the steward has made in this batch rides along, keyed by
   * proposal id, so accepting the batch accepts the corrected versions.
   */
  const withdrawStuck = async () => {
    if (!stuck) return;
    setBusy(stuck.draftId);
    try {
      const res = await fetch(`/api/review/drafts/${stuck.draftId}/withdraw`, {
        method: "POST",
        headers: headers(),
      }).catch(() => null);
      const d = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok) {
        toast.error((d as { error?: string })?.error ?? "That draft could not be withdrawn");
        return;
      }
      const n = (d as { reopened?: number }).reopened ?? 0;
      toast.success(n > 0 ? `Withdrawn, and ${n} proposal(s) are back in the queue` : "Withdrawn");
      setStuck(null);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const acceptBatch = async (batch: Batch) => {
    const payloads: Record<string, unknown> = {};
    for (const item of batch.items) {
      const p = editedPayload(item.id, item.payload);
      if (typeof p === "string") {
        toast.error(`${p} Look at the card above the button.`);
        return;
      }
      if (edits[item.id] !== undefined) payloads[item.id] = p;
    }
    setBusy(batch.batchId);
    try {
      const res = await fetch(`/api/review/batches/${batch.batchId}/accept`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ edits: payloads }),
      }).catch(() => null);
      const d = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok) {
        toast.error((d as { error?: string })?.error ?? "That batch did not go through");
        return;
      }
      // READ `blocked`, WHICH THE SERVER SENDS. This used to read `refused`,
      // a field no route has ever returned, so it was always 0 and the toast
      // always said a flat "N accepted". The server sends `blocked` and says
      // in its own comment that a blocked line means the draft cannot publish
      // until somebody deals with it. Swallowing that here produced exactly
      // the failure that comment was written to prevent: a steward told forty
      // seats were accepted, finding out at the publish button that none of
      // them can apply.
      const body = d as { accepted?: number; blocked?: number; noted?: number; draftId?: string };
      const blocked = body.blocked ?? 0;
      if (blocked > 0 && body.draftId) setStuck({ draftId: body.draftId, blocked });
      if (blocked > 0) {
        toast.error(
          `${body.accepted} accepted, and ${blocked} of the seats cannot apply. This draft will not publish ` +
            `until those are dealt with. Open it in the admin org panel to see which, or withdraw it to put ` +
            `these proposals back in the queue.`,
        );
      } else {
        toast.success(`${body.accepted} accepted`);
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  const acceptQuest = async (q: QuestCard) => {
    const r = rewards[q.id] ?? { gratitude: "", stayCreditReward: "" };
    if (!r.gratitude.trim()) {
      toast.error("Type what this quest pays before it goes on the board.");
      return;
    }
    setBusy(q.id);
    try {
      const ok = await post(`/api/review/quests/${q.id}/accept`, {
        reward: {
          gratitude: r.gratitude.trim(),
          stayCreditReward: r.stayCreditReward.trim() === "" ? null : Number(r.stayCreditReward),
        },
      });
      if (ok) {
        toast.success("On the board");
        await load();
      }
    } finally {
      setBusy(null);
    }
  };

  const card = "bg-card border border-border rounded-xl p-5";

  if (loading && !queue) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto px-4 py-10">
          <p className="text-sm text-muted-foreground">Reading what is waiting.</p>
        </div>
      </Layout>
    );
  }

  if (forbidden) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto px-4 py-10">
          <div className={card}>
            <h1 className="text-xl font-bold text-foreground">This queue is not open to you yet</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Reviewing what an outside service proposes is a job this village hands to somebody. Ask
              whoever looks after the village queues, and they can pass it on.
            </p>
          </div>
        </div>
      </Layout>
    );
  }

  if (loadError) {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto px-4 py-10">
          <div className={card}>
            <h1 className="text-xl font-bold text-foreground">The queue did not load</h1>
            <p className="text-sm text-muted-foreground mt-2">
              {loadError}. There may be proposals waiting; this is not an empty queue.
            </p>
            <button
              onClick={() => void load()}
              className="text-xs border border-border rounded-lg px-3 py-2 mt-4 min-h-[44px]"
            >
              Try again
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  const drops = queue?.drops ?? [];
  const totalDropped = drops.reduce((n, d) => n + d.dropped, 0);
  const nothingWaiting = (queue?.counts.proposals ?? 0) === 0 && (queue?.counts.quests ?? 0) === 0;

  return (
    <Layout>
      <div className="max-w-4xl mx-auto px-4 py-10 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Inbox className="w-6 h-6" aria-hidden="true" />
            Review
          </h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
            What an outside service has proposed about this village. Nothing here is true yet. Read it,
            change anything you want, and accept what the village agrees with. What you accept goes into
            a draft you can preview and undo.
          </p>
        </div>

        {/* What the village still owes somebody who left. The only item on
            this screen about a person already gone, and it is here because
            nothing else will ever ask about them again. */}
        {owed && owed.count > 0 && (
          <div className={card}>
            <h2 className="text-sm font-semibold text-foreground">
              {owed.count === 1 ? "One member" : `${owed.count} members`} left, and this village is not finished on their behalf
            </h2>
            <p className="text-sm text-muted-foreground mt-2">
              Their data is gone from here. {waitingSentence(owed.waitingOn)} has not confirmed deleting
              its own copy{agedFor(owed.oldestSince)}. Nothing asks again on its own, because the people
              this concerns have already left.
            </p>
            <button
              className="mt-3 text-sm bg-teal-deep text-white rounded-lg px-3 py-2 font-medium disabled:opacity-40"
              disabled={asking}
              onClick={() => void askAgain()}
            >
              {asking ? "Asking" : "Ask again"}
            </button>
          </div>
        )}

        {/* The drop count, printed out loud. On an empty queue it is the whole
            story, and it is the one number that cannot come from the rows. */}
        {totalDropped > 0 && (
          <div className={card}>
            <h2 className="text-sm font-semibold text-foreground">
              {totalDropped} record(s) were refused on arrival in the last 30 days
            </h2>
            <ul className="text-sm text-muted-foreground mt-2 space-y-1">
              {drops.map((d) => (
                <li key={`${d.moduleId}:${d.reason}`}>
                  {d.dropped} from {d.moduleId} {DROP_WORDS[d.reason] ?? `were refused as ${d.reason}`}.
                  None of it was stored.
                </li>
              ))}
            </ul>
          </div>
        )}

        {nothingWaiting && (
          <div className={card}>
            <h2 className="font-semibold text-foreground">Nothing waiting</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Roles, circles and quests an outside service proposes land here for you to read before they
              exist. Nothing creates itself.
            </p>
          </div>
        )}

        {(queue?.batches ?? []).map((batch) => (
          <div key={batch.batchId} className={card}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold text-foreground">
                {batch.items.length} proposal(s) from {batch.moduleId ?? "an integration"}
              </h2>
              <p className="text-xs text-muted-foreground">Arrived {when(batch.receivedAt)}</p>
            </div>

            <div className="mt-4 space-y-4">
              {batch.items.map((item) => (
                <div key={item.id} className="border border-border rounded-lg p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{item.kind}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.trustTier}, confidence{" "}
                      {item.confidence === null ? "not stated" : item.confidence.toFixed(2)}
                    </p>
                  </div>

                  {/* The evidence, the way the Calls tab renders it: the quote
                      verbatim, in quotation marks, with a formatted time. */}
                  {item.quote ? (
                    <p className="text-xs text-muted-foreground mt-2 italic">
                      &ldquo;{item.quote}&rdquo;, {when(item.sourceOccurredAt)}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-2">{EVIDENCE_WORDS[item.evidence]}</p>
                  )}
                  {item.sourceRef && (
                    <p className="text-xs text-muted-foreground mt-1">Source: {item.sourceRef}</p>
                  )}

                  {/* The textarea. This is the redaction path and the reason
                      the page exists. */}
                  <label className="block text-xs font-medium text-foreground mt-3" htmlFor={`edit-${item.id}`}>
                    What it proposes. Change anything before you accept it.
                  </label>
                  <textarea
                    id={`edit-${item.id}`}
                    value={edits[item.id] ?? JSON.stringify(item.payload, null, 2)}
                    onChange={(e) => setEdits((s) => ({ ...s, [item.id]: e.target.value }))}
                    rows={8}
                    spellCheck={false}
                    className="w-full mt-1 border border-border rounded-lg p-2 text-xs font-mono bg-background text-foreground"
                  />

                  <div className="flex gap-2 mt-3">
                    <button
                      disabled={busy === item.id}
                      onClick={() => void acceptOne(item)}
                      className="text-xs border border-border rounded-lg px-3 py-2 min-h-[44px] font-medium"
                    >
                      Accept this one
                    </button>
                    <button
                      disabled={busy === item.id}
                      onClick={() => void rejectOne(item)}
                      className="text-xs border border-border rounded-lg px-3 py-2 min-h-[44px]"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              disabled={busy === batch.batchId}
              onClick={() => void acceptBatch(batch)}
              className="text-sm border border-border rounded-lg px-4 py-2 mt-4 min-h-[44px] font-medium"
            >
              Accept all {batch.items.length}, with my edits
            </button>

            {stuck ? (
              <div className="mt-4 rounded-lg border border-border p-3">
                <p className="text-sm text-foreground">
                  The draft this made cannot publish: {stuck.blocked} of its seats are blocked.
                  Withdrawing puts these proposals back in the queue so you can accept fewer at a
                  time, or make the circles they name first.
                </p>
                <button
                  disabled={busy === stuck.draftId}
                  onClick={() => void withdrawStuck()}
                  className="text-sm border border-border rounded-lg px-4 py-2 mt-3 min-h-[44px] font-medium"
                >
                  Withdraw that draft
                </button>
              </div>
            ) : null}
          </div>
        ))}

        {(queue?.quests ?? []).map((q) => (
          <div key={q.id} className={card}>
            <h2 className="font-semibold text-foreground">{String(q.prose.title ?? "A proposed quest")}</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Proposed by {q.moduleId}, {when(q.receivedAt)}
            </p>
            {q.prose.description && (
              <p className="text-sm text-muted-foreground mt-2">{String(q.prose.description)}</p>
            )}
            {q.quote && (
              <p className="text-xs text-muted-foreground mt-2 italic">&ldquo;{q.quote}&rdquo;</p>
            )}

            <p className="text-xs text-foreground mt-4 font-medium">
              What it pays. Nothing else can set this, so it is yours to type.
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              <input
                aria-label="What this quest pays"
                placeholder="50-100"
                value={rewards[q.id]?.gratitude ?? ""}
                onChange={(e) =>
                  setRewards((s) => ({
                    ...s,
                    [q.id]: { stayCreditReward: s[q.id]?.stayCreditReward ?? "", gratitude: e.target.value },
                  }))
                }
                className="border border-border rounded-lg px-3 py-2 text-sm min-h-[44px] bg-background text-foreground"
              />
              <input
                aria-label="Stay credits, in nights"
                placeholder="Nights, optional"
                value={rewards[q.id]?.stayCreditReward ?? ""}
                onChange={(e) =>
                  setRewards((s) => ({
                    ...s,
                    [q.id]: { gratitude: s[q.id]?.gratitude ?? "", stayCreditReward: e.target.value },
                  }))
                }
                className="border border-border rounded-lg px-3 py-2 text-sm min-h-[44px] bg-background text-foreground"
              />
            </div>

            <div className="flex gap-2 mt-3">
              <button
                disabled={busy === q.id}
                onClick={() => void acceptQuest(q)}
                className="text-xs border border-border rounded-lg px-3 py-2 min-h-[44px] font-medium"
              >
                Put it on the board
              </button>
              <button
                disabled={busy === q.id}
                onClick={async () => {
                  setBusy(q.id);
                  try {
                    if (await post(`/api/review/quests/${q.id}/reject`, { note: "" })) {
                      toast.success("Rejected");
                      await load();
                    }
                  } finally {
                    setBusy(null);
                  }
                }}
                className="text-xs border border-border rounded-lg px-3 py-2 min-h-[44px]"
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </Layout>
  );
}
