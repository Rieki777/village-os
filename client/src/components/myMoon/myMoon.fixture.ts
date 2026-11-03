/**
 * One invented member's moon, for the component tests. Every person, role
 * and amount here is made up.
 */
import {
  EMPTY_SETTINGS,
  attestationWords,
  type InvoiceView,
  type RecapItem,
  type RoleHeld,
} from "@shared/moonRecap";
import type { MyMoonData } from "./moonApi";

export function item(over: Partial<RecapItem> = {}): RecapItem {
  return {
    id: "mi-0000000000000001",
    origin: "task",
    dedupeKey: "task:1",
    text: "Mapped the seed bank shelves",
    originNote: null,
    doneOn: "2026-10-20",
    evidenceUrl: null,
    evidenceAsset: null,
    proofInSummary: false,
    roleId: "role-seeds",
    accountabilityWords: "Keep the seed bank in order",
    seasonGoalId: "g-1",
    ownGoalWords: null,
    state: "kept",
    visibility: "members",
    review: "pending",
    reviewNote: null,
    position: 0,
    setOn: "2026-10-12",
    taskStatus: "done",
    redirectTo: null,
    letGoReason: null,
    belongsToRoleId: null,
    evidenceKind: null,
    evidenceOn: null,
    belongsToSeatWords: null,
    ...over,
  };
}

export const ROLES: RoleHeld[] = [
  { roleId: "role-seeds", name: "Seed keeper", circleId: null, accountabilities: ["Keep the seed bank in order"], deliverables: [], applicationId: "app-1", daysHeld: 30 },
];

export function invoice(over: Partial<InvoiceView> = {}): InvoiceView {
  return {
    id: null,
    status: "draft",
    statusLine: "Draft",
    memberNumber: null,
    billRef: null,
    billTo: { payerKey: "payer-one", legalName: "Example Payer Ltd", address: "1 Example Road", taxId: null, invoiceTo: "invoices@example.org", invoiceCc: ["copy@example.org"] },
    from: null,
    period: "10 October to 8 November 2026",
    lines: [{
      key: "app-1", applicationId: "app-1", firstSeatId: "seat-1", kind: "pay", roleIds: ["role-seeds"], roleNames: ["Seed keeper"], basis: "per_moon", listedAs: null,
      currency: "USD", termsMinor: 123456, per: "moon", range: null, proposedMinor: null, finalMinor: null, daysInMoon: 30, daysHeld: 30, amountMinor: 123456,
      basisLine: "US$1,234.56 per moon", approvedItemIds: [], cashOwedId: null, held: false, // village-ok: test fixture data, never shown to a member
    }],
    currency: "USD",
    totalMinor: 123456,
    expectedOn: null,
    paidOn: null,
    selfApproved: false,
    supportLine: "",
    externalInvoiceKey: null,
    workSummary: null,
    workSummaryHtml: null,
    sendRefusal: null,
    ...over,
  };
}

export function myMoon(over: Partial<MyMoonData> = {}): MyMoonData {
  const items = [item()];
  return {
    moon: { cycleId: "lunar-2026-10", firstDay: "2026-10-10", lastDay: "2026-11-08", periodWords: "10 October to 8 November 2026", endOfMoonFriday: "2026-11-05", sendBy: "2026-11-09", halfwayDay: "2026-10-25" },
    moons: [{ cycleId: "lunar-2026-10", periodWords: "10 October to 8 November 2026", status: "draft", statusWords: "Draft" }],
    recap: null,
    items,
    roles: ROLES,
    coverage: {
      roles: [{ roleId: "role-seeds", name: "Seed keeper", lines: [{ words: "Keep the seed bank in order", kind: "accountability", itemIds: [items[0].id] }], untagged: [], itemCount: 1 }],
      outsideMyRoles: [],
      seasonGoals: [{ id: "g-1", words: "Grow our own food", count: 1 }],
      ownGoals: [],
      rolesWithNoItems: [],
    },
    seasonGoals: [{ id: "g-1", words: "Grow our own food" }],
    ownGoals: [],
    moonLoad: 3,
    taskScore: { numHalves: 2, den: 1, pct: 100, done: 1, partly: 0, carry: 0, leftOut: { letGo: 0, redirect: 0, lastWeekNotDone: 0, olderThanMoon: 0 } },
    taskReading: { band: "very_full", label: "Very full", says: "You finished nearly everything you set.", lines: [], capped: false },
    seatReading: { band: "well_held", label: "Role well held", says: "Nearly every accountability had work under it.", lines: [], capped: false },
    seatCoverage: { on: 1, total: 1, pct: 100 },
    lastMoonGoals: [],
    goalScore: { numHalves: 0, den: 0, pct: null, unscored: 0 },
    nextMoonGoals: [],
    backlog: [],
    outsideRoles: { items: [], fill: [] },
    invoiceNeeded: true,
    noTermsLine: null,
    invoice: invoice(),
    payRoute: null,
    routeChoices: [{ route: "pending", words: "Not chosen yet" }, { route: "abroad", words: "I live outside the host country" }],
    pilotAck: null,
    setupGaps: [],
    attestationWords: attestationWords(EMPTY_SETTINGS),
    cashPayHolders: ["Finance holder"],
    ...over,
  };
}
