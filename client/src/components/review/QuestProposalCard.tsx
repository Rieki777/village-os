/**
 * One proposed quest on /review, and what a steward types before it goes on the board.
 *
 * Moved out of Review.tsx with two new fields, the title and the description.
 * An idea from the public Propose a Quest form is a person's own words and the
 * board is public, so a name or a phone number typed into the idea would go up
 * with it: the only screen before the board is for email addresses. Accepting
 * sends the words as the steward left them (`edits`), which
 * `acceptQuestProposal` writes to the quest and back onto the proposal row. The
 * reward stays the steward's alone to type, as it always was: since 0265 it is
 * a value in the village's currency and the token amounts beside it, never a
 * Gratitude label, because no quest pays Gratitude (Rye, 2026-10-21).
 *
 * A REJECTION CAN SAY WHY. Rejecting used to send an empty note, every time,
 * and the person who proposed the idea heard nothing at all. A signed-in
 * proposer now gets a notice either way (server/lib/questProposals.ts), and
 * the reason typed here is the one piece of free text it carries.
 */
import { useEffect, useState } from "react";
import { PROPOSE_QUEST_MODULE } from "@shared/questIdeas";
import WorkValueEditor, { draftFrom, usePayOptions, type WorkValueDraft } from "@/components/WorkValueEditor";

export interface QuestCard {
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

/** What a steward typed on one card: the reward, and the words as they will stand on the board. */
export interface QuestTyped {
  /** What it is worth and pays, as typed. */
  pay: WorkValueDraft;
  stayCreditReward: string;
  title: string;
  description: string;
}

const field = "border border-border rounded-lg px-3 py-2 text-sm min-h-[44px] bg-background text-foreground";

export default function QuestProposalCard({
  q,
  arrived,
  busy,
  onAccept,
  onReject,
}: {
  q: QuestCard;
  /** When it arrived, already written the way the page writes a time. */
  arrived: string;
  busy: boolean;
  onAccept: (typed: QuestTyped) => void;
  /** The reason the steward typed, which the proposer reads; empty when none was given. */
  onReject: (reason: string) => void;
}) {
  // The words open on what arrived, so a steward who changes nothing sends the idea as it came.
  const options = usePayOptions();
  const [typed, setTyped] = useState<QuestTyped>({
    pay: { value: "", tokens: {} },
    stayCreditReward: "",
    title: String(q.prose.title ?? ""),
    description: String(q.prose.description ?? ""),
  });
  // A new quest opens on the village's standard amounts once they arrive, so
  // what the steward sees is what it pays.
  useEffect(() => {
    if (!options) return;
    setTyped((t) => (Object.keys(t.pay.tokens).length ? t : { ...t, pay: { ...draftFrom(null, options.quest, options.currency), value: t.pay.value } }));
  }, [options]);
  const set = (key: "stayCreditReward" | "title" | "description") => (e: { target: { value: string } }) =>
    setTyped((t) => ({ ...t, [key]: e.target.value }));
  const [reason, setReason] = useState("");

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h2 className="font-semibold text-foreground">{String(q.prose.title ?? "A proposed quest")}</h2>
      <p className="text-xs text-muted-foreground mt-1">
        {q.moduleId === PROPOSE_QUEST_MODULE ? "Proposed through the Propose a Quest form" : `Proposed by ${q.moduleId}`},{" "}
        {arrived}
      </p>
      {q.prose.description && <p className="text-sm text-muted-foreground mt-2">{String(q.prose.description)}</p>}
      {q.rationale && <p className="text-xs text-muted-foreground mt-2 whitespace-pre-line">{q.rationale}</p>}
      {q.quote && <p className="text-xs text-muted-foreground mt-2 italic">&ldquo;{q.quote}&rdquo;</p>}

      <p className="text-xs text-foreground mt-4 font-medium">
        What goes on the board, where anyone can read it. Take out anything that would name or reach a person.
      </p>
      <input aria-label="Quest title" value={typed.title} onChange={set("title")} className={`w-full mt-2 ${field}`} />
      <textarea
        aria-label="What the quest asks"
        value={typed.description}
        onChange={set("description")}
        rows={4}
        className="w-full mt-2 border border-border rounded-lg p-2 text-sm bg-background text-foreground"
      />

      <p className="text-xs text-foreground mt-4 font-medium">
        What it pays. Nothing else can set this, so it is yours to type.
      </p>
      <div className="mt-2 text-foreground">
        <WorkValueEditor
          draft={typed.pay}
          onChange={(pay) => setTyped((t) => ({ ...t, pay }))}
          offered={options ? options.quest : null}
          currency={options?.currency ?? null}
          cadence="once"
          inputClassName={field}
        />
      </div>
      <div className="flex flex-wrap gap-2 mt-2">
        <input
          aria-label="Stay credits, in nights"
          placeholder="Nights, optional"
          value={typed.stayCreditReward}
          onChange={set("stayCreditReward")}
          className={field}
        />
      </div>

      <label className="block text-xs text-foreground mt-4 font-medium">
        Why, if you reject it (optional). A proposer who was signed in reads this in their notice.
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={2000}
          rows={2}
          className="w-full mt-2 border border-border rounded-lg p-2 text-sm font-normal bg-background text-foreground"
        />
      </label>

      <div className="flex gap-2 mt-3">
        <button
          disabled={busy}
          onClick={() => onAccept(typed)}
          className="text-xs border border-border rounded-lg px-3 py-2 min-h-[44px] font-medium"
        >
          Put it on the board
        </button>
        <button
          disabled={busy}
          onClick={() => onReject(reason.trim())}
          className="text-xs border border-border rounded-lg px-3 py-2 min-h-[44px]"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
