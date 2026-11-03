/**
 * The end-of-moon review contract (shared/moonRecap.ts), with no database.
 *
 * Named checks from the build spec, section 12, that this file owns:
 *   1  endOfMoonFriday gives Friday 6 November 2026, in village time.
 *   3  three roles on one application make one line, carrying pay once.
 *   4  monthly terms prorate by days in the moon; part of a moon by days held.
 *   7  an invoice send is refused for pending, tourist, invoicing off, no
 *      payable line, a missing attestation or acknowledgement.
 *   8  two different people, neither the member, by default; one person
 *      alone only with moon.approve_alone and never on their own; one's own
 *      only with moon.approve_own, and marked (decisions 18 and 19).
 *   9  any change to what an approval binds changes the hash.
 *   10 Finance approval refusals (authority is a note, decision 16).
 *   11 the cycle id matches under both clocks (moonDays keeps the clock's id).
 *   12 another member's view carries no suggested, dropped, returned or
 *      approvers-only item, and no Sera evidence (asserted on the object).
 *   14 no shape carries hours or minutes; no origin is a quest.
 *   17 the work summary lists approved, invoiced items, ticked proof, no amount.
 *   20 the October Moon's counts score 12 and a half of 18, 69% (neutral titles:
 *      the repository is public).
 *   21 a goal carried twice is flagged; Let go without a reason is refused.
 *   22 (pure half) Sera hears only about tasks Sera sent.
 *   23 an Outside my roles item shows in the role audit with its role named.
 */
import { describe, expect, it } from "vitest";
import { CALENDAR_CLOCK, LUNAR_CLOCK } from "./cycleClock";
import {
  addWorkingDays, approvalDecision, approvalHash, auditTensions, confirmRouteRefusal, coverage, deadlineAction,
  eligibleApprovers, endOfMoonFriday, financeApprovalRefusal, INVOICE_STATUS_WORDS, invoicePaidFrom, invoiceSendRefusal,
  invoiceStatusLine, invoiceTotals, ITEM_ORIGINS, itemDedupeKey, linesFromTerms, memberView, moonDays,
  parseAttestation, parseItemFields, parsePayers, parsePayRouteInput, parseRoleAudit, payersChanges, payerForRoute,
  prorate, RECAP_STATUS_WORDS, routeChangeClearsConfirmation, SEND_REFUSALS, taxFormValidOn,
  workSummaryText, workDueOn, type ApprovalSubject, type InvoiceLine, type Payer, type PayRouteRecord, type RecapItem,
  type TermsInForce, taskScore, seatCoverage, goalScore, scoreWords, carriedTooOften, carriedGoals, goalScoreProblem, parseMoonGoals,
  carriedItems, seraClosures, outsideRolesAudit, sendBy, type MoonGoal,
} from "./moonRecap";
import * as contract from "./moonRecap";

const TZ = "America/Costa_Rica";
const NOV = LUNAR_CLOCK.boundsFor(new Date("2026-11-01T12:00:00Z"));
const MOON = moonDays(NOV, TZ);

function item(over: Partial<RecapItem>): RecapItem {
  return {
    id: "mi-0000000000000001", origin: "task", dedupeKey: "task:t1", text: "Wrote the water plan", originNote: null, doneOn: null, evidenceUrl: null,
    evidenceAsset: null, proofInSummary: false, roleId: "r1", accountabilityWords: null, seasonGoalId: null, ownGoalWords: null,
    state: "kept", visibility: "members", review: "pending", reviewNote: null, position: 0, setOn: null, taskStatus: null,
    redirectTo: null, letGoReason: null, belongsToRoleId: null, ...over,
  };
}

function payer(over: Partial<Payer> = {}): Payer {
  return {
    key: "us-payer", legalName: "Example Payer", address: "1 Main St", taxId: null, country: "US", currencies: ["USD"],
    invoiceTo: "invoices@example.org", invoiceCc: [], invoicing: true, routes: ["abroad", "nomad"],
    authority: { kind: "none", date: null, routes: [], monthlyCeilingMinor: null, ceilingCurrency: null, filedWhere: null },
    queueNote: null, ...over,
  };
}

function route(over: Partial<PayRouteRecord> = {}): PayRouteRecord {
  return {
    userId: "u1", route: "abroad", payerKey: "us-payer", currency: "USD", legalName: "A Member", address: "Somewhere",
    statusValidUntil: null, taxFormKind: "form-b", taxFormSignedOn: "2026-01-01", taxFormExpiresOn: "2028-12-31",
    taxFormFiledWhere: "Finance drive", confirmedAt: "2026-11-02T00:00:00Z", confirmedBy: "u9", pilotAckVersion: "v1",
    pilotAckAt: "2026-11-02T00:00:00Z", bankChangedOn: null, bankConfirmedByRole: null, ...over,
  };
}

/** A village that has filled in its settings, with neutral example values. */
const SETTINGS: contract.MoonReviewSettings = {
  hostCountry: { code: "XX", name: "Examplia" }, hostVatRateBp: 1300, hostRateSource: "The central bank's reference rate", hostCurrency: "XXX",
  pilotAck: { text: "This pay process is a pilot.", version: "v1" },
  taxForms: [{ key: "form-a", label: "Form A" }, { key: "form-b", label: "Form B" }],
  taxFormRoutes: ["abroad", "nomad"],
  holds: [{ taxFormKey: "form-b", workCountry: "YY", note: "Form B holders who worked in YY." }],
};

