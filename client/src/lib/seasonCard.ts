/**
 * THE SEASON SUMMARY AS A PICTURE A MEMBER CAN POST (idea 4).
 *
 * Two halves, kept apart on purpose:
 *
 *   `seasonCardModel`  what the image SAYS, decided from the summary and the
 *                      member's choices. Pure, so a test can hold the privacy
 *                      promise: cash never reaches the image unless the member
 *                      turned it on, and the same for every other section.
 *   `drawSeasonCard`   how it LOOKS: a 1080 x 1350 canvas (a portrait post on
 *                      every network), painted with the profile's own night
 *                      tokens read off the page, so a village that re-tints its
 *                      gold gets its own gold in the picture.
 *
 * No library: the canvas API draws text, circles and gradients, which is all
 * the card is, and a page-to-image package would cost the dist budget for a
 * screenshot of HTML we can draw directly.
 *
 * No ranking and no percentages, here or anywhere on the card.
 */
import { formatMoney } from "@shared/money";
import { CONTRIBUTION_WORDS, type SeasonSummary, type ShareChoices, type SummaryTokenLine } from "@shared/seasonSummary";

export interface SeasonCardModel {
  eyebrow: string;
  title: string;
  stats: Array<{ label: string; value: string }>;
  top: Array<{ kind: string; title: string; detail: string }>;
  badges: string[];
  footer: string;
}

/** Whole numbers where they are whole, two places where a token carries them. */
export function amountText(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

const tokenText = (lines: SummaryTokenLine[]) => lines.map((l) => `${amountText(l.amount)} ${l.name}`).join(", ");

export const firstName = (name: string): string => String(name ?? "").trim().split(/\s+/)[0] || "";

const monthYear = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
};

/** The season's span in words, the turn day being the first day of the next. */
export function seasonSpan(s: SeasonSummary["season"]): string {
  if (!s.endedOn) return `Since ${monthYear(s.startsOn)}`;
  const from = monthYear(s.startsOn);
  const last = new Date(`${s.endedOn}T12:00:00Z`);
  last.setUTCDate(last.getUTCDate() - 1);
  const to = monthYear(last.toISOString().slice(0, 10));
  return from === to ? from : `${from} to ${to}`;
}

/** A role's term in words. */
export function termText(term: { from: string; to: string | null } | null | undefined): string {
  if (!term) return "";
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return term.to ? `${day(term.from)} to ${day(term.to)}` : `since ${day(term.from)}`;
}

/** `thanksName` is the village's own name for its recognition token (`useTokenName`). */
export function seasonCardModel(s: SeasonSummary, choices: ShareChoices, thanksName: string): SeasonCardModel {
  const who = firstName(s.member.name);
  const stats: SeasonCardModel["stats"] = [];
  if (choices.earnings) {
    if (s.tokens.length) stats.push({ label: "Earned", value: tokenText(s.tokens) });
    if (s.voice.length) stats.push({ label: "Voice", value: tokenText(s.voice) });
  }
  if (choices.cash && s.cash.length) {
    stats.push({ label: "Cash", value: s.cash.map((c) => formatMoney(c.earnedMinor, c.currency)).join(", ") });
  }
  if (choices.gratitude && (s.gratitude.sentNotes || s.gratitude.receivedNotes)) {
    stats.push({
      label: thanksName,
      value: `${s.gratitude.sentNotes} sent, ${s.gratitude.receivedNotes} received`,
    });
  }
  const work = [
    s.counts.quests ? `${s.counts.quests} ${s.counts.quests === 1 ? "quest" : "quests"}` : "",
    s.counts.roles ? `${s.counts.roles} ${s.counts.roles === 1 ? "role" : "roles"}` : "",
    s.counts.proposals ? `${s.counts.proposals} ${s.counts.proposals === 1 ? "proposal adopted" : "proposals adopted"}` : "",
  ].filter(Boolean);
  if (work.length) stats.push({ label: "Work", value: work.join(", ") });

  return {
    eyebrow: `${s.season.name} · ${seasonSpan(s.season)}`,
    title: who ? `${who}'s season` : "My season",
    stats,
    top: s.top.map((c) => ({
      kind: CONTRIBUTION_WORDS[c.kind],
      title: c.title,
      detail: c.kind === "role" ? termText(c.term) : "",
    })),
    badges: s.badges.map((b) => (b.count > 1 ? `${b.name} ×${b.count}` : b.name)),
    footer: "Thank you for the season",
  };
}

/** The colours and faces the card paints with, read off the night world on the page. */
export interface CardPalette {
  ground: string;
  panel: string;
  ink: string;
  dim: string;
  gold: string;
  goldLit: string;
  edge: string;
  display: string;
  body: string;
}

/**
 * Read the live tokens from an element inside `.sheet-night`. Each one falls
 * back to the night world's own default, the values index.css declares.
 */
export function paletteFrom(el: Element | null): CardPalette {
  const css = el ? getComputedStyle(el) : null;
  const v = (name: string, fallback: string) => (css?.getPropertyValue(name).trim() || fallback);
  return {
    ground: v("--background", "#0d1411"),
    panel: v("--card", "#16221c"),
    ink: v("--foreground", "#e9efe6"),
    dim: v("--muted-foreground", "#9cb0a3"),
    gold: v("--sheet-notice", "#dfab4d"),
    goldLit: v("--sheet-earned-lit", "#f2ce85"),
    edge: v("--border", "#6d8175"),
    display: v("--card-display", "Georgia, serif"),
    body: v("--card-body", "system-ui, sans-serif"),
  };
}

