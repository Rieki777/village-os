/**
 * HOW THIS PROPOSAL SERVES THE VILLAGE'S GOVERNING PURPOSE (0217).
 *
 * Rye, 2026-09-23: on a proposal that changes how the village works, the
 * proposer writes one line on how it serves the purpose, it shows beside the
 * proposal when people vote, and it stays on the record.
 *
 * ── IT ASKS ITSELF WHETHER TO EXIST ────────────────────────────────────────
 *
 * A line answers to a statement, and a village that has not written one has
 * nothing to answer to. So this component reads `GET /api/governance/purpose`
 * and renders NOTHING when the statement is empty, which is the same condition
 * `purposeAlignmentRefusal` applies on the server. The field and the refusal
 * therefore cannot disagree about whether a proposer is being asked.
 *
 * A failed read leaves it hidden, which is every village's behaviour today and
 * costs a proposer nothing worse than a refusal they can act on.
 *
 * ── ITS OWN FILE, AND THAT IS THE RATCHET TALKING ─────────────────────────
 *
 * It belongs beside the button that opens a rule change, which lives on
 * client/src/pages/GameMechanics.tsx. That file is on the monolith ratchet and
 * had 1498 lines of allowance, so the field, its fetch and its state went here
 * instead of onto the end of it. Any later surface that opens a ballot on one
 * of the five judged subjects can mount the same component.
 */
import { useEffect, useState } from "react";
import { authToken } from "@/lib/gameApi";

/**
 * The field's state and its request body, so a page that opens ballots on
 * several proposals at once holds nothing of this itself.
 *
 * Here rather than on the page for the same ratchet reason the component is:
 * `GameMechanics.tsx` had ten lines of allowance left. `bodyFor` returns an
 * EMPTY OBJECT when nothing was typed, so a vote opened on a village with no
 * statement sends the body it has always sent.
 */
export function usePurposeAlignment() {
  const [byProposal, setByProposal] = useState<Record<string, string>>({});
  return {
    propsFor: (id: string) => ({
      value: byProposal[id] ?? "",
      onChange: (next: string) => setByProposal((s) => ({ ...s, [id]: next })),
    }),
    bodyFor: (id: string): Record<string, string> => {
      const line = (byProposal[id] ?? "").trim();
      return line ? { purposeAlignment: line } : {};
    },
  };
}

export default function PurposeAlignmentField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [hasStatement, setHasStatement] = useState(false);

  useEffect(() => {
    const token = authToken();
    if (!token) return;
    let live = true;
    fetch("/api/governance/purpose", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live) setHasStatement(String(d?.statement ?? "").trim() !== "");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!hasStatement) return null;
  return (
    <label className="flex flex-col gap-1 basis-full text-xs text-stone-600">
      <span>
        How does this serve the village's governing purpose? The whole roll reads this
        beside your proposal.
      </span>
      <textarea
        rows={3}
        maxLength={2000}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm text-stone-800"
        placeholder="This raises the quorum on rule changes, which serves the part of the purpose about agreements the members write and can change themselves."
      />
    </label>
  );
}
