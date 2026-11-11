/**
 * THE FOUNDING TEAM SECTION (phase A, lane A3, build list 2.1 and 2.3).
 *
 * A village that is hiring its paid founding roles turns on
 * `org.founding_team` and writes the role ids in `org.founding_team_roles`.
 * The Roles and Circles page then opens on "Join the founding team": those
 * roles, in the order written, each with its full card and one Apply act.
 *
 * Which roles show is decided here and nowhere else. A role the village has
 * unlisted, ended or keeps as an example never shows, whatever the setting
 * says, so the setting can never put a hidden role in front of a visitor.
 *
 * Pure: no pool, no clock, no Node builtins.
 */
import { isListed } from "./roleListing";

/** The ids written in the setting, in order, each once. Commas, spaces or new lines separate them. */
export function foundingRoleIds(setting: string): string[] {
  const out: string[] = [];
  for (const raw of String(setting ?? "").split(/[\s,;]+/)) {
    const id = raw.trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

export interface FoundingCandidate {
  id: string;
  listed?: boolean | null;
  active?: boolean;
  isExample?: boolean;
}

/** The roles the section features, in the setting's order. Empty when the section is off. */
export function foundingRoles<R extends FoundingCandidate>(on: boolean, setting: string, roles: readonly R[]): R[] {
  if (!on) return [];
  const byId = new Map(roles.map((r) => [r.id, r]));
  const out: R[] = [];
  for (const id of foundingRoleIds(setting)) {
    const r = byId.get(id);
    if (!r || r.active === false || r.isExample === true || !isListed(r)) continue;
    out.push(r);
  }
  return out;
}
