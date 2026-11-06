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
 * Pure: no pool, no clock. A date is formatted in the time zone handed in.
 */
import type { Difference, DifferenceFlag, FlagKey } from "./seraDifferences";

const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
const possessive = (name: string): string => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/** "a and b", "a, b and c". */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** How a subject is named in a sentence: a role by its name, a circle as "the X circle". */
const label = (d: Difference): string => (d.subject.kind === "circle" ? `the ${d.subject.name} circle` : d.subject.name);

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

function presenceSentence(d: Difference, agent: string): string {
  const missing = d.params?.reason === "missingTwice";
  const name = label(d);
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
  return `${agent} ${missing ? "no longer lists" : "has archived"} ${name}. It is still live here.`;
}

/** One difference as a sentence. */
export function differenceSentence(d: Difference, agent: string): string {
  const name = label(d);
  switch (d.kind) {
    case "circleAdd":
    case "roleAdd":
    case "circleRest":
    case "roleRest":
      return presenceSentence(d, agent);
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
        if (d.state === "oursAhead") return `${possessive(cap(name))} purpose was changed here. ${agent} still has the earlier words.`;
        if (d.state === "conflict") return `${possessive(cap(name))} purpose was changed here and in ${agent}, and the two differ.`;
        return `${agent} has new words for ${possessive(name)} purpose.`;
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
  baseUnknown: (_p, agent) => `Check first: nothing was taken from ${agent} for this before, so there is no earlier version to compare`,
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
 * dashboard is set.
 */
export function openInUrl(dashboard: unknown, pageId: string): string | null {
  if (typeof dashboard !== "string" || dashboard.trim() === "" || pageId.trim() === "") return null;
  let url: URL;
  try {
    url = new URL(dashboard.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  return `${url.toString().replace(/\/+$/, "")}/${encodeURIComponent(pageId.trim())}`;
}
