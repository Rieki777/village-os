/**
 * SOMEBODY SAYS A SEAT IS THEIRS, AND A STEWARD ANSWERS.
 *
 * The org chart was backfilled from a document, so its holders are free-text
 * names. A member signing in under a matching name may ask to be confirmed
 * (`POST /api/org/seatings/:id/claim`), and the ask lands in the stewards'
 * inbox as a `seat-claim` row. This is where it gets answered.
 *
 * THE ASK IS NOT PROOF, WHICH IS THE WHOLE REASON THIS CONTROL EXISTS. Both
 * halves of the name match are typed by the person asking: registration takes
 * a name, the profile editor rewrites it, and the recorded name is published
 * on the chart to every account. So the recorded name is printed beside the
 * asker's, and a person decides.
 *
 * NOTHING IS SAID BEFORE THE SERVER ANSWERS. Both buttons await the call and
 * report what came back. A control that reported success optimistically would
 * tell a steward a seat had moved when the write refused, which is the failure
 * this whole change exists to stop.
 *
 * Confirm seats the member in place, so the seating keeps its id and its start
 * date. Decline closes the ask and touches no seating.
 *
 * Light-only, like the rest of the admin panel.
 */
import { useState } from "react";

export interface SeatClaimAsk {
  claimId: string;
  assignmentId: string;
  roleId: string;
  roleName: string;
  recordedName: string;
  userId: string;
  userName: string;
  askedAt?: string;
}

export interface SeatClaimAsksProps {
  /** The open asks for ONE seat. Empty renders nothing at all. */
  asks: SeatClaimAsk[];
  /** OrgChartTab's own caller: answers null when the server refused. */
  call: (path: string, body?: any, method?: string) => Promise<any | null>;
  /** What happened, in words, once the server has answered. */
  onDone: (said: string) => void;
}

export function SeatClaimAsks({ asks, call, onDone }: SeatClaimAsksProps) {
  const [busy, setBusy] = useState("");
  if (!asks.length) return null;

  const answer = async (ask: SeatClaimAsk, how: "confirm" | "decline") => {
    setBusy(ask.claimId);
    try {
      const done =
        how === "confirm"
          ? await call(`/org/seatings/${ask.assignmentId}/claim/confirm`, { userId: ask.userId })
          : await call(`/org/seat-claims/${ask.claimId}/decline`, {});
      // `call` has already shown the server's own sentence on a refusal. Saying
      // anything here would be a second, vaguer version of it.
      if (!done) return;
      onDone(
        how === "confirm"
          ? `${ask.userName} holds ${ask.roleName}. The seating kept its history.`
          : `Declined. ${ask.roleName} stays as it was recorded.`,
      );
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3" data-seat-claim-asks>
      <p className="text-xs font-semibold text-gray-900">
        {asks.length === 1 ? "Someone asks to be confirmed in this seat" : "People ask to be confirmed in this seat"}
      </p>
      <p className="text-[11px] text-gray-600 mt-0.5">
        A name on an account is typed by whoever holds it, so this is a question
        and never a proof. Confirm only the person you know sits here.
      </p>
      <ul className="mt-2 space-y-2">
        {asks.map((ask) => (
          <li key={ask.claimId} className="flex flex-wrap items-center gap-2 justify-between">
            <span className="text-xs text-gray-800">
              <span className="font-medium">{ask.userName}</span>
              {", recorded on this seat as "}
              <span className="font-medium">{ask.recordedName || "no name"}</span>
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                disabled={busy === ask.claimId}
                aria-label={`Confirm ${ask.userName} as ${ask.roleName}`}
                className="text-xs bg-teal-deep text-white rounded-lg px-3 py-2 font-medium disabled:opacity-40"
                onClick={() => void answer(ask, "confirm")}
              >Confirm</button>
              <button
                type="button"
                disabled={busy === ask.claimId}
                aria-label={`Decline ${ask.userName}'s ask for ${ask.roleName}`}
                className="text-xs border border-gray-300 text-gray-700 rounded-lg px-3 py-2 disabled:opacity-40"
                onClick={() => void answer(ask, "decline")}
              >Decline</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default SeatClaimAsks;
