/**
 * The onboarding path a new holder gets at adoption, in phases the village names.
 *
 * ONE PLACE FOR THE RULES, so the server, the Trail and the profile card read
 * the same answers and a test can hold them with no database.
 *
 * THE VILLAGE OWNS THE PATH. Its phases (a name, a day range, the steps in it),
 * its title, its owner roles, its circles' own steps and any check-in days all
 * live in village data (the `onboarding-path` document). The platform ships one
 * neutral default phase and nothing else, and the path is OFF until the village
 * switches it on (`enabled`): onboarding needs the circle's consent.
 *
 * WHO SEES WHAT. The path is the holder's. A check-in, where a village still
 * has any, is seen only by the holder, the buddy and the holder of the village's
 * onboarding role (`mayReadCheckins`); nobody else, an admin included.
 */

/** Who an item belongs to. The village document maps the role keys to its own roles. */
export type OwnerKey = "holder" | "buddy" | "onboarding" | "access" | "memory" | "appointer";
export const OWNER_KEYS: readonly OwnerKey[] = ["holder", "buddy", "onboarding", "access", "memory", "appointer"];

export type ItemKind = "plain" | "companion" | "guide" | "access";
export type ItemSource = "platform" | "village" | "circle" | "card";

/** A step's one clickable link: the words on the button and an https address. */
export interface PathLink {
  label: string;
  href: string;
}

export interface PathItem {
  key: string;
  kind: ItemKind;
  title: string;
  owner: OwnerKey;
  /** The day the step is due, counted from the day the path opened (day 1). */
  dueDay: number;
  doneWhen: string;
  /** Optional. Only ever an https address, read through `readLink`. */
  link?: PathLink;
  source: ItemSource;
  phase: string;
  phaseFrom: number;
  phaseTo: number;
}

export interface Phase {
  key: string;
  name: string;
  fromDay: number;
  toDay: number;
  items: PathItem[];
}

/** The village's document: its switch, title, phases, circle steps, owners and check-in days. */
export interface VillagePathDoc {
  enabled?: unknown;
  title?: unknown;
  phases?: unknown;
  circles?: unknown;
  /** owner key to the NAME of the role that holds it in this village. */
  owners?: unknown;
  checkins?: unknown;
}

export const DEFAULT_TITLE = "Your first days";
export const MAX_DAY = 365;

const KINDS: readonly ItemKind[] = ["plain", "companion", "guide", "access"];
const clip = (v: unknown, n: number): string => (typeof v === "string" ? v.trim().slice(0, n) : "");
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
const dayOr = (v: unknown, fallback: number): number => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= MAX_DAY ? n : fallback;
};

export const LINK_LABEL_MAX = 60;
export const LINK_HREF_MAX = 500;

/**
 * A page of this village's own site: one leading slash and never two (`//host`
 * leaves the site), no backslash (a browser reads `/\host` as `//host`), no
 * space and no control character. `/training/steward` is one.
 */
export function isSitePath(href: string): boolean {
  return /^\/(?![/\\])[^\s\\\u0000-\u001f]*$/.test(href);
}

/**
 * A step's link, or null when it cannot stand. The address is a page of this
 * site (`isSitePath`, opened in place: the steward training lives here), or an
 * https address that parses with a host, carries no sign-in details and fits
 * the cap; the label must have words and is cut at its cap. Never throws.
 */
export function readLink(raw: unknown): PathLink | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const label = clip(r.label, LINK_LABEL_MAX);
  const href = typeof r.href === "string" ? r.href.trim() : "";
  if (!label || !href || href.length > LINK_HREF_MAX) return null;
  if (isSitePath(href)) return { label, href };
  let u: URL;
  try { u = new URL(href); } catch { return null; }
  if (u.protocol !== "https:" || !u.hostname || u.username || u.password) return null;
  if (u.href.length > LINK_HREF_MAX) return null;
  return { label, href: u.href };
}

/** True when a step carries a link field at all, valid or not. A bad one is named, never dropped silently. */
const hasLinkField = (raw: unknown): boolean => !!raw && typeof raw === "object" && (raw as Record<string, unknown>).link != null;

type Where = { phase: string; phaseFrom: number; phaseTo: number };

