/**
 * THE MERGE FIELDS an email's words may use, and the one function that puts a
 * person's values into them (the comms build spec 5.5).
 *
 * A template is written once and read by everybody it goes to. Its words carry
 * tokens such as `{{person.firstName}}` or `{{gathering.when}}`, and this file
 * declares every token there is: what it holds, which emails can use it, and
 * what an email says when the value is missing. The Words screen's picker reads
 * this catalogue, the renderer reads it, and the save route refuses a token it
 * does not know, so all three agree by construction.
 *
 * ── WHAT A MISSING VALUE DOES ──────────────────────────────────────────────
 *
 * Every field declares a FALLBACK, and a missing value renders it. A fallback
 * may itself name other fields (`{{village.url}}/events`), resolved a few
 * levels deep and never in a loop. Some fields are OPTIONAL instead: the reader's
 * own time zone, the room of an online gathering. An optional field with no
 * value takes its whole line with it, so an email never reads "Where: " with
 * nothing after it. Both are reported, so a preview can warn the editor.
 *
 * ── ESCAPING ───────────────────────────────────────────────────────────────
 *
 * `fill()` puts values into words in one of two modes. In `html` every value
 * is escaped, so a name typed as `<b>Sam</b>` arrives as those characters and
 * never as markup. In `text` the value is left exactly as it is, because a
 * plain-text part has nothing to escape and an escaped ampersand there reads as
 * `&amp;`. Values are put in ONCE, in a single pass, so a value that happens to
 * contain `{{something}}` is never expanded again.
 *
 * Pure and isomorphic: the client's picker and the server's renderer import the
 * same catalogue.
 */
import type { EmailKind } from "./kinds";

// ── Tokens ──────────────────────────────────────────────────────────────────

/**
 * One merge token: dotted lowercase words in double braces, the shape the
 * defaults test pins (`{{group.field}}`). A source string, so every caller makes
 * its own global RegExp and no two scans share a `lastIndex`.
 */
export const MERGE_TOKEN_SOURCE = "\\{\\{([a-z][a-zA-Z]*(?:\\.[a-z][a-zA-Z]*)+)\\}\\}";

/** A fresh global matcher for merge tokens. */
export const mergeTokenPattern = (): RegExp => new RegExp(MERGE_TOKEN_SOURCE, "g");

/** The field keys a piece of text names, each once, in the order they first appear. */
export function tokensIn(text: string): string[] {
  const seen = new Set<string>();
  for (const m of Array.from(String(text ?? "").matchAll(mergeTokenPattern()))) seen.add(m[1]);
  return Array.from(seen);
}

/** True when the whole of `text`, trimmed, is one token. Answers that token's key, or null. */
export function loneToken(text: string): string | null {
  const m = String(text ?? "").trim().match(new RegExp(`^${MERGE_TOKEN_SOURCE}$`));
  return m ? m[1] : null;
}

// ── Values ──────────────────────────────────────────────────────────────────

/** A link inside a list-shaped value: the time-vote options, the calendar links. */
export interface MergeLink {
  label: string;
  href: string;
}

/**
 * What a caller may put in a field.
 *
 *   string                 text, a link, or markdown, by the field's type
 *   { markdown }           words a person wrote, rendered with the email
 *   { links }              a list of links, one per line in a block
 */
export type MergeValue = string | { markdown: string } | { links: MergeLink[] } | null | undefined;
export type MergeValues = Record<string, MergeValue>;

// ── The catalogue ───────────────────────────────────────────────────────────

/**
 *   text      a word or a sentence, escaped into the email
 *   url       a link; only http, https and mailto are ever written as a link
 *   markdown  a person's own words: a recap, a letter, a description
 *   links     a list of links, such as the times in a vote
 */
export type MergeFieldType = "text" | "url" | "markdown" | "links";

/** The groups the picker shows, each a family of facts one kind of email knows. */
export const MERGE_GROUPS = ["common", "action", "lettersConfirm", "gathering", "poll", "recap", "nextGathering", "path", "letter"] as const;
export type MergeGroup = (typeof MERGE_GROUPS)[number];

