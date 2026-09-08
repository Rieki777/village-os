/**
 * The needs scope over HTTP: what this village is for, and what meets it.
 *
 * Six routes, all of them new (R1, R18; lane N1):
 *
 *   GET    /api/needs/scope           the scope, for any signed-in member
 *   GET    /api/needs/coverage        the two derived reads, for any member
 *   PUT    /api/admin/needs/scope     take on needs, or change what was said
 *   POST   /api/admin/needs/retire    take one out of scope, keeping its links
 *   POST   /api/admin/needs/links     tag a thing as meeting a need
 *   DELETE /api/admin/needs/links/:id take one tag off
 *
 * THE SHAPE IS server/routes/faqs.ts's, which is the pattern the rest of
 * server/index.ts is meant to follow: `register(app, deps)` is the only export
 * that touches Express, `deps` is a `Pick<AppDeps, ...>` and never the whole
 * thing, and the gates come in through `deps` rather than being imported so
 * the DEFAULT-DENY marker in server/lib/adminGate.ts keeps working.
 *
 * WHY THE READS ARE MEMBERS AND NOT PUBLIC. What a village is for is not a
 * secret, and a later lane may well publish it on the shopfront. It starts
 * behind a member token because the honest half of the answer travels with it:
 * the coverage read names the needs with nothing meeting them, and a village
 * mid-setup should get to finish before a stranger reads its gaps.
 *
 * WHY THE WRITES ARE `isAdmin` AND NOT A CAPABILITY. There is no needs
 * capability in shared/capabilities.ts, and adding one is a five-edit change in
 * a file this lane does not own. `isAdmin` is admin or founder, which is the
 * setup ceremony's audience. A later lane that wants stewards writing the
 * scope adds the key in the one gate and swaps these four lines.
 *
 * NO DOOR YET, and that is recorded rather than hidden. The screens that call
 * these four writes are lane N2's `NeedsPanel.tsx`, so
 * scripts/check-admin-reach.mjs carries four ALLOWED lines naming this file and
 * saying to delete them when that panel lands. Same posture the land lane took.
 *
 * A LANE THAT WANTS THE FIGURES WITHOUT HTTP imports `needsCoverage` and
 * `needSeatings` from server/lib/needs.ts, which is where they live. The test
 * run and the health snapshot both read the same two figures, and re-deriving
 * either from its own SQL is how a preview and a report come to disagree.
 *
 * THIS MODULE IS SHARED WITH LANE N4. The member's own card (`member_needs`)
 * registers its routes here rather than in a second module, because
 * server/index.ts is under a no-net-lines ratchet that exempts exactly one
 * import and one register call per module.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { recordEvent } from "../lib/events";
import { cycleIdFor } from "../lib/gratitude-cycles";
import {
  aggregateFloor,
  coverageReport,
  deleteMemberNeed,
  linkNeed,
  memberNeedProblem,
  needsAggregate,
  readMemberNeeds,
  readScope,
  retireNeed,
  saveMemberNeed,
  scopeProblem,
  scopeSummary,
  unlinkNeed,
  upsertScopeNeed,
  MEMBER_NEED_FEELING_MAX,
  MEMBER_NEED_NOTE_MAX,
  type MemberNeedInput,
  type ScopeInput,
} from "../lib/needs";
import {
  HUMAN_NEEDS,
  NEED_DEPTHS,
  NEED_DEPTH_LABELS,
  isNeedDepth,
  isNeedSubject,
  isNeedWeight,
} from "../../shared/needs";

type Deps = Pick<AppDeps, "isAdmin" | "authedUser" | "getPool">;

/**
 * What the member's own card asks for, and it is NARROWER than `Deps`.
 *
 * No widening was needed to add lane N4's four doors: `authedUser` and
 * `getPool` were already in the slice, and the member card wants nothing else.
 * `isAdmin` is deliberately absent from this type, so the four handlers below
 * cannot reach the admin gate even by accident.
 */
type MemberDeps = Pick<AppDeps, "authedUser" | "getPool">;

/** How many needs one PUT may carry. Ten platform needs plus room to name more. */
const MAX_SCOPE_ENTRIES = 100;

