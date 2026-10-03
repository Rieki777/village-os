/**
 * MARKDOWN TO EMAIL: the parser and the renderer every email's words pass
 * through (the comms build spec 5.5).
 *
 * PORTED FROM ReGen Civics' markdown letters (`shared/emailMarkdown.ts` there):
 * the same block grammar (paragraphs, three heading levels, nested lists,
 * quotes, an "Important:" callout, a rule, a line that is only a link becoming
 * a button, a line that is only an image), the same table-based button, and
 * merge tokens that survive the conversion so each reader's values go in last.
 * Two things changed on the way:
 *
 *   1. INLINE FORMATTING IS A TOKENIZER. The original ran five regular
 *      expressions over already-built HTML in turn, so an asterisk inside a
 *      link's address could open an `<em>` inside the `href`. Here one pass
 *      reads code, images, links, bold, italic and bare addresses left to
 *      right, and the text between them is escaped as text.
 *   2. LINKS ARE RESOLVED, NEVER TRUSTED. The original allowed any token as an
 *      address. Here every address, tokens and all, goes through the caller's
 *      `href`, which fills the tokens and refuses anything but http, https and
 *      mailto. An address that cannot be resolved leaves its words, unlinked.
 *
 * NO SANITIZER, AND WHY NONE IS NEEDED. Every character of the author's text
 * is escaped before it is written, and the only tags in the output are the
 * handful this file writes itself. No HTML an author types ever passes
 * through: `<script>` arrives in the inbox as the eight characters it is. The
 * original sanitised its output with `sanitize-html` because it accepted raw
 * HTML bodies too; this one has no path that takes HTML in, so there is
 * nothing for a sanitizer to remove, and no dependency is added for it.
 *
 * Styles are written on every tag, because email clients drop stylesheets.
 * The colours come in from `EmailStyle`, which `shared/comms/letterHtml.ts`
 * derives from the village's brand seed.
 *
 * Pure and isomorphic.
 */
import {
  blockValue,
  escapeHtml,
  isMissing,
  loneToken,
  MERGE_FIELDS_BY_KEY,
  tokensIn,
  type FillTracker,
  type MergeLink,
  type MergeValues,
} from "./mergeFields";

// ── Blocks ──────────────────────────────────────────────────────────────────

export interface ListNode {
  ordered: boolean;
  items: Array<{ text: string; children?: ListNode }>;
}

export type Block =
  | { type: "p"; text: string }
  | { type: "h"; level: 1 | 2 | 3; text: string }
  | { type: "list"; node: ListNode }
  | { type: "quote"; text: string }
  | { type: "callout"; text: string }
  | { type: "hr" }
  | { type: "cta"; label: string; href: string }
  | { type: "image"; alt: string; src: string }
  /** A list of links from a merge field, one per line. */
  | { type: "links"; links: MergeLink[] };

const LINK_ONLY = /^\[([^\]]+)\]\(([^)\s]+)\)$/;
const IMAGE_ONLY = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;
const IMPORTANT_LINE = /^(?:\*\*Important:?\*\*|Important:)\s*/i;
const RULE = /^(-{3,}|\*{3,}|_{3,})$/;

