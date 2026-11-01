/**
 * THE ONE HAND-OVER CONTROL (Rye, 2026-11-01): a checklist of the powers in
 * plain words, then a confirm.
 *
 * Before the Game starts, the ticks ARE what the launch hands to the village,
 * and a founder may leave every box empty. After it, a steward ticks the powers
 * to hand over now; a power the village already holds shows as held and stays
 * where it is. Same component, same API (`/api/governance/powers/hand-to-village`,
 * server/routes/stewardHandover.ts), same recorded act. It renders nothing for
 * somebody the server says may not use it, so it can sit on any page.
 */
import { useEffect, useState } from "react";
import { authToken } from "@/lib/gameApi";

const PATH = "/api/governance/powers/hand-to-village";

interface Power {
  capability: string;
  title: string;
  consequence: string;
  held: boolean;
}
interface Standing {
  gameStarted: boolean;
  mayAct: boolean;
  selected?: string[];
  /** Before launch, while the launch vote is open: the list is written into it. */
  frozen?: boolean;
  powers?: Power[];
}

const headers = (): Record<string, string> => {
  const t = authToken();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
};

export default function HandOverPowers() {
  const [standing, setStanding] = useState<Standing | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  const load = () =>
    fetch(PATH, { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: Standing | null) => {
        setStanding(s);
        setTicked(s && !s.gameStarted ? s.selected ?? [] : []);
      })
      .catch(() => setStanding(null));
  useEffect(() => {
    void load();
  }, []);

  if (!standing?.mayAct || !standing.powers) return null;
  const atLaunch = !standing.gameStarted;
  const frozen = atLaunch && !!standing.frozen;
  const toggle = (c: string) => {
    setConfirming(false);
    setTicked((t) => (t.includes(c) ? t.filter((x) => x !== c) : [...t, c]));
  };
  const send = () => {
    setBusy(true);
    setSaid(null);
    fetch(PATH, { method: "POST", headers: headers(), body: JSON.stringify({ capabilities: ticked, confirm: true }) })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) return setSaid(String(body.error ?? "That did not go through. Try again."));
        setSaid(
          atLaunch
            ? body.selected.length === 0
              ? "Saved. The launch hands the village none of its powers."
              : `Saved. The launch hands the village ${body.selected.length} of its powers.`
            : `Done. The village now holds ${body.moved.length} more of its powers.`,
        );
        setConfirming(false);
        await load();
      })
      .catch(() => setSaid("That did not go through. Try again."))
      .finally(() => setBusy(false));
  };

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5">
      <p className="font-semibold text-stone-900">{atLaunch ? "What the launch hands to the village" : "Hand powers to the village"}</p>
      <p className="mt-1 text-xs text-stone-600 max-w-lg leading-relaxed">
        {atLaunch
          ? "The stewards hold every power after launch. Tick the ones the village should hold from the moment its Game starts, or none. The stewards hand over the rest later, here."
          : "Tick the powers the village is ready to hold. From then on the village holds them, and only a village vote hands one back."}
      </p>
      <div className="mt-3 grid gap-2">
        {standing.powers.map((p) => (
          <label
            key={p.capability}
            className={`flex min-h-[44px] items-start gap-3 rounded-lg border px-3 py-2 text-sm ${
              p.held || ticked.includes(p.capability) ? "border-teal-deep bg-teal-deep/10 text-stone-900" : "border-stone-300 bg-white text-stone-700"
            }`}
          >
            <input
              type="checkbox"
              checked={p.held || ticked.includes(p.capability)}
              disabled={busy || p.held || frozen}
              onChange={() => toggle(p.capability)}
              className="mt-0.5 h-5 w-5 shrink-0 rounded border-stone-400 text-teal-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
            />
            <span>
              <span className="font-medium">{p.title}</span>
              {p.consequence && <span className="block text-xs text-stone-600">Lets whoever holds it {p.consequence}.</span>}
              {p.held && <span className="block text-xs text-teal-deep">The village holds this.</span>}
            </span>
          </label>
        ))}
      </div>
      {frozen && (
        <p className="mt-3 text-xs text-stone-700 max-w-lg">
          The launch vote is open, and this list is written into it. To change it, withdraw that vote and open a new one.
        </p>
      )}
      {!frozen && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {!confirming ? (
            <button
              type="button"
              disabled={busy || (!atLaunch && ticked.length === 0)}
              onClick={() => setConfirming(true)}
              className="min-h-[44px] rounded-lg bg-teal-deep px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {atLaunch ? "Save what the launch hands over" : `Hand over ${ticked.length}`}
            </button>
          ) : (
            <>
              <span className="text-xs text-stone-700 max-w-sm">
                {atLaunch
                  ? ticked.length === 0
                    ? "The launch will hand the village none of its powers. Confirm?"
                    : `The launch will hand the village ${ticked.length} of its powers. Confirm?`
                  : `The village will hold ${ticked.length} more of its powers, and only a village vote hands one back. Confirm?`}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={send}
                className="min-h-[44px] rounded-lg bg-teal-deep px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                Confirm
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming(false)}
                className="min-h-[44px] rounded-lg border border-stone-300 px-4 text-sm text-stone-700"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      )}
      {said && (
        <p role="status" className="mt-2 text-xs text-stone-700">
          {said}
        </p>
      )}
    </section>
  );
}
