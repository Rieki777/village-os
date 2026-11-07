/**
 * THE AMENDMENT HISTORY: every change to the rules, newest first, and every
 * setting's own history (change requests, Rye 2026-11-06, 3g: "a per-setting
 * history: who changed it, when and why, with a link to the vote").
 *
 *   GET /api/game/mechanics/history            every change
 *   GET /api/game/mechanics/history?key=<key>  one setting's changes
 *
 * Public, as it always was: the record of what the village changed belongs to
 * anyone who asks. What a stranger may read of a row's VALUES is decided in
 * server/lib/mechanicsHistory.ts (`publicAmendment`), unchanged.
 *
 * WHO, BY III.2. Rye, 2026-10-30: name the role first, with the holder's first
 * name in parentheses, in signed-in live views only, read from the roster when
 * the view renders. Anyone not signed in reads the role alone, or "A member".
 * This feed used to print the actor's first name to strangers.
 *
 * WHY. A governed change stores `gm:<proposal id> bal:<ballot id>` in
 * `proposal_ref` (server/lib/changeset.ts). The proposal's title is the reason
 * the village gave, and proposals are public, so the row carries it with the
 * ballot that decided it.
 *
 * Moved out of server/index.ts with this change, which is the file the size
 * ratchet exists to shrink.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { VARIABLES_BY_KEY } from "../../shared/gameVariables";
import { holderFirstName } from "../../shared/roleHolderLabel";
import { publicAmendment } from "../lib/mechanicsHistory";
import { rolesHeldBy } from "../repos/companions";
import { amendmentRows, proposalTitles } from "../repos/mechanicsHistory";

/** The longest key `mechanics_changes.config_key` can hold. */
const KEY_MAX = 191;

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "members" | "firstName"> & {
  /** The names of the live roles a member holds now. Injected for the tests. */
  rolesOf?: (userId: string) => Promise<string[]>;
};

export interface ActorInput {
  signedIn: boolean;
  /** The member's display name, or null when the account is gone. */
  name: string | null;
  /** The live roles they hold now. */
  roles: readonly string[];
}

/** How a history row names who made the change (III.2). */
export function actorLabel(input: ActorInput): string {
  if (input.name === null) return "A departed member";
  const roles = input.roles.map((r) => String(r).trim()).filter(Boolean);
  if (!input.signedIn) return roles.length ? roles.join(", ") : "A member";
  const first = holderFirstName(input.name);
  if (roles.length === 0) return first || "A member";
  return first ? `${roles.join(", ")} (${first})` : roles.join(", ");
}

/** The proposal a stored reference names (`gm:<id>`), or null. */
export function proposalIdIn(ref: string | null | undefined): string | null {
  const m = /(?:^|\s)gm:([^\s,;]+)/.exec(String(ref ?? ""));
  return m ? m[1] : null;
}

/** The ballot a stored reference names (`bal:<id>`), or null. */
function ballotIdIn(ref: string | null | undefined): string | null {
  const m = /(?:^|\s)bal:([^\s,;]+)/.exec(String(ref ?? ""));
  return m ? m[1] : null;
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, members } = deps;
  const rolesOf = deps.rolesOf ?? (async (id: string) => (await rolesHeldBy(getPool(), id)).map((r) => r.name));

  app.get("/api/game/mechanics/history", async (req, res) => {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 200));
    const key = typeof req.query.key === "string" ? req.query.key.trim() : "";
    if (key.length > KEY_MAX) return res.status(400).json({ error: "That is not a setting this village has" });
    const viewer = await authedUser(req).catch(() => null);
    const signedIn = !!viewer;
    const rows = await amendmentRows(getPool(), key || null, limit);
    const names = new Map<string, string>();
    for (const r of rows) {
      const id = r.actor_user_id ? String(r.actor_user_id) : "";
      if (!id || names.has(id)) continue;
      const member = await members.byId(id);
      const roles = member ? await rolesOf(id) : [];
      names.set(id, actorLabel({ signedIn, name: member ? String(member.name ?? "") : null, roles }));
    }
    const ids = Array.from(new Set(rows.map((r) => proposalIdIn(r.proposal_ref)).filter((x): x is string => !!x)));
    const titles = await proposalTitles(getPool(), ids);
    res.json(
      rows.map((r) => {
        const pid = proposalIdIn(r.proposal_ref);
        return {
          ...publicAmendment(r, VARIABLES_BY_KEY[String(r.config_key)], r.actor_user_id ? names.get(String(r.actor_user_id)) ?? null : null),
          proposal: pid && titles.has(pid) ? { id: pid, title: titles.get(pid)!, ballotId: ballotIdIn(r.proposal_ref) } : null,
        };
      }),
    );
  });
}
