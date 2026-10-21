/**
 * Carry people across: the step after a structure change from the review is
 * published, when everyone seated on the old chart moves to a seat on the new
 * one and the old chart then retires.
 *
 *   POST /api/review/batches/:batchId/structure/carry/move     one person, one seat
 *   POST /api/review/batches/:batchId/structure/carry/retire   the retire draft, or `dryRun`
 *
 * The list itself rides on `GET /api/review/batches/:batchId/structure` as
 * `carry` (server/routes/structureReview.ts, through `carryAnswer` below), so
 * the page reads its whole state in one request.
 *
 * ── WHO MAY DO WHAT ──────────────────────────────────────────────────────
 *
 * Moving a person is seating them, so it asks exactly what the seating door
 * (`POST /api/admin/org/roles/:id/holders`) asks: `org.seat`, and
 * `org.seatAgent` as well when the holder is an agent. Who may act follows
 * who holds that power (2026-09-23): a member without it reads the list and
 * is told who holds it.
 *
 * Writing the retire draft asks `intake.moderate`, the key the review's own
 * accept asks to write a draft. Publishing it is the publish route every
 * draft goes through, unchanged.
 */
import type { Express, Request } from "express";
import type { AppDeps } from "../lib/appDeps";
import { recordEvent } from "../lib/events";
import { carryOne, publishedDraftFor, readCarry, retireEmptyOldChart, type CarryRead, type PersonOf } from "../lib/carryAcross";
import { listOrgAssignments, type OrgAssignment } from "../lib/orgChart";
import type { RepoCircle } from "../lib/structureReview";

export type CarryDeps = Pick<
  AppDeps,
  | "isAdmin"
  | "authedUser"
  | "adminActor"
  | "guardCapability"
  | "mayAct"
  | "mayStillSee"
  | "getPool"
  | "members"
  | "circlesRepo"
  | "seasonState"
  | "notify"
  | "firstName"
> & {
  /** Who holds a power live, counted the way the gate counts. `liveHoldersOf` in server/index.ts. */
  liveHoldersOf(capability: string): Promise<string[]>;
};

/** The carry list as the page reads it, with what this viewer may do. */
export interface CarryAnswer extends CarryRead {
  mayCarry: boolean;
  /** First names of whoever holds the power to seat people, when this viewer does not. */
  whoCarries: string[];
  mayRetire: boolean;
  mayPublishRetire: boolean;
}

/** First names for the people on the chart: a member by their account, anyone else by the name they were seated under. */
export async function personNamer(deps: Pick<CarryDeps, "members" | "firstName">): Promise<PersonOf> {
  let names = new Map<string, string>();
  try {
    names = new Map((await deps.members.all()).map((m: any) => [String(m.id), String(m.name ?? "")]));
  } catch {
    names = new Map();
  }
  return (a: OrgAssignment) => {
    const full = (a.userId ? names.get(a.userId) : null) || a.displayName || "";
    return deps.firstName(full) || "Someone";
  };
}

export async function carryAnswer(req: Request, deps: CarryDeps, draftId: string): Promise<CarryAnswer | null> {
  const personOf = await personNamer(deps);
  const read = await readCarry(deps.getPool(), deps.circlesRepo.all() as RepoCircle[], draftId, personOf);
  if (!read) return null;
  const [carry, moderate, admin] = await Promise.all([
    deps.mayAct(req, "org.seat"),
    deps.mayAct(req, "intake.moderate"),
    deps.isAdmin(req),
  ]);
  let whoCarries: string[] = [];
  if (!carry.ok) {
    try {
      const ids = new Set(await deps.liveHoldersOf("org.seat"));
      const all = await deps.members.all();
      whoCarries = all.filter((m: any) => ids.has(String(m.id))).map((m: any) => deps.firstName(String(m.name ?? ""))).filter(Boolean);
    } catch {
      whoCarries = [];
    }
  }
  return { ...read, mayCarry: carry.ok, whoCarries, mayRetire: moderate.ok, mayPublishRetire: admin };
}

export function register(app: Express, deps: CarryDeps): void {
  const { authedUser, adminActor, guardCapability, getPool, circlesRepo, seasonState, notify } = deps;

  const actorOf = async (req: Request): Promise<string | null> => (await authedUser(req))?.id ?? adminActor(req)?.id ?? null;

  /** Whether the person in this seating is an agent, which the seating door asks a second power for. */
  const seatsAnAgent = async (seatingId: string): Promise<boolean> =>
    !!seatingId && (await listOrgAssignments(getPool())).some((a) => a.id === seatingId && a.isAgent);

  app.post("/api/review/batches/:batchId/structure/carry/move", async (req, res) => {
    const seatingId = typeof req.body?.seatingId === "string" ? req.body.seatingId.trim() : "";
    const toSeatId = typeof req.body?.toSeatId === "string" ? req.body.toSeatId.trim() : "";
    // The seating door's gate, in its order: `org.seat`, then `org.seatAgent` for an agent.
    if (!(await guardCapability(req, res, "org.seat"))) return;
    if ((await seatsAnAgent(seatingId)) && !(await guardCapability(req, res, "org.seatAgent"))) return;
    if (!seatingId || !toSeatId) return res.status(400).json({ error: "Say who moves and to which seat." });
    const draftId = await publishedDraftFor(getPool(), String(req.params.batchId));
    if (!draftId) return res.status(404).json({ error: "This change has no published structure yet." });
    const actor = await actorOf(req);
    const season = seasonState();
    const r = await carryOne(getPool(), {
      circles: circlesRepo.all() as RepoCircle[],
      draftId,
      seatingId,
      toSeatId,
      actor,
      calendar: { seasons: season.seasons, currentSeasonId: season.current?.id ?? null, timezone: season.timezone },
      now: new Date(),
      personOf: await personNamer(deps),
    });
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    if (!r.already) {
      void recordEvent(getPool(), {
        kind: "org",
        text: "carried a holder across to the new chart",
        actorUserId: actor,
        entityType: "org_role",
        entityRef: toSeatId,
        audience: "admin",
      });
      // The seating door's notice, with the same words and the same dedupe key, because it is the same act.
      if (r.userId && r.assignmentId) {
        await notify({
          userId: r.userId,
          type: "role_appointed",
          title: `You were seated as ${r.seatName}`,
          body: r.seatAim ? String(r.seatAim).slice(0, 140) : null,
          link: "/map/circles",
          actorUserId: actor,
          dedupeKey: `org-seat:${r.assignmentId}`,
        });
      }
    }
    res.json({ success: true, already: r.already });
  });

  app.post("/api/review/batches/:batchId/structure/carry/retire", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    const actor = await actorOf(req);
    if (!actor) return res.status(401).json({ error: "auth_required", message: "Retiring the old chart needs a named person" });
    const draftId = await publishedDraftFor(getPool(), String(req.params.batchId));
    if (!draftId) return res.status(404).json({ error: "This change has no published structure yet." });
    const r = await retireEmptyOldChart(getPool(), {
      circles: circlesRepo.all() as RepoCircle[],
      draftId,
      actor,
      dryRun: req.body?.dryRun === true,
      personOf: await personNamer(deps),
    });
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    if (!r.dryRun && !r.existing && r.draftId) {
      void recordEvent(getPool(), {
        kind: "org",
        text: `the empty old chart was put in draft ${r.draftId} to retire: ${r.reads.length} change(s)`,
        actorUserId: actor,
        entityType: "draft",
        entityRef: r.draftId,
        audience: "admin",
      });
    }
    res.json({ success: true, ...r });
  });
}