function terms(over: Partial<TermsInForce> = {}): TermsInForce {
  return {
    applicationId: "sa-0000000000000001", firstSeatId: "seat-1", roleIds: ["r1"], roleNames: ["Steward"],
    settings: { v: 1, pay: { kind: "fixed", currency: "USD", amountMinor: 100_000, per: "moon" } }, deliverables: null,
    daysHeld: MOON.days, ...over,
  };
}

describe("the moon's days and endOfMoonFriday (check 1)", () => {
  it("the moon ending with the 9 November 2026 new moon runs 10 October to 8 November, and its Friday is 6 November", () => {
    expect(MOON).toEqual({ cycleId: NOV.id, firstDay: "2026-10-10", lastDay: "2026-11-08", days: 30 });
    expect(endOfMoonFriday(NOV, TZ)).toBe("2026-11-06");
  });
  it("the next moon's Friday is 4 December", () => {
    expect(endOfMoonFriday(LUNAR_CLOCK.boundsFor(new Date("2026-11-20T12:00:00Z")), TZ)).toBe("2026-12-04");
  });
  it("a calendar month reads as the month it names, and keeps the clock's own id (check 11)", () => {
    const b = CALENDAR_CLOCK.boundsFor(new Date("2026-11-15T12:00:00Z"));
    expect(moonDays(b, TZ)).toEqual({ cycleId: "month-2026-11", firstDay: "2026-11-01", lastDay: "2026-11-30", days: 30 });
    expect(MOON.cycleId).toBe(LUNAR_CLOCK.idFor(new Date("2026-11-01T12:00:00Z")));
    expect(endOfMoonFriday(b, TZ)).toBe("2026-11-27");
  });
  it("working days skip the weekend, and the deadline job reminds at 3 and 7 days and escalates at 14", () => {
    expect(addWorkingDays("2026-11-06", 5)).toBe("2026-11-13");
    expect(workDueOn("2026-11-08")).toBe("2026-11-13");
    expect(deadlineAction("2026-11-06", "2026-11-09")).toBe("remind");
    expect(deadlineAction("2026-11-06", "2026-11-10")).toBe("none");
    expect(deadlineAction("2026-11-06", "2026-11-20")).toBe("escalate");
  });
});

describe("lines from terms (checks 3 and 4)", () => {
  it("one application covering three roles makes one line carrying its pay once", () => {
    const lines = linesFromTerms([terms({ roleIds: ["r1", "r2", "r3"], roleNames: ["A", "B", "C"] })], MOON);
    expect(lines).toHaveLength(1);
    expect(lines[0].roleNames).toEqual(["A", "B", "C"]);
    expect(lines[0].amountMinor).toBe(100_000);
    expect(invoiceTotals(lines)).toEqual([{ currency: "USD", minor: 100_000 }]);
  });
  it("monthly terms prorate as amount x 12 / 365.25 x days in the moon", () => {
    const [l] = linesFromTerms([terms({ settings: { v: 1, pay: { kind: "fixed", currency: "USD", amountMinor: 300_000, per: "month" } } })], MOON);
    expect(l.basis).toBe("per_month");
    expect(l.amountMinor).toBe(Math.round((300_000 * 12 * 30) / 365.25));
    expect(l.basisLine).toContain("x 12 / 365.25 x 30 days");
  });
  it("a role held for part of the moon prorates by days held", () => {
    const [l] = linesFromTerms([terms({ daysHeld: 15 })], MOON);
    expect(l.amountMinor).toBe(50_000);
    expect(prorate(100_000, "moon", 10, 30)).toBe(33_333);
    expect(l.basisLine).toContain("held 15 of 30 days");
  });
  it("a range takes the member's proposal inside it, Finance's final over it, and nothing outside it", () => {
    const t = terms({ settings: { v: 1, pay: { kind: "range", currency: "USD", minMinor: 50_000, maxMinor: 80_000, per: "moon" } } });
    expect(linesFromTerms([t], MOON)[0].amountMinor).toBeNull();
    expect(linesFromTerms([t], MOON, { [t.applicationId]: 90_000 })[0].amountMinor).toBeNull();
    expect(linesFromTerms([t], MOON, { [t.applicationId]: 60_000 })[0].amountMinor).toBe(60_000);
    expect(linesFromTerms([t], MOON, { [t.applicationId]: 60_000 }, { [t.applicationId]: 70_000 })[0].amountMinor).toBe(70_000);
  });
  it("an allowance is its own line; honorary is listed with no cash; no amount or currency makes no line", () => {
    const lines = linesFromTerms([
      terms({ settings: { v: 1, pay: { kind: "honorary" }, allowance: { kind: "flat", currency: "USD", amountMinor: 5_000, per: "moon" } } }),
      terms({ applicationId: "sa-2", settings: { v: 1, pay: { kind: "fixed", amountMinor: 1_000 } } }),
      terms({ applicationId: "sa-3", settings: null }),
    ], MOON);
    expect(lines.map((l) => [l.key, l.basis, l.amountMinor])).toEqual([
      ["sa-0000000000000001", "listed", null],
      ["sa-0000000000000001:allowance", "allowance", 5_000],
    ]);
  });
});

