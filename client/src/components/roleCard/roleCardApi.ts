/**
 * The two public reads behind the founding team section and the full card
 * (server/routes/roleEdit.ts): which roles the founding team features, and one
 * role's founding sections with who last edited it. Both read with the
 * member's token when there is one, so an editor reads an unlisted role too.
 */
import { gameFetch } from "@/lib/gameApi";
import { NO_VILLAGE_PAY, readSections, villagePayFrom, type RoleCardSections, type VillagePay } from "@shared/roleCardSections";

export interface FoundingTeamAnswer {
  on: boolean;
  roleIds: string[];
  /** Each featured role's name, by id, for words that name the open founding roles. */
  names: Record<string, string>;
  sections: Record<string, RoleCardSections>;
  showPayRanges: boolean;
  villagePay: VillagePay;
}

export interface RoleCardAnswer {
  roleId: string;
  sections: RoleCardSections | null;
  lastEdited: { by: string | null; on: string } | null;
  showPayRanges: boolean;
  villagePay: VillagePay;
  mayEdit: boolean;
}

const OFF: FoundingTeamAnswer = { on: false, roleIds: [], names: {}, sections: {}, showPayRanges: false, villagePay: NO_VILLAGE_PAY };

/** The village's pay block as the server sent it, read again here so a bad answer draws nothing. */
function payOf(v: any): VillagePay {
  if (!v || typeof v !== "object") return NO_VILLAGE_PAY;
  const shape = Array.isArray(v.shape) ? v.shape.map((x: any) => `${String(x?.label ?? "")} ${String(x?.pct ?? "")}`).join(", ") : "";
  return villagePayFrom({ shape, atRisk: String(v.atRisk ?? ""), note: String(v.note ?? "") });
}

/** The founding team, or the section off when the read fails: the page never waits on it to show its roles. */
export async function readFoundingTeam(): Promise<FoundingTeamAnswer> {
  try {
    const r = await gameFetch("/api/org/founding-team");
    if (!r.ok) return OFF;
    const d = await r.json();
    const roleIds = Array.isArray(d?.roleIds) ? d.roleIds.filter((x: unknown): x is string => typeof x === "string") : [];
    const sections: Record<string, RoleCardSections> = {};
    const names: Record<string, string> = {};
    for (const id of roleIds) {
      const name = d?.names?.[id];
      if (typeof name === "string" && name.trim()) names[id] = name.trim();
      const read = readSections(d?.sections?.[id]);
      if (read.ok) sections[id] = read.value;
    }
    return { on: d?.on === true && roleIds.length > 0, roleIds, names, sections, showPayRanges: d?.showPayRanges === true, villagePay: payOf(d?.villagePay) };
  } catch {
    return OFF;
  }
}

/** One role's founding sections and its last edit, or null when the read fails. */
export async function readRoleCard(roleId: string): Promise<RoleCardAnswer | null> {
  try {
    const r = await gameFetch(`/api/org/role-card/${encodeURIComponent(roleId)}`);
    if (!r.ok) return null;
    const d = await r.json();
    const read = d?.sections ? readSections(d.sections) : null;
    const last = d?.lastEdited && typeof d.lastEdited.on === "string" ? { by: typeof d.lastEdited.by === "string" ? d.lastEdited.by : null, on: d.lastEdited.on } : null;
    return {
      roleId,
      sections: read && read.ok ? read.value : null,
      lastEdited: last,
      showPayRanges: d?.showPayRanges === true,
      villagePay: payOf(d?.villagePay),
      mayEdit: d?.mayEdit === true,
    };
  } catch {
    return null;
  }
}
