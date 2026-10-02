/**
 * THE ROLE CARD'S VIEW MODEL, held to what it may and may not say.
 *
 * The pattern is CharacterSheet.test.tsx's: every claim the card makes about
 * a seat is asserted present where it is true and absent where it is not, and
 * every absence carries a known-positive control, so an assertion that a word
 * is missing cannot pass merely because nothing rendered.
 *
 * The fixtures are the shapes the routes actually send after the seat
 * projection (server/lib/seatProjection.ts): the map at the member and the
 * stranger tier, `/api/org` at its public and member tiers and in the shape it
 * had before the projection, and the live seats that have embarrassed a card
 * before (a seat declared Held with nobody in it, a seat declared Forming).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GAME_CONFIG } from "./gameConfig";
import { CAPABILITY_LABELS } from "./capabilities";
import { normaliseProposedSeat } from "./proposedSeats";
import {
  COMMITMENT_LABELS,
  SEAT_STATES,
  SHEET_WORDS,
  STATE_WORDS,
  daysUntil,
  fnv1a,
  formatDay,
  nameScaleFor,
  notReadLine,
  portraitFor,
  seatSheet,
  termWords,
  type SeatInput,
  type SeatSheetView,
  type SheetContext,
} from "./roleSheet";
import { permissionSheet } from "./permissionSheet";
import {
  PUBLIC_AGENT_NAME,
  fromMapSeat,
  fromOrgSeat,
  fromPermissionRole,
  fromProposedSeat,
  seasonForSheet,
} from "./roleSheetInputs";
import { daysUntil as mapDaysUntil } from "../client/src/components/power/types";

const ROOT = path.resolve(__dirname, "..");
const NOW = new Date("2026-10-01T12:00:00.000Z");
const SEASON = { name: "Season of Foundations", endsOn: "2027-03-21", daysLeft: 171 };
const CLASS_NAMES = {
  building: "The Builder",
  researching: "The Architect",
  facilitating: "The Spaceholder",
  catalyzing: "The Catalyst",
  storytelling: "The Storyteller",
};
const CTX: SheetContext = { now: NOW, season: SEASON, classNames: CLASS_NAMES };

const CIRCLES = [
  { id: "land", name: "Land & Water", decidesBy: null, color: "sage" },
  { id: "care", name: "Care Circle", decidesBy: "consensus", color: null },
];
const mapData = (viewPeople: boolean) => ({ circles: CIRCLES, power: { decidesBy: "consent" }, viewer: { viewPeople } });

const VENDOR = "Vendorbot Supreme";
const MARA_TERM = "2026-11-11T12:00:00.000Z";

/** The brief's sample, reconciled the first way: one of two holders is a lapsed agent. */
const SAMPLE_MAP = {
  id: "water-keeper",
  name: "Water Keeper",
  description: "Keep the village's water clean, flowing and understood.",
  domain: "The catchment, the tanks and the greywater lines",
  accountabilities: ["Testing the spring monthly", "Calling a repair before a failure"],
  whyItMatters: "A village that loses its water loses a season.",
  circleId: "land",
  seats: 2,
  minStage: null,
  holderCount: 2,
  vacant: false,
  state: "partial",
  stateSource: "derived",
  criticality: "high",
  recruiting: false,
  isExample: false,
  representsCircle: true,
  howChosen: "elected_by_circle",
  howChosenGloss: null,
  termEnds: MARA_TERM,
  archetypes: ["researching"],
  holders: [
    { userId: "u-mara", name: "Mara Quill", kind: "member", isAgent: false, focus: null, lapsed: false, avatar: null, termEndsAt: MARA_TERM },
    { userId: null, name: VENDOR, kind: "documented", isAgent: true, focus: null, lapsed: true, avatar: null, termEndsAt: null },
  ],
};

/** The same sample reconciled the other way: both current, the state set by hand. */
const SAMPLE_DECLARED = {
  ...SAMPLE_MAP,
  stateSource: "declared",
  holders: [
    SAMPLE_MAP.holders[0],
    { userId: "u-tomas", name: "Tomas Reed", kind: "member", isAgent: false, focus: "mornings only", lapsed: false, avatar: null, termEndsAt: null },
  ],
};

/** Name and aim only: what every fork starts with. */
const EMPTY_SEAT = {
  id: "seed-keeper",
  name: "Seed Keeper",
  description: "Tend the seed library.",
  domain: null,
  accountabilities: [],
  whyItMatters: null,
  circleId: "land",
  seats: 1,
  minStage: null,
  holderCount: 0,
  vacant: true,
  state: "open",
  stateSource: "derived",
  criticality: "normal",
  recruiting: false,
  isExample: false,
  representsCircle: false,
  howChosen: null,
  howChosenGloss: null,
  termEnds: null,
  archetypes: [],
  holders: [],
};

/** Live land-steward: declared filled, nobody seated. */
const LAND_STEWARD = { ...EMPTY_SEAT, id: "land-steward", name: "Land Steward", state: "filled", stateSource: "declared" };
/** Live governance-people: declared forming, nobody seated. */
const FORMING = { ...EMPTY_SEAT, id: "governance-people", name: "People Keeper", seats: 2, state: "forming", stateSource: "declared" };

const EXPIRED = {
  ...EMPTY_SEAT,
  id: "bridge-keeper",
  name: "Bridge Keeper",
  holderCount: 1,
  vacant: false,
  state: "expired",
  termEnds: "2026-09-20T12:00:00.000Z",
  holders: [
    { userId: "u-ana", name: "Ana Lima", kind: "member", isAgent: false, focus: null, lapsed: true, avatar: null, termEndsAt: "2026-09-20T12:00:00.000Z" },
  ],
};

/** A map seat as the projection serves it: below `viewPeople` the holder rows are an empty array. */
const fromMap = (seat: object, viewPeople = true, signedIn = true) =>
  fromMapSeat(viewPeople ? seat : { ...seat, holders: [] }, mapData(viewPeople), { signedIn });
