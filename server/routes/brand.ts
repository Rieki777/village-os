/**
 * The brand overlay: the white-label layer a village writes to make the
 * platform its own.
 *
 *   GET /api/admin/brand   the stored overlay, plus the platform defaults
 *   PUT /api/admin/brand   merge an incoming overlay section-by-section
 *
 * Two routes, lifted out of `server/index.ts` unchanged. WHY THEY MOVED: that
 * file is on a ratchet that sits at exactly its baseline and may only ever
 * turn down, so it has no room for a line, and the only lines the ratchet
 * exempts are a route-module import and its register call. Every lane that
 * needs to touch an admin route is meeting the same wall; this is 32 lines of
 * it, and the headroom belongs to whoever needs it next rather than to the
 * change that happened to free it.
 *
 * WHAT THE OVERLAY IS, because the merge below only makes sense with it. Every
 * field is a value that BEATS the compiled default when it is non-empty, and
 * an empty string means "inherit" rather than "blank". That is why the PUT
 * merges each section over the one already stored instead of replacing the
 * document: a wizard tab posts back the section it edited, and the sections it
 * knows nothing about must survive it untouched.
 *
 * THE THREE FIELDS THAT ARE NOT A PLAIN SPREAD each carry their reason inline
 * below. They came with the code and they are the substance of this file:
 * orphaned alt text is stripped on the way in as well as out, the theme is
 * validated at emission rather than here, and the map skin is sanitised at the
 * boundary because it leaves this system for a separate artifact.
 *
 * REGISTERED WHERE IT WAS. `register()` is called from startServer at exactly
 * the point these routes used to occupy, because Express matches in
 * registration order.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { sanitiseMapSkin } from "../../shared/mapSkin";
import { normaliseProjectCurrency } from "../../shared/money";
import { GAME_CONFIG } from "../../shared/gameConfig";

/** The brand document as this module hands it back and takes it in. */
type BrandDocument = Record<string, any>;

type Deps = Pick<AppDeps, "isAdmin" | "brandRepo"> & {
  /**
   * The stored overlay rebuilt over the platform defaults, section by section.
   * It stays in the boot closure rather than moving here with the routes: a
   * dozen other readers in `server/index.ts` call it, and dragging them all
   * into one extraction would make this change about something else.
   */
  getBrand(): BrandDocument;
  /** Drops an alt-text key whose image slot is empty. Same reason on read and write. */
  withoutOrphanedAlt<T extends Record<string, any>>(images: T): T;
};

export function register(app: Express, deps: Deps): void {
  const { isAdmin, brandRepo, getBrand, withoutOrphanedAlt } = deps;

  app.get("/api/admin/brand", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    // The compiled defaults are read straight from the shared config rather
    // than passed in: they are the same for every village and every process,
    // so a closure around them would only be a longer way to say it.
    res.json({
      brand: getBrand(),
      defaults: { project: GAME_CONFIG.project, currency: GAME_CONFIG.currency, images: GAME_CONFIG.images },
    });
  });

  app.put("/api/admin/brand", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    if (!req.body || typeof req.body !== "object") return res.status(400).json({ error: "Body required" });
    // The one overlay field that is a CODE rather than words, so it is
    // normalised and judged before it is merged. Why, and why whitespace
    // normalises to blank rather than being refused: shared/money.ts.
    const badCurrency = normaliseProjectCurrency(req.body.project);
    if (badCurrency) return res.status(400).json({ error: badCurrency });
    const current = getBrand();
    const next = {
      project: { ...current.project, ...(req.body.project ?? {}) },
      currency: { ...current.currency, ...(req.body.currency ?? {}) },
      // Stripped on the way in as well as on the way out: a wizard tab opened
      // before this change still holds `faviconAlt` in the object it posts
      // back, and storing it again would put the orphan straight back.
      images: withoutOrphanedAlt({ ...current.images, ...(req.body.images ?? {}) }),
      setup: { ...current.setup, ...(req.body.setup ?? {}) },
      // Theme fields are validated at EMISSION (server/lib/themeCss.ts), not
      // here — storing a value the sanitiser later rejects yields an empty
      // stylesheet, never an injected one. Rejecting at write time too would
      // mean two sanitisers to keep in agreement forever.
      theme: { ...(current as any).theme, ...(req.body.theme ?? {}) },
      identityPack: { ...(current as any).identityPack, ...(req.body.identityPack ?? {}) },
      // Sanitised on write (unlike theme) because this object is handed to the
      // map artifact and two of its fields land in CSS custom properties. The
      // artifact is a separate document doing its own thing with them, so the
      // check belongs at the boundary where the value enters storage.
      skin: sanitiseMapSkin({ ...(current as any).skin, ...(req.body.skin ?? {}) }),
    };
    await brandRepo.put(next);
    res.json({ success: true, brand: next });
  });
}