describe("sends (check 7)", () => {
  const lines = linesFromTerms([terms()], MOON);
  const att = parseAttestation({ workCountries: ["us"], daysInHostCountry: 0, statusUnchanged: true }, "abroad", MOON);
  const ok = { route: "abroad" as const, payer: payer(), lines, attestation: att, pilotAckVersion: "v1", memberNumber: "INV-2026-11", externalInvoiceKey: null, settings: SETTINGS, payers: { payers: [payer()] } };
  it("a complete send passes, with a long digits-only number or key", () => {
    expect(invoiceSendRefusal(ok)).toBeNull();
    expect(invoiceSendRefusal({ ...ok, memberNumber: "0012345678901" })).toBeNull();
    expect(invoiceSendRefusal({ ...ok, route: "local_contractor", externalInvoiceKey: "50601112600310123456700100001010000000001100000001" })).toBeNull();
    expect(invoiceSendRefusal({ ...ok, route: "local_contractor", externalInvoiceKey: "50-601" })).toContain("digits only");
  });
  it.each([
    ["pending", { route: "pending" as const }, SEND_REFUSALS.pending],
    ["visitor", { route: "visitor" as const }, SEND_REFUSALS.visitor],
    ["an older pilot acknowledgement", { pilotAckVersion: "v0" }, SEND_REFUSALS.pilotAck],
    ["invoicing off", { payer: payer({ invoicing: false }) }, SEND_REFUSALS.invoicingOff],
    ["no payable line", { lines: linesFromTerms([terms({ settings: { v: 1, pay: { kind: "honorary" } } })], MOON) }, SEND_REFUSALS.noPayableLine],
    ["no acknowledgement", { pilotAckVersion: null }, SEND_REFUSALS.pilotAck],
    ["no invoice number of their own (decision 16 revised)", { memberNumber: "  " }, SEND_REFUSALS.numberMissing],
    ["an invoice number used before", { usedNumbers: ["INV-2026-11"] }, SEND_REFUSALS.numberUsed],
    ["the contractor route with no electronic key", { route: "local_contractor" as const, payer: payer({ routes: ["local_contractor"] }) }, SEND_REFUSALS.externalKey],
  ])("is refused: %s", (_n, over, sentence) => expect(invoiceSendRefusal({ ...ok, ...over })).toBe(sentence));
  it("is refused with no attestation, and with one that is not whole", () => {
    expect(invoiceSendRefusal({ ...ok, attestation: null })).toBe(contract.ATTESTATION_MISSING);
    const nomad = parseAttestation({ workCountries: ["CR"], daysInHostCountry: 30, statusUnchanged: true }, "nomad", MOON);
    expect(nomad.ok).toBe(false);
    expect(invoiceSendRefusal({ ...ok, attestation: nomad })).toContain("served people abroad");
    expect(parseAttestation({ workCountries: ["US"], daysInHostCountry: 31, statusUnchanged: true }, "abroad", MOON).ok).toBe(false);
  });
});

