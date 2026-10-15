/**
 * Badges and skills: what a village recognises, and who has it.
 *
 * Fourteen routes, lifted out of server/index.ts unchanged:
 *
 *   GET    /api/badges                     the catalogue plus the viewer's own
 *   GET    /api/badges/of/:userId          somebody else's, as they allow
 *   PUT    /api/badges/featured            pin up to three on a profile
 *   GET    /api/badges/match               who holds the skills a quest asks for
 *   POST   /api/badges/:id/claim           claim a self-claimable badge
 *   DELETE /api/badges/:id/claim           put one back
 *   POST   /api/badges/skills              add a skill tag
 *   DELETE /api/badges/skills/:tag         drop one
 *   GET    /api/admin/badges               the catalogue with awards attached
 *   POST   /api/admin/badges               define one
 *   PUT    /api/admin/badges/:id           change one
 *   POST   /api/admin/badges/:id/award     award it to a member
 *   DELETE /api/admin/badges/:id/award/:userId  take it back
 *   POST   /api/admin/badges/evaluate      run the earning rules now
 *
 * WHY THIS IS ONE MODULE. Every route reads or writes the same three things
 * through server/lib/badges.ts (the catalogue, the awards, the skill tags),
 * and nothing outside this file registers a /api/badges path. The domain's
 * rules live in the library module already; what moved is the HTTP surface
 * over them, which is exactly the unit a contributor changing a badge needs.
 *
 * BOTH `app.use(..., requireModule("badges"))` LINES MOVED WITH THE ROUTES
 * and stay first in register(). They are what makes the whole surface a 404
 * while the module is off, admin tab included, and Express applies middleware
 * in registration order, so a `use` registered after its routes guards
 * nothing.
 *
 * REGISTERED WHERE IT WAS, because Express matches in registration order:
 * after the library's routes, before the exchange's.
 */
import type { Express } from "express";
import type { Capability } from "../../shared/capabilities";
import { liveConsequence } from "../lib/capabilityConsequence";
import type { AppDeps } from "../lib/appDeps";
import {
  BADGE_KINDS,
  addSkill,
  allBadges,
  awardsFor,
  badgeById,
  badgeChangeSentence,
  badgeProblem,
  badgesOpenState,
  evaluateEarnedBadges,
  removeSkill,
  skillsFor,
  upsertAward,
} from "../lib/badges";
import { recordEvent } from "../lib/events";
import { EXAMPLE_REFUSAL_BODY, isExampleRow, isExampleUser, onRealItemPublished } from "../lib/examples";
import { requireModule } from "../lib/modules";
import { numberVar } from "../lib/variables";

type Deps = Pick<
  AppDeps,
  | "adminActor"
  | "authedUser"
  | "firstName"
  | "isAdmin"
  | "members"
  | "notify"
  | "getPool"
>;

