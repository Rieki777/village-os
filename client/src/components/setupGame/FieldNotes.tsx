/**
 * FIELD NOTES: the same forest as a plain checklist, for a screen reader and
 * for anyone who would rather read a table than walk a forest. It reads the
 * very same state as the Journey, so if a thing cannot be shown here, the
 * game is hiding something.
 */
import type { SettingsPayload } from "@/components/admin/comms/commsSettingsApi";
import type { LaunchItem, SeedState, SetupGameMap } from "./setupGameApi";
import { LAYER_WORD, orderedLayers, seedLight } from "./journeyModel";

const SAID = { alive: "Alive", planted: "Planted, not proven", open: "Not planted", unknown: "Not knowable here" } as const;

export default function FieldNotes({ map, launch, comms }: { map: SetupGameMap; launch: LaunchItem[]; comms: SettingsPayload | null }) {
  const rows = new Map(launch.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const lines: Array<{ s: SeedState; where: string }> = [];
  for (const layer of orderedLayers(map)) {
    for (const id of layer.seeds) {
      if (map.seeds[id] && !seen.has(id)) {
        seen.add(id);
        lines.push({ s: map.seeds[id], where: LAYER_WORD[layer.layer] ?? layer.title });
      }
    }
  }
  for (const m of map.modules) {
    if (m.lifecycle === "off") continue;
    for (const id of m.seeds) {
      if (map.seeds[id] && !seen.has(id)) {
        seen.add(id);
        lines.push({ s: map.seeds[id], where: m.name });
      }
    }
  }
  return (
    <div className="sg-notes">
      <table>
        <thead>
          <tr>
            <th scope="col">Planting</th>
            <th scope="col">Where</th>
            <th scope="col">Status</th>
            <th scope="col">What it grants</th>
            <th scope="col">Plant it</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(({ s, where }) => {
            const l = seedLight(s, rows, comms);
            return (
              <tr key={s.id}>
                <td>
                  <b>{s.title}</b>
                  {s.keystone ? " (keystone)" : ""}
                </td>
                <td>{where}</td>
                <td>
                  {SAID[l.light]}.{l.detail ? ` ${l.detail}` : ""}
                </td>
                <td>{s.consequence}</td>
                <td>{l.spring ? "In the Spring plot" : l.fixAt ? <a href={l.fixAt}>{l.fixLabel || "Open"}</a> : s.byHand ?? "On the hosting service"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
