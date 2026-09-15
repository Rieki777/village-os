/**
 * A proposed seat, read from the shape a vendor actually sends.
 *
 * THE DEFECT THIS GUARDS. The accept path copied an allowlist of canonical key
 * names out of each proposed seat and dropped the rest in silence. A real first
 * batch of nineteen role records spelled the name `role_name`, the holder count
 * `seat_count`, gave the circle as a NAME under `circle`, and sent the
 * accountabilities as one "; "-separated string. All nineteen previewed as "A
 * seat needs a name", and a seat that did carry a name would have published
 * into no circle.
 *
 * The three REAL_ records below are copied from that batch with the seat,
 * circle and person names replaced. Their key sets and value shapes are
 * untouched, which is the part under test.
 *
 * Pure: no database, no server.
 */
import { describe, expect, it } from "vitest";
import {
  circlesNamed,
  normaliseAccountabilities,
  normaliseProposedSeat,
  readProposedSeats,
  type LiveCircle,
} from "./proposedSeats";

const CIRCLES: LiveCircle[] = [
  { id: "coordination", name: "Coordination & Records", aliases: ["Records"], isExample: false },
  { id: "trade", name: "Money & Trade", aliases: [], isExample: false },
  { id: "stewards", name: "Stewards", aliases: ["Stewardship Circle"], isExample: false },
  { id: "hearth-a", name: "Hearth", aliases: [], isExample: false },
  { id: "hearth-b", name: "Kitchen", aliases: ["hearth"], isExample: false },
  // Standing examples. Each would match a name below if examples counted.
  { id: "demo-soil", name: "Soil & Water", aliases: [], isExample: true },
  { id: "demo-trade", name: "Money & Trade", aliases: [], isExample: 1 },
];

const REAL_ONE = {
  role_name: "Record Steward",
  aim: "Review incoming cues and decisions in the shared memory system, assign owners to tasks, and keep a weekly review of the decision queue.",
  domain: "Decision queue management, task assignment oversight, shared memory maintenance, routing of governance items.",
  accountabilities:
    "Weekly review of pending decisions and tasks; assignment of ownership; routing to appropriate roles or profiles; verification of machine-generated task assignments before implementation; maintenance of decision queue status.",
  circle: "Coordination & Records",
  seat_count: 1,
  recruiting: false,
};

const REAL_TWO = {
  role_name: "Lot Sales Steward",
  aim: "Turn the six outer lots into closed sales.",
  domain: null,
  accountabilities:
    "Own the buyer pipeline end to end: every lead in the tracker, every conversation logged. Coordinate the outside agents. Drive one lot to the first closing.",
  circle: "Money & Trade",
  seat_count: 1,
  recruiting: true,
};

const REAL_THREE = {
  role_name: "Vision Keeper",
  aim: "Hold and articulate the founding vision, and keep decisions aligned with it.",
  domain: "Vision articulation, mission alignment, strategic guidance, community values",
  accountabilities:
    "Ensure decisions align with the 'village first, development second' philosophy; advocate for mission protection within the circle; represent long-term community and land interests",
  circle: "Stewardship Circle",
  seat_count: 1,
  recruiting: false,
};

describe("a vendor's real role record", () => {
  it("reads role_name, seat_count, a circle name and a string of accountabilities", () => {
    const r = normaliseProposedSeat(REAL_ONE, CIRCLES);
    expect(r.payload).toEqual({
      name: "Record Steward",
      aim: REAL_ONE.aim,
      domain: REAL_ONE.domain,
      recruiting: false,
      seats: 1,
      accountabilities: [
        "Weekly review of pending decisions and tasks",
        "assignment of ownership",
        "routing to appropriate roles or profiles",
        "verification of machine-generated task assignments before implementation",
        "maintenance of decision queue status",
      ],
      circleId: "coordination",
    });
    expect(r.ignored).toEqual([]);
    expect(r.circleProblem).toBeNull();
  });

  it("keeps a null domain, and splits a run of sentences with no ';' into its separate duties", () => {
    const r = normaliseProposedSeat(REAL_TWO, CIRCLES);
    expect(r.payload.name).toBe("Lot Sales Steward");
    expect(r.payload.domain).toBeNull();
    expect(r.payload.recruiting).toBe(true);
    // Three duties the vendor wrote as three sentences. This published as ONE
    // bullet holding the paragraph, and the rehearsal's "; " count called it right.
    expect(r.payload.accountabilities).toEqual([
      "Own the buyer pipeline end to end: every lead in the tracker, every conversation logged",
      "Coordinate the outside agents",
      "Drive one lot to the first closing",
    ]);
    // The example circle with the same name does not make this ambiguous.
    expect(r.payload.circleId).toBe("trade");
    expect(r.ignored).toEqual([]);
  });

  it("places a circle given by one of its aliases", () => {
    const r = normaliseProposedSeat(REAL_THREE, CIRCLES);
    expect(r.payload.circleId).toBe("stewards");
    expect(r.payload.accountabilities).toHaveLength(3);
    expect(r.payload).not.toHaveProperty("circleName");
  });
});

