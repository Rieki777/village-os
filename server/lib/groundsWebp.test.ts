/**
 * S2 STEP 1 OF THE MAP SPEED PLAN: THE LIFTED IMAGES ARE SERVED AS WEBP.
 *
 * S1 lifted the map artifact's embedded images out of the page. They are
 * still PNG and JPEG, 3.7 MB of them, which is most of what a phone waits
 * for. `webpSplit` re-encodes each one and points the page at the new name.
 * These hold it to: the page changes only in those names, every original
 * stays servable (a cached older page still names them), an image keeps its
 * size and its transparency, and nothing is swapped for something bigger.
 */
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { ASSET_PREFIX, splitArtifact } from "./groundsSplit";
import { webpSplit } from "./groundsWebp";

/** A real image: a soft gradient blob on transparency, the shape a sprite has. */
async function spritePng(w = 160, h = 140): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const dx = (x - w / 2) / (w / 2), dy = (y - h / 2) / (h / 2);
      const inside = dx * dx + dy * dy < 0.8;
      raw[i] = 180 + ((x * 3) % 60); raw[i + 1] = 120 + ((y * 5) % 80); raw[i + 2] = 60 + ((x + y) % 50);
      raw[i + 3] = inside ? 255 : 0;
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}
async function photoJpeg(w = 400, h = 260): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i += 3) { raw[i] = (i / 7) % 255; raw[i + 1] = (i / 11) % 255; raw[i + 2] = (i / 13) % 255; }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}

async function page() {
  const png = await spritePng();
  const jpg = await photoJpeg();
  const source =
    "<!doctype html><script>window.SPRITES={barn:'data:image/png;base64," + png.toString("base64") +
    "'};const plate='data:image/jpeg;base64," + jpg.toString("base64") + "';</script>";
  return { png, jpg, split: splitArtifact(source) };
}

describe("webpSplit", () => {
  it("points the page at a WebP for every lifted image, and changes nothing else", async () => {
    const { split } = await page();
    const out = await webpSplit(split);
    const named = out.html.match(/\/grounds\/a\/[0-9a-f]{16}\.[a-z]+/g) ?? [];
    expect(named).toHaveLength(2);
    for (const n of named) expect(n.endsWith(".webp"), n).toBe(true);
    // Swap each WebP name back for the original it replaced: the S1 page returns exactly.
    let back = out.html;
    for (const [orig, webp] of out.renamed) back = back.split(ASSET_PREFIX + webp).join(ASSET_PREFIX + orig);
    expect(back).toBe(split.html);
  });

  it("keeps every original servable, because a page cached before this still names them", async () => {
    const { split } = await page();
    const out = await webpSplit(split);
    for (const [name, a] of split.assets) expect(out.assets.get(name)?.bytes.equals(a.bytes), name).toBe(true);
  });

  it("serves each WebP under a name made from its own bytes, typed image/webp", async () => {
    const { split } = await page();
    const out = await webpSplit(split);
    for (const webp of out.renamed.values()) {
      const a = out.assets.get(webp)!;
      expect(a.type).toBe("image/webp");
      expect((await sharp(a.bytes).metadata()).format).toBe("webp");
    }
  });

  it("keeps a sprite's size and its transparency", async () => {
    const { png, split } = await page();
    const out = await webpSplit(split);
    const pngName = [...split.assets.entries()].find(([, a]) => a.type === "image/png")![0];
    const webp = out.assets.get(out.renamed.get(pngName)!)!;
    const meta = await sharp(webp.bytes).metadata();
    const orig = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([orig.width, orig.height]);
    expect(meta.hasAlpha).toBe(true);
    // A pixel outside the blob stays fully transparent.
    const { data } = await sharp(webp.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0);
  });

  it("is smaller than what it replaces, or it is not used", async () => {
    const { split } = await page();
    const out = await webpSplit(split);
    for (const [orig, webp] of out.renamed) {
      expect(out.assets.get(webp)!.bytes.length, orig).toBeLessThan(split.assets.get(orig)!.bytes.length);
    }
    // And an image WebP cannot beat keeps its original name in the page.
    for (const [name] of split.assets) {
      if (!out.renamed.has(name)) expect(out.html).toContain(ASSET_PREFIX + name);
    }
  });

  it("is a no-op on a page with no lifted images", async () => {
    const split = splitArtifact("<!doctype html><p>no images</p>");
    const out = await webpSplit(split);
    expect(out.html).toBe(split.html);
    expect(out.renamed.size).toBe(0);
  });
});
