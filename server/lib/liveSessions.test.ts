/**
 * Live Sessions: the rules that need no database. Who may do what in a room,
 * what a close works out before it writes, what carries over from the last
 * session of a circle, the room's ETag, the season a stamp names, the bodies
 * the doors read, and the two dials and two notices this module registers.
 *
 * The rows, the transactions and the privacy line on the wire are proved
 * against a real schema in server/liveSessions.db.test.ts.
 */
import { describe, expect, it } from "vitest";
import { VARIABLES_BY_KEY, ringOf, validateVariable } from "../../shared/gameVariables";
import { NOTIFICATION_KINDS } from "../../shared/notificationKinds";
import {
  HERE_EVERY_MS,
  PRESENT_WINDOW_MS,
  SESSION_LIMITS,
  SESSION_NOTICES,
  SESSION_REFUSALS,
  SESSION_SEASONS,
  cleanLine,
  type SessionEntry,
  type SessionItem,
} from "../../shared/sessions";
import {
  cleanStart,
  closePlan,
  defaultDuration,
  entryRights,
  etagMatches,
  isStaleRoom,
  mapSession,
  mayBeStale,
  mayEditItemWords,
  maySee,
  parseId,
  placeLine,
  readStamp,
  rolesIn,
  seasonAt,
  selectCarried,
  sessionEtag,
  staleAfterMs,
} from "./liveSessions";
import { emailCadenceFor, resolveNotifyPrefs } from "./notify";

const T0 = 1_900_000_000_000;
/** The en and em dashes, built from code points so neither lands in this file. */
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const room = { facilitatorNo: 3, secretaryNo: 7 };

describe("who may do what in a room", () => {
  it("knows the facilitator, the secretary and an admin, and nobody else", () => {
    expect(rolesIn(room, { no: 3, admin: false })).toEqual({ facilitates: true, secretary: false, admin: false, runs: true, notes: true });
    expect(rolesIn(room, { no: 7, admin: false })).toEqual({ facilitates: false, secretary: true, admin: false, runs: false, notes: true });
    expect(rolesIn(room, { no: 9, admin: true })).toEqual({ facilitates: false, secretary: false, admin: true, runs: true, notes: true });
    expect(rolesIn(room, { no: 9, admin: false })).toEqual({ facilitates: false, secretary: false, admin: false, runs: false, notes: false });
    expect(rolesIn(room, { no: null, admin: false }).runs).toBe(false);
  });

  it("never lets the departed number 0 stand in for a facilitator who left", () => {
    expect(rolesIn({ facilitatorNo: 0, secretaryNo: null }, { no: 0, admin: false }).facilitates).toBe(false);
  });

  it("lets an author change their own entry, and only the room's hosts change anybody's", () => {
    const entry = { authorNo: 5, ownerNo: null };
    const member = rolesIn(room, { no: 5, admin: false });
    const other = rolesIn(room, { no: 6, admin: false });
    const secretary = rolesIn(room, { no: 7, admin: false });
    expect(entryRights(entry, 5, member)).toMatchObject({ text: true, seat: true, status: true, remove: true, release: false });
    expect(entryRights(entry, 6, other)).toMatchObject({ text: false, seat: false, dueOn: false, status: false, remove: false, release: false });
    expect(entryRights(entry, 7, secretary)).toMatchObject({ text: true, seat: true, status: true, remove: true, release: false });
  });

  it("lets anyone claim, and only the holder or the facilitator let an action go", () => {
    const held = { authorNo: 5, ownerNo: 6 };
    expect(entryRights(held, 8, rolesIn(room, { no: 8, admin: false })).claim).toBe(true);
    expect(entryRights(held, 8, rolesIn(room, { no: 8, admin: false })).release).toBe(false);
    expect(entryRights(held, 6, rolesIn(room, { no: 6, admin: false }))).toMatchObject({ release: true, dueOn: true, text: false });
    expect(entryRights(held, 3, rolesIn(room, { no: 3, admin: false })).release).toBe(true);
    // The secretary takes notes; letting go of somebody's action is the facilitator's.
    expect(entryRights(held, 7, rolesIn(room, { no: 7, admin: false })).release).toBe(false);
  });

  it("lets whoever added an item reword it while it waits, and the hosts at any time", () => {
    const waiting = { addedBy: 5, status: "waiting" as const };
    const active = { addedBy: 5, status: "active" as const };
    expect(mayEditItemWords(waiting, 5, rolesIn(room, { no: 5, admin: false }))).toBe(true);
    expect(mayEditItemWords(active, 5, rolesIn(room, { no: 5, admin: false }))).toBe(false);
    expect(mayEditItemWords(waiting, 6, rolesIn(room, { no: 6, admin: false }))).toBe(false);
    expect(mayEditItemWords(active, 7, rolesIn(room, { no: 7, admin: false }))).toBe(true);
  });

  it("shows an open session to any member, and a closed one to its people and admins", () => {
    expect(maySee({ status: "open" }, false, false)).toBe(true);
    expect(maySee({ status: "closed" }, false, false)).toBe(false);
    expect(maySee({ status: "closed" }, true, false)).toBe(true);
    expect(maySee({ status: "closed" }, false, true)).toBe(true);
  });
});