describe("aliases", () => {
  it("lets the canonical key win when both it and an alias carry a value", () => {
    const r = normaliseProposedSeat(
      {
        name: "Canonical",
        role_name: "Alias",
        roleName: "Other alias",
        seats: 2,
        seat_count: 9,
        seatCount: 8,
        whyItMatters: "canonical reason",
        why_it_matters: "alias reason",
        circleId: "trade",
        circle_id: "coordination",
      },
      CIRCLES,
    );
    expect(r.payload).toEqual({ name: "Canonical", seats: 2, whyItMatters: "canonical reason", circleId: "trade" });
    // Every alias was read, so none of them is reported.
    expect(r.ignored).toEqual([]);
  });

  it("tries the aliases in order, and a null canonical key yields to an alias with a value", () => {
    expect(normaliseProposedSeat({ role_name: "First", roleName: "Second" }, CIRCLES).payload.name).toBe("First");
    expect(normaliseProposedSeat({ roleName: "Camel" }, CIRCLES).payload.name).toBe("Camel");
    expect(normaliseProposedSeat({ name: null, role_name: "Filled" }, CIRCLES).payload.name).toBe("Filled");
    expect(normaliseProposedSeat({ seatCount: 3 }, CIRCLES).payload.seats).toBe(3);
    expect(normaliseProposedSeat({ why_it_matters: "because" }, CIRCLES).payload.whyItMatters).toBe("because");
  });

  it("lets an alias with a value beat a BLANK canonical key, which says nothing", () => {
    // A blank name blocked as nameless with role_name sitting beside it unreported.
    const a = normaliseProposedSeat({ name: "", role_name: "Mill Warden" }, CIRCLES);
    expect(a.payload.name).toBe("Mill Warden");
    expect(a.ignored).toEqual([]);
    // A blank circleId wrote circle_id = '' and published into no circle past every check.
    const b = normaliseProposedSeat({ name: "S", circleId: "", circle_id: "trade" }, CIRCLES);
    expect(b.payload.circleId).toBe("trade");
    expect(normaliseProposedSeat({ name: "S", circleId: "  ", circle_id: "trade" }, CIRCLES).payload.circleId).toBe("trade");
    // Blank alone is still carried, as the NULL a seat in no circle stores.
    expect(normaliseProposedSeat({ name: "S", circleId: "" }, CIRCLES).payload).toEqual({ name: "S", circleId: null });
  });

  it("lets an explicit circleId, or circle_id, beat any circle name", () => {
    const a = normaliseProposedSeat({ name: "A", circleId: "trade", circle: "Coordination & Records" }, CIRCLES);
    expect(a.payload.circleId).toBe("trade");
    expect(a.payload).not.toHaveProperty("circleName");
    const b = normaliseProposedSeat({ name: "B", circle_id: "trade", circle_name: "Nowhere" }, CIRCLES);
    expect(b.payload.circleId).toBe("trade");
    expect(b.payload).not.toHaveProperty("circleName");
    expect(b.circleProblem).toBeNull();
    expect(b.ignored).toEqual([]);
  });

  it("reads a circle id of 0 or false as none, so a circle name beside it is still placed", () => {
    // 0 used to win as an explicit id, swallow the name, skip the existence
    // check and publish into a circle called "0".
    const a = normaliseProposedSeat({ role_name: "Cook", circle_id: 0, circle: "Nowhere Circle" }, CIRCLES);
    expect(a.payload).not.toHaveProperty("circleId");
    expect(a.payload.circleName).toBe("Nowhere Circle");
    expect(a.circleProblem?.kind).toBe("unknown");
    const b = normaliseProposedSeat({ role_name: "Cook", circleId: false, circle: "Money & Trade" }, CIRCLES);
    expect(b.payload.circleId).toBe("trade");
    expect(normaliseProposedSeat({ name: "Cook", circle_id: 0 }, CIRCLES).payload).toEqual({ name: "Cook", circleId: null });
    // A real numeric id still counts.
    expect(normaliseProposedSeat({ name: "Cook", circleId: 7, circle: "Money & Trade" }, CIRCLES).payload.circleId).toBe(7);
  });
});

