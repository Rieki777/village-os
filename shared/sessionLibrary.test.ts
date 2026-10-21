/**
 * The agenda library's contract, without a database: who may see an item, who
 * may change it, what a session may take, how a body is read, and how the
 * page groups what waits. The same rules run against a real schema in
 * server/sessionLibrary.db.test.ts.
 */
import { describe, expect, it } from "vitest";
import { SESSION_COPY, SESSION_LIMITS, SESSION_REFUSALS } from "./sessions";
import {
  LIBRARY_COPY,
  LIBRARY_MINUTES,
  LIBRARY_NOTICES,
  LIBRARY_REFUSALS,
  LIBRARY_STATUSES,
  LIBRARY_STATUS_LINE,
  agendaAimFor,
  broughtFor,
  broughtIdFromHash,
  broughtLink,
  broughtRights,
  canSeeBrought,
  cleanBrought,
  cleanBroughtPatch,
  cleanIds,
  groupByCircle,
  mayTakeInto,
  offeredFor,
  planTakes,
  type LibraryCard,
  type LibrarySubject,
  type LibraryViewer,
} from "./sessionLibrary";

const viewer = (over: Partial<LibraryViewer> = {}): LibraryViewer => ({
  no: 7,
  admin: false,
  standing: new Set<string>(),
  hostsIn: new Set<string>(),
  ...over,
});

const item = (over: Partial<LibrarySubject> = {}): LibrarySubject => ({ circleId: "garden", broughtByNo: 3, status: "waiting", ...over });

const card = (over: Partial<LibraryCard>): LibraryCard => ({
  id: 1,
  title: "An item",
  aim: null,
  note: null,
  circleId: null,
  circleName: null,
  broughtBy: "Ana",
  mine: false,
  broughtAt: "2026-10-01T10:00:00.000Z",
  status: "waiting",
  session: null,
  settledAt: null,
  backAt: null,
  changedBy: null,
  canEdit: false,
  canMoveCircle: false,
  canWithdraw: false,
  canBringAgain: false,
  ...over,
});

describe("who may see an item", () => {
  it("lets the people with standing in its circle see it, and nobody else but its bringer and admins", () => {
    expect(canSeeBrought(item(), viewer({ standing: new Set(["garden"]) }))).toBe(true);
    expect(canSeeBrought(item(), viewer({ standing: new Set(["kitchen"]) }))).toBe(false);
    expect(canSeeBrought(item(), viewer())).toBe(false);
    expect(canSeeBrought(item(), viewer({ admin: true }))).toBe(true);
  });

  it("always shows the bringer their own, even in a circle they have no standing in", () => {
    expect(canSeeBrought(item({ broughtByNo: 7 }), viewer())).toBe(true);
  });

  it("shows an item for no circle in particular to every member", () => {
    expect(canSeeBrought(item({ circleId: null }), viewer({ no: null }))).toBe(true);
  });

  it("never treats a member with no number as the bringer of a departed member's item", () => {
    expect(canSeeBrought(item({ broughtByNo: 0 }), viewer({ no: 0 }))).toBe(false);
    expect(canSeeBrought(item({ broughtByNo: 0 }), viewer({ no: null }))).toBe(false);
  });
});

describe("who may change an item", () => {
  it("gives the bringer and admins every right", () => {
    for (const v of [viewer({ no: 3 }), viewer({ admin: true })]) {
      expect(broughtRights(item(), v)).toEqual({ words: true, circle: true, withdraw: true, bringAgain: true });
    }
  });

  it("lets a host with standing reword a circle's item, and never move its circle, withdraw it or bring it again", () => {
    expect(broughtRights(item(), viewer({ standing: new Set(["garden"]), hostsIn: new Set(["garden"]) }))).toEqual({
      words: true,
      circle: false,
      withdraw: false,
      bringAgain: false,
    });
  });

  it("gives a host of another circle nothing, and a member with standing who does not host nothing", () => {
    expect(broughtRights(item(), viewer({ hostsIn: new Set(["kitchen"]) })).words).toBe(false);
    expect(broughtRights(item(), viewer({ standing: new Set(["garden"]) })).words).toBe(false);
  });

  it("gives nobody but the bringer and admins the words of an item for no circle", () => {
    // Any member can open a room with no circle, so hosting one says nothing.
    const host = viewer({ hostsIn: new Set(["garden", "kitchen"]) });
    expect(broughtRights(item({ circleId: null }), host)).toEqual({ words: false, circle: false, withdraw: false, bringAgain: false });
  });
});

