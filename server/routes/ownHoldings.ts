/**
 * What I would leave behind if I deleted my account.
 *
 *   GET /api/me/holdings   my balances that keep an account, and the cash still owed to me
 *
 * Rye, 2026-10-30, the fifth of the exit suggestions: the delete screen lists
 * what the member holds, says it cannot be recovered, and offers leaving the
 * village instead, which keeps their tokens. Deleting stays their legal right
 * (Costa Rica Law 8968), so this route only informs the choice and refuses
 * nothing: `POST /api/profile/delete-account` is unchanged.
 *
 * THE SAME TWO READS RESOLVE MAKES. `heldValueOf` is what keeps an account at
 * resolve, so a balance this lists is exactly one that leaving would keep, and
 * recognition, which never keeps an account, is left off the list for that
 * reason. `unpaidCashOf` is the cash the village has not paid yet, which keeps
 * an account the same way (server/lib/exitResolve.ts says why). A screen that
 * listed something leaving would not keep would be offering the wrong trade.
 *
 * THE CALLER'S OWN, AND NOBODY ELSE'S. There is no id in the path, so no
 * member can ask about another.
 *
 * IN ITS OWN MODULE, for the reason server/routes/cashOwed.ts gives: the
 * import and the register call are the only lines server/index.ts pays.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { heldValueOf } from "../lib/exitResolve";
import { unpaidCashOf } from "../lib/formerMember";

type Deps = Pick<AppDeps, "authedUser" | "getPool">;

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool } = deps;

  app.get("/api/me/holdings", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const pool = getPool();
    const id = String(user.id);
    const [held, cash] = await Promise.all([heldValueOf(pool, id), unpaidCashOf(pool, id)]);
    res.json({ held, cash });
  });
}
