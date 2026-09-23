/**
 * THE HANDS RAISED FOR ONE POWER, AND THE DOOR FROM A HAND TO A VOTE.
 *
 * Two rulings of Rye's, 2026-09-23, meet on this one card.
 *
 * Ruling 2 said the notes are public, members included, and said it again about
 * notes already written when the alternative was to publish only new ones. So
 * what somebody wrote when they raised their hand is printed here for anybody
 * signed in, whenever they wrote it. `PowerHand` says so above the box before
 * anybody types into it (`NOTE_IS_PUBLIC`).
 *
 * Ruling 1 said who may take a standing hand and put it to the village: the
 * holders when a role holds the power, any member when the village holds it.
 * The server answers that per hand (`youMayPut`), because a button drawn from a
 * payload an hour old is never the authority, and `whoMayPutHandToVillage` in
 * shared/powerHands.ts is the rule itself.
 *
 * ── WHAT THE BUTTON DOES, SAID BEFORE IT IS PRESSED ────────────────────────
 *
 * It opens a village-wide vote and rings the whole roll, so it asks first and
 * takes a line about why. The vote it opens is an ordinary `role_seat` ballot:
 * the village decides whether this person sits in the role that carries the
 * power. Nothing here grants anything.
 *
 * This file decides nothing. Every refusal on the screen is a sentence the
 * server sent.
 */
import { useState } from "react";
import { Hand } from "lucide-react";
import { authToken } from "@/lib/gameApi";
import { asOffer } from "@shared/powerHands";

export interface HandRow {
  id: string;
  capability: string;
  powerLabel: string;
  userId: string;
  userName: string;
  status: "new" | "reviewing" | "in-conversation";
  submittedAt: string;
  note: string;
  youMayPut: boolean;
  whoMay: "any-member" | "live-holders";
  seatRole: { id: string; name: string } | null;
  rolesCarrying: Array<{ id: string; name: string }>;
}

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

/** Why this member is only reading, keyed by the rule the server named. */
const WATCHING: Record<HandRow["whoMay"], string> = {
  "any-member": "Somebody is opening this one.",
  "live-holders": "Whoever holds this power is the one who can put this hand to the village.",
};

export default function HandsForPower({
  capability,
  hands,
  onOpened,
}: {
  capability: string;
  hands: readonly HandRow[];
  /** Told when a vote opens, so the page can read the hands again. */
  onOpened?: () => void;
}) {
  const here = hands.filter((h) => h.capability === capability);
  const [asking, setAsking] = useState<string | null>(null);
  const [why, setWhy] = useState("");
  const [roleId, setRoleId] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");

  if (here.length === 0) return null;

  const put = async (hand: HandRow) => {
    if (busy) return;
    setBusy(true);
    setSaid("");
    try {
      const r = await fetch(`/api/powers/hands/${encodeURIComponent(hand.id)}/put-to-village`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ reason: why, roleId: roleId || hand.seatRole?.id || "" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.message ?? d?.error ?? "Could not open the vote");
      setAsking(null);
      setWhy("");
      setRoleId("");
      setSaid("The village has been asked. Voting is open.");
      onOpened?.();
    } catch (e) {
      setSaid(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 border-t border-border pt-3" data-testid={`hands-${capability}`}>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Hand className="h-4 w-4 shrink-0 text-notice" aria-hidden="true" />
        Hands raised for this
      </h3>
      <ul className="mt-2 space-y-4">
        {here.map((hand) => (
          <li key={hand.id} className="rounded-lg bg-muted/40 p-3">
            <p className="text-sm text-foreground">
              {hand.userName || "A member"} offered {hand.powerLabel ? `to ${asOffer(hand.powerLabel)}` : "to take this on"}.
            </p>
            {hand.note.trim() !== "" && (
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{hand.note}</p>
            )}

            {!hand.youMayPut ? (
              <p className="mt-2 text-xs text-muted-foreground">{WATCHING[hand.whoMay]}</p>
            ) : hand.rolesCarrying.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                No role here carries this power yet, so there is no seat to vote anybody into. The
                village votes a power onto a role first.
              </p>
            ) : asking === hand.id ? (
              <div className="mt-3 flex flex-col gap-2">
                {hand.rolesCarrying.length > 1 && (
                  <label className="text-xs text-muted-foreground">
                    Which role the village would seat them in
                    <select
                      value={roleId}
                      onChange={(e) => setRoleId(e.target.value)}
                      className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    >
                      <option value="">Choose a role</option>
                      {hand.rolesCarrying.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="text-xs text-muted-foreground">
                  Why this person for this seat. The whole village reads it before voting.
                  <textarea
                    value={why}
                    onChange={(e) => setWhy(e.target.value)}
                    rows={3}
                    maxLength={16000}
                    className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                </label>
                <span className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void put(hand)}
                    aria-disabled={busy}
                    className="min-h-11 rounded-lg border border-notice/40 bg-notice/15 px-4 text-sm font-semibold text-notice aria-disabled:opacity-60"
                  >
                    Open the vote
                  </button>
                  <button
                    type="button"
                    onClick={() => setAsking(null)}
                    className="min-h-11 px-2 text-sm text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                </span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSaid("");
                  setWhy("");
                  setRoleId(hand.seatRole?.id ?? "");
                  setAsking(hand.id);
                }}
                aria-label={`Put ${hand.userName || "this hand"} to the village for ${hand.powerLabel || capability}`}
                className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-muted"
              >
                Put this to the village
              </button>
            )}
          </li>
        ))}
      </ul>
      <span aria-live="polite" className="block text-xs text-muted-foreground">
        {said}
      </span>
    </div>
  );
}
