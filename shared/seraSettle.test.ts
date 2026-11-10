/**
 * Answering a difference from the outside service, as pure rules (spec R12,
 * R13, R16, R30, R31): what one take writes, what bulk leaves out, how a new
 * circle carries its roles, and how the list reads a row once it is answered.
 *
 * Each block names the guard it holds, and the controls break that guard.
 */
import { describe, expect, it } from "vitest";
import type { Difference, DifferenceSubject } from "./seraDifferences";
import { answerState, bulkPlan, changeLine, changesFor, draftHasChanged, withAnswers, type SettledRow } from "./seraSettle";

let n = 0;
type Over = Omit<Partial<Difference>, "subject"> & { subject?: Partial<DifferenceSubject> };
function diff(over: Over = {}): Difference {
  n += 1;
  const pageId = over.subject?.pageId ?? `${String(n).padStart(4, "0")}aaaabbbbccccddddeeeeffff0000`;
  return {
    key: `role:${pageId}:aim`,
    kind: "textField",
    lane: "lowRisk",
    state: "suggestion",
    field: "aim",
    sera: "Keeps the wells clean.",
    ours: "Keeps the wells.",
    base: { value: "Keeps the wells." },
    seraHash: `s${n}`,
    oursHash: `o${n}`,
    flags: [],
    namesAMember: false,
    autoEligible: true,
    bulkEligible: true,
    takeable: true,
    source: { pageId, editedAt: null },
    ...over,
    subject: { kind: "role", pageId, ourId: `role-${n}`, via: "pageId", name: `Role ${n}`, circleId: "water", circleName: "Water", ...over.subject },
  };
}

const ctx = (d: Difference, list: Difference[] = [d], extra: Partial<Parameters<typeof changesFor>[0]> = {}) =>
  changesFor({ d, list, actor: "u-ana", draftCircles: new Map(), ...extra });

describe("one difference writes one field (R12)", () => {
  it("a role's words: one update_seat carrying the aim and nothing else", () => {
    const d = diff();
    const t = ctx(d);
    expect(t).toEqual({ ok: true, changes: [{ op: "update_seat", orgRoleId: d.subject.ourId, payload: { aim: "Keeps the wells clean." } }], with: [], leftOut: [] });
  });

  it("a rename carries the name only, a move the circle only", () => {
    const rename = diff({ kind: "rename", lane: "decision", field: "name", sera: "Well Keeper", ours: "Role" });
    const move = diff({ kind: "roleMove", lane: "decision", field: "circle", sera: "land", ours: "water" });
    const a = ctx(rename);
    const b = ctx(move);
    expect(a.ok && a.changes).toEqual([{ op: "update_seat", orgRoleId: rename.subject.ourId, payload: { name: "Well Keeper" } }]);
    expect(b.ok && b.changes).toEqual([{ op: "update_seat", orgRoleId: move.subject.ourId, payload: { circleId: "land" } }]);
  });

  it("an edit writes the person's own words, trimmed, into that one field", () => {
    const d = diff();
    const t = ctx(d, [d], { value: "  Keeps the wells and the pump.  " });
    expect(t.ok && t.changes).toEqual([{ op: "update_seat", orgRoleId: d.subject.ourId, payload: { aim: "Keeps the wells and the pump." } }]);
    expect(ctx(d, [d], { value: "   " })).toEqual({ ok: false, why: "blank" });
  });

  it("a retirement is the person's own choice, stamped with who chose it, and never a held role", () => {
    const rest = diff({ kind: "roleRest", lane: "decision", field: null, sera: "gone", ours: "live" });
    const t = ctx(rest);
    expect(t.ok && t.changes).toEqual([{ op: "rest_seat", orgRoleId: rest.subject.ourId, payload: { chosenBy: "u-ana", retiring: "sera" } }]);
    const held = diff({ kind: "roleRest", lane: "decision", field: null, sera: "gone", ours: "live", flags: [{ key: "heldHere", params: { holders: 1 } }] });
    expect(ctx(held)).toEqual({ ok: false, why: "heldHere" });
  });

  it("never takes words a member's name was swapped out of, pay, or a move to more than one circle", () => {
    expect(ctx(diff({ takeable: false, namesAMember: true, flags: [{ key: "namesAMember" }] }))).toEqual({ ok: false, why: "namesAMember" });
    expect(ctx(diff({ kind: "pay", lane: "decision", field: "pay", takeable: false }))).toEqual({ ok: false, why: "pay" });
    expect(ctx(diff({ kind: "roleMove", lane: "decision", field: "circle", sera: "land|kitchen", ours: "water" }))).toEqual({ ok: false, why: "severalCircles" });
  });
});