const sheet = (input: SeatInput, ctx: SheetContext = CTX) => seatSheet(input, ctx);
const figure = (v: SeatSheetView, key: string) => v.figures.find((f) => f.key === key) ?? null;
const labels = (v: SeatSheetView) => v.figures.map((f) => f.label);

/** Every string value in a view, keys excluded. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}

// ── /api/org fixtures ───────────────────────────────────────────────────────

const ORG_PUBLIC_ROW = {
  id: "water-keeper",
  circleId: "land",
  name: "Water Keeper",
  aim: "Keep the village's water clean.",
  domain: "The catchment",
  accountabilities: ["Testing the spring monthly"],
  whyItMatters: "A village needs water.",
  seats: 2,
  criticality: "high",
  recruiting: true,
  state: "partial",
  holderCount: 2,
  isExample: false,
  representsCircle: true,
  howChosen: "volunteers",
  howChosenGloss: null,
  termEnds: MARA_TERM,
  archetypes: ["building"],
  stateSource: "derived",
  holders: [{ name: "Mara" }, { name: PUBLIC_AGENT_NAME }],
};
const ORG_MEMBER_ROW = {
  ...ORG_PUBLIC_ROW,
  holders: [
    { userId: "u-mara", name: "Mara Quill", kind: "member", isAgent: false, focus: null, lapsed: false, note: null, lapsedReason: null },
    { userId: null, name: VENDOR, kind: "documented", isAgent: true, focus: null, lapsed: true, note: null, lapsedReason: "season" },
  ],
};
/** Before the projection: no structure fields, no village, no isAgent. */
const ORG_PRE_A_ROW = (() => {
  const row: Record<string, unknown> = { ...ORG_MEMBER_ROW };
  for (const k of ["representsCircle", "howChosen", "howChosenGloss", "termEnds", "archetypes", "stateSource"]) delete row[k];
  row.holders = ORG_MEMBER_ROW.holders.map((h) => {
    const copy: Record<string, unknown> = { ...h };
    delete copy.isAgent;
    return copy;
  });
  return row;
})();
const PEOPLE_PUBLIC = { visible: true, membersOnly: false, signedIn: false };
const PEOPLE_MEMBER = { visible: true, membersOnly: true, signedIn: true };
const VILLAGE = { decidesBy: "consent" };

// ════════════════════════════════════════════════════════════════════════════

