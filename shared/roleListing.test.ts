import { describe, expect, it } from "vitest";
import { circleHasListedRole, circlesToShow, isListed, ownRoleIdsOf, planListOnly, pushRecord, visibleTo, LISTING_RECORDS_MAX } from "./roleListing";

describe("isListed", () => {
  it("reads null and absent as listed, and only an explicit false as unlisted", () => {
    expect(isListed({ listed: null })).toBe(true);
    expect(isListed({})).toBe(true);
    expect(isListed({ listed: true })).toBe(true);
    expect(isListed({ listed: false })).toBe(false);
  });
});

describe("visibleTo", () => {
  const hidden = { id: "r1", listed: false };
  it("hides an unlisted role from a plain reader (control: the listed one shows)", () => {
    expect(visibleTo(hidden, { seesUnlisted: false })).toBe(false);
    expect(visibleTo({ id: "r2", listed: null }, { seesUnlisted: false })).toBe(true);
  });
  it("shows it to a steward and to its own holder, and to nobody else", () => {
    expect(visibleTo(hidden, { seesUnlisted: true })).toBe(true);
    expect(visibleTo(hidden, { seesUnlisted: false, ownRoleIds: new Set(["r1"]) })).toBe(true);
    expect(visibleTo(hidden, { seesUnlisted: false, ownRoleIds: new Set(["other"]) })).toBe(false);
  });
});

describe("circles", () => {
  const roles = [
    { circleId: "a", listed: false },
    { circleId: "b", listed: false },
    { circleId: "b", listed: null },
    { circleId: "child", listed: null },
  ];
  it("leaves off a circle whose roles are all unlisted, keeps one with a listed role, and keeps a circle with no roles", () => {
    expect(circleHasListedRole("a", roles)).toBe(false);
    expect(circleHasListedRole("b", roles)).toBe(true);
    expect(circleHasListedRole("empty", roles)).toBe(true);
  });
  it("keeps the parent of a circle that stays, and shows everything to a steward", () => {
    const circles = [
      { id: "a", parentCircleId: null },
      { id: "b", parentCircleId: null },
      { id: "p", parentCircleId: null },
      { id: "child", parentCircleId: "p" },
    ];
    const rolesWithParent = [...roles, { circleId: "p", listed: false }];
    expect(circlesToShow(circles, rolesWithParent, { seesUnlisted: false }).map((c) => c.id).sort()).toEqual(["b", "child", "p"]);
    expect(circlesToShow(circles, rolesWithParent, { seesUnlisted: true })).toHaveLength(4);
  });
});

describe("planListOnly", () => {
  const roles = [{ id: "a", listed: null }, { id: "b", listed: false }, { id: "c", listed: true }];
  it("lists the named roles, unlists the rest, and keeps what each read as before", () => {
    const plan = planListOnly(roles, ["a"]);
    expect(plan.list).toEqual(["a"]);
    expect(plan.unlist).toEqual(["b", "c"]);
    expect(plan.before).toEqual([
      { id: "a", listed: true },
      { id: "b", listed: false },
      { id: "c", listed: true },
    ]);
  });
  it("keeps only the newest records", () => {
    let rs: ReturnType<typeof pushRecord> = [];
    for (let i = 0; i < LISTING_RECORDS_MAX + 3; i += 1) rs = pushRecord(rs, { at: String(i), kept: [], before: [] });
    expect(rs).toHaveLength(LISTING_RECORDS_MAX);
    expect(rs[rs.length - 1].at).toBe(String(LISTING_RECORDS_MAX + 2));
  });
});

describe("ownRoleIdsOf", () => {
  it("counts live seatings of that person only", () => {
    const set = ownRoleIdsOf(
      [
        { orgRoleId: "r1", userId: "u1" },
        { orgRoleId: "r2", userId: "u1", endedAt: new Date() },
        { orgRoleId: "r3", userId: "u2" },
      ],
      "u1",
    );
    expect(Array.from(set)).toEqual(["r1"]);
    expect(ownRoleIdsOf([{ orgRoleId: "r1", userId: "u1" }], null).size).toBe(0);
  });
});
