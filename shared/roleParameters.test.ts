/**
 * The parameters of a role card (shared/roleParameters.ts) and their place in the
 * "role card v1" text (shared/roleCardText.ts): one reader, so a card that reads
 * clean saves clean, and a card written from a role reads back to the same role.
 */
import { describe, expect, it } from "vitest";
import {
  interviewerFromLine,
  interviewerToLines,
  interviewMinutesTotal,
  payFromLines,
  payToLines,
  readInterviewers,
  readParameter,
  suggestPayGroup,
} from "./roleParameters";
import { readRoleCard, writeRoleCard, ROLE_CARD_WORD_FIELDS } from "./roleCardText";
import { wordFieldsOf } from "./roleProposals";

const isRole = (id: string) => ["a", "b", "c"].includes(id);

describe("readParameter", () => {
  it("reads yes and no, open and closed", () => {
    expect(readParameter("listed", "Yes")).toEqual({ ok: true, value: true });
    expect(readParameter("recruiting", "closed")).toEqual({ ok: true, value: false });
    expect(readParameter("listed", "maybe").ok).toBe(false);
  });

  it("reads a track by its key or its words, and refuses another", () => {
    expect(readParameter("track", "Local employee")).toEqual({ ok: true, value: "employee" });
    expect(readParameter("track", "volunteer")).toEqual({ ok: true, value: "volunteer" });
    expect(readParameter("track", "founder").ok).toBe(false);
    expect(readParameter("track", "")).toEqual({ ok: true, value: null });
  });

  it("holds selection criteria to 3 to 5 lines, or none", () => {
    expect(readParameter("selectionCriteria", ["one", "two"]).ok).toBe(false);
    expect(readParameter("selectionCriteria", ["one", "two", "three"]).ok).toBe(true);
    expect(readParameter("selectionCriteria", "- a\n- b\n- c\n- d\n- e\n- f").ok).toBe(false);
    expect(readParameter("selectionCriteria", [])).toEqual({ ok: true, value: [] });
  });

  it("refuses payment details anywhere in the words", () => {
    expect(readParameter("accessBundle", ["The vault, account 4111 1111 1111 1111"]).ok).toBe(false);
    expect(readParameter("budgetLine", "Pay to IBAN DE89 3704 0044 0532 0130 00").ok).toBe(false);
  });

  it("reads only a real date, whole days, and an https booking link", () => {
    expect(readParameter("fundedFrom", "2027-01-15")).toEqual({ ok: true, value: "2027-01-15" });
    expect(readParameter("fundedFrom", "2027-02-30").ok).toBe(false);
    expect(readParameter("reviewAfterDays", "90")).toEqual({ ok: true, value: 90 });
    expect(readParameter("reviewAfterDays", "ninety").ok).toBe(false);
    expect(readParameter("bookingUrl", "https://cal.example/lead").ok).toBe(true);
    expect(readParameter("bookingUrl", "http://cal.example/lead").ok).toBe(false);
    expect(readParameter("bookingUrl", "javascript:alert(1)").ok).toBe(false);
  });
});

describe("the interview order", () => {
  it("keeps the order, the minutes and the one final approval", () => {
    const r = readInterviewers(
      [
        { roleId: "a", minutes: 60, final: false },
        { roleId: "b", minutes: 20, final: false },
        { roleId: "c", minutes: 20, final: true },
      ],
      isRole,
    );
    expect(r.ok && r.value.map((x) => x.roleId)).toEqual(["a", "b", "c"]);
    expect(r.ok && interviewMinutesTotal(r.value)).toBe(100);
  });

  it("refuses two final approvals, a role twice, a stranger, and a wild length", () => {
    expect(readInterviewers([{ roleId: "a", minutes: 20, final: true }, { roleId: "b", minutes: 20, final: true }], isRole).ok).toBe(false);
    expect(readInterviewers([{ roleId: "a", minutes: 20 }, { roleId: "a", minutes: 20 }], isRole).ok).toBe(false);
    expect(readInterviewers([{ roleId: "zzz", minutes: 20 }], isRole).ok).toBe(false);
    expect(readInterviewers([{ roleId: "a", minutes: 2 }], isRole).ok).toBe(false);
    expect(readInterviewers([{ roleId: "a", minutes: 999 }], isRole).ok).toBe(false);
  });

  it("reads and writes an interview line", () => {
    expect(interviewerFromLine("Lead Steward | 60 minutes")).toEqual({ title: "Lead Steward", minutes: 60, final: false });
    expect(interviewerFromLine("Circle Lead | 20 | final approval")).toEqual({ title: "Circle Lead", minutes: 20, final: true });
    expect(interviewerToLines([{ roleId: "a", minutes: 20, final: true }], () => "Circle Lead")).toEqual(["Circle Lead | 20 minutes | final approval"]);
  });
});

