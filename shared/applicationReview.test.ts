import { describe, expect, it } from "vitest";
import {
  currentInterview,
  FIRST_REPLY_BUSINESS_DAYS,
  firstReplyDueAt,
  firstReplyReminderAt,
  interviewsDone,
  isStale,
  kindOfRef,
  mayReadScorecards,
  minutesWords,
  nextAfter,
  parseCriteria,
  parseInterviewerRoles,
  parseScoreInput,
  statusFor,
  totalMinutes,
  type ReaderFacts,
} from "./applicationReview";

const CR = "America/Costa_Rica";

describe("the interviewers a role names", () => {
  const lead = [
    { roleId: "visionary-channel", minutes: 60, final: false },
    { roleId: "a", minutes: 20, final: false },
    { roleId: "b", minutes: 20, final: false },
    { roleId: "c", minutes: 20, final: true },
  ];
  it("keeps the order, the minutes and the final flag, and totals two hours", () => {
    const got = parseInterviewerRoles(lead);
    expect(got.map((g) => g.roleId)).toEqual(["visionary-channel", "a", "b", "c"]);
    expect(got[3].final).toBe(true);
    expect(totalMinutes(got)).toBe(120);
    expect(minutesWords(120)).toBe("2 hours");
  });
  it("reads stored JSON text, and never throws on junk", () => {
    expect(parseInterviewerRoles(JSON.stringify(lead))).toHaveLength(4);
    for (const junk of [null, undefined, "{", 5, {}, [null, 3, "x"]]) expect(parseInterviewerRoles(junk)).toEqual([]);
  });
  it("drops repeats, bad lengths, and a second final", () => {
    const got = parseInterviewerRoles([
      { roleId: "a", minutes: 20, final: true },
      { roleId: "a", minutes: 20 },
      { roleId: "b", minutes: 1 },
      { roleId: "c", minutes: 500 },
      { roleId: "d", final: true },
    ]);
    expect(got).toEqual([
      { roleId: "a", minutes: 20, final: true },
      { roleId: "d", minutes: 20, final: false },
    ]);
  });
});

describe("interviews run in order", () => {
  const list = [
    { position: 1, state: "scored" as const },
    { position: 2, state: "open" as const },
    { position: 3, state: "waiting" as const },
  ];
  it("asks only the first not finished, and only when it is open", () => {
    expect(currentInterview(list)?.position).toBe(2);
    // CONTROL: a waiting interview is never the current one, even when it is the first unfinished.
    expect(currentInterview([{ position: 1, state: "waiting" as const }])).toBeNull();
    expect(currentInterview([{ position: 1, state: "scored" as const }, { position: 2, state: "waiting" as const }])).toBeNull();
  });
  it("opens the next only after the previous", () => {
    expect(nextAfter(list, 2)?.position).toBe(3);
    expect(nextAfter(list, 3)).toBeNull();
    expect(interviewsDone(list)).toBe(false);
    expect(interviewsDone(list.map((i) => ({ ...i, state: "scored" as const })))).toBe(true);
    expect(interviewsDone([])).toBe(true);
  });
});

describe("the scorecard", () => {
  const criteria = parseCriteria(["Reads a budget", { id: "k", text: "Works with partners" }]);
  it("reads criteria and gives each an id", () => {
    expect(criteria).toEqual([
      { id: "c1", text: "Reads a budget" },
      { id: "k", text: "Works with partners" },
    ]);
  });
  const good = { entries: [{ criterionId: "c1", level: "solid", evidence: "Walked the grant budget line by line." }, { criterionId: "k", level: "strong", evidence: "Named three partner calls." }] };
  it("accepts every criterion with a level and a line of evidence", () => {
    expect(parseScoreInput(good, criteria).ok).toBe(true);
  });
  it("refuses a missing criterion, a fifth level, empty evidence and an extra entry", () => {
    expect(parseScoreInput({ entries: [good.entries[0]] }, criteria).ok).toBe(false);
    expect(parseScoreInput({ entries: [{ ...good.entries[0], level: "great" }, good.entries[1]] }, criteria).ok).toBe(false);
    expect(parseScoreInput({ entries: [{ ...good.entries[0], evidence: "  " }, good.entries[1]] }, criteria).ok).toBe(false);
    expect(parseScoreInput({ entries: [...good.entries, { criterionId: "zz", level: "solid", evidence: "x" }] }, criteria).ok).toBe(false);
  });
});