describe("what a close works out before it writes", () => {
  const here = { lastSeenMs: T0 - 1000 };
  const gone = { lastSeenMs: T0 - PRESENT_WINDOW_MS - 1 };

  it("refuses on an action nobody holds, and counts a seat as holding one", () => {
    const plan = closePlan(
      [
        { id: 1, kind: "action", status: "open", ownerNo: null, ownerSeatId: null },
        { id: 2, kind: "action", status: "open", ownerNo: 4, ownerSeatId: null },
        { id: 3, kind: "action", status: "open", ownerNo: null, ownerSeatId: "seat-water" },
        { id: 4, kind: "action", status: "parked", ownerNo: null, ownerSeatId: null },
        { id: 5, kind: "note", status: "open", ownerNo: null, ownerSeatId: null },
      ],
      [],
      [],
      T0,
    );
    expect(plan.unowned).toEqual([1]);
  });

  it("keeps the arrival round as numbers only", () => {
    const plan = closePlan(
      [],
      [
        { no: 1, arrival: 3, ...here },
        { no: 2, arrival: 9, ...here },
        { no: 3, arrival: 7, ...gone },
        { no: 4, arrival: null, ...here },
      ],
      [],
      T0,
    );
    expect(plan.arrival).toEqual({ count: 3, median: 7, low: 3, high: 9 });
  });

  it("counts each proposal's consent round over the people present at the close", () => {
    const entries = [
      { id: 10, kind: "decision" as const, status: "open" as const, ownerNo: null, ownerSeatId: null },
      { id: 11, kind: "decision" as const, status: "done" as const, ownerNo: null, ownerSeatId: null },
    ];
    const people = [
      { no: 1, arrival: null, ...here },
      { no: 2, arrival: null, ...here },
      { no: 3, arrival: null, ...gone },
    ];
    const responses = [
      { no: 1, target: "decision:10", value: "consent" },
      { no: 2, target: "decision:10", value: "object" },
      { no: 1, target: "decision:11", value: "consent" },
      { no: 2, target: "decision:11", value: "concern" },
      { no: 1, target: "agenda", value: "consent" },
      { no: 3, target: "decision:11", value: "not a consent value" },
    ];
    const plan = closePlan(entries, people, responses, T0);
    expect(plan.present).toBe(2);
    expect(plan.tallies[10]).toEqual({ consent: 1, concern: 0, object: 1, waiting: 0, consented: false });
    expect(plan.tallies[11]).toEqual({ consent: 1, concern: 1, object: 0, waiting: 0, consented: true });
    expect(Object.keys(plan.tallies)).toEqual(["10", "11"]);
  });

  it("never lets a consent from somebody who left stand in for somebody here who has not answered", () => {
    const entries = [{ id: 12, kind: "decision" as const, status: "open" as const, ownerNo: null, ownerSeatId: null }];
    const people = [
      { no: 1, arrival: null, ...here },
      { no: 2, arrival: null, ...here },
      { no: 3, arrival: null, ...gone },
    ];
    // Two answers against two people here, the old arithmetic's "everyone": but
    // one of the two answers is from somebody who has gone, and 2 is unheard.
    const responses = [
      { no: 1, target: "decision:12", value: "consent" },
      { no: 3, target: "decision:12", value: "consent" },
    ];
    const plan = closePlan(entries, people, responses, T0);
    expect(plan.tallies[12]).toEqual({ consent: 2, concern: 0, object: 0, waiting: 1, consented: false });
    // Once 2 answers, the round has heard everyone here.
    const heard = closePlan(entries, people, [...responses, { no: 2, target: "decision:12", value: "concern" }], T0);
    expect(heard.tallies[12]).toMatchObject({ waiting: 0, consented: true });
  });
});

