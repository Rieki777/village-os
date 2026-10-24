/**
 * The cash a village owes its members, over HTTP (0285).
 *
 *   GET  /api/me/cash-owed            what I am owed, have claimed, was paid
 *   POST /api/me/cash-owed/:id/claim  I am ready to be paid this
 *   GET  /api/cash-owed/queue         the treasurer's list, for whoever holds `cash.pay`
 *   POST /api/cash-owed/:id/paid      the money went out, and this is how
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
import { cashOwedFor, cashQueue, claimCash, markCashPaid } from "../lib/cashOwed";
import type { CashQueueEntry } from "../../shared/cashOwed";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "guardCapability" | "members" | "notify" | "overLimit"> & {
  /** Who holds `cash.pay` through a role or a badge, admins left out (`liveHoldersOf`, server/index.ts). */
  cashKeyHolders: () => Promise<string[]>;
};

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, guardCapability, members, notify, overLimit, cashKeyHolders } = deps;

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

  app.get("/api/cash-owed/queue", async (req, res) => {
    if (!(await guardCapability(req, res, "cash.pay"))) return;
    const { unpaid, paid } = await cashQueue(getPool());
    // One read per person on the list, never one per row.
    const names = new Map<string, string>();
    const nameOf = async (id: string | null): Promise<string | null> => {
      if (!id) return null;
      if (!names.has(id)) names.set(id, String((await members.byId(id).catch(() => null))?.name ?? "A departed member"));
      return names.get(id)!;
    };
    const named = async (rows: typeof unpaid): Promise<CashQueueEntry[]> => {
      const out: CashQueueEntry[] = [];
      for (const r of rows) {
        const { paidBy, ...entry } = r;
        out.push({ ...entry, memberName: (await nameOf(r.userId))!, paidByName: await nameOf(paidBy) });
      }
      return out;
    };
    res.json({ unpaid: await named(unpaid), paid: await named(paid) });
  });

  app.post("/api/cash-owed/:id/paid", async (req, res) => {
    if (!(await guardCapability(req, res, "cash.pay"))) return;
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