export const MERGE_GROUP_LABELS: Record<MergeGroup, string> = {
  common: "Every email",
  action: "The seat confirmation",
  lettersConfirm: "The letters confirmation",
  gathering: "The gathering",
  poll: "The time vote",
  recap: "The recap",
  nextGathering: "The next gathering",
  path: "The path",
  letter: "The letter",
};

export interface MergeField {
  key: string;
  group: MergeGroup;
  type: MergeFieldType;
  /** The picker's name for it. */
  label: string;
  /** One sentence for the editor: what it holds, and how to use it. */
  hint: string;
  /** What a missing value renders. May name other fields, which are filled in turn. */
  fallback: string;
  /** A missing optional field leaves out the whole line that holds it. */
  optional?: boolean;
}

const f = (
  key: string,
  group: MergeGroup,
  type: MergeFieldType,
  label: string,
  hint: string,
  fallback: string,
  optional = false,
): MergeField => ({ key, group, type, label, hint, fallback, ...(optional ? { optional: true } : {}) });

/**
 * Every field there is. The groups and the first names come from the spec's
 * table (5.5). Seven fields were added because the emails the spec names
 * cannot be written without them: `links.confirm` (a guest's one-click
 * confirmation of their seat), `links.lettersConfirm` (the letters double
 * opt-in, under the name the people lane posts it with), `gathering.recapLink`
 * (the host nudge links straight to the composer), `recap.missedNote` (the note
 * for people who missed it, which `event_recaps.missed_note_md` holds), and the
 * letter's own subject and preheader.
 *
 * THE TWO CONFIRM LINKS ARE SEPARATE FIELDS IN SEPARATE GROUPS on purpose. Each
 * confirmation email can use only its own, so a village editing the letters
 * confirmation cannot put the guest's link in it, which would render empty for
 * every reader and leave them no way to say yes.
 */