describe("figures: every number names its field, and unread is never 0", () => {
  const FIXTURES: Array<[string, SeatInput]> = [
    ["sample (lapsed agent)", fromMap(SAMPLE_MAP)],
    ["sample (declared)", fromMap(SAMPLE_DECLARED)],
    ["empty seat", fromMap(EMPTY_SEAT)],
    ["land-steward", fromMap(LAND_STEWARD)],
    ["forming", fromMap(FORMING)],
    ["expired", fromMap(EXPIRED)],
    ["stranger map", fromMap(SAMPLE_MAP, false, false)],
    ["org public", fromOrgSeat(ORG_PUBLIC_ROW, CIRCLES, PEOPLE_PUBLIC, VILLAGE)],
    ["org member", fromOrgSeat(ORG_MEMBER_ROW, CIRCLES, PEOPLE_MEMBER, VILLAGE)],
    ["org before the projection", fromOrgSeat(ORG_PRE_A_ROW, CIRCLES, PEOPLE_MEMBER, undefined)],
  ];

  /** Each source, spelled as a field of the input, and the arithmetic it names. */
  const BY_SOURCE: Record<string, (i: SeatInput, c: SheetContext) => number> = {
    seats: (i) => i.seats,
    holderCount: (i) => i.holderCount!,
    "holderCount - holders[].lapsed": (i) => i.holderCount! - i.holders.filter((h) => h.lapsed).length,
    "seats - holderCount": (i) => Math.max(0, i.seats - i.holderCount!),
    "accountabilities.length": (i) => i.accountabilities.length,
    "season.daysLeft": (_i, c) => c.season!.daysLeft!,
    termEnds: (i, c) => daysUntil(i.termEnds!, c.now)!,
    "holders[].termEndsAt": (i, c) =>
      Math.min(
        ...i.holders
          .map((h) => daysUntil(h.termEndsAt ?? null, c.now))
          .filter((d): d is number => d !== null && d >= 0),
      ),
  };

  it("traces every figure, and the clock, to a real input field", () => {
    let traced = 0;
    for (const [name, input] of FIXTURES) {
      const v = sheet(input);
      for (const f of [...v.figures, ...(v.clock ? [v.clock] : [])]) {
        const compute = BY_SOURCE[f.source];
        expect(compute, `${name}: ${f.key} names an unknown source "${f.source}"`).toBeTypeOf("function");
        // The field the source starts with exists on the input or the context.
        const field = f.source.split(/[ .[]/)[0];
        expect(field in input || field in CTX, `${name}: ${f.source}`).toBe(true);
        expect(f.value, `${name}: ${f.key}`).toBe(compute(input, CTX));
        traced++;
      }
    }
    expect(traced).toBeGreaterThan(30);
  });

  it("says Held now only where every holder row carries its lapse flag", () => {
    const stranger = sheet(fromMap(SAMPLE_MAP, false, false));
    expect(labels(stranger)).toContain("Seated");
    expect(labels(stranger)).not.toContain("Held now");
    expect(figure(stranger, "seated")!.value).toBe(2);
    // Control: the same seat at the member tier.
    const member = sheet(fromMap(SAMPLE_MAP));
    expect(labels(member)).toContain("Held now");
    expect(labels(member)).not.toContain("Seated");
    expect(figure(member, "heldNow")!.value).toBe(1);
    // The org public tier names people and carries no lapse: Seated.
    expect(labels(sheet(fromOrgSeat(ORG_PUBLIC_ROW, CIRCLES, PEOPLE_PUBLIC, VILLAGE)))).toContain("Seated");
    expect(labels(sheet(fromOrgSeat(ORG_MEMBER_ROW, CIRCLES, PEOPLE_MEMBER, VILLAGE)))).toContain("Held now");
  });

  it("prints no figure for a season it did not read, a season with no end, or a proposal's holders", () => {
    const input = fromMap(EMPTY_SEAT);
    expect(sheet(input, { ...CTX, season: null }).clock).toBeNull();
    expect(sheet(input, { ...CTX, season: { ...SEASON, daysLeft: null } }).clock).toBeNull();
    const proposal = sheet(fromProposedSeat(normaliseProposedSeat({ name: "Seed Keeper", seats: 2 }, [])));
    expect(proposal.figures.map((f) => f.key)).toEqual(["places"]);
    expect(proposal.clock).toBeNull();
    // Control: a READ zero prints zero, and a read season prints its clock.
    const v = sheet(input);
    expect(figure(v, "heldNow")!.value).toBe(0);
    expect(figure(v, "open")!.value).toBe(1);
    expect(v.clock).toMatchObject({ key: "seasonDays", value: 171, label: "Days left in the season", sub: "Season of Foundations ends 21 Mar 2027" });
    expect(sheet(input, { ...CTX, season: { ...SEASON, name: null } }).clock!.sub).toBe("The season ends 21 Mar 2027");
  });

  it("gilds and greens only above zero, and never greens a forming place", () => {
    const empty = sheet(fromMap(EMPTY_SEAT));
    expect(figure(empty, "heldNow")!.tone).toBeNull();
    expect(figure(empty, "open")!.tone).toBe("living");
    const forming = sheet(fromMap(FORMING));
    expect(figure(forming, "open")!.value).toBe(2);
    expect(figure(forming, "open")!.tone).toBeNull();
    const member = sheet(fromMap(SAMPLE_MAP));
    expect(figure(member, "heldNow")!.tone).toBe("gold");
    expect(figure(member, "open")!).toMatchObject({ value: 0, tone: null });
    expect(figure(member, "places")!.tone).toBeNull();
    for (const [, input] of FIXTURES) {
      for (const f of sheet(input).figures) if (f.value === 0) expect(f.tone, f.key).toBeNull();
    }
  });

  it("never prints a past term as a clock, and picks the earliest member term still ahead", () => {
    const expired = sheet(fromMap(EXPIRED));
    expect(expired.clock!.key).toBe("seasonDays");
    expect(expired.facts.term).toMatchObject({ value: "Reached its date on 20 Sep 2026", sub: "Ready to be re-chosen." });
    // Holders not served: the seat's own past term still never becomes a clock.
    expect(sheet(fromMap(EXPIRED, false, false)).clock!.key).toBe("seasonDays");
    const twoTerms = fromMap({
      ...SAMPLE_DECLARED,
      termEnds: "2026-09-01T12:00:00.000Z",
      holders: [
        { ...SAMPLE_DECLARED.holders[0], termEndsAt: "2026-09-01T12:00:00.000Z" },
        { ...SAMPLE_DECLARED.holders[1], termEndsAt: "2026-12-01T12:00:00.000Z" },
        { userId: "u-ivo", name: "Ivo", kind: "member", isAgent: false, lapsed: false, termEndsAt: MARA_TERM },
      ],
      holderCount: 3,
      seats: 3,
    });
    expect(sheet(twoTerms).clock).toMatchObject({ key: "termDays", value: 41, source: "holders[].termEndsAt", sub: "Term ends 11 Nov 2026" });
    // Control: with no member rows, a future termEnds is the clock.
    const fromSeat = sheet(fromMap({ ...EMPTY_SEAT, holderCount: 1, termEnds: MARA_TERM, holders: [] }, false));
    expect(fromSeat.clock).toMatchObject({ key: "termDays", value: 41, source: "termEnds" });
    for (const v of [expired, sheet(twoTerms), fromSeat]) {
      for (const f of [...v.figures, ...(v.clock ? [v.clock] : [])]) expect(f.value).toBeGreaterThanOrEqual(0);
    }
  });

  /*
   * R55: no pay, tenure, hours, rank, averages or scoreboard on any face.
   * Scanned over string VALUES, since the view's own key `commitments` is not
   * shipped language. "Its commitments" is the one sanctioned use of the word:
   * it names the ladder of written-down duties, and it is never a measure.
   */
  const R55 = /holders to date|tenure|average|rank|hours|per week|pay|wage|salary|commitment|%|scoreboard|power level/i;
  const r55Hits = (view: unknown) =>
    strings(view)
      .map((s) => s.replace(/Its commitments/g, ""))
      .filter((s) => R55.test(s));

  it("passes the R55 scan on every view model", () => {
    const views: unknown[] = FIXTURES.map(([, input]) => sheet(input));
    views.push(sheet(fromProposedSeat(normaliseProposedSeat({ role_name: "Seed Keeper", aim: "Keep seed." }, []))));
    views.push(
      permissionSheet(fromPermissionRole({ id: "t", name: "Treasurer", capabilities: ["exchange.manage", "redemption.confirm"], seats: 1, holderCount: 0, holders: [] }), {
        stages: GAME_CONFIG.stages,
        roleWord: "Role",
        now: NOW,
      }),
    );
    for (const v of views) expect(r55Hits(v)).toEqual([]);
    // Control: the scanner flags a planted number-shaped claim.
    expect(r55Hits({ a: ["fine", { b: "About 8 hours a week" }] })).toEqual(["About 8 hours a week"]);
    expect(r55Hits({ a: "Commitment 40" })).toEqual(["Commitment 40"]);
  });
});

describe("the state line, where the badge and the figures meet", () => {
  it("covers every rule, first match first", () => {
    expect(sheet(fromMap(SAMPLE_MAP)).stateLine).toBe("1 of 2 seated is ready to be re-chosen.");
    const bothLapsed = { ...SAMPLE_MAP, holders: SAMPLE_MAP.holders.map((h) => ({ ...h, lapsed: true })) };
    expect(sheet(fromMap(bothLapsed)).stateLine).toBe("Everyone seated here is ready to be re-chosen.");
    expect(sheet(fromMap({ ...SAMPLE_MAP, seats: 4, holderCount: 3, holders: [...SAMPLE_MAP.holders, { ...SAMPLE_MAP.holders[1], userId: null, name: "Bo" }] })).stateLine).toBe(
      "2 of 3 seated are ready to be re-chosen.",
    );
    expect(sheet(fromMap(SAMPLE_DECLARED)).stateLine).toBe("This state was set by hand.");
    expect(sheet(fromMap(EXPIRED, false, false)).stateLine).toBe("Everyone seated here is ready to be re-chosen.");
    expect(sheet(fromMap(SAMPLE_MAP, false, false)).stateLine).toBe("At least one place is ready to be re-chosen.");
    expect(sheet(fromMap(EMPTY_SEAT)).stateLine).toBeNull();
  });

  it("never draws a re-chosen claim from a state set by hand", () => {
    for (const state of SEAT_STATES) {
      for (const viewPeople of [true, false]) {
        const seat = { ...SAMPLE_DECLARED, state, holders: viewPeople ? SAMPLE_DECLARED.holders : [] };
        const line = sheet(fromMap(seat, viewPeople)).stateLine;
        expect(line, `${state}`).toBe("This state was set by hand.");
      }
    }
    // Control: the same stranger seat, derived, does make the claim.
    expect(sheet(fromMap({ ...SAMPLE_DECLARED, state: "expired", stateSource: "derived" }, false)).stateLine).toBe(
      "Everyone seated here is ready to be re-chosen.",
    );
  });

  it("hands the badge's glyph the held-now count where it is read, else Seated, and 0 on an open seat", () => {
    expect(sheet(fromMap(SAMPLE_MAP)).badge).toMatchObject({ word: "partial", held: 1 });
    expect(sheet(fromMap(SAMPLE_MAP, false, false)).badge).toMatchObject({ word: "partial", held: 2 });
    expect(sheet(fromMap(SAMPLE_DECLARED)).badge).toMatchObject({ held: 2 });
    // An open state set by hand over a seated seat still draws the empty ring.
    expect(sheet(fromMap({ ...SAMPLE_DECLARED, state: "open" })).badge).toMatchObject({ word: "open", held: 0 });
    // Control: the same seat, filled, draws the two it holds.
    expect(sheet(fromMap({ ...SAMPLE_DECLARED, state: "filled" })).badge).toMatchObject({ word: "filled", held: 2 });
  });

  it("tells the truth about the live seat declared Held with nobody in it", () => {
    const v = sheet(fromMap(LAND_STEWARD));
    expect(v.badge).toMatchObject({ word: "filled", label: "Held" });
    expect(figure(v, "heldNow")!.value).toBe(0);
    expect(figure(v, "open")!.value).toBe(1);
    expect(v.stateLine).toBe("This state was set by hand.");
    expect(v.action.kind).toBe("raise");
  });
});

describe("the one action a seat offers", () => {
  const act = (seat: object, opts: { viewPeople?: boolean; signedIn?: boolean } = {}) =>
    sheet(fromMap(seat, opts.viewPeople ?? true, opts.signedIn ?? true)).action;
  const FULL = {
    ...EMPTY_SEAT,
    state: "filled",
    holderCount: 1,
    holders: [{ userId: null, name: "Ana Lima", kind: "documented", isAgent: false, lapsed: false, avatar: null, termEndsAt: null }],
  };

  it("invites a hand on open, partial, expired and recruiting-while-full seats", () => {
    expect(act(EMPTY_SEAT)).toMatchObject({
      kind: "raise",
      label: "Raise your hand",
      ariaLabel: "Raise your hand for Seed Keeper",
      consequence: "A raised hand reaches the founding team, who will be in touch.",
    });
    expect(act(SAMPLE_MAP).kind).toBe("raise");
    expect(act(EXPIRED).kind).toBe("raise");
    expect(act({ ...FULL, recruiting: true }).kind).toBe("raise");
    // Control: the same full seat, not recruiting, offers no hand.
    expect(act(FULL).kind).toBe("unreachable");
  });

  it("offers nothing on a forming seat unless it is recruiting, on an example, or on a proposal", () => {
    expect(act(FORMING).kind).toBe("none");
    expect(act({ ...FORMING, recruiting: true }).kind).toBe("raise");
    expect(act({ ...EMPTY_SEAT, isExample: true }).kind).toBe("none");
    expect(sheet(fromProposedSeat(normaliseProposedSeat({ name: "Seed Keeper" }, []))).action.kind).toBe("none");
  });

  it("asks a signed-out reader to sign in first", () => {
    expect(act(EMPTY_SEAT, { signedIn: false })).toMatchObject({ kind: "signIn", label: "Sign in to raise your hand" });
  });

  it("offers the relay for a member holder on the map, and never from /api/org", () => {
    const member = { ...FULL, holders: [{ ...FULL.holders[0], userId: "u-ana", kind: "member" }] };
    expect(act(member)).toMatchObject({ kind: "contact", label: "Contact Ana Lima", contactUserId: "u-ana" });
    const orgRow = { ...member, aim: member.description };
    expect(sheet(fromOrgSeat(orgRow, CIRCLES, PEOPLE_MEMBER, VILLAGE, { raiseHand: true })).action.kind).toBe("none");
    // An agent is never contactable: it is seated as a documented holder.
    expect(act({ ...FULL, holders: [{ ...FULL.holders[0], userId: "u-bot", isAgent: true }] }).kind).toBe("unreachable");
  });

  it("offers a raised hand on /api/org only where the host says the map is on", () => {
    const row = { ...EMPTY_SEAT, aim: "Tend the seed library." };
    expect(sheet(fromOrgSeat(row, CIRCLES, PEOPLE_MEMBER, VILLAGE)).action.kind).toBe("none");
    expect(sheet(fromOrgSeat(row, CIRCLES, PEOPLE_MEMBER, VILLAGE, { raiseHand: true })).action.kind).toBe("raise");
    expect(sheet(fromOrgSeat(row, CIRCLES, PEOPLE_PUBLIC, VILLAGE, { raiseHand: true })).action.kind).toBe("signIn");
  });

  it("says a held seat on the map is not reachable yet, and says it once", () => {
    const v = sheet(fromMap(FULL));
    expect(v.action.label).toBeNull();
    expect(v.rosterNote).toBe("Held, and not reachable through the map yet.");
  });
});

describe("the roster: one spot per place", () => {
  it("draws the sample as Mara, then an agent ready to be re-chosen", () => {
    const v = sheet(fromMap(SAMPLE_MAP));
    expect(v.spots.map((s) => [s.kind, s.title, s.sub, s.ready])).toEqual([
      ["person", "Mara Quill", "term ends 11 Nov", false],
      ["agent", "An agent", "ready to be re-chosen", true],
    ]);
    expect(v.spots[0]).toMatchObject({ subIsDate: true, pickKey: "u-mara" });
    expect(v.spots[1]).toMatchObject({ avatar: null, pickKey: null });
  });

  it("never carries an agent's served name", () => {
    for (const input of [fromMap(SAMPLE_MAP), fromOrgSeat(ORG_MEMBER_ROW, CIRCLES, PEOPLE_MEMBER, VILLAGE)]) {
      // Control: the vendor's name is in what the route served.
      expect(JSON.stringify(input)).toContain(VENDOR);
      expect(JSON.stringify(sheet(input))).not.toContain(VENDOR);
    }
  });

  it("reads the public tier's literal as an agent, and nothing else as one", () => {
    const input = fromOrgSeat(ORG_PUBLIC_ROW, CIRCLES, PEOPLE_PUBLIC, VILLAGE);
    expect(input.holders.map((h) => h.isAgent)).toEqual([undefined, true]);
    expect(sheet(input).spots.map((s) => s.kind)).toEqual(["person", "agent"]);
  });

  it("pins the literal to the server's own", () => {
    const src = fs.readFileSync(path.join(ROOT, "server/lib/seatProjection.ts"), "utf8");
    const served = /export const PUBLIC_AGENT_NAME = "([^"]+)";/.exec(src);
    expect(served, "server/lib/seatProjection.ts no longer declares PUBLIC_AGENT_NAME").not.toBeNull();
    expect(served![1]).toBe(PUBLIC_AGENT_NAME);
  });

  it("numbers the spots exactly as the places, and caps open places at three", () => {
    const twelve = sheet(fromMap({ ...EMPTY_SEAT, seats: 12 }));
    expect(twelve.spots).toHaveLength(3);
    expect(twelve.moreOpen).toBe(9);
    expect(twelve.moreOpenLine).toBe("+9 more open places");
    expect(sheet(fromMap({ ...EMPTY_SEAT, seats: 4 })).moreOpenLine).toBe("+1 more open place");
    for (const seat of [SAMPLE_MAP, SAMPLE_DECLARED, EMPTY_SEAT, FORMING, EXPIRED, { ...EMPTY_SEAT, seats: 3 }]) {
      for (const viewPeople of [true, false]) {
        const v = sheet(fromMap(seat, viewPeople));
        expect(v.spots.length + v.moreOpen, `${seat.id} ${viewPeople}`).toBe(seat.seats);
      }
    }
    expect(sheet(fromMap({ ...EMPTY_SEAT, seats: 3 })).spots.map((s) => s.sub)).toEqual([
      "Nobody holds this yet",
      "Nobody holds this yet",
      "Nobody holds this yet",
    ]);
  });

  it("gives a stranger a nameless Seated spot per seating, and says why", () => {
    const v = sheet(fromMap(SAMPLE_MAP, false, false));
    expect(v.spots.map((s) => s.title)).toEqual(["Seated", "Seated"]);
    expect(v.rosterNote).toBe("Sign in to see who holds it.");
    expect(v.action.kind).toBe("signIn");
    expect(sheet(fromMap(SAMPLE_MAP, false, true)).rosterNote).toBe("Names are not shared on this page.");
    // Control: a member reads the names and no note.
    expect(sheet(fromMap(SAMPLE_MAP)).rosterNote).toBeNull();
  });

  it("draws forming places quietly, and waiting places once somebody holds the seat", () => {
    expect(sheet(fromMap(FORMING)).spots.map((s) => [s.kind, s.title, s.sub])).toEqual([
      ["forming", "A place still forming", null],
      ["forming", "A place still forming", null],
    ]);
    const half = sheet(fromMap({ ...SAMPLE_DECLARED, seats: 3, holderCount: 2 }));
    expect(half.spots.at(-1)).toMatchObject({ kind: "open", title: "Open place", sub: "Waiting for a hand" });
    expect(half.spots[1]).toMatchObject({ title: "Tomas Reed", sub: "mornings only" });
  });
});

