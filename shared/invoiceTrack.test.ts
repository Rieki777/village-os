import { describe, expect, it } from "vitest";
import {
  compareDecimal,
  invoiceSubject,
  matchSeraReport,
  readSeraInvoice,
  reconcile,
  refInSubject,
  trackOf,
  type MatchCandidate,
  type SeraInvoice,
} from "./invoiceTrack";

const inv = (over: Partial<Parameters<typeof trackOf>[0]["invoice"]> = {}) => ({
  ref: "us-llc-0007", status: "waiting" as const, sentAt: "2026-11-06T10:00:00.000Z", approvedAt: null, paidOn: null, ...over,
});
const report = (over: Partial<SeraInvoice> = {}): SeraInvoice => ({
  id: "sera-1", reference: "us-llc-0007", member: "cn-otter", moon: "lunar-000328", currency: "USD", amountMinor: 120000,
  status: "received", receivedAt: "2026-11-06T10:05:00.000Z", statusAt: "2026-11-06T10:05:00.000Z", changedAt: "2026-11-06T10:05:00.000Z", ...over,
});

describe("the invoice reference in the email", () => {
  it("puts the reference in the subject in a form that reads back exactly", () => {
    const s = invoiceSubject("us-llc-0007", false);
    expect(s).toContain("[Invoice us-llc-0007]");
    expect(refInSubject(s)).toBe("us-llc-0007");
    expect(refInSubject(invoiceSubject("us-llc-0007", true))).toBe("us-llc-0007");
  });
  it("reads no reference from a subject that carries none", () => {
    expect(refInSubject("My invoice for October")).toBeNull();
  });
});

describe("the track: sent, received by Sera, approved, paid", () => {
  it("is four steps in order, each with a date and who acted", () => {
    const t = trackOf({ invoice: inv(), mail: null, report: null });
    expect(t.map((s) => s.step)).toEqual(["sent", "received", "approved", "paid"]);
    expect(t[0]).toMatchObject({ done: true, at: "2026-11-06T10:00:00.000Z", by: "member" });
    expect(t[1]).toMatchObject({ done: false, at: null, by: null });
  });
  it("marks received only from Sera's own report, never from the village's email", () => {
    const mailed = trackOf({ invoice: inv(), mail: { queuedAt: "2026-11-06T10:00:01.000Z", sentAt: "2026-11-06T10:00:02.000Z" }, report: null });
    expect(mailed[1].done).toBe(false);
    expect(mailed[0].emailedAt).toBe("2026-11-06T10:00:02.000Z");
    const got = trackOf({ invoice: inv(), mail: null, report: report() });
    expect(got[1]).toMatchObject({ done: true, at: "2026-11-06T10:05:00.000Z", by: "sera" });
  });
  it("takes approved and paid from the village's row, never from Sera's status", () => {
    const t = trackOf({ invoice: inv(), mail: null, report: report({ status: "paid" }) });
    expect(t[2].done).toBe(false);
    expect(t[3].done).toBe(false);
    const paid = trackOf({ invoice: inv({ status: "paid", approvedAt: "2026-11-07T09:00:00.000Z", paidOn: "2026-11-09" }), mail: null, report: null, paidReference: "TRX-1" });
    expect(paid[2]).toMatchObject({ done: true, by: "finance" });
    expect(paid[3]).toMatchObject({ done: true, at: "2026-11-09", by: "treasurer", note: "TRX-1" });
  });
  it("a returned invoice has not been approved even if it once was", () => {
    const t = trackOf({ invoice: inv({ status: "returned", approvedAt: null }), mail: null, report: null });
    expect(t[2].done).toBe(false);
  });
});