export const MERGE_FIELDS: readonly MergeField[] = [
  // Every email.
  f("village.name", "common", "text", "Village name", "Your village's name, as your site shows it.", "our village"),
  f("village.url", "common", "url", "Village site", "Your site's address. Put a page after it inside a link: [See the calendar]({{village.url}}/events).", ""),
  f("person.firstName", "common", "text", "First name", "The reader's first name.", "there"),
  f("person.name", "common", "text", "Full name", "The reader's full name.", "friend"),
  f("links.preferences", "common", "url", "Email choices link", "The reader's own page for choosing which emails they get. Every footer carries it already.", "", true),
  f("footer.address", "common", "text", "Postal address", "The postal address from Comms Settings. Every footer carries it already.", "", true),

  // A guest's one-click confirmation of their seat.
  f("links.confirm", "action", "url", "Confirm link", "The one-click link that confirms the guest's seat. Make it the email's button.", ""),

  // The letters double opt-in.
  f("links.lettersConfirm", "lettersConfirm", "url", "Confirm letters link", "The one-click link that says yes to letters. Make it the email's button.", ""),

  // The gathering.
  f("gathering.title", "gathering", "text", "Title", "The gathering's name.", "the gathering"),
  f("gathering.when", "gathering", "text", "When, village time", "The day and time in the village's own time zone, written out: Saturday, October 4 at 10:00 AM.", "the time on the gathering page"),
  f("gathering.whenLocal", "gathering", "text", "When, reader's time", "The same moment in the reader's own time zone. Left out when we don't know their zone, or it matches the village's.", "", true),
  f("gathering.where", "gathering", "text", "Where", "The place. Left out for a gathering that only meets online.", "", true),
  f("gathering.joinLink", "gathering", "url", "Online room", "The link into the online room. It always points at the current room, so a changed room never breaks an old email.", "", true),
  f("gathering.url", "gathering", "url", "Gathering page", "The gathering's own page.", "{{village.url}}/events"),
  f("gathering.cantMakeIt", "gathering", "url", "Can't make it link", "One click that gives the reader's seat back.", "", true),
  f("gathering.calendarLinks", "gathering", "links", "Calendar links", "Add-to-calendar links for Google and Outlook.", "", true),
  f("gathering.hostName", "gathering", "text", "Host", "The name of the person hosting it.", "the host"),
  f("gathering.description", "gathering", "markdown", "Description", "What the gathering is about, in the host's words.", "", true),
  f("gathering.recapLink", "gathering", "url", "Recap composer", "The host's page for writing the recap.", "{{gathering.url}}"),

  // The time vote.
  f("poll.options", "poll", "links", "The times", "One link per time on offer. Put it on a line of its own.", "", true),
  f("poll.closesAt", "poll", "text", "Vote closes", "When the vote closes. Left out for a weekly vote, which stays open.", "", true),
  f("poll.leading", "poll", "text", "Leading time", "The time ahead right now.", "", true),

  // The recap.
  f("recap.body", "recap", "markdown", "Recap", "The host's recap. Put it on a line of its own.", "The host's notes are on the gathering page."),
  f("recap.missedNote", "recap", "markdown", "Note for people who missed it", "The host's extra note for people who said yes and missed it.", "", true),
  f("recap.recording", "recap", "url", "Recording", "The link to the recording, when there is one.", "", true),
  f("recap.questions", "recap", "links", "The two questions", "The two recap questions from Comms Settings, as one-click links. Put it on a line of its own.", "", true),

  // The next gathering.
  f("nextGathering.title", "nextGathering", "text", "Next gathering", "The next public gathering's name.", "", true),
  f("nextGathering.when", "nextGathering", "text", "Next gathering, when", "When the next public gathering meets, in village time.", "", true),
  f("nextGathering.rsvpLink", "nextGathering", "url", "Save me a seat", "One click that says yes to the next gathering.", "", true),

  // The path.
  f("path.name", "path", "text", "Path name", "The path's name, as your site shows it.", "chosen"),
  f("path.nextStep", "path", "text", "Next step", "The next step on the path, in a few words.", "read the path page and choose where to begin"),
  f("path.nextStepLink", "path", "url", "Next step link", "Where the next step is taken.", "{{path.pageUrl}}"),
  f("path.pageUrl", "path", "url", "Path page", "The path's own page on your site.", "{{village.url}}"),
  f("path.contactName", "path", "text", "Who writes back", "The person who writes to people on this path, from Comms Settings.", "someone from our team"),
  f("path.contactEmail", "path", "text", "Their address", "That person's email address.", "", true),

  // The letter.
  f("letter.body", "letter", "markdown", "The letter", "The letter itself. Put it on a line of its own.", ""),
  f("letter.subject", "letter", "text", "Letter subject", "The letter's own subject line.", "News from {{village.name}}"),
  f("letter.preheader", "letter", "text", "Letter preview line", "The letter's own preview line.", "", true),
];

export const MERGE_FIELDS_BY_KEY: Readonly<Record<string, MergeField>> = Object.fromEntries(
  MERGE_FIELDS.map((field) => [field.key, field]),
);

// ── Which emails know which facts ───────────────────────────────────────────

/**
 * The groups one template may use, read off its key. Each email knows the
 * facts of what made it and no others: a path email never knows a time vote,
 * so a token from the vote in a path email would only ever render its fallback,
 * and the save route refuses it with a sentence saying so.
 */
export function groupsForTemplate(templateKey: string): MergeGroup[] {
  const key = String(templateKey ?? "");
  if (key === "gathering.guest_confirm") return ["common", "action", "gathering"];
  if (key === "gathering.recap_came" || key === "gathering.recap_missed") return ["common", "gathering", "recap", "nextGathering"];
  if (key.startsWith("gathering.")) return ["common", "gathering"];
  if (key.startsWith("poll.")) return ["common", "gathering", "poll"];
  if (key.startsWith("path.")) return ["common", "path", "nextGathering"];
  if (key.startsWith("member.") || key.startsWith("joining.")) return ["common", "nextGathering"];
  if (key === "letters.confirm") return ["common", "lettersConfirm"];
  if (key.startsWith("letter.")) return ["common", "letter"];
  return ["common"];
}

