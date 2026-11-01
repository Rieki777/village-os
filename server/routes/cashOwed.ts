/**
 * The cash a village owes its members, over HTTP (0285).
 *
 *   GET  /api/me/cash-owed            what I am owed, have claimed, was paid
 *   POST /api/me/cash-owed/:id/claim  I am ready to be paid this
 *   GET  /api/cash-owed/queue         the treasurer's list, for whoever holds `cash.pay`
 *   POST /api/cash-owed/:id/paid      the money went out, and this is how
 *   POST /api/cash-owed/transfers     one bank transfer paid some or all of one member's lines
 *   GET  /api/cash-owed/export.csv    every line, paid and unpaid, for the accounts
 *   GET  /api/me/cash-owed/export.csv?year=YYYY   a member's own cash received that year
 *
 * Rye, 2026-10-23: "The Game wouldn't pay cash, but it would say what they are
 * owed and they can claim it when they're paid out so that the treasurer has a
 * record to check when sending or giving cash payments." No route here moves
 * money or touches the ledger. They read and write the record of it.
 *
 * IN THEIR OWN MODULE, for the reason server/routes/redemption.ts gives:
 * server/index.ts is on a ratchet that turns one way in lines and in route
 * registrations, and a route module's import and register call are the lines
 * it exempts.
 *
 * NOT A MODULE THAT SHIPS OFF. A quest is core and so is what it pays, so a
 * village that never states cash on any work simply has nothing here: an empty
 * list for a member, and an empty queue for the treasurer.
 *
 * THE QUEUE IS ON A MEMBER PAGE, behind the key, like redemption's. A village
 * hands `cash.pay` to whoever sends the money, who is not necessarily an
 * admin; a village that hands it to nobody falls through the one gate to
 * admin. The client asks and renders nothing when the answer is no.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { recordEvent } from "../lib/events";
import { createHash } from "node:crypto";
import { cashCsv, cashExportRows, cashOwedFor, cashQueue, claimCash, markCashPaid, memberCashYearCsv, paidCashFor, recordCashTransfer } from "../lib/cashOwed";
import { CASH_PAY_REQUIRED, cashKeyRefusalWords, cashTotalsByCurrency, type CashOwedEntry, type CashQueueEntry } from "../../shared/cashOwed";
import { formatMoney } from "../../shared/money";
import { roleWithHolders } from "../../shared/roleHolderLabel";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "guardCapability" | "members" | "notify" | "overLimit"> & {
  /** Who holds `cash.pay` through a role or a badge, admins left out (`liveHoldersOf`, server/index.ts). */
  cashKeyHolders: () => Promise<string[]>;
  /** The roles whose definition carries a power (`rolesCarrying`, server/index.ts). */
  rolesCarrying: (capability: string) => Array<{ id: string; name: string }>;
  /** Every role seating (`loadRoleHolders`, server/index.ts). */
  roleHolders: () => Array<{ roleId: string; userId: string }>;
};

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, guardCapability, members, notify, overLimit, cashKeyHolders, rolesCarrying, roleHolders } = deps;

  /*
   * THE KEY'S REFUSAL, IN WORDS (E7, 2026-10-31). Left to itself the gate
   * answers a bare 401 `auth_required` to everybody, and /cash-payouts showed
   * a signed-in member that code. Signed in, they now get a 403 naming each
   * role that carries `cash.pay` with its LIVE holders' first names: a seat
   * whose term ran out is in `roleHolders` but not in `cashKeyHolders`, and
   * a role with nobody live in it is left out. Signed out, the 401 stays and
   * the page asks them to sign in. The gate still decides who passes; this
   * only words the no.
   */
  const keyRefusal = async () => {
    const live = new Set((await cashKeyHolders().catch(() => [] as string[])).map(String));
    const seats = roleHolders();
    const keepers: string[] = [];
    for (const role of rolesCarrying("cash.pay")) {
      const names: Array<string | null> = [];
      for (const s of seats) {
        if (s.roleId !== role.id || !live.has(String(s.userId))) continue;
        names.push((await members.byId(String(s.userId)).catch(() => null))?.name ?? null);
      }
      if (names.length) keepers.push(roleWithHolders(role.name, names));
    }
    return { status: 403, body: { error: CASH_PAY_REQUIRED, message: cashKeyRefusalWords(keepers) } };
  };
  const guardKey = async (req: Parameters<typeof guardCapability>[0], res: Parameters<typeof guardCapability>[1]) =>
    guardCapability(req, res, "cash.pay", (await authedUser(req)) ? await keyRefusal() : undefined);

  app.get("/api/me/cash-owed", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    res.json({
      entries: await cashOwedFor(getPool(), user.id),
      /*
       * A HINT for the client's next request, never a permission, the shape
       * redemption's `mayConfirm` has: the queue route still runs
       * `guardCapability`. It exists so an ordinary member's profile never
       * takes a 401 asking for a queue that is not theirs (ruling 28).
       */
      mayPay: user.role === "admin" || user.role === "founder"
        || (await cashKeyHolders().catch(() => [] as string[])).includes(String(user.id)),
    });
  });

  /*
   * A member's own year, for their taxes or books. Their own lines only, read
   * by their own id, so it needs no key. The file is built in server/lib.
   */
  app.get("/api/me/cash-owed/export.csv", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const year = Number(req.query.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ error: "bad_year", message: "Ask for a year, like ?year=2026." });
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="cash-received-${year}.csv"`);
    res.send(memberCashYearCsv(await paidCashFor(getPool(), user.id), year));
  });

  app.post("/api/me/cash-owed/:id/claim", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (await overLimit(`cash-claim:${user.id}`, 60, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "Too many claims at once. Try again in a while." });
    }
    const out = await claimCash(getPool(), user.id, String(req.params.id));
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    void recordEvent(getPool(), {
      kind: "audit", text: `cash:claimed:${req.params.id}`, actorUserId: user.id,
      entityType: "cash_owed", entityRef: String(req.params.id), audience: "admin",
    });
    res.json({ success: true });
  });

  /** Join each owner's and payer's name, one read per person and never one per row. */
  const nameRows = async (rows: Array<CashOwedEntry & { userId: string; paidBy: string | null }>): Promise<CashQueueEntry[]> => {
    const names = new Map<string, string>();
    const nameOf = async (id: string | null): Promise<string | null> => {
      if (!id) return null;
      if (!names.has(id)) names.set(id, String((await members.byId(id).catch(() => null))?.name ?? "A departed member"));
      return names.get(id)!;
    };
    const out: CashQueueEntry[] = [];
    for (const r of rows) {
      const { paidBy, ...entry } = r;
      out.push({ ...entry, memberName: (await nameOf(r.userId))!, paidByName: await nameOf(paidBy) });
    }
    return out;
  };

  app.get("/api/cash-owed/queue", async (req, res) => {
    if (!(await guardKey(req, res))) return;
    // The Admin "Paid" tab asks for a longer history than the profile card shows.
    const { unpaid, paid } = await cashQueue(getPool(), req.query?.history === "1" ? 1000 : 100);
    res.json({ unpaid: await nameRows(unpaid), paid: await nameRows(paid) });
  });

  /*
   * RECORD A BANK TRANSFER (Rye, 2026-10-30): some or all of one member's
   * unpaid lines become paid together, with the transfer date and reference.
   * `recordCashTransfer` says why a line can never be paid twice. The member
   * gets the same `cash_paid` notice a single line sends, once per transfer.
   */
  app.post("/api/cash-owed/transfers", async (req, res) => {
    if (!(await guardKey(req, res))) return;
    const actor = await authedUser(req);
    if (!actor) return res.status(401).json({ error: "auth_required" });
    const out = await recordCashTransfer(getPool(), String(actor.id), req.body);
    if (!out.ok) return res.status(out.status).json({ error: out.error, code: out.code });
    const ids = out.entries.map((e) => e.id).sort();
    void recordEvent(getPool(), {
      kind: "audit", text: `cash:transfer:${ids.length}:${ids.join(",")}`.slice(0, 1000), actorUserId: actor.id,
      entityType: "cash_owed", entityRef: ids[0], audience: "admin",
    });
    const totals = cashTotalsByCurrency(out.entries).map((t) => formatMoney(t.minor, t.currency)).join(" and ");
    const single = out.entries.length === 1 ? out.entries[0] : null;
    await notify({
      userId: out.userId,
      type: "cash_paid",
      title: single
        ? `The village marked your cash for ${single.workTitle} as paid`
        : `The village paid your cash for ${out.entries.length} pieces of work`,
      body: `${totals}. ${out.note}`,
      link: "/profile#cash-owed",
      actorUserId: actor.id,
      // A single line keeps the key the one-line route uses, so the two doors
      // can never notify twice for one row. A row is paid once, so a set of
      // ids is paid once, and its sorted list is a stable key.
      dedupeKey: single ? `cash:${single.id}:paid` : `cash:transfer:${createHash("sha256").update(ids.join("|")).digest("hex").slice(0, 32)}`,
    });
    res.json({ success: true, paid: out.entries.length, entries: out.entries });
  });

  /** The accounts' export: every line, paid and unpaid, as CSV. */
  app.get("/api/cash-owed/export.csv", async (req, res) => {
    if (!(await guardKey(req, res))) return;
    const rows = await nameRows(await cashExportRows(getPool()));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="cash-owed-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(cashCsv(rows));
  });

  app.post("/api/cash-owed/:id/paid", async (req, res) => {
    if (!(await guardKey(req, res))) return;
    const actor = await authedUser(req);
    if (!actor) return res.status(401).json({ error: "auth_required" });
    const id = String(req.params.id);
    const out = await markCashPaid(getPool(), id, actor.id, req.body?.note);
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    void recordEvent(getPool(), {
      kind: "audit", text: `cash:paid:${id}`, actorUserId: actor.id,
      entityType: "cash_owed", entityRef: id, audience: "admin",
    });
    await notify({
      userId: out.entry.userId,
      type: "cash_paid",
      title: `The village marked your cash for ${out.entry.workTitle} as paid`,
      body: out.entry.paidNote,
      link: "/profile#cash-owed",
      actorUserId: actor.id,
      dedupeKey: `cash:${id}:paid`,
    });
    res.json({ success: true, entry: out.entry });
  });
}