/** A new circle and the new roles the service puts in it. */
function newCircleWithRoles() {
  const pk = "c0ffee00c0ffee00c0ffee00c0ffee00";
  const circle = diff({
    key: `circle:${pk}:presence`, kind: "circleAdd", lane: "decision", field: null, sera: "Land Stewardship", ours: null, base: "unknown",
    flags: [{ key: "baseUnknown" }, { key: "firstSight" }], autoEligible: false, bulkEligible: false,
    subject: { kind: "circle", pageId: pk, ourId: null, via: null, name: "Land Stewardship", circleId: null, circleName: null },
  });
  const role = (name: string) =>
    diff({
      kind: "roleAdd", lane: "decision", field: null, sera: name, ours: null, base: "unknown", params: { aim: `${name} keeps it.` },
      flags: [{ key: "baseUnknown" }, { key: "circleNotHere", params: { circle: "Land Stewardship" } }], autoEligible: false, bulkEligible: false,
      subject: { ourId: null, via: null, name, circleId: `sera:${pk}`, circleName: "Land Stewardship" },
    });
  const roles = [role("Seed Keeper"), role("Hedge Layer")];
  roles.forEach((r) => (r.key = `role:${r.subject.pageId}:presence`));
  return { pk, circle, roles };
}

describe("a new circle carries its new roles (R31)", () => {
  it("taking the circle makes it and puts each of its new roles in it, in one take", () => {
    const { circle, roles } = newCircleWithRoles();
    const t = ctx(circle, [circle, ...roles]);
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.changes[0]).toEqual({ op: "create_circle", orgRoleId: "circle:land-stewardship", payload: { name: "Land Stewardship", purpose: null, parentCircleId: null } });
    expect(t.changes.slice(1).map((c) => [c.op, c.payload.name, c.payload.circleId])).toEqual([
      ["create_seat", "Seed Keeper", "land-stewardship"],
      ["create_seat", "Hedge Layer", "land-stewardship"],
    ]);
    expect(t.with).toEqual(roles.map((r) => r.key));
  });

  it("refuses one of those roles on its own, and places it once the circle is in the draft", () => {
    const { pk, circle, roles } = newCircleWithRoles();
    expect(ctx(roles[0], [circle, ...roles])).toEqual({ ok: false, why: "circleFirst" });
    const placed = ctx(roles[0], [circle, ...roles], { draftCircles: new Map([[pk, "land-stewardship"]]) });
    expect(placed.ok && placed.changes.map((c) => c.payload.circleId)).toEqual(["land-stewardship"]);
  });

  it("leaves out, and names, a new role already answered, already in a draft, or carrying a reason to check first of its own (R2, review 5)", () => {
    const { circle, roles } = newCircleWithRoles();
    const third = diff({ ...roles[0], key: "role:third:presence", sera: "Soil Tester", subject: { ...roles[0].subject, pageId: "third", name: "Soil Tester" } });
    third.flags = [...third.flags, { key: "sameNameAsLive", params: { name: "Soil Tester", of: "role" } }];
    const answers = new Map<string, SettledRow>([
      [roles[0].key, row({ key: roles[0].key, seraHash: roles[0].seraHash, oursHash: roles[0].oursHash, answer: "kept", door: "power" })],
      [roles[1].key, row({ key: roles[1].key, seraHash: roles[1].seraHash, oursHash: roles[1].oursHash, answer: "taken", draftId: "d0", draftStatus: "open" })],
    ]);
    const t = changesFor({ d: circle, list: [circle, ...roles, third], actor: "u-ana", draftCircles: new Map(), answers });
    expect(t.ok && t.changes.map((c) => c.op)).toEqual(["create_circle"]);
    expect(t.ok && t.leftOut).toEqual([
      { key: roles[0].key, why: "answered" },
      { key: roles[1].key, why: "answered" },
      { key: third.key, why: "checkFirst" },
    ]);
  });

  it("writes the service's words as stored, line breaks and all; only the comparison is normalised (review 6)", () => {
    const stored = "Keeps the wells clean.\n\n- daily check\n- weekly report";
    const words = diff({ sera: "Keeps the wells clean. - daily check - weekly report", seraAsStored: stored });
    const t = changesFor({ d: words, list: [words], actor: "u-ana", draftCircles: new Map() });
    expect(t.ok && t.changes[0].payload).toEqual({ aim: stored });
    const { circle, roles } = newCircleWithRoles();
    roles[0].params = { aim: "Keeps the seed bank. Sorts it.", aimAsStored: "Keeps the seed bank.\nSorts it." };
    const c = changesFor({ d: circle, list: [circle, ...roles], actor: "u-ana", draftCircles: new Map() });
    expect(c.ok && c.changes[1].payload.aim).toBe("Keeps the seed bank.\nSorts it.");
  });

  it("leaves a role whose words name a member behind, and says so", () => {
    const { circle, roles } = newCircleWithRoles();
    roles[1].takeable = false;
    roles[1].namesAMember = true;
    const t = ctx(circle, [circle, ...roles]);
    expect(t.ok && t.with).toEqual([roles[0].key]);
    expect(t.ok && t.leftOut).toEqual([{ key: roles[1].key, why: "namesAMember" }]);
  });
});

