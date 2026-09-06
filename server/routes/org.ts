/**
 * The org chart: links, structural drafts, seat history, and the admin edits.
 *
 * Nineteen routes, lifted out of server/index.ts unchanged. Grouped as they
 * were grouped there, because they were already one contiguous run:
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
    const ops = ["create_seat", "update_seat", "rest_seat", "seat_holder", "end_holding"];
    const op = String(req.body?.op ?? "");
    if (!ops.includes(op)) return res.status(400).json({ error: `op must be one of: ${ops.join(", ")}` });
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
    const roster = ((await members.all()) as any[]).length;
    const r = await publishDraft(getPool(), req.params.id, actor?.id ?? null, draftChangeCap(roster));
    if (!r.ok) return res.status(409).json({ error: r.error });
    // One journal line per seat the draft touched, so a reorganisation shows up
    // in the history of every node it moved rather than only in a draft list
    // nobody opens twice.
    const drafts = await listDrafts(getPool());
    const draft = drafts.find((d) => d.id === req.params.id);
    for (const seatId of Array.from(new Set((draft?.changes ?? []).map((c) => c.orgRoleId)))) {
      void recordEvent(getPool(), {
        kind: "org", text: `reorganised: ${draft?.title ?? "a draft"}`,
        actorUserId: actor?.id ?? null,
        entityType: "org_role", entityRef: seatId, audience: "admin",
      });
    }
    res.json({ success: true, applied: r.applied });
  });

  app.post("/api/admin/org/drafts/:id/revert", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const r = await revertDraft(getPool(), req.params.id);
    if (!r.ok) return res.status(409).json({ error: r.error });
    res.json({ success: true, reverted: r.reverted });
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
     * THE TERM, WHICH THIS ROUTE HAS NEVER SENT.
     *
     * `seatHolder` has taken `termEndsAt` and written the column since 0049,
     * and this is the only route in the tree that seats anybody, so
     * `term_ends_at` has been NULL on every seating every village has ever
     * made. FOUR readers were dark the whole time: the amber term arc on the
     * power map, the `seat-term` calendar source, the term branch of the
     * `term-watch` job, and the term branch of `isLapsed`. One argument.
     *
     * Read rather than passed through. A date this route cannot parse is a
     * refusal with the sentence saying so, never a quiet null: a village that
     * believes it wrote an end date onto a seat, over a row that holds none,
     * is the shape where the product says something that did not happen.
     * Left out stays left out, which is a seat held with no end date and is
     * exactly what every seating on every deployment is today.
     */
    const askedTerm = req.body?.termEndsAt;
    let termEndsAt: Date | null = null;
    if (askedTerm !== undefined && askedTerm !== null && String(askedTerm).trim() !== "") {
      const parsed = new Date(String(askedTerm));
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({
          error: "That term end date could not be read. Send a date like 2027-03-01, or leave it out for a seat with no end date",
        });
      }
      termEndsAt = parsed;
    }
    const r = await seatHolder(getPool(), req.params.id, {
      userId: req.body?.userId ?? null,
      displayName: req.body?.displayName ?? null,
      focus: req.body?.focus ?? null,
      note: req.body?.note ?? null,
      seasonId: seasonState().current?.id ?? null,
      termEndsAt,
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