describe("what a session may take", () => {
  const ana = viewer({ standing: new Set(["garden"]) });

  it("takes a waiting item it may see, of its own circle or of none", () => {
    expect(mayTakeInto(item(), ana, "garden")).toBe(true);
    expect(mayTakeInto(item({ circleId: null }), ana, "garden")).toBe(true);
    expect(mayTakeInto(item({ circleId: null }), ana, null)).toBe(true);
  });

  it("never takes another circle's item, a circle's item into a session for no circle, or one it may not see", () => {
    expect(mayTakeInto(item(), ana, "kitchen")).toBe(false);
    expect(mayTakeInto(item(), ana, null)).toBe(false);
    expect(mayTakeInto(item(), viewer(), "garden")).toBe(false);
  });

  it("never takes an item already on an agenda or taken up", () => {
    expect(mayTakeInto(item({ status: "on_agenda" }), ana, "garden")).toBe(false);
    expect(mayTakeInto(item({ status: "taken_up" }), ana, "garden")).toBe(false);
  });

  it("plans all or none, in the order asked, and passes over what this session already holds", () => {
    const rows = [
      { id: 4, ...item() },
      { id: 2, ...item({ circleId: null }) },
      { id: 9, ...item({ status: "on_agenda" }) },
    ];
    expect(planTakes([4, 2], rows, ana, "garden")).toEqual({ ok: true, take: [rows[0], rows[1]] });
    expect(planTakes([2, 4], rows, ana, "garden")).toEqual({ ok: true, take: [rows[1], rows[0]] });
    expect(planTakes([4, 9], rows, ana, "garden")).toEqual({ ok: false });
    expect(planTakes([4, 99], rows, ana, "garden")).toEqual({ ok: false });
    expect(planTakes([4, 9], rows, ana, "garden", new Set([9]))).toEqual({ ok: true, take: [rows[0]] });
    // A hidden item refuses the batch the same way a missing one does.
    expect(planTakes([4], rows, viewer(), "garden")).toEqual({ ok: false });
  });
});

describe("reading a body", () => {
  const circles = new Set(["garden", "kitchen"]);

  it("cleans a new item to one line and clips it, and reads no circle as null", () => {
    const out = cleanBrought({ title: "  Shed\nroof  ", aim: "decide", note: "  we need a vote  ", circleId: "" }, circles);
    expect(out).toEqual({ ok: true, value: { title: "Shed roof", aim: "decide", note: "we need a vote", circleId: null } });
    const long = cleanBrought({ title: "x".repeat(500), circleId: "garden" }, circles);
    expect(long.ok && long.value.title.length).toBe(SESSION_LIMITS.agendaTitle);
  });

  it("refuses an empty title, an aim the room does not have, and a circle the village does not have", () => {
    expect(cleanBrought({ title: "   " }, circles)).toEqual({ ok: false, status: 400, error: SESSION_REFUSALS.itemTitleNeeded });
    expect(cleanBrought({ title: "A", aim: "vote" }, circles)).toEqual({ ok: false, status: 400, error: SESSION_REFUSALS.aimNeeded });
    expect(cleanBrought({ title: "A", circleId: "moon" }, circles)).toEqual({ ok: false, status: 400, error: SESSION_REFUSALS.circleUnknown });
  });

  it("reads a change as only the keys it sends, and an empty note as a cleared one", () => {
    expect(cleanBroughtPatch({ title: "New" }, circles)).toEqual({ ok: true, value: { title: "New" } });
    expect(cleanBroughtPatch({ note: "" }, circles)).toEqual({ ok: true, value: { note: null } });
    expect(cleanBroughtPatch({ aim: null, circleId: null }, circles)).toEqual({ ok: true, value: { aim: null, circleId: null } });
  });

  it("reads ids once each in the order sent, and refuses anything else or more than an agenda holds", () => {
    expect(cleanIds([3, 1, 3])).toEqual([3, 1]);
    expect(cleanIds([])).toEqual([]);
    expect(cleanIds([1, "2"])).toBeNull();
    expect(cleanIds([1.5])).toBeNull();
    expect(cleanIds("1")).toBeNull();
    expect(cleanIds(Array.from({ length: SESSION_LIMITS.maxAgenda + 1 }, (_, i) => i + 1))).toBeNull();
  });
});

