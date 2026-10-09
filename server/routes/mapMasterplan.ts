/**
 * The village's masterplan: the document its land is drawn from.
 *
 *   GET    /api/map/masterplan   what is kept
 *   POST   /api/map/masterplan   keep a new one (multipart, field `file`), replacing the last
 *   DELETE /api/map/masterplan   take it away
 *
 * WHY IT EXISTS. A village with nothing published starts from a blank map
 * (shared/mapFromMasterplan.ts), and its first version is drawn from its
 * masterplan, by hand in build mode or by the founder's own agent, which
 * reads the plan through `GET /api/agent/v1/map` (server/routes/agentMap.ts).
 * This is where the plan comes in.
 *
 * WHO. Anyone who may draft the land (`map.edit`), asked of the one gate on
 * every request, the same key the draft routes in server/routes/mapScene.ts
 * ask for. Keeping a plan changes nothing anybody sees: the live map moves
 * only when somebody with `map.publish` publishes a draft.
 *
 * UNDER `/api/map`, so `requireModule("map")` already covers all three: 404
 * while the map is off.
 *
 * ── THE FILE GOES THROUGH THE ONE DOOR ───────────────────────────────────
 * `sanitiseForVolume` (server/lib/uploads.ts) re-encodes a picture with no
 * metadata at its own size, and scans a PDF for a geotagged photograph and
 * refuses one that carries any. A masterplan is the one document that says
 * where everything on the land will stand; a phone photo of it would
 * otherwise publish the land's coordinates in its EXIF. Nothing is resized:
 * a plan has to come out the size it went in, or the agent reading it
 * measures a smaller world.
 *
 * WHAT IT IS, FROM THE BYTES. `sniffKind` reads the magic numbers. The
 * browser's mime type and the founder's filename are a stranger's assertion,
 * and both are consulted only to name the file.
 */
import type { Express, Request, Response } from "express";
import multer from "multer";
import { hasCapability } from "../../shared/capabilities";
import {
  MASTERPLAN_MAX_BYTES,
  MASTERPLAN_TYPES,
  type MasterplanRecord,
} from "../../shared/mapFromMasterplan";
import type { AppDeps } from "../lib/appDeps";
import { recordEvent } from "../lib/events";
import { currentMasterplan, forgetMasterplan, keepMasterplan, unlinkMasterplanFile } from "../lib/mapMasterplan";
import {
  CarriesLocationData,
  LocationDataSurvived,
  sanitiseForVolume,
  sniffKind,
  stampedName,
  writeToVolume,
} from "../lib/uploads";
import { safeOriginalName } from "./brandUploads";

type Deps = Pick<AppDeps, "authedUser" | "capabilityCtx" | "getPool" | "uploadsDir">;

const MIME_FOR_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

export function register(app: Express, deps: Deps): void {
  const { authedUser, capabilityCtx, getPool, uploadsDir } = deps;

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MASTERPLAN_MAX_BYTES, files: 1 } });

  /** The holder, when they may draft the land; otherwise the refusal is sent and null comes back. */
  async function mapMaker(req: Request, res: Response): Promise<{ id: string } | null> {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required", message: "Sign in to see the village's masterplan." });
      return null;
    }
    if (!hasCapability("map.edit", await capabilityCtx(user))) {
      res.status(403).json({ error: "The masterplan is kept for the people who draw the map." });
      return null;
    }
    return user;
  }

  app.get("/api/map/masterplan", async (req, res) => {
    if (!(await mapMaker(req, res))) return;
    res.json({ masterplan: await currentMasterplan(getPool()) });
  });

  app.post("/api/map/masterplan", async (req, res) => {
    const user = await mapMaker(req, res);
    if (!user) return;
    upload.single("file")(req, res, async (err: any) => {
      if (err) {
        const tooBig = err?.code === "LIMIT_FILE_SIZE";
        return res.status(tooBig ? 413 : 400).json({
          error: tooBig
            ? `That file is over ${Math.round(MASTERPLAN_MAX_BYTES / 1024 / 1024)} MB. Export the plan at a smaller size and upload it again.`
            : "That upload could not be read. Try the file again.",
        });
      }
      const file = req.file;
      if (!file) return res.status(400).json({ error: "Choose the masterplan file to upload." });
      const originalName = safeOriginalName(file.originalname) || "masterplan";
      const kind = sniffKind(file.buffer);
      if (kind !== "pdf" && kind !== "image") {
        return res.status(400).json({
          error: `"${originalName}" is not a PDF or a picture, so it was not kept. Upload one of: ${MASTERPLAN_TYPES}.`,
        });
      }

      let clean;
      try {
        clean = await sanitiseForVolume(file.buffer, originalName);
      } catch (e) {
        if (e instanceof CarriesLocationData) return res.status(400).json({ error: e.message });
        if (e instanceof LocationDataSurvived) {
          console.error("[MASTERPLAN] refused a plan whose metadata survived the strip", e.markers);
          return res.status(500).json({ error: "That file kept its metadata through the re-encode, so it was not kept." });
        }
        // The picture half needs sharp; a server without it cannot strip a
        // photograph, and storing one unstripped is the harm this door closes.
        console.error("[MASTERPLAN] could not read the plan", e);
        return res.status(kind === "image" ? 503 : 400).json({
          error: kind === "image"
            ? "Pictures cannot be processed on this server right now, so the plan was not kept. A PDF of the plan works."
            : `"${originalName}" could not be read, so it was not kept.`,
        });
      }

      let width: number | null = null;
      let height: number | null = null;
      if (clean.kind === "image") {
        try {
          const sharp = (await import("sharp")).default;
          const meta = await sharp(clean.bytes).metadata();
          width = meta.width ?? null;
          height = meta.height ?? null;
        } catch {
          /* The size is a courtesy to the agent reading it, never a reason to refuse. */
        }
      }

      const filename = stampedName("masterplan", clean.ext || (clean.kind === "pdf" ? ".pdf" : ".jpg"));
      writeToVolume(uploadsDir, filename, clean.bytes);
      const before = await currentMasterplan(getPool());
      const record: MasterplanRecord = {
        url: `/api/uploads/${filename}`,
        filename,
        originalName,
        kind: clean.kind === "pdf" ? "pdf" : "image",
        mimeType: MIME_FOR_EXT[clean.ext] ?? (clean.kind === "pdf" ? "application/pdf" : "application/octet-stream"),
        bytes: clean.bytes.length,
        width,
        height,
        uploadedBy: user.id,
        uploadedAt: new Date().toISOString(),
      };
      await keepMasterplan(getPool(), record);
      if (before && before.filename !== filename) unlinkMasterplanFile(uploadsDir, before);
      await recordEvent(getPool(), {
        kind: "map_masterplan",
        text: `kept a new masterplan for the map (${originalName})`,
        actorUserId: user.id,
        entityType: "map_masterplan",
        entityRef: filename,
        audience: "admin",
      });
      res.json({ masterplan: record });
    });
  });

  app.delete("/api/map/masterplan", async (req, res) => {
    const user = await mapMaker(req, res);
    if (!user) return;
    const before = await currentMasterplan(getPool());
    if (!before) return res.json({ removed: false });
    await forgetMasterplan(getPool());
    unlinkMasterplanFile(uploadsDir, before);
    await recordEvent(getPool(), {
      kind: "map_masterplan",
      text: `took the masterplan off the map (${before.originalName || before.filename})`,
      actorUserId: user.id,
      entityType: "map_masterplan",
      entityRef: before.filename,
      audience: "admin",
    });
    res.json({ removed: true });
  });
}