describe("who may read scorecards", () => {
  const base: ReaderFacts = { isApplicant: false, isInterviewer: false, hasSubmitted: false, recused: false, holdsSeatPower: false };
  it("hides every card from an interviewer until their own is in", () => {
    expect(mayReadScorecards({ ...base, isInterviewer: true })).toBe(false);
    // CONTROL: the same person after submitting reads them.
    expect(mayReadScorecards({ ...base, isInterviewer: true, hasSubmitted: true })).toBe(true);
  });
  it("hides them from an interviewer who holds the power to fill roles, until their own is in", () => {
    expect(mayReadScorecards({ ...base, isInterviewer: true, holdsSeatPower: true })).toBe(false);
    expect(mayReadScorecards({ ...base, holdsSeatPower: true })).toBe(true);
  });
  it("never shows them to the applicant or to someone who stepped out", () => {
    expect(mayReadScorecards({ ...base, isApplicant: true, holdsSeatPower: true, hasSubmitted: true })).toBe(false);
    expect(mayReadScorecards({ ...base, recused: true, holdsSeatPower: true })).toBe(false);
    expect(mayReadScorecards(base)).toBe(false);
  });
});

describe("the clocks", () => {
  // Monday 9 Nov 2026, noon in Costa Rica.
  const monday = new Date("2026-11-09T18:00:00Z");
  it("first reply is due in 3 business days, reminded at 2", () => {
    expect(FIRST_REPLY_BUSINESS_DAYS).toBe(3);
    expect(firstReplyDueAt(monday, CR).toISOString()).toBe("2026-11-12T18:00:00.000Z");
    expect(firstReplyReminderAt(monday, CR).toISOString()).toBe("2026-11-11T18:00:00.000Z");
  });
  it("skips a weekend", () => {
    const thursday = new Date("2026-11-12T18:00:00Z");
    expect(firstReplyDueAt(thursday, CR).toISOString()).toBe("2026-11-17T18:00:00.000Z");
  });
  it("calls an application stale after ten days", () => {
    expect(isStale(monday, new Date("2026-11-19T17:59:00Z"))).toBe(false);
    expect(isStale(monday, new Date("2026-11-19T18:00:00Z"))).toBe(true);
  });
});

describe("the applicant's status", () => {
  const confirmedAt = new Date("2026-11-09T18:00:00Z");
  const interviews = [
    { position: 1, state: "open" as const, roleName: "Visionary Channel", minutes: 60, final: false, dueAt: new Date("2026-11-23T18:00:00Z") },
    { position: 2, state: "waiting" as const, roleName: "Second", minutes: 20, final: true, dueAt: null },
  ];
  const base = { decided: null, firstReplyAt: null, confirmedAt, interviews, consentOpen: false, consentClosesAt: null, timeZone: CR };
  it("says first reply, by whom and by when, before anything else", () => {
    const s = statusFor(base);
    expect(s.step).toBe("first_reply");
    expect(s.by?.toISOString()).toBe("2026-11-12T18:00:00.000Z");
  });
  it("then the open interview by role, with its minutes", () => {
    const s = statusFor({ ...base, firstReplyAt: confirmedAt });
    expect(s.step).toBe("interview");
    expect(s.actsNext).toContain("Visionary Channel");
    expect(s.actsNext).toContain("60 minutes");
  });
  it("then the circle's consent, then the decision", () => {
    const done = interviews.map((i) => ({ ...i, state: "scored" as const }));
    expect(statusFor({ ...base, firstReplyAt: confirmedAt, interviews: done }).step).toBe("consent");
    expect(statusFor({ ...base, firstReplyAt: confirmedAt, interviews: done, decided: "adopted" }).step).toBe("decided");
  });
  it("says whose move it is once decided, and drops the steps that never happened (guide v2, Rye 10 Nov 2026)", () => {
    // Adopted straight away, with no first reply and no conversation held.
    const adopted = statusFor({ ...base, decided: "adopted" });
    expect(adopted.actsNext).toBe("Yours: make your account. The link to make it is in your email.");
    expect(adopted.path.map((p) => p.state)).not.toContain("later");
    expect(adopted.path.map((p) => p.label)).not.toContain("First reply");
    expect(statusFor({ ...base, decided: "withdrawn" }).actsNext).toBe("Nobody. You withdrew this proposal.");
    expect(statusFor({ ...base, decided: "declined" }).actsNext).toBe("Nobody. The village has answered.");
  });

  it("carries no score, no name and no address", () => {
    const text = JSON.stringify(statusFor({ ...base, firstReplyAt: confirmedAt }));
    expect(text).not.toMatch(/@|level|evidence|score/i);
  });
});

describe("the ref", () => {
  it("tells the two doors apart and refuses the rest", () => {
    expect(kindOfRef("op-0123456789abcdef0123")).toBe("open");
    expect(kindOfRef("sa-abc123")).toBe("member");
    for (const bad of ["", "op-xyz", "x", null, 4, "sa-"]) expect(kindOfRef(bad as any)).toBeNull();
  });
});
