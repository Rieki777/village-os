/**
 * The end-of-moon review contract (shared/moonRecap.ts), with no database.
 *
 * Named checks from the build spec, section 12, that this file owns:
 *   1  endOfMoonFriday gives Friday 6 November 2026, in village time.
 *   3  three roles on one application make one line, carrying pay once.
 *   4  monthly terms prorate by days in the moon; part of a moon by days held.
 *   7  an invoice send is refused for pending, tourist, invoicing off, no
 *      payable line, a missing attestation or acknowledgement.
 *   8  two different people, neither the member (the pure half).
 *   9  any change to what an approval binds changes the hash.
 *   10 Finance approval refusals (authority is a note, decision 16).
 *   11 the cycle id matches under both clocks (moonDays keeps the clock's id).
 *   12 another member's view carries no suggested, dropped, returned or
 *      approvers-only item, and no Sera evidence (asserted on the object).
 *   14 no shape carries hours or minutes; no origin is a quest.
 *   17 the work summary lists approved, invoiced items, ticked proof, no amount.
 */
import { describe, expect, it } from "vitest";
import { CALENDAR_CLOCK, LUNAR_CLOCK } from "./cycleClock";
import {
  addWorkingDays, approvalHash, approvalPersonRefusal, auditTensions, confirmRouteRefusal, coverage, deadlineAction,
  eligibleApprovers, endOfMoonFriday, financeApprovalRefusal, INVOICE_STATUS_WORDS, invoicePaidFrom, invoiceSendRefusal,
  invoiceStatusLine, invoiceTotals, ITEM_ORIGINS, itemDedupeKey, linesFromTerms, mayApproveWork, memberView, moonDays,
  parseAttestation, parseItemFields, parsePayers, parsePayRouteInput, parseRoleAudit, payersChanges, payerForRoute,
  PILOT_ACK_VERSION, prorate, RECAP_STATUS_WORDS, routeChangeClearsConfirmation, SEND_REFUSALS, taxFormValidOn,
  workSummaryText, workDueOn, type ApprovalSubject, type InvoiceLine, type Payer, type PayRouteRecord, type RecapItem,
  type TermsInForce,
} from "./moonRecap";
import * as contract from "./moonRecap";

const TZ = "America/Costa_Rica";
const NOV = LUNAR_CLOCK.boundsFor(new Date("2026-11-01T12:00:00Z"));
const MOON = moonDays(NOV, TZ);

function item(over: Partial<RecapItem>): RecapItem {
  return {
    id: "mi-0000000000000001", origin: "task", text: "Wrote the water plan", originNote: null, doneOn: null, evidenceUrl: null,
    evidenceAsset: null, proofInSummary: false, roleId: "r1", accountabilityWords: null, seasonGoalId: null, ownGoalWords: null,
    state: "kept", visibility: "members", review: "pending", reviewNote: null, position: 0, ...over,
  };
}

function payer(over: Partial<Payer> = {}): Payer {
  return {
    key: "us-payer", legalName: "Example Payer", address: "1 Main St", taxId: null, country: "US", currencies: ["USD"],
    invoiceTo: "invoices@example.org", invoicing: true, routes: ["abroad", "nomad"],
    authority: { kind: "none", date: null, routes: [], monthlyCeilingMinor: null, ceilingCurrency: null, filedWhere: null },
    queueNote: null, ...over,
  };
}

