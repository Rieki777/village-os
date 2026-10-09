/**
 * THE POWER LEGEND'S TALLY AGAINST THE STATES A SEAT CAN BE IN.
 *
 * Same defect class as gameMechanicsStates.test.ts and objectionStates.test.ts,
 * wearing its quietest costume. The legend did not crash on an unfamiliar
 * state; it did this:
 *
 *   const counts = { open: 0, partial: 0, filled: 0, forming: 0, expired: 0 };
 *   for (const s of counted) counts[s.state ?? ...] += 1;
 *
 * `counts[unknown]` is `undefined`, `undefined + 1` is `NaN`, and the result
 * went onto a key the render loop never reads. So the seat was counted
 * NOWHERE and the legend went on printing "3 open, 2 held" over six seats,
 * with nothing on the page short enough to notice. A miscount that looks like
 * a count is worse than a blank, and this is the page a village reads to
 * answer who holds power here.
 *
 * THE AUTHORITY IS THE SERVER'S TYPE, NOT A MIGRATION, and the reason is
 * written into orgChart.ts itself: the 0049 column is
 * `enum('open','filled','partial','forming')` and `expired` is DERIVED by
 * `seatState()` from the terms on a seat's holders. So the column can never
 * hold every state that arrives here, and reading the migration would give a
 * confident wrong answer of four. `SeatState` in `server/lib/orgChart.ts` is
 * the only enumeration of what the route actually sends.
 *
 * A SIXTH SEAT STATE ADDED TO THE SERVER FAILS THIS FILE.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SEAT_STATES } from "@shared/roleSheet";
import { SEAT_TALLY_BUCKETS } from "./Legend";

const ROOT = path.resolve(__dirname, "../../../..");

/** The states a seat can be in, off the server's own union. */
function seatStatesFromServer(): string[] {
  const src = fs.readFileSync(path.join(ROOT, "server/lib/orgChart.ts"), "utf8");
  const m = src.match(/export type SeatState\s*=\s*((?:"[a-z_]+"\s*\|\s*)+"[a-z_]+")\s*;/);
  if (!m) throw new Error("export type SeatState was not found in server/lib/orgChart.ts");
  const states = [...m[1].matchAll(/"([^"]+)"/g)].map((v) => v[1]);
  // A control on the reader: `expired` is the derived one, and its presence is
  // what proves this union was read and not the 0049 column.
  expect(states, "the union read does not look like seat states").toContain("expired");
  return states;
}

describe("the power legend counts every state a seat can be in", () => {
  it("has a bucket for every SeatState the server declares", () => {
    const states = seatStatesFromServer();
    // eslint-disable-next-line no-console
    console.log(`[states] ${states.length} seat state(s): ${states.join(", ")}`);
    const missing = states.filter((s) => !SEAT_TALLY_BUCKETS.includes(s as never));
    expect(missing, `the legend counts no bucket for seat state(s): ${missing.join(", ")}`).toEqual([]);
  });

  it("keeps one bucket for a state it has not been taught", () => {
    // Without this the tally silently loses seats, which is the defect.
    expect(SEAT_TALLY_BUCKETS).toContain("other");
  });

  it("the client's own copy of the union still matches the server's", () => {
    // The client's copy of `SeatState` is `SEAT_STATES` in shared/roleSheet.ts,
    // a runtime list the state words are keyed by; ./types re-exports its type
    // from there. Two declarations of one fact drift, and this is the cheap
    // place to catch it.
    expect([...SEAT_STATES].sort()).toEqual([...seatStatesFromServer()].sort());
    // And ./types keeps no hand-kept duplicate beside the re-export.
    const client = fs.readFileSync(path.join(ROOT, "client/src/components/power/types.ts"), "utf8");
    expect(client).toMatch(/import \{[^}]*type SeatStateWord[^}]*\} from "@shared\/roleSheet"/);
    expect(client).not.toMatch(/export type SeatStateWord\s*=/);
  });
});
