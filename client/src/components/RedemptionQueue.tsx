/**
 * The other side of a redemption: what is waiting on somebody with the key.
 *
 * WHY THIS SITS ON A MEMBER PAGE AND NOT IN THE ADMIN PANEL. Confirming is
 * gated on `redemption.confirm`, which a village can hand to a role, so the
 * people who do this work are not necessarily admins and an admin-only page
 * would lock them out of the one thing they were given. So the component asks
 * the server and renders nothing at all when the answer is no: the capability
 * gate decides who sees this, and the page it lives on decides nothing.
 *
 * NOTHING HERE BLOCKS. Every warning rides on the row and the button stays
 * live under all of them. That is `exitLeverProblem`'s rule, which says a
 * warning belongs to the person looking and never to the save, and
 * `reciprocalConfirms`' reason for surfacing mutual confirmations without
 * refusing them: two people who genuinely worked together will confirm each
 * other.
 *
 * A REASON IS REQUIRED FOR BOTH ENDINGS, following `closeBallot`, where the
 * outcome note is mandatory because a decision with no stated reason is not a
 * record. The server refuses an empty one; this disables the buttons so nobody
 * meets that refusal by surprise.
 */
import { useEffect, useState } from "react";
import { authToken } from "@/lib/gameApi";
import { formatHumanAmount } from "@/lib/tokenAmount";
import { ClipboardCheck } from "lucide-react";

const headers = (): Record<string, string> => {
  const t = authToken();
  return t
    ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
};

interface QueueRow {
  id: string;
  userId: string;
  memberName: string;
  token: string;
  tokenName: string;
  amount: number;
  askedFor: string;
  openedAt: string;
  expiresAt: string | null;
  warnings: Array<{ key: string; message: string }>;
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long" });

export default function RedemptionQueue() {
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    fetch("/api/admin/redemptions", { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRows(d ? d.redemptions : null))
      // A member without the key gets no queue and no error. This surface is
      // for whoever holds it, and a refusal card here would be telling most of
      // the village about a door that is not theirs.
      .catch(() => setRows(null));
  };
  useEffect(load, []);

  /*
   * The Response is held before anything says a decision landed. A confirmation
   * destroys somebody's tokens, so a control that reported one it had not
   * waited for would be the worst possible place for that lie.
   */
  const decide = async (id: string, ending: "confirm" | "refuse") => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const res = await fetch(`/api/redemptions/${id}/${ending}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ note: notes[id] ?? "" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || "That did not go through.");
        return;
      }
      setNotice(
        ending === "confirm"
          ? "Confirmed. Those tokens are destroyed and the member has been told."
          : "Refused. The tokens are back in the member's wallet and they have been told.",
      );
      load();
    } catch {
      setError("That did not go through.");
    } finally {
      setBusy(false);
    }
  };

  if (!rows || rows.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="w-4 h-4 text-teal-deep" />
        <p className="font-semibold text-foreground text-sm">Redemptions waiting on you</p>
      </div>
      <p className="text-sm text-muted-foreground">
        Confirm one only after the village has paid it. Confirming destroys the tokens and
        it cannot be undone.
      </p>

      {notice && (
        <p role="status" className="text-sm text-teal-deep bg-teal-deep/10 rounded-lg px-4 py-2.5">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2.5">
          {error}
        </p>
      )}

      {rows.map((r) => (
        <div key={r.id} className="border border-border rounded-lg px-4 py-3 space-y-2">
          <p className="text-sm text-foreground">
            <span className="font-semibold">{r.memberName}</span> asked for{" "}
            <span className="font-semibold">
              {formatHumanAmount(r.amount)} {r.tokenName}
            </span>{" "}
            to become {r.askedFor}, on {day(r.openedAt)}.
            {r.expiresAt ? ` It runs out on ${day(r.expiresAt)}.` : ""}
          </p>
          {r.warnings.map((w) => (
            <p key={w.key} className="text-xs text-muted-foreground">
              {w.message}
            </p>
          ))}
          <input
            type="text"
            maxLength={500}
            value={notes[r.id] ?? ""}
            onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
            placeholder="Say why, in a sentence"
            className="border border-border rounded-lg px-3 py-2 bg-background text-foreground w-full text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !(notes[r.id] ?? "").trim()}
              onClick={() => decide(r.id, "confirm")}
              className="bg-teal-deep text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              They were paid. Destroy the tokens
            </button>
            <button
              type="button"
              disabled={busy || !(notes[r.id] ?? "").trim()}
              onClick={() => decide(r.id, "refuse")}
              className="border border-border text-foreground rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              Refuse, and give them back
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