describe("bulk takes only what may be taken together (R2, R30, R31)", () => {
  it("leaves out Check first rows and unknown-base rows, and pay, and names each", () => {
    const plain = diff();
    const firstSight = diff({ kind: "roleAdd", lane: "decision", field: null, flags: [{ key: "baseUnknown" }, { key: "firstSight" }], bulkEligible: false, autoEligible: false });
    const unknownBase = diff({ flags: [{ key: "baseUnknown" }], bulkEligible: false, autoEligible: false, base: "unknown" });
    const pay = diff({ kind: "pay", lane: "decision", field: "pay", bulkEligible: false, takeable: false });
    const plan = bulkPlan([plain, firstSight, unknownBase, pay], [plain, firstSight, unknownBase, pay]);
    expect(plan.take).toEqual([plain]);
    expect(plan.leftOut.map((l) => [l.d.key, l.why])).toEqual([
      [firstSight.key, "checkFirst"],
      [unknownBase.key, "checkFirst"],
      [pay.key, "pay"],
    ]);
  });

  it("names pay and ours ahead as what they are, never as Check first (review 10)", () => {
    const pay = diff({ kind: "pay", lane: "decision", field: "pay", bulkEligible: false, takeable: false, flags: [{ key: "baseUnknown" }] });
    const ahead = diff({ state: "oursAhead", bulkEligible: false, takeable: false });
    expect(bulkPlan([pay, ahead], [pay, ahead]).leftOut.map((l) => l.why)).toEqual(["pay", "oursAhead"]);
  });

  it("a new circle left out leaves its roles out with it, said as one cascade", () => {
    const { circle, roles } = newCircleWithRoles();
    const plain = diff();
    const plan = bulkPlan([circle, roles[0], plain], [circle, ...roles, plain]);
    expect(plan.take).toEqual([plain]);
    expect(plan.cascades).toEqual([{ circle, roles }]);
    expect(plan.leftOut.map((l) => [l.d.key, l.why])).toEqual([
      [circle.key, "checkFirst"],
      [roles[0].key, "withCircle"],
    ]);
  });
});

const row = (over: Partial<SettledRow>): SettledRow => ({
  key: "k", seraHash: "s1", oursHash: "o1", answer: "kept", door: "power", draftId: null, draftStatus: null, draftTitle: null, cameWith: null, ...over,
});

