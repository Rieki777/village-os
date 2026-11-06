/**
 * The plain words for each difference between the outside service's chart and
 * the live chart here (shared/seraDifferences.ts), for the review page and its
 * tests alike.
 *
 * WHITE LABEL (spec R34). The agent's name is always handed in: the server
 * reads it from the module's own config (`saberraAgentName`), and nothing here
 * names a village. This village is "here" and "ours". "Archived" is what the
 * service did; "retired" is what happens here.
 *
 * The sentences are the spec's R35 table, the flags R39's words, and the
 * source line R35's last row. No kind, field key, page id or JSON is ever
 * part of a sentence.
 *
 * A ROLE IS NAMED WITH ITS HOLDERS (Rye, 2026-10-30, "Role (FirstName)"): the
 * read hands in the first names of who holds the role HERE, from the live
 * chart at view time, never from the service. A role nobody holds gets no
 * parentheses, and a possessive ("Treasurer's purpose") stays plain.
 *
 * Pure: no pool, no clock. A date is formatted in the time zone handed in.
 */
import type { Difference, DifferenceFlag, FlagKey } from "./seraDifferences";
import { roleWithHolders } from "./roleHolderLabel";

/** What the read knows here that the difference does not carry. */
export interface SentenceContext {
  /** Who holds the role here now, by name, read from the live chart. Absent when it was not read. */
  holders?: readonly string[];
}

const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
const possessive = (name: string): string => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/** "a and b", "a, b and c". */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** How a subject is named in a sentence: a role by its name, a circle as "the X circle". */
const label = (d: Difference): string => (d.subject.kind === "circle" ? `the ${d.subject.name} circle` : d.subject.name);

/** The same, with a role's holders here in parentheses. Only where the name stands alone, never in a possessive. */
const named = (d: Difference, ctx: SentenceContext): string =>
  d.subject.kind === "role" && d.subject.ourId !== null ? roleWithHolders(d.subject.name, ctx.holders ?? []) : label(d);

/** Dollars with thousands marked and cents only when there are some: "1,200", "1,200.50". */
function dollars(n: number): string {
  const [whole, cents] = n.toFixed(2).split(".");
  const marked = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return cents === "00" ? marked : `${marked}.${cents}`;
}

function paySentence(d: Difference, agent: string): string {
  const p = d.params ?? {};
  const model = typeof p.model === "string" && p.model ? p.model : null;
  const usd = typeof p.monthlyUsd === "number" ? p.monthlyUsd : null;
  let what = model ? `${/^[aeiou]/i.test(model) ? "an" : "a"} ${model.toLowerCase()}` : "";
  if (usd !== null) what += `${what ? " of " : ""}US$${dollars(usd)} a month for the whole role`;
  const standing =
    p.standing === "settled"
      ? `settled in ${agent}`
      : p.standing === "pending"
        ? `still pending in ${agent}`
        : p.standing === "agreed-not-paying"
          ? `agreed in ${agent} and not paying yet`
          : typeof p.statusLabel === "string" && p.statusLabel
            ? `marked ${p.statusLabel} in ${agent}`
            : null;
  const first = what ? `${agent} lists ${possessive(d.subject.name)} pay as ${what}` : `${agent} lists pay for ${d.subject.name}`;
  const said = standing ? `${first}, ${standing}.` : `${first}.`;
  if (d.ours === "none") return `${said} This village has no pay set for it.`;
  return `${said} It changed since the read before, and pay is already set here.`;
}

function presenceSentence(d: Difference, agent: string, ctx: SentenceContext): string {
  const missing = d.params?.reason === "missingTwice";
  const name = named(d, ctx);
  const adding = d.kind === "circleAdd" || d.kind === "roleAdd";
  if (adding && d.subject.ourId === null) {
    if (d.kind === "circleAdd") {
      const n = typeof d.params?.roles === "number" ? d.params.roles : 0;
      return n > 0
        ? `${agent} suggests a new circle, ${d.subject.name}, with ${n} ${n === 1 ? "role" : "roles"}.`
        : `${agent} suggests a new circle, ${d.subject.name}.`;
    }
    return d.subject.circleName
      ? `${agent} suggests a new role, ${d.subject.name}, in ${d.subject.circleName}.`
      : `${agent} suggests a new role, ${d.subject.name}.`;
  }
  if (adding) {
    return d.state === "oursAhead"
      ? `${cap(name)} was retired here. ${agent} still lists it.`
      : `${agent} lists ${name} again. It was retired here on ${possessive(agent)} word.`;
  }
  if (d.state === "oursAhead") {
    return `${cap(name)} was brought back here. ${agent} ${missing ? "still does not list it" : "still has it archived"}.`;
  }
  // Whether anybody holds it here, when the read said: nobody is worth saying out loud.
  const nobody = d.subject.kind === "role" && ctx.holders !== undefined && ctx.holders.length === 0;
  return `${agent} ${missing ? "no longer lists" : "has archived"} ${name}. It is still live here${nobody ? ", and nobody holds it" : ""}.`;
}