describe("a value of a shape the chart cannot hold is reported and left out", () => {
  it("reports an object or a list under a text field, which would publish as [object Object]", () => {
    const r = normaliseProposedSeat(
      { role_name: { en: "Cook" }, aim: { text: "Feed the village" }, domain: ["Water lines", "Pumps"], why_it_matters: true },
      CIRCLES,
    );
    expect(r.payload).toEqual({});
    expect(r.ignored).toEqual(["role_name", "aim", "domain", "why_it_matters"]);
    // A number is text enough, and is kept as text.
    expect(normaliseProposedSeat({ name: 7, aim: 3 }, CIRCLES).payload).toEqual({ name: "7", aim: "3" });
  });

  it("takes an alias of the right shape over a canonical key of the wrong one", () => {
    const r = normaliseProposedSeat({ name: { en: "Cook" }, role_name: "Cook" }, CIRCLES);
    expect(r.payload.name).toBe("Cook");
    expect(r.ignored).toEqual([]);
  });

  it("reads the spellings of recruiting senders use, and reports the rest", () => {
    for (const yes of [true, 1, "1", "true", "YES ", "yes"]) {
      expect(normaliseProposedSeat({ name: "S", recruiting: yes }, CIRCLES).payload.recruiting).toBe(true);
    }
    for (const no of [false, 0, "0", "false", "No"]) {
      expect(normaliseProposedSeat({ name: "S", recruiting: no }, CIRCLES).payload.recruiting).toBe(false);
    }
    expect(normaliseProposedSeat({ name: "S", recruiting: "" }, CIRCLES).payload.recruiting).toBeNull();
    const odd = normaliseProposedSeat({ name: "S", recruiting: "maybe" }, CIRCLES);
    expect(odd.payload).not.toHaveProperty("recruiting");
    expect(odd.ignored).toEqual(["recruiting"]);
  });

  it("reports an accountabilities list holding objects, which used to empty to [] and count as read", () => {
    expect(normaliseAccountabilities([{ text: "Run the mill" }, { text: "Keep the log" }])).toBeUndefined();
    expect(normaliseAccountabilities(["Run the mill", ["nested"]])).toBeUndefined();
    const r = normaliseProposedSeat({ name: "N", accountabilities: [{ text: "Run the mill" }] }, CIRCLES);
    expect(r.payload).not.toHaveProperty("accountabilities");
    expect(r.ignored).toEqual(["accountabilities"]);
  });
});