describe("reading Sera's record: typed fields only", () => {
  it("keeps a well-formed record and drops every field the contract does not name", () => {
    const r = readSeraInvoice({ ...report(), body: "Dear Sera, my bank is ...", note: "prose" });
    expect(r).not.toBeNull();
    expect(Object.keys(r as object).sort()).toEqual(["amountMinor", "changedAt", "currency", "id", "member", "moon", "receivedAt", "reference", "status", "statusAt"]);
  });
  it("refuses a record with a fractional or missing amount, an unknown status or a bad currency", () => {
    expect(readSeraInvoice({ ...report(), amountMinor: 10.5 })).toBeNull();
    expect(readSeraInvoice({ ...report(), amountMinor: undefined })).toBeNull();
    expect(readSeraInvoice({ ...report(), status: "lost" })).toBeNull();
    expect(readSeraInvoice({ ...report(), currency: "dollars" })).toBeNull();
    expect(readSeraInvoice({ ...report(), id: "" })).toBeNull();
  });
  it("refuses a member field that looks like an email address or a name, not a code-name", () => {
    expect(readSeraInvoice({ ...report(), member: "rye@example.org" })?.member).toBeNull();
  });
});

describe("matching a Sera record to exactly one the village invoice", () => {
  const cands: MatchCandidate[] = [
    { invoiceId: "mv-1", ref: "us-llc-0007", userId: "u1", codeName: "cn-otter", moon: "lunar-000328", currency: "USD", totalMinor: 120000 },
    { invoiceId: "mv-2", ref: "us-llc-0008", userId: "u2", codeName: "cn-heron", moon: "lunar-000328", currency: "USD", totalMinor: 90000 },
  ];
  it("matches by reference first", () => {
    expect(matchSeraReport(report(), cands)).toEqual({ kind: "matched", invoiceId: "mv-1", by: "reference" });
  });
  it("an unknown reference is unmatched, never re-matched by amount", () => {
    expect(matchSeraReport(report({ reference: "us-llc-9999" }), cands).kind).toBe("unmatched");
  });
  it("with no reference, matches on code-name, moon, currency and exact amount", () => {
    expect(matchSeraReport(report({ reference: null }), cands)).toEqual({ kind: "matched", invoiceId: "mv-1", by: "details" });
    expect(matchSeraReport(report({ reference: null, amountMinor: 120001 }), cands).kind).toBe("unmatched");
    expect(matchSeraReport(report({ reference: null, member: null }), cands).kind).toBe("unmatched");
  });
  it("two candidates is ambiguous, and nothing is attached", () => {
    const twin = [...cands, { ...cands[0], invoiceId: "mv-3", ref: "us-llc-0009" }];
    expect(matchSeraReport(report({ reference: null }), twin)).toEqual({ kind: "ambiguous", invoiceIds: ["mv-1", "mv-3"] });
  });
});

describe("exact decimal comparison", () => {
  it("compares across decimals without floating point", () => {
    expect(compareDecimal("12.50", "12.500000000000000000")).toBe(0);
    expect(compareDecimal("0.1", "0.10000000000000000001")).toBe(-1);
    expect(compareDecimal("1000000000000000000000.01", "1000000000000000000000")).toBe(1);
    expect(compareDecimal("-1", "0")).toBe(-1);
  });
});

