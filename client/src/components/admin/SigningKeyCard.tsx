/**
 * THE VILLAGE SIGNING KEY, ON THE INTEGRATIONS TAB (readiness R069).
 *
 * Shows which key signs what peers read about this village, says plainly when
 * this deployment cannot open it or holds it unsealed, and offers a new one
 * behind a typed confirmation, because every peer pauses on the change. The
 * server (server/routes/signingKey.ts) refuses without the confirmation and
 * without a usable VILLAGE_SECRETS_KEY, and this card shows what it said.
 *
 * After launch, with two or more admins able to sign, the press ASKS (the
 * server answers 202) and a different admin co-signs from this same card, or
 * declines (the coordinator, 2026-11-08). The card shows the request waiting.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Trans, useLingui } from "@lingui/react/macro";
import { API_BASE, authHeaders, refusal } from "./adminApi";

interface KeyState {
  kid: string;
  createdAt: string;
  atRest: "sealed" | "plaintext" | "unreadable" | null;
  canSign: boolean;
  confirmWith: string;
  /** After launch with two or more possible signers: a press asks, and another admin co-signs. */
  twoSign?: boolean;
  pending?: { id: string; requestedByName: string; requestedAt: string; expiresAt: string; mine: boolean } | null;
}

export default function SigningKeyCard({ password }: { password: string }) {
  const { t } = useLingui();
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
  const at = (iso: string) => (iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : t({ message: "an unknown time", context: "signing key" }));
  const stranded = state.atRest === "unreadable";
  const made = state.createdAt ? state.createdAt.slice(0, 10) : t({ message: "an unknown date", context: "signing key" });
  const kid = state.kid;
  const pending = state.pending ?? null;
  const cosigning = !!pending && !pending.mine;
  const action = cosigning
    ? t({ message: "Co-sign and replace", context: "signing key" })
    : state.twoSign && !pending
      ? t({ message: "Ask for a new key", context: "signing key" })
      : t({ message: "Replace the key", context: "signing key" });
  const notReplaced = t({ message: "The key was not replaced", context: "signing key" });
  const notDeclined = t({ message: "Nothing was declined", context: "signing key" });

  const rotate = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/admin/identity/signing-key/rotate`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify({ confirm: typed }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(refusal(d, notReplaced));
      const newKid = String(d.kid ?? "");
      if (res.status === 202) toast.success(t({ message: "Asked for a co-sign. Another admin replaces the key from this card.", context: "signing key" }));
      else toast.success(t({ message: `The village now signs with key ${newKid}`, context: "signing key" }));
      setTyped("");
      setAsking(false);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? notReplaced);
    }
    setBusy(false);
  };

  const decline = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/admin/identity/signing-key/rotate/decline`, {
        method: "POST",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: "{}",
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(refusal(d, notDeclined));
      toast.success(
        d.withdrawn
          ? t({ message: "Withdrawn. The village keeps its key.", context: "signing key" })
          : t({ message: "Declined. The village keeps its key.", context: "signing key" }),
      );
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? notDeclined);
    }
    setBusy(false);
  };

  const askedAt = pending ? at(pending.requestedAt) : "";
  const lapsesAt = pending ? at(pending.expiresAt) : "";
  const asker = pending?.requestedByName ?? "";
  const confirmWith = state.confirmWith;

  return (
    <div className="border border-gray-200 rounded-xl p-4 mb-5 bg-white">
      <p className="text-sm font-medium text-gray-900"><Trans context="signing key">Village signing key</Trans></p>
      <p className="text-xs text-gray-500 mt-1">
        <Trans context="signing key">
          Signs what other villages read about this one: its discovery page, its public structure and its module
          report. Key <code>{kid}</code>, made {made}.
        </Trans>
      </p>
      {stranded && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2">
          <Trans context="signing key">
            This deployment cannot open the key, so those pages answer 503. A restore under a different
            VILLAGE_SECRETS_KEY does this. If the old value is gone for good, make a new key here.
          </Trans>
        </p>
      )}
      {state.atRest === "plaintext" && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
          <Trans context="signing key">
            The key is stored unsealed, so it travels in every database dump. Set VILLAGE_SECRETS_KEY and restart to
            seal it in place; that keeps the same key.
          </Trans>
        </p>
      )}
      {pending && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2 space-y-2">
          {pending.mine ? (
            <p>
              <Trans context="signing key">
                You asked for a new key at {askedAt}. It waits for another admin to co-sign it, until {lapsesAt}.
              </Trans>
            </p>
          ) : (
            <p>
              <Trans context="signing key">
                {asker} asked for a new key at {askedAt}. Your co-sign replaces it now. If you did not expect this,
                decline it: an admin account may be in the wrong hands.
              </Trans>
            </p>
          )}
          <button type="button" disabled={busy} onClick={decline} className="text-xs underline disabled:opacity-40">
            {pending.mine ? t({ message: "Withdraw the request", context: "signing key" }) : t({ message: "Decline", context: "signing key" })}
          </button>
        </div>
      )}
      {pending?.mine ? null : !asking ? (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className={`mt-3 text-xs rounded-lg px-3 py-1.5 border ${stranded ? "border-red-300 text-red-700" : "border-gray-300 text-gray-700"}`}
        >
          {cosigning ? t({ message: "Co-sign the new key", context: "signing key" }) : t({ message: "Make a new key", context: "signing key" })}
        </button>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-gray-700">
            <Trans context="signing key">
              Every village that follows this one will pause on the new key until somebody there accepts it. Do this
              after a leak or a lost VILLAGE_SECRETS_KEY, and tell those villages first.
            </Trans>{" "}
            {state.twoSign && !pending && (
              <>
                <Trans context="signing key">The village has launched, so another admin co-signs before the key is replaced.</Trans>{" "}
              </>
            )}
            <Trans context="signing key">Type "{confirmWith}" to confirm.</Trans>
          </p>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-label={t({ message: "Type the confirmation", context: "signing key" })}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || typed.trim().toLowerCase() !== state.confirmWith}
              onClick={rotate}
              className="text-xs rounded-lg px-3 py-1.5 bg-red-600 text-white disabled:opacity-40"
            >
              {busy ? t({ message: "Sending...", context: "signing key" }) : action}
            </button>
            <button type="button" onClick={() => { setAsking(false); setTyped(""); }} className="text-xs text-gray-500">
              <Trans context="signing key">Keep this key</Trans>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