/** One item from stored data, or null when it cannot stand. Never throws. */
export function readItem(raw: unknown, source: ItemSource, where: Where): PathItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = clip(r.title, 160);
  const key = slug(clip(r.key, 64)) || slug(title);
  if (!title || !key) return null;
  const owner = OWNER_KEYS.includes(r.owner as OwnerKey) ? (r.owner as OwnerKey) : "holder";
  const kind = KINDS.includes(r.kind as ItemKind) ? (r.kind as ItemKind) : "plain";
  const link = readLink(r.link);
  return { key, kind, title, owner, dueDay: dayOr(r.dueDay, where.phaseTo), doneWhen: clip(r.doneWhen, 200) || "Ticked", ...(link ? { link } : {}), source, ...where };
}

/** The neutral phase every village gets until it writes its own. */
export const DEFAULT_PHASES: readonly Phase[] = [
  {
    key: "start",
    name: DEFAULT_TITLE,
    fromDay: 1,
    toDay: 14,
    items: [
      { key: "companion", kind: "companion", title: "Meet your role's companion", owner: "holder", dueDay: 7, doneWhen: "You have made a first request", source: "platform", phase: DEFAULT_TITLE, phaseFrom: 1, phaseTo: 14 },
      { key: "guide", kind: "guide", title: "Ask the guide three questions", owner: "holder", dueDay: 7, doneWhen: "Three answers with sources", source: "platform", phase: DEFAULT_TITLE, phaseFrom: 1, phaseTo: 14 },
      { key: "access", kind: "access", title: "Book your access", owner: "access", dueDay: 7, doneWhen: "Your access session is booked", source: "platform", phase: DEFAULT_TITLE, phaseFrom: 1, phaseTo: 14 },
    ],
  },
];

/** The village's phases, each read through `readItem`; empty when it names none. */
export function readPhases(village: VillagePathDoc | null): Phase[] {
  const raw = village?.phases;
  if (!Array.isArray(raw)) return [];
  const out: Phase[] = [];
  for (const p of raw.slice(0, 12)) {
    if (!p || typeof p !== "object") continue;
    const r = p as Record<string, unknown>;
    const name = clip(r.name, 80);
    if (!name) continue;
    const fromDay = dayOr(r.fromDay, 1);
    const toDay = Math.max(fromDay, dayOr(r.toDay, fromDay));
    const where = { phase: name, phaseFrom: fromDay, phaseTo: toDay };
    const items = (Array.isArray(r.items) ? r.items : []).map((x) => readItem(x, "village", where)).filter((x): x is PathItem => !!x);
    out.push({ key: slug(clip(r.key, 64)) || slug(name), name, fromDay, toDay, items });
  }
  return out;
}

/** The card's "First 90 days" text: one holder item per non-empty line. */
export function cardItems(first90: string | null | undefined, where: Where): PathItem[] {
  const lines = String(first90 ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
  return lines.map((title, i) => ({
    key: `card-${i + 1}`, kind: "plain" as const, title: title.slice(0, 160), owner: "holder" as const, dueDay: where.phaseTo, doneWhen: "Ticked", source: "card" as const, ...where,
  }));
}

/**
 * The path: the village's phases (or the neutral default), then the circle's own
 * steps, then the card's lines. A circle step names a phase by key and lands in
 * the last phase when it names none; a later layer that uses an earlier step's
 * key restates it in place. Order is stable, so a path reads the same twice.
 */
export function mergePath(input: { village: VillagePathDoc | null; circleId: string | null; first90: string | null }): PathItem[] {
  const phases = readPhases(input.village);
  const used = phases.length > 0 ? phases : DEFAULT_PHASES.map((p) => ({ ...p, items: p.items.map((i) => ({ ...i })) }));
  const out: PathItem[] = used.flatMap((p) => p.items);
  const last = used[used.length - 1];
  const lay = (it: PathItem) => {
    const at = out.findIndex((o) => o.key === it.key);
    if (at >= 0) out[at] = it;
    else out.push(it);
  };
  const circles = input.village?.circles;
  if (input.circleId && circles && typeof circles === "object" && !Array.isArray(circles)) {
    const list = (circles as Record<string, unknown>)[input.circleId];
    for (const raw of Array.isArray(list) ? list : []) {
      const want = raw && typeof raw === "object" ? clip((raw as Record<string, unknown>).phase, 64) : "";
      const ph = used.find((p) => p.key === slug(want)) ?? last;
      const it = readItem(raw, "circle", { phase: ph.name, phaseFrom: ph.fromDay, phaseTo: ph.toDay });
      if (it) lay(it);
    }
  }
  for (const it of cardItems(input.first90, { phase: last.name, phaseFrom: last.fromDay, phaseTo: last.toDay })) lay(it);
  return out;
}

/** The path's last day, from its phases. */
export const lastDayOf = (items: readonly Pick<PathItem, "phaseTo">[]): number => items.reduce((m, i) => Math.max(m, i.phaseTo), 14);

/** The switch: off until the village turns it on after the circle has consented. */
export const pathEnabled = (village: VillagePathDoc | null): boolean => village?.enabled === true;

export const pathTitle = (village: VillagePathDoc | null): string => clip(village?.title, 80) || DEFAULT_TITLE;

/** The village's check-in days (none by default), ascending, at most six. */
export function checkinDays(village: VillagePathDoc | null): number[] {
  const raw = village?.checkins;
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.map((d) => dayOr(d, 0)).filter((d) => d > 0))).sort((a, b) => a - b).slice(0, 6);
}

