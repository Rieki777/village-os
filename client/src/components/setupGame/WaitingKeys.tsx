/**
 * KEYS WAITING FOR A SECOND PERSON, at the top of the setup game.
 *
 * After launch a keystone key saved anywhere (Integrations, Comms Settings, the
 * Spring plot) waits here for another admin's co-sign, or, in a village with
 * one admin, for its cooling-off to pass while a steward or founder may decline
 * it (server/routes/plantingRequests.ts). The card shows what each request is,
 * who asked and its last four characters, and never a value. It draws nothing
 * when nothing waits.
 */
import { useCallback, useEffect, useState } from "react";
import { commsCall } from "@/components/admin/comms/commsSettingsApi";
import { authToken } from "@/lib/gameApi";
import { said } from "./setupGameApi";

interface Waiting {
  id: string;
  slot: string;
  title: string;
  last4: string;
  requestedBy: string;
  mode: "cosign" | "cooling_off";
  appliesAt: number | null;
  expiresAt: number;
}

const when = (s: number) => new Date(s * 1000).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function WaitingKeys() {
  const [waiting, setWaiting] = useState<Waiting[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await commsCall<{ waiting: Waiting[]; me: string | null }>("/admin/planting-requests", authToken() ?? "");
    if (r.ok) {
      setWaiting(r.data.waiting ?? []);
      setMe(r.data.me);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function act(id: string, what: "cosign" | "decline") {
    setBusy(true);
    setError("");
    const r = await commsCall<{ waiting: Waiting[] }>(`/admin/planting-requests/${id}/${what}`, authToken() ?? "", { method: "POST" });
    setBusy(false);
    if (!r.ok) return setError(said(r.data, "That did not go through. Try again."));
    setWaiting(r.data.waiting ?? []);
  }
  if (waiting.length === 0) return null;
  return (
    <div className="sg-card" aria-live="polite">
      <h3>Keys waiting for a second person</h3>
      <ul className="sg-cellar">
        {waiting.map((w) => (
          <li key={w.id}>
            {w.title} ····{w.last4}
            <span>
              {w.mode === "cooling_off" && w.appliesAt
                ? `Lands on ${when(w.appliesAt)} unless somebody declines it. Nobody else can co-sign.`
                : `Waits for another admin's co-sign until ${when(w.expiresAt)}.`}
            </span>
            <div className="sg-actions">
              {w.requestedBy !== me && w.mode === "cosign" && (
                <button type="button" className="sg-primary" disabled={busy} onClick={() => void act(w.id, "cosign")}>
                  Co-sign
                </button>
              )}
              <button type="button" className="sg-link" disabled={busy} onClick={() => void act(w.id, "decline")}>
                {w.requestedBy === me ? "Withdraw" : "Decline"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error ? (
        <div className="sg-msg" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