describe("the commitments: seven, one look each", () => {
  const FULL_INPUT = (): SeatInput => fromMap({ ...SAMPLE_DECLARED, circleId: "care" });
  const looks = (v: SeatSheetView) => Object.fromEntries(v.commitments.map((c) => [c.key, c.look]));
  const chip = (v: SeatSheetView, key: string) => v.commitments.find((c) => c.key === key) ?? null;

  it("gilds every one on a fully written seat, and the box stays silent", () => {
    const v = sheet(FULL_INPUT());
    expect(v.commitments.map((c) => c.label)).toEqual(Object.values(COMMITMENT_LABELS));
    expect(new Set(Object.values(looks(v)))).toEqual(new Set(["gilded"]));
    expect(v.tally).toEqual({ written: 7, of: 7 });
    expect(v.stillToWrite).toBeNull();
    expect(v.flip.pips).toEqual(Array(7).fill("lit"));
    expect(v.commitments.every((c) => c.srWords === ", written down")).toBe(true);
  });

  it("draws the empty seat as the spec does", () => {
    const v = sheet(fromMap(EMPTY_SEAT));
    expect(looks(v)).toEqual({
      aim: "gilded",
      domain: "dashed",
      accountabilities: "dashed",
      why: "dashed",
      term: "edged",
      nextHolder: "dashed",
      decides: "edged",
    });
    expect(chip(v, "term")).toMatchObject({ suffix: "set at seating", srWords: ", set when someone is seated" });
    expect(chip(v, "decides")).toMatchObject({ suffix: "the village's", srWords: ", the village's way" });
    expect(chip(v, "domain")!.srWords).toBe(", still to be written down");
    expect(v.tally).toEqual({ written: 1, of: 7 });
    expect(v.flip.sub).toBe("Its commitments. 1 of 7 written down.");
    expect(v.flip.pips).toEqual(["lit", "empty", "empty", "empty", "edged", "empty", "edged"]);
    expect(v.stillToWrite).toBe(
      "Still to be written down: what it decides on, what it answers for, why it matters and how the next holder is chosen. The founding team writes these down.",
    );
    expect(v.facts.term).toEqual({ label: "Term", value: "Set at seating", sub: "With no date asked, it ends with the season.", isDate: false });
    expect(v.facts.wayOfDeciding).toMatchObject({ value: "Consent", sub: "The village's way. Land & Water has not set one of its own." });
    expect(v.facts.nextHolder).toBeNull();
    expect(v.portrait).toEqual({ kind: "sigil", letter: "S" });
    expect(v.chips.suits).toBeNull();
    expect(v.eyebrow).toBe("Land & Water");
    expect(v.circleColour).toMatch(/^var\(--circle-/);
  });

  it("lights Term from a date past or future, and dashes it when someone sits with none", () => {
    expect(chip(sheet(fromMap(SAMPLE_MAP)), "term")!.look).toBe("gilded");
    expect(chip(sheet(fromMap(EXPIRED)), "term")!.look).toBe("gilded");
    expect(chip(sheet(fromMap({ ...SAMPLE_DECLARED, termEnds: null })), "term")!.look).toBe("dashed");
    const noTerm: Record<string, unknown> = { ...SAMPLE_DECLARED };
    delete noTerm.termEnds;
    expect(chip(sheet(fromMap(noTerm)), "term")).toBeNull();
  });

  it("gilds a circle's own way, edges the village's, and dashes neither", () => {
    expect(chip(sheet(fromMap({ ...EMPTY_SEAT, circleId: "care" })), "decides")!.look).toBe("gilded");
    expect(sheet(fromMap({ ...EMPTY_SEAT, circleId: "care" })).facts.wayOfDeciding).toMatchObject({ value: "Consensus", sub: "Care Circle's own way." });
    const noWay = fromMapSeat(EMPTY_SEAT, { ...mapData(true), power: { decidesBy: null } }, { signedIn: true });
    expect(chip(sheet(noWay), "decides")!.look).toBe("dashed");
    const unread = fromMapSeat(EMPTY_SEAT, { ...mapData(true), power: undefined }, { signedIn: true });
    expect(chip(sheet(unread), "decides")).toBeNull();
    expect(sheet(fromMap({ ...EMPTY_SEAT, circleId: null })).facts.wayOfDeciding!.sub).toBe("The village's way.");
  });

  it("dashes Next holder when it is not written, and leaves it out when it is not read", () => {
    expect(chip(sheet(fromMap(SAMPLE_MAP)), "nextHolder")!.look).toBe("gilded");
    expect(sheet(fromMap(SAMPLE_MAP)).facts.nextHolder).toMatchObject({ value: "Elected by the circle" });
    expect(sheet(fromMap({ ...SAMPLE_MAP, howChosen: "other", howChosenGloss: "Drawn by lot at the solstice" })).facts.nextHolder!.value).toBe(
      "Drawn by lot at the solstice",
    );
    expect(chip(sheet(fromMap({ ...SAMPLE_MAP, howChosen: null })), "nextHolder")!.look).toBe("dashed");
  });

  it("keeps the sentences the seat card has always said, closed with who writes them", () => {
    const close = " The founding team writes these down.";
    const line = (over: Partial<SeatInput>) => sheet({ ...FULL_INPUT(), ...over }).stillToWrite;
    expect(line({ domain: null })).toBe(`Still to be written down: what it decides on.${close}`);
    expect(line({ domain: "   " })).toBe(`Still to be written down: what it decides on.${close}`);
    expect(line({ domain: null, whyItMatters: "" })).toBe(`Still to be written down: what it decides on and why it matters.${close}`);
    expect(line({ domain: null, accountabilities: [], whyItMatters: null })).toBe(
      `Still to be written down: what it decides on, what it answers for and why it matters.${close}`,
    );
    const blank = { aim: null, domain: null, accountabilities: [], whyItMatters: null };
    expect(line(blank)).toBe(`Nobody has written down what this seat is for yet.${close}`);
    expect(line({ ...blank, howChosen: null })).toBe(
      `Nobody has written down what this seat is for yet. Also still to be written down: how the next holder is chosen.${close}`,
    );
    expect(line({ howChosen: null, termEnds: null })).toBe(`Still to be written down: when the term ends and how the next holder is chosen.${close}`);
  });

  it("leaves unread commitments out of the tally, and says what the page does not carry", () => {
    const before = sheet(fromOrgSeat(ORG_PRE_A_ROW, CIRCLES, PEOPLE_MEMBER, undefined));
    expect(before.commitments.map((c) => c.key)).toEqual(["aim", "domain", "accountabilities", "why"]);
    expect(before.tally).toEqual({ written: 4, of: 4 });
    expect(before.unreadLine).toBe(
      "This page does not carry when the term ends, how the next holder is chosen and how its decisions pass.",
    );
    // Control: the same seat after the projection carries all seven.
    const after = sheet(fromOrgSeat(ORG_MEMBER_ROW, CIRCLES, PEOPLE_MEMBER, VILLAGE));
    expect(after.tally.of).toBe(7);
    expect(after.unreadLine).toBeNull();
  });

  it("keys the state words by the union, and never says Open Role", () => {
    expect(Object.keys(STATE_WORDS).sort()).toEqual([...SEAT_STATES].sort());
    expect(Object.values(STATE_WORDS)).not.toContain("Open Role");
    expect(STATE_WORDS.expired).toBe("Ready to be re-chosen");
    for (const state of SEAT_STATES) {
      expect(sheet(fromMap({ ...EMPTY_SEAT, state })).badge).toMatchObject({ word: state, label: STATE_WORDS[state] });
    }
  });
});

describe("the portrait and the chips", () => {
  it("picks one stock drawing per seat, the same every time, from art that ships", () => {
    const a = portraitFor({ id: "water-keeper", name: "Water Keeper" }, ["researching"], CLASS_NAMES);
    expect(portraitFor({ id: "water-keeper", name: "Water Keeper" }, ["researching"], CLASS_NAMES)).toEqual(a);
    expect(a).toMatchObject({ kind: "class", key: "researching", alt: "Stock art for The Architect, a class suggested for this seat" });
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const p = portraitFor({ id: `seat-${i}`, name: "Seat" }, ["building"]);
      if (p.kind !== "class") throw new Error("expected class art");
      expect(fs.existsSync(path.join(ROOT, "client/public", p.src)), p.src).toBe(true);
      seen.add(p.src);
    }
    expect(seen.size).toBe(6);
    expect(fnv1a("water-keeper")).toBe(fnv1a("water-keeper"));
  });

  it("draws the sigil for no tag or a key that is not a class", () => {
    expect(portraitFor({ id: "x", name: "bridge keeper" }, [])).toEqual({ kind: "sigil", letter: "B" });
    expect(portraitFor({ id: "x", name: "Bridge" }, undefined)).toEqual({ kind: "sigil", letter: "B" });
    expect(portraitFor({ id: "x", name: "Bridge" }, ["wizardry"])).toEqual({ kind: "sigil", letter: "B" });
  });

  it("names the class only once the village's own names are read", () => {
    const unread = sheet(fromMap(SAMPLE_MAP), { ...CTX, classNames: null });
    expect(unread.chips.suits).toBeNull();
    expect(JSON.stringify(unread)).not.toContain("The Architect");
    expect(unread.portrait).toMatchObject({ kind: "class", alt: "Stock art for a class suggested for this seat" });
    // Control: once read, the chip and the alt carry the village's word.
    const read = sheet(fromMap(SAMPLE_MAP));
    expect(read.chips.suits).toEqual({ key: "researching", name: "The Architect" });
    expect(JSON.stringify(read)).toContain("The Architect");
  });

  it("shows Speaks for with no class tag at all", () => {
    const v = sheet(fromMap({ ...SAMPLE_MAP, archetypes: [] }));
    expect(v.chips.suits).toBeNull();
    expect(v.chips.speaksFor).toBe("Land & Water");
    // Control: and without representation, no chip.
    expect(sheet(fromMap({ ...SAMPLE_MAP, representsCircle: false })).chips.speaksFor).toBeNull();
  });

  it("raises Key seat and Recruiting only from their own flags", () => {
    const v = sheet(fromMap({ ...SAMPLE_MAP, recruiting: true }));
    expect(v.chips).toMatchObject({ keySeat: true, recruiting: true });
    expect(sheet(fromMap(EMPTY_SEAT)).chips).toMatchObject({ keySeat: false, recruiting: false });
  });

  it("sizes the name at 22 and 36 characters", () => {
    expect(nameScaleFor("a".repeat(22))).toBe("lg");
    expect(nameScaleFor("a".repeat(23))).toBe("md");
    expect(nameScaleFor("a".repeat(36))).toBe("md");
    expect(nameScaleFor("a".repeat(37))).toBe("sm");
    expect(sheet(fromMap({ ...EMPTY_SEAT, name: "Regenerative Agriculture and Permaculture Circle Lead" })).nameScale).toBe("sm");
  });

  it("keeps a long domain whole and every accountability", () => {
    const domain = "The catchment and every tank, ".repeat(11).slice(0, 322);
    expect(domain).toHaveLength(322);
    const seven = Array.from({ length: 7 }, (_, i) => `Duty ${i + 1}: keep the record of the spring and the tanks up to date`);
    const v = sheet(fromMap({ ...SAMPLE_MAP, domain, accountabilities: seven }));
    expect(v.sections.domain).toBe(domain.trim());
    expect(v.sections.accountabilities).toEqual(seven);
    expect(figure(v, "answersFor")).toMatchObject({ value: 7, wideOnly: true });
    expect(v.flip.sub).toBe("What it decides on and answers for. 6 of 7 written down.");
  });
});

