/**
 * Season plans' client half (RC1): read your own plan and the village's page,
 * save a version, file it.
 *
 * Every call carries the member's token. The village page answers 401 to
 * anybody who does not hold terms.read, and the pages say "members read this"
 * in a sentence, so the status travels with the answer.
 */
import { authToken } from "@/lib/gameApi";
import type { ApplicationStatus } from "@shared/seatApplications";
import type { PlanCommitments, PlanWindowPayload } from "@shared/seasonPlans";
import type { PartSuggestions } from "@shared/seasonPartSuggestions";
import type { CardWords, SeasonalGoal, ServedGoal } from "@shared/seasonPlanWords";

export interface PlanSeasonOut {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string | null;
  goals: string[];
}

export interface PlanApplication {
  id: string;
  href: string;
  status: ApplicationStatus;
  statusWords: string;
  seats: Array<{ id: string; name: string }>;
}

export interface HeldSeat {
  id: string;
  name: string;
  termEndsOn: string | null;
  lapsed: boolean;
  /** The application this seating came through, if any. */
  heldThrough?: string | null;
}

export interface MinePayload {
  season: PlanSeasonOut | null;
  window: PlanWindowPayload | null;
  plan: {
    version: number;
    aim: string | null;
    servesGoal: string | null;
    /** Every goal served, with how it helps. Absent from a server before the player card. */
    servesGoals?: ServedGoal[];
    seasonalGoals?: SeasonalGoal[];
    commitments: PlanCommitments;
    handingBack: string[];
    savedOn: string;
  } | null;
  filed: { version: number; filedOn: string | null } | null;
  changedSinceFiling?: boolean;
  heldSeats: HeldSeat[];
  applications: PlanApplication[];
  questsThisMoon: { done: number };
  /** False for a reader below the member rung: applying is not open to them yet. */
  mayApply?: boolean;
  /** Quests a moon and measures from the member's seats. Shown as suggestions, never saved for them. */
  suggestions?: PartSuggestions | null;
  /** The newest card words, carried from an earlier season until this one has its own. */
  cardWords?: CardWords | null;
  /** This moon's load, 1 (Healthy) to 5 (Heavy), or null when not set. */
  moonLoad?: MoonLoadOut | null;
}

export interface MoonLoadOut {
  cycleId: string;
  level: number;
}

export interface PlanCard {
  userId: string;
  name: string;
  handle: string | null;
  filed: boolean;
  filedOn: string | null;
  changedSinceFiling: boolean;
  seats: Array<{ id: string; name: string }>;
  handingBack: Array<{ id: string; name: string }>;
  applications: PlanApplication[];
  waiting: boolean;
  aim: string | null;
  servesGoal: string | null;
  servesGoals?: ServedGoal[];
  seasonalGoals?: SeasonalGoal[];
  questsThisMoon: { done: number; min: number | null; max: number | null };
  measures: Array<{ measure: string; target: string | null }>;
}

export interface VillagePayload {
  season: PlanSeasonOut | null;
  window: PlanWindowPayload | null;
  people: PlanCard[];
  filedCount: number;
  memberCount: number;
  notFiled: Array<{ userId: string; name: string; handle: string | null }>;
}

export interface PlanBody {
  aim: string;
  servesGoal: string | null;
  servesGoals?: ServedGoal[] | null;
  seasonalGoals?: SeasonalGoal[] | null;
  commitments: PlanCommitments;
  handingBack: string[];
}

export type PlanAnswer<T> = { ok: true; data: T } | { ok: false; status: number; error: string; field?: string };

const headers = (): Record<string, string> => {
  const t = authToken();
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) };
};

async function call<T>(path: string, method: "GET" | "PUT" | "POST" = "GET", body?: unknown): Promise<PlanAnswer<T>> {
  try {
    const res = await fetch(path, { method, headers: headers(), ...(body !== undefined ? { body: JSON.stringify(body) } : method === "POST" ? { body: "{}" } : {}) });
    const out = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, status: res.status, error: String(out?.message ?? out?.error ?? "Something went wrong. Try again"), field: out?.field };
    }
    return { ok: true, data: out as T };
  } catch {
    return { ok: false, status: 0, error: "Nothing answered. Check your connection and try again" };
  }
}

export const fetchMine = () => call<MinePayload>("/api/season-plans/mine");
export const saveMine = (body: PlanBody) => call<MinePayload>("/api/season-plans/mine", "PUT", body);
/**
 * The card's own editor: only the groups it names are saved, everything else
 * carries from the newest version. Leave a group out to keep it; null clears it.
 */
export interface CardBody {
  servesGoals?: ServedGoal[] | null;
  seasonalGoals?: SeasonalGoal[] | null;
  cardWords?: CardWords | null;
}
export const saveCard = (body: CardBody) => call<MinePayload>("/api/season-plans/mine/card", "PUT", body);
/** This moon's load, a whole number from 1 (Healthy) to 5 (Heavy). */
export const saveMoonLoad = (level: number) => call<{ moonLoad: MoonLoadOut }>("/api/season-plans/mine/load", "PUT", { level });
export const fileMine = () => call<MinePayload>("/api/season-plans/mine/file", "POST");
export const fetchVillage = (handle?: string) =>
  call<VillagePayload>(handle ? `/api/season-plans?handle=${encodeURIComponent(handle)}` : "/api/season-plans");
