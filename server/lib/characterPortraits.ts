/**
 * A member's own portrait for a class: the encode, the budget, and the seam a
 * forge provider drops into later.
 *
 * No SQL lives here. `server/repos/characterPortraits.ts` holds every query,
 * and this file holds the decisions that are not queries.
 *
 * ── THE 3:4 IS ENFORCED BY THE ENCODE, NOT BY ASKING NICELY ─────────────
 *
 * The party rail and the character stage both render `aspect-[3/4]`, and a
 * picture of any other shape either letterboxes or crops at display time,
 * differently in each of the four places it appears. So the stored bytes ARE
 * 3:4: `fit: "cover"` with both dimensions given produces exactly
 * PORTRAIT_WIDTH by PORTRAIT_HEIGHT whatever arrives, and there is no path into
 * the volume that skips it. A member cannot upload a shape the rail cannot hold
 * because the shape is decided after they upload.
 *
 * `position: "top"` and not the default centre. For a tall source, cover has to
 * drop something, and dropping it from the bottom keeps the head. It is also
 * what the existing rail already does at display time (`object-cover
 * object-top` in Characters.tsx), so the crop the member previews in the
 * browser and the crop the server applies agree.
 *
 * ── THE STRIP IS THE SAME ONE, AND THE ASSERTION IS THE SAME ASSERTION ──
 *
 * This resizes, so it cannot use `sanitiseForVolume`, which must never resize.
 * It uses the same `readMetadataMarkers` check on its own output and throws the
 * same `LocationDataSurvived`, exactly as `server/lib/placePhotos.ts` does for
 * the same reason. Bytes reach the volume only through `writeToVolume`, which
 * is what `scripts/check-upload-strip.mjs` enumerates.
 *
 * A portrait carries the same risk a place photo does: a member who photographs
 * themselves at home and uploads it has published their home's coordinates to
 * anyone holding the address, and a portrait is far more likely to be taken at
 * home than a picture of the land is.
 *
 * ── THE FORGE SEAM, AND WHY IT IS EMPTY ─────────────────────────────────
 *
 * `server/lib/assistantProviders.ts` is text-only, and adding an image provider
 * is a separate decision with its own cost, its own vendor and its own review.
 * Nothing here picks one. `installPortraitForge` is the whole seam: a later
 * lane writes one object and calls it at boot, and every route, every refusal
 * and the entire budget already work.
 *
 * WHAT MATTERS MORE THAN THE SEAM IS WHAT HAPPENS WITHOUT IT. With no provider
 * installed the upload path is complete and unaffected: a member picks a file,
 * it is cropped, stripped, stored and shown. The forge half answers a readable
 * refusal, refunds any grant it took, and the client hides the button rather
 * than offering a control that cannot work. A feature that degrades to "the
 * half that needs no vendor" is the only version of this worth shipping today.
 */
import type { Pool } from "mysql2/promise";
import { cycleBoundsFor } from "../../shared/lunar";
import {
  accrueMoonGrants,
  forgeBudget,
  type ForgeBudget,
  type PortraitSource,
} from "../../shared/characterPortraits";
import { moonOneCycle, villageMoonFor } from "./villageMoon";
import type { VillageMoon } from "../../shared/villageMoon";
import { LocationDataSurvived, readMetadataMarkers, stampedName, writeToVolume } from "./uploads";
import {
  applyAccrual,
  loadCounters,
  portraitsOwnedBy,
  publishedPortraitsOf,
  type PortraitRow,
} from "../repos/characterPortraits";

/** 3:4, at twice the largest size the stage renders, so a retina screen is sharp. */
export const PORTRAIT_WIDTH = 900;
export const PORTRAIT_HEIGHT = 1200;

/** What a member may send. Bigger than any phone portrait, small enough to refuse a video. */
export const MAX_PORTRAIT_BYTES = 12 * 1024 * 1024;

/** Said in the refusal and in the client's `accept`, so the two agree. */
export const ACCEPTED_PORTRAIT_TYPES = "JPG, PNG, WebP, AVIF or HEIC";

const PORTRAIT_MIME = [
  "image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif",
];

export function isPortraitMimeType(mime: unknown): boolean {
  return PORTRAIT_MIME.includes(String(mime ?? "").toLowerCase());
}

/**
 * The address a filename is served at.
 *
 * ONE function, so the prefix is written once. The stored column holds a
 * filename and this is the only thing that turns it into something a browser
 * follows, which is what keeps a data column from ever being a path.
 */