describe("a room nobody closes", () => {
  const HOUR = 60 * 60 * 1000;
  const aged = (hoursOld: number, durationMin = 60) => ({ status: "open" as const, createdAt: new Date(T0 - hoursOld * HOUR).toISOString(), durationMin });

  it("waits its length plus two hours, and never less than six", () => {
    expect(staleAfterMs(60)).toBe(6 * HOUR);
    expect(staleAfterMs(240)).toBe(6 * HOUR);
    expect(staleAfterMs(300)).toBe(7 * HOUR);
    expect(staleAfterMs(480)).toBe(10 * HOUR);
  });

  it("closes only a room old enough and empty for that long", () => {
    // Seven hours old, nobody seen for seven: quiet for good.
    expect(isStaleRoom(aged(7), T0 - 7 * HOUR, T0)).toBe(true);
    expect(isStaleRoom(aged(7), null, T0)).toBe(true);
    // Somebody was here an hour ago.
    expect(isStaleRoom(aged(7), T0 - HOUR, T0)).toBe(false);
    // Five hours old: younger than the floor, whoever left.
    expect(isStaleRoom(aged(5), T0 - 5 * HOUR, T0)).toBe(false);
    // An eight hour session gets ten hours.
    expect(isStaleRoom(aged(9, 480), T0 - 9 * HOUR, T0)).toBe(false);
    expect(isStaleRoom(aged(11, 480), T0 - 11 * HOUR, T0)).toBe(true);
    // A closed room is never closed again.
    expect(isStaleRoom({ ...aged(30), status: "closed" }, null, T0)).toBe(false);
  });

  it("reads a fresh room off its row, with no reason to look further", () => {
    expect(mayBeStale(aged(1), T0)).toBe(false);
    expect(mayBeStale(aged(7), T0)).toBe(true);
    expect(mayBeStale({ ...aged(7), status: "closed" }, T0)).toBe(false);
  });
});

describe("what carries over from the last session of a circle", () => {
  const entry = (id: number, kind: SessionEntry["kind"], status: SessionEntry["status"]): SessionEntry => ({
    id,
    itemId: null,
    kind,
    text: `entry ${id}`,
    status,
    authorUserId: 1,
    ownerUserId: null,
    ownerName: null,
    ownerSeatId: null,
    ownerSeatName: null,
    dueOn: null,
    createdAt: "2026-10-01T00:00:00.000Z",
  });
  const item = (id: number, title: string, status: SessionItem["status"], fromSessionId: number | null = null): SessionItem => ({
    id,
    title,
    aim: "explore",
    minutes: 15,
    position: id,
    status,
    presenterUserId: null,
    addedBy: 1,
    startedAt: null,
    endedAt: null,
    usedSeconds: 0,
    fromSessionId,
  });

  it("brings its open actions, its backlog and the items it parked or never reached", () => {
    const picked = selectCarried(
      {
        entries: [
          entry(1, "action", "open"),
          entry(2, "action", "done"),
          entry(3, "action", "parked"),
          entry(4, "tension", "open"),
          entry(5, "tension", "done"),
          entry(6, "idea", "parked"),
          entry(7, "note", "open"),
        ],
        items: [item(1, "Water rota", "done"), item(2, "Seed library", "parked"), item(3, "Fence line", "waiting"), item(4, "Gate", "active")],
      },
      [],
      40,
    );
    expect(picked.actions.map((e) => e.id)).toEqual([1]);
    expect(picked.backlog.map((e) => e.id)).toEqual([3, 4, 6]);
    expect(picked.parkedItems).toEqual([
      { title: "Seed library", aim: "explore", minutes: 15 },
      { title: "Fence line", aim: "explore", minutes: 15 },
    ]);
  });

  it("does not offer an item twice once it has been brought over", () => {
    const picked = selectCarried({ entries: [], items: [item(2, "Seed library", "parked")] }, [item(9, "seed library", "waiting", 40)], 40);
    expect(picked.parkedItems).toEqual([]);
    // Brought over from some other session, it is still offered from this one.
    const other = selectCarried({ entries: [], items: [item(2, "Seed library", "parked")] }, [item(9, "Seed library", "waiting", 12)], 40);
    expect(other.parkedItems).toHaveLength(1);
  });

  it("does not offer a backlog entry twice once it has been brought over, matched by the title it became", () => {
    const long = { ...entry(4, "tension", "open"), text: `  Who   holds the shed keys? ${"and the gate ".repeat(12)}` };
    const asItem = (cleanLine(long.text, SESSION_LIMITS.agendaTitle) ?? "").toUpperCase();
    const prev = { entries: [long, entry(6, "idea", "parked")], items: [] };
    expect(selectCarried(prev, [], 40).backlog.map((e) => e.id)).toEqual([4, 6]);
    // The room cleaned and cut the text to an agenda title when it brought it over.
    expect(selectCarried(prev, [item(9, asItem, "waiting", 40)], 40).backlog.map((e) => e.id)).toEqual([6]);
    // A copy brought over from some other session leaves this one's entry on offer.
    expect(selectCarried(prev, [item(9, asItem, "waiting", 12)], 40).backlog.map((e) => e.id)).toEqual([4, 6]);
  });
});