/** Every field one template may use, in catalogue order. */
export function fieldsForTemplate(templateKey: string): MergeField[] {
  const groups = new Set(groupsForTemplate(templateKey));
  return MERGE_FIELDS.filter((field) => groups.has(field.group));
}

/**
 * The tokens in some words that this template cannot use, split by why:
 * `unknown` names no field at all, `unavailable` names a field this email
 * never knows.
 */
export function fieldProblems(templateKey: string, text: string): { unknown: string[]; unavailable: string[] } {
  const allowed = new Set(fieldsForTemplate(templateKey).map((field) => field.key));
  const unknown: string[] = [];
  const unavailable: string[] = [];
  for (const key of tokensIn(text)) {
    if (!MERGE_FIELDS_BY_KEY[key]) unknown.push(key);
    else if (!allowed.has(key)) unavailable.push(key);
  }
  return { unknown, unavailable };
}

// ── Escaping and links ──────────────────────────────────────────────────────

/** Escape a string for HTML text or a double-quoted attribute. */
export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A link that may be written into an email, or null.
 *
 * Only `http`, `https` and `mailto` survive; `javascript:` and every other
 * scheme are refused. A relative path is resolved against `base` (the village's
 * own site) when one is given, and refused when not, because a relative link in
 * an inbox points nowhere. Braces are percent-encoded on the way out, so a link
 * can never smuggle a merge token past the one pass that fills them.
 */
