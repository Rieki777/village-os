/**
 * THE WORDS THE SUCCESSION MODEL IS ALLOWED TO USE, AND THE SEAT'S OWN STORY.
 *
 * Two things, both pure, both about the same surface.
 *
 * ── THE WORDS ────────────────────────────────────────────────────────────
 *
 * The power map used to call a passed term a failure and the person holding
 * the seat late. Those were the only public deficit language in the whole
 * succession model, and they described something the code does not do:
 * `isLapsed` is derived on every read, writes nothing and revokes nothing, on
 * purpose, and its note in `server/lib/orgChart.ts` says a lapsed holding is
 * still a holding. So the map was announcing a punishment nobody performs,
 * over a named person, on a page everybody can see.
 *
 * The check is a plain read of the file bytes, comments included, and that is
 * deliberate. A rule about words the product may not say cannot be enforced
 * by a rule that only looks at some of them, and a copy sweep that leaves the
 * old phrasing sitting in a comment leaves the next person a template. If a
 * future note genuinely needs to quote the old words, it argues for itself
 * here rather than slipping past.
 *
 * It reads the DIRECTORY rather than a list of files, because the phrasing
 * turned up in a third place nobody had named: the map legend, alongside the
 * two the brief called out.
 *
 * ── THE STORY ────────────────────────────────────────────────────────────
 *
 * `lastHandover` is the one derived claim `SeatHistory` makes, and it is a
 * claim about named people on a shared page, so it is unit tested rather than
 * eyeballed. A seat that emptied and stayed empty has not been handed to
 * anybody, and a person who left and came back has not handed it to
 * themselves. Both would be a sentence about an event that did not happen.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { holderOrder, lastHandover, type SeatSeating } from "./SeatHistory";

const DIR = __dirname;

/** Words the succession surfaces may not use about a person or a seat. */
const REFUSED = ["overdue", "term ran out"];

function powerSurfaces(): string[] {
  return fs
    .readdirSync(DIR)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => path.join(DIR, f));
}

describe("the power map's words about a term that reached its date", () => {
  it("names no deficit anywhere under components/power", () => {
    const files = powerSurfaces();
    // A control on the reader itself. If the directory walk ever returns
    // nothing, or reads the wrong place, this is the assertion that says so
    // instead of the loop below passing over an empty list.
    expect(files.length, "no power surfaces were read").toBeGreaterThan(10);
    // The seat card is the surface that prints a holder's term, so the walk
    // must reach it. Its files sit flat in this directory for exactly this.
    expect(files.map((f) => path.basename(f))).toContain("SeatTradingCard.tsx");

    const guilty: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8").toLowerCase();
      for (const word of REFUSED) {
        if (src.includes(word)) guilty.push(`${path.basename(file)}: ${word}`);
      }
    }
    expect(guilty, `deficit language on the power map: ${guilty.join(", ")}`).toEqual([]);
  });

  it("says instead what the seat is waiting for, in the same words in every place", () => {
    // Three surfaces read the same state and said it three ways. One word,
    // true of a term that reached its date AND of a seating made in a season
    // that has turned, because `lapsed` covers both. The seat card's words
    // live in the view model it draws, `shared/roleSheet.ts`.
    const roleSheet = fs.readFileSync(path.join(DIR, "../../../../shared/roleSheet.ts"), "utf8");
    const legend = fs.readFileSync(path.join(DIR, "Legend.tsx"), "utf8");
    expect(roleSheet).toContain("ready to be re-chosen");
    expect(legend).toContain("ready to be re-chosen");
  });
});

const seating = (over: Partial<SeatSeating> & { id: string }): SeatSeating => ({
  name: "Ada",
  kind: "member",
  focus: null,
  startedAt: "2026-01-01T00:00:00.000Z",
  endedAt: null,
  endedReason: null,
  ...over,
});

