/**
 * S1 OF THE MAP SPEED PLAN: THE SPLIT CHANGES WHERE THE BYTES LIVE, NOT WHAT THEY ARE.
 *
 * The map artifact embeds ~5 MB of images as base64 text, so nothing on the
 * map works until all of it has arrived. `splitArtifact` lifts each embedded
 * image out to its own content-addressed file. These tests hold it to
 * "no visible change": every image comes back byte for byte, the page is the
 * source with only those URLs swapped, and nothing else is touched.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ASSET_PREFIX, MIN_SPLIT_CHARS, splitArtifact } from "./groundsSplit";

/** A base64 payload of `n` bytes, deterministic so names are stable. */
function b64(n: number, seed: number): string {
  const buf = Buffer.alloc(n);
  for (let i = 0; i < n; i++) buf[i] = (i * 31 + seed) & 0xff;
  return buf.toString("base64");
}

const big = b64(12_000, 1);
const big2 = b64(9_000, 2);
const tiny = b64(40, 3); // under the threshold: a request would cost more than it saves

const SOURCE = [
  "<!doctype html><style>.a{background:url(data:image/jpeg;base64," + big2 + ")}</style>",
  "<script>window.SPRITES={barn:'data:image/png;base64," + big + "',dot:'data:image/png;base64," + tiny + "'};",
  "window.SPRITES_WIP={barn:'data:image/png;base64," + big + "'};", // the same image twice
  "const note='data:image/png;base64, is how images are written here';</script>", // prose, not a URI
  "<img src=\"data:image/webp;base64," + big2.slice(0, 8000) + "\">",
].join("\n");

describe("splitArtifact", () => {
  const out = splitArtifact(SOURCE);

  it("lifts every embedded image over the threshold out of the page", () => {
    expect(out.html).not.toContain(big);
    expect(out.html).not.toContain(big2);
    expect(ASSET_PREFIX).toBe("/grounds/a/");
    expect(out.html.match(/\/grounds\/a\/[0-9a-f]{16}\.(png|jpg|webp)/g)).toHaveLength(4);
  });

  it("gives each image back byte for byte, under a name made from its content", () => {
    for (const [name, asset] of out.assets) {
      const hash = crypto.createHash("sha256").update(asset.bytes).digest("hex").slice(0, 16);
      expect(name.startsWith(hash), name).toBe(true);
    }
    const png = [...out.assets.values()].find((a) => a.type === "image/png")!;
    expect(png.bytes.equals(Buffer.from(big, "base64"))).toBe(true);
  });

  it("stores an image used twice once", () => {
    expect([...out.assets.values()].filter((a) => a.type === "image/png")).toHaveLength(1);
    expect(out.assets.size).toBe(3); // the png, the jpeg, the webp
  });

  it("names the right type and extension for each format", () => {
    const exts = [...out.assets.keys()].map((n) => path.extname(n)).sort();
    expect(exts).toEqual([".jpg", ".png", ".webp"]);
    for (const [name, a] of out.assets) {
      expect(a.type).toBe({ ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" }[path.extname(name)]);
    }
  });

  it("leaves tiny images, prose and everything else exactly as written", () => {
    expect(out.html).toContain("dot:'data:image/png;base64," + tiny + "'");
    expect(out.html).toContain("const note='data:image/png;base64, is how images are written here'");
  });

  it("is the source with only those URLs swapped: putting them back restores it exactly", () => {
    let restored = out.html;
    for (const [name, a] of out.assets) {
      const mime = a.type;
      restored = restored.split(ASSET_PREFIX + name).join("data:" + mime + ";base64," + a.bytes.toString("base64"));
    }
    expect(restored).toBe(SOURCE);
  });

  it("uses absolute paths, so the URLs resolve from the page, from CSS and from a script alike", () => {
    expect(ASSET_PREFIX.startsWith("/grounds/")).toBe(true);
  });

  it("is a no-op on a page with nothing to lift", () => {
    const plain = "<!doctype html><p>no images</p>";
    const r = splitArtifact(plain);
    expect(r.html).toBe(plain);
    expect(r.assets.size).toBe(0);
  });

  it("keeps the threshold small enough to catch every sprite on the real map", () => {
    expect(MIN_SPLIT_CHARS).toBeLessThanOrEqual(4096);
  });
});

/*
 * The real artifact, when it is present. It is the file this whole slice is
 * for: the round trip must hold on it, and the page that is left must be a
 * small fraction of it.
 */
const REAL = path.resolve(__dirname, "..", "..", "docs", "prototypes", "grounds-v0.html");
describe.runIf(fs.existsSync(REAL))("splitArtifact on the real map artifact", () => {
  const src = fs.readFileSync(REAL, "utf8");
  const out = splitArtifact(src);

  it("leaves no embedded image over the threshold in the page", () => {
    const left = src.length - out.html.length;
    expect(left).toBeGreaterThan(src.length * 0.6);
    const re = /data:image\/[a-z+]+;base64,([A-Za-z0-9+/=]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(out.html))) expect(m[1].length, "an embedded image was left behind").toBeLessThan(MIN_SPLIT_CHARS);
  });

  it("round-trips to the exact source", () => {
    let restored = out.html;
    for (const [name, a] of out.assets) restored = restored.split(ASSET_PREFIX + name).join("data:" + a.type + ";base64," + a.bytes.toString("base64"));
    expect(restored === src, "the split page is not the source with URLs swapped").toBe(true);
  });
});
