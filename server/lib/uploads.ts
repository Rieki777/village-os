/**
 * THE ONE DOOR INTO THE UPLOADS VOLUME.
 *
 * ── WHAT THIS EXISTS TO CLOSE ────────────────────────────────────────────
 *
 * `POST /api/work-with-us/attachment` is public, unauthenticated and
 * rate-limited only. It took an image straight off a phone with multer's
 * diskStorage, wrote the ORIGINAL bytes to the volume, and handed back a
 * filename that `/api/uploads/:filename` then served inline to anybody. A
 * photograph taken on the land carries the land's coordinates in its EXIF, so
 * that route published them. `POST /api/admin/investor-docs/upload` did the
 * same with no file filter at all.
 *
 * The place-photo path (0093) already proved the machinery. What it did NOT
 * do was make the guarantee general: it was true of files named `place-*` and
 * of nothing else, which is a guarantee about one door and not about the
 * volume.
 *
 * ── WHY A MODULE AND NOT A HELPER EACH ROUTE REMEMBERS TO CALL ───────────
 *
 * A guarantee nobody checks is a guarantee that decays. So there are two
 * mechanisms and they are different in kind:
 *
 *   1. RUNTIME. `sanitiseForVolume` re-reads its own output and throws before
 *      returning, so a door that calls it cannot publish metadata even if
 *      sharp's defaults change underneath it. Nothing here trusts a
 *      dependency's documented behaviour; it checks the bytes it is about to
 *      hand back.
 *
 *   2. REVIEW TIME. `scripts/check-upload-strip.mjs` enumerates every writer
 *      into the uploads volume and fails when one does not come through here.
 *      That is the half that catches the NEXT door, because the defect this
 *      module fixes was not a broken check, it was a door built without one.
 *
 * ── WHY RE-ENCODE RATHER THAN CUT THE MARKER SEGMENTS OUT ────────────────
 *
 * Removing a JPEG's APP1 segment or a PNG's text chunks is lossless and
 * exact, and it was the first design. It is also about 120 lines of byte
 * surgery per container, five containers, and each one is a parser written by
 * hand against files a stranger uploads. Re-encoding is ten lines, drops
 * every container's metadata at once, and is checked afterwards.
 *
 * DIMENSIONS ARE PRESERVED, which is the part that matters for the doors
 * being fixed. The place-photo path resizes to 2000px because a gallery
 * renders thumbnails; a scanned cap table or a portfolio page has to come out
 * the size it went in, so nothing here resizes. Quality is 92: high enough
 * that one generation is invisible, low enough that a phone photo does not
 * grow.
 */
import fs from "node:fs";
import path from "node:path";

/** What the bytes actually are, read from magic numbers and never from a name. */
export type UploadKind = "image" | "pdf" | "font" | "other";

/**
 * Sniff the container. The claimed mime type is a stranger's assertion and
 * the extension is a stranger's assertion; the first bytes are the file.
 */
