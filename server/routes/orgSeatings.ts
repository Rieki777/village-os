/**
 * Ending a seating, and forgetting the person who held it.
 *
 * Two routes, lifted out of server/index.ts unchanged:
 *
 *   DELETE /api/admin/org/seatings/:id         end a live holding
 *   POST   /api/admin/org/seatings/:id/forget  take a documented name off
 *                                              every seat it appears on
 *
 * THE TWO DOORS ARE GATED DIFFERENTLY, ON PURPOSE, and the difference
 * survives the move unchanged. Ending a seating is `org.seat`, so a village
 * that has handed that key out can end its own holdings through the one gate.
 * Forgetting a holder is `isAdmin`, because deciding that two recorded names
 * are one person is a judgement, and the file's own comment below says why a
 * human stays in that loop.
 *
 * WHY THE REST OF THE ORG SURFACE IS STILL IN server/index.ts. The seat
 * lifecycle (claim, seat, release, the chart itself) reaches the capability
 * context and the org caches. These two reach `endSeating` and
 * `forgetDocumentedHolder` in server/lib/orgChart.ts and nothing else, which
 * is what made them separable first. A later lane taking the rest can fold
 * this file into it.
 *
 * ONE INLINE QUERY, against `org_role_assignments`, which is the table this
 * domain owns. It reads the seating before ending it so the journal line can
 * name the seat. That is why `getPool` is in the slice.
 *
 * REGISTERED WHERE IT WAS, because Express matches in registration order.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { recordEvent } from "../lib/events";
import { EXAMPLE_REFUSAL_BODY, isExampleRow } from "../lib/examples";
import { endSeating, forgetDocumentedHolder } from "../lib/orgChart";
import { raiseRevokeTasks } from "../lib/roleAccess";

type Deps = Pick<AppDeps, "isAdmin" | "authedUser" | "guardCapability" | "adminActor" | "getPool" | "notify" | "notifyAdmins">;

export function register(app: Express, deps: Deps): void {
  const { isAdmin, authedUser, guardCapability, adminActor, getPool, notify, notifyAdmins } = deps;

  app.delete("/api/admin/org/seatings/:id", async (req, res) => {
    if (!(await guardCapability(req, res, "org.seat"))) return;
    // The `/forget` sibling below has refused example rows since it shipped and
    // this door did not, which mattered the moment either got a button: ending
    // a standing example's seating empties the demo chart with no tombstone
    // stamped, so the banner keeps promising holders who are gone.
    if (await isExampleRow(getPool(), "org_role_assignments", req.params.id)) {
      return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    }
    // Read the seating BEFORE ending it, so the journal entry can name which
    // seat it was against. Afterwards the row is history and the route only
    // has an id.
    const [[before]] = await getPool().query<any[]>(
      "SELECT org_role_id FROM org_role_assignments WHERE id = ? AND ended_at IS NULL",
      [req.params.id],
    );
    const reason = String(req.body?.reason ?? "") || undefined;
    const ok = await endSeating(getPool(), req.params.id, reason);
    if (!ok) return res.status(404).json({ error: "No live seating with that id" });
    if (before?.org_role_id) {
      void recordEvent(getPool(), {
        kind: "org",
        text: reason ? `a holding ended: ${reason}` : "a holding ended",
        actorUserId: (await authedUser(req))?.id ?? null,
        entityType: "org_role", entityRef: String(before.org_role_id),
        // A reason is an admin's own words and can name the person, so it stays admin (R103).
        audience: reason ? "admin" : "public",
      });
    }
    res.json({ success: true });
  });

  /**
   * Forget a documented holder: end every seat recorded under their name, and
   * take the name off all of them, past seats included.
   *
   * A member asks for this themselves and `anonymizeMember` does it. A
   * documented holder has no account to delete, and nothing joins their name
   * to a user row, so nothing in the codebase ever scrubbed it. That is the
   * worse half of the same defect: `display_name` is often somebody who never
   * signed up for anything here, and `/api/org` publishes it to every member
   * holding `map.viewPeople`.
   *
   * Admin-only and one seating id in, because deciding that two recorded
   * names are one person is the judgement the seat-claim flow keeps a human
   * in the loop for. Ending is the same act as above, so the seat keeps its
   * history and its count; only the person goes.
   */
  app.post("/api/admin/org/seatings/:id/forget", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    if (await isExampleRow(getPool(), "org_role_assignments", req.params.id)) {
      return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    }
    const r = await forgetDocumentedHolder(
      getPool(),
      req.params.id,
      String(req.body?.reason ?? "") || "forgotten at their request",
    );
    if (!r.found) return res.status(404).json({ error: "No documented seating with that id" });
    await recordEvent(getPool(), {
      kind: "audit",
      text: "org:holder-forgotten",
      actorUserId: (await authedUser(req))?.id ?? adminActor(req)?.id ?? null,
      entityType: "org_role_assignment",
      entityRef: req.params.id,
      audience: "admin",
    });
    res.json({ success: true, seatings: r.seatings });
  });
}