export const CARD_W = 1080;
export const CARD_H = 1350;

/** Lines of `text` no wider than `max`, at most `limit` of them, the last clipped with an ellipsis. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, limit: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= max || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= limit) return lines;
  const kept = lines.slice(0, limit);
  let last = kept[limit - 1];
  while (last.length > 1 && ctx.measureText(`${last}…`).width > max) last = last.slice(0, -1);
  kept[limit - 1] = `${last}…`;
  return kept;
}

/** Paint the card. Returns the canvas so a caller can take a PNG off it. */
export function drawSeasonCard(canvas: HTMLCanvasElement, m: SeasonCardModel, p: CardPalette): HTMLCanvasElement {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const pad = 96;
  const inner = CARD_W - pad * 2;

  // The night, with a glow where the title sits.
  ctx.fillStyle = p.ground;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const glow = ctx.createRadialGradient(CARD_W / 2, 300, 40, CARD_W / 2, 300, 760);
  glow.addColorStop(0, p.panel);
  glow.addColorStop(1, p.ground);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // A scatter of stars, placed by a fixed pattern so two renders match.
  ctx.fillStyle = p.goldLit;
  for (let i = 0; i < 46; i++) {
    ctx.globalAlpha = 0.15 + (i % 5) * 0.1;
    ctx.beginPath();
    ctx.arc(((i * 41) % 98) / 100 * CARD_W, ((i * 29) % 94) / 100 * CARD_H, i % 5 === 0 ? 3 : 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // A gold frame, inset.
  ctx.strokeStyle = p.gold;
  ctx.lineWidth = 2;
  ctx.strokeRect(40, 40, CARD_W - 80, CARD_H - 80);

  let y = 170;
  ctx.textAlign = "center";
  ctx.fillStyle = p.gold;
  ctx.font = `500 26px ${p.body}`;
  ctx.fillText(m.eyebrow.toUpperCase(), CARD_W / 2, y);

  y += 100;
  ctx.fillStyle = p.ink;
  ctx.font = `600 96px ${p.display}`;
  for (const line of wrap(ctx, m.title, inner, 2)) {
    ctx.fillText(line, CARD_W / 2, y);
    y += 104;
  }

  // The numbers, label over value, two to a row so the badges always fit.
  ctx.textAlign = "left";
  y += 10;
  const gap = 48;
  const col = (inner - gap) / 2;
  for (let i = 0; i < m.stats.length; i += 2) {
    let rowEnd = y;
    m.stats.slice(i, i + 2).forEach((s, j) => {
      const x = pad + j * (col + gap);
      let cy = y;
      ctx.fillStyle = p.gold;
      ctx.font = `500 22px ${p.body}`;
      ctx.fillText(s.label.toUpperCase(), x, cy);
      cy += 42;
      ctx.fillStyle = p.ink;
      ctx.font = `400 32px ${p.body}`;
      for (const line of wrap(ctx, s.value, col, 2)) {
        ctx.fillText(line, x, cy);
        cy += 40;
      }
      rowEnd = Math.max(rowEnd, cy);
    });
    y = rowEnd + 22;
  }

  // The member's own best work, one panel each.
  if (m.top.length) {
    y += 6;
    ctx.fillStyle = p.gold;
    ctx.font = `500 22px ${p.body}`;
    ctx.fillText("WHAT I CARRIED", pad, y);
    y += 24;
    for (const c of m.top) {
      const h = c.detail ? 112 : 84;
      ctx.fillStyle = p.panel;
      ctx.strokeStyle = p.edge;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(pad, y, inner, h, 18);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = p.dim;
      ctx.font = `500 20px ${p.body}`;
      ctx.fillText(c.kind.toUpperCase(), pad + 28, y + 34);
      ctx.fillStyle = p.ink;
      ctx.font = `500 30px ${p.body}`;
      ctx.fillText(wrap(ctx, c.title, inner - 56, 1)[0] ?? "", pad + 28, y + 70);
      if (c.detail) {
        ctx.fillStyle = p.dim;
        ctx.font = `400 22px ${p.body}`;
        ctx.fillText(c.detail, pad + 28, y + 100);
      }
      y += h + 14;
    }
  }

  // Badges as a line of gold names.
  if (m.badges.length) {
    y += 20;
    ctx.fillStyle = p.gold;
    ctx.font = `500 22px ${p.body}`;
    ctx.fillText("BADGES", pad, y);
    y += 42;
    ctx.fillStyle = p.goldLit;
    ctx.font = `500 30px ${p.body}`;
    for (const line of wrap(ctx, m.badges.join("  ·  "), inner, 2)) {
      ctx.fillText(line, pad, y);
      y += 40;
    }
  }

  ctx.textAlign = "center";
  ctx.fillStyle = p.gold;
  ctx.font = `italic 500 34px ${p.display}`;
  ctx.fillText(m.footer, CARD_W / 2, CARD_H - 96);
  return canvas;
}

/** Wait for the faces the card names, so the canvas never paints in a fallback. */
export async function fontsReady(p: CardPalette): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load(`600 96px ${p.display}`),
      document.fonts.load(`italic 500 34px ${p.display}`),
      document.fonts.load(`400 34px ${p.body}`),
      document.fonts.load(`500 22px ${p.body}`),
    ]);
  } catch {
    /* a face that will not load is drawn in its fallback */
  }
}

/** The card as a PNG blob, or null when the browser cannot encode one. */
export function cardPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), "image/png");
    } catch {
      resolve(null);
    }
  });
}