function parseListLine(line: string): { indent: number; ordered: boolean; text: string } | null {
  if (/^(\s*)(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return null;
  const m = line.match(/^([ \t]*)([-*]|\d+\.) (.+)$/);
  if (!m) return null;
  return { indent: m[1].replace(/\t/g, "  ").length, ordered: /^\d+\./.test(m[2]), text: m[3] };
}

type ListFrame = { indent: number; ordered: boolean; items: ListNode["items"] };

function closeList(stack: ListFrame[]): Block | null {
  if (stack.length === 0) return null;
  while (stack.length > 1) stack.pop();
  const root = stack.pop();
  if (!root || root.items.length === 0) return null;
  return { type: "list", node: { ordered: root.ordered, items: root.items } };
}

function pushListItem(stack: ListFrame[], indent: number, ordered: boolean, text: string): Block[] {
  const closed: Block[] = [];
  if (stack.length === 0) {
    stack.push({ indent, ordered, items: [{ text }] });
    return closed;
  }
  const top = stack[stack.length - 1];
  if (indent > top.indent) {
    const parent = top.items[top.items.length - 1];
    const child: ListNode = { ordered, items: [{ text }] };
    if (parent) parent.children = child;
    stack.push({ indent, ordered, items: child.items });
    return closed;
  }
  while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop();
  const current = stack[stack.length - 1];
  if (indent === current.indent && ordered !== current.ordered) {
    const block = closeList(stack);
    if (block) closed.push(block);
    stack.push({ indent, ordered, items: [{ text }] });
    return closed;
  }
  current.items.push({ text });
  return closed;
}

/**
 * Markdown into blocks. Text is kept exactly as written, tokens and all; it is
 * escaped when it is rendered, never here.
 */
export function parseBlocks(markdown: string): Block[] {
  const src = String(markdown ?? "").replace(/\r\n?/g, "\n").trim();
  if (!src) return [];
  const out: Block[] = [];
  const para: string[] = [];
  const stack: ListFrame[] = [];

  const endList = () => {
    const block = closeList(stack);
    if (block) out.push(block);
  };
  const endPara = () => {
    const text = para.join(" ").trim();
    para.length = 0;
    if (!text) return;
    out.push(IMPORTANT_LINE.test(text) ? { type: "callout", text } : { type: "p", text });
  };

  for (const line of src.split("\n")) {
    const trimmed = line.trim();
    const list = parseListLine(line);
    if (list) {
      endPara();
      out.push(...pushListItem(stack, list.indent, list.ordered, list.text));
      continue;
    }
    endList();
    if (!trimmed) {
      endPara();
      continue;
    }
    const image = trimmed.match(IMAGE_ONLY);
    if (image) {
      endPara();
      out.push({ type: "image", alt: image[1].trim(), src: image[2] });
      continue;
    }
    const link = trimmed.match(LINK_ONLY);
    if (link) {
      endPara();
      out.push({ type: "cta", label: link[1].trim(), href: link[2] });
      continue;
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      endPara();
      out.push({ type: "h", level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      continue;
    }
    if (RULE.test(trimmed)) {
      endPara();
      out.push({ type: "hr" });
      continue;
    }
    if (trimmed.startsWith("> ")) {
      endPara();
      out.push({ type: "quote", text: trimmed.slice(2) });
      continue;
    }
    para.push(trimmed);
  }
  endList();
  endPara();
  return out;
}

// ── Merge fields at the block level ─────────────────────────────────────────

/**
 * A paragraph that is nothing but one markdown or list field becomes that
 * field's own blocks: the host's recap becomes paragraphs, the vote's times
 * become a list of links. Everywhere else a field is filled inline, later.
 * The words a value brings are not expanded again here, so a recap that
 * happens to contain `{{recap.body}}` cannot repeat itself.
 */
export function expandFields(blocks: Block[], values: MergeValues): Block[] {
  const out: Block[] = [];
  for (const block of blocks) {
    const key = block.type === "p" ? loneToken(block.text) : null;
    const field = key ? MERGE_FIELDS_BY_KEY[key] : undefined;
    if (key && field && (field.type === "markdown" || field.type === "links")) {
      const value = blockValue(key, values);
      if (value && "markdown" in value) {
        out.push(...parseBlocks(value.markdown));
        continue;
      }
      if (value && "links" in value) {
        out.push({ type: "links", links: value.links });
        continue;
      }
    }
    out.push(block);
  }
  return out;
}

/** The words of a block, tokens and all, for deciding whether it stays. */
function wordsOf(block: Block): string {
  switch (block.type) {
    case "p":
    case "h":
    case "quote":
    case "callout":
      return block.text;
    case "cta":
      return `${block.label} ${block.href}`;
    case "image":
      return `${block.alt} ${block.src}`;
    default:
      return "";
  }
}

/**
 * Leave out every line that holds an optional field with no value, so an
 * email never says "Where:" and stops. A list loses only the items that hold
 * one (and anything nested under them), and a list left with no items goes.
 *
 * A paragraph ending in a colon belongs to what follows it: "Two quick
 * questions:" goes when the questions do.
 */
export function dropEmpty(blocks: Block[], values: MergeValues, tracker: FillTracker): Block[] {
  const lacks = (text: string): boolean => {
    let lacking = false;
    for (const key of tokensIn(text)) {
      if (MERGE_FIELDS_BY_KEY[key]?.optional && isMissing(key, values)) {
        tracker.omitted.add(key);
        lacking = true;
      }
    }
    return lacking;
  };
  const pruneList = (node: ListNode): ListNode | null => {
    const items: ListNode["items"] = [];
    for (const item of node.items) {
      if (lacks(item.text)) continue;
      const children = item.children ? pruneList(item.children) : null;
      items.push(children ? { text: item.text, children } : { text: item.text });
    }
    return items.length ? { ordered: node.ordered, items } : null;
  };

  const kept: Block[] = [];
  for (const block of blocks) {
    let next: Block | null = block;
    if (block.type === "list") {
      const node = pruneList(block.node);
      next = node ? { type: "list", node } : null;
    } else if (lacks(wordsOf(block))) {
      next = null;
    }
    if (next) {
      kept.push(next);
      continue;
    }
    const before = kept[kept.length - 1];
    if (before && before.type === "p" && before.text.trim().endsWith(":")) kept.pop();
  }
  return kept;
}

// ── Rendering ───────────────────────────────────────────────────────────────

/** The colours and type an email is drawn in. Every value is written into a style attribute. */
export interface EmailStyle {
  /** Body text. */
  ink: string;
  /** Quieter text: the footer, captions. */
  muted: string;
  /** Buttons, links and accents. White text clears AA on it. */
  brand: string;
  /** Text on a button. */
  brandText: string;
  /** Rules and the card's edge. */
  border: string;
  /** A light wash behind a callout. */
  tint: string;
  radiusPx: number;
  /** Font stacks, with no double quotes in them. */
  fontBody: string;
  fontDisplay: string;
}

/** How a renderer turns what an author wrote into addresses and attribute text. */
export interface InlineContext {
  style: EmailStyle;
  /** A link's target, tokens filled, as an address an email may carry. Null when it cannot be one. */
  href(raw: string): string | null;
  /** An image's source as an address an email may load. Null when it may not. */
  src(raw: string): string | null;
  /** Words bound for an attribute (an image's alt text), tokens filled as plain words. */
  attr(raw: string): string;
}

const INLINE_SOURCE =
  "`([^`\\n]+)`" + // 1: code
  "|!\\[([^\\]\\n]*)\\]\\(([^)\\s]+)\\)" + // 2, 3: image alt and source
  "|\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)" + // 4, 5: link label and target
  "|\\*\\*([^*\\n]+)\\*\\*" + // 6: bold
  "|\\*([^*\\n]+)\\*" + // 7: italic
  "|(https?:\\/\\/[^\\s<>()\"]*[^\\s<>().,;:!?'\"])"; // 8: a bare address, without trailing punctuation

export const linkStyle = (s: EmailStyle): string => `color:${s.brand};text-decoration:underline;`;

function imageTag(src: string, alt: string): string {
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" width="560" style="display:block;max-width:100%;height:auto;border:0;margin:0 0 16px 0;" />`;
}

function inlineHtmlWith(text: string, ctx: InlineContext, links: boolean): string {
  const s = ctx.style;
  let out = "";
  let last = 0;
  for (const m of Array.from(String(text ?? "").matchAll(new RegExp(INLINE_SOURCE, "g")))) {
    const at = m.index ?? 0;
    out += escapeHtml(text.slice(last, at));
    last = at + m[0].length;
    if (m[1] !== undefined) {
      out += `<code style="font-family:Menlo,Consolas,monospace;font-size:0.9em;background-color:${s.tint};padding:1px 4px;border-radius:3px;">${escapeHtml(m[1])}</code>`;
    } else if (m[3] !== undefined) {
      const src = ctx.src(m[3]);
      const alt = ctx.attr(m[2] ?? "");
      out += src ? imageTag(src, alt) : escapeHtml(alt);
    } else if (m[5] !== undefined) {
      const label = inlineHtmlWith(m[4] ?? "", ctx, false);
      const href = links ? ctx.href(m[5]) : null;
      out += href ? `<a href="${escapeHtml(href)}" style="${linkStyle(s)}">${label}</a>` : label;
    } else if (m[6] !== undefined) {
      out += `<strong>${inlineHtmlWith(m[6], ctx, links)}</strong>`;
    } else if (m[7] !== undefined) {
      out += `<em>${inlineHtmlWith(m[7], ctx, links)}</em>`;
    } else if (m[8] !== undefined) {
      const href = links ? ctx.href(m[8]) : null;
      out += href ? `<a href="${escapeHtml(href)}" style="${linkStyle(s)}">${escapeHtml(m[8])}</a>` : escapeHtml(m[8]);
    }
  }
  return out + escapeHtml(String(text ?? "").slice(last));
}

/** One line of markdown as email HTML. Tokens are left in place for `fill`. */
export function inlineHtml(text: string, ctx: InlineContext): string {
  return inlineHtmlWith(text, ctx, true);
}

/** One line of markdown as plain words. A link is written as its words and its address. */
export function inlineText(text: string, ctx: InlineContext): string {
  let out = "";
  let last = 0;
  for (const m of Array.from(String(text ?? "").matchAll(new RegExp(INLINE_SOURCE, "g")))) {
    const at = m.index ?? 0;
    out += text.slice(last, at);
    last = at + m[0].length;
    if (m[1] !== undefined) out += m[1];
    else if (m[3] !== undefined) out += ctx.attr(m[2] ?? "");
    else if (m[5] !== undefined) {
      const label = inlineText(m[4] ?? "", ctx);
      const href = ctx.href(m[5]);
      out += href ? (label.trim() === href ? href : `${label} (${href})`) : label;
    } else if (m[6] !== undefined) out += inlineText(m[6], ctx);
    else if (m[7] !== undefined) out += inlineText(m[7], ctx);
    else if (m[8] !== undefined) out += ctx.href(m[8]) ?? m[8];
  }
  return out + String(text ?? "").slice(last);
}

const paragraphStyle = (s: EmailStyle): string =>
  `margin:0 0 16px 0;font-family:${s.fontBody};font-size:16px;line-height:1.6;color:${s.ink};`;

/** The one button an email carries: a table, because that is what every client draws. */
export function buttonHtml(label: string, href: string, s: EmailStyle): string {
  return (
    `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:4px 0 20px 0;border-collapse:separate;">` +
    `<tr><td align="center" bgcolor="${s.brand}" style="border-radius:${s.radiusPx}px;background-color:${s.brand};">` +
    `<a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 22px;font-family:${s.fontBody};font-size:16px;font-weight:bold;line-height:1.2;color:${s.brandText};text-decoration:none;border-radius:${s.radiusPx}px;">${label}</a>` +
    `</td></tr></table>`
  );
}

function listHtml(node: ListNode, ctx: InlineContext): string {
  const s = ctx.style;
  const tag = node.ordered ? "ol" : "ul";
  const items = node.items
    .map(
      (item) =>
        `<li style="margin:0 0 6px 0;font-family:${s.fontBody};font-size:16px;line-height:1.6;color:${s.ink};">${inlineHtml(item.text, ctx)}${
          item.children ? listHtml(item.children, ctx) : ""
        }</li>`,
    )
    .join("");
  return `<${tag} style="margin:0 0 16px 0;padding:0 0 0 24px;">${items}</${tag}>`;
}

/** Blocks as email HTML, with no outer chrome. Tokens are left in place for `fill`. */
export function blocksHtml(blocks: Block[], ctx: InlineContext): string {
  const s = ctx.style;
  return blocks
    .map((block) => {
      switch (block.type) {
        case "p":
          return `<p style="${paragraphStyle(s)}">${inlineHtml(block.text, ctx)}</p>`;
        case "h": {
          const size = block.level === 1 ? 24 : block.level === 2 ? 20 : 17;
          return `<h${block.level} style="margin:24px 0 12px 0;font-family:${s.fontDisplay};font-size:${size}px;line-height:1.3;font-weight:bold;color:${s.ink};">${inlineHtml(block.text, ctx)}</h${block.level}>`;
        }
        case "list":
          return listHtml(block.node, ctx);
        case "quote":
          return `<blockquote style="margin:0 0 16px 0;padding:2px 0 2px 14px;border-left:3px solid ${s.brand};font-family:${s.fontBody};font-size:16px;line-height:1.6;color:${s.ink};">${inlineHtml(block.text, ctx)}</blockquote>`;
        case "callout":
          return (
            `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 16px 0;">` +
            `<tr><td style="background-color:${s.tint};border-left:4px solid ${s.brand};padding:12px 16px;">` +
            `<p style="margin:0;font-family:${s.fontBody};font-size:16px;line-height:1.6;color:${s.ink};">${inlineHtml(block.text, ctx)}</p>` +
            `</td></tr></table>`
          );
        case "hr":
          return `<hr style="border:0;border-top:1px solid ${s.border};margin:20px 0;" />`;
        case "cta": {
          const href = ctx.href(block.href);
          const label = inlineHtmlWith(block.label, ctx, false);
          return href ? buttonHtml(label, href, s) : `<p style="${paragraphStyle(s)}">${label}</p>`;
        }
        case "image": {
          const src = ctx.src(block.src);
          const alt = ctx.attr(block.alt);
          if (src) return imageTag(src, alt);
          return alt ? `<p style="${paragraphStyle(s)}">${escapeHtml(alt)}</p>` : "";
        }
        case "links":
          return `<ul style="margin:0 0 16px 0;padding:0 0 0 24px;">${block.links
            .map(
              (l) =>
                `<li style="margin:0 0 8px 0;font-family:${s.fontBody};font-size:16px;line-height:1.6;color:${s.ink};"><a href="${escapeHtml(l.href)}" style="${linkStyle(s)}">${escapeHtml(l.label)}</a></li>`,
            )
            .join("")}</ul>`;
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n");
}

function listText(node: ListNode, ctx: InlineContext, depth: number): string[] {
  const pad = "  ".repeat(depth);
  const lines: string[] = [];
  node.items.forEach((item, i) => {
    lines.push(`${pad}${node.ordered ? `${i + 1}.` : "-"} ${inlineText(item.text, ctx)}`);
    if (item.children) lines.push(...listText(item.children, ctx, depth + 1));
  });
  return lines;
}

/**
 * Blocks as the plain-text part. Every link keeps its address, written out,
 * because a reader whose client shows only text must still be able to act.
 */
export function blocksText(blocks: Block[], ctx: InlineContext): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "p":
        case "h":
        case "callout":
          return inlineText(block.text, ctx);
        case "quote":
          return `> ${inlineText(block.text, ctx)}`;
        case "list":
          return listText(block.node, ctx, 0).join("\n");
        case "hr":
          return "---";
        case "cta": {
          const href = ctx.href(block.href);
          const label = inlineText(block.label, ctx);
          return href ? `${label}: ${href}` : label;
        }
        case "image":
          return ctx.attr(block.alt);
        case "links":
          return block.links.map((l) => `- ${l.label}: ${l.href}`).join("\n");
        default:
          return "";
      }
    })
    .filter((s) => s.trim() !== "")
    .join("\n\n");
}
