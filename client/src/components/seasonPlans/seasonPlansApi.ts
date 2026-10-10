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
}

export interface MinePayload {
  season: PlanSeasonOut | null;
  window: PlanWindowPayload | null;
  plan: {
    version: number;
    aim: string | null;
    servesGoal: string | null;
    commitments: PlanCommitments;
    handingBack: string[];
    savedOn: string;
  } | null;
  filed: { version: number; filedOn: string | null } | null;
  changedSinceFiling?: boolean;
  heldSeats: HeldSeat[];
  applications: PlanApplication[];
  questsThisMoon: { done: number };
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
export const fileMine = () => call<MinePayload>("/api/season-plans/mine/file", "POST");
export const fetchVillage = (handle?: string) =>
  call<VillagePayload>(handle ? `/api/season-plans?handle=${encodeURIComponent(handle)}` : "/api/season-plans");
