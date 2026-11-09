/**
 * "Your first moons in <role>": the onboarding path a new holder gets at adoption.
 *
 * ONE PLACE FOR THE RULES, so the server, the Trail and the profile card read
 * the same answers and a test can hold them with no database.
 *
 * WHERE THE WORDS COME FROM. The platform ships four items every village has
 * (meet your companion, ask the guide three questions, book your access, take
 * your first quest) and nothing else. A village's own list, its owner roles and
 * its circle defaults live in village data (the `onboarding-path` document);
 * the role's card adds its "First 90 days" lines. `mergePath` lays the three
 * over each other, in that order, and nobody's words are in this file.
 *
 * WHO SEES WHAT. The path is the holder's. A check-in is seen only by the
 * holder, the buddy and the holder of the village's onboarding role
 * (`mayReadCheckins`); nobody else, an admin included.
 */

export const PATH_DUE_DAY = 30;
export const CHECKIN_DAYS = [30, 60, 90] as const;
export type CheckinDay = (typeof CHECKIN_DAYS)[number];

/** Who an item belongs to. The village document maps the role keys to its own roles. */
export type OwnerKey = "holder" | "buddy" | "onboarding" | "access" | "memory" | "appointer";
export const OWNER_KEYS: readonly OwnerKey[] = ["holder", "buddy", "onboarding", "access", "memory", "appointer"];

export type ItemKind = "plain" | "companion" | "guide" | "access" | "quest";
export type ItemSource = "platform" | "village" | "circle" | "card";

export interface PathItem {
  key: string;
  kind: ItemKind;
  title: string;
  owner: OwnerKey;
  /** Days after the path opened. */
  dueDay: number;
  doneWhen: string;
  source: ItemSource;
}

/** The village's document: extra items, owner roles by name, and each circle's own defaults. */
export interface VillagePathDoc {
  items?: unknown;
  circles?: unknown;
  /** owner key to the NAME of the role that holds it in this village. */
  owners?: unknown;
}

/** The four every village has. Plain words; a village may restate any of them by key. */
export const PLATFORM_ITEMS: readonly PathItem[] = [
  { key: "companion", kind: "companion", title: "Meet your role's companion", owner: "holder", dueDay: 7, doneWhen: "You have made a first request", source: "platform" },
  { key: "guide", kind: "guide", title: "Ask the guide three questions", owner: "holder", dueDay: 7, doneWhen: "Three answers with sources", source: "platform" },
  { key: "access", kind: "access", title: "Book your access", owner: "access", dueDay: 3, doneWhen: "Your access session is booked", source: "platform" },
  { key: "quest", kind: "quest", title: "Take your first quest", owner: "holder", dueDay: 14, doneWhen: "A quest is consented", source: "platform" },
];

const KINDS: readonly ItemKind[] = ["plain", "companion", "guide", "access", "quest"];
const clip = (v: unknown, n: number): string => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** One item from stored data, or null when it cannot stand. Never throws. */
export function readItem(raw: unknown, source: ItemSource): PathItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = clip(r.title, 160);
  const key = clip(r.key, 64).toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48);
  if (!title || !key) return null;
  const owner = OWNER_KEYS.includes(r.owner as OwnerKey) ? (r.owner as OwnerKey) : "holder";
  const kind = KINDS.includes(r.kind as ItemKind) ? (r.kind as ItemKind) : "plain";
  const due = Math.trunc(Number(r.dueDay));
  const dueDay = Number.isFinite(due) && due >= 0 && due <= 365 ? due : PATH_DUE_DAY;
  return { key, kind, title, owner, dueDay, doneWhen: clip(r.doneWhen, 200) || "Ticked", source };
}

const readList = (v: unknown, source: ItemSource): PathItem[] =>
  Array.isArray(v) ? v.map((x) => readItem(x, source)).filter((x): x is PathItem => !!x) : [];

/** The card's "First 90 days" text: one holder item per non-empty line, due by day 90. */
export function cardItems(first90: string | null | undefined): PathItem[] {
  const lines = String(first90 ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
  return lines.map((title, i) => ({
    key: `card-${i + 1}`,
    kind: "plain" as const,
    title: title.slice(0, 160),
    owner: "holder" as const,
    dueDay: 90,
    doneWhen: "Ticked",
    source: "card" as const,
  }));
}

/**
 * The path: platform items, then the village's, then the circle's, then the card's.
 * A later layer that uses an earlier key restates that item in place (same slot);
 * everything else is appended. Order is stable, so a path reads the same twice.
 */
export function mergePath(input: { village: VillagePathDoc | null; circleId: string | null; first90: string | null }): PathItem[] {
  const out: PathItem[] = PLATFORM_ITEMS.map((i) => ({ ...i }));
  const lay = (layer: PathItem[]) => {
    for (const it of layer) {
      const at = out.findIndex((o) => o.key === it.key);
      if (at >= 0) out[at] = it;
      else out.push(it);
    }
  };
  lay(readList(input.village?.items, "village"));
  const circles = input.village?.circles;
  if (input.circleId && circles && typeof circles === "object" && !Array.isArray(circles)) {
    lay(readList((circles as Record<string, unknown>)[input.circleId], "circle"));
  }
  lay(cardItems(input.first90));
  return out;
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

/** The check-in days that have come, in order. */
export function checkinsDue(openedOn: string, today: string): CheckinDay[] {
  const d = dayOfPath(openedOn, today);
  return CHECKIN_DAYS.filter((c) => d >= c);
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