export function sniffKind(bytes: Buffer): UploadKind {
  const b = bytes;
  /*
   * Length is checked PER READ and not once at the top.
   *
   * A single `bytes.length < 12` guard here classed a nine-byte `%PDF-1.7`
   * as "other", which would have sent a short PDF past the location scan
   * untouched. Its own test caught it. The 12 was only ever needed by the
   * deepest read (the ftyp brand at offset 8), so it belongs on that read.
   */
  const ascii = (at: number, n: number) =>
    (at + n <= b.length ? b.subarray(at, at + n).toString("ascii") : "");
  if (b.length < 4) return "other";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image"; // JPEG
  if (b[0] === 0x89 && ascii(1, 3) === "PNG") return "image";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image";
  if (ascii(4, 4) === "ftyp" && /avif|avis|heic|heix|mif1|msf1/.test(ascii(8, 4))) return "image";
  if (ascii(0, 4) === "%PDF") return "pdf";
  if (ascii(0, 4) === "wOF2" || ascii(0, 4) === "wOFF" || ascii(0, 4) === "OTTO") return "font";
  if (b[0] === 0x00 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return "font"; // TTF
  if (ascii(0, 4) === "true" || ascii(0, 4) === "ttcf") return "font";
  return "other";
}

/**
 * What metadata survived, named. Empty means none did.
 *
 * Reports the categories a picture can carry a location in, and not only
 * EXIF: XMP holds `exif:GPSLatitude` in plain text in its own chunk and IPTC
 * carries a location sublocation, so a guard that only knew about EXIF would
 * pass a file that says where it was taken in two other places. The raw byte
 * scan at the end is there because a container chunk sharp has no field for
 * would still be sitting in the file.
 */
export async function readMetadataMarkers(bytes: Buffer): Promise<string[]> {
  const sharp = (await import("sharp")).default;
  const found: string[] = [];
  try {
    const meta = await sharp(bytes).metadata();
    if (meta.exif && meta.exif.length) found.push("exif");
    if (meta.xmp && (meta.xmp as any).length) found.push("xmp");
    if ((meta as any).iptc && (meta as any).iptc.length) found.push("iptc");
  } catch {
    /* Not something sharp reads. The byte scan below still runs. */
  }
  const head = bytes.toString("binary");
  if (head.includes(EXIF_MARKER)) found.push("exif-segment");
  if (head.includes("http://ns.adobe.com/xap")) found.push("xmp-packet");
  return Array.from(new Set(found));
}

/**
 * The six bytes that open an EXIF block, in every container that has one.
 *
 * Written as a constant because it ends in two NUL bytes and a literal that
 * looks like "Exif" followed by two spaces is the kind of thing a later edit
 * tidies away. `Exif\0\0` is the APP1 identifier in a JPEG, the `EXIF` chunk
 * payload prefix in a WebP, and what an embedded DCTDecode stream carries
 * inside a PDF.
 */
export const EXIF_MARKER = "Exif\u0000\u0000";

/** Thrown when the bytes we were about to store still carried metadata. */
export class LocationDataSurvived extends Error {
  constructor(public markers: string[]) {
    super(`The picture still carried ${markers.join(", ")} after re-encoding, so it was not stored.`);
    this.name = "LocationDataSurvived";
  }
}

/** Thrown when a file we cannot rewrite carries coordinates. Refused, not published. */
export class CarriesLocationData extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "CarriesLocationData";
  }
}

/**
 * Does an EXIF block carry a GPS IFD?
 *
 * Parses the TIFF header and walks IFD0 looking for tag 0x8825, the GPS IFD
 * pointer. Presence of that tag is what makes a photograph geotagged, as
 * against merely carrying a camera name. Returns false on anything it cannot
 * parse, because a guess about a malformed header is worse than the re-encode
 * that runs anyway for every container we CAN rewrite.
 */
