/**
 * The player card's three calls, and the client contract for the owner's edits.
 *
 *   fetchCard           GET  /api/people/:handle/role-card
 *   proposeRoleWords    POST /api/people/me/role-card/roles/:roleId/propose
 *   savePersonalWords   the season aim and the goal it serves, through the
 *                       existing season plan routes; every other personal word
 *                       answers "not stored yet" until PR 6 gives it a home.
 *
 * THE SEAM FOR PR 6. `savePersonalWords` is the one function every personal
 * edit goes through. When the season plan migration lands, each key in
 * `PERSONAL_EDIT_KEYS` that gains a column moves into `PERSONAL_STORED_NOW`
 * (shared/playerCardEdit.ts) and gets its branch here; the edit UI does not
 * change.
 */
import { authToken } from "@/lib/gameApi";
import { fetchMine, fileMine, saveMine } from "@/components/seasonPlans/seasonPlansApi";
import { EDIT_WORDS, PERSONAL_STORED_NOW, type PersonalEditKey, type RoleEditKey } from "@shared/playerCardEdit";
import type { PlayerCardPayload } from "@shared/playerCardPayload";

export type Answer<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

const headers = (): Record<string, string> => {
  const t = authToken();
  return { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) };
};

async function call<T>(path: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<Answer<T>> {
  try {
    const res = await fetch(path, { method, headers: headers(), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const out = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, error: String(out?.message ?? out?.error ?? EDIT_WORDS.failed) };
    return { ok: true, data: out as T };
  } catch {
    return { ok: false, status: 0, error: EDIT_WORDS.failed };
  }
}

export const cardPath = (handle: string) => `/api/people/${encodeURIComponent(handle)}/role-card`;

/** A payload the card can draw: anything else is a failed read, never a crash on the profile. */
export function isCardPayload(v: unknown): v is PlayerCardPayload {
  const p = v as Partial<PlayerCardPayload> | null;
  return !!p && typeof p === "object" && !!p.card && typeof p.card === "object" && !!p.viewer && typeof p.viewer.isSelf === "boolean";
}

export async function fetchCard(handle: string): Promise<Answer<PlayerCardPayload>> {
  const r = await call<PlayerCardPayload>(cardPath(handle));
  if (r.ok && !isCardPayload(r.data)) return { ok: false, status: 0, error: EDIT_WORDS.failed };
  return r;
}

export const proposeRoleWords = (roleId: string, key: RoleEditKey, text: string) =>
  call<{ success: true; draftId: string; key: RoleEditKey; review: string }>(
    `/api/people/me/role-card/roles/${encodeURIComponent(roleId)}/propose`,
    "POST",
    { key, text },
  );

/**
 * Save one personal word to the owner's own record. The aim and the goal it
 * serves write a new version of the season plan, keeping everything else in
 * it, and file it again when the version before was filed.
 */
export async function savePersonalWords(key: PersonalEditKey, value: string): Promise<Answer<true>> {
  if (!PERSONAL_STORED_NOW.includes(key)) return { ok: false, status: 0, error: EDIT_WORDS.notStoredYet };
  const mine = await fetchMine();
  if (!mine.ok) return { ok: false, status: mine.status, error: mine.error };
  const plan = mine.data.plan;
  const wasFiled = !!mine.data.filed && !mine.data.changedSinceFiling;
  const saved = await saveMine({
    aim: key === "aim" ? value : String(plan?.aim ?? ""),
    servesGoal: key === "servesGoal" ? value.trim() || null : plan?.servesGoal ?? null,
    commitments: plan?.commitments ?? {},
    handingBack: plan?.handingBack ?? [],
  });
  if (!saved.ok) return { ok: false, status: saved.status, error: saved.error };
  if (wasFiled) {
    const filed = await fileMine();
    if (!filed.ok) return { ok: false, status: filed.status, error: filed.error };
  }
  return { ok: true, data: true };
}
