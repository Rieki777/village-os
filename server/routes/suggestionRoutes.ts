/**
 * THE DIAL: WHERE SUGGESTIONS ON EACH POWER GO (ROLE_POWERS_DESIGN.md §4.5).
 *
 *   GET /api/admin/suggestion-routes   the village's table, what it stored, and its version
 *   PUT /api/admin/suggestion-routes   { routes: { <power>: "holders" | "ballot" } }, the whole set
 *
 * A suggestion goes to the holders of its power, or to a village vote
 * (`routeSuggestion`, shared/suggestions.ts). An entry set to "ballot" here
 * sends every suggestion on that power to a vote even while a role holds it.
 * "holders" leaves the routing rule to decide, and the rule still sends a
 * suggestion to a vote when the village holds the power or nobody does. The
 * steward's veto is "ballot" whatever is sent: the PUT refuses it, and the
 * reader forces it.
 *
 * ── WHO MAY TURN IT ────────────────────────────────────────────────────────
 *
 * Holders of `power.assign` (Rye, 2026-11-01, §4.5), holder-only: an admin who
 * was never given it is refused while anybody holds it
 * (server/lib/holderOnly.ts), and acts as the operator while nobody does. When
 * the VILLAGE holds `power.assign`, nobody turns it alone: the refusal names
 * `suggestion_routes`, the admin control a member suggests a change to, and
 * the suggestion becomes a village ballot whose closer applies it through
 * `applySuggestionRoutesEdit` below (Rye, 2026-11-06: no action without a
 * vote path).
 *
 * Reading is for members: the Powers board shows each power's route in
 * words, and §4.5 opens the structure of the admin panel to every member.
 *
 * A SAVE NAMES THE TABLE IT WAS OPENED ON, `x-content-was`, the way the paths
 * editor does, so two holders cannot write over each other.
 *
 * A NEW MODULE, NOT A NEW LINE IN server/index.ts: route modules are free on
 * the index ratchet by construction.
 */
import type { Express } from "express";
import type { Pool } from "mysql2/promise";
import { recordEvent } from "../lib/events";
import { leftTheVillage } from "../lib/formerMember";
import { markAdminGate } from "../lib/adminGate";
import { registerAdminEditControl } from "../lib/adminSuggestions";
import { saveSuggestionRoutes, storedSuggestionRoutes, villageSuggestionRoutes } from "../lib/suggestionRoutes";
import { makePowerAssignGate, type PowerAssignGateDeps } from "./seatPowerGroups";
import { contentVersion } from "../../shared/pageContent/resolve";
import { SUGGESTION_ROUTE, storableSuggestionRoutes, suggestionRoutesProblems, type SuggestionRoutesDocument } from "../../shared/suggestions";

export { loadSuggestionRoutes, villageSuggestionRoutes } from "../lib/suggestionRoutes";

interface Deps extends PowerAssignGateDeps {
  getPool(): Pool;
  /** Has this account left the village. Defaults to `leftTheVillage`. */
  isFormerMember?(user: any): Promise<boolean>;
}

/** The member rung: "All members" means `member` and up (§4.5). */
const MEMBER_RUNG = "member";

export function register(app: Express, deps: Deps): void {
  const { authedUser, capabilityCtx, getPool } = deps;
  const powerAssignGate = makePowerAssignGate(deps);
  const isFormer = deps.isFormerMember ?? ((user: any) => leftTheVillage(getPool(), user));

  const view = () => {
    const stored = storedSuggestionRoutes();
    return { routes: villageSuggestionRoutes(), defaults: SUGGESTION_ROUTE, stored, version: contentVersion(stored) };
  };

  app.get("/api/admin/suggestion-routes", async (req, res) => {
    markAdminGate(req); // a gate is consulted here: the default-deny under /api/admin needs to hear it
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (await isFormer(user)) return res.status(403).json({ error: "former_member", message: "The admin panel is for members of the village." });
    const ctx = await capabilityCtx(user);
    const needed = ctx.stageIndexOf(MEMBER_RUNG);
    if (!ctx.isAdmin && (needed < 0 || ctx.stageIndex < needed)) {
      return res.status(403).json({ error: "members_only", message: "The admin panel opens at the member rung." });
    }
    res.json(view());
  });

  app.put("/api/admin/suggestion-routes", async (req, res) => {
    const may = await powerAssignGate(req);
    if (!may.actor) return res.status(401).json({ error: "auth_required" });
    if (!may.ok) {
      const body: Record<string, unknown> = { ...may.body };
      // The village holds the power: the change goes to the village, as a suggestion it votes on.
      if (may.body.code === "village_holds_it") body.suggestInstead = "suggestion_routes";
      return res.status(may.status).json(body);
    }
    const before = villageSuggestionRoutes();
    const r = await applySuggestionRoutesEdit(req.body, req.get?.("x-content-was"));
    if (!r.ok) return res.status(r.status).json(r.body);
    const after = villageSuggestionRoutes();
    const moved = (Object.keys(after) as Array<keyof typeof after>).filter((cap) => before[cap] !== after[cap]);
    if (moved.length) {
      void recordEvent(getPool(), {
        kind: "audit",
        text: `suggestion_routes:${moved.map((cap) => `${cap}=${after[cap]}`).join("|")}:${may.via}`,
        actorUserId: may.actor?.id ?? null,
        entityType: "suggestion_routes",
        entityRef: "village",
        audience: "admin",
      });
    }
    res.json(view());
  });

  // A member's suggested change to the table is accepted through the same
  // write (server/lib/adminSuggestions.ts): by a `power.assign` holder after
  // the gate, or by a carried village vote when the village holds the power.
  registerAdminEditControl("suggestion_routes", {
    read: () => ({ value: storedSuggestionRoutes(), version: contentVersion(storedSuggestionRoutes()) }),
    problem: (payload) => suggestionRoutesProblems(payload)[0] ?? null,
    apply: (payload, was) => applySuggestionRoutesEdit(payload, was),
  });
}

/**
 * THE WRITE, for the route and for an accepted suggestion alike: checked
 * against `suggestionRoutesProblems`, refused when the stored table moved
 * since `was`, then saved as the entries that differ from the default. The
 * caller has already asked the gate, or is a carried vote.
 */
export async function applySuggestionRoutesEdit(
  body: unknown,
  was: string | undefined,
): Promise<{ ok: true } | { ok: false; status: number; body: Record<string, unknown> }> {
  const problems = suggestionRoutesProblems(body);
  if (problems.length) return { ok: false, status: 400, body: { error: problems[0], problems } };
  if (was && was !== contentVersion(storedSuggestionRoutes())) {
    return { ok: false, status: 409, body: { error: "These routes changed since this page was opened. Reload it to see them, then make your change again." } };
  }
  await saveSuggestionRoutes(storableSuggestionRoutes(body as SuggestionRoutesDocument));
  return { ok: true };
}