export function register(app: Express, deps: Deps): void {
  const { isAdmin, authedUser, getPool } = deps;

  /**
   * The scope, plus the taxonomy it was chosen from.
   *
   * The ten needs travel with the answer so a client has one round trip and
   * cannot render a scope row against a stale copy of the platform list.
   */
  app.get("/api/needs/scope", async (req, res) => {
    if (!(await authedUser(req))) return res.status(401).json({ error: "auth_required" });
    const rows = await readScope(getPool(), { includeRetired: true });
    res.json({
      needs: HUMAN_NEEDS,
      depths: NEED_DEPTHS,
      scope: rows,
      summary: scopeSummary(rows),
    });
  });

  /**
   * The two derived reads: what meets each need, and the seats it leans on.
   *
   * An empty scope answers `answered: false` with empty lists. A village that
   * has said nothing and a village that took on no needs are different facts,
   * and the payload keeps them apart so a screen can say which one it is.
   */
  app.get("/api/needs/coverage", async (req, res) => {
    if (!(await authedUser(req))) return res.status(401).json({ error: "auth_required" });
    res.json(await coverageReport(getPool()));
  });

  /**
   * Take on needs, or change what this village said about ones it has.
   *
   * IT RETIRES NOTHING. A PUT that retired every need absent from its body
   * would make a half-loaded screen an act of policy, and taking a need out of
   * scope is a decision with its own door below. So this route only ever adds
   * and updates, and unticking goes through /retire.
   *
   * ALL OR NOTHING. Every entry is validated before any of them is written, so
   * one bad row refuses the request instead of leaving half a scope saved and
   * a green toast over it.
   */
  app.put("/api/admin/needs/scope", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const body = req.body ?? {};
    const entries = Array.isArray(body) ? body : body.needs;
    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: "Send a `needs` array." });
    }
    if (entries.length > MAX_SCOPE_ENTRIES) {
      return res.status(400).json({ error: `That is more than ${MAX_SCOPE_ENTRIES} needs in one save.` });
    }
    const wanted: ScopeInput[] = [];
    for (const raw of entries) {
      const entry: ScopeInput = {
        needKey: String(raw?.needKey ?? raw?.key ?? "").trim(),
        label: raw?.label === undefined ? undefined : String(raw.label),
        depthTarget: isNeedDepth(raw?.depthTarget) ? raw.depthTarget : undefined,
        breadthTargetPct:
          raw?.breadthTargetPct === undefined || raw?.breadthTargetPct === null
            ? undefined
            : Number(raw.breadthTargetPct),
        note: raw?.note === undefined ? undefined : raw.note === null ? null : String(raw.note),
        sortOrder: raw?.sortOrder === undefined ? undefined : Number(raw.sortOrder),
      };
      if (raw?.depthTarget !== undefined && !isNeedDepth(raw.depthTarget)) {
        return res.status(400).json({ error: "A depth is one of Deprived, Unmet, Alive, Satisfied or Thriving." });
      }
      const problem = scopeProblem(entry);
      if (problem) return res.status(400).json({ error: problem });
      wanted.push(entry);
    }
    const pool = getPool();
    const saved = [];
    for (const entry of wanted) {
      const r = await upsertScopeNeed(pool, entry);
      if (!r.ok) return res.status(400).json({ error: r.problem });
      saved.push(r.row);
    }
    const rows = await readScope(pool, { includeRetired: true });
    void recordEvent(pool, {
      kind: "needs",
      text: `the village named ${saved.length} of its needs`,
      actorUserId: (await authedUser(req))?.id ?? null,
      entityType: "village_needs",
      entityRef: null,
      audience: "admin",
    });
    res.json({ success: true, saved, scope: rows, summary: scopeSummary(rows) });
  });

  /**
   * Take one need out of scope.
   *
   * ITS LINKS STAY, and so does any snapshot frozen against it. Retiring twice
   * answers the same 200 with `changed: false` and never moves the timestamp,
   * so a second button press cannot rewrite when the village decided.
   */
  app.post("/api/admin/needs/retire", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const needKey = String(req.body?.needKey ?? "").trim();
    if (!needKey) return res.status(400).json({ error: "Name the need to retire." });
    const pool = getPool();
    const r = await retireNeed(pool, needKey);
    if (!r.found) return res.status(404).json({ error: "This village has not taken on that need." });
    if (r.changed) {
      void recordEvent(pool, {
        kind: "needs",
        text: `${r.row?.label ?? needKey} left the village's scope`,
        actorUserId: (await authedUser(req))?.id ?? null,
        entityType: "village_needs",
        entityRef: r.row?.id ?? null,
        audience: "admin",
      });
    }
    res.json({ success: true, changed: r.changed, need: r.row });
  });

  /** Tag a quest, a seat, a sink, a stay, an event or a place as meeting a need. */
  app.post("/api/admin/needs/links", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const body = req.body ?? {};
    if (!isNeedSubject(body.subjectType)) {
      return res.status(400).json({ error: "A link is onto a quest, a role, a sink, a stay, an event or a place." });
    }
    if (body.weight !== undefined && !isNeedWeight(body.weight)) {
      return res.status(400).json({ error: "A weight is primary or partial." });
    }
    const actor = await authedUser(req);
    const pool = getPool();
    const r = await linkNeed(pool, {
      needKey: String(body.needKey ?? "").trim(),
      subjectType: body.subjectType,
      subjectRef: String(body.subjectRef ?? ""),
      weight: body.weight,
      createdBy: actor?.id ?? null,
    });
    if (!r.ok) return res.status(400).json({ error: r.problem });
    res.json({ success: true, link: r.row });
  });

  /** Take one tag off. The need and the thing both stay. */
  app.delete("/api/admin/needs/links/:id", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const gone = await unlinkNeed(getPool(), req.params.id);
    if (!gone) return res.status(404).json({ error: "No link with that id." });
    res.json({ success: true });
  });

  // Lane N4's four doors, on this module so server/index.ts keeps ONE import
  // and ONE register call. `deps` is passed whole and narrowed by the
  // parameter type, so the member handlers never see `isAdmin`.
  registerMemberCard(app, deps);
}

