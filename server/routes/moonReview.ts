/**
 * THE END-OF-MOON REVIEW, the approvers' doors (module moon-review, lane B).
 *
 *   GET  /api/moon-review/queue?cycle=                 moon.approve or cash.pay; amounts for cash.pay only
 *   POST /api/moon-review/:recap/work                  approve the work, or return items with a note
 *   POST /api/moon-review/:recap/return                back to the member, at either stage, with a note
 *   POST /api/moon-review/invoices/approve             Finance approval in bulk, each invoice checked alone
 *   POST /api/moon-review/invoices/:id/range           Finance sets a range; the invoice goes back to the member
 *   POST /api/moon-review/invoices/:id/void            keeps it, marked Void
 *   PUT  /api/moon-review/pay-routes/:user/confirm     cash.pay, never one's own
 *   GET  /api/moon-review/rooms/:sessionId             members joined to that room; no amounts
 *
 * Registered from server/routes/moonRecaps.ts, after the module gate is
 * mounted on `/api/moon-review`, so every door here is behind it.
 *
 * TWO QUESTIONS, ASKED IN TWO PLACES. The one gate (`mayAct`) answers whether
 * this person may open the review door at all. Whether they may GIVE an
 * approval is `approvalDecision` in shared/moonRecap.ts, fed with keys read
 * from live seats (`keyHolders`), so an admin who holds no seat carrying the
 * key passes the door and is refused the approval, in the contract's words.
 *
 * Paid is not a door here: it comes through the existing
 * `/api/cash-owed/transfers` (server/routes/cashOwed.ts).
 */
import type { Express, Request, Response } from "express";
import {
  APPROVE_ALONE_CAPABILITY, APPROVE_OWN_CAPABILITY, INVOICE_APPROVE_CAPABILITY, MOON_ROUTES, WORK_APPROVE_CAPABILITY, moonDays,
} from "../../shared/moonRecap";
import type { Capability } from "../../shared/capabilities";
import { activeClock } from "../lib/gratitude-cycles";
import { boundsForCycleId, type FrameDeps, type Moon } from "../lib/moonRecap";
import {
  approveInvoices, confirmRoute, returnToMember, reviewQueue, reviewWork, roomPanel, setRange, voidOne,
} from "../lib/moonReview";
import type { Deps as MemberDeps } from "./moonRecaps";

type Deps = MemberDeps & {
  moonFor(raw: unknown, res: Response): Promise<Moon | null>;
  nextCycleId(moon: Moon): string;
  nameOf(userId: string): Promise<string>;
  frameDeps(): FrameDeps;
};

const REVIEW_KEYS: Capability[] = [WORK_APPROVE_CAPABILITY, INVOICE_APPROVE_CAPABILITY, APPROVE_ALONE_CAPABILITY, APPROVE_OWN_CAPABILITY] as Capability[];

export function registerReviewDoors(app: Express, deps: Deps): void {
  const { authedUser, getPool, mayAct, keyHolders, notify, nameOf } = deps;
  const fail = (res: Response, out: { status: number; error: string }) => res.status(out.status).json({ error: out.error });

  /** Signed in, and the gate passes this person on at least one review key. Answers the keys it passed. */
  const reviewer = async (req: Request, res: Response): Promise<{ uid: string; cash: boolean } | null> => {
    const user = await authedUser(req);
    if (!user?.id) {
      res.status(401).json({ error: "auth_required" });
      return null;
    }
    const verdicts = await Promise.all(REVIEW_KEYS.map((k) => mayAct(req, k)));
    if (!verdicts.some((v) => v.ok)) {
      res.status(403).json({ error: "review_key_required", message: verdicts[0]?.message });
      return null;
    }
    return { uid: String(user.id), cash: verdicts[1].ok };
  };
  const reviewDeps = { keyHolders, notify, nameOf, recordEvent: async () => undefined };
  const lastDayOf = (cycleId: string): string | null => {
    const b = boundsForCycleId(activeClock(), cycleId);
    return b ? moonDays(b, deps.seasonState().timezone || "UTC").lastDay : null;
  };

  app.get(MOON_ROUTES.queue, async (req, res) => {
    const who = await reviewer(req, res);
    if (!who) return;
    const moon = await deps.moonFor((req.query as Record<string, unknown>)?.cycle ?? null, res);
    if (!moon) return;
    res.json(await reviewQueue(getPool(), moon, { userId: who.uid, cashView: who.cash }, { ...deps.frameDeps(), keyHolders, nameOf }));
  });

  app.post(MOON_ROUTES.approveInvoices, async (req, res) => {
    const who = await reviewer(req, res);
    if (!who) return;
    const out = await approveInvoices(getPool(), who.uid, req.body, { ...reviewDeps, lastDayOf });
    if (!out.ok) return fail(res, out);
    res.json(out.value);
  });

  app.post(MOON_ROUTES.setRange, async (req, res) => {
    const who = await reviewer(req, res);
    if (!who) return;
    const out = await setRange(getPool(), who.uid, String(req.params.id ?? ""), req.body, reviewDeps);
    if (!out.ok) return fail(res, out);
    res.json(out.value);
  });

  app.post(MOON_ROUTES.voidInvoice, async (req, res) => {
    const who = await reviewer(req, res);
    if (!who) return;
    const out = await voidOne(getPool(), who.uid, String(req.params.id ?? ""), req.body, reviewDeps);
    if (!out.ok) return fail(res, out);
    res.json(out.value);
  });

  app.put(MOON_ROUTES.confirmRoute, async (req, res) => {
    const who = await reviewer(req, res);
    if (!who) return;
    const out = await confirmRoute(getPool(), who.uid, String(req.params.user ?? ""), reviewDeps);
    if (!out.ok) return fail(res, out);
    res.json(out.value);
  });

  app.get(MOON_ROUTES.room, async (req, res) => {
    const user = await authedUser(req);
    if (!user?.id) return res.status(401).json({ error: "auth_required" });
    const sessionId = Number(req.params.sessionId);
    if (!Number.isInteger(sessionId) || sessionId <= 0) return res.status(404).json({ error: "not_found" });
    const moon = await deps.moonFor((req.query as Record<string, unknown>)?.cycle ?? null, res);
    if (!moon) return;
    const out = await roomPanel(getPool(), sessionId, String(user.id), moon, { ...deps.frameDeps(), nameOf, nextCycleId: deps.nextCycleId(moon) });
    if (!out.ok) return fail(res, out);
    res.json(out.value);
  });

  // The two `:recap` doors come last: Express matches in order, and `invoices` and `rooms` are no recap id.
  app.post(MOON_ROUTES.work, async (req, res) => {
    const who = await reviewer(req, res);
    if (!who) return;
    const out = await reviewWork(getPool(), who.uid, String(req.params.recap ?? ""), req.body, reviewDeps);
    if (!out.ok) return fail(res, out);
    res.json(out.value);
  });

  app.post(MOON_ROUTES.returnRecap, async (req, res) => {
    const who = await reviewer(req, res);
    if (!who) return;
    const out = await returnToMember(getPool(), who.uid, String(req.params.recap ?? ""), req.body, reviewDeps);
    if (!out.ok) return fail(res, out);
    res.json(out.value);
  });
}
