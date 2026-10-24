/**
 * What a link preview reads: the <title>, description and og: tags spliced
 * into the one static index.html for every page the server serves.
 *
 * client/index.html is neutral by construction (it is served byte for byte to
 * every deployment), and a crawler runs no JavaScript, so a title or picture
 * the client paints later is invisible to exactly the readers this is for.
 * Until 2026-10-22 only /quests was rewritten, and every other link to every
 * village unfurled as "Village" with no picture.
 */
import { documentTitle } from "../../shared/pageTitles";
import { SITE_PAGE } from "../../shared/pageContent/site";
import { resolvePage, resolvePageRaw } from "../../shared/pageContent/resolve";
import { pageSectionKey } from "../../shared/pageContent/types";

export interface PageMeta {
  title: string;
  description: string;
  /** Absolute URL, or "" for none. */
  image: string;
  /** Absolute URL of this page, or "" when the origin is unknown. */
  url: string;
  siteName: string;
  type: "website" | "article";
  imageSize?: { width: number; height: number };
  /** Ask search engines to leave this address out: a page this village does not serve. */
  noindex?: boolean;
}

const escapeAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function trimTo(s: string, n = 200): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}...` : s;
}

export function metaTags(m: PageMeta): string {
  return [
    `<title>${escapeAttr(m.title)}</title>`,
    m.description ? `<meta name="description" content="${escapeAttr(m.description)}" />` : "",
    `<meta property="og:type" content="${m.type}" />`,
    `<meta property="og:site_name" content="${escapeAttr(m.siteName)}" />`,
    `<meta property="og:title" content="${escapeAttr(m.title)}" />`,
    m.description ? `<meta property="og:description" content="${escapeAttr(m.description)}" />` : "",
    m.url ? `<meta property="og:url" content="${escapeAttr(m.url)}" />` : "",
    m.image ? `<meta property="og:image" content="${escapeAttr(m.image)}" />` : "",
    m.image && m.imageSize ? `<meta property="og:image:width" content="${m.imageSize.width}" />` : "",
    m.image && m.imageSize ? `<meta property="og:image:height" content="${m.imageSize.height}" />` : "",
    `<meta name="twitter:card" content="${m.image ? "summary_large_image" : "summary"}" />`,
    m.url ? `<link rel="canonical" href="${escapeAttr(m.url)}" />` : "",
    m.noindex ? `<meta name="robots" content="noindex" />` : "",
  ]
    .filter(Boolean)
    .join("\n    ");
}

/**
 * The neutral tags come OUT before ours go in. Two og:title tags is not a
 * richer card, it is a coin toss over which one a crawler believes.
 */
export function spliceMeta(shell: string, m: PageMeta): string {
  return shell
    .replace(/<title>[\s\S]*?<\/title>\s*/i, "")
    .replace(/<meta\s+name="description"[^>]*>\s*/i, "")
    .replace(/<meta\s+property="og:[^"]*"[^>]*>\s*/gi, "")
    .replace("</head>", `  ${metaTags(m)}\n  </head>`);
}

interface SiteConfig {
  project: { name: string; tagline?: string; commitmentName?: string; location?: string };
  images?: { hero?: string };
}

const absolute = (src: string, origin: string): string => {
  const s = src.trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return origin && s.startsWith("/") ? origin + s : "";
};

/**
 * The share card for an ordinary page: the page's own name, the village's
 * share sentence (Admin, Pages, Whole site) or its Tagline, and its share
 * picture or homepage picture.
 *
 * `hidden` is a story page this village does not serve (shared/brochure.ts):
 * its route is the not-found page, so its card must not advertise it. It reads
 * as the village alone, names no address of its own, and asks search engines
 * to leave it out.
 */
export function sitePageMeta(
  path: string,
  origin: string,
  config: SiteConfig,
  content: Record<string, unknown> | null,
  hidden = false,
): PageMeta {
  const village = config.project.name;
  const site = resolvePage(SITE_PAGE, content?.[pageSectionKey(SITE_PAGE)], {
    village,
    tagline: config.project.tagline ?? "",
    location: config.project.location ?? "",
  }).share.fields;
  return {
    title: hidden ? village : documentTitle(path, village, { commitment: config.project.commitmentName }),
    description: trimTo((site.description || config.project.tagline || "").trim()),
    image: absolute(site.image || config.images?.hero || "", origin),
    url: origin && !hidden ? origin + path : "",
    siteName: village,
    type: "website",
    ...(hidden ? { noindex: true } : {}),
  };
}

/**
 * The site-wide words the shell paints on every page, served inside
 * /api/game/config so the footer costs no request of its own.
 */
export function siteWords(
  content: Record<string, unknown> | null,
  config: SiteConfig,
): { footerSignoff: string; menu: Record<string, { label: string; subtitle: string }>; menuChanged: string[] } {
  const stored = content?.[pageSectionKey(SITE_PAGE)];
  const site = resolvePage(SITE_PAGE, stored, {
    village: config.project.name,
    tagline: config.project.tagline ?? "",
    location: config.project.location ?? "",
    commitment: config.project.commitmentName?.trim() || "membership agreement",
  });
  const defaults = resolvePageRaw(SITE_PAGE, null).menu.lists.pages;
  const raw = resolvePageRaw(SITE_PAGE, stored).menu.lists.pages;
  const menu: Record<string, { label: string; subtitle: string }> = {};
  const menuChanged: string[] = [];
  site.menu.lists.pages.forEach((row, i) => {
    const id = String(row.id);
    menu[id] = { label: row.label, subtitle: row.subtitle };
    if (raw[i].label !== defaults[i].label || raw[i].subtitle !== defaults[i].subtitle) menuChanged.push(id);
  });
  return { footerSignoff: site.footer.fields.signoff, menu, menuChanged };
}