/** One difference as a sentence. `ctx` carries what the read knows here, such as who holds the role. */
export function differenceSentence(d: Difference, agent: string, ctx: SentenceContext = {}): string {
  const name = named(d, ctx);
  switch (d.kind) {
    case "circleAdd":
    case "roleAdd":
    case "circleRest":
    case "roleRest":
      return presenceSentence(d, agent, ctx);
    case "roleMove": {
      const from = typeof d.params?.from === "string" ? d.params.from : null;
      const to = listOf(Array.isArray(d.params?.to) ? d.params!.to : []);
      if (d.state === "oursAhead") return `${cap(name)} was moved here${from ? ` to ${from}` : ""}. ${agent} still has it in ${to}.`;
      if (d.state === "conflict") return `${cap(name)} was moved here and in ${agent}. Here it sits in ${from ?? "no circle"}, and ${agent} puts it in ${to}.`;
      return from ? `${agent} suggests moving ${name} from ${from} to ${to}.` : `${agent} suggests placing ${name} in ${to}.`;
    }
    case "rename":
      if (d.state === "oursAhead") return `${cap(name)} was renamed here. ${agent} still calls it ${d.sera}.`;
      if (d.state === "conflict") return `${cap(name)} was renamed here and in ${agent}, which calls it ${d.sera}.`;
      return `${agent} suggests renaming ${name} to ${d.sera}.`;
    case "textField":
      if (d.field === "aim") {
        if (d.state === "oursAhead") return `${possessive(cap(label(d)))} purpose was changed here. ${agent} still has the earlier words.`;
        if (d.state === "conflict") return `You and ${agent} both changed ${possessive(label(d))} purpose.`;
        return `${agent} has new words for ${possessive(label(d))} purpose.`;
      }
      return `${possessive(agent)} ${d.field === "Notes" ? "notes" : d.field} for ${name} changed.`;
    case "valueField":
      return `${possessive(agent)} ${d.field} for ${name} is now ${d.sera}.`;
    case "pay":
      return paySentence(d, agent);
  }
}

/** R39: each flag as the words a person reads before acting. Keyed by the union, so a new flag is a build error here. */
const FLAG_WORDS: Record<FlagKey, (p: Readonly<Record<string, string | number>>, agent: string) => string> = {
  baseUnknown: (_p, agent) => `Check first: no earlier version from ${agent} to compare`,
  firstSight: (_p, agent) => `Check first: the first time ${agent} has sent this`,
  matchedByName: () => "Check first: matched by name only",
  matchedEarlier: (_p, agent) => `Check first: matched by the page ${agent} sent it under before, under its old name`,
  matchedTwice: (p, agent) => `Check first: two of ${possessive(agent)} records answer to the same ${p.of === "circle" ? "circle" : "role"} here`,
  sameNameAsLive: (p) => `Check first: same name as your ${p.name} ${p.of === "circle" ? "circle" : "role"}`,
  wasOurs: (p) => `Check first: in an earlier read this was your ${p.name} ${p.of === "circle" ? "circle" : "role"}`,
  circleNotHere: (_p, agent) => `Check first: ${agent} puts it in a circle this village doesn't have`,
  circleUnknown: () => "Check first: its circle could not be found",
  severalCircles: (p, agent) => `Check first: ${agent} lists it in ${p.count} circles`,
  duplicatePageId: (_p, agent) => `Check first: ${agent} sent this record twice`,
  namesAMember: () => "Names a member: check this one",
  heldHere: () => "Check first: somebody holds this role here",
};

export function flagWords(f: DifferenceFlag, agent: string): string {
  return FLAG_WORDS[f.key](f.params ?? {}, agent);
}

/**
 * The flags a person is shown. The unknown base says nothing beside a first
 * sight, which implies it, or on pay, whose base is never known and which is
 * always a person's act, so it is left off the screen there. DISPLAY ONLY: the
 * difference keeps every flag, because an unknown base is never bulk-taken or
 * applied by itself (R2).
 */
export function shownFlags(d: Pick<Difference, "kind" | "flags">): DifferenceFlag[] {
  const firstSight = d.flags.some((f) => f.key === "firstSight");
  return d.flags.filter((f) => f.key !== "baseUnknown" || (!firstSight && d.kind !== "pay"));
}

/** R35's source line: the edited time alone, never who edited it. */
export function sourceWords(d: Difference, agent: string, timeZone = "UTC"): string {
  const at = d.source.editedAt ? Date.parse(d.source.editedAt) : NaN;
  if (!Number.isFinite(at)) return `From ${possessive(agent)} record`;
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone }).format(new Date(at));
  return `Edited in ${agent} ${day}`;
}

/** The link's words. */
export const openInWords = (agent: string): string => `Open in ${agent}`;

/**
 * "Open in Sera", built from the module's configured dashboard address and the
 * page id (R10), never from a stored page address. Null when no https
 * dashboard is set, or when the address carries a query or a fragment, which
 * would put the id inside it and open the wrong page.
 */
export function openInUrl(dashboard: unknown, pageId: string): string | null {
  if (typeof dashboard !== "string" || dashboard.trim() === "" || pageId.trim() === "") return null;
  if (/[?#]/.test(dashboard)) return null;
  let url: URL;
  try {
    url = new URL(dashboard.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  return `${url.toString().replace(/\/+$/, "")}/${encodeURIComponent(pageId.trim())}`;
}
