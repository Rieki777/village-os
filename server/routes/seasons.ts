/**
 * THE SEASON LIST, AND THE SEATS THAT END WITH IT.
 *
 * `GET /api/season`, `GET /api/admin/seasons` and `PUT /api/admin/seasons`,
 * moved out of server/index.ts unchanged except for one thing: since 0199 a
 * save is two acts. It writes the calendar, and then it moves every seat whose
 * term is its season's end onto the calendar as it now stands
 * (`restampSeatsToCalendar`, server/lib/seatTermLanding.ts). Rye, 2026-09-14:
 * "we have a seasonal schedule set up and need to make sure these are talking."
 *
 * What the save writes is `seasonDocumentToStore`'s decision
 * (server/lib/seasonCalendar.ts), carried over from the handler this file
 * replaced: an unknown zone is refused in words, and an empty list or the
 * derived list the Season tab was shown stores `seasons: []`. A stored [] still
 * moves the seats, onto the list it derives.
 *
 * Registered at exactly the point the handlers used to sit, which keeps them
 * ahead of `/api/admin/seasons/patterns` in registration order.
 *
 * ── THE SAVE LANDS BEFORE THE SEATS MOVE, AND SAYS SO IF THEY DO NOT ────────
 *
 * The calendar and the seats are different tables with a cache between them,
 * so they cannot share a transaction. If moving the seats throws, the answer is
 * a 500 whose sentence says the season saved and the seats did not move, and
 * saving again retries: `restampsFor` answers from the calendar as it stands,
 * so a second save moves exactly what the first one missed and nothing twice.
 *
 * `PUT /api/admin/season`, the singular, used to sit beside these: the
 * single-season save from before a village could hold more than one. It was
 * kept "so nothing that still points here breaks", and nothing pointed there.
 * Two writers of one document, one of them with no door, is the shape that
 * round removed, and it stays removed.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { seasonDocumentToStore, suggestNextSeasonDates } from "../lib/seasonCalendar";
import { restampSeatsToCalendar, type RestampDeps } from "../lib/seatTermLanding";

type SeasonConfig = { seasons: any[]; cadence: string; timezone: string };

type Deps = Pick<AppDeps, "isAdmin" | "adminActor" | "getPool" | "notify"> & {
  seasonState(): any;
  getSeasonConfig(): SeasonConfig;
  seasonRepo: { put(doc: SeasonConfig): Promise<unknown> };
  addActivity(
    kind: string,
    text: string,
    extra?: { actorUserId?: string | null; entityType?: string | null; entityRef?: string | null },
  ): Promise<void>;
  loadRoles(): Array<{ id: string; name?: string }>;
  permissionHoldings: RestampDeps["permissionHoldings"];
  writePermissionTerms: RestampDeps["writePermissionTerms"];
  /** When a seat vote opened now would land (`seatVoteLandsAt`, server/lib/seatTermLanding.ts). */
  seatVoteLandsAt(): Date;
};

export function register(app: Express, deps: Deps): void {
  const { isAdmin, adminActor, getPool, notify, seasonState, getSeasonConfig, seasonRepo, addActivity, loadRoles } = deps;

  // Public: the computed season state (current picked by date, never stale),
  // and when a seat vote opened now would land, so the seat form measures a
  // voted seat's term from the same instant the vote route does.
  //
  // The forecast reads the clock and the governance dials. Every page that
  // shows the season reads this route, so a forecast that throws sends null
  // and never takes the season down with it. The form then previews from the
  // close and the vote route's own refusal still decides.
  app.get("/api/season", async (_req, res) => {
    let seatVoteLandsAt: string | null = null;
    try {
      seatVoteLandsAt = deps.seatVoteLandsAt().toISOString();
    } catch (err) {
      console.warn("[season] seat vote landing forecast failed:", (err as Error)?.message ?? err);
    }
    res.json({ ...seasonState(), seatVoteLandsAt });
  });

  // Admin: the whole season list + cadence + timezone.
  app.get("/api/admin/seasons", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const cfg = getSeasonConfig();
    const state = seasonState();
    const last = [...cfg.seasons].sort((a, b) => (a.endsOn ?? "").localeCompare(b.endsOn ?? "")).pop();
    res.json({
      ...cfg,
      currentId: state.current?.id ?? null,
      needsNextSeason: state.needsNextSeason,
      suggestion: suggestNextSeasonDates(cfg.cadence, last?.endsOn ?? ""),
    });
  });

  app.put("/api/admin/seasons", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    if (!req.body || typeof req.body !== "object") return res.status(400).json({ error: "Body required" });
    // An unknown zone is refused in words and nothing is stored (D2-8). An empty
    // list, or the derived list the Season tab was shown, stores [] so the village
    // keeps deriving (D2-9). Both rules live in server/lib/seasonCalendar.ts. The
    // seats below still move, onto whatever the stored document now derives.
    const saving = seasonDocumentToStore(req.body);
    if (!saving.ok) return res.status(400).json({ error: saving.error });
    const before = seasonState().current?.id ?? null;
    await seasonRepo.put(saving.doc);
    const after = seasonState();
    if (after.current && after.current.id !== before) {
      await addActivity("season", `The season has turned: ${after.current.name}`, { actorUserId: adminActor(req)?.id, entityType: "season" });
    }
    let seatsMoved: { permission: number; org: number };
    try {
      seatsMoved = await restampSeatsToCalendar({
        pool: getPool(),
        calendar: { seasons: after.seasons ?? [], currentSeasonId: after.current?.id ?? null, timezone: after.timezone },
        permissionHoldings: deps.permissionHoldings,
        writePermissionTerms: deps.writePermissionTerms,
        roleName: (id) => loadRoles().find((r) => r.id === id)?.name ?? id,
        notify,
      });
    } catch (e: any) {
      console.error("[seasons] the season list saved and moving its seats failed:", e?.message ?? e);
      return res.status(500).json({
        ...after,
        error: "The season list saved, and moving the seats that end with a season failed. Save again to retry moving them.",
      });
    }
    res.json({ success: true, ...after, seatsMoved });
  });
}