describe("the handover a seat's history is allowed to claim", () => {
  it("does not tell a seat whose names were taken off that nobody ever held it", () => {
    // `releaseSeatingsForUser` clears `display_name` on every row a departing
    // member held, live and ended, so a seat two people carried for years can
    // come back with no names on it. `holderOrder` returns an empty list for
    // that seat AND for a seat nobody has ever held, and the card has to tell
    // those two apart: saying nobody held it would erase them a second time.
    const anonymised = [
      seating({ id: "a", name: null, endedAt: "2026-03-01T00:00:00.000Z" }),
      seating({ id: "b", name: null }),
    ];
    expect(holderOrder(anonymised)).toEqual([]);
    expect(anonymised.length, "and the rows are still there, which is what the card branches on").toBe(2);
  });

  it("says nothing at all about a seat only one person has ever held", () => {
    expect(lastHandover([seating({ id: "a" })])).toBeNull();
    expect(holderOrder([seating({ id: "a" })])).toEqual(["Ada"]);
  });

  it("says nothing about a seat that emptied and stayed empty", () => {
    // An ending on its own is not a handover. Nobody took it.
    expect(lastHandover([seating({ id: "a", endedAt: "2026-03-01T00:00:00.000Z" })])).toBeNull();
  });

  it("names the passing when one holding ended and another began", () => {
    const found = lastHandover([
      seating({ id: "a", name: "Ada", endedAt: "2026-03-01T00:00:00.000Z" }),
      seating({ id: "b", name: "Wren", startedAt: "2026-03-02T00:00:00.000Z" }),
    ]);
    expect(found).toEqual({ from: "Ada", to: "Wren", on: "2026-03-02T00:00:00.000Z" });
  });

  it("reports the MOST RECENT passing on a seat that has changed hands twice", () => {
    const found = lastHandover([
      seating({ id: "a", name: "Ada", endedAt: "2026-03-01T00:00:00.000Z" }),
      seating({ id: "b", name: "Tomas", startedAt: "2026-03-02T00:00:00.000Z", endedAt: "2026-06-01T00:00:00.000Z" }),
      seating({ id: "c", name: "Wren", startedAt: "2026-06-02T00:00:00.000Z" }),
    ]);
    expect(found).toEqual({ from: "Tomas", to: "Wren", on: "2026-06-02T00:00:00.000Z" });
    expect(holderOrder([
      seating({ id: "a", name: "Ada", endedAt: "2026-03-01T00:00:00.000Z" }),
      seating({ id: "b", name: "Tomas", startedAt: "2026-03-02T00:00:00.000Z", endedAt: "2026-06-01T00:00:00.000Z" }),
      seating({ id: "c", name: "Wren", startedAt: "2026-06-02T00:00:00.000Z" }),
    ])).toEqual(["Ada", "Tomas", "Wren"]);
  });

  it("does not call a person coming back to their own seat a handover", () => {
    // `active_holder_key` exists so somebody can hold a seat, leave it, and
    // hold it again years later. That is one person's return and there is
    // nobody on the other side of it.
    const found = lastHandover([
      seating({ id: "a", name: "Ada", endedAt: "2026-03-01T00:00:00.000Z" }),
      seating({ id: "b", name: "Ada", startedAt: "2029-01-01T00:00:00.000Z" }),
    ]);
    expect(found).toBeNull();
  });

  it("skips a holding whose name was taken off the record rather than naming a stranger", () => {
    // `releaseSeatingsForUser` clears `display_name` on every row a departing
    // member held, live and ended. A handover the page cannot attribute is a
    // handover it must not describe.
    const found = lastHandover([
      seating({ id: "a", name: null, endedAt: "2026-03-01T00:00:00.000Z" }),
      seating({ id: "b", name: "Wren", startedAt: "2026-03-02T00:00:00.000Z" }),
    ]);
    expect(found).toBeNull();
    expect(holderOrder([seating({ id: "a", name: null })])).toEqual([]);
  });
});