describe("the pay line", () => {
  it("round trips a range, a fixed amount and a note", () => {
    const range = payFromLines(["Range 1000 to 1500 USD per month", "Note: Funding-dependent"]);
    expect(range).toEqual({ ok: true, value: { kind: "range", minMinor: 100000, maxMinor: 150000, currency: "USD", per: "month", note: "Funding-dependent" } });
    if (range.ok) expect(payFromLines(payToLines(range.value))).toEqual(range);
    expect(payFromLines(["Fixed 1200.50 USD per moon"])).toEqual({ ok: true, value: { kind: "fixed", amountMinor: 120050, currency: "USD", per: "moon" } });
    expect(payFromLines(["Honorary"])).toEqual({ ok: true, value: { kind: "honorary" } });
    expect(payFromLines([])).toEqual({ ok: true, value: null });
  });

  it("refuses what the terms' own parser refuses", () => {
    expect(payFromLines(["Range 1500 to 1000 USD per month"]).ok).toBe(false);
    expect(payFromLines(["Honorary 500 USD"]).ok).toBe(false);
    expect(payFromLines(["Lots of money"]).ok).toBe(false);
  });
});

describe("Sera's range", () => {
  const base = { standing: null, statusLabel: null, terms: null } as const;

  it("proposes a monthly range from a target, and marks pending money as funding-dependent", () => {
    expect(suggestPayGroup({ ...base, model: "Contractor", monthlyUsd: 2000, standing: "settled" })).toEqual({ kind: "range", currency: "USD", minMinor: 200000, maxMinor: 200000, per: "month" });
    expect(suggestPayGroup({ ...base, model: "Contractor", monthlyUsd: 2000, standing: "pending" })?.note).toBe("Funding-dependent");
  });

  it("proposes no money for a volunteer, and nothing when Sera sent nothing to go on", () => {
    expect(suggestPayGroup({ ...base, model: "Volunteer", monthlyUsd: null })).toEqual({ kind: "honorary" });
    expect(suggestPayGroup(null)).toBeNull();
    expect(suggestPayGroup({ ...base, model: "Contractor", monthlyUsd: null })).toBeNull();
  });
});

describe("the card text carries the parameters", () => {
  const words = wordFieldsOf({ name: "", aim: "", domain: "", accountabilities: [], authorities: [], responsibilities: [], bringMe: [], notMine: [], existsWhile: "", signsStretched: "", flowsBack: "", stepBack: "", timeCommitment: "", runbook: "" });
  const ctx = { words, roles: [] as never[], circles: [{ id: "c1", name: "Care Circle" }], orgGoals: [] };

  it("writes the parameters under their headings and reads them back, per role", () => {
    const text = writeRoleCard({
      village: "Test",
      roles: [
        {
          title: "Lead Reader",
          circle: "Care Circle",
          words: { aim: "Keep the reading room open", domain: "The shelves" },
          parameters: {
            track: ["contractor"],
            selectionCriteria: ["Reads closely", "Keeps promises", "Listens"],
            conversations: ["Circle Lead | 20 minutes | final approval"],
            pay: ["Range 1000 to 1500 USD per month", "Note: Funding-dependent"],
          },
        },
      ],
      measures: [],
      season: null,
    });
    expect(text).toMatch(/### Selection criteria\n- Reads closely/);
    const read = readRoleCard(text, ctx);
    expect(read.sections[0].parameters).toEqual({
      track: ["contractor"],
      selectionCriteria: ["Reads closely", "Keeps promises", "Listens"],
      conversations: ["Circle Lead | 20 minutes | final approval"],
      pay: ["Range 1000 to 1500 USD per month", "Note: Funding-dependent"],
    });
    // The words still read as they did.
    expect(read.proposalBody.newRoles?.[0].words.aim).toBe("Keep the reading room open");
    expect(read.ignored).toEqual([]);
  });

  it("a card with no parameters reads exactly as before: no parameters on the section", () => {
    const read = readRoleCard("Test role card v1\n\n## Role title\nWatcher\n\n### Circle\nCare Circle\n\n### Purpose\nWatch\n", ctx);
    expect(read.sections[0]).toEqual({ index: 0, title: "Watcher", path: "newRoles.0" });
  });

  it("knows every word field it wrote", () => {
    expect(ROLE_CARD_WORD_FIELDS).toContain("timeCommitment");
  });
});
