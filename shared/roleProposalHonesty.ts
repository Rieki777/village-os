/**
 * Plain words for a role proposal's terms step.
 *
 * A row that has a preset says where that suggestion came from. A row left
 * open says the village's operations role will fill it with the member. The
 * role's name is read from the village's own chart. A village with no role
 * whose name says "operation" gets the same sentence with no name in it.
 *
 * The season line used to print "For , starting" when the next season had a
 * date and no name. A blank name reads as "next season".
 */
import { holderFirstName } from "./roleHolderLabel";
import type { SettingsGroup } from "./seatSettings";

/** The sentence when the chart names no operations role. */
export const OPS_FALLBACK = "the village's operations role";

/** One plain line under each terms group, beside the short name of the group. */
export const GROUP_PLAIN: Record<SettingsGroup, string> = {
  term: "How long you hold this role",
  clocks: "When the role counts its time",
  rhythm: "How often you meet",
  pay: "Money for the work, if the role has any",
  allowance: "Money for costs, if the role has any",
  bonus: "Extra pay on top, if the role has any",
  quests: "How many tasks you take on each moon",
  scoreboard: "How you and the village see the role going",
  ending: "How you step back from the role",
};

/** "For Roots, starting 1 January 2027." A blank name is "next season". */
export function seasonHeading(name: string | null | undefined, starts: string | null | undefined): string {
  const title = String(name ?? "").trim() || "next season";
  const day = String(starts ?? "").trim();
  return day ? `For ${title}, starting ${day}.` : `For ${title}.`;
}

/**
 * The village's operations role, as the chart names it. The shortest live
 * role whose name says "operation" wins, so "Operations Steward" is chosen
 * ahead of a longer title that also says it. Null when the chart has none.
 */
export function operationsRoleName(
  roles: readonly { name?: string | null; isExample?: boolean; active?: boolean }[] | null | undefined,
): string | null {
  const hits = (roles ?? [])
    .filter((r) => r && r.active !== false && r.isExample !== true)
    .map((r) => String(r.name ?? "").trim())
    .filter((name) => /operation/i.test(name) && !name.includes("@"));
  hits.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return hits[0] ?? null;
}

/**
 * THE ROLE THAT WELCOMES PEOPLE, picked by the village's own setting
 * (`org.onboarding_role`, "The role that sends first replies to applicants"),
 * the same role the first-reply door lets in (server/routes/applicationReview.ts).
 * Read by the role's id, never by a word in its name: "Operations" in a title
 * named a conversation role as the partner (verify report B4). Null when the
 * village names none, or names a role that is gone, paused or an example; the
 * sentence then carries no name.
 */
export function onboardingRoleName(
  roles: readonly { id?: unknown; name?: unknown; isExample?: unknown; active?: unknown }[] | null | undefined,
  onboardingRoleId: string | null | undefined,
): string | null {
  const id = String(onboardingRoleId ?? "").trim();
  if (!id) return null;
  const role = (roles ?? []).find((r) => r && String(r.id ?? "") === id && r.active !== false && r.isExample !== true);
  const name = String(role?.name ?? "").trim();
  return name && !name.includes("@") ? name : null;
}

/** Who fills an open row: the chart's name, or the fallback with no name. */
export function opsPartner(name: string | null | undefined): string {
  const n = String(name ?? "").trim();
  return n || OPS_FALLBACK;
}

/**
 * Who the welcome names as the guide: the operations role's holder, first
 * name only, then the role's own name, then the fallback. An email is dropped.
 */
export function guideName(
  roles: readonly { name?: string | null; isExample?: boolean; active?: boolean; holders?: readonly { name?: string | null; userId?: string | null }[] | null }[] | null | undefined,
): string {
  const title = operationsRoleName(roles);
  const role = (roles ?? []).find((r) => String(r.name ?? "").trim() === title);
  const first = (role?.holders ?? []).map((h) => holderFirstName(h?.name)).find((n) => n.length > 0);
  if (first) return first;
  return opsPartner(title);
}

/** The line under a terms row: a suggestion and its source, or an open row. */
export function honestyLine(input: {
  set: boolean;
  presetLabel: string | null;
  customised: boolean;
  partner: string;
  money: boolean;
}): string {
  const partner = opsPartner(input.partner);
  if (!input.set) return `We'll fill this together with ${partner}.`;
  const source = input.presetLabel
    ? input.customised
      ? `You changed this. It started from ${input.presetLabel}.`
      : `Suggested from ${input.presetLabel}.`
    : "Written by you.";
  return input.money ? `${source} A proposal, not a promise. Confirmed with ${partner}.` : source;
}

/** An open row on a proposal's preview: who fills it, from the chart. */
export function openRowLine(partner: string | null | undefined): string {
  return `We'll fill this together with ${opsPartner(partner)}.`;
}

/** Every open row after the first one on a card: the role is named once, so the rest do not repeat it. */
export const OPEN_ROW_AGAIN = "We'll fill this together too.";

/** The load card on a proposal: the hours are filled with the operations role. */
export function loadHoursLine(partner: string | null | undefined): string {
  return `We'll set the load together with ${opsPartner(partner)}.`;
}

/** An open row the member writes once they hold the role (runbook, how they hold it). */
export const MEMBER_LATER_LINE = "Open for now. You'll write this once you hold the role.";

/** Rows that only exist once a role is adopted (tensions, signs, tasks). */
export const AFTER_ADOPT_LINE = "Open for now. You'll add these once the role is adopted.";

/**
 * A proposal card drawn on the server may only know its own roles, so its open
 * rows can name the fallback. The editor knows the village chart (the same
 * source the terms step reads), so it swaps the fallback for the real name.
 * Only the exact fallback phrase is replaced. PURE.
 */
export function withPartnerName<T>(value: T, partner: string | null | undefined): T {
  const name = String(partner ?? "").trim();
  if (!name || name === OPS_FALLBACK) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.includes(OPS_FALLBACK) ? v.split(OPS_FALLBACK).join(name) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}