describe("a circle given in a shape nothing reads blocks the seat", () => {
  it("marks a circle sent as an object or a number", () => {
    const a = normaliseProposedSeat({ role_name: "Spring Keeper", circle: { id: "springs", name: "Springs" } }, CIRCLES);
    expect(a.payload).toEqual({ name: "Spring Keeper", circleUnread: ["circle"] });
    expect(a.ignored).toEqual(["circle"]);
    expect(a.circleProblem).toEqual({ kind: "unreadable", name: "circle", matches: [] });
    expect(normaliseProposedSeat({ name: "S", circle: 7 }, CIRCLES).payload.circleUnread).toEqual(["circle"]);
    expect(normaliseProposedSeat({ name: "S", circleId: { id: "trade" } }, CIRCLES).payload.circleUnread).toEqual(["circleId"]);
  });

  it("marks a circle under a key nothing reads, and only when no circle was placed", () => {
    for (const key of ["parent_circle", "circles", "circle_title"]) {
      const r = normaliseProposedSeat({ name: "S", [key]: "Money & Trade" }, CIRCLES);
      expect(r.payload.circleUnread, key).toEqual([key]);
      expect(r.ignored).toEqual([key]);
    }
    const placed = normaliseProposedSeat({ name: "S", circle: "Money & Trade", parent_circle: "x" }, CIRCLES);
    expect(placed.payload).toEqual({ name: "S", circleId: "trade" });
    expect(placed.ignored).toEqual(["parent_circle"]);
    // An explicit "no circle" does not outvote a circle given somewhere else.
    expect(normaliseProposedSeat({ name: "S", circleId: null, parent_circle: "x" }, CIRCLES).payload.circleUnread).toEqual([
      "parent_circle",
    ]);
  });

  it("keeps the mark on a second pass, and drops it once the steward names a circle", () => {
    const once = normaliseProposedSeat({ name: "S", parent_circle: "Money & Trade" }, CIRCLES);
    const twice = normaliseProposedSeat(once.payload, CIRCLES);
    expect(twice.payload).toEqual(once.payload);
    expect(twice.ignored).toEqual([]);
    const fixed = normaliseProposedSeat({ ...once.payload, circle: "Money & Trade" }, CIRCLES);
    expect(fixed.payload).toEqual({ name: "S", circleId: "trade" });
  });

  it("never blocks on a flag, a number or a list under a circle-like key, or on the platform's own circle fields", () => {
    // Each of these blocked the whole draft with "write the circle's name under
    // circle", which is the wrong recovery for a seat that belongs to no circle.
    for (const extra of [
      { representsCircle: false },
      { representsCircle: true },
      { represents_circle: "yes" },
      { parentCircleId: "trade" },
      { hasCircle: false },
      { circle_count: 3 },
      { circles: ["Money & Trade", "Stewards"] },
    ] as Record<string, unknown>[]) {
      const key = Object.keys(extra)[0];
      const r = normaliseProposedSeat({ name: "Night Watch", ...extra }, CIRCLES);
      expect(r.payload, key).toEqual({ name: "Night Watch" });
      expect(r.circleProblem, key).toBeNull();
      // Still named as not read, so nothing vanishes in silence.
      expect(r.ignored, key).toEqual([key]);
    }
    // `circle: false` is a seat in no circle: reported, never blocked.
    const none = normaliseProposedSeat({ name: "Night Watch", circle: false }, CIRCLES);
    expect(none.payload).toEqual({ name: "Night Watch" });
    expect(none.ignored).toEqual(["circle"]);
    // A structure's list of circles beside its seats belongs to no one seat.
    const s = readProposedSeats({ circles: ["Money & Trade"], seats: [{ name: "A" }] }, CIRCLES);
    expect(s.seats[0].payload).toEqual({ name: "A" });
    expect(s.ignored).toEqual(["circles"]);
  });

  it("marks every seat of a structure that gave its circle once, beside the list", () => {
    const r = readProposedSeats(
      { title: "Structure", circle: "Money & Trade", seats: [{ name: "A" }, { name: "B", circle: "Stewards" }] },
      CIRCLES,
      { readsTitle: true },
    );
    expect(r.seats[0].payload).toEqual({ name: "A", circleUnread: ["circle"] });
    expect(r.seats[1].payload).toEqual({ name: "B", circleId: "stewards" });
    expect(r.ignored).toEqual(["circle"]);
  });
});

