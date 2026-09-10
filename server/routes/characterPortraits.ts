/**
 * The portrait studio's door: a member's own picture for a class.
 *
 *   GET    /api/me/portraits                 everything of mine, plus the budget
 *   POST   /api/me/portraits/:key/upload     a file I chose. Costs nothing.
 *   POST   /api/me/portraits/:key/forge      spend a grant, get a candidate
 *   POST   /api/me/portraits/:key/keep       the candidate becomes my portrait
 *   POST   /api/me/portraits/:key/discard    drop it. The grant stays spent.
 *   POST   /api/me/portraits/:key/publish    show it on my public sheet, or stop
 *   DELETE /api/me/portraits/:key            remove it entirely
 *
 * A ROUTE MODULE AND NOT `server/index.ts`, because that file is at its
 * ratchet on both counts (`scripts/server-index-size-baseline.json`) and a
 * route added there would have to be paid for by deleting one. A file under
 * `server/routes/` costs nothing on either metric by construction, which is
 * what the guard is pushing every new route toward.
 *
 * ── EVERY ROUTE HERE IS SCOPED TO THE CALLER, AND NONE TAKES AN OWNER ───
 *
 * The path carries an archetype key and never a member id. There is no
 * parameter on any of these seven routes that could name somebody else, so
 * there is no route here that can be pointed at another member's portrait even
 * by a caller trying to. Reading somebody else's happens on the profile
 * payload, where `portraitsByArchetype` is handed a viewer and answers from
 * `publishedPortraitsOf`.
 *
 * ── AUTHORISE BEFORE MULTER ─────────────────────────────────────────────
 *
 * Same rule the place-photo door carries: a gate behind the parser still lets
 * any caller make the server write to the village's shared volume as fast as it
 * can send. The signed-in check runs first, and multer runs inside the handler
 * only once we know who is asking.
 */
import type { Express, Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import type { AppDeps } from "../lib/appDeps";
import { CarriesLocationData, LocationDataSurvived, stampedName, writeToVolume } from "../lib/uploads";
import { listArchetypes } from "../lib/characters";
import {
  ACCEPTED_PORTRAIT_TYPES,
  MAX_PORTRAIT_BYTES,
  NO_FORGE_MESSAGE,
  PORTRAIT_HEIGHT,
  PORTRAIT_WIDTH,
  isPortraitMimeType,
  portraitForge,
  portraitUrl,
  studioView,
  writePortrait,
} from "../lib/characterPortraits";
import * as portraits from "../repos/characterPortraits";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "uploadsDir">;

/** Same scope column the 0069+ tables carry, and the same value. */
const PORTRAIT_VILLAGE = "local";

/**
 * Unlink a file the volume no longer has a row for.
 *
 * Never throws. A portrait whose row is gone and whose bytes linger is a wasted
 * few hundred kilobytes; a handler that threw here would turn that into a
 * failed request for a member whose change actually landed. The sweep in
 * `livePortraitFiles` is the belt.
 */
function forgetFile(uploadsDir: string, fileName: string | null | undefined): void {
  const name = String(fileName ?? "").trim();
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) return;
  try {
    fs.unlinkSync(path.join(uploadsDir, name));
  } catch {
    /* already gone, or never written */
  }
}

/**
 * Move a withdrawn portrait's bytes to a name nobody has been handed, and say
 * whether the old address is really dead.
 *
 * COPY, ADOPT, THEN UNLINK, and no other order works. A rename before the row
 * is updated leaves the row naming a file that is gone, which is a broken
 * image for the owner; an unlink before the row is updated is the same thing
 * with the bytes destroyed. Copying first means both files exist while the row
 * moves, and the worst case is one orphan the uploads sweep collects.
 *
 * Returns false, never throws. The withdrawal itself has already been written
 * by the time this runs, so a throw here would report failure for a change
 * that landed. The caller passes the answer on to the member instead.
 */
