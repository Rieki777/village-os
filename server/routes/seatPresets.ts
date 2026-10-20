/**
 * THE VILLAGE'S OWN SEAT PRESETS (seat settings PR3).
 *
 *   GET /api/seat-presets          the village's presets, for a reader holding terms.read
 *   GET /api/admin/seat-presets    the document as stored, for the editor
 *   PUT /api/admin/seat-presets    replace the document (the founding write)
 *
 * A preset is a starting point for one group of a seat's terms. The platform's
 * presets (shared/seatPresets.ts) are shapes with blank amounts and ship in
 * code; a village's own carry the village's figures and live here, as data,
 * in the `seat-presets` app_config document. Rows are `custom:<slug>` ids,
 * RETIRED AND NEVER DELETED, and the rules a write must meet are
 * `seatPresetsDocProblems` in shared/seatTermsOffer.ts, the same sentences the
 * editor shows.
 *
 * THE READ IS THE OPEN BOOK'S GATE. A village's presets carry its money, so
 * they are read on the same key the terms on a seat are: `terms.read`, which
 * opens at the member rung. A visitor and a signed-in guest are both told 401
 * and nothing else, so the answer cannot say whether the village has any.
 *
 * THE WRITE IS ADMIN TODAY. PR9 moves it to a proposal adopted by the power
 * that adopts seats; until then a founder sets the library up here, from the
 * org chart tab. Nothing here records a public event: the document is the
 * record, and its words name amounts.
 *
 * THE DOCUMENT IS RE-READ ON EVERY REQUEST. It is one primary-key read, and a
 * cached copy would serve a stale library on a second instance after a save.
 */
import type { Express } from "express";
import { hasCapability } from "../../shared/capabilities";
import {
  cleanSeatPresetsDoc,
  SEAT_PRESETS_DOC,
  seatPresetsDocProblems,
  villagePresetsFrom,
  type SeatPresetsDoc,
} from "../../shared/seatTermsOffer";
import type { AppDeps } from "../lib/appDeps";
import { dbDocument } from "../repos/store-db";

type Deps = Pick<AppDeps, "isAdmin" | "authedUser" | "capabilityCtx" | "getPool">;

export function register(app: Express, deps: Deps): void {
  const { isAdmin, authedUser, capabilityCtx, getPool } = deps;
  const docNow = async () => {
    const doc = dbDocument<SeatPresetsDoc & Record<string, any>>(getPool(), SEAT_PRESETS_DOC, { presets: [] });
    await doc.load();
    return doc;
  };

  app.get("/api/seat-presets", async (req, res) => {
    const viewer = await authedUser(req);
    if (!viewer || !hasCapability("terms.read", await capabilityCtx(viewer))) {
      return res.status(401).json({ error: "auth_required", message: "Members read the village's seat presets" });
    }
    const doc = await docNow();
    res.json({ presets: villagePresetsFrom(doc.get()) });
  });

  app.get("/api/admin/seat-presets", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const doc = await docNow();
    res.json({ presets: (doc.get() as SeatPresetsDoc).presets ?? [] });
  });

  app.put("/api/admin/seat-presets", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const doc = await docNow();
    const next = { presets: Array.isArray(req.body?.presets) ? req.body.presets : null };
    const problems = seatPresetsDocProblems(next, doc.exists() ? doc.get() : null);
    if (problems.length > 0) return res.status(400).json({ error: "invalid_presets", message: problems[0], problems });
    // Rebuilt from the known fields (red team S7): an unknown key is never stored.
    const clean = cleanSeatPresetsDoc(next as SeatPresetsDoc);
    await doc.put(clean as SeatPresetsDoc & Record<string, any>);
    res.json({ success: true, presets: clean.presets });
  });
}