export function register(app: Express, deps: Deps): void {
  const { adminActor, authedUser, firstName, isAdmin, members, notify, getPool } = deps;

  // â”€â”€ S37-S40: badges & skills â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  app.use("/api/badges", requireModule("badges"));
  app.use("/api/admin/badges", requireModule("badges"));

  /** Catalog + the viewer's own awards and skills, one call. */
  app.get("/api/badges", async (req, res) => {
    const viewer = await authedUser(req);
    const badges = (await allBadges(getPool())).filter((b) => b.active);
    let mine: any = null;
    if (viewer) {
      const awards = (await awardsFor(getPool(), viewer.id)).filter((a) => !a.expired);
      /*
       * WHO PUT THIS ON MY RECORD, AND WHEN.
       *
       * `awardsFor` hands back `awardedBy` as a user id and no date at all, so
       * the member's own page could say a warning existed and nothing about
       * where it came from. A warning is placed by a person, the route makes
       * that person write a note because "the member deserves to know why",
       * and then the answer to "who said this about me, and when" was a
       * fourteen-character id the page never rendered. A record somebody
       * cannot read is not a record.
       *
       * ONLY EVER THE VIEWER'S OWN AWARDS. This sits inside `if (viewer)` and
       * keys on `viewer.id`, so the steward's name travels to the one member
       * the note is about and to nobody else. The privacy line on warnings is
       * unchanged: they are still absent from /api/badges/of/:userId, from
       * /api/badges/match, and from every `holders` list.
       *
       * A LEFT JOIN, and a null name stays null. `awarded_by` is NULL when the
       * earned engine granted the badge, and a member who has left takes their
       * row with them. Inventing "a steward" for either would be a sentence
       * the product made up. The page says the date and stays quiet about the
       * person it cannot name.
       *
       * `created_at` is when it was placed and `updated_at` moves on a
       * re-issue, so both travel: an award renewed by a second steward would
       * otherwise pair a new name with the first date.
       */
      const [meta] = await getPool().query<any[]>(
        "SELECT a.badge_id, a.created_at, a.updated_at, u.name AS awarded_by_name " +
          "FROM badge_awards a LEFT JOIN users u ON u.id = a.awarded_by WHERE a.user_id = ?",
        [viewer.id],
      );
      const iso = (v: any) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
      const byBadge = new Map(meta.map((r) => [String(r.badge_id), r]));
      mine = {
        awards: awards.map((a) => {
          const row = byBadge.get(a.badgeId);
          return {
            ...a,
            awardedByName: row?.awarded_by_name ? firstName(String(row.awarded_by_name)) : null,
            awardedAt: iso(row?.created_at),
            lastChangedAt: iso(row?.updated_at),
          };
        }),
        skills: await skillsFor(getPool(), viewer.id),
      };
    }
    // Who holds each badge, and until when. Already public through
    // /api/badges/match and /api/badges/of/:userId, so the same privacy line
    // holds: WARNINGS ARE NEVER LISTED. Answering "who carries this trust,
    // and does it lapse" on the card itself is what makes a badge legible
    // without hunting, and it is how the standing examples demonstrate a
    // held badge to a founder who holds nothing yet.
    // Deliberately UNFILTERED by is_example: demonstrating a held badge is the
    // whole point of the example set. The flag rides along so the card can say
    // so, and so a prover can pick the example warning badge by identity
    // rather than by kind (which could land a real warning on a real admin).
    const [holderRows] = await getPool().query<any[]>(
      "SELECT a.badge_id, a.user_id, a.expires_at, a.is_example, u.name AS user_name " +
        "FROM badge_awards a JOIN badges b ON b.id = a.badge_id " +
        "JOIN users u ON u.id = a.user_id " +
        "WHERE b.kind <> 'warning' AND b.active = 1 " +
        "AND (a.expires_at IS NULL OR a.expires_at > NOW()) " +
        "ORDER BY a.created_at ASC",
    );
    const holdersByBadge = new Map<string, any[]>();
    for (const r of holderRows) {
      const list = holdersByBadge.get(String(r.badge_id)) ?? [];
      list.push({
        userId: String(r.user_id),
        name: firstName(String(r.user_name ?? "Member")),
        expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
        isExample: Number(r.is_example ?? 0) === 1,
      });
      holdersByBadge.set(String(r.badge_id), list);
    }
    res.json({
      badges: badges.map((b) => ({
        id: b.id, name: b.name, description: b.description, icon: b.icon, kind: b.kind,
        // Transparent governance: what a badge grants or denies is public.
        capabilities: b.capabilities, denies: b.denies, rule: b.rule,
        isExample: b.isExample,
        holders: b.kind === "warning" ? [] : (holdersByBadge.get(b.id) ?? []),
      })),
      mine,
    });
  });

  /** Self badges are the member's own act; every other kind refuses here. */
  /**
   * B9 (Wave 1): the two reads that unblock four surfaces — forum bylines,
   * map featured chips, the Team page, Maia's suggestion matching.
   *
   * Privacy line, drawn on purpose: WARNINGS ARE NEVER SERVED HERE. A
   * warning is a matter between the member and the village's stewards;
   * a public endpoint that lists them is a pillory. Only the member's own
   * /api/badges view and the admin surfaces carry warnings.
   */
  app.get("/api/badges/of/:userId", async (req, res) => {
    const [rows] = await getPool().query<any[]>(
      "SELECT b.id, b.name, b.kind, b.description, a.count, a.expires_at, a.featured FROM badge_awards a " +
        "JOIN badges b ON b.id = a.badge_id " +
        "WHERE a.user_id = ? AND b.active = 1 AND b.kind <> 'warning' " +
        "AND (a.expires_at IS NULL OR a.expires_at > NOW()) ORDER BY a.featured DESC, b.name",
      [String(req.params.userId)],
    );
    res.json({
      badges: rows.map((r) => ({
        id: r.id, name: r.name, kind: r.kind, description: r.description,
        count: Number(r.count), featured: !!r.featured,
        // Selected since this route shipped, used only to drop lapsed awards,
        // and never handed over, so a badge that runs out looked permanent
        // right up to the day it vanished. Same spelling as /api/badges.
        expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
      })),
      skills: await skillsFor(getPool(), String(req.params.userId)),
      maxFeatured: numberVar("badges.max_featured"),
    });
  });

  /**
   * B10: the featured picker. Chips are SELF-presentation — a member pins
   * which of their own badges ride their byline, capped by
   * badges.max_featured, and featuring nothing is a respected choice.
   * Warnings cannot be featured; they cannot even be addressed here.
   */
  app.put("/api/badges/featured", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in first" });
    const ids = Array.isArray(req.body?.badgeIds) ? req.body.badgeIds.map(String).slice(0, 20) : null;
    if (!ids) return res.status(400).json({ error: "badgeIds required (may be empty; a clean byline is a choice)" });
    const max = numberVar("badges.max_featured");
    if (ids.length > max) return res.status(400).json({ error: `Pick at most ${max}` });
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      await conn.query("UPDATE badge_awards SET featured = 0 WHERE user_id = ?", [user.id]);
      if (ids.length) {
        // Only the member's OWN, active, non-warning, unexpired awards.
        const [r] = await conn.query<any>(
          "UPDATE badge_awards a JOIN badges b ON b.id = a.badge_id SET a.featured = 1 " +
            "WHERE a.user_id = ? AND b.kind <> 'warning' AND b.active = 1 " +
            "AND (a.expires_at IS NULL OR a.expires_at > NOW()) AND a.badge_id IN (" + ids.map(() => "?").join(",") + ")",
          [user.id, ...ids],
        );
        if (Number((r as any).affectedRows) !== ids.length) {
          await conn.rollback();
          return res.status(400).json({ error: "You can only feature badges you actively hold" });
        }
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    res.json({ success: true });
  });

  /** Who holds a badge or a skill — matching, never surveillance: active,
   *  unexpired, non-warning awards only, names as the member set them. */
  app.get("/api/badges/match", async (req, res) => {
    const badgeId = String(req.query.badge ?? "");
    const skill = String(req.query.skill ?? "").toLowerCase();
    if (!badgeId && !skill) return res.status(400).json({ error: "say what to match: ?badge=<id> or ?skill=<tag>" });
    let rows: any[];
    if (badgeId) {
      [rows] = await getPool().query<any[]>(
        // u.is_example = 0: this surface exists to put real people in touch.
        // Example badges had no awards until 2026-08-02, so matching on one
        // returned nothing and the omission cost nothing; now a search for
        // who can moderate the forum would hand back a fictional person.
        "SELECT u.id, u.name, u.handle FROM badge_awards a JOIN badges b ON b.id = a.badge_id JOIN users u ON u.id = a.user_id " +
          "WHERE a.badge_id = ? AND b.active = 1 AND b.kind <> 'warning' AND u.is_example = 0 " +
          "AND (a.expires_at IS NULL OR a.expires_at > NOW()) " +
          "ORDER BY u.name LIMIT 100",
        [badgeId],
      );
    } else {
      [rows] = await getPool().query<any[]>(
        "SELECT u.id, u.name, u.handle FROM skill_tags s JOIN users u ON u.id = s.user_id WHERE s.tag = ? ORDER BY u.name LIMIT 100",
        [skill],
      );
    }
    res.json({ members: rows.map((r) => ({ id: r.id, name: r.name, handle: r.handle ?? null })) });
  });

  app.post("/api/badges/:id/claim", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in first" });
    const badge = await badgeById(getPool(), req.params.id);
    if (!badge || !badge.active) return res.status(404).json({ error: "No such badge" });
    // Otherwise every member could self-claim the example badge and the
    // definition would quietly accumulate real award rows.
    if (await isExampleRow(getPool(), "badges", req.params.id)) {
      return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    }
    if (badge.kind !== "self") {
      return res.status(403).json({ error: `"${badge.name}" is ${badge.kind}, it is not self-declared` });
    }
    await upsertAward(getPool(), { badgeId: badge.id, userId: user.id, awardedBy: user.id });
    res.json({ success: true });
  });

  app.delete("/api/badges/:id/claim", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in first" });
    const badge = await badgeById(getPool(), req.params.id);
    if (!badge || badge.kind !== "self") return res.status(404).json({ error: "No such self badge" });
    await getPool().query("DELETE FROM badge_awards WHERE badge_id = ? AND user_id = ?", [badge.id, user.id]);
    res.json({ success: true });
  });

  /** Skills gate nothing — they are searchable facts a member declares. */
  app.post("/api/badges/skills", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in first" });
    const tag = String(req.body?.tag ?? "").toLowerCase().trim().replace(/\s+/g, "-").slice(0, 40);
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(tag)) {
      return res.status(400).json({ error: "A skill is 2-40 characters: letters, numbers, dashes" });
    }
    if ((await skillsFor(getPool(), user.id)).length >= 20) {
      return res.status(409).json({ error: "Twenty skills is a portfolio. Retire one to add another" });
    }
    await addSkill(getPool(), user.id, tag);
    res.json({ success: true, skills: await skillsFor(getPool(), user.id) });
  });

  app.delete("/api/badges/skills/:tag", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in first" });
    await removeSkill(getPool(), user.id, String(req.params.tag));
    res.json({ success: true, skills: await skillsFor(getPool(), user.id) });
  });

  /** Admin overview: badges, every live award with names, engine info. */
  app.get("/api/admin/badges", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const badges = await allBadges(getPool());
    const [awards] = await getPool().query<any[]>(
      "SELECT a.*, u.name AS user_name, b.name AS badge_name, b.kind AS badge_kind FROM badge_awards a " +
        "LEFT JOIN users u ON u.id = a.user_id JOIN badges b ON b.id = a.badge_id ORDER BY a.updated_at DESC LIMIT 300",
    );
    res.json({ badges, awards, kinds: BADGE_KINDS });
  });

  app.post("/api/admin/badges", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const { name, description, icon, kind, capabilities, denies, rule, seasonScope, multiplier } = req.body ?? {};
    if (!String(name ?? "").trim()) return res.status(400).json({ error: "A name is required" });
    const candidate = {
      kind: String(kind ?? "granted"),
      capabilities: Array.isArray(capabilities) ? capabilities.map(String) : [],
      denies: Array.isArray(denies) ? denies.map(String) : [],
      rule: rule && typeof rule === "object" ? { metric: rule.metric, threshold: Number(rule.threshold), stackable: !!rule.stackable, maxStack: Number(rule.maxStack) || 1 } : null,
      // 0050. Carried into the validator AND the INSERT: the columns existed
      // with rules nothing could reach, so a multiplier could only ever be set
      // by hand-written SQL, which is the one path that validates nothing.
      seasonScope: seasonScope === "seasonal" ? "seasonal" : "permanent",
      multiplier: multiplier === undefined || multiplier === null || multiplier === "" ? null : Number(multiplier),
    };
    const problem = badgeProblem(candidate as any);
    if (problem) return res.status(400).json({ error: problem });
    const id = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || `badge-${Date.now()}`;
    if (await badgeById(getPool(), id)) return res.status(409).json({ error: `A badge with id "${id}" already exists` });
    await getPool().query(
      "INSERT INTO badges (id, name, description, icon, kind, capabilities, denies, rule, season_scope, multiplier) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [id, String(name).trim().slice(0, 120), description ?? null, icon ?? null, candidate.kind,
        JSON.stringify(candidate.capabilities), JSON.stringify(candidate.denies),
        candidate.rule ? JSON.stringify(candidate.rule) : null,
        candidate.seasonScope, candidate.multiplier],
    );
    onRealItemPublished(getPool(), "badges", adminActor(req)?.id ?? null);
    res.json({ success: true, badge: await badgeById(getPool(), id) });
  });

  app.put("/api/admin/badges/:id", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    // Inert: editing an example definition can give it capabilities.
    if (await isExampleRow(getPool(), "badges", req.params.id)) {
      return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    }
    const existing = await badgeById(getPool(), req.params.id);
    if (!existing) return res.status(404).json({ error: "No such badge" });
    const merged = {
      name: req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 120) : existing.name,
      description: req.body?.description !== undefined ? req.body.description : existing.description,
      icon: req.body?.icon !== undefined ? req.body.icon : existing.icon,
      kind: req.body?.kind !== undefined ? String(req.body.kind) : existing.kind,
      capabilities: req.body?.capabilities !== undefined ? (Array.isArray(req.body.capabilities) ? req.body.capabilities.map(String) : []) : existing.capabilities,
      denies: req.body?.denies !== undefined ? (Array.isArray(req.body.denies) ? req.body.denies.map(String) : []) : existing.denies,
      rule: req.body?.rule !== undefined
        ? (req.body.rule ? { metric: req.body.rule.metric, threshold: Number(req.body.rule.threshold), stackable: !!req.body.rule.stackable, maxStack: Number(req.body.rule.maxStack) || 1 } : null)
        : existing.rule,
      // 0050. Partial-update shape like every field above, so a client that
      // does not know about seasons cannot blank them by omission.
      seasonScope: req.body?.seasonScope !== undefined
        ? (req.body.seasonScope === "seasonal" ? "seasonal" : "permanent")
        : existing.seasonScope,
      multiplier: req.body?.multiplier !== undefined
        ? (req.body.multiplier === null || req.body.multiplier === "" ? null : Number(req.body.multiplier))
        : existing.multiplier,
      active: req.body?.active !== undefined ? !!req.body.active : existing.active,
    };
    const problem = badgeProblem(merged as any);
    if (problem) return res.status(400).json({ error: problem });
    // KIND IS THE AUTHORITY EACH AWARD WAS MADE UNDER. Flipping it
    // retroactively re-interprets every existing award: a self-claimed badge
    // reclassified to "granted" hands its holders whatever capabilities the
    // new definition carries, and badgeProblem's self-badge capability ban
    // never fires because it only sees the post-merge shape.
    //
    // Warn-and-proceed, not a hard block (Rye, 2026-07-31): the first PUT
    // answers 409 naming the stakes; a second with confirmKindChange: true
    // goes through, attributed. What may never happen is the change landing
    // SILENTLY — that is the defect, not the change itself.
    if (merged.kind !== existing.kind) {
      const [[awards]] = await getPool().query<any[]>(
        "SELECT COUNT(*) AS n FROM badge_awards WHERE badge_id = ?",
        [req.params.id],
      );
      const n = Number(awards.n);
      if (n > 0 && req.body?.confirmKindChange !== true) {
        return res.status(409).json({
          error: `This badge has ${n} award(s) made under its current kind ("${existing.kind}"). Changing it to "${merged.kind}" re-interprets what every one of those awards grants. Confirm to proceed anyway.`,
          awards: n,
          requiresConfirmation: true,
        });
      }
      if (n > 0) {
        void recordEvent(getPool(), {
          kind: "audit",
          text: `badge:kind-changed:${req.params.id}:${existing.kind}->${merged.kind}:${n}-awards`,
          actorUserId: (await authedUser(req))?.id ?? adminActor(req)?.id ?? null,
          entityType: "badge", entityRef: req.params.id, audience: "admin",
        });
      }
    }
    /*
     * THE SAME DEFECT, ONE FIELD OVER (task 30, closed here).
     *
     * `capabilities` and `denies` are the powers this badge hands out and
     * takes away, and until now a PUT rewrote them in silence. Every holder
     * gained or lost real access the moment the row changed, and nothing told
     * anybody: no confirmation in front of the person doing it, no line in
     * the trail naming what moved, no notification to the people it happened
     * to. The badge's KIND had all three, under a comment saying such a
     * change may never land silently. This is that comment applied to the
     * field it was actually about.
     *
     * Deliberately the SAME shape as the kind branch and not a second
     * pattern: count the awards, answer 409 naming the stakes in the
     * CAPABILITY_CONSEQUENCE sentences (they say what a holder could DO and
     * never the key), let a second call through with a flag, and write a
     * specific audit row. Warn and proceed, never a hard block: the change
     * itself is legitimate, and it is the silence that was the defect.
     */
    const capsBefore = new Set<string>((existing.capabilities ?? []).map(String));
    const capsAfter = new Set<string>(merged.capabilities.map(String));
    const deniesBefore = new Set<string>((existing.denies ?? []).map(String));
    const deniesAfter = new Set<string>(merged.denies.map(String));
    const gained = Array.from(capsAfter).filter((c) => !capsBefore.has(c));
    const lost = Array.from(capsBefore).filter((c) => !capsAfter.has(c));
    const newlyDenied = Array.from(deniesAfter).filter((c) => !deniesBefore.has(c));
    const undenied = Array.from(deniesBefore).filter((c) => !deniesAfter.has(c));
    const powerMoved = gained.length + lost.length + newlyDenied.length + undenied.length > 0;
    let holderIds: string[] = [];
    if (powerMoved) {
      const [holders] = await getPool().query<any[]>(
        "SELECT user_id FROM badge_awards WHERE badge_id = ? AND (expires_at IS NULL OR expires_at > NOW())",
        [req.params.id],
      );
      holderIds = holders.map((h: any) => String(h.user_id));
      if (holderIds.length > 0 && req.body?.confirmCapabilityChange !== true) {
        const say = (list: string[]) =>
          list.map((c) => liveConsequence(c)).join("; ");
        const parts: string[] = [];
        if (gained.length) parts.push(`they will be able to ${say(gained)}`);
        if (lost.length) parts.push(`they will no longer be able to ${say(lost)}`);
        if (newlyDenied.length) parts.push(`they will be stopped from being able to ${say(newlyDenied)}`);
        if (undenied.length) parts.push(`they will stop being stopped from being able to ${say(undenied)}`);
        return res.status(409).json({
          error:
            `${holderIds.length} ${holderIds.length === 1 ? "person holds" : "people hold"} this badge, and ` +
            `${parts.join(", ")}. They will be told. Confirm to go ahead.`,
          holders: holderIds.length,
          gained, lost, newlyDenied, undenied,
          requiresConfirmation: true,
        });
      }
    }
    await getPool().query(
      "UPDATE badges SET name=?, description=?, icon=?, kind=?, capabilities=?, denies=?, rule=?, season_scope=?, multiplier=?, active=? WHERE id=?",
      [merged.name, merged.description, merged.icon, merged.kind, JSON.stringify(merged.capabilities),
        JSON.stringify(merged.denies), merged.rule ? JSON.stringify(merged.rule) : null,
        merged.seasonScope, merged.multiplier, merged.active ? 1 : 0, req.params.id],
    );
    // Every AWARD leaves a trail; the DEFINITION they answer to did not.
    void recordEvent(getPool(), {
      kind: "audit", text: `badge:edit:${req.params.id}`,
      actorUserId: (await authedUser(req))?.id ?? adminActor(req)?.id ?? null,
      entityType: "badge", entityRef: req.params.id, audience: "admin",
    });
    if (powerMoved) {
      const actorId = (await authedUser(req))?.id ?? adminActor(req)?.id ?? null;
      void recordEvent(getPool(), {
        kind: "audit",
        text:
          `badge:capabilities-changed:${req.params.id}:+${gained.join("|") || "none"}` +
          `:-${lost.join("|") || "none"}:deny+${newlyDenied.join("|") || "none"}` +
          `:deny-${undenied.join("|") || "none"}:${holderIds.length}-holders`,
        actorUserId: actorId,
        entityType: "badge", entityRef: req.params.id, audience: "admin",
      });
      // The people it happened to hear about it. Dedupe key is stable per
      // (badge, holder, what moved), following the discipline the notify
      // spine states: one stable key per (event, recipient), never
      // Date.now(). Two admins making the same edit twice is one telling.
      const shape = [gained, lost, newlyDenied, undenied].map((l) => l.slice().sort().join(",")).join("|");
      const fingerprint = Buffer.from(shape).toString("base64url").slice(0, 40);
      const sentence = badgeChangeSentence(gained, lost, newlyDenied, undenied);
      for (const holderId of holderIds) {
        await notify({
          userId: holderId,
          type: "badge_definition_changed",
          title: `What "${merged.name}" carries has changed`,
          body: sentence,
          link: "/profile",
          actorUserId: actorId,
          dedupeKey: `badge-def:${req.params.id}:${holderId}:${fingerprint}`,
        });
      }
    }
    res.json({ success: true, badge: await badgeById(getPool(), req.params.id) });
  });

  /**
   * Award by hand: granted honors, warnings, hypha mirrors. Self is the
   * member's act and earned is the engine's — both refuse here, on purpose.
   */
  app.post("/api/admin/badges/:id/award", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const badge = await badgeById(getPool(), req.params.id);
    if (!badge) return res.status(404).json({ error: "No such badge" });
    // An award is the one thing that makes a definition live — a warning
    // example carries a real deny, so awarding it would suspend a real member.
    if (badge.isExample) return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    if (badge.kind === "self" || badge.kind === "earned") {
      return res.status(403).json({
        error: badge.kind === "self"
          ? "Self badges are the member's own declaration, not yours to make"
          : "Earned badges belong to the engine. Adjust the rule, then evaluate",
      });
    }
    const { userId, note, expiresAt } = req.body ?? {};
    const target = await members.byId(String(userId ?? ""));
    if (!target) return res.status(404).json({ error: "No such member" });
    // The revoke direction checks both sides; award checked only the badge. A
    // REAL warning on an example identity writes an is_example = 0 award, and
    // badgesOpenState counts exactly that shape — so the award survives the
    // holder's deletion at retirement and blocks turning badges off forever.
    if (isExampleUser(target)) return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    if (badge.kind === "warning" && !String(note ?? "").trim()) {
      return res.status(400).json({ error: "A warning needs a note. The member deserves to know why" });
    }
    const expiry = expiresAt ? new Date(String(expiresAt)) : null;
    const award = await upsertAward(getPool(), {
      badgeId: badge.id, userId: target.id, awardedBy: adminActor(req)?.id ?? null,
      note: note ?? null, expiresAt: expiry && !Number.isNaN(expiry.getTime()) ? expiry : null,
    });
    await notify({
      userId: target.id,
      type: "badge",
      title: badge.kind === "warning" ? `A warning was placed: ${badge.name}` : `Badge received: ${badge.name}`,
      body: note ? String(note).slice(0, 500) : null,
      link: "/badges",
      // Stable, like every other producer. With Date.now() in it the key was
      // unique per call, so the notify spine's whole dedupe guarantee was off
      // for this one path: a re-run of an award — a double-click, a retried
      // request — told the member twice that they had been given a badge, or
      // twice that a warning had been placed on them.
      dedupeKey: `award:${badge.id}:${target.id}`,
    });
    // B5: a re-issued WARNING is its own audit fact, with the running count
    // in the text — the trail an indefinitely-renewed silencing would leave.
    void recordEvent(getPool(), {
      kind: "audit",
      text: badge.kind === "warning" && award.reissued
        ? `badge:warning-reissue:${badge.id}:x${award.reissueCount + 1}`
        : `badge:${badge.kind}:${badge.id}`,
      actorUserId: adminActor(req)?.id ?? null,
      entityType: "user", entityRef: target.id, audience: "admin",
    });
    res.json({ success: true, reissued: award.reissued, reissueCount: award.reissueCount });
  });

  app.delete("/api/admin/badges/:id/award/:userId", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    // The award direction refuses examples; the revoke direction was missed,
    // and this is a raw DELETE that matches the seeded ex-award-* rows. One
    // click permanently emptied the holders demo with no tombstone stamped,
    // so the module still reported that it was showing examples.
    if (
      (await isExampleRow(getPool(), "badges", req.params.id)) ||
      (await isExampleRow(getPool(), "users", req.params.userId))
    ) {
      return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    }
    const [r] = await getPool().query<any>(
      "DELETE FROM badge_awards WHERE badge_id = ? AND user_id = ?",
      [req.params.id, req.params.userId],
    );
    if (!(r as any).affectedRows) return res.status(404).json({ error: "No such award" });
    void recordEvent(getPool(), {
      kind: "audit", text: `badge:revoke:${req.params.id}`, actorUserId: adminActor(req)?.id ?? null,
      entityType: "user", entityRef: String(req.params.userId), audience: "admin",
    });
    res.json({ success: true });
  });

  /** The manual evaluate button — same engine the cycle close runs. */
  app.post("/api/admin/badges/evaluate", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const result = await evaluateEarnedBadges(getPool());
    for (const t of result.newTiers) {
      const badge = await badgeById(getPool(), t.badgeId);
      await notify({
        userId: t.userId,
        type: "badge",
        title: t.tier > 1 ? `Badge upgraded: ${badge?.name ?? t.badgeId} ×${t.tier}` : `Badge earned: ${badge?.name ?? t.badgeId}`,
        link: "/badges",
        dedupeKey: `rule:${t.badgeId}:${t.userId}:tier-${t.tier}`,
      });
    }
    res.json(result);
  });
}
