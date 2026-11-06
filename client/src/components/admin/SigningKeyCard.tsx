/**
 * THE VILLAGE SIGNING KEY, ON THE INTEGRATIONS TAB (readiness R069).
 *
 * Shows which key signs what peers read about this village, says plainly when
 * this deployment cannot open it or holds it unsealed, and offers a new one
 * behind a typed confirmation, because every peer pauses on the change. The
 * server (server/routes/signingKey.ts) refuses without the confirmation and
 * without a usable VILLAGE_SECRETS_KEY, and this card shows what it said.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { API_BASE, authHeaders, refusal } from "./adminApi";

interface KeyState {
  kid: string;
  createdAt: string;
  atRest: "sealed" | "plaintext" | "unreadable" | null;
  canSign: boolean;
  confirmWith: string;
}

export default function SigningKeyCard({ password }: { password: string }) {
  const [state, setState] = useState<KeyState | null>(null);
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`${API_BASE}/admin/identity/signing-key`, { headers: authHeaders(password) });
    if (res.ok) setState(await res.json());
  }, [password]);
  useEffect(() => { void load(); }, [load]);

  if (!state) return null;
  const stranded = state.atRest === "unreadable";
  const made = state.createdAt ? state.createdAt.slice(0, 10) : "an unknown date";

  const rotate = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/admin/identity/signing-key/rotate`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ confirm: typed }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(refusal(d, "The key was not replaced"));
      toast.success(`The village now signs with key ${d.kid}`);
      setTyped("");
      setAsking(false);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "The key was not replaced");
    }
    setBusy(false);
  };

  return (
    <div className="border border-gray-200 rounded-xl p-4 mb-5 bg-white">
      <p className="text-sm font-medium text-gray-900">Village signing key</p>
      <p className="text-xs text-gray-500 mt-1">
        Signs what other villages read about this one: its discovery page, its public structure and its module
        report. Key <code>{state.kid}</code>, made {made}.
      </p>
      {stranded && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2">
          This deployment cannot open the key, so those pages answer 503. A restore under a different
          VILLAGE_SECRETS_KEY does this. If the old value is gone for good, make a new key here.
        </p>
      )}
      {state.atRest === "plaintext" && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
          The key is stored unsealed, so it travels in every database dump. Set VILLAGE_SECRETS_KEY and restart to
          seal it in place; that keeps the same key.
        </p>
      )}
      {!asking ? (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className={`mt-3 text-xs rounded-lg px-3 py-1.5 border ${stranded ? "border-red-300 text-red-700" : "border-gray-300 text-gray-700"}`}
        >
          Make a new key
        </button>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-gray-700">
            Every village that follows this one will pause on the new key until somebody there accepts it. Do this
            after a leak or a lost VILLAGE_SECRETS_KEY, and tell those villages first. Type "{state.confirmWith}" to
            confirm.
          </p>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-label="Type the confirmation"
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || typed.trim().toLowerCase() !== state.confirmWith}
              onClick={rotate}
              className="text-xs rounded-lg px-3 py-1.5 bg-red-600 text-white disabled:opacity-40"
            >
              {busy ? "Replacing..." : "Replace the key"}
            </button>
            <button type="button" onClick={() => { setAsking(false); setTyped(""); }} className="text-xs text-gray-500">
              Keep this key
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