describe("how the list reads an answered difference (R13, R16)", () => {
  const d = diff({ seraHash: "s1", oursHash: "o1", lane: "decision", kind: "rename", field: "name" });

  it("a take is in a draft while the draft is open, settled once it is live, and open again when withdrawn or reverted", () => {
    expect(answerState(d, row({ answer: "taken", draftId: "d1", draftStatus: "open" }))).toBe("inDraft");
    expect(answerState(d, row({ answer: "taken", draftId: "d1", draftStatus: "published" }))).toBe("settled");
    expect(answerState(d, row({ answer: "edited", draftId: "d1", draftStatus: "published" }))).toBe("settled");
    expect(answerState(d, row({ answer: "taken", draftId: "d1", draftStatus: "withdrawn" }))).toBe("open");
    expect(answerState(d, row({ answer: "taken", draftId: "d1", draftStatus: "reverted" }))).toBe("open");
    expect(answerState(d, row({ answer: "taken", draftId: "d1", draftStatus: null }))).toBe("open");
  });

  it("a keep holds until the service's value changes, and an undo opens it again", () => {
    expect(answerState(d, row({ answer: "kept" }))).toBe("settled");
    expect(answerState(d, row({ answer: "kept", seraHash: "s2" }))).toBe("open");
    expect(answerState(d, row({ answer: "undone" }))).toBe("open");
    expect(answerState(d, undefined)).toBe("open");
  });

  it("a moderator without the power only sets a decision aside, and it stays in the list", () => {
    expect(answerState(d, row({ answer: "kept", door: "moderator" }))).toBe("setAside");
    const small = diff({ seraHash: "s1", oursHash: "o1" });
    const read = withAnswers([d, small], new Map([[d.key, row({ key: d.key, answer: "kept", door: "moderator" })], [small.key, row({ key: small.key })]]));
    expect(read.open.map((x) => x.key)).toEqual([d.key]);
    expect(Array.from(read.setAside)).toEqual([d.key]);
    expect(read.settled).toBe(1);
  });

  it("while automatic apply is off, a moderator's keep of a small change or a fact only sets it aside too (R29, review 17)", () => {
    const small = diff({ seraHash: "s1", oursHash: "o1", lane: "lowRisk" });
    const fact = diff({ seraHash: "s1", oursHash: "o1", lane: "facts", kind: "valueField", field: "Sector" });
    expect(answerState(small, row({ answer: "kept", door: "moderator" }))).toBe("setAside");
    expect(answerState(fact, row({ answer: "kept", door: "moderator" }))).toBe("setAside");
    expect(answerState(small, row({ answer: "kept", door: "power" }))).toBe("settled");
  });

  it("an answer whose difference left the list after it was answered answers nothing (review 7)", () => {
    expect(answerState(d, row({ answer: "kept", lapsed: true }))).toBe("open");
    expect(answerState(d, row({ answer: "taken", draftId: "d1", draftStatus: "published", lapsed: true }))).toBe("open");
  });

  it("groups what is in a draft by draft, the roles a circle brought counted with it", () => {
    const { circle, roles } = newCircleWithRoles();
    const rows = new Map<string, SettledRow>([
      [circle.key, row({ key: circle.key, seraHash: circle.seraHash, oursHash: circle.oursHash, answer: "taken", draftId: "d1", draftStatus: "open", draftTitle: "From Sera's list" })],
      ...roles.map((r): [string, SettledRow] => [r.key, row({ key: r.key, seraHash: r.seraHash, oursHash: r.oursHash, answer: "taken", draftId: "d1", draftStatus: "open", cameWith: circle.key })]),
    ]);
    const read = withAnswers([circle, ...roles, d], rows);
    expect(read.open.map((x) => x.key)).toEqual([d.key]);
    expect(read.inDraft.map((g) => [g.draftId, g.title, g.items.map((i) => [i.d, i.changed]), g.with.map((i) => i.d)])).toEqual([
      ["d1", "From Sera's list", [[circle, false]], roles],
    ]);
  });

  it("builds a draft from the stored answers: a take whose difference has gone, or whose values moved, shows and is marked changed (review 3)", () => {
    const words = diff({ seraHash: "s-now", oursHash: "o1" });
    const gone = "role:gone000000000000000000000000000:presence";
    const rows = new Map<string, SettledRow>([
      [words.key, row({ key: words.key, seraHash: "s-then", oursHash: "o1", answer: "taken", draftId: "d1", draftStatus: "open" })],
      [gone, row({ key: gone, answer: "taken", draftId: "d1", draftStatus: "open" })],
    ]);
    expect(answerState(words, rows.get(words.key))).toBe("changed");
    expect(answerState(words, row({ seraHash: "s-now", oursHash: "o-moved", answer: "taken", draftId: "d1", draftStatus: "open" }))).toBe("changed");
    const read = withAnswers([words], rows);
    expect(read.open).toEqual([]);
    expect(read.inDraft[0].items.map((i) => [i.key, i.d?.key ?? null, i.changed])).toEqual([
      [words.key, words.key, true],
      [gone, null, true],
    ]);
    expect(draftHasChanged(read.inDraft[0])).toBe(true);
  });

  it("says a change whose difference has gone in our own names, never the service's words", () => {
    const names = new Map([["r-1", "Dish Rota"], ["circle:c-1", "Kitchen"]]);
    expect(changeLine({ op: "rest_seat", orgRoleId: "r-1", payload: { chosenBy: "u" } }, names)).toBe("Retiring Dish Rota");
    expect(changeLine({ op: "update_seat", orgRoleId: "r-1", payload: { aim: "x" } }, names)).toBe("New words for Dish Rota's purpose");
    expect(changeLine({ op: "rest_circle", orgRoleId: "circle:c-1", payload: {} }, names)).toBe("Retiring the circle Kitchen");
  });
});
