/**
 * An `<img>` that drops a painted paper frame, and leaves every other picture alone.
 *
 * Character art a village keeps in its uploads volume (a member's own portrait,
 * a role's header picture, a forged face) never passes through this repository,
 * so it cannot be cropped at the source the way the stock drawings were. Some
 * of it arrives painted on a paper card, and inside one of our rounded frames
 * that card reads as a white frame within the frame.
 *
 * So the picture is read once as it loads: drawn small onto a canvas and
 * handed to `findFrame` (shared/portraitFrame.ts), which calls it framed only
 * when paper runs all the way round. A framed picture is cropped to the
 * painting inside the paper and shown from a local copy. Anything else, which
 * is nearly everything, keeps its own address and is never zoomed or cut.
 *
 * Quietly a no-op wherever it cannot read pixels: a picture from another
 * origin (a tainted canvas), a browser without a 2D canvas, a test runner.
 */
import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { findFrame } from "@shared/portraitFrame";

/** The width the picture is read at. Enough to see a margin of 1%, small enough to cost nothing. */
const PROBE_WIDTH = 160;

/** One reading per address for the life of the page: the copy's address, or null for "show it as it is". */
const readings = new Map<string, Promise<string | null>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function unframed(src: string): Promise<string | null> {
  if (typeof document === "undefined") return null;
  const img = await loadImage(src);
  const W = img.naturalWidth, H = img.naturalHeight;
  if (!W || !H) return null;
  const probe = document.createElement("canvas");
  probe.width = PROBE_WIDTH;
  probe.height = Math.max(8, Math.round((PROBE_WIDTH * H) / W));
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, probe.width, probe.height);
  const cut = findFrame(ctx.getImageData(0, 0, probe.width, probe.height).data, probe.width, probe.height, 4);
  if (!cut) return null;
  const sx = Math.round(cut.left * W), sy = Math.round(cut.top * H);
  const sw = Math.round(W * (1 - cut.left - cut.right)), sh = Math.round(H * (1 - cut.top - cut.bottom));
  if (sw < 16 || sh < 16) return null;
  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  const octx = out.getContext("2d");
  if (!octx) return null;
  octx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/webp", 0.9));
  return blob ? URL.createObjectURL(blob) : null;
}

/** Same-page addresses only: data and blob addresses are already ours, and another origin cannot be read. */
function readable(src: string): boolean {
  if (typeof window === "undefined" || !src || src.startsWith("data:") || src.startsWith("blob:")) return false;
  try {
    return new URL(src, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/** The address to draw: a frameless copy once a frame has been found, the picture's own address until then and otherwise. */
export function useFramelessSrc(src: string | null | undefined): string | undefined {
  const [shown, setShown] = useState<{ from: string; to: string } | null>(null);
  useEffect(() => {
    if (!src || !readable(src)) return;
    let live = true;
    let reading = readings.get(src);
    if (!reading) {
      reading = unframed(src).catch(() => null);
      readings.set(src, reading);
    }
    reading.then((to) => {
      if (live && to) setShown({ from: src, to });
    });
    return () => {
      live = false;
    };
  }, [src]);
  if (!src) return undefined;
  return shown && shown.from === src ? shown.to : src;
}

/**
 * Only picture addresses reach the `<img>`: a page path, http(s), a blob copy,
 * or an inline image. Anything else (a `javascript:` address in a stored
 * picture field, say) draws nothing. Every address the app hands this today
 * passes unchanged.
 */
export function safeImageSrc(src: string | null | undefined): string | undefined {
  if (!src) return undefined;
  const s = src.trim();
  if (/^data:image\//i.test(s)) return src;
  try {
    const base = typeof window === "undefined" ? "http://localhost/" : window.location.href;
    const { protocol } = new URL(s, base);
    return protocol === "http:" || protocol === "https:" || protocol === "blob:" ? src : undefined;
  } catch {
    return undefined;
  }
}

/** A drop-in `<img>` for character art. `onError` still reports the picture's own address failing. */
export default function FramelessImg({ src, alt = "", ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src?: string | null }) {
  const shown = useFramelessSrc(safeImageSrc(src));
  return <img src={shown} alt={alt} {...rest} />;
}