/**
 * The member's own card, and the only figure the village gets back. Lane N4.
 *
 * Four more doors on the same module, because server/index.ts is under a
 * no-net-lines ratchet that exempts exactly one import and one register call
 * per route module. A second module would have cost a second pair.
 *
 *   GET    /api/needs/mine       this member's own answers, this moon
 *   PUT    /api/needs/mine       save one answer
 *   DELETE /api/needs/mine       take one answer back
 *   GET    /api/needs/aggregate  counts per need, for any member
 *
 * THERE IS NO FIFTH DOOR, and its absence is the design. Nothing here takes a
 * user id from a request. `authedUser(req)` is the only source of the id every
 * one of these three member routes filters on, so there is no shape of URL,
 * body or query string that reads somebody else's answer. An admin who asks
 * for `/api/admin/needs/mine` gets Express's own 404, because that route was
 * never registered, and an admin who asks for `/api/needs/mine` gets their own
 * card. The refusal is the missing handler, so no gate has to hold.
 *
 * NO EVENT IS RECORDED for any of the three. `recordEvent` writes
 * `health_events`, which stewards read; a row saying "member-7 answered on
 * Love" would put on the admin's screen exactly the fact this table exists to
 * keep off it. The scope writes above DO record one, because what a village
 * says it is for is a public decision.
 *
 * THE AGGREGATE IS OPEN TO EVERY MEMBER, on purpose. A count that only the
 * admin can read is a count the village cannot use to hold anybody to the
 * target it set, and the panel's own reading of R20 is that the signal has to
 * reach the electorate. It carries no user id at any depth, and it withholds
 * both numbers below the floor.
 */
export function registerMemberCard(app: Express, deps: MemberDeps): void {
  const { authedUser, getPool } = deps;

  /**
   * This member's own answers for the moon in progress.
   *
   * `answered` is separate from the length of `mine` on purpose. A member with
   * no rows has not been asked yet; a member who recorded Deprived on three
   * needs and Thriving on none has answered, and both would read as "nothing
   * to show" from a count alone. The card says different sentences for them.
   */
  app.get("/api/needs/mine", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    const mine = await readMemberNeeds(getPool(), me.id);
    res.json({
      cycleId: cycleIdFor(),
      floor: aggregateFloor(),
      needs: HUMAN_NEEDS,
      depths: NEED_DEPTHS,
      depthLabels: NEED_DEPTH_LABELS,
      feelingMax: MEMBER_NEED_FEELING_MAX,
      noteMax: MEMBER_NEED_NOTE_MAX,
      answered: mine.length > 0,
      mine,
    });
  });

  /**
   * Save one answer.
   *
   * A client that sends a `visibility` of anything but `private` is REFUSED by
   * name. Downgrading it silently would leave the member believing a setting
   * exists, and the column in 0187 admits one value anyway, so a silent
   * downgrade would also be the only reason the write did not simply fail.
   */
  app.put("/api/needs/mine", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    const body = req.body ?? {};
    const input = {
      needKey: String(body.needKey ?? body.key ?? "").trim(),
      depth: body.depth,
      feeling: body.feeling === undefined ? undefined : body.feeling === null ? null : String(body.feeling),
      note: body.note === undefined ? undefined : body.note === null ? null : String(body.note),
      visibility: body.visibility === undefined ? undefined : String(body.visibility),
    };
    const problem = memberNeedProblem(input);
    if (problem) return res.status(400).json({ error: problem });
    const saved = await saveMemberNeed(getPool(), me.id, input as MemberNeedInput);
    if (!saved.ok) return res.status(400).json({ error: saved.problem });
    res.json({ success: true, need: saved.row });
  });

  /**
   * Take one answer back.
   *
   * The key is REQUIRED. A DELETE with an empty body that erased the whole
   * card would make a mistyped request an act of forgetting, and a member who
   * wants everything gone has the account-deletion door, which takes these
   * rows with it through `forgetMemberNeeds`.
   */
  app.delete("/api/needs/mine", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    const needKey = String(req.body?.needKey ?? req.query?.needKey ?? "").trim();
    if (!needKey) return res.status(400).json({ error: "Name the need you are taking back." });
    const gone = await deleteMemberNeed(getPool(), me.id, needKey);
    if (!gone) return res.status(404).json({ error: "You have no answer on that need this moon." });
    res.json({ success: true });
  });

  /**
   * How the village is doing, as counts and never as people.
   *
   * The payload is generated by `needsAggregate`, whose SELECT names no
   * `user_id`, so there is no row here to leak however the response is read.
   * Below the floor both numbers are null and `suppressed` is true, which a
   * screen prints as a sentence about why it has nothing to show.
   */
  app.get("/api/needs/aggregate", async (req, res) => {
    if (!(await authedUser(req))) return res.status(401).json({ error: "auth_required" });
    res.json(await needsAggregate(getPool()));
  });
}