async function revokeAddress(
  uploadsDir: string,
  pool: ReturnType<AppDeps["getPool"]>,
  userId: string,
  archetypeKey: string,
  fileName: string | null | undefined,
): Promise<boolean> {
  // A row that held only a candidate has no published address to revoke, so
  // there is nothing to do and the answer is honestly yes.
  const from = String(fileName ?? "").trim();
  if (!from) return true;
  if (from.includes("/") || from.includes("\\") || from.includes("..")) return false;

  let to: string;
  try {
    const bytes = fs.readFileSync(path.join(uploadsDir, from));
    to = stampedName("portrait", path.extname(from) || ".webp");
    writeToVolume(uploadsDir, to, bytes);
  } catch (err: any) {
    // The file is already gone, so the address is already dead. Any other
    // failure means the copy did not happen and the old name still resolves.
    if (err?.code === "ENOENT") return true;
    console.error(`[portraits] could not copy "${from}" while withdrawing: ${err?.message ?? err}`);
    return false;
  }

  const adopted = await portraits.renamePortraitFile(
    pool, PORTRAIT_VILLAGE, userId, archetypeKey, from, to,
  );
  if (!adopted) {
    // The row moved under us: the member replaced the picture between the read
    // and this write. The copy is unwanted and the file it was made from is
    // one the newer write already dealt with.
    forgetFile(uploadsDir, to);
    return false;
  }
  forgetFile(uploadsDir, from);
  return true;
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, uploadsDir } = deps;

  /**
   * The archetype key, checked against THIS VILLAGE's own rows.
   *
   * Checked against the data and never against the five seeded constants, the
   * same call `addCharacter` makes and for the same reason: a village that has
   * renamed or removed a class gets the answer its own data gives. It also
   * means the key reaching a filename lookup or a provider prompt is one this
   * village published, and not a string a caller invented.
   */
  async function knownArchetype(key: string): Promise<{ key: string; name: string } | null> {
    const all = await listArchetypes(getPool(), PORTRAIT_VILLAGE);
    return all.find((a) => a.key === key) ?? null;
  }

  /** Signed in, and the class exists. Every route starts here. */
  async function standing(
    req: Request,
    res: Response,
  ): Promise<{ user: any; archetype: { key: string; name: string } } | null> {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required", message: "Sign in first" });
      return null;
    }
    const archetype = await knownArchetype(String(req.params.key ?? ""));
    if (!archetype) {
      res.status(404).json({ error: "There is no such path in this village" });
      return null;
    }
    return { user, archetype };
  }

  app.get("/api/me/portraits", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in first" });
    res.json(await studioView(getPool(), PORTRAIT_VILLAGE, user.id));
  });

  /**
   * Upload my own picture. FREE, and always available.
   *
   * This is the half that has to work with no provider anywhere, so nothing in
   * it touches the budget, reads `hasPortraitForge` or can be affected by
   * either.
   */
  app.post("/api/me/portraits/:key/upload", async (req, res) => {
    const who = await standing(req, res);
    if (!who) return;

    const parse = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: MAX_PORTRAIT_BYTES, files: 1 },
      fileFilter: (_r, file, cb) => {
        if (isPortraitMimeType(file.mimetype)) cb(null, true);
        else cb(new Error(`Send a ${ACCEPTED_PORTRAIT_TYPES} picture.`));
      },
    }).single("portrait");

    parse(req as any, res as any, async (err: any) => {
      if (err) {
        const tooBig = String(err?.code ?? "") === "LIMIT_FILE_SIZE";
        return res.status(400).json({
          error: tooBig
            ? `That picture is over ${Math.round(MAX_PORTRAIT_BYTES / (1024 * 1024))} MB. Send a smaller one.`
            : String(err?.message ?? "That file did not arrive."),
        });
      }
      const file = (req as any).file;
      if (!file?.buffer?.length) return res.status(400).json({ error: "Choose a picture first." });

      try {
        const written = await writePortrait(file.buffer, uploadsDir);
        const existing = await portraits.portraitFor(
          getPool(), PORTRAIT_VILLAGE, who.user.id, who.archetype.key,
        );
        await portraits.upsertPortrait(getPool(), {
          id: `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          villageId: PORTRAIT_VILLAGE,
          userId: who.user.id,
          archetypeKey: who.archetype.key,
          fileName: written.fileName,
          source: "uploaded",
          width: written.width,
          height: written.height,
          bytes: written.bytes,
        });
        // The row now points somewhere else, so the bytes it used to point at
        // are unreachable. Dropped AFTER the write lands, never before: a
        // failed upsert would otherwise leave the member with no picture at
        // all where they had one a moment ago.
        forgetFile(uploadsDir, existing?.fileName);
        forgetFile(uploadsDir, existing?.candidateFileName);
        res.json({ success: true, ...(await studioView(getPool(), PORTRAIT_VILLAGE, who.user.id)) });
      } catch (e: any) {
        if (e instanceof CarriesLocationData) return res.status(400).json({ error: e.message });
        if (e instanceof LocationDataSurvived) {
          return res.status(400).json({
            error: "That picture kept its hidden data through the strip, so it was not stored. Try another.",
          });
        }
        // sharp missing is the one failure worth naming apart from the rest:
        // it is an operator problem and a member retrying will never fix it.
        const missing = /sharp/i.test(String(e?.message ?? ""));
        return res.status(missing ? 503 : 400).json({
          error: missing
            ? "Pictures cannot be processed on this deployment right now."
            : "That picture could not be read. Try another.",
        });
      }
    });
  });

  /**
   * Spend a grant and forge a candidate.
   *
   * ── THE ORDER HERE IS THE WHOLE SPEC ────────────────────────────────
   *
   * The grant is taken FIRST, atomically, and only then does the provider run.
   * Running the provider first and charging afterwards would let two requests
   * arriving together both be generated on one grant.
   *
   * A DISCARD SPENDS. That is decided by this route taking the grant before
   * anything is shown, and by `discard` never refunding. The client says so
   * before the member commits, which is the half that makes it fair.
   *
   * A MISSING PROVIDER IS NOT A DISCARD, and it refunds. The member saw
   * nothing, chose nothing and got nothing, so charging them would be charging
   * for our own absence. Same for a provider that throws.
   */
  app.post("/api/me/portraits/:key/forge", async (req, res) => {
    const who = await standing(req, res);
    if (!who) return;
    const pool = getPool();

    const took = await portraits.spendGrant(pool, PORTRAIT_VILLAGE, who.user.id);
    if (!took) {
      return res.status(409).json({
        error: "no_grants",
        message: "You have no forge gifts waiting. Uploading your own picture is always free.",
        ...(await studioView(pool, PORTRAIT_VILLAGE, who.user.id)),
      });
    }

    const forge = portraitForge();
    if (!forge) {
      await portraits.refundGrant(pool, PORTRAIT_VILLAGE, who.user.id);
      return res.status(503).json({
        error: "no_forge",
        message: NO_FORGE_MESSAGE,
        ...(await studioView(pool, PORTRAIT_VILLAGE, who.user.id)),
      });
    }

    try {
      const bytes = await forge.render({
        archetypeKey: who.archetype.key,
        archetypeName: who.archetype.name,
        presentation: String((req.body ?? {}).presentation ?? "f"),
        tone: String((req.body ?? {}).tone ?? "olive"),
        note: String((req.body ?? {}).note ?? "").slice(0, 500),
      });
      // A provider's bytes go through the SAME crop and the SAME strip as a
      // member's upload. Nothing about being generated makes a picture trusted.
      const written = await writePortrait(bytes, uploadsDir);
      const existing = await portraits.portraitFor(pool, PORTRAIT_VILLAGE, who.user.id, who.archetype.key);
      await portraits.stageCandidate(pool, {
        id: `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        villageId: PORTRAIT_VILLAGE,
        userId: who.user.id,
        archetypeKey: who.archetype.key,
        fileName: written.fileName,
      });
      // A candidate that was already waiting has been replaced by this one.
      forgetFile(uploadsDir, existing?.candidateFileName);
      res.json({
        success: true,
        candidateUrl: portraitUrl(written.fileName),
        ...(await studioView(pool, PORTRAIT_VILLAGE, who.user.id)),
      });
    } catch {
      await portraits.refundGrant(pool, PORTRAIT_VILLAGE, who.user.id);
      res.status(502).json({
        error: "forge_failed",
        message: "The forge could not make a picture just now. Your gift has been given back.",
        ...(await studioView(pool, PORTRAIT_VILLAGE, who.user.id)),
      });
    }
  });

  /** Accept the candidate. It becomes the portrait, and the old file goes. */
  app.post("/api/me/portraits/:key/keep", async (req, res) => {
    const who = await standing(req, res);
    if (!who) return;
    const pool = getPool();
    const existing = await portraits.portraitFor(pool, PORTRAIT_VILLAGE, who.user.id, who.archetype.key);
    if (!existing?.candidateFileName) {
      return res.status(404).json({ error: "There is nothing waiting for you to decide on." });
    }
    const previous = existing.fileName;
    // The candidate was written by `writePortrait`, so it is already exactly
    // PORTRAIT_WIDTH by PORTRAIT_HEIGHT. Read the byte count off the volume
    // instead of trusting a number carried through two requests.
    let bytes: number | null = null;
    try {
      bytes = fs.statSync(path.join(uploadsDir, existing.candidateFileName)).size;
    } catch {
      /* the row is still right even when the size is not readable */
    }
    // The dimensions are KNOWN and are not guessed: `writePortrait` cropped
    // this file to exactly these two numbers before it ever reached the volume,
    // so recording NULL here would throw away a fact the encoder guarantees.
    const kept = await portraits.keepCandidate(pool, PORTRAIT_VILLAGE, who.user.id, who.archetype.key, {
      width: PORTRAIT_WIDTH, height: PORTRAIT_HEIGHT, bytes,
    });
    if (!kept) return res.status(409).json({ error: "That candidate is no longer waiting." });
    forgetFile(uploadsDir, previous);
    res.json({ success: true, ...(await studioView(pool, PORTRAIT_VILLAGE, who.user.id)) });
  });

  /**
   * Say no to the candidate.
   *
   * THE GRANT IS NOT GIVEN BACK, and nothing in this handler tries to. That is
   * the rule that makes the budget mean anything, and the client states it
   * before the member presses forge rather than after they press discard.
   */
  app.post("/api/me/portraits/:key/discard", async (req, res) => {
    const who = await standing(req, res);
    if (!who) return;
    const pool = getPool();
    const existing = await portraits.portraitFor(pool, PORTRAIT_VILLAGE, who.user.id, who.archetype.key);
    const dropped = await portraits.clearCandidate(pool, PORTRAIT_VILLAGE, who.user.id, who.archetype.key);
    if (dropped) forgetFile(uploadsDir, existing?.candidateFileName);
    res.json({ success: true, ...(await studioView(pool, PORTRAIT_VILLAGE, who.user.id)) });
  });

  /**
   * Publish this portrait on my public sheet, or take it back.
   *
   * The explicit act the whole privacy rule turns on. Nothing else in this
   * feature writes `published_at`, so a portrait becomes visible to anybody
   * else only because its owner pressed this.
   *
   * ── TAKING IT BACK MEANS TAKING IT BACK ─────────────────────────────────
   *
   * Clearing `published_at` removes the picture from every listing and every
   * stranger's payload, and it used to be all this did. It is not a
   * revocation. `/api/uploads/:filename` has no sign-in in front of it, so
   * while the bytes sit under the name a published page handed out, everybody
   * who ever loaded that page is still holding a working address, and the
   * member who pressed "take it back" has been told something that is not
   * true.
   *
   * So the bytes MOVE. They are copied to a fresh stamped name nobody has
   * seen, the row is pointed at the copy, and the old file is unlinked. The
   * old URL then answers 404 and the member still has their picture, which is
   * the difference between this and deleting it: withdrawing is not the same
   * act as `DELETE /api/me/portraits/:key` and must not quietly become it.
   *
   * ORDER, AND WHAT EACH FAILURE COSTS. The withdrawal is written FIRST and is
   * unconditional, because taking something back must always be allowed to
   * work: the member's intent lands even if the volume is full or read-only.
   * The move is then attempted, and if any part of it fails the response says
   * `addressRevoked: false` rather than reporting a clean success. A silent
   * best-effort here would be the original defect with extra steps.
   */
  app.post("/api/me/portraits/:key/publish", async (req, res) => {
    const who = await standing(req, res);
    if (!who) return;
    const published = (req.body ?? {}).published !== false;
    const pool = getPool();
    // Read BEFORE the write: the filename this withdrawal is revoking is the
    // one that was live when the member pressed the button.
    const existing = published
      ? null
      : await portraits.portraitFor(pool, PORTRAIT_VILLAGE, who.user.id, who.archetype.key);
    const changed = await portraits.setPublished(
      pool, PORTRAIT_VILLAGE, who.user.id, who.archetype.key, published,
    );
    if (!changed) {
      return res.status(404).json({
        error: published
          ? "There is no picture on that path to show yet."
          : "There is nothing on that path to take back.",
      });
    }
    const addressRevoked = published
      ? undefined
      : await revokeAddress(uploadsDir, pool, who.user.id, who.archetype.key, existing?.fileName);
    res.json({
      success: true,
      ...(addressRevoked === undefined ? {} : { addressRevoked }),
      ...(await studioView(pool, PORTRAIT_VILLAGE, who.user.id)),
    });
  });

  /** Remove it, picture and row together. */
  app.delete("/api/me/portraits/:key", async (req, res) => {
    const who = await standing(req, res);
    if (!who) return;
    const files = await portraits.deletePortrait(
      getPool(), PORTRAIT_VILLAGE, who.user.id, who.archetype.key,
    );
    for (const f of files) forgetFile(uploadsDir, f);
    res.json({ success: true, ...(await studioView(getPool(), PORTRAIT_VILLAGE, who.user.id)) });
  });
}
