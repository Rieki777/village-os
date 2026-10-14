/**
 * THE WHOLE EMAIL: words and a person's values in, the HTML document and its
 * plain-text twin out (the comms build spec 5.5).
 *
 * PORTED FROM ReGen Civics' `shared/letterHtml.ts` and `shared/letterLayout.ts`:
 * one outer table at 600 pixels, the body in a white card, a footer that says
 * where the email came from and how to change what arrives. What changed is
 * whose email it is. The original drew one organisation's colours, logo and
 * postal line into every letter; here all of that is the village's own:
 *
 *   - the colours derive from the village's brand seed through
 *     `shared/brandTokens.ts`, the same derivation the site uses, so white on
 *     the button clears AA for every seed. A village with no seed gets a
 *     neutral grey that looks like nobody in particular.
 *   - the logo is `brand.images.logo`, and an email without one shows the name.
 *   - the footer names the village, its postal address from Comms Settings, why
 *     the reader got this email, and the reader's own preferences link.
 *
 * ALWAYS A PLAIN-TEXT PART AND A PREHEADER. The text part carries every link
 * the HTML does, written out. A template with no preheader of its own gets the
 * opening words of its body, so an inbox never shows the first line of the
 * footer instead.
 *
 * ONE COMPOSER. `composeEmail` is what the preview calls and what every send
 * calls, so the words a founder approves in a preview are the words that go.
 *
 * Pure and isomorphic.
 */
import { deriveTheme } from "../brandTokens";
import { whyYouGotThis } from "./defaults/templates";
import type { EmailKind } from "./kinds";
import {
  blocksHtml,
  blocksText,
  dropEmpty,
  expandFields,
  linkStyle,
  parseBlocks,
  type EmailStyle,
  type InlineContext,
} from "./markdown";
import {
  escapeHtml,
  fill,
  newTracker,
  plainValue,
  resolveLink,
  safeUrl,
  type FillTracker,
  type MergeValues,
} from "./mergeFields";

/** The village as an email shows it. Read once per batch of sends, never per token. */
export interface EmailVillage {
  name: string;
  /** The village's own site, an absolute origin with no trailing slash. Empty when unknown. */
  url: string;
  /** An absolute address for the logo, or null to show the name alone. */
  logoUrl: string | null;
  /** The brand seed colour (`brand.theme.seed`), or null for the neutral look. */
  seed: string | null;
  /** The character card (`brand.theme.character`). */
  character: string | null;
  /** The postal address for the footer, from Comms Settings. Empty leaves the line out. */
  postalAddress: string;
}

/** The words of one email, before any person's values. */
export interface EmailWords {
  subject: string;
  preheader: string | null;
  bodyMd: string;
}

export interface ComposeInput {
  words: EmailWords;
  values: MergeValues;
  village: EmailVillage;
  kind: EmailKind;
  /** Decides the footer's "why you got this" line. */
  templateKey?: string | null;
}

export interface ComposedEmail {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  /** Fields that had no value and rendered their fallback. A preview warns about these. */
  missing: string[];
  /** Optional fields that had no value, so their lines were left out. */
  omitted: string[];
  /** Tokens that name no field. They render as nothing. */
  unknown: string[];
}

// ── The look ────────────────────────────────────────────────────────────────

/** System fonts: the only faces nearly every mail client draws. */
const SYSTEM_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * The look with no seed. Neutral greys: #404040 carries white at 10.4 to 1 and
 * #57606a reads at 6.1 to 1 on the white card.
 */
export const NEUTRAL_STYLE: EmailStyle = {
  ink: "#1f2328",
  muted: "#57606a",
  brand: "#404040",
  brandText: "#ffffff",
  border: "#e4e4e7",
  tint: "#f4f4f5",
  radiusPx: 8,
  fontBody: SYSTEM_STACK,
  fontDisplay: SYSTEM_STACK,
};

/** The page around the card. */
const NEUTRAL_BACKGROUND = "#f4f4f5";

