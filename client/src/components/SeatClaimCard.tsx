/**
 * "Somebody by your name holds Visionary Lead. Is this you?"
 *
 * The org chart arrived carrying holders as free-text NAME STRINGS, because
 * that is all the document it replaced could hold. Twenty-five seats and a
 * dozen names, and nobody was ever going to sit down and re-enter them.
 *
 * So the first person to sign in under a matching name is offered the seating
 * and takes it with one tap. The row does not change identity when they do:
 * the same assignment becomes a member holding, so the seat's history does not
 * restart the day somebody finally signs up.
 *
 * Three things this deliberately does not do:
 *
 *  - It never claims anything on somebody's behalf. A name match is a
 *    suggestion, and the server re-checks the match on the claim rather than
 *    trusting the id, so knowing an assignment id is not enough to take a seat.
 *  - It offers "that is not me", because the alternative is a card that
 *    follows you around forever when the village recorded a different Ada.
 *  - It stays quiet when there is nothing to claim, which is every visit after
 *    the first and every member the chart never named.
 */
import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { authToken } from "@/lib/gameApi";
import { readStoredJson, writeStoredJson } from "@/lib/safeStorage";

interface Unclaimed {
  assignmentId: string;
  recordedName: string;
  roleId: string;
  roleName: string;
  focus: string | null;
}

const DISMISSED_KEY = "village.seatClaim.dismissed";

function readDismissed(): string[] {
  const stored = readStoredJson("local", DISMISSED_KEY);
  const arr = stored.status === "value" ? stored.value : [];
  return Array.isArray(arr) ? arr.map(String) : [];
}

function remember(id: string): void {
  // Private browsing: the card simply offers itself again next visit.
  writeStoredJson("local", DISMISSED_KEY, [...readDismissed(), id]);
}

export default function SeatClaimCard() {
  const [seats, setSeats] = useState<Unclaimed[]>([]);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    const t = authToken();
    if (!t) return;
    fetch("/api/org/my-unclaimed-seats", { headers: { Authorization: `Bearer ${t}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        const dismissed = new Set(readDismissed());
        setSeats((Array.isArray(d) ? d : []).filter((s: Unclaimed) => !dismissed.has(s.assignmentId)));
      })
      // A seat suggestion is a nicety. It must never be the reason a page
      // fails to render.
      .catch(() => setSeats([]));
  }, []);

  if (!seats.length) return null;

  const claim = async (s: Unclaimed) => {
    setBusy(s.assignmentId);
    try {
      const res = await fetch(`/api/org/seatings/${s.assignmentId}/claim`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken()}` },
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d?.error ?? "That role could not be confirmed");
        return;
      }
      toast.success(`${s.roleName} is yours`);
      setSeats((prev) => prev.filter((x) => x.assignmentId !== s.assignmentId));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="rounded-xl border border-sage/40 bg-sage/5 p-4 mb-6">
      <p className="text-sm font-medium text-foreground mb-1">
        {seats.length === 1 ? "A role is recorded under your name" : "Some roles are recorded under your name"}
      </p>
      <p className="text-xs text-muted-foreground mb-3">
        The village wrote these down before you had an account here. Confirming
        one links it to you, and the role keeps everything it already knew.
      </p>
      <div className="space-y-2">
        {seats.map((s) => (
          <div key={s.assignmentId} className="flex flex-wrap items-center gap-2 justify-between">
            <p className="text-sm text-foreground">
              <span className="font-medium">{s.roleName}</span>
              {s.focus && <span className="text-muted-foreground"> · {s.focus}</span>}
              <span className="text-muted-foreground"> · recorded as “{s.recordedName}”</span>
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => void claim(s)}
                disabled={busy === s.assignmentId}
                className="inline-flex items-center gap-1 text-sm bg-teal-deep text-white rounded-lg px-3 py-1.5 font-medium disabled:opacity-40"
              >
                <Check className="w-4 h-4" /> That is me
              </button>
              <button
                onClick={() => {
                  remember(s.assignmentId);
                  setSeats((prev) => prev.filter((x) => x.assignmentId !== s.assignmentId));
                }}
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground px-2 py-1.5"
              >
                <X className="w-4 h-4" /> Not me
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
