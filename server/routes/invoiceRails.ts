/**
 * The invoice rails' doors (Rye, 2026-11-06).
 *
 *   GET  /api/me/invoice-track          my invoices' tracks: sent, received by Sera, approved, paid
 *   GET  /api/me/treasury               my last synced treasury view, without calling any source
 *   POST /api/me/treasury/sync          sync it now: one a minute, read-only
 *   GET  /api/cash-owed/invoice-track   cash.pay: every live invoice's track, the open
 *                                       disagreements, and Sera records that name no invoice
 *
 * THE CALLER'S OWN. The member doors take no id, so no member can ask about
 * another; the Treasurer's door passes the one capability gate on `cash.pay`,
 * which admins pass the way they pass the payouts queue (constitution VII.9).
 *
 * Every sync and the job write an audit line. A sync never moves money or
 * tokens (server/lib/treasurySync.ts says how that is held).
 *
 * IN ITS OWN MODULE, for the reason server/routes/cashOwed.ts gives: the
 * import and the register call are the only lines server/index.ts pays.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { recordEvent } from "../lib/events";
import { registerJob } from "../lib/scheduler";
import { retryUnsentInvoiceMail, type InvoiceMailDeps } from "../lib/invoiceMail";
import { readSeraInvoices } from "../lib/seraInvoices";
import { invoiceTracksFor, syncTreasury, type TreasuryDeps, type TreasuryView } from "../lib/treasurySync";
import { membersWithInvoices, openFlags, syncViewOf, unmatchedSeraReports } from "../repos/invoiceRails";
import crypto from "node:crypto";
import type { Pool } from "mysql2/promise";
import { post, type PostOfficeDeps } from "../lib/comms/postOffice";
import { balancesFor, memberAccount, tokenDef } from "../lib/ledger";
import { unpaidCashOf } from "../lib/formerMember";
import { readOnchainBalance } from "../lib/base-reads";
import { preflight } from "../lib/saberraSync";
import { callToolJson, listTools, openSession } from "../lib/saberraClient";
import { resolveCodeName } from "../lib/codeNames";
import { linesOf, payersDoc, settingsDoc } from "../lib/moonRecap";
import { invoiceById } from "../repos/moonRecaps";
import { SUPPORT_LINE, billRef, billToOf, type InvoiceView } from "../../shared/moonRecap";
import type { SeraInvoiceClient } from "../lib/seraInvoices";

export const TREASURY_SYNC_JOB = "treasury-sync";
export const TREASURY_SYNC_EVERY_MS = 24 * 60 * 60 * 1000;
/** One manual sync per member a minute. */
export const SYNC_LIMIT = { max: 1, windowMs: 60_000 } as const;

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "guardCapability" | "overLimit" | "members"> & {
  treasury: TreasuryDeps;
  mail: InvoiceMailDeps;
  /** The member's live invoice as the member reads it, for the daily mail retry. */
  invoiceViewOf: Parameters<typeof retryUnsentInvoiceMail>[1];
};

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, guardCapability, overLimit, treasury, members: directory } = deps;
  const audit = (text: string, actorUserId: string | null) =>
    recordEvent(getPool(), { kind: "audit", text, actorUserId, actorKind: actorUserId ? "human" : "system", entityType: "treasury", entityRef: actorUserId ?? undefined, audience: "admin" });

  app.get("/api/me/invoice-track", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    // `emailsSera` says whether a send also emails the invoice, so the page can say so before the press. Never the address.
    const [tracks, inbox] = await Promise.all([invoiceTracksFor(getPool(), String(user.id)), deps.mail.seraInbox().catch(() => null)]);
    res.json({ tracks, emailsSera: !!inbox });
  });

  app.get("/api/me/treasury", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const saved = await syncViewOf(getPool(), String(user.id));
    res.json({ view: (saved?.view as TreasuryView | undefined) ?? null });
  });

  app.post("/api/me/treasury/sync", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const uid = String(user.id);
    if (await overLimit(`treasury-sync:${uid}`, SYNC_LIMIT.max, SYNC_LIMIT.windowMs)) {
      res.setHeader("Retry-After", String(Math.ceil(SYNC_LIMIT.windowMs / 1000)));
      return res.status(429).json({ error: "rate_limited", message: "You synced a moment ago. Try again in a minute." });
    }
    const view = await syncTreasury(treasury, uid, "manual");
    void audit(`treasury:synced:manual:flags-${view.flags.length}`, uid);
    res.json({ view });
  });

  app.get("/api/cash-owed/invoice-track", async (req, res) => {
    if (!(await guardCapability(req, res, "cash.pay"))) return;
    const pool = getPool();
    const members = await membersWithInvoices(pool, 500);
    const named = await Promise.all(members.map(async (m) => ({ userId: m, name: (await directory.byId(m).catch(() => null))?.name ?? null })));
    const nameOf = new Map(named.map((n) => [n.userId, n.name]));
    const tracks = (await Promise.all(members.map(async (m) => (await invoiceTracksFor(pool, m)).map((t) => ({ ...t, userId: m, memberName: nameOf.get(m) ?? null }))))).flat();
    const [flags, unmatched] = await Promise.all([openFlags(pool), unmatchedSeraReports(pool)]);
    res.json({
      tracks,
      flags: flags.map((f) => ({ id: f.id, userId: f.userId, memberName: f.userId ? (nameOf.get(f.userId) ?? null) : null, kind: f.kind, subject: f.subject, amora: f.amora, other: f.other, firstSeenAt: f.firstSeenAt, lastSeenAt: f.lastSeenAt })),
      unmatched: unmatched.map((r) => ({ seraId: r.id, reference: r.reference, moon: r.moon, currency: r.currency, amountMinor: r.amountMinor, status: r.status, receivedAt: r.receivedAt, matchState: r.matchState })),
    });
  });

  /*
   * THE DAILY SYNC. It retries invoice emails that never went out, reads
   * Sera once for the whole village, then syncs every member with a live
   * invoice. The Sync button is a manual refresh of the same thing. When the
   * contract's change notice exists, its handler calls `syncTreasury` with
   * the "notice" trigger for the member the record names.
   */
  registerJob(TREASURY_SYNC_JOB, TREASURY_SYNC_EVERY_MS, async () => {
    const pool = getPool();
    const mailed = await retryUnsentInvoiceMail(deps.mail, deps.invoiceViewOf).catch((e) => `invoice mail failed: ${e instanceof Error ? e.name : "error"}`);
    const sera = await readSeraInvoices(pool, await treasury.seraClient().catch(() => null), treasury).catch(() => ({ state: "failed" as const, why: "threw" }));
    let synced = 0;
    for (const uid of await membersWithInvoices(pool)) {
      try {
        await syncTreasury(treasury, uid, "daily", sera);
        synced++;
      } catch {
        // One member's failure never stops the rest; the next day tries again.
      }
    }
    void audit(`treasury:synced:daily:${synced}:sera-${sera.state}`, null);
    return `${mailed}; sera ${sera.state}; ${synced} members synced`;
  });
}

