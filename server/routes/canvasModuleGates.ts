/**
 * THE TWO GOVERNANCE CANVAS MODULES' GATES (Rye's module ruling, 2026-10-01).
 *
 * The canvas build shipped its routes as core. The ruling made it two
 * optional modules, both off by default, and this file is where their doors
 * close: one `requireModule` mount per prefix, registered BEFORE every canvas
 * and conflict route module in server/index.ts, because Express matches in
 * registration order and a route registered ahead of its gate would answer
 * with the module off.
 *
 *   canvas               /api/canvas, every path under it: the readings, the
 *                        season, the five frames, suggestions and adoption,
 *                        the Decision Matrix and its human rows, the public
 *                        lines and the canvas moon.
 *   conflict-evolution   /api/conflict-agreement (the agreement, its public
 *                        view and the ombuds door), /api/admin/conflict-agreement,
 *                        /api/care (no route yet; it mounts behind this the day
 *                        it lands), and the agreement's change vote, which
 *                        lives under the governance engine's prefix and so
 *                        passes both gates.
 *
 * The prefixes are read from the registry (`apiPrefixes`, shared/modules.ts)
 * so the mounted list and the listed one cannot drift. The change vote's path
 * is the one exception, because its prefix belongs to the governance module.
 *
 * WHAT A REFUSAL LOOKS LIKE is the platform's, unchanged: off is a 404 with
 * `module_disabled`, preview answers only an admin, members answers 401 to a
 * visitor, and public lets everybody through to each route's own rule. So a
 * visitor reads the canvas's public lines only while the canvas is public.
 */
import type { Express } from "express";
import { MODULES_BY_ID } from "../../shared/modules";
import { CANVAS_MODULE_ID, CONFLICT_EVOLUTION_MODULE_ID } from "../../shared/launchRequirements";
import { requireModule } from "../lib/modules";

/** The conflict agreement's change vote, under the governance engine's own prefix. */
export const AGREEMENT_VOTE_PATH = "/api/governance/conflict-agreement-changes";

export function register(app: Express): void {
  for (const id of [CANVAS_MODULE_ID, CONFLICT_EVOLUTION_MODULE_ID]) {
    const def = MODULES_BY_ID[id];
    if (!def) throw new Error(`[canvas-modules] "${id}" is not in the module registry`);
    for (const prefix of def.apiPrefixes) app.use(prefix, requireModule(id));
  }
  app.use(AGREEMENT_VOTE_PATH, requireModule(CONFLICT_EVOLUTION_MODULE_ID));
}