describe("approvals (checks 8, 9, 10)", () => {
  const keys = (userId: string, over: Partial<{ approve: boolean; pay: boolean; alone: boolean; own: boolean }> = {}) =>
    ({ userId, approve: false, pay: false, alone: false, own: false, ...over });
  const decide = (stage: "work" | "invoice", actor: ReturnType<typeof keys>, workApprovedBy: string | null = null, approveHolders = ["ops"]) =>
    approvalDecision({ stage, actor, memberUserId: "u1", workApprovedBy, approveHolders });

  it("by default nobody approves their own recap, and the two approvals are two different people", () => {
    expect(decide("work", keys("u1", { approve: true, pay: true }))).toEqual({ ok: false, refusal: contract.APPROVAL_REFUSALS.own });
    expect(decide("work", keys("ops", { approve: true }))).toEqual({ ok: true, selfApproved: false, alone: false });
    expect(decide("invoice", keys("ops", { approve: true, pay: true }), "ops")).toEqual({ ok: false, refusal: contract.APPROVAL_REFUSALS.sameApprover });
    expect(decide("invoice", keys("fin", { pay: true }), "ops")).toEqual({ ok: true, selfApproved: false, alone: false });
    expect(decide("work", keys("someone"))).toEqual({ ok: false, refusal: contract.APPROVAL_REFUSALS.noKey });
    expect(decide("invoice", keys("ops2", { approve: true }), "ops")).toEqual({ ok: false, refusal: contract.APPROVAL_REFUSALS.noKey });
  });

  it("cash.pay approves the work only when no other moon.approve holder can", () => {
    expect(decide("work", keys("fin", { pay: true })).ok).toBe(false);
    expect(decide("work", keys("fin", { pay: true }), null, ["u1"]).ok).toBe(true);
  });

  it("moon.approve_alone gives both approvals by one person, never on their own recap (decision 18)", () => {
    const steward = keys("st", { alone: true });
    expect(decide("work", steward)).toEqual({ ok: true, selfApproved: false, alone: false });
    expect(decide("invoice", steward, "st")).toEqual({ ok: true, selfApproved: false, alone: true });
    expect(decide("work", keys("u1", { alone: true, approve: true, pay: true }))).toEqual({ ok: false, refusal: contract.APPROVAL_REFUSALS.own });
  });

  it("moon.approve_own approves the holder's own recap and invoice, marked selfApproved (decision 19)", () => {
    const fin = keys("u1", { pay: true, own: true });
    expect(decide("work", fin)).toEqual({ ok: true, selfApproved: true, alone: false });
    expect(decide("invoice", fin, "u1")).toEqual({ ok: true, selfApproved: true, alone: true });
    expect(decide("invoice", keys("u1", { own: true, approve: true }), "ops")).toEqual({ ok: false, refusal: contract.APPROVAL_REFUSALS.noKey });
    expect(contract.SELF_APPROVED_WORDS).toBe("Approved by the member themselves");
  });

  it("names who can give each approval, so the Finance holder's own recap can finish", () => {
    const pool = { approve: ["ops"], pay: ["fin"], alone: ["st"], own: ["fin"] };
    expect(eligibleApprovers({ memberUserId: "fin", pool, workApprovedBy: null })).toEqual({ work: ["ops", "fin", "st"], invoice: ["fin", "st"] });
    expect(eligibleApprovers({ memberUserId: "u1", pool: { ...pool, alone: [], own: [] }, workApprovedBy: "ops" })).toEqual({ work: ["ops"], invoice: ["fin"] });
    expect(eligibleApprovers({ memberUserId: "fin", pool: { approve: ["ops"], pay: ["fin"], alone: [], own: [] }, workApprovedBy: "ops" }).invoice).toEqual([]);
  });

  it("the hash changes with any line, amount, item, route, payer or From change", async () => {
    const base: ApprovalSubject = {
      payerKey: "us-payer", route: "abroad", currency: "USD", from: { legalName: "A", address: "B" },
      lines: linesFromTerms([terms()], MOON), items: [item({})],
    };
    const h = await approvalHash(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await approvalHash({ ...base, items: [item({})] })).toBe(h);
    for (const changed of [
      { ...base, payerKey: "other" }, { ...base, route: "nomad" as const }, { ...base, from: { legalName: "A", address: "C" } },
      { ...base, lines: linesFromTerms([terms({ daysHeld: 29 })], MOON) }, { ...base, items: [item({ text: "Changed" })] },
      { ...base, items: [item({ visibility: "approvers" })] },
    ]) expect(await approvalHash(changed)).not.toBe(h);
  });
  it("Finance refuses an unconfirmed route, an ended nomad status, visitor-entry work and a tax form invalid on the expected date", () => {
    const att = { workCountries: ["YY"], daysInHostCountry: 0, statusUnchanged: true, servedAbroad: null, visitorEntryWork: false };
    const facts = { route: route(), settings: SETTINGS, attestation: att, moonLastDay: MOON.lastDay, expectedOn: "2026-11-20" };
    expect(financeApprovalRefusal({ ...facts, route: route({ taxFormKind: "form-a" }) })).toBeNull();
    expect(financeApprovalRefusal({ ...facts, route: route({ confirmedAt: null }) })).toEqual({ refusal: contract.FINANCE_REFUSALS.unconfirmed });
    expect(financeApprovalRefusal({ ...facts, route: route({ route: "nomad", statusValidUntil: "2026-11-01" }) })).toEqual({ refusal: contract.FINANCE_REFUSALS.nomadEnded });
    expect(financeApprovalRefusal({ ...facts, attestation: { ...att, visitorEntryWork: true } })).toEqual({ refusal: contract.FINANCE_REFUSALS.visitorEntry });
    expect(financeApprovalRefusal({ ...facts, route: route({ taxFormExpiresOn: "2026-11-19" }) })).toEqual({ refusal: contract.FINANCE_REFUSALS.taxForm });
    expect(financeApprovalRefusal(facts)).toEqual({ hold: `${contract.FINANCE_REFUSALS.held} Form B holders who worked in YY.` });
    expect(financeApprovalRefusal({ ...facts, settings: { ...SETTINGS, taxFormRoutes: [] }, route: route({ taxFormKind: "form-a", taxFormExpiresOn: "2026-11-19" }) })).toBeNull();
    expect(taxFormValidOn(route(), "2025-12-31")).toBe(false);
  });
  it("payer authority is a note and refuses nothing (decision 16)", () => {
    expect("authority" in contract.FINANCE_REFUSALS).toBe(false);
    expect(contract.authorityNote(payer())).toBe("No authority is recorded for this payer.");
  });
});

describe("a range Finance changes goes back to the member (decision 16 revised)", () => {
  it("names the line and the figure, and asks for a reissued invoice", () => {
    expect(contract.rangeChangedNote(["Steward"], "$700.00")).toBe("Finance set $700.00 on the line for Steward. Void your own invoice, issue a new one with this figure, and send it again with its new number.");
  });
});

describe("pay routes", () => {
  it("nobody confirms their own, and a change to a confirmed field clears confirmation", () => {
    expect(confirmRouteRefusal("u1", "u1")).toBe(contract.CONFIRM_OWN_ROUTE_REFUSED);
    expect(confirmRouteRefusal("u2", "u1")).toBeNull();
    expect(parsePayRouteInput({ route: "abroad", taxFormKind: "form-a" }).ok).toBe(false);
    const parsed = parsePayRouteInput({ route: "abroad", legalName: "A Member", address: "Somewhere", taxFormKind: "form-a" }, { taxFormKeys: ["form-a"] });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(routeChangeClearsConfirmation(parsed.value, { ...parsed.value })).toBe(false);
    expect(routeChangeClearsConfirmation(parsed.value, { ...parsed.value, address: "Elsewhere" })).toBe(true);
    expect(routeChangeClearsConfirmation(parsed.value, { ...parsed.value, taxFormFiledWhere: "a drawer" })).toBe(false);
  });
  it("refuses bank details in the legal name and address, and an unknown route", () => {
    expect(parsePayRouteInput({ route: "abroad", address: "Account 1234 5678 9012" }).ok).toBe(false);
    expect(parsePayRouteInput({ route: "salary" }).ok).toBe(false);
    expect(parsePayRouteInput({ route: "tourist" }).ok).toBe(false);
  });
});