// ── The wiring, here so server/index.ts pays one call ────────────────────────


/** An integer of minor units as an exact decimal string at `decimals`. */
export function minorToDecimal(minor: number, decimals: number): string {
  if (!Number.isSafeInteger(minor)) throw new Error(`not an integer balance: ${minor}`);
  if (decimals <= 0) return String(minor);
  const neg = minor < 0;
  const digits = String(Math.abs(minor)).padStart(decimals + 1, "0");
  return `${neg ? "-" : ""}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}

export interface WiringInput {
  getPool(): Pool;
  postOffice: PostOfficeDeps;
  projectName(): string;
  memberById(id: string): Promise<{ walletAddress?: string | null; walletVerifiedAt?: string | null } | null>;
  boolVar(key: string): boolean;
  stringVar(key: string): string;
}

/** The two sync and mail dependency sets, and the retry's invoice reader, from the server's own pieces. */
export function invoiceRailsDeps(w: WiringInput): Pick<Deps, "treasury" | "mail" | "invoiceViewOf"> {
  const seraClient = async (): Promise<SeraInvoiceClient | null> => {
    const pre = preflight();
    if (!pre.ok) return null;
    const session = await openSession(pre.client);
    if (!session) return null;
    return {
      toolNames: async () => {
        const t = await listTools(pre.client, session);
        return t.ok ? { ok: true, names: t.tools.map((x) => x.name) } : { ok: false, why: t.why };
      },
      list: async (args) => {
        const r = await callToolJson(pre.client, session, "list_invoices", args);
        return r.ok ? r : { ok: false, why: r.why };
      },
    };
  };
  const treasury: TreasuryDeps = {
    getPool: w.getPool,
    ledgerTokens: async (uid) =>
      Object.entries(await balancesFor(w.getPool(), memberAccount(uid))).map(([slug, minor]) => ({
        slug, name: tokenDef(slug)?.name ?? slug, amount: minorToDecimal(Number(minor), tokenDef(slug)?.decimals ?? 0),
      })),
    cashOwed: async (uid) => (await unpaidCashOf(w.getPool(), uid)).map((c) => ({ currency: c.currency, owedMinor: c.amountMinor })),
    chain: async (uid) => {
      const m = await w.memberById(uid);
      const contracts = [
        { slug: "equity", address: w.stringVar("tokens.equity_address").trim() },
        { slug: "voice", address: w.stringVar("tokens.voice_address").trim() },
      ].filter((c) => c.address);
      if (!w.boolVar("tokens.show_economics_section") || !m?.walletVerifiedAt || !m.walletAddress || contracts.length === 0) return { offered: false, tokens: [] };
      const tokens = [];
      for (const c of contracts) {
        const b = await readOnchainBalance(w.getPool(), { userId: uid, walletAddress: m.walletAddress, tokenSlug: c.slug, contractAddress: c.address });
        if (b) tokens.push({ slug: c.slug, formatted: b.formatted, readAt: b.fetchedAt, stale: b.stale });
      }
      return { offered: true, tokens };
    },
    seraClient,
    resolveCodeName: (code) => resolveCodeName(w.getPool(), code),
    now: () => new Date(),
    newId: () => `tsf-${crypto.randomUUID()}`,
  };
  const mail: InvoiceMailDeps = {
    getPool: w.getPool,
    post: (e) => post(w.postOffice, e),
    seraInbox: async () => (await settingsDoc(w.getPool())).seraInbox,
    projectName: w.projectName,
    audit: (text, userId) => recordEvent(w.getPool(), { kind: "audit", text, actorUserId: userId, entityType: "invoice", audience: "admin" }),
  };
  /** The stored row as the PDF needs it: the same figures and parties the send carried. */
  const invoiceViewOf = async (invoiceId: string, userId: string): Promise<InvoiceView | null> => {
    const row = await invoiceById(w.getPool(), invoiceId);
    if (!row || row.userId !== userId) return null;
    const payer = (await payersDoc(w.getPool())).payers.find((p) => p.key === row.payerKey) ?? null;
    let from: InvoiceView["from"] = null;
    try {
      from = row.fromJson ? (JSON.parse(row.fromJson) as InvoiceView["from"]) : null;
    } catch {
      from = null;
    }
    return {
      id: row.id, status: row.status, statusLine: "", memberNumber: row.memberNumber, billRef: billRef(row.payerKey, row.billRefSeq), billTo: payer ? billToOf(payer) : null,
      from, period: row.cycleId, lines: linesOf(row), currency: row.currency, totalMinor: row.totalMinor, expectedOn: row.expectedOn, paidOn: row.paidOn,
      selfApproved: row.selfApproved, supportLine: SUPPORT_LINE, externalInvoiceKey: row.externalInvoiceKey, workSummary: null, workSummaryHtml: null, sendRefusal: null,
    };
  };
  return { treasury, mail, invoiceViewOf };
}