/** The role name each owner key means in this village. Holder and buddy are people, not roles. */
export function ownerRoleNames(village: VillagePathDoc | null): Partial<Record<OwnerKey, string>> {
  const o = village?.owners;
  const out: Partial<Record<OwnerKey, string>> = {};
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const k of OWNER_KEYS) {
      const name = clip((o as Record<string, unknown>)[k], 120);
      if (name) out[k] = name;
    }
  }
  return out;
}

/** The companion item is hidden unless the role's companion has the consent. */
export function visibleItems<T extends Pick<PathItem, "kind">>(items: readonly T[], companionConsented: boolean): T[] {
  return items.filter((i) => i.kind !== "companion" || companionConsented);
}

export interface PathItemState extends PathItem {
  doneAt: string | null;
}

export const openItems = (items: readonly Pick<PathItemState, "doneAt">[]): number => items.filter((i) => !i.doneAt).length;

/** The day number of a path on a calendar day (day 1 is the day it opened). */
export function dayOfPath(openedOn: string, today: string): number {
  const a = Date.parse(`${openedOn.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  return Math.floor((b - a) / 86_400_000) + 1;
}

/** The path's check-in days that have come, in order. */
export function checkinsDue(openedOn: string, today: string, days: readonly number[]): number[] {
  const d = dayOfPath(openedOn, today);
  return days.filter((c) => d >= c);
}

export interface PathPeople {
  holderUserId: string;
  buddyUserId: string | null;
}

/** Holder, buddy, or a holder of the onboarding role. Nobody else. */
export function mayReadCheckins(viewerUserId: string, path: PathPeople, holdsOnboardingRole: boolean): boolean {
  if (!viewerUserId) return false;
  return viewerUserId === path.holderUserId || (!!path.buddyUserId && viewerUserId === path.buddyUserId) || holdsOnboardingRole;
}

/** Only the holder files; the other two read. */
export const mayFileCheckin = (viewerUserId: string, path: PathPeople): boolean => !!viewerUserId && viewerUserId === path.holderUserId;

/** Who may tick an item: the holder their own, the buddy the buddy's, a holder of the owning role that role's. */
export function mayTick(viewerUserId: string, path: PathPeople, owner: OwnerKey, holdsOwnerRole: boolean): boolean {
  if (!viewerUserId) return false;
  if (viewerUserId === path.holderUserId && owner === "holder") return true;
  if (owner === "buddy") return !!path.buddyUserId && viewerUserId === path.buddyUserId;
  return owner !== "holder" && holdsOwnerRole;
}

export interface CheckinAnswers {
  clarity: number;
  connection: string;
  culture: string;
  basics: string;
  load: string;
  overall: number;
  oneThing: string;
}

const score = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
};

/** The seven answers of the check-in, or the sentence that says what is missing. */
export function readCheckin(raw: unknown): { ok: true; answers: CheckinAnswers } | { ok: false; error: string } {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const clarity = score(r.clarity);
  const overall = score(r.overall);
  if (clarity === null) return { ok: false, error: "Rate how clear your role is, from 1 to 5." };
  if (overall === null) return { ok: false, error: "Rate how it is going overall, from 1 to 5." };
  return {
    ok: true,
    answers: {
      clarity,
      overall,
      connection: clip(r.connection, 1000),
      culture: clip(r.culture, 1000),
      basics: clip(r.basics, 1000),
      load: clip(r.load, 1000),
      oneThing: clip(r.oneThing, 1000),
    },
  };
}

const LINK_ERROR = (where: string): string =>
  `${where}, has a link that cannot stand. It needs a label (up to ${LINK_LABEL_MAX} characters) and an https address (up to ${LINK_HREF_MAX} characters).`;

/**
 * The village's document as an editor may save it: every phase and item read
 * through the same readers (a bad row is named, never silently kept), owners
 * cleaned, circle steps keyed by circle id. Returns the sentence that says what
 * is wrong, or the document to store.
 */
export function readVillageDoc(raw: unknown): { ok: true; doc: Record<string, unknown> } | { ok: false; error: string } {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!r) return { ok: false, error: "Send an object with the switch, title, phases, circles and owners." };
  const phases = Array.isArray(r.phases) ? r.phases : [];
  if (phases.length > 12) return { ok: false, error: "A path has at most 12 phases." };
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    const pr = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
    if (!clip(pr.name, 80)) return { ok: false, error: `Phase ${i + 1} needs a name.` };
    const items = Array.isArray(pr.items) ? pr.items : [];
    if (items.length > 40) return { ok: false, error: `Phase ${i + 1} has at most 40 steps.` };
    for (let j = 0; j < items.length; j++) {
      const it = items[j];
      if (!readItem(it, "village", { phase: "x", phaseFrom: 1, phaseTo: 1 })) return { ok: false, error: `Phase ${i + 1}, step ${j + 1}, needs a title.` };
      if (hasLinkField(it) && !readLink((it as Record<string, unknown>).link)) return { ok: false, error: LINK_ERROR(`Phase ${i + 1}, step ${j + 1}`) };
    }
  }
  const cleanPhases = phases.map((p) => {
    const pr = p as Record<string, unknown>;
    const fromDay = dayOr(pr.fromDay, 1);
    return {
      key: slug(clip(pr.key, 64)) || slug(clip(pr.name, 80)),
      name: clip(pr.name, 80),
      fromDay,
      toDay: Math.max(fromDay, dayOr(pr.toDay, fromDay)),
      items: (Array.isArray(pr.items) ? pr.items : []).map((it) => {
        const x = it as Record<string, unknown>;
        const link = readLink(x.link);
        return { key: slug(clip(x.key, 64)) || slug(clip(x.title, 160)), title: clip(x.title, 160), owner: x.owner, kind: x.kind, dueDay: x.dueDay, doneWhen: clip(x.doneWhen, 200), ...(link ? { link } : {}) };
      }),
    };
  });
  const circles: Record<string, unknown[]> = {};
  if (r.circles && typeof r.circles === "object" && !Array.isArray(r.circles)) {
    for (const [id, list] of Object.entries(r.circles as Record<string, unknown>).slice(0, 100)) {
      const arr = Array.isArray(list) ? list : [];
      if (arr.length > 40) return { ok: false, error: `The list for circle ${id} has at most 40 steps.` };
      for (let j = 0; j < arr.length; j++) {
        const it = arr[j];
        if (!readItem(it, "circle", { phase: "x", phaseFrom: 1, phaseTo: 1 })) return { ok: false, error: `Circle ${id}, step ${j + 1}, needs a title.` };
        if (hasLinkField(it) && !readLink((it as Record<string, unknown>).link)) return { ok: false, error: LINK_ERROR(`Circle ${id}, step ${j + 1}`) };
      }
      circles[id] = arr;
    }
  }
  return {
    ok: true,
    doc: {
      enabled: r.enabled === true,
      title: clip(r.title, 80),
      phases: cleanPhases,
      circles,
      owners: ownerRoleNames(r as VillagePathDoc),
      checkins: checkinDays(r as VillagePathDoc),
    },
  };
}
