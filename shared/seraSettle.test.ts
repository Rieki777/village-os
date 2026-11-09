/**
 * Answering a difference from the outside service, as pure rules (spec R12,
 * R13, R16, R30, R31): what one take writes, what bulk leaves out, how a new
 * circle carries its roles, and how the list reads a row once it is answered.
 *
 * Each block names the guard it holds, and the controls break that guard.
 */
import { describe, expect, it } from "vitest";
import type { Difference, DifferenceSubject } from "./seraDifferences";
import { answerState, bulkPlan, changesFor, withAnswers, type SettledRow } from "./seraSettle";

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
    const small = diff({ seraHash: "s1" });
    expect(answerState(small, row({ answer: "kept", door: "moderator" }))).toBe("settled");
    const read = withAnswers([d, small], new Map([[d.key, row({ key: d.key, answer: "kept", door: "moderator" })], [small.key, row({ key: small.key })]]));
    expect(read.open.map((x) => x.key)).toEqual([d.key]);
    expect(Array.from(read.setAside)).toEqual([d.key]);
    expect(read.settled).toBe(1);
  });

  it("groups what is in a draft by draft, the roles a circle brought counted with it", () => {
    const { circle, roles } = newCircleWithRoles();
    const rows = new Map<string, SettledRow>([
      [circle.key, row({ key: circle.key, seraHash: circle.seraHash, answer: "taken", draftId: "d1", draftStatus: "open", draftTitle: "From Sera's list" })],
      ...roles.map((r): [string, SettledRow] => [r.key, row({ key: r.key, seraHash: r.seraHash, answer: "taken", draftId: "d1", draftStatus: "open", cameWith: circle.key })]),
    ]);
    const read = withAnswers([circle, ...roles, d], rows);
    expect(read.open.map((x) => x.key)).toEqual([d.key]);
    expect(read.inDraft).toEqual([{ draftId: "d1", title: "From Sera's list", items: [circle], with: roles }]);
  });
});
