/**
 * The village's circles, as an admin creates, edits and removes them.
 *
 * MOVED OUT OF server/index.ts for two reasons that arrived together. That file
 * sits at a size ratchet that only turns down, and WHERE A CIRCLE SITS became
 * something people edit: from this form, from the admin Org Chart tab's picker,
 * and next from a drag on the map. Its rules need one home.
 *
 * ── WHERE A CIRCLE SITS ──────────────────────────────────────────────────
 *
 * `parentCircleId` is the only column that says which circle holds which. It
 * had one writer that could set it, a blind body spread on PUT, and one check,
 * self-parent. Three rules now, and they live in shared/circleView.ts so the
 * picker, the drag and these routes cannot disagree:
 *
 *   - the parent must exist;
 *   - the parent may not be a standing example, because examples are removed
 *     when a village publishes its own circles and would strand a real one;
 *   - the move may not close a loop, which used to draw an EMPTY map.
 *
 * And a circle with circles inside it is not deleted out from under them, the
 * same refusal the route already gave for seats.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { EXAMPLE_REFUSAL_BODY, isExampleRow, onRealItemPublished } from "../lib/examples";
import { listOrgRoles } from "../lib/orgChart";
import { CIRCLE_STATUSES } from "../../shared/draftKinds";
import { parentingRefusal } from "../../shared/circleView";

type Deps = Pick<AppDeps, "isAdmin" | "adminActor" | "circlesRepo" | "getPool" | "loadRoles">;

export function register(app: Express, deps: Deps): void {
  const { isAdmin, adminActor, circlesRepo, getPool, loadRoles } = deps;

  app.post("/api/admin/circles", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const { id, name } = req.body ?? {};
    // A name in any non-Latin script slugifies to "" — so a village writing
    // Russian, Japanese or Arabic could not create a circle AT ALL, and the
    // admin form offers no slug field to work around it. Fall back to a
    // generated id, and cap at the varchar(64) the PK actually is (names
    // allow 120, so a long ASCII name overflowed it too).
    const slug =
      String(id ?? name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) ||
      `circle-${Date.now().toString(36)}`;
    if (!String(name ?? "").trim()) return res.status(400).json({ error: "A name is required" });
    if (circlesRepo.all().some((c: any) => c.id === slug)) return res.status(409).json({ error: "That circle already exists" });
    // A new circle may be created INSIDE another. It has no children yet, so
    // it cannot close a loop; a parent can still be missing or a standing
    // example, and those are refused in words (shared/circleView.ts).
    const parentId = req.body?.parentCircleId ? String(req.body.parentCircleId) : null;
    const parentRefused = parentingRefusal(circlesRepo.all() as any[], slug, parentId);
    if (parentRefused) return res.status(400).json(parentRefused);
    const circle = {
      id: slug,
      name: String(name).trim().slice(0, 120),
      purpose: req.body.purpose ?? null,
      aliases: Array.isArray(req.body.aliases) ? req.body.aliases : [],
      parentCircleId: parentId,
      leadRoleId: req.body.leadRoleId ?? null,
      icon: req.body.icon ?? null,
      color: req.body.color ?? null,
      status: (CIRCLE_STATUSES as readonly string[]).includes(req.body.status) ? req.body.status : "active",
      order: circlesRepo.all().length + 1,
    };
    await circlesRepo.insert(circle);
    onRealItemPublished(getPool(), "map", adminActor(req)?.id ?? null);
    res.json(circle);
  });

  app.put("/api/admin/circles/:id", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const all = circlesRepo.all();
    const idx = all.findIndex((c: any) => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    // Pinning the flag stops laundering but not the edit itself: the row stays
    // an example, so retirement deletes the founder's own words the moment
    // they publish a real circle. Refuse, like every sibling module.
    if (await isExampleRow(getPool(), "circles", req.params.id)) {
      return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    }
    /*
     * Validate what the editor now sends, because `replaceAll` is a DELETE-all
     * plus a re-INSERT of every circle inside one transaction: a `status` that
     * misses the MySQL enum rolls back the WHOLE circles table, so one bad
     * dropdown value would look like "nothing saved" across every row. The
     * create route already whitelists status and caps the name at the
     * varchar(120); the edit route accepted anything.
     */
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: "blank_name", message: "A circle needs a name. It is the heading /circles, /roles and /team print." });
      if (name.length > 120) return res.status(400).json({ error: "name_too_long", message: "A circle name is at most 120 characters." });
      req.body.name = name;
    }
    if (req.body?.status !== undefined && !(CIRCLE_STATUSES as readonly string[]).includes(String(req.body.status))) {
      return res.status(400).json({
        error: "unknown_status",
        message: `A circle is ${CIRCLE_STATUSES.join(", ")}. "${String(req.body.status)}" is none of those.`,
      });
    }
    if (req.body?.purpose !== undefined) {
      const purpose = String(req.body.purpose ?? "").trim();
      if (purpose.length > 2000) return res.status(400).json({ error: "purpose_too_long", message: "A circle purpose is at most 2000 characters." });
      req.body.purpose = purpose || null;
    }
    // isExample is pinned exactly like id: a request body may not forge the
    // flag onto a real row, nor strip it off an example to launder it.
    const merged = { ...all[idx], ...req.body, id: all[idx].id, isExample: all[idx].isExample };
    // An alias maps to exactly ONE circle: reject collisions with any other
    // circle's name or aliases — a quest resolving two ways is a data bug.
    const aliases: string[] = Array.isArray(merged.aliases) ? merged.aliases.map((a: any) => String(a)) : [];
    for (const alias of aliases) {
      const lower = alias.toLowerCase();
      const clash = all.some(
        (c: any, j: number) =>
          j !== idx &&
          (String(c.name).toLowerCase() === lower ||
            (c.aliases ?? []).some((x: string) => String(x).toLowerCase() === lower)),
      );
      if (clash) return res.status(409).json({ error: `Alias "${alias}" already resolves to another circle` });
    }
    /*
     * WHERE THIS CIRCLE SITS, checked only when this request MOVES it, so a
     * rename is never refused over a parent nobody touched. "" is the admin
     * picker's "at the top". Self-parent, a missing or example parent and a
     * loop are all refused in words by `parentingRefusal`, the same rules the
     * picker and the map drag offer choices from (shared/circleView.ts).
     */
    if (req.body?.parentCircleId !== undefined) {
      merged.parentCircleId = req.body.parentCircleId ? String(req.body.parentCircleId) : null;
      const refused = parentingRefusal(all as any[], merged.id, merged.parentCircleId);
      if (refused) return res.status(400).json(refused);
    }
    all[idx] = { ...merged, aliases };
    await circlesRepo.replaceAll(all);
    res.json(all[idx]);
  });

  app.delete("/api/admin/circles/:id", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    // Deleting examples one by one empties the map with no tombstone stamped,
    // so modulesWithExamples still names the module and the banner keeps
    // promising circles that are gone. The clear endpoint is the way out.
    if (await isExampleRow(getPool(), "circles", req.params.id)) {
      return res.status(409).json(EXAMPLE_REFUSAL_BODY);
    }
    // Both planes can point at a circle: permission groups carry a circleId
    // from 0018, and org seats carry one from 0049. Deleting a circle out
    // from under either one orphans a reference the database cannot catch,
    // because nothing in drizzle/ has a foreign key.
    const referencing = loadRoles().filter((r: any) => r.circleId === req.params.id);
    const seatsHere = (await listOrgRoles(getPool())).filter((r) => r.circleId === req.params.id);
    const stillHere = referencing.length + seatsHere.length;
    if (stillHere) {
      return res.status(409).json({ error: `${stillHere} seat(s) still orbit this circle, reassign them first` });
    }
    // The same refusal as the seats above, one level up: deleting a circle
    // with circles inside it would leave each of them pointing at a parent that
    // is gone, drawn at the top of the map with nothing to say why.
    const inside = circlesRepo.all().filter((c: any) => c.parentCircleId === req.params.id);
    if (inside.length) {
      return res.status(409).json({
        error: "circle_has_children",
        message: `${inside.length} circle(s) still sit inside this one. Move them out first.`,
      });
    }
    const remaining = circlesRepo.all().filter((c: any) => c.id !== req.params.id);
    if (remaining.length === circlesRepo.all().length) return res.status(404).json({ error: "Not found" });
    await circlesRepo.replaceAll(remaining);
    res.json({ success: true });
  });
}