describe("the permission face", () => {
  const ROLE = {
    id: "treasurer",
    name: "Treasurer",
    description: "Keeps the books.",
    capabilities: ["exchange.manage", "redemption.confirm", "made.up.power"],
    minStage: "co-creator",
    isExample: false,
    circleId: null,
    seats: 3,
    holderCount: 1,
    holders: [{ userId: "u-mara", name: "Mara" }],
  };
  const STAGES = GAME_CONFIG.stages.map((s) => ({ id: s.id, name: s.name }));
  const face = (role: object = ROLE, stages: typeof STAGES | null = STAGES) =>
    permissionSheet(fromPermissionRole(role, { signedIn: true }), { stages, roleWord: "Role", now: NOW });

  it("names powers by their labels and never by their keys", () => {
    const v = face();
    expect(v.powers).toEqual([CAPABILITY_LABELS["exchange.manage"], CAPABILITY_LABELS["redemption.confirm"], "A power this page cannot name yet"]);
    expect(JSON.stringify(ROLE)).toContain("made.up.power");
    for (const key of ROLE.capabilities) expect(JSON.stringify(v)).not.toContain(key);
    expect(v.figures.find((f) => f.key === "powers")!.value).toBe(3);
    expect(v.eyebrow).toBe("A role with powers");
  });

  it("draws all twelve served rungs, verbatim, around the one it asks for", () => {
    const v = face();
    expect(v.rungs).toHaveLength(12);
    expect(v.rungs!.map((r) => r.name)).toContain("Co-Creator");
    expect(v.rungs!.filter((r) => r.current)).toHaveLength(1);
    const at = v.rungs!.findIndex((r) => r.current);
    expect(v.rungs![at]).toMatchObject({ id: "co-creator", look: "inverted", srWords: ", the rung it asks for" });
    expect(v.rungs!.slice(0, at).every((r) => r.look === "plain" && r.srWords === ", below the rung it asks for")).toBe(true);
    expect(v.rungs!.slice(at + 1).every((r) => r.look === "lit" && r.srWords === ", also qualifies")).toBe(true);
    expect(v.rungLine).toBe("Asks for Co-Creator or above. The vote turns away anyone on a lower rung.");
  });

  it("says plainly when no rung is asked, the rung is unknown, or the stages are unread", () => {
    expect(face({ ...ROLE, minStage: null })).toMatchObject({ rungs: null, rungLine: "This role asks for no rung." });
    expect(face({ ...ROLE, minStage: "archmage" })).toMatchObject({ rungs: null, rungLine: "Asks for a rung this village no longer names." });
    expect(face(ROLE, null)).toMatchObject({ rungs: null, rungLine: "Asks for co-creator or above. The vote turns away anyone on a lower rung." });
  });

  it("counts Seated, never Held now, and a vote fills its open places", () => {
    const v = face();
    expect(v.figures.map((f) => f.label)).toEqual(["Places", "Seated", "Open places", "Powers"]);
    expect(v.spots.map((s) => [s.title, s.sub])).toEqual([
      ["Mara", null],
      ["Open place", "A vote fills this place"],
      ["Open place", "A vote fills this place"],
    ]);
    expect(face({ ...ROLE, description: "" }).whatItDoes).toBe("Nobody has written down what this role does yet.");
  });
});