export function portraitUrl(fileName: string | null | undefined): string | null {
  const name = String(fileName ?? "").trim();
  if (!name) return null;
  // A filename that somehow acquired a separator is not one this build minted.
  // Refusing beats serving, and there is no legitimate caller this can bite.
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  return `/api/uploads/${name}`;
}

export interface EncodedPortrait {
  bytes: Buffer;
  width: number;
  height: number;
}

/**
 * Crop to 3:4, re-encode to WebP, and prove no metadata survived.
 *
 * Separate from the write so a test can call it with a buffer alone, which is
 * what makes the metadata proof cheap enough to run on every suite.
 */
export async function encodePortrait(input: Buffer, quality = 82): Promise<EncodedPortrait> {
  const sharp = (await import("sharp")).default;
  const out = await sharp(input)
    // Honour the orientation flag before cropping, then let it go with the rest
    // of the metadata. A portrait that arrives sideways is cropped sideways
    // otherwise, because the flag that would have turned it is stripped.
    .rotate()
    .resize({ width: PORTRAIT_WIDTH, height: PORTRAIT_HEIGHT, fit: "cover", position: "top" })
    .webp({ quality })
    .toBuffer({ resolveWithObject: true });
  const markers = await readMetadataMarkers(out.data);
  if (markers.length) throw new LocationDataSurvived(markers);
  return { bytes: out.data, width: out.info.width, height: out.info.height };
}

/**
 * The whole write: cropped, stripped, on the volume, filename returned.
 *
 * The prefix is fixed here and never taken from a caller. `stampedName` mints
 * the rest, which is what makes the one-year immutable cache on
 * `/api/uploads/:filename` correct for these files too.
 */
export async function writePortrait(
  input: Buffer,
  uploadsDir: string,
): Promise<{ fileName: string; width: number; height: number; bytes: number }> {
  const encoded = await encodePortrait(input);
  const fileName = stampedName("portrait", ".webp");
  writeToVolume(uploadsDir, fileName, encoded.bytes);
  return {
    fileName,
    width: encoded.width,
    height: encoded.height,
    bytes: encoded.bytes.length,
  };
}

// ── The forge seam ─────────────────────────────────────────────────────────

export interface ForgeRequest {
  archetypeKey: string;
  /** What the class is called in this village, so a provider can be told. */
  archetypeName: string;
  presentation: string;
  tone: string;
  /** Anything the member typed. A provider decides what to do with it. */
  note: string;
}

/**
 * A provider hands back BYTES, never a URL.
 *
 * This is the shape of the seam and it is the important half of it. A provider
 * that returned an address would put a string somebody else controls into a
 * data column and then into an `img` tag, which is precisely what 0069 refused
 * for the sigil. Bytes go through `writePortrait` like every other picture, so
 * a forged portrait and an uploaded one are the same file in the same volume
 * under the same strip, and the record cannot tell them apart except by
 * `source`.
 */
export interface PortraitForge {
  /** For the log and for the refusal sentence. Never shown as a brand. */
  readonly name: string;
  render(input: ForgeRequest): Promise<Buffer>;
}

let installed: PortraitForge | null = null;

/** Install the provider. A later lane calls this at boot; nothing calls it today. */
export function installPortraitForge(forge: PortraitForge | null): void {
  installed = forge;
}

export function portraitForge(): PortraitForge | null {
  return installed;
}

export function hasPortraitForge(): boolean {
  return installed !== null;
}

/**
 * What a member is told when there is no provider.
 *
 * It says the upload works, because the member's next useful action is the
 * upload and a refusal that leaves somebody with no next step is a dead end
 * wearing an error message.
 */
export const NO_FORGE_MESSAGE =
  "Portrait forging is not switched on in this village yet. You can still upload your own picture, " +
  "and that costs you nothing.";

// ── The budget, and the moon it counts by ──────────────────────────────────

export interface PortraitStudioView {
  portraits: Array<PortraitRow & { url: string | null; candidateUrl: string | null }>;
  budget: ForgeBudget;
  moon: VillageMoon;
  forgeAvailable: boolean;
}

