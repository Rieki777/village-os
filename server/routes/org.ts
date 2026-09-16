/**
 * The org chart: links, structural drafts, seat history, and the admin edits.
 *
 * Twenty routes. Nineteen were lifted out of server/index.ts unchanged and
 * are grouped as they were grouped there, because they were already one
 * contiguous run. The twentieth is marked below and is the only one that was
 * not a move:
 *
 *   links       GET  /api/org/relations
 *               GET  /api/org/:kind/:id/relations
 *               POST /api/admin/org/relations
 *               DELETE /api/admin/org/relations/:id
 *   drafts      GET  /api/admin/org/drafts
 *               POST /api/admin/org/drafts
 *               POST /api/admin/org/drafts/:id/changes
 *               GET  /api/admin/org/drafts/:id/preview
 *               PUT  /api/admin/org/drafts/:id/vision
 *               POST /api/admin/org/drafts/:id/publish
 *               POST /api/admin/org/drafts/:id/revert
 *   terms       GET  /api/admin/org/expiring
 *   history     GET  /api/org/:kind/:id/journal
 *               GET  /api/org/roles/:id/history
 *   needs       GET  /api/org/roles/:id/needs
 *   claiming    GET  /api/org/my-unclaimed-seats
 *               POST /api/org/seatings/:id/claim
 *   editing     POST /api/admin/org/roles
 *               PUT  /api/admin/org/roles/:id
 *               POST /api/admin/org/roles/:id/holders
 *
 * REGISTRATION ORDER IS PRESERVED WHOLE. `register()` is called at exactly
 * the point this run occupied, and the nineteen keep their order inside it.
 * Two pairs here would answer each other's requests if reordered:
 * `/api/org/relations` sits ahead of `/api/org/:kind/:id/relations`, and
 * `/api/org/roles/:id/history` sits behind `/api/org/:kind/:id/journal`.
 * Sorting this file by path, or by admin against public, would change what
 * the server answers.
 *
 * WHAT IS STILL IN server/index.ts, so nobody hunts for it here. The three
 * public read tiers of `GET /api/org` and the `/org/**.md` publish surface
 * are above this run and stayed. `DELETE /api/admin/org/seatings/:id` and
 * `POST /api/admin/org/seatings/:id/forget` went out earlier, to
 * server/routes/orgSeatings.ts. A later lane can fold the three together.
 *
 * TWO ROUTES HERE ARE STRICTER THAN `/api/org` NEXT DOOR, and the long
 * comment on `/api/org/roles/:id/history` below says why in full. It is the
 * kind of asymmetry a tidy-up flattens, so it travels with the code.
 *
 * ONE INLINE QUERY, against `health_events`, the event spine. The journal
 * route reads it directly rather than through a repository because the whole
 * feature is one ordered read with a limit. That is why `getPool` is in the
 * slice.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { hasCapability } from "../../shared/capabilities";
import { recordEvent } from "../lib/events";
import { EXAMPLE_REFUSAL_BODY, isExampleRow } from "../lib/examples";
import { linksForSubject } from "../lib/needs";
import {
  claimSeating,
  createOrgRole,
  describeOrgChange,
  expiringSeatings,
  listOrgRoles,
  orgRoleHistory,
  seatHolder,
  statusOverrideProblem,
  unclaimedSeatingsFor,
  updateOrgRole,
} from "../lib/orgChart";
import {
  addChange,
  createDraft,
  draftChangeCap,
  getDraft,
  listDrafts,
  previewDraft,
  publishDraft,
  revertDraft,
  setDraftVision,
} from "../lib/orgDrafts";
import {
  createRelation,
  deleteRelation,
  listRelationTypes,
  listRelations,
  relationsFor,
  type NodeKind,
} from "../lib/orgRelations";
import { captureIntoCurrentPattern } from "../lib/seasonPatterns";
import { resolveSeatTerm } from "../../shared/seatTerms";

type Deps = Pick<
  AppDeps,
  | "isAdmin"
  | "authedUser"
  | "guardCapability"
  | "getPool"
  | "members"
  | "firstName"
  | "capabilityCtx"
  | "lapseContext"
  | "currentPatternId"
  | "seasonState"
  | "notify"
  | "circlesRepo"
>;

export function register(app: Express, deps: Deps): void {
  const {
    isAdmin,
    authedUser,
    guardCapability,
    getPool,
    members,
    firstName,
    capabilityCtx,
    lapseContext,
    currentPatternId,
    seasonState,
    notify,
    circlesRepo,
  } = deps;

  /*
   * ── Links between seats and circles (0054) ───────────────────────────
   *
   * Types are the village's own vocabulary, so both are editable. Reading them
   * is public at the same tier the rest of the org chart is, because a link
   * between two SEATS names nobody: that is the whole reason endpoints are
   * nodes and not people.
   */
  app.get("/api/org/relations", async (_req, res) => {
    const [types, relations] = await Promise.all([
      listRelationTypes(getPool()),
      listRelations(getPool()),
    ]);
    res.json({
      types: types.filter((t) => !t.isExample),
      relations: relations.filter((r) => !r.isExample),
    });
  });

  /** Every link touching one node, phrased from that node's side. */
  app.get("/api/org/:kind/:id/relations", async (req, res) => {
    const kind = req.params.kind === "circle" ? "circle" : req.params.kind === "org_role" ? "org_role" : null;
    if (!kind) return res.status(400).json({ error: "kind must be org_role or circle" });
    const [types, relations] = await Promise.all([
      listRelationTypes(getPool()),
      listRelations(getPool()),
    ]);
    res.json(relationsFor({ kind: kind as NodeKind, id: String(req.params.id) }, relations, new Map(types.map((t) => [t.id, t]))));
  });

  /*
   * ── Structural drafts (0056) ─────────────────────────────────────────
   *
   * A reorganisation you can read before it is true. Admin-only throughout:
   * a draft is a proposal about the village's shape, and until it publishes it
   * is not the chart.
   */
  app.get("/api/admin/org/drafts", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    res.json(await listDrafts(getPool()));
  });

  app.post("/api/admin/org/drafts", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    // `createDraft` answers a result rather than an id since 0143, because it
    // can now refuse: a machine-sourced draft meets a volume cap. A HUMAN
    // TYPING IN THE ADMIN PANEL IS NEVER CAPPED, which is what `openCap: null`
    // says here, so this route behaves exactly as it did.
    const made = await createDraft(getPool(), {
      title: String(req.body?.title ?? ""),
      rationale: req.body?.rationale ?? null,
      threadId: req.body?.threadId ?? null,
      createdBy: (await authedUser(req))?.id ?? null,
      sourceKind: "human",
      openCap: null,
    });
    if (!made.ok) return res.status(409).json({ error: made.error });
    res.json({ success: true, id: made.id });
  });

  app.post("/api/admin/org/drafts/:id/changes", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const ops = ["create_seat", "update_seat", "rest_seat", "seat_holder", "end_holding", "move_circle"];
    const op = String(req.body?.op ?? "");
    if (!ops.includes(op)) return res.status(400).json({ error: `op must be one of: ${ops.join(", ")}` });
    // A circle move names its CIRCLE in the seat column, as circle:<id>, so an
    // older release reading the row finds no seat to apply it to (0208).
    if (op === "move_circle") {
      const target = String(req.body?.orgRoleId ?? "");
      const parent = req.body?.payload?.parentCircleId;
      if (!target.startsWith("circle:") || target.length <= "circle:".length) {
        return res.status(400).json({ error: "A circle move names its circle as circle:<id>" });
      }
      if (parent !== null && parent !== undefined && typeof parent !== "string") {
        return res.status(400).json({ error: "parentCircleId must be a circle id or null" });
      }
    }
    const r = await addChange(getPool(), req.params.id, {
      op: op as any,
      orgRoleId: String(req.body?.orgRoleId ?? ""),
      payload: req.body?.payload ?? {},
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ success: true, id: r.id });
  });

  /** What it would do, and what refuses. Nothing is written. */
  app.get("/api/admin/org/drafts/:id/preview", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    res.json(await previewDraft(getPool(), req.params.id));
  });

  /**
   * The draft's vision block (0083, P1): objectives and a trigger. Writing
   * one changes when the platform PROMPTS; it never changes what applies a
   * draft, which stays the publish button below and nothing else.
   */
  app.put("/api/admin/org/drafts/:id/vision", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const vision = req.body?.vision ?? null;
    const r = await setDraftVision(getPool(), req.params.id, vision);
    if (!r.ok) return res.status(400).json({ error: r.error });
    void recordEvent(getPool(), {
      kind: "org",
      text: vision ? "vision written: the draft now says what would make it real" : "vision cleared",
      actorUserId: (await authedUser(req))?.id ?? null,
      entityType: "org_draft",
      entityRef: req.params.id,
      audience: "admin",
    });
    res.json({ success: true });
  });

  /*
   * THE ONE DOOR ONTO `publishDraft`, and `visionNeverApplies.test.ts` holds
   * it to that. It reads the 400 characters BEFORE the call and asserts this
   * route's path is in them, so a comment written between the two breaks a
   * true test with a false failure. Reasoning goes here, above the handler,
   * and the handler stays tight. `draftChangeCap` in orgDrafts.ts carries the
   * argument for the cap: it applies only to a draft a machine proposed, and a
   * founder typing in the admin panel is never capped by it.
   */
  app.post("/api/admin/org/drafts/:id/publish", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const actor = await authedUser(req);
    const season = seasonState();
    const r = await publishDraft(getPool(), req.params.id, actor?.id ?? null, draftChangeCap(), {
      seasons: season.seasons,
      currentSeasonId: season.current?.id ?? null,
      timezone: season.timezone,
    });
    if (!r.ok) return res.status(409).json({ error: r.error });
    /*
     * EVERYTHING BELOW RUNS AFTER THE COMMIT. The publish has happened, so
     * nothing here may turn it into an answer a client reads as "nothing was
     * published". A failure is logged and carried as a flag on the 200.
     *
     * A draft can move circles (0208), written by raw SQL inside the
     * transaction, and `circlesRepo.all()` never re-reads the table, so without
     * the reload the map would keep drawing the old shape until a restart.
     */
    const reloaded = await reloadCircles();
    /*
     * TELL THE PEOPLE THE DRAFT SEATED.
     *
     * The direct seating route has notified since F5. Publishing a draft did
     * not, and `publishDraft` did not import `notify` at all, so an
     * arrangement seating twelve people told none of them and left each one to
     * notice their own name on the map.
     *
     * AFTER the commit, never inside it: a rollback with a notification
     * already sent would tell somebody they hold a seat no publish applied.
     * Same type, same words and the same `org-seat:` dedupe key as the direct
     * route, because it is the same act by another door, and a member seated
     * twice by two paths should hear once.
     */
    for (const st of r.seated) {
      try {
        await notify({
          userId: st.userId,
          type: "role_appointed",
          title: `You were seated as ${st.seatName}`,
          body: st.seatAim ? st.seatAim.slice(0, 140) : null,
          link: "/map/circles",
          actorUserId: actor?.id ?? null,
          dedupeKey: `org-seat:${st.assignmentId}`,
        });
      } catch (e) {
        console.error(`[org] draft ${req.params.id} was published, but telling ${st.userId} about ${st.seatName} failed:`, e);
      }
    }
    // One journal line per seat the draft touched, so a reorganisation shows up
    // in the history of every node it moved rather than only in a draft list
    // nobody opens twice.
    try {
      const draft = await getDraft(getPool(), req.params.id);
      for (const seatId of Array.from(new Set((draft?.changes ?? []).map((c) => c.orgRoleId)))) {
        void recordEvent(getPool(), {
          kind: "org", text: `reorganised: ${draft?.title ?? "a draft"}`,
          actorUserId: actor?.id ?? null,
          entityType: seatId.startsWith("circle:") ? "circle" : "org_role",
          entityRef: seatId.startsWith("circle:") ? seatId.slice("circle:".length) : seatId,
          audience: "admin",
        });
      }
    } catch (e) {
      console.error(`[org] draft ${req.params.id} was published, but its journal lines could not be written:`, e);
    }
    res.json({ success: true, applied: r.applied, reloaded });
  });

  /**
   * Reload the circles cache after a commit, trying a second time if the first
   * fails. Answers whether it took, so a client can say the map is still
   * catching up where it would otherwise say nothing was done.
   */
  const reloadCircles = async (): Promise<boolean> => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await circlesRepo.load();
        return true;
      } catch (e) {
        console.error(`[org] reloading the circles after an org draft failed, attempt ${attempt} of 2:`, e);
      }
    }
    return false;
  };

  app.post("/api/admin/org/drafts/:id/revert", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const r = await revertDraft(getPool(), req.params.id);
    if (!r.ok) return res.status(409).json({ error: r.error });
    // After the commit, the same as publish: a reverted circle move is raw SQL too.
    res.json({ success: true, reverted: r.reverted, reloaded: await reloadCircles() });
  });

  app.post("/api/admin/org/relations", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const r = await createRelation(getPool(), {
      typeId: String(req.body?.typeId ?? ""),
      fromKind: String(req.body?.fromKind ?? ""),
      fromId: String(req.body?.fromId ?? ""),
      toKind: String(req.body?.toKind ?? ""),
      toId: String(req.body?.toId ?? ""),
      note: req.body?.note ?? null,
      createdBy: (await authedUser(req))?.id ?? null,
    });
    if (!r.ok) return res.status(400).json({ error: r.error });
    // The journal already reads by node, so a link shows up on BOTH ends'
    // history without a second write: two events, one row.
    for (const end of [
      { kind: String(req.body?.fromKind), id: String(req.body?.fromId) },
      { kind: String(req.body?.toKind), id: String(req.body?.toId) },
    ]) {
      void recordEvent(getPool(), {
        kind: "org",
        text: `linked: ${String(req.body?.typeId)}`,
        actorUserId: (await authedUser(req))?.id ?? null,
        entityType: end.kind, entityRef: end.id, audience: "admin",
      });
    }
    res.json({ success: true, id: r.id });
  });

  app.delete("/api/admin/org/relations/:id", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const ok = await deleteRelation(getPool(), String(req.params.id));
    if (!ok) return res.status(404).json({ error: "No such link" });
    res.json({ success: true });
  });

  /**
   * Seats whose mandate has run out or is about to, most overdue first.
   *
   * Nothing here revokes anything. A village misses a re-selection during a
   * harvest, and a seat going dark on a Tuesday for reasons nobody chose is
   * worse than one that says out loud it is overdue.
   */
  app.get("/api/admin/org/expiring", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const within = Math.max(1, Math.min(365, Number(req.query.days ?? 30)));
    const rows = await expiringSeatings(getPool(), lapseContext(), within);
    const allMembers = await members.all();
    res.json(
      rows.map((a) => ({
        assignmentId: a.id,
        orgRoleId: a.orgRoleId,
        roleName: a.roleName,
        holder: a.holderKind === "member" && a.userId
          ? firstName((allMembers as any[]).find((u: any) => u.id === a.userId)?.name ?? "Member")
          : a.displayName,
        focus: a.focus,
        lapsed: !!a.lapsed,
        reason: a.lapsedReason,
        daysLeft: a.daysLeft,
        termEndsAt: a.termEndsAt,
      })),
    );
  });

  /**
   * One node's whole history: every structural change and every seating.
   *
   * A read over the event spine, never a second table. Peerdom's journal is
   * the feature worth copying, and its value is entirely in this direction:
   * before you change a seat, you can see what has already been tried with it,
   * and by whom. Governance history stops living in people's memory.
   */
  app.get("/api/org/:kind/:id/journal", async (req, res) => {
    const viewer = await authedUser(req);
    const maySee =
      (await isAdmin(req)) ||
      (viewer ? hasCapability("map.viewPeople", await capabilityCtx(viewer)) : false);
    if (!maySee) return res.status(401).json({ error: "auth_required", message: "Sign in to read this history" });
    const kind = req.params.kind === "circles" ? "circle" : "org_role";
    const [rows]: any = await getPool().query(
      `SELECT id, kind, text, actor_user_id, at FROM health_events
        WHERE entity_type = ? AND entity_ref = ?
        ORDER BY at DESC, id DESC LIMIT 200`,
      [kind, req.params.id],
    );
    const allMembers = await members.all();
    res.json(
      (rows as any[]).map((r) => ({
        id: r.id,
        text: r.text,
        at: r.at,
        by: r.actor_user_id
          ? firstName((allMembers as any[]).find((u: any) => u.id === r.actor_user_id)?.name ?? "Someone")
          : null,
      })),
    );
  });

  /**
   * One seat's whole history, ended seatings included.
   *
   * THIS ROUTE IS STRICTER THAN `/api/org` ON PURPOSE. DO NOT LEVEL THEM.
   *
   * `/api/org` has three tiers and its widest one answers a signed-out
   * stranger whenever `org.public_people` is on, which it is by default
   * (R57). This route asks `map.viewPeople` or admin and stops there. It
   * never consults that dial. Read side by side the two look inconsistent,
   * and a tidy-up that "fixed" it would publish things `/api/org` spent real
   * work withholding.
   *
   * THE REASON IS IN THE PAYLOADS, not in the principle. `/api/org`'s public
   * tier is a first name and nothing else, and `publicHolder` above lists
   * what it strips and why it was stripped: `focus`, `note`, `userId`,
   * `kind`, `lapsed`. Every row this route returns carries `focus` and
   * `endedReason`. Both sit at the MEMBER tier or above in that same
   * document, so honouring `org.public_people` here would hand an anonymous
   * caller two fields the route next door refuses them by name.
   *
   * Said the shorter way: a CURRENT seat is a fact about the village, and
   * somebody deciding whether to approach it needs that. A HISTORY of who
   * held it is a record about people over time, including when each of them
   * stopped and why. The village publishes the first. The second is the
   * members' own record of themselves.
   *
   * So the asymmetry is the decision. If it should ever change, the thing to
   * change is what this payload carries, and the tiering follows from that.
   */
  app.get("/api/org/roles/:id/history", async (req, res) => {
    const viewer = await authedUser(req);
    const maySeePeople =
      (await isAdmin(req)) ||
      (viewer ? hasCapability("map.viewPeople", await capabilityCtx(viewer)) : false);
    if (!maySeePeople) return res.status(401).json({ error: "auth_required", message: "Sign in to see who held this seat" });
    const allMembers = await members.all();
    const rows = await orgRoleHistory(getPool(), req.params.id);
    res.json(
      rows.map((a) => ({
        id: a.id,
        name:
          a.holderKind === "member" && a.userId
            ? firstName((allMembers as any[]).find((u: any) => u.id === a.userId)?.name ?? "Member")
            : a.displayName,
        kind: a.holderKind,
        focus: a.focus,
        startedAt: a.startedAt,
        endedAt: a.endedAt,
        endedReason: a.endedReason,
      })),
    );
  });

  /**
   * WHAT NEEDS THIS SEAT IS HELD FOR (R1, R18, migration 0204).
   *
   * THE TWENTIETH ROUTE, and the only one in this file that was not a move
   * out of server/index.ts. It exists because the seat's own read payload is
   * assembled inside `GET /api/org`, which lives at server/index.ts:26911
   * under a ratchet that only turns down, and a lane that cannot add a line
   * there cannot put the links where they belong. So the answer comes on its
   * own door beside the seat's history, in the file that already owns every
   * other per-seat read. If `GET /api/org` ever moves into a module, this
   * folds into it and the route goes.
   *
   * ONE SEAT, NOT ALL OF THEM, and that is a cost decision stated out loud.
   * A whole-chart answer would be a query per seat behind one URL, which is
   * the same round trips with the fan-out hidden. The seat card asks when a
   * reader opens it.
   *
   * MEMBER-TIER, matching `GET /api/needs/scope`, which is the read this
   * answer is only meaningful beside. It names no person: a seat, a need the
   * village took on, and whether the seat carries that need alone or helps.
   *
   * R18 IS THE POINT OF IT. The more needs a village takes on, the more seats
   * it needs to meet them, and `needSeatings` in server/lib/needs.ts turns
   * these rows into seats needed against seats filled. Nothing here computes
   * that: this route is the tagging half, and the counting half has one home.
   */
  app.get("/api/org/roles/:id/needs", async (req, res) => {
    if (!(await authedUser(req))) {
      return res.status(401).json({ error: "auth_required", message: "Sign in to see what this seat is held for" });
    }
    const needs = await linksForSubject(getPool(), "role", String(req.params.id));
    res.json({ needs });
  });

  /**
   * Seatings recorded under a name that looks like this member's.
   *
   * The org chart arrived carrying holders as free-text names, because that
   * is all the document it replaced could hold. Rather than ask anyone to
   * re-enter twenty-five seats, the first person to sign in under a matching
   * name is offered the seating and takes it with one tap.
   */
  app.get("/api/org/my-unclaimed-seats", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in first" });
    const rows = await unclaimedSeatingsFor(getPool(), user.name);
    if (!rows.length) return res.json([]);
    const roles = await listOrgRoles(getPool());
    res.json(
      rows.map((a) => ({
        assignmentId: a.id,
        recordedName: a.displayName,
        roleId: a.orgRoleId,
        roleName: roles.find((r) => r.id === a.orgRoleId)?.name ?? a.orgRoleId,
        focus: a.focus,
      })),
    );
  });

  app.post("/api/org/seatings/:id/claim", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in first" });
    // Answered before the name check, so the refusal says the true reason.
    // `unclaimedSeatingsFor` no longer offers example seatings, and without
    // this the claim would come back "that seat is not recorded under your
    // name" to somebody whose name is written on it.
    if (await isExampleRow(getPool(), "org_role_assignments", req.params.id)) {
      return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    }
    // Only a seating whose recorded name matches this member may be claimed,
    // checked server-side: the id alone must never be enough to take a seat.
    const mine = await unclaimedSeatingsFor(getPool(), user.name);
    if (!mine.some((a) => a.id === req.params.id)) {
      return res.status(403).json({ error: "That seat is not recorded under your name" });
    }
    const ok = await claimSeating(getPool(), req.params.id, user.id);
    if (!ok) return res.status(409).json({ error: "That seating has already been claimed or ended" });
    await recordEvent(getPool(), {
      kind: "role",
      text: `${firstName(user.name)} confirmed a seat`,
      actorUserId: user.id,
      entityType: "org_role_assignment",
      entityRef: req.params.id,
      audience: "admin",
    });
    res.json({ success: true });
  });

  // ── Admin: the org chart is edited here, and the edits are live ──────────
  app.post("/api/admin/org/roles", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const id = await createOrgRole(getPool(), req.body ?? {});
    // Anything made while a season runs joins that season's pattern, so a
    // village never sits down to author one. Nothing happens when the season
    // names no pattern, which is every village that has not opted in.
    await captureIntoCurrentPattern(getPool(), currentPatternId(), "org_role", id);
    await recordEvent(getPool(), {
      kind: "org", text: `seat created: ${String(req.body?.name ?? id)}`,
      actorUserId: (await authedUser(req))?.id ?? null,
      entityType: "org_role", entityRef: id, audience: "admin",
    });
    res.json({ success: true, id });
  });

  app.put("/api/admin/org/roles/:id", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const role = (await listOrgRoles(getPool())).find((r) => r.id === req.params.id);
    if (!role) return res.status(404).json({ error: "Seat not found" });
    if (role.isExample) return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    // Refused with a sentence, not a truncation error. `expired` is a SeatState
    // in TypeScript but is DERIVED, so it is not one of the states the 0049
    // column lets a village declare.
    const badState = statusOverrideProblem(req.body?.statusOverride);
    if (badState) return res.status(400).json({ error: badState });
    // Described BEFORE the write, while the old values still exist. The
    // generic admin audit records "PUT /api/admin/org/roles/x", which cannot
    // answer "what has already been tried with this seat".
    const changes = describeOrgChange(role, req.body ?? {});
    const ok = await updateOrgRole(getPool(), req.params.id, req.body ?? {});
    if (ok && changes.length) {
      await recordEvent(getPool(), {
        kind: "org", text: `${role.name}: ${changes.join("; ")}`,
        actorUserId: (await authedUser(req))?.id ?? null,
        entityType: "org_role", entityRef: req.params.id, audience: "admin",
      });
    }
    res.json({ success: ok });
  });

  app.post("/api/admin/org/roles/:id/holders", async (req, res) => {
    // 0098: `org.seat`. Deciding who sits in the village's seats is the
    // archetypal power a village takes back, and it was an admin check.
    if (!(await guardCapability(req, res, "org.seat"))) return;
    /*
     * SEATING AN AGENT IS ITS OWN POWER, AND DELIBERATELY NOT A FLAG ON
     * `org.seat`.
     *
     * The founder ruled that stewards hold this now and that a dedicated role
     * gets it later. The governance mechanism moves a KEY from one role to
     * another; it cannot split one. So a power that will need to move on its
     * own has to be its own key from the day it exists, or that future is a
     * code change and a migration instead of a vote.
     *
     * Both gates, and not one instead of the other: seating an agent is a
     * narrower act than seating, so it needs the general power AND the
     * specific one.
     */
    const wantsAgent = !!req.body?.isAgent;
    if (wantsAgent && !(await guardCapability(req, res, "org.seatAgent"))) return;
    const role = (await listOrgRoles(getPool())).find((r) => r.id === req.params.id);
    if (!role) return res.status(404).json({ error: "Seat not found" });
    if (role.isExample) return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    const actor = await authedUser(req);
    /*
     * THE TERM, WHICH EVERY SEATING NOW CARRIES (0199).
     *
     * This route once sent none, so `term_ends_at` was NULL on every seating
     * and four readers were dark: the amber term arc on the power map, the
     * `seat-term` calendar source, the term branch of `term-watch`, and the
     * term branch of `isLapsed`. It then sent one only when asked, and a seat
     * with no date asked had no end at all.
     *
     * Rye ruled on 2026-09-14 that no seat enters without a term, and that a
     * seat with no date asked ends with the season. `resolveSeatTerm` in
     * shared/seatTerms.ts decides it, and a date it cannot use is a refusal
     * with the sentence saying why. `termEndsOn` is a civil date; `termEndsAt`
     * is this route's older name for the same field and is still read.
     */
    const askedTerm = req.body?.termEndsOn ?? req.body?.termEndsAt;
    const season = seasonState();
    const term = resolveSeatTerm({
      requestedEndsOn: typeof askedTerm === "string" && /^\d{4}-\d{2}-\d{2}T/.test(askedTerm) ? askedTerm.slice(0, 10) : askedTerm,
      calendar: { seasons: season.seasons, currentSeasonId: season.current?.id ?? null, timezone: season.timezone },
      capAtSeasonEnd: false,
      now: new Date(),
    });
    if (!term.ok) return res.status(term.code === "unreadable_date" ? 400 : 409).json({ error: term.error, code: term.code });
    const r = await seatHolder(getPool(), req.params.id, {
      userId: req.body?.userId ?? null,
      displayName: req.body?.displayName ?? null,
      focus: req.body?.focus ?? null,
      note: req.body?.note ?? null,
      seasonId: term.seasonId,
      termEndsAt: term.endsAt,
      termFollowsSeason: term.followsSeason,
      grantedBy: actor?.id ?? null,
      // `seatHolder` refuses `isAgent` together with a `userId`, which is the
      // one refusal that keeps a seat-plane agent out of both the settlement
      // job's member filter and the 0083 declare door. Passed through rather
      // than re-checked here, so there is one place that decides.
      isAgent: wantsAgent,
      agentSlug: req.body?.agentSlug ?? null,
    });
    if (!r.ok) return res.status(409).json({ error: r.reason });
    // WHO was put in a seat is the history a village most wants when it opens
    // one, and it was the one structural change the journal did not record:
    // only edits to the seat's card were. Names are not written into the line;
    // the journal is admin-audience and the seat's holders are already
    // readable at their own tier, so the event says that the seat changed
    // hands and lets the reader look.
    void recordEvent(getPool(), {
      kind: "org",
      text: req.body?.userId ? "seated a member" : `seated ${String(req.body?.displayName ?? "someone")}`,
      actorUserId: actor?.id ?? null,
      entityType: "org_role", entityRef: req.params.id, audience: "admin",
    });
    /*
     * SWEEP (the incomplete loop). Seating somebody is an appointment, and
     * POST /api/admin/roles/:id/holders has told the appointee since F5. This
     * route, which does the same thing to the org chart's own seats, wrote an
     * admin-audience journal line and left the person to notice their own name
     * on the map. Same type and same words, because it is the same act.
     *
     * A documented holder has no account to reach, so only a seated MEMBER
     * hears. Keyed on the seating row, so a member seated again a season later
     * is told again.
     */
    if (req.body?.userId && r.assignmentId) {
      await notify({
        userId: String(req.body.userId),
        type: "role_appointed",
        title: `You were seated as ${role.name}`,
        body: role.aim ? String(role.aim).slice(0, 140) : null,
        link: "/map/circles",
        actorUserId: actor?.id ?? null,
        dedupeKey: `org-seat:${r.assignmentId}`,
      });
    }
    res.json({ success: true });
  });
}
