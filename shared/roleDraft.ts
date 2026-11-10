/**
 * THE ROLE DRAFT BOARD, the pure half (Rye, 9 Nov 2026: "make it a bit like
 * fantasy sports team picking"). A visitor picks one or more characters, sees
 * every open role with its key stats, drafts up to three to a shortlist kept
 * in the browser, and applies.
 *
 * LIVE, NEVER A LIST OF ITS OWN. Every role, circle and character tag comes
 * from the chart the village keeps (`GET /api/org`, written by the admin org
 * chart, role drafts and the Saberra bridge) and the cast (`GET
 * /api/archetypes`). This file only reads that shape. It invents no hours, pay
 * or aim: a field the role has not written stays null, and the board says
 * "not set yet".
 *
 * WHICH ROLES ARE OPEN mirrors the card's own door (`actionFor` in
 * shared/roleSheet.ts): a free place on a role that is not forming, a role
 * the village declared open, partial or expired, or one recruiting while
 * full. A role without a circle on the chart is left out, because the open
 * proposal only offers roles whose circle is live (server/routes/openProposals.ts,
 * `offered`).
 *
 * THE DRAFT is `{ chars, picks }` in local storage under ROLE_DRAFT_KEY,
 * written and read through client/src/lib/safeStorage.ts. What comes back is
 * anyone's to have edited, so it is re-read through `draftFromStored`, which
 * keeps strings only, drops duplicates and caps both lists.
 */
import { OPEN_PROPOSAL_MAX_ROLES, openProposalHref } from "./openProposals";
import { applySeatsHref } from "./seatApplyLinks";

/** Where the draft is kept in the browser. Versioned, so a later shape can start clean. */
export const ROLE_DRAFT_KEY = "village.roleDraft.v1";

/** The cast is five today; the cap only keeps a hand-edited value bounded. */
export const DRAFT_MAX_CHARACTERS = 8;

const ID_MAX = 120;

export interface RoleDraft {
  chars: string[];
  picks: string[];
}

export interface DraftRole {
  id: string;
  name: string;
  circleId: string;
  circleName: string;
  aim: string | null;
  timeCommitment: string | null;
  /** How many things it answers for, as written. */
  accountabilities: number;
  archetypes: string[];
  seats: number;
  held: number;
  /** Places nobody holds yet; 0 for a role recruiting while full. */
  openPlaces: number;
  recruiting: boolean;
  /** The role as /api/org sent it, for the full card. */
  raw: unknown;
}

const OPEN_STATES = new Set(["open", "partial", "expired"]);

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function cleanIds(v: unknown, cap: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const id = x.trim().slice(0, ID_MAX);
    if (id && !out.includes(id)) out.push(id);
    if (out.length >= cap) break;
  }
  return out;
}

/** The draft as stored, made safe to use. Anything unreadable is an empty draft. */
export function draftFromStored(v: unknown): RoleDraft {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return { chars: cleanIds(o.chars, DRAFT_MAX_CHARACTERS), picks: cleanIds(o.picks, OPEN_PROPOSAL_MAX_ROLES) };
}

/**
 * An unlisted role as any layer may have carried it: the boolean the server sends,
 * but also the 0 the column holds and the strings a hand-built payload or a
 * cached copy can hold. Only an explicit "no" hides a role; null and absent read as listed.
 */
export function unlistedValue(v: unknown): boolean {
  return v === false || v === 0 || v === "0" || v === "false";
}

/** What the open form says, as the page reads it. Null while it is still loading. */
export interface BoardForm {
  open: boolean;
  /** Ids the form takes, or null when it names none. */
  offered: ReadonlySet<string> | null;
}

/**
 * The ONE set of roles the board, its character counts and its tray all draw
 * from. A member sees every listed open role. A visitor sees what the open form
 * would take, and nothing until the form has answered, so a count can never be
 * made from roles the form would then refuse (Rye, 9 Nov: "46 open roles fit"
 * while one role was listed).
 */
export function boardRoles(all: readonly DraftRole[], who: { member: boolean; form: BoardForm | null }): DraftRole[] {
  const listed = all.filter((r) => !unlistedValue((r.raw as { listed?: unknown } | null)?.listed));
  if (who.member) return listed;
  if (who.form === null) return [];
  if (who.form.open && who.form.offered) {
    const offered = who.form.offered;
    return listed.filter((r) => offered.has(r.id));
  }
  return listed;
}

/** How many of these roles name this character. */
export function fitCountFor(roles: readonly DraftRole[], key: string): number {
  return roles.filter((r) => r.archetypes.includes(key)).length;
}

/** A character's stock art. The files ship with the platform (server/assets/avatars); the page falls back to a drawn medallion when one is missing. */
export function characterArt(key: string): string {
  return `/images/avatars/${encodeURIComponent(key)}-f-olive.webp`;
}