describe("the payers document", () => {
  it("reads a payer, picks the payer for a route, and logs old and new values", () => {
    const doc = parsePayers({ payers: [{ key: "us-payer", legalName: "Example", address: "1 Main St", country: "us", currencies: ["usd"], invoiceTo: "x@example.org", invoicing: true, routes: ["abroad", "pending"] }] });
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    expect(doc.value.payers[0].routes).toEqual(["abroad"]);
    expect(payerForRoute(doc.value, "abroad", null)?.key).toBe("us-payer");
    expect(payerForRoute(doc.value, "visitor", null)).toBeNull();
    const after = { ...doc.value, payers: [{ ...doc.value.payers[0], invoicing: false }] };
    expect(payersChanges(doc.value, after)).toEqual([{ key: "us-payer", field: "invoicing", from: true, to: false }]);
  });
  it("refuses a payer with no legal name, and two payers sharing a key", () => {
    expect(parsePayers({ payers: [{ key: "a-1", address: "x", country: "US", currencies: ["USD"], invoiceTo: "x" }] }).ok).toBe(false);
    const p = { key: "a-1", legalName: "A", address: "x", country: "US", currencies: ["USD"], invoiceTo: "x" };
    expect(parsePayers({ payers: [p, p] }).ok).toBe(false);
  });
});

describe("coverage and the role audit", () => {
  const roles = [{ roleId: "r1", name: "Steward", circleId: null, accountabilities: ["Keep the water plan"], deliverables: ["Monthly report"] }];
  const goals = [{ id: "g1", words: "Investor ready" }];
  it("counts kept items per line, per season goal by id or by words, and lists Outside my roles", () => {
    const c = coverage({
      roles: [...roles, { roleId: "r2", name: "Quiet", circleId: null, accountabilities: [], deliverables: [] }],
      items: [
        item({ id: "a", accountabilityWords: "keep the WATER plan", seasonGoalId: "g1" }),
        item({ id: "b", roleId: null, seasonGoalId: "Investor ready" }),
        item({ id: "c", state: "suggested" }),
        item({ id: "d", review: "returned", accountabilityWords: "Monthly report" }),
      ],
      seasonGoals: goals, ownGoals: [], excludeReturned: true,
    });
    expect(c.roles[0].lines[0].itemIds).toEqual(["a"]);
    expect(c.roles[0].lines[1].itemIds).toEqual([]);
    expect(c.outsideMyRoles).toEqual(["b"]);
    expect(c.seasonGoals).toEqual([{ id: "g1", words: "Investor ready", count: 2 }]);
    expect(c.rolesWithNoItems).toEqual(["r2"]);
  });
  it("the role audit names only roles held, and every choice but Keep raises a tension", () => {
    expect(parseRoleAudit({ roles: [{ roleId: "rX", choice: "keep" }] }, ["r1"]).ok).toBe(false);
    const a = parseRoleAudit({ roles: [{ roleId: "r1", choice: "expand", note: "More land work" }], newRoles: [{ name: "Water keeper" }] }, ["r1"]);
    expect(a.ok && auditTensions(a.value).map((t) => t.title)).toEqual(["Expand this role", "A role that should exist: Water keeper"]);
  });
});

describe("another member's view (check 12)", () => {
  it("carries only sent, kept, Members items, counts Approvers only items, and drops Sera evidence and unseen room items", () => {
    const view = memberView({
      status: "waiting",
      roles: [{ roleId: "r1", name: "Steward" }],
      items: [
        item({ id: "keep" }),
        item({ id: "quiet", visibility: "approvers" }),
        item({ id: "sugg", state: "suggested" }),
        item({ id: "drop", state: "dropped" }),
        item({ id: "back", review: "returned", reviewNote: "Missing the report" }),
        item({ id: "sera", origin: "sera", evidenceUrl: "https://sera.example/x" }),
        item({ id: "room", origin: "room" }),
      ],
      roomVisible: () => false,
    });
    expect(view).toEqual([{
      roleId: "r1", name: "Steward", heldPrivately: 1,
      items: [
        { id: "keep", text: "Wrote the water plan", evidenceUrl: null, seasonGoalId: null },
        { id: "sera", text: "Wrote the water plan", evidenceUrl: null, seasonGoalId: null },
      ],
    }]);
    expect(memberView({ status: "draft", roles: [], items: [item({})], roomVisible: () => true })).toEqual([]);
    expect(contract.heldPrivatelyWords(1)).toBe("1 item held privately");
  });
});

describe("no hours, no quests (check 14)", () => {
  it("no origin is a quest, and no item field carries time", () => {
    expect(ITEM_ORIGINS).not.toContain("quest");
    expect(Object.keys(item({})).filter((k) => /hour|minute|duration|time/i.test(k))).toEqual([]);
    expect(Object.keys(linesFromTerms([terms()], MOON)[0]).filter((k) => /hour|minute|duration|time/i.test(k))).toEqual([]);
  });
  it("item edits keep words short and refuse payment details", () => {
    expect(parseItemFields({ text: "x".repeat(501) }).ok).toBe(false);
    expect(parseItemFields({ text: "Paid to 4111 1111 1111 1111" }).ok).toBe(false);
    expect(parseItemFields({ evidenceUrl: "javascript:alert(1)" }).ok).toBe(false);
    expect(parseItemFields({ evidenceUrl: "/sessions/abc", visibility: "approvers" })).toEqual({ ok: true, value: { evidenceUrl: "/sessions/abc", visibility: "approvers" } });
  });
  it("a Sera task keys the same whichever path finds it", () => {
    expect(itemDedupeKey("sera", "ext-1")).toBe("sera:ext-1");
    expect(itemDedupeKey("task", "t1")).toBe("task:t1");
  });
});