/** A font stack fit for a style attribute: double quotes become single ones. */
const attrStack = (stack: string): string => stack.replace(/"/g, "'");

/**
 * The village's colours, derived from its seed exactly as the site derives
 * them. The pairings an email draws were each checked by the derivation: white
 * on `--tone-brand` clears AA body text, and ink and muted text were measured
 * against grounds darker than the white card they sit on here, so they only
 * gain contrast.
 */
export function emailLook(seed: string | null, character: string | null): { style: EmailStyle; background: string } {
  const derived = deriveTheme(seed, character);
  if (!derived) return { style: NEUTRAL_STYLE, background: NEUTRAL_BACKGROUND };
  const v = derived.vars;
  return {
    style: {
      ink: v["--foreground"],
      muted: v["--muted-foreground"],
      brand: v["--tone-brand"],
      brandText: "#ffffff",
      border: v["--border"],
      tint: v["--muted"],
      radiusPx: Math.min(12, Math.round(derived.card.radiusRem * 16)),
      fontBody: SYSTEM_STACK,
      fontDisplay: `${attrStack(derived.fonts.display)}, ${SYSTEM_STACK}`,
    },
    background: v["--background"],
  };
}

// ── Pieces ──────────────────────────────────────────────────────────────────

/** Collapse a subject or preheader to one clean line. */
const oneLine = (s: string, max: number): string =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** The opening words of the text part, cut at a word, for an email with no preheader of its own. */
function openingWords(text: string): string {
  const body = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^(-|\d+\.|>)\s/.test(l));
  // Skip the greeting: "Hi Sam," says nothing in an inbox line.
  const lines = body.length > 1 && /^(hi|hello|dear)\b.*,$/i.test(body[0]) ? body.slice(1) : body;
  const joined = lines.join(" ").replace(/\s+/g, " ").trim();
  if (joined.length <= 110) return joined;
  const cut = joined.slice(0, 110);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 60)).trim()}...`;
}

/**
 * Hidden text that pads the preheader, so an inbox does not carry on into the
 * body after it. Zero-width joiners with a non-breaking space, the usual way.
 */
const PREHEADER_PAD = "&#847;&zwnj;&nbsp;".repeat(30);

function documentHtml(p: {
  subject: string;
  preheader: string;
  inner: string;
  village: EmailVillage;
  look: { style: EmailStyle; background: string };
  why: string;
  preferencesUrl: string | null;
}): string {
  const s = p.look.style;
  const name = escapeHtml(p.village.name);
  const logo = p.village.logoUrl
    ? `<img src="${escapeHtml(p.village.logoUrl)}" alt="${name}" height="48" style="display:block;height:48px;width:auto;max-width:240px;border:0;margin:0 0 10px 0;" />`
    : "";
  const footer = [
    `<p style="margin:0 0 6px 0;font-family:${s.fontBody};font-size:13px;line-height:1.5;color:${s.ink};font-weight:bold;">${name}</p>`,
    p.village.postalAddress.trim()
      ? `<p style="margin:0 0 6px 0;font-family:${s.fontBody};font-size:13px;line-height:1.5;color:${s.muted};">${escapeHtml(p.village.postalAddress.trim())}</p>`
      : "",
    `<p style="margin:0 0 6px 0;font-family:${s.fontBody};font-size:13px;line-height:1.5;color:${s.muted};">${escapeHtml(p.why)}</p>`,
    p.preferencesUrl
      ? `<p style="margin:0;font-family:${s.fontBody};font-size:13px;line-height:1.5;color:${s.muted};"><a href="${escapeHtml(p.preferencesUrl)}" style="color:${s.muted};text-decoration:underline;">Choose which emails you get</a></p>`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(p.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${p.look.background};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${p.look.background};mso-hide:all;">${escapeHtml(p.preheader)}${PREHEADER_PAD}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:${p.look.background};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid ${s.border};border-radius:${s.radiusPx}px;">
<tr><td style="padding:28px 28px 4px 28px;">
${logo}<p style="margin:0 0 12px 0;font-family:${s.fontDisplay};font-size:18px;line-height:1.3;font-weight:bold;color:${s.brand};">${name}</p>
</td></tr>
<tr><td style="padding:8px 28px 8px 28px;">
${p.inner}
</td></tr>
<tr><td style="padding:16px 28px 26px 28px;border-top:1px solid ${s.border};">
${footer}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function footerText(village: EmailVillage, why: string, preferencesUrl: string | null): string {
  return [
    "--",
    village.name,
    village.postalAddress.trim(),
    why,
    preferencesUrl ? `Choose which emails you get: ${preferencesUrl}` : "",
  ]
    .filter((l) => l.trim() !== "")
    .join("\n");
}

// ── The composer ────────────────────────────────────────────────────────────

/** Where an image in an email may come from: the village's own site over https. */
function imageFrom(village: EmailVillage) {
  let host = "";
  try {
    host = village.url ? new URL(village.url).host : "";
  } catch {
    host = "";
  }
  return (resolved: string | null): string | null => {
    if (!resolved || !host) return null;
    try {
      const u = new URL(resolved);
      return u.protocol === "https:" && u.host === host ? resolved : null;
    } catch {
      return null;
    }
  };
}

/**
 * Words plus a person's values, made into one email.
 *
 * The village's own facts (`village.name`, `village.url`, `footer.address`)
 * always come from `village`, whatever the values say, so an email can never
 * claim to be from somewhere else.
 */
export function composeEmail(input: ComposeInput): ComposedEmail {
  const village = input.village;
  const values: MergeValues = {
    ...input.values,
    "village.name": village.name,
    "village.url": village.url,
    "footer.address": village.postalAddress,
  };
  const tracker: FillTracker = newTracker();
  const look = emailLook(village.seed, village.character);
  const base = village.url || null;
  const image = imageFrom(village);

  const ctx: InlineContext = {
    style: look.style,
    href: (raw) => resolveLink(raw, values, base, tracker),
    src: (raw) => image(resolveLink(raw, values, base, tracker)),
    // Braces are dropped from attribute words, so nothing a value carries can
    // be read as a token by the fill that follows.
    attr: (raw) => fill(raw, values, { mode: "text", tracker }).out.replace(/[{}]/g, ""),
  };

  const blocks = dropEmpty(expandFields(parseBlocks(input.words.bodyMd), values), values, tracker);
  const bodyHtml = fill(blocksHtml(blocks, ctx), values, { mode: "html", linkStyle: linkStyle(look.style), tracker }).out;
  const bodyText = fill(blocksText(blocks, ctx), values, { mode: "text", tracker }).out;

  const subject = oneLine(fill(input.words.subject, values, { mode: "text", tracker }).out, 200) || village.name;
  const ownPreheader = input.words.preheader ? oneLine(fill(input.words.preheader, values, { mode: "text", tracker }).out, 200) : "";
  // Always a preheader: the template's own, else the body's opening words, else
  // the subject, so an inbox never fills the line with the footer.
  const preheader = ownPreheader || oneLine(openingWords(bodyText), 200) || subject;

  // The footer's own reads go through a scratch tracker: a template that never
  // names the preferences link is not missing it, the footer carries it.
  const footerTracker = newTracker();
  const why = oneLine(fill(whyYouGotThis(input.templateKey ?? null, input.kind), values, { mode: "text", tracker: footerTracker }).out, 300);
  const preferences = safeUrl(plainValue("links.preferences", values, footerTracker));

  return {
    subject,
    preheader,
    html: documentHtml({ subject, preheader, inner: bodyHtml, village, look, why, preferencesUrl: preferences }),
    text: `${bodyText}\n\n${footerText(village, why, preferences)}\n`,
    missing: Array.from(tracker.missing).sort(),
    omitted: Array.from(tracker.omitted).sort(),
    unknown: Array.from(tracker.unknown).sort(),
  };
}
