/**
 * APPOINTING SOMEBODY TO A ROLE, WITH THE TERM THEY WILL HOLD IT FOR.
 *
 * Lifted out of GameRolesTab in Admin.tsx, which sits at its line ratchet, on
 * the day every seat began carrying a term (0199). `POST
 * /api/admin/roles/:id/holders` ends a seat with the season when no date is
 * sent, and a role carrying the steward veto can end no later than that, so
 * the picker says which before the founder presses Appoint.
 *
 * Light-only, like the rest of the admin panel.
 */
import { useState } from "react";
import SeatTermField, { carriesStewardVeto, type SeatTermLook } from "@/components/power/SeatTermField";

const LOOK: SeatTermLook = {
  label: "block text-xs text-gray-500",
  input: "mt-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white",
  line: "text-xs text-gray-500",
  caution: "text-xs text-amber-700",
  refusal: "text-xs text-red-600",
};

export function AppointToRole({
  role,
  players,
  onAppoint,
}: {
  role: { id: string; holders?: Array<{ userId: string }>; capabilities?: string[] };
  players: Array<{ id: string; name: string; handle?: string | null }>;
  /** Resolves true only when the server said the appointment landed. */
  onAppoint: (userId: string, termEndsOn: string) => Promise<boolean>;
}) {
  const [who, setWho] = useState("");
  const [termEndsOn, setTermEndsOn] = useState("");

  const appoint = async () => {
    if (!who) return;
    if (await onAppoint(who, termEndsOn)) {
      setWho("");
      setTermEndsOn("");
    }
  };

  return (
    <div className="flex flex-wrap items-start gap-2">
      <select
        value={who}
        onChange={(e) => setWho(e.target.value)}
        aria-label="Appoint a member"
        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
      >
        <option value="">Appoint a member…</option>
        {players
          .filter((p) => !(role.holders ?? []).some((h) => h.userId === p.id))
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.handle ? ` (@${p.handle})` : ""}
            </option>
          ))}
      </select>
      <SeatTermField
        value={termEndsOn}
        onChange={setTermEndsOn}
        capAtSeasonEnd={carriesStewardVeto(role.capabilities)}
        look={LOOK}
        label="Ends on (optional)"
      />
      <button
        onClick={() => void appoint()}
        disabled={!who}
        className="text-xs bg-teal-deep text-white rounded-lg px-3 py-1.5 font-medium disabled:opacity-40"
      >
        Appoint
      </button>
    </div>
  );
}