describe("reconcile: one view, each number with its source, disagreements flagged", () => {
  const base = {
    readAt: "2026-11-06T12:00:00.000Z",
    ledger: { ok: true, readAt: "2026-11-06T12:00:00.000Z", tokens: [{ slug: "equity", name: "Equity", amount: "40.00" }], cash: [{ currency: "USD", owedMinor: 120000 }] },
    chain: { ok: true, offered: true, readAt: "2026-11-06T12:00:00.000Z", tokens: [{ slug: "equity", formatted: "40", readAt: "2026-11-06T12:00:00.000Z", stale: false }] },
    sera: { ok: true, offered: true, readAt: "2026-11-06T12:00:00.000Z" },
    invoices: [{ ref: "us-llc-0007", status: "approved" as const, currency: "USD", totalMinor: 120000, sera: { status: "approved" as const, currency: "USD", amountMinor: 120000, statusAt: "2026-11-06T11:00:00.000Z" } }],
  };
  it("agrees when every source agrees, and raises no flag", () => {
    const r = reconcile(base);
    expect(r.flags).toEqual([]);
    expect(r.tokens[0]).toMatchObject({ slug: "equity", village: "40.00", chain: "40", disagree: false });
  });
  it("flags a chain balance that differs from the ledger, by any amount", () => {
    const r = reconcile({ ...base, chain: { ...base.chain, tokens: [{ slug: "equity", formatted: "40.000000000000000001", readAt: base.readAt, stale: false }] } });
    expect(r.tokens[0].disagree).toBe(true);
    expect(r.flags).toEqual([expect.objectContaining({ kind: "chain_differs", subject: "equity", village: "40.00", other: "40.000000000000000001" })]);
  });
  it("flags Sera's amount when it differs, and keeps the village's as the figure", () => {
    const r = reconcile({ ...base, invoices: [{ ...base.invoices[0], sera: { ...base.invoices[0].sera, amountMinor: 110000 } }] });
    expect(r.invoices[0]).toMatchObject({ villageMinor: 120000, seraMinor: 110000, disagree: true });
    expect(r.flags[0]).toMatchObject({ kind: "sera_amount_differs", subject: "us-llc-0007" });
  });
  it("flags Sera's status when Sera says paid and the village does not", () => {
    const r = reconcile({ ...base, invoices: [{ ...base.invoices[0], sera: { ...base.invoices[0].sera, status: "paid" } }] });
    expect(r.flags[0]).toMatchObject({ kind: "sera_status_differs", village: "approved", other: "paid" });
  });
  it("Sera having only received an invoice the village is still waiting on is not a disagreement", () => {
    const r = reconcile({ ...base, invoices: [{ ...base.invoices[0], status: "waiting", sera: { ...base.invoices[0].sera, status: "received" } }] });
    expect(r.flags).toEqual([]);
  });
  it("a source that failed reads as not read, never zero, and raises no difference", () => {
    const r = reconcile({ ...base, chain: { ok: false, offered: true, readAt: null, tokens: [] } });
    expect(r.tokens[0]).toMatchObject({ chain: null, disagree: false });
    expect(r.sources.chain).toMatchObject({ state: "not_read" });
  });
  it("a stale chain read is shown with its instant and still compared", () => {
    const r = reconcile({ ...base, chain: { ...base.chain, tokens: [{ slug: "equity", formatted: "39", readAt: "2026-11-05T00:00:00.000Z", stale: true }] } });
    expect(r.tokens[0]).toMatchObject({ chain: "39", chainReadAt: "2026-11-05T00:00:00.000Z", chainStale: true, disagree: true });
  });
  it("Sera not offering invoices reads as not offered", () => {
    const r = reconcile({ ...base, sera: { ok: true, offered: false, readAt: null }, invoices: [{ ...base.invoices[0], sera: null }] });
    expect(r.sources.sera.state).toBe("not_offered");
    expect(r.flags).toEqual([]);
  });
  it("each flag has a stable dedupe key, so a second sync writes no second flag", () => {
    const a = reconcile({ ...base, invoices: [{ ...base.invoices[0], sera: { ...base.invoices[0].sera, amountMinor: 1 } }] });
    const b = reconcile({ ...base, readAt: "2026-11-07T00:00:00.000Z", invoices: [{ ...base.invoices[0], sera: { ...base.invoices[0].sera, amountMinor: 1 } }] });
    expect(a.flags[0].dedupeKey).toBe(b.flags[0].dedupeKey);
  });
});

