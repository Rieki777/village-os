/**
 * The shareable card's words and drawing (ShareLines.tsx is its button).
 *
 * The colours are the profile's night theme, read from the page at draw time
 * (`.sheet-night`'s own variables in index.css), so a village's brand reaches
 * the card the way it reaches every other surface. The literals below are only
 * the fallbacks index.css itself declares.
 */
import { withArticle, type GeneKeysView } from "@shared/geneKeys";

export const CARD_W = 1080;
export const CARD_H = 1350;

const FALLBACK = { ground: "#0d1411", gold: "#dfab4d", text: "#e9efe6", muted: "#9cb0a3", line: "#1c2b23" };
type Ink = typeof FALLBACK;

/** The night theme's colours as this page resolves them. */
export function nightInk(): Ink {
  if (typeof document === "undefined") return FALLBACK;
  const probe = document.createElement("div");
  probe.className = "sheet-night";
  probe.style.display = "none";
  document.body.append(probe);
  const cs = getComputedStyle(probe);
  const read = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const ink = {
    ground: read("--background", FALLBACK.ground),
    gold: read("--sheet-notice", FALLBACK.gold),
    text: read("--foreground", FALLBACK.text),
    muted: read("--muted-foreground", FALLBACK.muted),
    line: read("--muted", FALLBACK.line),
  };
  probe.remove();
  return ink;
}

/** Every word the card prints, apart from the drawing so a test can read it. */
export function shareCardWords(view: GeneKeysView, village: string) {
  return {
    eyebrow: `MY LINES IN ${village.toUpperCase()}`,
    profile: view.profile,
    names: view.names,
    type: `${withArticle(view.type).replace(/^./, (c) => c.toUpperCase())} · ${view.strategy}`,
    keys: view.spheres.map((s) => ({ name: s.name, keyLine: s.keyLine })),
    footer: "Gene Keys by Richard Rudd · genekeys.com",
    text: `My lines in ${village}: ${view.profile}, ${view.names}.`,
  };
}

export function drawShareCard(ctx: CanvasRenderingContext2D, view: GeneKeysView, village: string, ink: Ink = nightInk()): void {
  const w = shareCardWords(view, village);
  const display = '"Marcellus", Georgia, serif';
  const body = '"Montserrat", system-ui, sans-serif';
  ctx.fillStyle = ink.ground;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.strokeStyle = ink.gold;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 3;
  ctx.strokeRect(40, 40, CARD_W - 80, CARD_H - 80);
  ctx.globalAlpha = 1;
  ctx.textAlign = "center";

  ctx.fillStyle = ink.gold;
  ctx.font = `600 34px ${body}`;
  ctx.fillText(w.eyebrow.split("").join(" "), CARD_W / 2, 150);

  // The six lines, bottom up, the member's two lit: the first solid, the second a ring.
  const [first, second] = view.lines;
  const barW = 300, barH = 30, gap = 22, top = 220;
  for (let n = 1; n <= 6; n++) {
    const y = top + (6 - n) * (barH + gap);
    const x = (CARD_W - barW) / 2;
    if (n === first) {
      ctx.fillStyle = ink.gold;
      ctx.fillRect(x, y, barW, barH);
    } else if (n === second) {
      ctx.strokeStyle = ink.gold;
      ctx.lineWidth = 6;
      ctx.strokeRect(x + 3, y + 3, barW - 6, barH - 6);
    } else {
      ctx.fillStyle = ink.line;
      ctx.fillRect(x, y, barW, barH);
    }
  }

  ctx.fillStyle = ink.gold;
  ctx.font = `150px ${display}`;
  ctx.fillText(w.profile, CARD_W / 2, 700);
  ctx.fillStyle = ink.text;
  ctx.font = `84px ${display}`;
  ctx.fillText(w.names, CARD_W / 2, 810);
  ctx.fillStyle = ink.muted;
  ctx.font = `40px ${body}`;
  ctx.fillText(w.type, CARD_W / 2, 880);

  const colW = (CARD_W - 160) / 4;
  w.keys.forEach((k, i) => {
    const cx = 80 + colW * i + colW / 2;
    ctx.fillStyle = ink.muted;
    ctx.font = `28px ${body}`;
    ctx.fillText(k.name, cx, 1010);
    ctx.fillStyle = ink.gold;
    ctx.font = `64px ${display}`;
    ctx.fillText(k.keyLine, cx, 1090);
  });

  ctx.fillStyle = ink.muted;
  ctx.font = `28px ${body}`;
  ctx.fillText(w.footer, CARD_W / 2, CARD_H - 90);
}

/** The card as a PNG, drawn once the display face has loaded (or a fallback serif prints instead). */
export async function shareCardBlob(view: GeneKeysView, village: string): Promise<Blob | null> {
  await document.fonts?.load?.('84px "Marcellus"').catch(() => undefined);
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  drawShareCard(ctx, view, village);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}