describe("the work summary (check 17)", () => {
  it("lists approved, invoiced items with their roles and ticked proof, and no amount", () => {
    const line = { ...linesFromTerms([terms({ roleNames: ["Steward", "Scribe"] })], MOON)[0], approvedItemIds: ["a", "b", "c"] } as InvoiceLine;
    const text = workSummaryText({
      firstDay: MOON.firstDay, lastDay: MOON.lastDay, memberNumber: "2026-001", recapId: "mr-0000000000000001",
      memberLegalName: "A Member", billToName: "Example Payer", lines: [line],
      items: [
        item({ id: "a", review: "approved", accountabilityWords: "Keep the water plan", evidenceUrl: "/docs/1", proofInSummary: true, seasonGoalId: "g1" }),
        item({ id: "b", review: "approved", text: "Hidden proof", evidenceUrl: "/docs/2" }),
        item({ id: "c", review: "returned", text: "Returned item" }),
        item({ id: "d", review: "approved", roleId: null, text: "Outside work" }),
      ],
      seasonGoals: [{ id: "g1", words: "Investor ready" }], approvedOn: "2026-11-12",
    });
    expect(text).toBe([
      "Work summary, 10 October to 8 November 2026",
      "Invoice 2026-001 · Recap mr-0000000000000001",
      "A Member, for Example Payer",
      "",
      "Steward, Scribe",
      "- Keep the water plan: Wrote the water plan (proof: /docs/1)",
      "- Deliverables: Hidden proof",
      "",
      "Season goals served: Investor ready (1)",
      "",
      "Approved by the Operations and Finance roles on 12 November 2026",
    ].join("\n"));
    expect(text).not.toMatch(/\$|USD|1,000/);
  });
});

describe("statuses, one set of words", () => {
  it("reads exactly as the spec lists them", () => {
    expect(RECAP_STATUS_WORDS).toEqual({ draft: "Draft", waiting: "Waiting on approval", returned: "Returned with a note", approved: "Approved" });
    expect(INVOICE_STATUS_WORDS.approved).toBe("Approved, waiting to be paid");
    expect(invoiceStatusLine({ status: "approved", expectedOn: "2026-11-20", paidOn: null }, "2026-11-21")).toBe("Approved, payment overdue since 20 November 2026");
    expect(invoiceStatusLine({ status: "paid", expectedOn: null, paidOn: "2026-11-22" }, "2026-11-22")).toBe("Your pay is sent on 22 November 2026");
  });
  it("an invoice is Paid only when every row it wrote is paid", () => {
    expect(invoicePaidFrom([])).toEqual({ paid: false, paidOn: null });
    expect(invoicePaidFrom([{ state: "paid", paidAt: "2026-11-20T10:00:00Z" }, { state: "claimed", paidAt: null }]).paid).toBe(false);
    expect(invoicePaidFrom([{ state: "paid", paidAt: "2026-11-20T10:00:00Z" }, { state: "paid", paidAt: "2026-11-21T10:00:00Z" }])).toEqual({ paid: true, paidOn: "2026-11-21" });
  });
});

describe("the score (decision 20, check 20)", () => {
  // The October Moon's counts, with neutral titles: 11 Done, 3 Partly and 4
  // Carry count; 4 Redirect and 7 set in the final week and not done are left
  // out. 12 and a half of 18 is 69%.
  const tasks: RecapItem[] = [];
  let n = 0;
  const add = (count: number, taskStatus: RecapItem["taskStatus"], setOn: string) => {
    for (let k = 0; k < count; k++) {
      n += 1;
      tasks.push(item({ id: `mi-${String(n).padStart(16, "0")}`, text: `Task ${n}`, dedupeKey: `task:${n}`, taskStatus, setOn }));
    }
  };
  add(11, "done", "2026-10-14");
  add(3, "partly", "2026-10-20");
  add(4, "carry", "2026-10-25");
  add(4, "redirect", "2026-10-18");
  add(4, "carry", "2026-11-05");
  add(3, "partly", "2026-11-07");

  it("scores 12 and a half of 18, which is 69%", () => {
    const s = taskScore(tasks, MOON);
    expect([s.done, s.partly, s.carry, s.numHalves, s.den, s.pct]).toEqual([11, 3, 4, 25, 18, 69]);
    expect(s.leftOut).toEqual({ letGo: 0, redirect: 4, lastWeekNotDone: 7, olderThanMoon: 0 });
    expect(scoreWords(s)).toBe("12\u00bd of 18, 69%");
  });

  it("counts a last-week task that is Done, and never a task set before the moon", () => {
    const s = taskScore([...tasks, item({ taskStatus: "done", setOn: "2026-11-08" }), item({ taskStatus: "done", setOn: "2026-10-01" })], MOON);
    expect([s.done, s.den, s.leftOut.olderThanMoon]).toEqual([12, 19, 1]);
  });

  it("seat coverage counts accountabilities with a kept item, never Outside my roles work", () => {
    const seats = [{ roleId: "r1", accountabilities: ["Keep the water plan", "Write the monthly report"] }];
    expect(seatCoverage(seats, [
      item({ accountabilityWords: "keep the water plan" }),
      item({ roleId: null, accountabilityWords: "Write the monthly report" }),
    ])).toEqual({ on: 1, total: 2, pct: 50 });
  });

  it("goal score uses the same formula; Let go and Open are left out", () => {
    const g = goalScore([{ status: "done" }, { status: "partly" }, { status: "carried" }, { status: "let_go" }, { status: "open" }]);
    expect([g.numHalves, g.den, g.pct, g.unscored]).toEqual([3, 3, 50, 1]);
  });
});