describe("after the money pass: nothing hidden, nothing resolved without a fresh read", () => {
  const at = "2026-11-06T12:00:00.000Z";
  const base = {
    readAt: at,
    ledger: { ok: true, readAt: at, tokens: [{ slug: "equity", name: "Equity", amount: "40.00" }], cash: [] },
    chain: { ok: true, offered: true, readAt: at, tokens: [{ slug: "equity", formatted: "40", readAt: at, stale: false }] as Array<{ slug: string; formatted: string | null; readAt: string; stale: boolean }> },
    sera: { ok: true, offered: true, readAt: at },
    invoices: [] as Parameters<typeof reconcile>[0]["invoices"],
  };
  it("compares a token the chain holds and the ledger has no row for, as zero here", () => {
    const r = reconcile({ ...base, chain: { ...base.chain, tokens: [...base.chain.tokens, { slug: "voice", formatted: "500", readAt: at, stale: false }] } });
    expect(r.tokens.find((t) => t.slug === "voice")).toMatchObject({ village: "0", chain: "500", disagree: true });
    expect(r.flags.map((f) => f.subject)).toEqual(["voice"]);
  });
  it("a stale chain value is shown as differing but raises no flag and is not a fresh comparison", () => {
    const r = reconcile({ ...base, chain: { ...base.chain, tokens: [{ slug: "equity", formatted: "39", readAt: "2026-11-01T00:00:00.000Z", stale: true }] } });
    expect(r.tokens[0].disagree).toBe(true);
    expect(r.flags).toEqual([]);
    expect(r.compared.chain).toEqual([]);
  });
  it("a token the chain could not read is not compared", () => {
    const r = reconcile({ ...base, chain: { ...base.chain, tokens: [{ slug: "equity", formatted: null, readAt: at, stale: false }] } });
    expect(r.tokens[0]).toMatchObject({ chain: null, disagree: false });
    expect(r.compared.chain).toEqual([]);
  });
  it("names every subject it compared fresh, so only those flags may resolve", () => {
    const r = reconcile({ ...base, invoices: [{ ref: "p-0001", status: "waiting", currency: "USD", totalMinor: 1, sera: { status: "received", currency: "USD", amountMinor: 1, statusAt: at }, seraCount: 1 }] });
    expect(r.compared).toEqual({ chain: ["equity"], sera: ["p-0001"] });
  });
  it("two Sera records for one invoice is a flag", () => {
    const r = reconcile({ ...base, invoices: [{ ref: "p-0001", status: "approved", currency: "USD", totalMinor: 1, sera: { status: "approved", currency: "USD", amountMinor: 1, statusAt: at }, seraCount: 2 }] });
    expect(r.flags.map((f) => f.kind)).toEqual(["sera_duplicate"]);
  });
  it("Sera approving or paying a void invoice is a disagreement", () => {
    for (const status of ["approved", "paid"] as const) {
      const r = reconcile({ ...base, invoices: [{ ref: "p-0001", status: "void", currency: "USD", totalMinor: 1, sera: { status, currency: "USD", amountMinor: 1, statusAt: at }, seraCount: 1 }] });
      expect(r.flags.map((f) => f.kind)).toEqual(["sera_status_differs"]);
    }
  });
  it("Sera rejecting an invoice the village is still waiting on is shown", () => {
    const r = reconcile({ ...base, invoices: [{ ref: "p-0001", status: "waiting", currency: "USD", totalMinor: 1, sera: { status: "rejected", currency: "USD", amountMinor: 1, statusAt: at }, seraCount: 1 }] });
    expect(r.flags.map((f) => f.kind)).toEqual(["sera_status_differs"]);
  });
  it("a reference that names another member's invoice than the record's code-name is not attached", () => {
    const cands: MatchCandidate[] = [{ invoiceId: "mv-2", ref: "us-llc-0008", userId: "u2", codeName: "cn-heron", moon: "lunar-000328", currency: "USD", totalMinor: 90000 }];
    expect(matchSeraReport(report({ reference: "us-llc-0008", member: "cn-otter" }), cands).kind).toBe("unmatched");
    expect(matchSeraReport(report({ reference: "us-llc-0008", member: null }), cands).kind).toBe("matched");
  });
  it("normalises Sera's instants to ISO and refuses a far-future one", () => {
    expect(readSeraInvoice({ ...report(), receivedAt: "2026-11-06T12:00:00.123456789+05:30" })?.receivedAt).toBe("2026-11-06T06:30:00.123Z");
    expect(readSeraInvoice({ ...report(), receivedAt: "9999-01-01T00:00:00Z" })).toBeNull();
    expect(readSeraInvoice({ ...report(), id: "has spaces and prose" })).toBeNull();
    expect(readSeraInvoice({ ...report(), moon: "October, the month Rye invoiced" })?.moon).toBeNull();
  });
});
