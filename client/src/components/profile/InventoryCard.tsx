/**
 * WHAT YOU HAVE BORROWED, BOOKED AND ASKED TO RESERVE, on your own profile
 * (shared/profileInventory.ts; the 2026-08-11 foundation handoff, 3b).
 *
 * The rows come off `/api/me/profile`'s `inventory`, live only. The switch at
 * the foot sets `showInventory` (default off) through `/api/me/privacy`, and
 * decides whether a stranger reading your public profile sees the same list.
 *
 * Homes you asked about already have their own card on the Resident path
 * (PathFacts). When you walk that path the card says where they are and does
 * not list them twice; when you do not, they are listed here, since nowhere
 * else would show them.
 *
 * Nothing live and the card draws nothing at all: an empty box would read as
 * "you have nothing" when the truth is only "nothing right now".
 */
import { useEffect, useState } from "react";
import { gameFetch } from "@/lib/gameApi";
import {
  LOAN_WORDS,
  PRIVACY_URL,
  STAY_WORDS,
  isEmptyInventory,
  type Inventory,
} from "@shared/profileInventory";

const card = "rounded-3xl border border-border bg-card p-5 sm:p-6";
const row = "rounded-2xl border border-border bg-muted px-4 py-3 text-foreground";
const hint = "text-sm text-muted-foreground";

const humanize = (s: string) => s.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function InventoryList({ inventory, lotsOnPath = false }: { inventory: Inventory; lotsOnPath?: boolean }) {
  return (
    <div className="space-y-4">
      {inventory.loans.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-foreground">Borrowed from the library</h4>
          <ul className="mt-2 space-y-2">
            {inventory.loans.map((l) => (
              <li key={l.id} className={row} data-inventory-loan={l.id}>
                <span className="font-medium">{l.item}</span>
                <span className={`${hint} block`}>{[LOAN_WORDS[l.status] ?? l.status, l.dueOn ? `due ${l.dueOn}` : ""].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {inventory.stays.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-foreground">Stays</h4>
          <ul className="mt-2 space-y-2">
            {inventory.stays.map((s) => (
              <li key={s.id} className={row} data-inventory-stay={s.id}>
                <span className="font-medium">{s.place}</span>
                <span className={`${hint} block`}>{[STAY_WORDS[s.status] ?? s.status, s.arriveOn ? `arriving ${s.arriveOn}` : ""].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {inventory.lots.length > 0 &&
        (lotsOnPath ? (
          <p className={hint} data-inventory-lots-on-path="">
            The homes you asked about are on your Resident path card.
          </p>
        ) : (
          <div>
            <h4 className="text-sm font-semibold text-foreground">Homes you asked about</h4>
            <ul className="mt-2 space-y-2">
              {inventory.lots.map((h) => (
                <li key={h.id} className={row} data-inventory-lot={h.id}>
                  <span className="font-medium">{humanize(h.homeType)}</span>
                  <span className={`${hint} block`}>{[h.standing, h.structureKey ? `on the map as ${h.structureKey}` : ""].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}

export default function InventoryCard({ lotsOnPath = false }: { lotsOnPath?: boolean }) {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [shown, setShown] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    gameFetch("/api/me/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && d?.inventory && setInventory(d.inventory as Inventory))
      .catch(() => {});
    gameFetch(PRIVACY_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && typeof d?.privacy?.showInventory === "boolean" && setShown(d.privacy.showInventory))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (isEmptyInventory(inventory)) return null;

  const toggle = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await gameFetch(PRIVACY_URL, { method: "PUT", body: JSON.stringify({ showInventory: next }) });
      if (res.ok) setShown(next);
      else setError("That did not save. Try again.");
    } catch {
      setError("That did not save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="inventory-h" className={card} data-inventory="">
      <h3 id="inventory-h" className="font-display text-xl font-bold text-card-foreground">
        Borrowed and booked
      </h3>
      <div className="mt-4">
        <InventoryList inventory={inventory as Inventory} lotsOnPath={lotsOnPath} />
      </div>
      {shown !== null && (
        <label className="mt-5 flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={shown} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
          Show this on my public profile
        </label>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-foreground">
          {error}
        </p>
      )}
    </section>
  );
}
