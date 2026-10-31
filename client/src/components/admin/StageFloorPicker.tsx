import { useState } from "react";
import { toast } from "sonner";
import { API_BASE, authHeaders } from "./adminApi";

/**
 * Granting a stage, shown as the ladder it is (Rye, 2026-10-30: "when you click
 * on a level, have it automatically select all levels below so the UI is
 * showing that it's the floor and includes everything").
 *
 * A grant is ONE stage id on the server (`PUT /api/admin/players/:id/stage`),
 * and that stage is a floor: the member is at least there, with every stage
 * below it included. So ticking a level ticks everything beneath it, and
 * unticking a level moves the floor to the one below. Nothing here can tick a
 * set with a gap in it, because the server has no way to store one.
 */
export type Stage = { id: string; name: string };

export function floorAfterToggle(stages: Stage[], floor: string | null, index: number): string | null {
  const at = floor === null ? -1 : stages.findIndex((s) => s.id === floor);
  if (index > at) return stages[index]!.id;
  return index === 0 ? null : stages[index - 1]!.id;
}

export function StageFloorPicker({
  stages,
  value,
  onChange,
  label,
}: {
  stages: Stage[];
  value: string | null;
  onChange: (stageId: string | null) => void;
  label?: string;
}) {
  const at = value === null ? -1 : stages.findIndex((s) => s.id === value);
  const summary = at < 0 ? "No stage granted" : `Granted: ${stages[at]!.name} and below`;
  return (
    <details className="relative text-xs">
      <summary className="cursor-pointer list-none border border-gray-200 rounded-lg px-2 py-1.5 bg-white font-medium">
        {label ?? summary}
      </summary>
      <fieldset className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
        <legend className="sr-only">Stage floor</legend>
        <p className="px-1 pb-1 text-muted-foreground">A stage includes every stage below it.</p>
        {stages.map((s, i) => (
          <label key={s.id} className="flex min-h-9 items-center gap-2 rounded px-1 hover:bg-gray-50">
            <input type="checkbox" checked={i <= at} onChange={() => onChange(floorAfterToggle(stages, value, i))} />
            <span className={i === at ? "font-semibold" : undefined}>{s.name}</span>
          </label>
        ))}
        {at >= 0 && (
          <button type="button" onClick={() => onChange(null)} className="mt-1 w-full rounded px-1 py-1 text-left text-red-600 hover:bg-red-50">
            Remove the grant
          </button>
        )}
      </fieldset>
    </details>
  );
}

/**
 * The bar that appears once players are ticked: one stage floor for all of
 * them. The server takes one player per call, so this walks the list and says
 * how many landed. A refusal (an example identity answers 409) stops nobody else.
 */
export function BulkStageGrant({
  stages,
  ids,
  password,
  onDone,
}: {
  stages: Stage[];
  ids: string[];
  password: string;
  onDone: () => void;
}) {
  const [floor, setFloor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const apply = async () => {
    setBusy(true);
    let landed = 0;
    for (const id of ids) {
      try {
        const res = await fetch(`${API_BASE}/admin/players/${id}/stage`, {
          method: "PUT",
          headers: authHeaders(password, { "Content-Type": "application/json" }),
          body: JSON.stringify({ stageId: floor }),
        });
        if (res.ok) landed++;
      } catch {
        // counted below as not updated
      }
    }
    setBusy(false);
    const missed = ids.length - landed;
    if (missed === 0) toast.success(`Stage updated for ${landed} ${landed === 1 ? "player" : "players"}`);
    else toast.error(`Updated ${landed} of ${ids.length}. ${missed} could not be changed (example identities are refused).`);
    onDone();
  };
  const at = floor === null ? -1 : stages.findIndex((s) => s.id === floor);
  return (
    <div role="region" aria-label="Grant a stage to the selected players" className="sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-teal-deep/30 bg-white px-4 py-3 shadow-sm">
      <span className="text-sm font-medium">{ids.length} selected</span>
      <StageFloorPicker stages={stages} value={floor} onChange={setFloor} label={at < 0 ? "Pick a stage floor" : `${stages[at]!.name} and below`} />
      <button
        type="button"
        disabled={busy}
        onClick={apply}
        className="min-h-9 rounded-lg bg-teal-deep px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        {busy ? "Granting..." : floor === null ? "Remove their grants" : "Grant to selected"}
      </button>
      <button type="button" onClick={onDone} className="text-xs underline">
        Clear selection
      </button>
    </div>
  );
}