describe("goals and carrying (check 21)", () => {
  const goal = (over: Partial<MoonGoal>): MoonGoal => ({
    id: "g-1", userId: "u1", cycleId: "lunar-000331", position: 0, text: "Goal 1", doneWhen: null, seasonGoalId: null, status: "open",
    letGoReason: null, carriedFromId: null, carryCount: 0, setAt: null, scoredAt: null, ...over,
  });
  it("flags a goal carried twice, and carries every unfinished goal one count higher", () => {
    expect(carriedTooOften(goal({ carryCount: 1 }))).toBe(false);
    expect(carriedTooOften(goal({ carryCount: 2 }))).toBe(true);
    const next = carriedGoals([goal({ id: "a", status: "done" }), goal({ id: "b", status: "partly", carryCount: 1 }), goal({ id: "c", status: "let_go" })]);
    expect(next).toEqual([{ carriedFromId: "b", text: "Goal 1", doneWhen: null, seasonGoalId: null, carryCount: 2 }]);
    expect(carriedTooOften(next[0])).toBe(true);
  });
  it("refuses Let go without a reason, for a goal and for a task", () => {
    expect(goalScoreProblem("let_go", "  ")).toBe(contract.LET_GO_NEEDS_REASON);
    expect(goalScoreProblem("let_go", "No longer needed")).toBeNull();
    expect(parseItemFields({ taskStatus: "let_go", letGoReason: "" })).toEqual({ ok: false, field: "letGoReason", error: contract.LET_GO_NEEDS_REASON });
    expect(parseItemFields({ taskStatus: "redirect", redirectTo: "" }).ok).toBe(false);
  });
  it("takes three to five goals for the next moon", () => {
    const g = (k: number) => Array.from({ length: k }, (_, i) => ({ text: `Goal ${i + 1}` }));
    expect(parseMoonGoals(g(2)).ok).toBe(false);
    expect(parseMoonGoals(g(3)).ok).toBe(true);
    expect(parseMoonGoals(g(6)).ok).toBe(false);
  });
  it("rolls every Partly and Carry item into the next moon under a carry key", () => {
    expect(carriedItems([item({ id: "a", taskStatus: "partly" }), item({ id: "b", taskStatus: "done" }), item({ id: "c", taskStatus: "carry", state: "dropped" })]).map((c) => c.dedupeKey)).toEqual(["carry:a"]);
  });
});

describe("closing the loop in Sera (check 22, the pure half)", () => {
  it("closes only tasks Sera sent, by item id", () => {
    expect(seraClosures([
      item({ id: "a", dedupeKey: "sera:ext-1", taskStatus: "done" }),
      item({ id: "b", dedupeKey: "sera:ext-2", taskStatus: "redirect", redirectTo: "The land role" }),
      item({ id: "c", dedupeKey: "task:t3", taskStatus: "done" }),
      item({ id: "d", dedupeKey: "sera:ext-4", taskStatus: "carry" }),
    ], "lunar-000331")).toEqual([
      { itemId: "a", externalId: "ext-1", action: "done", note: null, idempotencyKey: "moon:lunar-000331:ext-1" },
      { itemId: "b", externalId: "ext-2", action: "redirect", note: "The land role", idempotencyKey: "moon:lunar-000331:ext-2" },
    ]);
  });
});

describe("Outside my roles in the role audit (check 23)", () => {
  it("names the role each item belongs to, and raises a Fill signal for an empty role named twice", () => {
    const audit = outsideRolesAudit({
      items: [
        item({ id: "a", roleId: null, belongsToRoleId: "r9", text: "Task A" }),
        item({ id: "b", roleId: null, belongsToRoleId: "r9", text: "Task B" }),
        item({ id: "c", roleId: null, text: "Task C" }),
        item({ id: "d", roleId: "r1", text: "Task D" }),
      ],
      heldRoleIds: ["r1"], roleNames: { r9: "Land role" }, emptyRoleIds: ["r9"],
    });
    expect(audit.items.map((i) => [i.itemId, i.belongsTo])).toEqual([["a", "Land role"], ["b", "Land role"], ["c", contract.NO_ROLE_YET]]);
    expect(audit.fill).toEqual([{ roleId: "r9", name: "Land role", count: 2 }]);
  });
});

describe("the send-by day and the copied addresses (decision 21)", () => {
  it("is the new moon day, Monday 9 November 2026, or the first all-staff on or after it", () => {
    expect(sendBy(NOV, TZ)).toBe("2026-11-09");
    expect(sendBy(NOV, TZ, 3)).toBe("2026-11-11");
    expect(sendBy(NOV, TZ, 1)).toBe("2026-11-09");
    expect(contract.sendByLine("2026-11-09")).toBe("Send by Monday 9 November 2026. Sending any time before then counts the same as sending in the room.");
  });
  it("reads invoiceCc as email addresses, and refuses anything else", () => {
    const base = { key: "a-1", legalName: "A", address: "x", country: "US", currencies: ["USD"], invoiceTo: "x@example.org" };
    const ok = parsePayers({ payers: [{ ...base, invoiceCc: ["one@example.org", "two@example.org"] }] });
    expect(ok.ok && contract.billToOf(ok.value.payers[0]).invoiceCc).toEqual(["one@example.org", "two@example.org"]);
    expect(parsePayers({ payers: [{ ...base, invoiceCc: ["not an address"] }] }).ok).toBe(false);
  });
});