describe("the page's grouping", () => {
  const items = [
    card({ id: 1, circleId: null, broughtAt: "2026-10-03T00:00:00.000Z" }),
    card({ id: 2, circleId: "kitchen", circleName: "Kitchen", broughtAt: "2026-10-02T00:00:00.000Z" }),
    card({ id: 3, circleId: "garden", circleName: "Garden circle", broughtAt: "2026-10-05T00:00:00.000Z" }),
    card({ id: 4, circleId: "garden", circleName: "Garden circle", broughtAt: "2026-10-01T00:00:00.000Z" }),
    card({ id: 5, circleId: "bees", circleName: "Bees", broughtAt: "2026-10-01T00:00:00.000Z" }),
  ];

  it("puts the viewer's own circles first, then the rest by name, then no circle, each oldest first", () => {
    const groups = groupByCircle(items, ["kitchen"]);
    expect(groups.map((g) => g.heading)).toEqual(["Kitchen circle", "Bees circle", "Garden circle", SESSION_COPY.noCircle]);
    expect(groups[2].items.map((i) => i.id)).toEqual([4, 3]);
  });

  it("offers the start card its circle's waiting items, then those for no circle, and only those for a session with none", () => {
    const withTaken = [...items, card({ id: 6, circleId: "garden", status: "on_agenda" })];
    expect(offeredFor(withTaken, "garden").map((i) => i.id)).toEqual([4, 3, 1]);
    expect(offeredFor(withTaken, null).map((i) => i.id)).toEqual([1]);
  });
});

describe("the words", () => {
  it("never says library to a member", () => {
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") strings.push(v);
      else if (typeof v === "function") strings.push(String((v as (...a: unknown[]) => unknown)("Garden", "1 October")));
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(LIBRARY_COPY);
    walk(LIBRARY_REFUSALS);
    walk(LIBRARY_NOTICES);
    for (const s of strings) expect(s.toLowerCase(), s).not.toContain("library");
  });

  it("has a status line for every status, and names a closed session only when the viewer may read it", () => {
    for (const s of LIBRARY_STATUSES) expect(typeof LIBRARY_STATUS_LINE[s]).toBe("function");
    expect(LIBRARY_STATUS_LINE.taken_up({ title: "Garden call", date: "3 October" })).toBe("Taken up in Garden call on 3 October");
    expect(LIBRARY_STATUS_LINE.taken_up({ title: null, date: "3 October" })).toBe("Taken up on 3 October");
    expect(LIBRARY_STATUS_LINE.on_agenda({ title: "Garden call", date: null })).toBe("On the agenda of Garden call");
    expect(LIBRARY_STATUS_LINE.waiting({ title: null, date: null })).toBeNull();
  });

  it("heads each list by the circle in the room's own words", () => {
    expect(broughtFor("Garden")).toBe("Brought for the Garden circle");
    expect(broughtFor("Garden circle")).toBe("Brought for the Garden circle");
    expect(broughtFor(null)).toBe("Brought for any circle");
    expect(LIBRARY_COPY.startWith(1)).toBe("Open the room with 1 item");
    expect(LIBRARY_COPY.startWith(3)).toBe("Open the room with 3 items");
  });

  it("gives every aim its usual minutes, and a member who was not sure the room's own default", () => {
    expect(agendaAimFor(null)).toBe("explore");
    expect(LIBRARY_MINUTES).toEqual({ report: 5, explore: 10, decide: 15 });
  });

  it("links every notice to the item's own card, and reads the card back from the hash", () => {
    expect(broughtLink(12)).toBe("/sessions#brought-12");
    expect(broughtIdFromHash("#brought-12")).toBe(12);
    expect(broughtIdFromHash("brought-12")).toBe(12);
    expect(broughtIdFromHash("#task-12")).toBeNull();
    expect(broughtIdFromHash("#brought-0")).toBeNull();
  });
});
