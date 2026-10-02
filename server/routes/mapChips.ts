/**
 * The crown bar's chips: what each one reads, and the readings themselves.
 *
 *   GET /api/map/chips          the chips as the map draws them, for this viewer
 *   GET /api/admin/map/chips    the document, every source, and a preview
 *   PUT /api/admin/map/chips    replace the document
 *
 * Rye, deciding F29: the five sample numbers stay, marked as examples, until a
 * founder points a chip at a source in Village settings. The shapes, the
 * source list and the one function that resolves a chip are in
 * shared/mapStatChips.ts; the counting is in server/lib/mapStats.ts.
 *
 * THE GATES ARE THE ONES THE SKIN HAS. The public read sits under `/api/map`,
 * so `app.use("/api/map", requireModule("map"))` stands in front of it: 404
 * while the map is off, 401 for a stranger while it is members-only. The two
 * admin routes sit under `/api/admin/map`, behind the same module gate, and
 * ask `isAdmin` exactly as the skin's own save does (server/routes/brand.ts).
 * This file is registered after both `app.use` lines, which is what makes
 * that true: Express matches in registration order.
 *
 * THE DOCUMENT IS READ ONCE AND KEPT, like every `dbDocument`. This file is
 * its only writer, so the copy held here is the stored one. It loads on the
 * first request rather than at boot, because the boot list lives in
 * server/index.ts and that file's ratchet has no line to spare for it.
 */
import type express from "express";
import type { Express } from "express";
import {
  CHIP_ICONS,
  MAP_CHIPS_DOC,
  MAP_CHIPS_REFRESH_MS,
  STAT_SOURCES,
  STAT_SOURCE_KEYS,
  neededSources,
  resolveChips,
  sanitiseMapChips,
  type MapChipsDoc,
  type ResolvedChip,
} from "../../shared/mapStatChips";
import type { AppDeps } from "../lib/appDeps";
import { createStatReader, sourceHiddenFrom, type StatViewer } from "../lib/mapStats";
import { dbDocument } from "../repos/store-db";

type Deps = Pick<AppDeps, "isAdmin" | "authedUser" | "getPool" | "seasonState" | "lapseContext">;

/** A public chip carries no reason: a visitor is not told what they are not shown. */
function forVisitors(chips: ResolvedChip[]): ResolvedChip[] {
  return chips.filter((c) => c.state !== "unavailable").map(({ why: _why, ...rest }) => rest);
}

export function register(app: Express, deps: Deps): void {
  const { isAdmin, authedUser, getPool, seasonState, lapseContext } = deps;
  const doc = dbDocument<MapChipsDoc & Record<string, any>>(getPool(), MAP_CHIPS_DOC, {} as any);
  let loading: Promise<void> | null = null;
  const loaded = () => {
    loading ??= doc.load().catch((e) => {
      loading = null;
      throw e;
    });
    return loading;
  };
  /** The stored chips, or the five examples when nothing is stored. */
  const chipsNow = async () => {
    await loaded();
    return sanitiseMapChips(doc.exists() ? doc.get() : null).chips;
  };
  const stats = createStatReader({ getPool, seasonState, lapseContext });

  /** Who is asking, read once. A stranger costs no admin lookup. */
  async function viewerOf(req: express.Request): Promise<StatViewer> {
    const user = await authedUser(req);
    return { authed: !!user, admin: user ? await isAdmin(req) : false };
  }

  /**
   * What the map draws. Same answer for every visitor except where a source's
   * module is closed to them, and then that chip is left out.
   */
  app.get("/api/map/chips", async (req, res) => {
    const chips = await chipsNow();
    const readings = await stats.readings(neededSources(chips), await viewerOf(req));
    res.json({ chips: forVisitors(resolveChips(chips, readings)), refreshMs: MAP_CHIPS_REFRESH_MS });
  });

  /**
   * The editor's read: the document as stored, every source with whether the
   * village can draw it, and a preview resolved for a VISITOR. The founder is
   * shown what a stranger will see, reasons included, which is the view that
   * makes a chip that will not draw for the public visible before it ships.
   */
  async function editorView(chips: MapChipsDoc["chips"]) {
    const visitor: StatViewer = { authed: false, admin: false };
    const readings = await stats.readings(neededSources(chips), visitor);
    return {
      chips,
      preview: resolveChips(chips, readings),
      sources: STAT_SOURCE_KEYS.map((key) => ({
        key,
        ...STAT_SOURCES[key],
        hiddenFromVisitors: sourceHiddenFrom(key, visitor),
      })),
      icons: CHIP_ICONS,
    };
  }

  app.get("/api/admin/map/chips", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    res.json(await editorView(await chipsNow()));
  });

  /**
   * Replace the whole list. Sanitised here, at the boundary, because the
   * document leaves this system for the map artifact, which draws every
   * string in it.
   */
  app.put("/api/admin/map/chips", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    if (!req.body || typeof req.body !== "object" || !Array.isArray(req.body.chips)) {
      return res.status(400).json({ error: "Send the chips as a list." });
    }
    await loaded();
    const next = sanitiseMapChips({ chips: req.body.chips });
    await doc.put(next as any);
    stats.forget();
    res.json({ success: true, ...(await editorView(next.chips)) });
  });
}