/**
 * Read the budget, accruing whatever moons have turned since it was last read.
 *
 * ── THE UNANCHORED VILLAGE, WHICH IS THE CASE THAT NEEDED DECIDING ──────
 *
 * `moonOneCycle` is null in a village that has not set its Moon 1, and
 * `VillageMoon.standing` is then "unanchored" with `ordinal` null. That is a
 * fact about what the village can be told, and it is NOT a fact about whether
 * the moon turned.
 *
 * `cycleBoundsFor(now).cycleNumber` is the absolute lunation number and it
 * exists for every instant regardless of any anchor, because it is arithmetic
 * on the sky. So the accrual reads that, and a member in a village with no
 * Moon 1 collects their grant on exactly the same schedule as everybody else.
 * Making the budget depend on the anchor would have meant a village that never
 * ran a launch vote quietly handing its members nothing forever, with no error
 * anywhere.
 *
 * What the standing DOES decide is the words. The client names a moon number
 * only when there is one, and otherwise says when this moon closes, which is
 * true in all three standings. `villageMoonFor` carries the standing along for
 * exactly that.
 */
export async function readBudget(
  pool: Pool,
  villageId: string,
  userId: string,
  now: Date = new Date(),
): Promise<{ budget: ForgeBudget; moon: VillageMoon }> {
  const counters = await loadCounters(pool, villageId, userId);
  const nowCycle = cycleBoundsFor(now).cycleNumber;
  const accrued = accrueMoonGrants(counters.moonRemaining, counters.moonCycle, nowCycle);

  // Written only when something changed, and the write itself is conditional on
  // the stored cycle still being behind, so two processes reading at once grant
  // once between them.
  if (accrued.moonCycle !== counters.moonCycle || accrued.granted > 0) {
    await applyAccrual(pool, villageId, userId, accrued.moonRemaining, accrued.moonCycle);
  }

  const anchor = await moonAnchor(pool);
  const moon = villageMoonFor(now, anchor);
  const budget = forgeBudget(
    { ...counters, moonRemaining: accrued.moonRemaining, moonCycle: accrued.moonCycle },
    moon.endsAt || null,
    now,
  );
  return { budget, moon };
}

/**
 * The anchor, wrapped so a failure to read it cannot take the studio down.
 *
 * `moonOneCycle` does one `app_config` lookup and can throw only if the
 * database is in trouble, in which case the page is already lost. It is caught
 * anyway and answers null, which is the unanchored standing: the budget still
 * works and the label just does not carry a number. A moon LABEL is never worth
 * a 500 on a page whose real job is showing somebody their own picture.
 */
async function moonAnchor(pool: Pool): Promise<number | null> {
  try {
    return await moonOneCycle(pool);
  } catch {
    return null;
  }
}

const withUrls = (rows: PortraitRow[]) =>
  rows.map((p) => ({
    ...p,
    url: portraitUrl(p.fileName),
    candidateUrl: portraitUrl(p.candidateFileName),
  }));

/** Everything the studio renders for the signed-in member: their own, all of it. */
export async function studioView(
  pool: Pool,
  villageId: string,
  userId: string,
  now: Date = new Date(),
): Promise<PortraitStudioView> {
  const { budget, moon } = await readBudget(pool, villageId, userId, now);
  return {
    portraits: withUrls(await portraitsOwnedBy(pool, villageId, userId)),
    budget,
    moon,
    forgeAvailable: hasPortraitForge(),
  };
}

/**
 * Portraits keyed by archetype, for merging into a party payload.
 *
 * ── THE ONE PLACE THE VISIBILITY RULE IS DECIDED ────────────────────────
 *
 * `viewerId` is REQUIRED and there is no default, so no caller can get the
 * owner's view by forgetting an argument. An owner reading their own sheet gets
 * every portrait including the private ones; anybody else gets only what the
 * SQL in `publishedPortraitsOf` returned, which is rows with a published
 * timestamp and a real file.
 *
 * A stranger's set is filtered in the DATABASE and not here. That matters: a
 * private filename never enters this process's memory on a stranger's request,
 * so there is no object sitting next to the response that a later spread could
 * leak from.
 */
export async function portraitsByArchetype(
  pool: Pool,
  villageId: string,
  ownerId: string,
  viewerId: string | null,
): Promise<Map<string, { url: string; source: PortraitSource; published: boolean }>> {
  const rows =
    viewerId !== null && viewerId === ownerId
      ? await portraitsOwnedBy(pool, villageId, ownerId)
      : await publishedPortraitsOf(pool, villageId, ownerId);
  const out = new Map<string, { url: string; source: PortraitSource; published: boolean }>();
  for (const r of rows) {
    const url = portraitUrl(r.fileName);
    if (!url) continue;
    out.set(r.archetypeKey, { url, source: r.source, published: r.publishedAt !== null });
  }
  return out;
}
