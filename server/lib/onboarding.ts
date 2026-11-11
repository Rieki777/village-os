/**
 * The onboarding path: opening a path at adoption, and the rules for
 * who may see and change it.
 *
 * THE CONTRACT IS shared/onboardingPath.ts (what an item is, who may read a
 * check-in); the statements are server/repos/onboarding.ts. This file joins
 * them to the org chart and to the village's own document.
 *
 * A PATH OPENS ONCE, FROM A SNAPSHOT. Items are copied into the path when the
 * holder is seated, so editing the village's list later never rewrites a path
 * somebody is part way through. Opening is best-effort for the caller: an
 * adoption must never fail because a welcome path could not be written.
 *
 * THE COMPANION ITEM NEVER SHOWS WITHOUT CONSENT. Consent is the village's
 * answer about the role's companion (`consented(orgRoleId)`); it is asked
 * every time a path is read, so withdrawing it hides the item at once.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolConnection } from "mysql2/promise";
import { readConfigDocument } from "../repos/appConfigDocs";
import * as repo from "../repos/onboarding";
import { holderFirstName } from "../../shared/roleHolderLabel";
import {
  checkinDays, checkinsDue, lastDayOf, mayFileCheckin, mayReadCheckins, mayTick, mergePath, openItems, ownerRoleNames, pathEnabled, pathTitle, readCheckin, visibleItems,
  type CheckinAnswers, type OwnerKey, type PathItemState, type VillagePathDoc,
} from "../../shared/onboardingPath";

type Q = Pool | PoolConnection;

export const VILLAGE_DOC_KEY = "onboarding-path";

/** The civil day in a zone, as YYYY-MM-DD. */
export function dayIn(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

const addDays = (isoDay: string, n: number): string => new Date(Date.parse(`${isoDay}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const villageDoc = (db: Q): Promise<VillagePathDoc | null> => readConfigDocument<VillagePathDoc>(db as Pool, VILLAGE_DOC_KEY);

/** Open the path for a seating that was just made. True when it opened; false when one already existed or the role is unknown. */
export async function openPathFor(db: Q, s: { assignmentId: string; userId: string; orgRoleId: string; now: Date; timeZone?: string }): Promise<boolean> {
  const role = await repo.roleFacts(db, s.orgRoleId);
  if (!role) return false;
  const doc = await villageDoc(db);
  // Off until the village switches it on: onboarding needs the circle's consent.
  if (!pathEnabled(doc)) return false;
  const items = mergePath({ village: doc, circleId: role.circleId, first90: role.first90 });
  const buddy = role.circleId ? await repo.buddyCandidate(db, role.circleId, s.userId) : null;
  const opened = dayIn(s.now, s.timeZone || "UTC");
  const id = randomUUID();
  const made = await repo.insertPath(db, {
    id, userId: s.userId, assignmentId: s.assignmentId, orgRoleId: s.orgRoleId, circleId: role.circleId, buddyUserId: buddy,
    openedOn: opened, dueOn: addDays(opened, lastDayOf(items) - 1), title: pathTitle(doc), checkinDays: checkinDays(doc),
  });
  if (!made) return false;
  await repo.insertItems(db, id, items.map((it, i) => ({ ...it, id: randomUUID(), sortOrder: i })));
  return true;
}

export interface OnboardingEnv {
  db: Q;
  today: string;
  /** Whether the village consented to this role's companion. */
  consented: (orgRoleId: string) => boolean;
}

/** Whether the member holds the role an owner key names in this village. */
async function holdsOwner(db: Q, userId: string, doc: VillagePathDoc | null, owner: OwnerKey): Promise<boolean> {
  const name = ownerRoleNames(doc)[owner];
  return name ? repo.holdsRoleNamed(db, userId, name) : false;
}

export interface ServedPath {
  id: string;
  roleName: string;
  title: string;
  openedOn: string;
  dueOn: string;
  day: number;
  buddyUserId: string | null;
  /** The buddy's first name, never the full name. */
  buddyName: string;
  mine: boolean;
  items: Array<PathItemState & { mayTick: boolean }>;
  openCount: number;
  checkinsDue: number[];
  /** Present only when the viewer is the holder, the buddy or the onboarding role. */
  checkins: Array<{ day: number; answers: CheckinAnswers | null; filedAt: string }> | null;
  mayFile: boolean;
}

/** One path as the viewer may see it. Null when the viewer has no part in it. */
export async function servePath(env: OnboardingEnv, viewerId: string, p: repo.PathRow, doc: VillagePathDoc | null): Promise<ServedPath | null> {
  const people = { holderUserId: p.userId, buddyUserId: p.buddyUserId };
  const ops = await holdsOwner(env.db, viewerId, doc, "onboarding");
  const mine = viewerId === p.userId;
  const readsCheckins = mayReadCheckins(viewerId, people, ops);
  if (!readsCheckins) return null;
  const role = await repo.roleFacts(env.db, p.orgRoleId);
  const rows = visibleItems(await repo.itemsOfPath(env.db, p.id), env.consented(p.orgRoleId));
  // A step's link lives in the village's document and is looked up by key here,
  // so a path that opened before a link was added still shows it, and a mended
  // address reaches paths already open. Everything else on a step stays as the
  // path opened with it.
  const links = new Map(
    mergePath({ village: doc, circleId: role?.circleId ?? null, first90: role?.first90 ?? null }).flatMap((i) => (i.link ? [[i.key, i.link] as const] : [])),
  );
  const items: ServedPath["items"] = [];
  for (const r of rows) {
    const holdsRole = r.owner === "holder" || r.owner === "buddy" ? false : await holdsOwner(env.db, viewerId, doc, r.owner);
    items.push({
      key: r.key, kind: r.kind, title: r.title, owner: r.owner, dueDay: r.dueDay, doneWhen: r.doneWhen, ...(links.has(r.key) ? { link: links.get(r.key) } : {}), source: r.source, phase: r.phase, phaseFrom: r.phaseFrom, phaseTo: r.phaseTo, doneAt: r.doneAt,
      mayTick: mayTick(viewerId, people, r.owner, holdsRole),
    });
  }
  const checkins = (await repo.checkinsOfPath(env.db, p.id)).map((c) => {
    let answers: CheckinAnswers | null = null;
    try { answers = JSON.parse(c.answers) as CheckinAnswers; } catch { /* a damaged row reads as filed, with no answers */ }
    return { day: c.day, answers, filedAt: c.filedAt };
  });
  const dayNo = Math.max(1, Math.floor((Date.parse(`${env.today}T00:00:00Z`) - Date.parse(`${p.openedOn}T00:00:00Z`)) / 86_400_000) + 1);
  return {
    id: p.id, roleName: role?.name ?? "", title: p.title || "Your first days", openedOn: p.openedOn, dueOn: p.dueOn, day: dayNo, buddyUserId: p.buddyUserId,
    buddyName: p.buddyUserId ? holderFirstName(await repo.nameOf(env.db, p.buddyUserId)) : "", mine,
    items, openCount: openItems(items), checkinsDue: checkinsDue(p.openedOn, env.today, p.checkinDays).filter((d) => !checkins.some((c) => c.day === d)),
    checkins, mayFile: mayFileCheckin(viewerId, people),
  };
}

/** The viewer's own paths, the paths they are buddy on, and, for the onboarding role, every path. */
export async function servePaths(env: OnboardingEnv, viewerId: string): Promise<ServedPath[]> {
  const doc = await villageDoc(env.db);
  const ops = await holdsOwner(env.db, viewerId, doc, "onboarding");
  const seen = new Map<string, repo.PathRow>();
  for (const p of await repo.pathsOfUser(env.db, viewerId)) seen.set(p.id, p);
  for (const p of await repo.pathsOfBuddy(env.db, viewerId)) seen.set(p.id, p);
  if (ops) for (const p of await repo.allPaths(env.db)) seen.set(p.id, p);
  const out: ServedPath[] = [];
  for (const p of Array.from(seen.values())) {
    const s = await servePath(env, viewerId, p, doc);
    if (s) out.push(s);
  }
  return out;
}

/** The Trail's fact: the member has an open path with a step of their own not done. */
export async function hasOpenOnboardingItems(db: Q, userId: string, consented: (orgRoleId: string) => boolean): Promise<boolean> {
  for (const p of await repo.pathsOfUser(db, userId, ["open"])) {
    const rows = visibleItems(await repo.itemsOfPath(db, p.id), consented(p.orgRoleId));
    if (rows.some((r) => !r.doneAt && r.owner === "holder")) return true;
  }
  return false;
}

export type Refusal = { ok: false; status: number; error: string };

export async function tick(env: OnboardingEnv, viewerId: string, pathId: string, key: string): Promise<{ ok: true } | Refusal> {
  const p = await repo.pathById(env.db, pathId);
  const item = p ? await repo.itemById(env.db, pathId, key) : null;
  if (!p || !item || (item.kind === "companion" && !env.consented(p.orgRoleId))) return { ok: false, status: 404, error: "Not found" };
  const doc = await villageDoc(env.db);
  const holds = item.owner === "holder" || item.owner === "buddy" ? false : await holdsOwner(env.db, viewerId, doc, item.owner);
  if (!mayTick(viewerId, { holderUserId: p.userId, buddyUserId: p.buddyUserId }, item.owner, holds)) {
    // A stranger learns nothing about the path; a member with a part in it is told whose step it is.
    const involved = viewerId === p.userId || viewerId === p.buddyUserId;
    return involved ? { ok: false, status: 403, error: "That step belongs to someone else." } : { ok: false, status: 404, error: "Not found" };
  }
  await repo.tickItem(env.db, pathId, key, viewerId);
  const left = visibleItems(await repo.itemsOfPath(env.db, pathId), env.consented(p.orgRoleId)).filter((r) => !r.doneAt);
  if (left.length === 0 && p.status === "open") await repo.setPathStatus(env.db, pathId, "done");
  return { ok: true };
}

export async function fileCheckin(env: OnboardingEnv, viewerId: string, pathId: string, dayNo: number, body: unknown): Promise<{ ok: true } | Refusal> {
  const p = await repo.pathById(env.db, pathId);
  if (!p || viewerId !== p.userId) return { ok: false, status: 404, error: "Not found" };
  if (!checkinsDue(p.openedOn, env.today, p.checkinDays).includes(dayNo)) return { ok: false, status: 409, error: "That check-in is not open yet." };
  const read = readCheckin(body);
  if (!read.ok) return { ok: false, status: 400, error: read.error };
  const made = await repo.insertCheckin(env.db, { id: randomUUID(), pathId, day: dayNo, authorUserId: viewerId, answers: JSON.stringify(read.answers) });
  return made ? { ok: true } : { ok: false, status: 409, error: "You filed that check-in already." };
}
