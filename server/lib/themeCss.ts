/**
 * The village's theme layer: a stylesheet the SERVER emits from the brand
 * document. First consumer of the design-token spec (docs/DESIGN_TOKENS_SPEC.md
 * §6.2); today it carries typography, and the colour roles land in the same
 * file when the token layer ships.
 *
 * Why a server-emitted stylesheet at all: a village's brand font is
 * DEPLOYMENT DATA. Serenity — Amora's heading font, downloaded from a
 * free-fonts aggregator with no licence grant — used to be platform code that
 * every fork inherited along with whatever its licence turns out to be. Now
 * the platform ships licence-clean OFL defaults, and a village that brings a
 * font declares it in its own brand document: their deployment, their font,
 * their licence.
 *
 * Everything here is emitted into CSS, so everything here is sanitised as if
 * it were hostile — these fields are admin-written today, but "only admins
 * can inject a stylesheet" is not a security posture. The rules:
 *
 *  - The import URL must be https or a same-origin /api/uploads path, and is
 *    emitted inside url("…") with quotes/backslashes/parens stripped, so it
 *    cannot close the wrapper and start a new rule.
 *  - Font stacks may contain only what a font stack is made of: names,
 *    quotes, commas, hyphens, digits, spaces. One brace or semicolon and the
 *    whole value is discarded rather than "cleaned" — a filter that repairs
 *    hostile input eventually repairs it into something that parses.
 *
 * `:root:root` doubles specificity so these overrides beat the platform
 * defaults in index.css regardless of stylesheet order — Vite appends the
 * bundle's <link> after this one, and load order must not decide who wins.
 */

import { deriveTheme } from "../../shared/brandTokens";

export interface BrandThemeFields {
  /** The three founder decisions (docs/DESIGN_TOKENS_SPEC.md §3.1). */
  seed?: string;
  character?: string;
  place?: string;
  /**
   * The optional pinned accent, for a guide whose accent is a different
   * family from its seed. deriveTheme measures it like a derived one; blank
   * or invalid keeps the character's rotation.
   */
  accent?: string;
  /** URL of a CSS file carrying the village's @font-face declarations. */
  fontImportUrl?: string;
  /** Full font-family stacks; blank = keep the platform default. */
  fontDisplay?: string;
  fontBody?: string;
  fontAccent?: string;
  /**
   * An UPLOADED font package (Admin → Typography): the file lands in the
   * uploads volume behind a licence acknowledgment, and these two fields make
   * it a real face. Both must be present and clean or neither is emitted —
   * half a @font-face is a name that silently renders in the fallback.
   */
  fontFaceName?: string;
  fontFaceUrl?: string;
}

/** A stack is names, quotes, commas, hyphens, digits, spaces — nothing else. */
const FONT_STACK_OK = /^[\w\s,"'&-]+$/;

export function sanitizeFontStack(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > 300 || !FONT_STACK_OK.test(v)) return null;
  return v;
}

export function sanitizeImportUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > 500) return null;
  // Same-origin uploads or https. Explicitly not http: — a font CSS fetched
  // over http would be the one unencrypted request on the page.
  if (!/^https:\/\/[^\s]+$/.test(v) && !/^\/api\/uploads\/[A-Za-z0-9._-]+$/.test(v)) return null;
  // Characters that could terminate url("…") or smuggle a second rule.
  if (/["'()\\<>]/.test(v.replace(/^https:\/\//, ""))) return null;
  return v;
}

/** A family NAME (not a stack): letters, digits, spaces, hyphens. */
const FONT_NAME_OK = /^[A-Za-z0-9][A-Za-z0-9 -]{0,78}$/;

export function sanitizeFontName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return FONT_NAME_OK.test(v) ? v : null;
}

/** The format() hint browsers want, from the file extension. */
export function fontFormatOf(url: string): string | null {
  const ext = url.toLowerCase().match(/\.(woff2|woff|ttf|otf)$/)?.[1];
  if (!ext) return null;
  return { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" }[ext] ?? null;
}

export function buildThemeCss(theme: BrandThemeFields | null | undefined): string {
  if (!theme) return "";
  const parts: string[] = [];

  // @import must precede every other rule — CSS discards it otherwise.
  const importUrl = sanitizeImportUrl(theme.fontImportUrl);
  if (importUrl) parts.push(`@import url("${importUrl}");`);

  // The uploaded package. All three pieces — clean name, clean URL, known
  // format — or nothing: a partial declaration would LOOK configured while
  // rendering the fallback, which is the worst of both.
  const faceName = sanitizeFontName(theme.fontFaceName);
  const faceUrl = sanitizeImportUrl(theme.fontFaceUrl);
  const faceFormat = faceUrl ? fontFormatOf(faceUrl) : null;
  if (faceName && faceUrl && faceFormat) {
    parts.push(
      `@font-face {\n  font-family: "${faceName}";\n  src: url("${faceUrl}") format("${faceFormat}");\n  font-weight: 100 900;\n  font-display: swap;\n}`,
    );
  }

  const vars: string[] = [];

  // The palette: everything derives from (seed, character). deriveTheme's
  // output is our own hex — no sanitising needed — and its absence is the
  // neutral fork emitting nothing. The card also implies a type pairing,
  // which an EXPLICIT font choice below always beats.
  const derived = deriveTheme(theme.seed, theme.character, theme.accent);
  if (derived) {
    for (const [k, v] of Object.entries(derived.vars)) vars.push(`  ${k}: ${v};`);
  }

  const display = sanitizeFontStack(theme.fontDisplay) ?? (derived ? derived.fonts.display : null);
  const body = sanitizeFontStack(theme.fontBody) ?? (derived ? derived.fonts.body : null);
  const accent = sanitizeFontStack(theme.fontAccent) ?? (derived ? derived.fonts.accent : null);
  if (display) vars.push(`  --font-display: ${display};`);
  if (body) vars.push(`  --font-body: ${body};`);
  if (accent) vars.push(`  --font-accent: ${accent};`);
  if (vars.length) parts.push(`:root:root {\n${vars.join("\n")}\n}`);

  return parts.length ? parts.join("\n") + "\n" : "";
}