describe("accountabilities", () => {
  it("splits a string on semicolons and newlines, trims, drops one trailing period and empties", () => {
    expect(normaliseAccountabilities("a; b.\nc\r\n; ;  d.. ")).toEqual(["a", "b", "c", "d."]);
    expect(normaliseAccountabilities("")).toEqual([]);
  });

  it("passes an array through with items trimmed and empties dropped", () => {
    expect(normaliseAccountabilities(["  x ", "", "y.", null, 3])).toEqual(["x", "y.", "3"]);
  });

  it("drops leading list markers, from a numbered string and from list items, and nothing a second pass would change", () => {
    // A numbered list published as "1. Show up..." under a bulleted heading,
    // and went stale (1, 2, 4, 5) the first time an admin removed an item.
    const numbered =
      "1. Show up for co-working sessions twice a week.\n2. Serve as a second pair of eyes on filings.\n" +
      "3) Keep the tracker current\n- Flag a blocker the day it appears\n* Bring what you learned to the circle.";
    const once = normaliseAccountabilities(numbered);
    expect(once).toEqual([
      "Show up for co-working sessions twice a week",
      "Serve as a second pair of eyes on filings",
      "Keep the tracker current",
      "Flag a blocker the day it appears",
      "Bring what you learned to the circle",
    ]);
    expect(normaliseAccountabilities(once)).toEqual(once);
    expect(normaliseAccountabilities(["1. Run the mill", "2) Keep the log", "• Sweep the floor", "- - Oil the gears"])).toEqual([
      "Run the mill",
      "Keep the log",
      "Sweep the floor",
      "Oil the gears",
    ]);
    // A duty that starts with a number has no marker to lose.
    expect(normaliseAccountabilities("5 business days to answer a buyer; 3 visits a season")).toEqual([
      "5 business days to answer a buyer",
      "3 visits a season",
    ]);
  });

  it("splits a string with no ';' or newline at sentence ends, and not after an initial, a title or a small number", () => {
    expect(
      normaliseAccountabilities(
        "Track every parcel's title status. Keep the segregation plan current. Book the surveyor. " +
          "Assemble the closing binder. Chase the county for the recorded plat.",
      ),
    ).toEqual([
      "Track every parcel's title status",
      "Keep the segregation plan current",
      "Book the surveyor",
      "Assemble the closing binder",
      "Chase the county for the recorded plat",
    ]);
    expect(normaliseAccountabilities("Brief J. Ames and Dr. Okafor weekly. Report to the U.S. Forest office by May 5. Then close the file")).toEqual([
      "Brief J. Ames and Dr. Okafor weekly",
      "Report to the U.S. Forest office by May 5. Then close the file",
    ]);
    // Inside a ";" list, a duty written as two sentences stays one duty.
    expect(normaliseAccountabilities("Keep the books. Receipts included; File the returns")).toEqual([
      "Keep the books. Receipts included",
      "File the returns",
    ]);
  });

  it("never cuts a name off its duty after a title the split has never heard of", () => {
    // The first split refused only a short list of English titles, so every
    // other honorific cut the duty in two: "with Lic" and "Mora".
    expect(normaliseAccountabilities("Coordinate the outside agents with Lic. Mora. Get the reservation agreement signed.")).toEqual([
      "Coordinate the outside agents with Lic. Mora. Get the reservation agreement signed",
    ]);
    expect(normaliseAccountabilities("Book the notary (Licda. Mora handles Lot 5). Assemble the closing binder.")).toEqual([
      "Book the notary (Licda. Mora handles Lot 5). Assemble the closing binder",
    ]);
    expect(normaliseAccountabilities("Work with Ing. Solano on the water concession. Chase counsel.")).toEqual([
      "Work with Ing. Solano on the water concession",
      "Chase counsel",
    ]);
    for (const title of ["Sra.", "Dra.", "Arq.", "Prof.", "Rev.", "Capt.", "Fr.", "the Exec.", "the Asst.", "the Dept."]) {
      const duty = `Meet ${title} Vargas monthly`;
      expect(normaliseAccountabilities(`${duty}. File the minutes.`), title).toEqual([duty, "File the minutes"]);
    }
  });

  it("keeps a quoted motto whole, and a time, a weekday, a company and a volume inside their duty", () => {
    expect(normaliseAccountabilities("Uphold the motto 'Land first. People always.' in every decision. Train new members.")).toEqual([
      "Uphold the motto 'Land first. People always.' in every decision. Train new members",
    ]);
    expect(normaliseAccountabilities('Enforce the rule "No dogs. No fires." at camp. Report breaches.')).toEqual([
      'Enforce the rule "No dogs. No fires." at camp. Report breaches',
    ]);
    expect(normaliseAccountabilities("Open the gate at 7 a.m. Monday to Friday. Lock it at dusk.")).toEqual([
      "Open the gate at 7 a.m. Monday to Friday. Lock it at dusk",
    ]);
    expect(normaliseAccountabilities("Water the beds Mon. Wed. and Fri. mornings. Weed on weekends.")).toEqual([
      "Water the beds Mon. Wed. and Fri. mornings",
      "Weed on weekends",
    ]);
    expect(normaliseAccountabilities("Pay invoices to Acme Co. Ltd. within 30 days. Reconcile monthly.")).toEqual([
      "Pay invoices to Acme Co. Ltd. within 30 days",
      "Reconcile monthly",
    ]);
    expect(normaliseAccountabilities("Keep Vol. II of the ledger current. Archive Vol. I.")).toEqual([
      "Keep Vol. II of the ledger current",
      "Archive Vol. I",
    ]);
  });

  it("keeps the first number on a numbered list that lost its line breaks, and splits a run that ends in a newline", () => {
    const inline = normaliseAccountabilities("1. Maintain the site. 2. Update it. 3. Report.");
    expect(inline).toEqual(["1. Maintain the site. 2. Update it. 3. Report"]);
    expect(normaliseAccountabilities(inline)).toEqual(inline);
    for (const end of ["\n", "\r\n", " \n "]) {
      expect(normaliseAccountabilities(`Send the one-pager. Track the replies. Book the call.${end}`), JSON.stringify(end)).toEqual([
        "Send the one-pager",
        "Track the replies",
        "Book the call",
      ]);
    }
  });

  it("carries null, and reports a value it cannot use instead of losing it at publish", () => {
    expect(normaliseAccountabilities(null)).toBeNull();
    const r = normaliseProposedSeat({ name: "N", accountabilities: 42 }, CIRCLES);
    expect(r.payload).not.toHaveProperty("accountabilities");
    expect(r.ignored).toEqual(["accountabilities"]);
  });
});