describe("the room's ETag", () => {
  const s = { id: 12, version: 4, status: "open" as const };
  const viewer = { no: 3, admin: false };

  it("moves with the version, with the presence bucket and with the viewer", () => {
    const tag = sessionEtag(s, viewer, T0);
    expect(tag).toMatch(/^"ls-12-4-\d+-[0-9a-f]{10}"$/);
    expect(sessionEtag({ ...s, version: 5 }, viewer, T0)).not.toBe(tag);
    expect(sessionEtag(s, { no: 4, admin: false }, T0)).not.toBe(tag);
    expect(sessionEtag(s, { no: 3, admin: true }, T0)).not.toBe(tag);
    const bucketStart = Math.floor(T0 / HERE_EVERY_MS) * HERE_EVERY_MS;
    expect(sessionEtag(s, viewer, bucketStart + HERE_EVERY_MS - 1)).toBe(sessionEtag(s, viewer, bucketStart));
    expect(sessionEtag(s, viewer, bucketStart + HERE_EVERY_MS)).not.toBe(sessionEtag(s, viewer, bucketStart));
  });

  it("stops moving with presence once the session is closed", () => {
    const closed = { ...s, status: "closed" as const };
    expect(sessionEtag(closed, viewer, T0)).toBe(sessionEtag(closed, viewer, T0 + 10 * HERE_EVERY_MS));
  });

  it("matches the weak form, a list, and the wildcard, and nothing else", () => {
    const tag = sessionEtag(s, viewer, T0);
    expect(etagMatches(tag, tag)).toBe(true);
    expect(etagMatches(`W/${tag}`, tag)).toBe(true);
    expect(etagMatches(`"other", ${tag}`, tag)).toBe(true);
    expect(etagMatches("*", tag)).toBe(true);
    expect(etagMatches('"ls-12-3-1-abc"', tag)).toBe(false);
    expect(etagMatches(undefined, tag)).toBe(false);
  });
});

describe("the stamp", () => {
  it("names the season by hemisphere, turning the other way in the south", () => {
    expect(seasonAt(new Date("2026-04-15T12:00:00Z"), "north")).toBe("spring");
    expect(seasonAt(new Date("2026-07-15T12:00:00Z"), "north")).toBe("summer");
    expect(seasonAt(new Date("2026-10-15T12:00:00Z"), "north")).toBe("autumn");
    expect(seasonAt(new Date("2026-01-15T12:00:00Z"), "north")).toBe("winter");
    expect(seasonAt(new Date("2026-12-28T12:00:00Z"), "north")).toBe("winter");
    expect(seasonAt(new Date("2026-04-15T12:00:00Z"), "south")).toBe("autumn");
    expect(seasonAt(new Date("2026-01-15T12:00:00Z"), "south")).toBe("summer");
    for (const d of ["2026-02-01", "2026-05-01", "2026-08-01", "2026-11-01"]) {
      expect(SESSION_SEASONS).toContain(seasonAt(new Date(`${d}T00:00:00Z`), "north"));
    }
  });

  it("reads a stored stamp, and junk as an empty one", () => {
    expect(readStamp('{"moonName":"Full moon","moonGlyph":"x","moonOrdinal":12,"season":"spring","placeLine":"On this land"}')).toEqual({
      moonName: "Full moon",
      moonGlyph: "x",
      moonOrdinal: 12,
      season: "spring",
      placeLine: "On this land",
    });
    expect(readStamp("not json")).toEqual({ moonName: "", moonGlyph: "", moonOrdinal: null, season: null, placeLine: null });
  });

  it("reads a stored row whose state is junk as the room's default state", () => {
    const s = mapSession({ id: 3, title: "Weekly", status: "open", facilitator_no: 2, state: "{{", version: 6, stamp: null });
    expect(s.state.stage).toBe("dropin");
    expect(s.version).toBe(6);
    expect(s.summary).toBeNull();
  });
});