export function safeUrl(raw: string, base?: string | null): string | null {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 2000 || /[\s<>"]/.test(s)) return null;
  if (/^mailto:/i.test(s)) return /^mailto:[^\s<>"{}]+@[^\s<>"{}]+$/i.test(s) ? s : null;
  let parsed: URL;
  try {
    parsed = base ? new URL(s, base) : new URL(s);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;
  let out = parsed.toString();
  // A bare site address stays bare. The parser writes `https://v.org` as
  // `https://v.org/`, and `{{village.url}}/events` would then read `//events`.
  if (parsed.pathname === "/" && !parsed.search && !parsed.hash && !/\/$/.test(s)) out = out.replace(/\/$/, "");
  return out.replace(/\{/g, "%7B").replace(/\}/g, "%7D");
}

// ── Reading a value ─────────────────────────────────────────────────────────

/** A value read against its field's type, or null when there is nothing usable. */
type Resolved =
  | { kind: "text"; value: string }
  | { kind: "url"; value: string }
  | { kind: "markdown"; value: string }
  | { kind: "links"; value: MergeLink[] };

function cleanLinks(links: unknown): MergeLink[] {
  if (!Array.isArray(links)) return [];
  const out: MergeLink[] = [];
  for (const l of links) {
    const label = typeof l?.label === "string" ? l.label.trim() : "";
    const href = typeof l?.href === "string" ? safeUrl(l.href) : null;
    if (label && href) out.push({ label, href });
  }
  return out;
}

/** The value a caller gave for one field, read against that field's type. Null when there is none. */
function valueFor(field: MergeField, v: MergeValue): Resolved | null {
  if (v == null) return null;
  if (field.type === "links") {
    const links = typeof v === "object" && "links" in v ? cleanLinks(v.links) : [];
    return links.length ? { kind: "links", value: links } : null;
  }
  if (field.type === "markdown") {
    const md = typeof v === "string" ? v : typeof v === "object" && "markdown" in v ? String(v.markdown ?? "") : "";
    return md.trim() ? { kind: "markdown", value: md } : null;
  }
  const s = typeof v === "string" ? v : "";
  if (!s.trim()) return null;
  if (field.type === "url") {
    const url = safeUrl(s);
    return url ? { kind: "url", value: url } : null;
  }
  return { kind: "text", value: s };
}

/** Tracks what a render could not fill, across every pass it makes. */
export interface FillTracker {
  /** Fields that had no value and rendered their fallback. */
  missing: Set<string>;
  /** Optional fields that had no value, so their line was left out. */
  omitted: Set<string>;
  /** Tokens that name no field at all. */
  unknown: Set<string>;
}

export const newTracker = (): FillTracker => ({ missing: new Set(), omitted: new Set(), unknown: new Set() });

/** True when a field has no usable value in `values`. */
export function isMissing(key: string, values: MergeValues): boolean {
  const field = MERGE_FIELDS_BY_KEY[key];
  return !field || valueFor(field, values[key]) === null;
}

const MAX_FALLBACK_DEPTH = 3;

/**
 * One field's value, or its fallback when it has none. A fallback naming other
 * fields is filled in plain text, at most a few levels deep, so two fallbacks
 * naming each other end in an empty string and never in a loop.
 */
function resolve(key: string, values: MergeValues, tracker: FillTracker, depth = 0): Resolved {
  const field = MERGE_FIELDS_BY_KEY[key];
  if (!field) {
    tracker.unknown.add(key);
    return { kind: "text", value: "" };
  }
  const given = valueFor(field, values[key]);
  if (given) return given;
  if (field.optional) tracker.omitted.add(key);
  else tracker.missing.add(key);
  if (depth >= MAX_FALLBACK_DEPTH) return { kind: "text", value: "" };
  const fallback = field.fallback.replace(mergeTokenPattern(), (_m, inner: string) =>
    plainOf(resolve(inner, values, tracker, depth + 1)),
  );
  if (field.type === "url") {
    const url = safeUrl(fallback);
    return url ? { kind: "url", value: url } : { kind: "text", value: "" };
  }
  return { kind: field.type === "markdown" ? "markdown" : "text", value: fallback };
}

/** Items joined the way a sentence would join them: "a, b or c". */
function sentenceList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/**
 * Markdown read as plain words: emphasis and code marks dropped, a link kept as
 * its label, heading and quote marks dropped, paragraphs joined by a space.
 * Used where a person's own words land inside a sentence or a subject line.
 */
export function plainFromMarkdown(md: string): string {
  return String(md ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((para) =>
      para
        .split("\n")
        .map((line) => line.trim().replace(/^#{1,3}\s+/, "").replace(/^>\s?/, "").replace(/^([-*]|\d+\.)\s+/, ""))
        .join(" "),
    )
    .join(" ")
    .replace(/!\[([^\]]*)\]\([^)\s]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)\s]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function plainOf(r: Resolved): string {
  if (r.kind === "links") return sentenceList(r.value.map((l) => l.label));
  if (r.kind === "markdown") return plainFromMarkdown(r.value);
  return r.value;
}

// ── Filling ─────────────────────────────────────────────────────────────────

export interface FillOptions {
  mode: "html" | "text";
  /** The inline style of a link `fill` writes in html mode. */
  linkStyle?: string;
  /** Collects what could not be filled. A fresh one is made when absent. */
  tracker?: FillTracker;
}

export interface FillResult {
  out: string;
  /** Fields that rendered their fallback. */
  missing: string[];
  /** Optional fields that had no value. */
  omitted: string[];
  /** Tokens that name no field. They render as nothing. */
  unknown: string[];
}

function inlineHtml(r: Resolved, linkStyle: string): string {
  const style = linkStyle ? ` style="${escapeHtml(linkStyle)}"` : "";
  if (r.kind === "url") return `<a href="${escapeHtml(r.value)}"${style}>${escapeHtml(r.value)}</a>`;
  if (r.kind === "links") {
    return sentenceList(r.value.map((l) => `<a href="${escapeHtml(l.href)}"${style}>${escapeHtml(l.label)}</a>`));
  }
  return escapeHtml(plainOf(r));
}

function inlineText(r: Resolved): string {
  if (r.kind === "links") return sentenceList(r.value.map((l) => `${l.label} (${l.href})`));
  return plainOf(r);
}

/**
 * Put values into words. One pass, so nothing a value carries is expanded.
 *
 * In `html` mode the words are taken to be HTML already (the renderer has
 * escaped them) and only the VALUES are escaped. A link-shaped value becomes a
 * link, and a list of links becomes "a, b or c" with each one a link. In `text`
 * mode every value goes in as it is, and a link is written out in full so the
 * plain-text part carries every address.
 */
export function fill(template: string, values: MergeValues, opts: FillOptions): FillResult {
  const tracker = opts.tracker ?? newTracker();
  const out = String(template ?? "").replace(mergeTokenPattern(), (_m, key: string) => {
    const r = resolve(key, values, tracker);
    return opts.mode === "html" ? inlineHtml(r, opts.linkStyle ?? "") : inlineText(r);
  });
  return { out, missing: Array.from(tracker.missing), omitted: Array.from(tracker.omitted), unknown: Array.from(tracker.unknown) };
}

/**
 * A link written with tokens in it, resolved to an address or to null.
 *
 * A token at the very start is the link's base (`{{village.url}}/events`) and
 * goes in as it is. A token anywhere after it is a value inside an address and
 * is percent-encoded, so a name can never end the address early. Relative
 * results resolve against `base`.
 */
export function resolveLink(raw: string, values: MergeValues, base: string | null, tracker: FillTracker): string | null {
  const s = String(raw ?? "").trim();
  const mailto = /^mailto:/i.test(s);
  const filled = s.replace(mergeTokenPattern(), (_m, key: string, offset: number) => {
    const plain = plainOf(resolve(key, values, tracker));
    return offset === 0 || mailto ? plain.trim() : encodeURIComponent(plain);
  });
  return safeUrl(filled, base);
}

/** One field's value as plain words, its fallback when it has none. For attributes and subject lines. */
export function plainValue(key: string, values: MergeValues, tracker: FillTracker): string {
  return plainOf(resolve(key, values, tracker));
}

/**
 * A field's markdown or links value when it is present, for the renderer's
 * block-level fields. Null when the field is missing or of another type.
 */
export function blockValue(key: string, values: MergeValues): { markdown: string } | { links: MergeLink[] } | null {
  const field = MERGE_FIELDS_BY_KEY[key];
  if (!field) return null;
  const r = valueFor(field, values[key]);
  if (r?.kind === "markdown") return { markdown: r.value };
  if (r?.kind === "links") return { links: r.value };
  return null;
}

// ── The kind each email is posted as ────────────────────────────────────────

/**
 * The kind an email built from this template is posted as, read off its key.
 * The journey that sends it says the same thing (shared/comms/defaults/journeys.ts);
 * this answers for the emails no journey sends. Decides the footer's "why you
 * got this" line and the Words screen's grouping.
 */
export function kindForTemplate(templateKey: string): EmailKind {
  const key = String(templateKey ?? "");
  if (key === "gathering.guest_confirm" || key === "letters.confirm") return "essential";
  if (key.startsWith("gathering.") || key.startsWith("poll.")) return "events";
  if (key.startsWith("letter.")) return "letters";
  if (key.startsWith("path.") || key.startsWith("member.") || key.startsWith("joining.")) return "paths";
  return "essential";
}

// ── Sample values, for a preview ────────────────────────────────────────────

/**
 * A value for every field, for previews and for "Send me a test". Every link
 * points at the village's own site, so a test email never sends anybody
 * anywhere else, and the one-click links carry a token no page will accept, so
 * pressing one in a test changes nothing. Times are written as weekdays with no
 * date, so a sample never reads as out of date.
 *
 * The reader is whoever asked for the preview, which is what makes a test
 * email greet the person who pressed the button.
 */
export function sampleValues(input: {
  villageUrl: string;
  firstName?: string | null;
  fullName?: string | null;
  /** The path page, for a path email's sample next step. */
  pathUrl?: string | null;
}): MergeValues {
  const site = String(input.villageUrl ?? "").replace(/\/+$/, "");
  const at = (path: string) => (site ? `${site}${path}` : "");
  const first = String(input.firstName ?? "").trim() || "Sam";
  const full = String(input.fullName ?? "").trim() || first;
  const action = at("/email/a?t=sample");
  const pathPage = String(input.pathUrl ?? "").trim() || at("/");
  return {
    "path.pageUrl": pathPage,
    "path.nextStepLink": pathPage,
    "person.firstName": first,
    "person.name": full,
    "links.preferences": at("/email/preferences?t=sample"),
    "links.confirm": action,
    "links.lettersConfirm": action,
    "gathering.title": "Community supper",
    "gathering.when": "Saturday at 6:00 PM",
    "gathering.whenLocal": "Saturday at 7:00 PM",
    "gathering.where": "The common house",
    "gathering.joinLink": at("/events"),
    "gathering.url": at("/events"),
    "gathering.cantMakeIt": action,
    "gathering.calendarLinks": site
      ? { links: [{ label: "Google Calendar", href: at("/events") }, { label: "Outlook", href: at("/events") }] }
      : null,
    "gathering.hostName": "Alex",
    "gathering.description": { markdown: "Bring a dish to share if you can. Everyone eats either way." },
    "gathering.recapLink": at("/events"),
    "poll.options": site
      ? {
          links: [
            { label: "Tuesday at 6:00 PM", href: action },
            { label: "Wednesday at 6:00 PM", href: action },
            { label: "Thursday at 12:30 PM", href: action },
          ],
        }
      : null,
    "poll.closesAt": "Friday at 8:00 PM",
    "poll.leading": "Wednesday at 6:00 PM",
    "recap.body": {
      markdown:
        "Fourteen of us came. We planted the new bed by the kitchen, sorted the seed bank, and finished the soup.\n\n**Next time:** we start on the compost bays.",
    },
    "recap.missedNote": { markdown: "If you'd like a job for next time, the seed sorting isn't finished." },
    "recap.recording": at("/events"),
    "recap.questions": site
      ? {
          links: [
            { label: "Was it worth your time? Yes", href: action },
            { label: "Was it worth your time? No", href: action },
            { label: "What would make the next one better?", href: action },
          ],
        }
      : null,
    "nextGathering.title": "Seed swap",
    "nextGathering.when": "Sunday at 3:00 PM",
    "nextGathering.rsvpLink": action,
    "path.nextStep": "tell us what you're looking for",
    "path.contactName": "Jordan",
    "path.contactEmail": "jordan@example.org",
    "letter.body": {
      markdown:
        "The well is finished, and the water tested clean.\n\nThank you to everyone who carried pipe in the rain. We'll show it off at the next supper.",
    },
    "letter.subject": "The well is finished",
    "letter.preheader": "And the water tested clean.",
  };
}

// ── Times, written the way the words expect them ────────────────────────────

/**
 * A gathering's start written the way the default words were written against:
 * `when` in the village's own zone ("Saturday, October 4 at 10:00 AM"), and
 * `whenLocal` in the reader's zone when it is known and differs, else the empty
 * string, which leaves the "Your time" line out of the email.
 *
 * For the lanes that fill `gathering.when` and `gathering.whenLocal`; a zone the
 * runtime does not know reads as unknown.
 */
export function gatheringWhen(
  start: Date,
  villageZone: string,
  readerZone?: string | null,
  locale = "en-US",
): { when: string; whenLocal: string } {
  // Newer ICU puts a narrow no-break space before "AM"; a plain-text part reads
  // better with an ordinary one. Built from code points, so this file carries
  // no invisible characters.
  const oddSpaces = new RegExp(`[${String.fromCharCode(0x202f, 0x00a0)}]`, "g");
  const phrase = (zone: string): string | null => {
    try {
      const day = new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", timeZone: zone }).format(start);
      const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: zone }).format(start);
      return `${day} at ${time}`.replace(oddSpaces, " ");
    } catch {
      return null;
    }
  };
  const when = phrase(villageZone) ?? phrase("UTC") ?? "";
  if (!readerZone || readerZone === villageZone) return { when, whenLocal: "" };
  const local = phrase(readerZone);
  return { when, whenLocal: local && local !== when ? local : "" };
}
