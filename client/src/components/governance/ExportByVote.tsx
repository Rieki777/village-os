/**
 * ONE COPY OF THE VILLAGE'S DATABASE, BY THE VILLAGE'S VOTE (Rye, 2026-11-06).
 *
 *   AskForExport     on Decisions: a member names one live steward and says why,
 *                    and the vote opens at the village's highest tier.
 *   ExportDelivery   on the decision itself: what it authorised, and, for the
 *                    named steward while the copy is unused, the one download.
 *
 * The server holds every rule (server/routes/exportVotes.ts). The download is
 * fetched with the member's token and saved from the browser, because this
 * deployment signs members in by header alone and a plain link would arrive
 * as a stranger.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { gameFetch } from "@/lib/gameApi";

const BASE = "/api/governance/village-export";

async function errorOf(res: Response, fallback: string): Promise<string> {
  const d = await res.json().catch(() => ({}));
  return String(d?.message ?? d?.error ?? fallback);
}

export function AskForExport() {
  const [stewards, setStewards] = useState<Array<{ userId: string; label: string }> | null>(null);
  const [open, setOpen] = useState(false);
  const [steward, setSteward] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState<string | null>(null);

  useEffect(() => {
    if (!open || stewards) return;
    void gameFetch(`${BASE}/stewards`).then(async (res) => setStewards(res.ok ? (await res.json()).stewards ?? [] : []));
  }, [open, stewards]);

  const ask = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await gameFetch(`${BASE}/put-to-village`, { method: "POST", body: JSON.stringify({ stewardUserId: steward, reason }) });
      if (!res.ok) throw new Error(await errorOf(res, "The vote did not open"));
      setOpened(String((await res.json()).ballot?.id ?? ""));
    } catch (e: any) {
      setError(e?.message ?? "The vote did not open");
    }
    setBusy(false);
  };

  if (opened) {
    return (
      <p className="text-sm text-stone-700">
        The vote is open. <Link href={`/decisions/${opened}`} className="underline">Read it and vote</Link>.
      </p>
    );
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-stone-600 underline">
        Ask the village for one copy of its database
      </button>
    );
  }
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 space-y-3">
      <p className="text-sm text-stone-700">
        The copy holds every member's data. If the village carries this at its highest bar, the steward you name may
        download it once, and every member is told when they do.
      </p>
      <label className="block text-sm text-stone-700">
        The steward who receives it
        <select value={steward} onChange={(e) => setSteward(e.target.value)} className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm">
          <option value="">Choose a sitting steward</option>
          {(stewards ?? []).map((s) => (
            <option key={s.userId} value={s.userId}>{s.label}</option>
          ))}
        </select>
      </label>
      {stewards && stewards.length === 0 && <p className="text-xs text-amber-700">No steward is sitting now, so there is nobody to name.</p>}
      <label className="block text-sm text-stone-700">
        Why the village needs it
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm" />
      </label>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !steward || reason.trim().length < 10}
          onClick={ask}
          className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
        >
          {busy ? "Opening..." : "Ask the village"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-stone-500">Not now</button>
      </div>
    </div>
  );
}

interface Standing {
  granted: boolean;
  forYou: boolean;
  stewardLive: boolean;
  deliveredAt: string | null;
}

export function ExportDelivery({ ballotId }: { ballotId: string }) {
  const [standing, setStanding] = useState<Standing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = () => void gameFetch(`${BASE}/${ballotId}/standing`).then(async (res) => res.ok && setStanding(await res.json()));
  useEffect(load, [ballotId]);

  if (!standing?.granted) return null;
  const when = standing.deliveredAt ? standing.deliveredAt.slice(0, 16).replace("T", " ") : null;

  const download = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await gameFetch(`${BASE}/${ballotId}/download`);
      if (!res.ok) throw new Error(await errorOf(res, "The copy did not download"));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `village-export-${new Date().toISOString().slice(0, 10)}.sql.gz`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message ?? "The copy did not download");
    }
    setBusy(false);
    load();
  };

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 space-y-2">
      <p className="text-sm font-medium text-stone-900">One copy of the village's database</p>
      {when ? (
        <p className="text-sm text-stone-700">It was downloaded on {when} UTC, once, as the vote allowed. Another copy needs another vote.</p>
      ) : standing.forYou ? (
        standing.stewardLive ? (
          <>
            <p className="text-sm text-stone-700">
              The village authorised this copy for you. You can download it once; every member is told when you do. Keep the
              file where only you can reach it.
            </p>
            <button type="button" disabled={busy} onClick={download} className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
              {busy ? "Downloading..." : "Download the copy"}
            </button>
          </>
        ) : (
          <p className="text-sm text-amber-700">You do not hold the steward role now, so this copy cannot be delivered. It stays unused.</p>
        )
      ) : (
        <p className="text-sm text-stone-700">The village authorised one copy for the steward this vote names. It has not been downloaded yet.</p>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
