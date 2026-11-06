import { describe, expect, it } from "vitest";
import { readSign, type SignRows, type SignWindow } from "./roleSigns";
import { signSheetRows } from "./roleSignRows";

const TZ = "UTC";
const W: SignWindow = { from: new Date("2026-10-10T00:00:00Z"), to: new Date("2026-10-30T00:00:00Z"), timeZone: TZ };
const PREV: SignWindow = { from: new Date("2026-09-10T00:00:00Z"), to: W.from, timeZone: TZ };

describe("the rows behind a sign", () => {
  it("are exactly the rows the count looked at, so the sheet and the number agree", () => {
    const rows: SignRows = {
      seat_applications: [
        { id: "a", status: "adopted", created_at: "2026-10-12T10:00:00Z", decided_at: "2026-10-13T10:00:00Z", candidate_user_id: "u2" },
        { id: "b", status: "voting", created_at: "2026-10-14T10:00:00Z", decided_at: null, candidate_user_id: "u1" },
        { id: "c", status: "withdrawn", created_at: "2026-10-15T10:00:00Z", decided_at: null, candidate_user_id: "u3" },
        { id: "d", status: "adopted", created_at: "2026-09-12T10:00:00Z", decided_at: "2026-09-13T10:00:00Z", candidate_user_id: "u4" },
      ],
    };
    const sheet = signSheetRows("applications-answered", rows, W)!;
    const reading = readSign("applications-answered", rows, { current: W, previous: PREV });
    expect(sheet.map((r) => r.words)).toEqual(["Answered within 2 business days", "Not answered within 2 business days"]);
    expect(reading.kind === "counted" && reading.now).toMatchObject({ n: 1, of: 2 });
    expect(sheet.map((r) => r.personId)).toEqual(["u2", "u1"]);
  });

  it("is never ranked: rows come in the order things happened, undated ones last", () => {
    const rows: SignRows = {
      season_id: "s1",
      users: [
        { id: "u-late", joined_at: "2026-01-01T00:00:00Z" },
        { id: "u-none", joined_at: "2026-01-01T00:00:00Z" },
        { id: "u-early", joined_at: "2026-01-01T00:00:00Z" },
      ],
      season_plans: [
        { user_id: "u-late", season_id: "s1", filed_at: "2026-10-20T00:00:00Z", superseded_at: null },
        { user_id: "u-early", season_id: "s1", filed_at: "2026-10-11T00:00:00Z", superseded_at: null },
      ],
    };
    const sheet = signSheetRows("season-plans-filed", rows, W)!;
    expect(sheet.map((r) => r.personId)).toEqual(["u-early", "u-late", "u-none"]);
    expect(sheet[2].words).toBe("No season plan filed yet");
  });

  it("names a role by its full title and no person", () => {
    const rows: SignRows = {
      org_roles: [{ id: "r1", name: "Water Keeper", active: 1, aim: "x", domain: null, accountabilities: "[]" }],
      org_role_assignments: [],
    };
    const sheet = signSheetRows("roles-with-card-and-term", rows, W)!;
    expect(sheet).toEqual([{ at: null, words: "Water Keeper: missing domain, what it answers for, a term", personId: null }]);
  });

  it("returns null for an unknown key or an unread table, never an empty sheet", () => {
    expect(signSheetRows("sign-ins", {}, W)).toBeNull();
    expect(signSheetRows("decisions-recorded", {}, W)).toBeNull();
    expect(signSheetRows("decisions-recorded", { live_session_entries: [] }, W)).toEqual([]);
  });

  it("lists only the decisions the room consented to, the ones the count counts", () => {
    const rows: SignRows = {
      live_session_entries: [
        { session_id: 1, kind: "decision", status: "done", created_at: "2026-10-12T16:00:00Z" },
        { session_id: 1, kind: "decision", status: "open", created_at: "2026-10-13T16:00:00Z" },
        { session_id: 1, kind: "decision", status: "parked", created_at: "2026-10-14T16:00:00Z" },
      ],
    };
    expect(signSheetRows("decisions-recorded", rows, W)).toHaveLength(1);
    expect(readSign("decisions-recorded", rows, { current: W, previous: W })).toMatchObject({ now: { n: 1 } });
  });
});