describe("reading a body", () => {
  const circles = new Set(["c-garden"]);

  it("needs a title, checks the circle, and bounds the length", () => {
    expect(cleanStart({}, circles)).toMatchObject({ ok: false, status: 400, error: SESSION_REFUSALS.titleNeeded });
    expect(cleanStart({ title: "Weekly", circleId: "c-nowhere" }, circles)).toMatchObject({ ok: false, error: SESSION_REFUSALS.circleUnknown });
    expect(cleanStart({ title: "Weekly", durationMin: 5 }, circles)).toMatchObject({ ok: false, error: SESSION_REFUSALS.durationRange });
    expect(cleanStart({ title: "Weekly", durationMin: 481 }, circles)).toMatchObject({ ok: false });
    expect(cleanStart({ title: "  Weekly   garden ", circleId: "c-garden", durationMin: 90 }, circles)).toEqual({
      ok: true,
      value: { title: "Weekly garden", circleId: "c-garden", durationMin: 90 },
    });
  });

  it("starts with the village's usual length when the opener names none", () => {
    expect(cleanStart({ title: "Weekly" }, circles)).toEqual({ ok: true, value: { title: "Weekly", circleId: null, durationMin: defaultDuration() } });
    expect(defaultDuration()).toBe(SESSION_LIMITS.durationDefault);
  });

  it("reads an id as a positive whole number, and nothing else", () => {
    expect(parseId("12")).toBe(12);
    for (const bad of ["0", "-1", "1.5", "12abc", "", undefined, "99999999999"]) expect(parseId(bad)).toBeNull();
  });
});

describe("the dials and the notices this module registers", () => {
  it("registers the place line as text that starts blank, and the room falls back without it", () => {
    const def = VARIABLES_BY_KEY["sessions.place_line"];
    expect(def).toBeTruthy();
    expect(def.type).toBe("text");
    expect(def.default).toBe("");
    expect(def.description.length).toBeGreaterThan(80);
    expect(ringOf(def)).toBe("open");
    expect(validateVariable(def, "")).toBeNull();
    expect(validateVariable(def, "We meet on land the river shaped.")).toBeNull();
    expect(placeLine()).toBeNull();
  });

  it("registers the usual length with the contract's own bounds and default", () => {
    const def = VARIABLES_BY_KEY["sessions.default_minutes"];
    expect(def).toBeTruthy();
    expect(def.type).toBe("integer");
    expect(def.default).toBe(String(SESSION_LIMITS.durationDefault));
    expect(def.min).toBe(SESSION_LIMITS.durationMin);
    expect(def.max).toBe(SESSION_LIMITS.durationMax);
    expect(def.unit).toBe("minutes");
    expect(validateVariable(def, String(SESSION_LIMITS.durationMin - 1))).toBeTruthy();
    expect(validateVariable(def, String(SESSION_LIMITS.durationMax + 1))).toBeTruthy();
    expect(validateVariable(def, "90")).toBeNull();
  });

  it("declares both notices, and sends each in the daily digest", () => {
    const prefs = resolveNotifyPrefs({});
    for (const type of ["session_record_ready", "session_action_held"]) {
      expect(NOTIFICATION_KINDS[type], type).toBeTruthy();
      expect(NOTIFICATION_KINDS[type].celebrate).toBe(false);
      expect(emailCadenceFor(type, prefs)).toBe("daily");
    }
    // A seat holder who was not in the room gets no link to the record, so the
    // notice's own description promises the action and its date, not the record.
    expect(NOTIFICATION_KINDS.session_action_held.blurb).not.toMatch(/record/i);
  });

  it("writes its notices in the house voice", () => {
    const lines = [
      SESSION_NOTICES.recordReady("Garden circle, week 2"),
      SESSION_NOTICES.actionHeld("Garden circle, week 2"),
      SESSION_NOTICES.actionBody("Order the seed.", "2026-10-31"),
      ...Object.values(SESSION_REFUSALS),
    ];
    for (const line of lines) expect(line).not.toMatch(DASHES);
    expect(SESSION_NOTICES.actionBody("Order the seed.", null)).toBe("Order the seed.");
    expect(SESSION_NOTICES.actionBody("Order the seed.", "2026-10-31")).toBe("Order the seed, by 2026-10-31.");
  });
});