describe("the proposal face", () => {
  it("reads vendor aliases the way accepting does, and counts four commitments", () => {
    const norm = normaliseProposedSeat(
      {
        role_name: "Seed Keeper",
        seat_count: 2,
        why_it_matters: "Seeds outlive us.",
        circle: "Land & Water",
        aim: "Keep the seed library.",
        accountabilities: "Save seed; Share seed",
        recruiting: true,
        vendor_score: 9,
      },
      [],
    );
    const v = sheet(fromProposedSeat(norm));
    expect(v.name).toBe("Seed Keeper");
    expect(v.eyebrow).toBe("Land & Water");
    expect(v.badge).toMatchObject({ word: "proposed", label: "Proposed" });
    expect(v.figures.map((f) => [f.key, f.value])).toEqual([
      ["places", 2],
      ["answersFor", 2],
    ]);
    expect(v.tally).toEqual({ written: 3, of: 4 });
    expect(v.spots).toEqual([]);
    expect([v.clock, v.stateLine, v.unreadLine, v.rosterNote]).toEqual([null, null, null, null]);
    expect(v.action.kind).toBe("none");
    expect(v.chips.recruiting).toBe(true);
    expect(notReadLine(norm.ignored)).toBe("Not read: vendor_score.");
    expect(notReadLine([])).toBeNull();
  });

  it("names a proposal with no name the way the draft preview does", () => {
    expect(sheet(fromProposedSeat({ payload: { aim: "x" } })).name).toBe(SHEET_WORDS.seatNeedsAName);
  });
});