describe("a fresh install names nobody (decision 22)", () => {
  it("has no payer, no address, no country and no acknowledgement, and refuses an invoice with Name who you pay", () => {
    expect(contract.EMPTY_PAYERS).toEqual({ payers: [] });
    expect(parsePayers(undefined)).toEqual({ ok: true, value: { payers: [] } });
    const fresh = contract.parseMoonReviewSettings(undefined);
    expect(fresh).toEqual({ ok: true, value: contract.EMPTY_SETTINGS });
    expect([contract.EMPTY_SETTINGS.hostCountry, contract.EMPTY_SETTINGS.pilotAck, contract.EMPTY_SETTINGS.taxForms]).toEqual([null, null, []]);
    expect(contract.setupGaps(contract.EMPTY_PAYERS, contract.EMPTY_SETTINGS)).toHaveLength(3);
    const att = parseAttestation({ workCountries: ["YY"], daysInHostCountry: 0, statusUnchanged: true }, "abroad", MOON);
    const refusal = invoiceSendRefusal({
      route: "abroad", payer: null, lines: linesFromTerms([terms()], MOON), attestation: att, pilotAckVersion: null,
      memberNumber: "INV-1", externalInvoiceKey: null, settings: contract.EMPTY_SETTINGS, payers: contract.EMPTY_PAYERS,
    });
    expect(refusal).toBe(SEND_REFUSALS.notConfigured);
    expect(refusal).toContain("Name who you pay");
  });
  it("fills every host-country template from the settings, and names no country before they are set", () => {
    expect(contract.payRouteWords("local_contractor", SETTINGS)).toBe("I live in Examplia with the right to work there, working as an independent contractor");
    expect(contract.attestationWords(SETTINGS).daysIn).toBe("Days spent in Examplia this moon");
    expect(contract.attestationWords(contract.EMPTY_SETTINGS).daysIn).toBe("Days spent in the host country this moon");
  });
  it("keeps the route kinds a closed list with neutral ids", () => {
    expect(contract.PAY_ROUTES).toEqual(["pending", "abroad", "nomad", "local_contractor", "local_employee", "visitor"]);
  });
  it("reads settings, refuses a bad acknowledgement or form key, and logs old and new values", () => {
    const s1 = contract.parseMoonReviewSettings(SETTINGS);
    expect(s1).toEqual({ ok: true, value: SETTINGS });
    expect(contract.parseMoonReviewSettings({ pilotAck: { text: "", version: "v1" } }).ok).toBe(false);
    expect(contract.parseMoonReviewSettings({ taxForms: [{ key: "much-too-long", label: "X" }] }).ok).toBe(false);
    expect(contract.settingsChanges(SETTINGS, { ...SETTINGS, pilotAck: { text: "New words.", version: "v2" } })).toEqual([
      { field: "pilotAck", from: SETTINGS.pilotAck, to: { text: "New words.", version: "v2" } },
    ]);
    expect(contract.moonReviewConfigProblem({ allStaffWeekday: 1 })).toBeNull();
    expect(contract.moonReviewConfigProblem({ allStaffWeekday: 9 })).not.toBeNull();
  });
});

describe("the moon pack (spec section 16)", () => {
  const pack = (over: Record<string, unknown> = {}) => ({
    version: 1, cycleId: "lunar-000331",
    items: [{ title: "Task 1", status: "done", sourceLink: "https://example.org/a", roleId: "r1", accountability: "Keep the water plan" }, { title: "Task 2", outsideRole: true, redirectRole: "Land role" }],
    roleAudit: { roles: [{ roleId: "r1", choice: "keep" }] }, ...over,
  });
  it("reads a pack, pasted as text or as an object", () => {
    const p = contract.parseMoonPack(JSON.stringify(pack()), "lunar-000331", ["r1"]);
    expect(p.ok && p.value.items.map((i) => [i.title, i.status, i.roleId, i.outsideRole])).toEqual([["Task 1", "done", "r1", false], ["Task 2", null, null, true]]);
  });
  it("refuses a pack that carries an amount or a route, another moon's pack, and payment details", () => {
    expect(contract.parseMoonPack(pack({ items: [{ title: "Task 1", amountMinor: 100 }] }), "lunar-000331", ["r1"])).toEqual({ ok: false, field: "pack", error: contract.PACK_WORDS.carriesMoney });
    expect(contract.parseMoonPack(pack({ payRoute: "abroad" }), "lunar-000331", ["r1"]).ok).toBe(false);
    expect(contract.parseMoonPack(pack(), "lunar-000332", ["r1"]).ok).toBe(false);
    expect(contract.parseMoonPack(pack({ items: [{ title: "Card 4111 1111 1111 1111" }] }), "lunar-000331", ["r1"]).ok).toBe(false);
  });
  it("keys an item by its source link, so the same link is skipped", () => {
    expect(contract.packItemKey("https://example.org/a", "Task 1")).toBe(contract.packItemKey("https://example.org/a", "Other words"));
    expect(contract.packItemKey("https://example.org/a", "Task 1")).not.toBe(contract.packItemKey("https://example.org/b", "Task 1"));
    expect(contract.packItemKey("https://example.org/a", "x")).toMatch(/^claude_deep_dive:link:[0-9a-f]{16}$/);
  });
});