/** The four steps, in order. The words live on the page, where the catalog can reach them. */
export const SELECT_STEPS = ["you", "scout", "select", "apply"] as const;
export type SelectStep = (typeof SELECT_STEPS)[number];

/** Where a role's header art comes from: its own upload, else its first character's art, else nothing (the page draws a medallion). */
export function roleArtFor(role: Pick<DraftRole, "archetypes" | "raw">): string | null {
  const own = (role.raw as { imageUrl?: unknown } | null)?.imageUrl;
  if (typeof own === "string" && own.startsWith("/") && !own.startsWith("//")) return own;
  const first = role.archetypes[0];
  return first ? characterArt(first) : null;
}

/** Every role a newcomer could apply for, from the village's live chart. */
export function openRolesFrom(org: unknown): DraftRole[] {
  const o = org && typeof org === "object" ? (org as Record<string, unknown>) : null;
  if (!o || !Array.isArray(o.roles)) return [];
  const circles = new Map<string, string>();
  for (const c of Array.isArray(o.circles) ? o.circles : []) {
    // A dormant or example circle offers nothing: the open proposal only takes roles in live circles (red team, 9 Nov).
    if (!c || typeof c !== "object" || typeof (c as any).id !== "string") continue;
    if ((c as any).status === "dormant" || (c as any).isExample) continue;
    circles.set((c as any).id, text((c as any).name) ?? (c as any).id);
  }
  const out: DraftRole[] = [];
  for (const r of o.roles as any[]) {
    if (!r || typeof r !== "object" || typeof r.id !== "string" || r.isExample) continue;
    // An unlisted role is never on the board, whoever is looking (role journey PR-A).
    if (unlistedValue(r.listed)) continue;
    const circleId = typeof r.circleId === "string" ? r.circleId : "";
    if (!circles.has(circleId)) continue;
    const seats = Math.max(0, Number(r.seats) || 0);
    const held = Math.max(0, Number(r.holderCount) || 0);
    const openPlaces = Math.max(0, seats - held);
    const state = typeof r.state === "string" ? r.state : "";
    const recruiting = r.recruiting === true;
    const invites = (openPlaces > 0 && state !== "forming") || OPEN_STATES.has(state) || recruiting;
    if (!invites) continue;
    out.push({
      id: r.id,
      name: text(r.name) ?? r.id,
      circleId,
      circleName: circles.get(circleId) as string,
      aim: text(r.aim),
      timeCommitment: text(r.timeCommitment),
      accountabilities: Array.isArray(r.accountabilities) ? r.accountabilities.filter((a: unknown) => text(a)).length : 0,
      archetypes: cleanIds(r.archetypes, DRAFT_MAX_CHARACTERS),
      seats,
      held,
      openPlaces,
      recruiting,
      raw: r,
    });
  }
  return out;
}

/**
 * The board's order: roles that fit more of the picked characters first,
 * then by name. Nothing is hidden by a pick; the board filters only when the
 * visitor asks it to.
 */
export function rankForCharacters(roles: readonly DraftRole[], chars: readonly string[]): Array<{ role: DraftRole; fits: string[] }> {
  return roles
    .map((role) => ({ role, fits: chars.filter((c) => role.archetypes.includes(c)) }))
    .sort((a, b) => b.fits.length - a.fits.length || a.role.name.localeCompare(b.role.name));
}

/** Draft a role, or take it back off. A full draft refuses a new one and says so. */
export function addPick(picks: readonly string[], id: string): { picks: string[]; full: boolean } {
  if (picks.includes(id)) return { picks: picks.filter((p) => p !== id), full: false };
  if (picks.length >= OPEN_PROPOSAL_MAX_ROLES) return { picks: [...picks], full: true };
  return { picks: [...picks, id], full: false };
}

/**
 * Where "Apply" goes. A visitor or a guest applies through the open proposal
 * with every pick ticked. A reader who reads terms (a member) applies for all
 * of them in one role application, the door "Roles that fit" on the character
 * page already uses (`applySeatsHref`, shared/seatApplyLinks.ts), so no pick
 * is dropped on the way.
 */
export function applyHrefFor(picks: readonly string[], member: boolean): string | null {
  if (!picks.length) return null;
  if (member) return applySeatsHref(picks, { from: "/roles/draft" });
  const [first, ...rest] = picks;
  // `from`: the open form's back link returns to the board (role audit, 10 Nov 2026).
  return [openProposalHref(first), ...rest.map((id) => `role=${encodeURIComponent(id)}`), `from=${encodeURIComponent("/roles/draft")}`].join("&");
}

/** Whether this reader was sent any role's character tags. Strangers get them only when the village shows its structure publicly. */
export function charactersKnown(roles: readonly DraftRole[]): boolean {
  return roles.some((r) => r.archetypes.length > 0);
}
