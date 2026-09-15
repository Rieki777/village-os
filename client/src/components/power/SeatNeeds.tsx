/**
 * WHAT THIS SEAT IS HELD FOR: the needs a village tagged onto one role.
 *
 * ── R18, MADE VISIBLE ON THE SEAT ITSELF ─────────────────────────────────
 * "The more needs you're trying to meet the more roles you need in your
 * economy to help meet all the needs." `needSeatings` in server/lib/needs.ts
 * turns these tags into seats needed against seats filled, one line per need.
 * This is the other end of that: standing at a single seat and reading which
 * of the village's needs it carries.
 *
 * ── WHY IT ASKS ON ITS OWN ───────────────────────────────────────────────
 * The seat's read payload is assembled inside `GET /api/org`, which lives in
 * server/index.ts under a line ratchet that only turns down, so the tags could
 * not be added to it. `GET /api/org/roles/:id/needs` answers beside the seat's
 * history instead, and this component asks it the way SeatHistory asks for the
 * history: once, when a reader opens the card.
 *
 * ── A REFUSAL IS NOT AN UNTAGGED SEAT ────────────────────────────────────
 * The read is member-tier, so a signed-out reader gets a 401 and this renders
 * nothing at all. A seat with no tags renders nothing either. The two silences
 * are the same on screen and that is deliberate: printing "meets nothing" for
 * a reader who was refused the answer would be the page stating a fact it does
 * not have. An admin sees the picker either way, and the picker's own empty
 * state says which case it is.
 */
import { useEffect, useState } from "react";
import { gameFetch } from "@/lib/gameApi";
import NeedChips, { type NeedTag } from "@/components/NeedChips";
import NeedTagPicker from "@/components/admin/NeedTagPicker";

export default function SeatNeeds({
  roleId,
  canEdit = false,
}: {
  roleId: string;
  /** An admin or a founder, who may say what this seat is held for. */
  canEdit?: boolean;
}) {
  // `null` is "no answer yet or none to be had", which is not the same fact as
  // an empty array, and only the empty array is a seat with no tags.
  const [tags, setTags] = useState<NeedTag[] | null>(null);

  useEffect(() => {
    let live = true;
    gameFetch(`/api/org/roles/${encodeURIComponent(roleId)}/needs`)
      .then(async (r) => {
        if (!r.ok) return null;
        const data = await r.json();
        return Array.isArray(data?.needs) ? (data.needs as NeedTag[]) : [];
      })
      .catch(() => null)
      .then((rows) => {
        if (live) setTags(rows);
      });
    return () => {
      live = false;
    };
  }, [roleId]);

  if (tags === null && !canEdit) return null;
  const rows = tags ?? [];
  return (
    <div className="space-y-3">
      <NeedChips tags={rows} />
      {canEdit && (
        <NeedTagPicker
          subjectType="role"
          subjectRef={roleId}
          tags={rows}
          onChanged={setTags}
        />
      )}
    </div>
  );
}