export function exifBlockHasGps(blob: Buffer): boolean {
  try {
    const off = blob.subarray(0, 4).toString("ascii") === "Exif" ? 6 : 0;
    const order = blob.subarray(off, off + 2).toString("ascii");
    if (order !== "II" && order !== "MM") return false;
    const le = order === "II";
    const u16 = (q: number) => (le ? blob.readUInt16LE(q) : blob.readUInt16BE(q));
    const u32 = (q: number) => (le ? blob.readUInt32LE(q) : blob.readUInt32BE(q));
    const ifd0 = off + u32(off + 4);
    const n = u16(ifd0);
    for (let i = 0; i < n; i++) {
      if (u16(ifd0 + 2 + i * 12) === 0x8825) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * A PDF that carries coordinates, and how we know.
 *
 * ── THE PDF DECISION, AND WHY ───────────────────────────────────────────
 *
 * A PDF is not re-encoded here. Rewriting one needs a PDF library, which is a
 * new runtime dependency, and the house rule against those is not a
 * formality: a parser handling files a stranger uploads is exactly where a
 * dependency's next advisory lands.
 *
 * The PDF's OWN metadata is the /Info dictionary and an XMP packet, and it
 * carries author, producer, title and dates. It cannot carry GPS. So the
 * document's own metadata is not the harm this brief is about, and stripping
 * it would be tidiness in place of protection.
 *
 * What a PDF CAN carry is a photograph. An embedded JPEG rides in a DCTDecode
 * stream as the original JPEG bytes, APP1 segment and all, so "attach the
 * photo of the site to the proposal PDF" publishes the coordinates exactly as
 * attaching the photo would have.
 *
 * That is findable without a parser: scan for the EXIF marker and ask each
 * block whether it carries a GPS IFD. If one does, the upload is REFUSED with
 * a sentence naming what was found, because a refusal a person can act on
 * beats a silent publication they never learn about. A PDF with no geotagged
 * photograph inside it passes through untouched, which is every CV and every
 * portfolio.
 */
export function pdfLocationMarkers(bytes: Buffer): { found: boolean; blocks: number } {
  const needle = Buffer.from(EXIF_MARKER, "binary");
  let at = 0;
  let blocks = 0;
  let found = false;
  for (;;) {
    const hit = bytes.indexOf(needle, at);
    if (hit < 0) break;
    blocks += 1;
    // A TIFF header is small. 64 KB is far past any IFD0 and stops a scan of
    // a 50 MB document turning into a copy of it.
    if (exifBlockHasGps(bytes.subarray(hit, Math.min(hit + 65536, bytes.length)))) found = true;
    at = hit + needle.length;
    if (blocks > 512) break; // a document with this many embedded photos has told us enough
  }
  return { found, blocks };
}

export interface Sanitised {
  bytes: Buffer;
  /** The extension the stored file must carry: leading dot, lowercase. */
  ext: string;
  kind: UploadKind;
  /** True when the bytes changed, so a caller can log what it paid. */
  rewritten: boolean;
}

const FORMAT_EXT: Record<string, string> = {
  jpeg: ".jpg", jpg: ".jpg", png: ".png", webp: ".webp", gif: ".gif", avif: ".avif", heif: ".avif",
};

/**
 * Everything that reaches the volume comes through here.
 *
 * An IMAGE is re-encoded in its own format at its own dimensions with no
 * metadata, and the result is re-read and asserted before it is returned.
 * A PDF is scanned and either refused or passed through. A FONT and anything
 * else passes through: a font is a glyph table with no location field, and
 * the callers that accept "anything else" verify what they accept their own
 * way (the font route checks magic bytes; the vault is admin-only and its
 * files are handed over as downloads unless they are a type this platform
 * renders).
 *
 * Throws `CarriesLocationData` for a refusal a person should read, and
 * `LocationDataSurvived` for the case that must never happen and has to be
 * loud if it ever does.
 */
export async function sanitiseForVolume(input: Buffer, originalName = ""): Promise<Sanitised> {
  const kind = sniffKind(input);

  if (kind === "pdf") {
    const scan = pdfLocationMarkers(input);
    if (scan.found) {
      throw new CarriesLocationData(
        "That PDF holds a photograph with GPS coordinates in it. Save the pages without the location data and upload it again.",
      );
    }
    return { bytes: input, ext: ".pdf", kind, rewritten: false };
  }

  if (kind !== "image") {
    return { bytes: input, ext: path.extname(originalName).toLowerCase(), kind, rewritten: false };
  }

  const sharp = (await import("sharp")).default;
  const meta = await sharp(input).metadata();
  const format = String(meta.format ?? "");
  /*
   * A GIF or a WebP can hold more than one frame, and sharp decodes only the
   * first unless it is told otherwise. Re-encoding an animation without this
   * would silently hand back a still, which is `imagePrep.ts`'s exact rule in
   * the browser: a helper that quietly ships a broken file is worse than no
   * helper. `pages` is what sharp reports; anything above one is animated.
   *
   * Written from sharp's documented contract rather than from a fixture: a
   * multi-frame GIF cannot be built with sharp alone, so there is no honest
   * test for it here and there is no dependency worth adding for one. The
   * single-frame path IS tested, so this cannot regress the common case.
   */
  const animated = Number(meta.pages ?? 1) > 1;
  const read = animated ? { animated: true } : {};
  // No resize anywhere in this call: a scanned document has to come out the
  // size it went in. The place-photo path resizes because a gallery renders
  // thumbnails, and it has its own function for that.
  const pipeline = sharp(input, read).rotate(); // honour orientation before the flag is dropped
  let out: Buffer;
  if (format === "png") out = await pipeline.png().toBuffer();
  else if (format === "webp") out = await pipeline.webp({ quality: 92 }).toBuffer();
  else if (format === "gif") out = await pipeline.gif().toBuffer();
  else if (format === "avif" || format === "heif") out = await pipeline.avif({ quality: 80 }).toBuffer();
  else out = await pipeline.jpeg({ quality: 92 }).toBuffer();

  const markers = await readMetadataMarkers(out);
  if (markers.length) throw new LocationDataSurvived(markers);
  return { bytes: out, ext: FORMAT_EXT[format] ?? ".jpg", kind, rewritten: true };
}

/**
 * The stamp in every filename.
 *
 * `${Date.now()}-${random}` is what makes the one-year immutable cache on
 * `/api/uploads/:filename` correct rather than merely convenient, so it is
 * minted here and not by each caller.
 */
export function stampedName(prefix: string, ext: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`;
}

/**
 * The prefixes that mean "this file is one member's own", as the minters
 * above spell them.
 *
 * `portrait` is a member's face (`lib/characterPortraits.ts`,
 * `routes/characterPortraits.ts`) and `proposal` is what they attached to a
 * form, which on some forks is a CV or an ID scan. The village's own files
 * carry `brand`, `sitepull` and `land-<provider>`, and those are the village's
 * to serve to anybody.
 *
 * KEPT BESIDE `stampedName` ON PURPOSE. A new prefix is added a few lines up,
 * and whoever adds one has to pass this sentence to do it.
 *
 * THE VAULT IS NOT HERE AND CANNOT BE. `vaultBase` in `server/index.ts` names
 * an investor document from its ORIGINAL filename, so those files carry no
 * prefix to read. A vault PDF is already served `private, no-cache` by type;
 * a vault file that happens to be an image is not, and that is a separate
 * question from this one.
 */
export const MEMBER_UPLOAD_PREFIXES = ["portrait", "proposal"] as const;

/**
 * Whether a stored file belongs to one member rather than to the village.
 *
 * WHAT IT DECIDES: whether `/api/uploads/:filename` answers `public` or
 * `private`, and nothing else. It is not an access check. The route has no
 * gate at all, by design, and the file IS the address.
 *
 * WHY IT EXISTS. Erasure unlinks a member's files, so the origin answers 404
 * the moment they leave. The header said `public, max-age=31536000,
 * immutable`, so every browser AND every shared cache that had fetched one
 * went on serving it for up to a year without asking, which means a member's
 * face could outlive their erasure in a proxy that will hand it to somebody
 * else. `private` costs nothing: the person's own browser still caches it for
 * a year, so no page gets slower on the 50 KB/s links the header was written
 * for, and no shared cache keeps a copy at all.
 *
 * WHAT THIS DOES NOT FIX, said here because a defence described without its
 * limit is the kind of sentence that misleads later: the viewer's OWN browser
 * still holds the bytes for up to a year. Bounding that means a shorter
 * max-age for member files, which buys a conditional request per image per
 * window, and that trade belongs to whoever owns the page-load budget.
 */
export function isMemberOwnedUpload(fileName: string): boolean {
  const name = path.basename(String(fileName ?? ""));
  return MEMBER_UPLOAD_PREFIXES.some((prefix) => name.startsWith(`${prefix}-`));
}

export function writeToVolume(uploadsDir: string, filename: string, bytes: Buffer): void {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(uploadsDir, filename), bytes);
}