describe("idempotence, because a reopened proposal comes through again", () => {
  it("returns an already-canonical payload unchanged", () => {
    for (const record of [REAL_ONE, REAL_TWO, REAL_THREE]) {
      const once = normaliseProposedSeat(record, CIRCLES);
      const twice = normaliseProposedSeat(once.payload, CIRCLES);
      expect(twice.payload).toEqual(once.payload);
      expect(twice.ignored).toEqual([]);
    }
  });

  it("keeps an unplaced circle name stable, and places it once the circle exists", () => {
    const once = normaliseProposedSeat({ role_name: "Mill Warden", circle: "Milling Circle" }, CIRCLES);
    expect(once.payload).toEqual({ name: "Mill Warden", circleName: "Milling Circle", circleMatches: 0 });
    const twice = normaliseProposedSeat(once.payload, CIRCLES);
    expect(twice.payload).toEqual(once.payload);
    expect(twice.ignored).toEqual([]);

    const later = normaliseProposedSeat(once.payload, [...CIRCLES, { id: "milling", name: "Milling Circle" }]);
    expect(later.payload).toEqual({ name: "Mill Warden", circleId: "milling" });
    expect(later.circleProblem).toBeNull();
  });
});

describe("placing a circle by name", () => {
  it("matches case-insensitively and trimmed, on the name or any alias", () => {
    expect(circlesNamed("  coordination & RECORDS ", CIRCLES)).toEqual(["coordination"]);
    expect(circlesNamed("records", CIRCLES)).toEqual(["coordination"]);
    expect(normaliseProposedSeat({ name: "S", circle_name: "RECORDS" }, CIRCLES).payload.circleId).toBe("coordination");
  });

  it("leaves no circleId when the name matches nothing, and carries the name as sent", () => {
    const r = normaliseProposedSeat({ name: "S", circle: "Nowhere Circle" }, CIRCLES);
    expect(r.payload).not.toHaveProperty("circleId");
    expect(r.payload.circleName).toBe("Nowhere Circle");
    expect(r.payload.circleMatches).toBe(0);
    expect(r.circleProblem).toEqual({ kind: "unknown", name: "Nowhere Circle", matches: [] });
  });

  it("leaves no circleId when the name matches more than one circle", () => {
    // One circle is named Hearth; another carries it as an alias.
    const r = normaliseProposedSeat({ name: "Cook", circle: "Hearth" }, CIRCLES);
    expect(r.payload).not.toHaveProperty("circleId");
    expect(r.payload.circleName).toBe("Hearth");
    expect(r.payload.circleMatches).toBe(2);
    expect(r.circleProblem).toEqual({ kind: "ambiguous", name: "Hearth", matches: ["hearth-a", "hearth-b"] });
  });

  it("never matches a standing example circle", () => {
    expect(circlesNamed("Soil & Water", CIRCLES)).toEqual([]);
    const r = normaliseProposedSeat({ name: "S", circle: "Soil & Water" }, CIRCLES);
    expect(r.circleProblem?.kind).toBe("unknown");
    expect(r.payload).not.toHaveProperty("circleId");
  });
});