describe("helpers moved here", () => {
  it("keeps daysUntil as the power map knew it, from one source", () => {
    expect(mapDaysUntil).toBe(daysUntil);
    expect(daysUntil(MARA_TERM, NOW)).toBe(41);
    expect(daysUntil("2026-09-30T12:00:00.000Z", NOW)).toBe(-1);
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil("not a date", NOW)).toBeNull();
  });

  it("keeps termWords' words for a term that reached its date", () => {
    const day = 86400000;
    const at = (d: number) => new Date(Date.now() + d * day + 3600000).toISOString();
    expect(termWords(new Date(Date.now() - 2 * day).toISOString())).toBe("ready to be re-chosen");
    expect(termWords(at(0))).toBe("term ends today");
    expect(termWords(at(1))).toBe("term ends in 1 day");
    expect(termWords(at(12))).toBe("term ends in 12 days");
    expect(termWords(at(90))).toMatch(/^term ends /);
    expect(termWords(null)).toBeNull();
  });

  it("reads /api/season into the clock, and an unread or open-ended season into no clock", () => {
    const served = {
      current: { id: "s1", name: "Season of Foundations", endsOn: "2027-03-21", startsOn: "2026-09-21" },
      upcoming: null,
      daysLeft: 171,
      openEnded: false,
    };
    expect(seasonForSheet(served)).toEqual(SEASON);
    expect(sheet(fromMap(EMPTY_SEAT), { ...CTX, season: seasonForSheet(served) }).clock).toMatchObject({ key: "seasonDays", value: 171 });
    // Not landed, or failed: unread, so no clock and never a 0.
    expect(seasonForSheet(null)).toBeNull();
    expect(seasonForSheet(undefined)).toBeNull();
    expect(sheet(fromMap(EMPTY_SEAT), { ...CTX, season: seasonForSheet(null) }).clock).toBeNull();
    // Open-ended: the route sends no days left.
    const open = seasonForSheet({ ...served, daysLeft: null, openEnded: true });
    expect(open).toEqual({ ...SEASON, daysLeft: null });
    expect(sheet(fromMap(EMPTY_SEAT), { ...CTX, season: open }).clock).toBeNull();
    // No current season at all.
    expect(sheet(fromMap(EMPTY_SEAT), { ...CTX, season: seasonForSheet({ current: null, daysLeft: null }) }).clock).toBeNull();
  });

  it("formats a civil date as the day it names", () => {
    expect(formatDay("2027-03-21")).toBe("21 Mar 2027");
    expect(formatDay("2026-11-11T12:00:00.000Z", false)).toBe("11 Nov");
    expect(formatDay("nonsense")).toBeNull();
  });

  it("names no deficit in the files that now hold the succession words", () => {
    const files = ["shared/roleSheet.ts", "shared/roleSheetInputs.ts", "shared/roleSheetWords.ts", "shared/permissionSheet.ts"].map((f) =>
      fs.readFileSync(path.join(ROOT, f), "utf8"),
    );
    // Control: the reader reached the words it is meant to hold.
    expect(files[0]).toContain("ready to be re-chosen");
    for (const src of files) for (const word of ["overdue", "term ran out"]) expect(src.toLowerCase()).not.toContain(word);
  });
});