function route(over: Partial<PayRouteRecord> = {}): PayRouteRecord {
  return {
    userId: "u1", route: "abroad", payerKey: "us-payer", currency: "USD", legalName: "A Member", address: "Somewhere",
    statusValidUntil: null, taxFormKind: "W-8BEN", taxFormSignedOn: "2026-01-01", taxFormExpiresOn: "2028-12-31",
    taxFormFiledWhere: "Finance drive", confirmedAt: "2026-11-02T00:00:00Z", confirmedBy: "u9", pilotAckVersion: PILOT_ACK_VERSION,
    pilotAckAt: "2026-11-02T00:00:00Z", bankChangedOn: null, bankConfirmedByRole: null, ...over,
  };
}

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
  const ok = { route: "abroad" as const, payer: payer(), lines, attestation: att, pilotAckVersion: PILOT_ACK_VERSION };
  it("a complete send passes", () => expect(invoiceSendRefusal(ok)).toBeNull());
  it.each([
    ["pending", { route: "pending" as const }, SEND_REFUSALS.pending],
    ["tourist", { route: "tourist" as const }, SEND_REFUSALS.tourist],
    ["invoicing off", { payer: payer({ invoicing: false }) }, SEND_REFUSALS.invoicingOff],
    ["no payable line", { lines: linesFromTerms([terms({ settings: { v: 1, pay: { kind: "honorary" } } })], MOON) }, SEND_REFUSALS.noPayableLine],
    ["no acknowledgement", { pilotAckVersion: null }, SEND_REFUSALS.pilotAck],
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
  it("nobody approves their own recap, and the two approvals are two different people", () => {
    expect(approvalPersonRefusal({ stage: "work", actorUserId: "u1", memberUserId: "u1", workApprovedBy: null })).toBe(contract.APPROVAL_REFUSALS.own);
    expect(approvalPersonRefusal({ stage: "invoice", actorUserId: "u2", memberUserId: "u1", workApprovedBy: "u2" })).toBe(contract.APPROVAL_REFUSALS.sameApprover);
    expect(approvalPersonRefusal({ stage: "invoice", actorUserId: "u3", memberUserId: "u1", workApprovedBy: "u2" })).toBeNull();
  });
  it("cash.pay approves work only when no other moon.approve holder can, so the Finance holder's own recap can finish", () => {
    expect(mayApproveWork({ actorUserId: "fin", memberUserId: "u1", actorHoldsApprove: false, actorHoldsPay: true, approveHolders: ["ops"] })).toBe(false);
    expect(mayApproveWork({ actorUserId: "fin", memberUserId: "ops", actorHoldsApprove: false, actorHoldsPay: true, approveHolders: ["ops"] })).toBe(true);
    expect(eligibleApprovers({ memberUserId: "fin", approveHolders: ["ops"], payHolders: ["fin", "fin2"], workApprovedBy: "ops" })).toEqual({ work: ["ops"], invoice: ["fin2"] });
    expect(eligibleApprovers({ memberUserId: "fin", approveHolders: ["ops"], payHolders: ["fin"], workApprovedBy: "ops" }).invoice).toEqual([]);
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
    const att = { workCountries: ["US"], daysInHostCountry: 0, statusUnchanged: true, servedAbroad: null, visitorEntryWork: false };
    const facts = { route: route(), hostCountry: "CR", attestation: att, moonLastDay: MOON.lastDay, expectedOn: "2026-11-20" };
    expect(financeApprovalRefusal({ ...facts, route: route({ taxFormKind: "W-9" }) })).toBeNull();
    expect(financeApprovalRefusal({ ...facts, route: route({ confirmedAt: null }) })).toEqual({ refusal: contract.FINANCE_REFUSALS.unconfirmed });
    expect(financeApprovalRefusal({ ...facts, route: route({ route: "nomad", statusValidUntil: "2026-11-01" }) })).toEqual({ refusal: contract.FINANCE_REFUSALS.nomadEnded });
    expect(financeApprovalRefusal({ ...facts, attestation: { ...att, visitorEntryWork: true } })).toEqual({ refusal: contract.FINANCE_REFUSALS.visitorEntry });
    expect(financeApprovalRefusal({ ...facts, route: route({ taxFormExpiresOn: "2026-11-19" }) })).toEqual({ refusal: contract.FINANCE_REFUSALS.taxForm });
    expect(financeApprovalRefusal(facts)).toEqual({ hold: contract.FINANCE_REFUSALS.w8benInUs });
    expect(taxFormValidOn(route(), "2025-12-31")).toBe(false);
  });
  it("payer authority is a note and refuses nothing (decision 16)", () => {
    expect("authority" in contract.FINANCE_REFUSALS).toBe(false);
    expect(contract.authorityNote(payer())).toBe("No authority is recorded for this payer.");
  });
});

describe("pay routes", () => {
  it("nobody confirms their own, and a change to a confirmed field clears confirmation", () => {
    expect(confirmRouteRefusal("u1", "u1")).toBe(contract.CONFIRM_OWN_ROUTE_REFUSED);
    expect(confirmRouteRefusal("u2", "u1")).toBeNull();
    const parsed = parsePayRouteInput({ route: "abroad", legalName: "A Member", address: "Somewhere", taxFormKind: "W-9" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(routeChangeClearsConfirmation(parsed.value, { ...parsed.value })).toBe(false);
    expect(routeChangeClearsConfirmation(parsed.value, { ...parsed.value, address: "Elsewhere" })).toBe(true);
    expect(routeChangeClearsConfirmation(parsed.value, { ...parsed.value, taxFormFiledWhere: "a drawer" })).toBe(false);
  });
  it("refuses bank details in the legal name and address, and an unknown route", () => {
    expect(parsePayRouteInput({ route: "abroad", address: "Account 1234 5678 9012" }).ok).toBe(false);
    expect(parsePayRouteInput({ route: "salary" }).ok).toBe(false);
  });
});

describe("the payers document", () => {
  it("reads a payer, picks the payer for a route, and logs old and new values", () => {
    const doc = parsePayers({ payers: [{ key: "us-payer", legalName: "Example", address: "1 Main St", country: "us", currencies: ["usd"], invoiceTo: "x@example.org", invoicing: true, routes: ["abroad", "pending"] }] });
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    expect(doc.value.payers[0].routes).toEqual(["abroad"]);
    expect(payerForRoute(doc.value, "abroad", null)?.key).toBe("us-payer");
    expect(payerForRoute(doc.value, "tourist", null)).toBeNull();
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