describe("keys nothing reads", () => {
  const RECORD = {
    id: "vendor-seat-7",
    title: "t",
    rationale: "r",
    role_name: "Seat",
    vendor_rank: 3,
    holder: "somebody",
    circle: "Money & Trade",
    circleMatches: 5,
  };

  it("reports every one, and never reports id or a key the caller says it reads", () => {
    const r = normaliseProposedSeat(RECORD, CIRCLES, { readByCaller: ["title", "rationale"] });
    expect(r.ignored).toEqual(["vendor_rank", "holder"]);
    expect(r.vendorId).toBe("vendor-seat-7");
    expect(r.payload).toEqual({ name: "Seat", circleId: "trade" });
  });

  it("reports title and rationale when the caller does not read them", () => {
    // The accept path reads a title off the first proposal only and a rationale
    // only when a decision holds one proposal. The other eighteen of nineteen
    // rationales used to vanish with ignored: [].
    expect(normaliseProposedSeat(RECORD, CIRCLES).ignored).toEqual(["title", "rationale", "vendor_rank", "holder"]);
    expect(readProposedSeats(RECORD, CIRCLES, { readsTitle: true }).ignored).toEqual(["rationale", "vendor_rank", "holder"]);
    expect(readProposedSeats(RECORD, CIRCLES, { readsTitle: true, readsRationale: true }).ignored).toEqual([
      "vendor_rank",
      "holder",
    ]);
  });

  it("reports a title on a seat INSIDE a structure's list, which no draft reads", () => {
    const r = readProposedSeats(
      { title: "Structure", seats: [{ title: "Mill Warden", circle: "Money & Trade" }] },
      CIRCLES,
      { readsTitle: true, readsRationale: true },
    );
    expect(r.seats[0].payload).toEqual({ circleId: "trade" });
    expect(r.ignored).toEqual(["title"]);
  });

  it("reports a circle key whose value is not a name", () => {
    const r = normaliseProposedSeat({ name: "Seat", circle: { id: "trade" } }, CIRCLES);
    expect(r.ignored).toEqual(["circle"]);
    expect(r.payload).toEqual({ name: "Seat", circleUnread: ["circle"] });
  });

  it("reads a whole structure's seat list and reports keys beside it and inside it", () => {
    const structure = {
      title: "The structure",
      rationale: "Because",
      source_meeting: "m-1",
      seats: [{ id: "a", name: "A", circleId: "trade" }, { id: "b", roleName: "B", notes: "x" }, "not a seat"],
    };
    const r = readProposedSeats(structure, CIRCLES, { readsTitle: true, readsRationale: true });
    expect(r.seats.map((s) => s.payload.name)).toEqual(["A", "B"]);
    expect(r.ignored).toEqual(["source_meeting", "notes"]);
    // The second structure in a decision gives the draft neither.
    expect(readProposedSeats(structure, CIRCLES).ignored).toEqual(["title", "rationale", "source_meeting", "notes"]);

    const one = readProposedSeats(REAL_ONE, CIRCLES);
    expect(one.seats).toHaveLength(1);
    expect(one.ignored).toEqual([]);
  });
});
