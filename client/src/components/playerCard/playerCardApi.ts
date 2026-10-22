/**
 * The player card's calls, and the client contract for the owner's edits.
 *
 *   fetchCard            GET  /api/people/:handle/role-card
 *   fetchApplicationCard GET  /api/governance/role-applications/:id/card (proposal mode)
 *   proposeRoleWords     POST /api/people/me/role-card/roles/:roleId/propose
 *   savePersonalWords    the owner's own words, through the season plan routes:
 *                          aim                PUT /api/season-plans/mine
 *                          goals served, how each helps, seasonal goals and
 *                          the card words     PUT /api/season-plans/mine/card
 *                          this moon's load   PUT /api/season-plans/mine/load
 *
 * `PUT /mine/card` keeps a group the body leaves out and clears one sent as
 * null. Each group is saved whole, so a single card word is merged into the
 * words already stored before it is sent, and nothing else is lost. With no
 * planning window open it answers 409 `no_season`, which the card says as a
 * plain sentence (`EDIT_WORDS.noSeason`).
 */
import { authToken } from "@/lib/gameApi";
import { fetchMine, fileMine, saveCard, saveMine, saveMoonLoad, type CardBody, type MinePayload } from "@/components/seasonPlans/seasonPlansApi";
import { EDIT_WORDS, type PersonalEditKey, type RoleEditKey } from "@shared/playerCardEdit";
import type { PlayerCardPayload } from "@shared/playerCardPayload";
import type { CardWordKey, CardWords, SeasonalGoal, ServedGoal } from "@shared/seasonPlanWords";

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

export const applicationCardPath = (id: string) => `/api/governance/role-applications/${encodeURIComponent(id)}/card`;

/** The card a role application asks for, in proposal mode, at the reader's tier. */
export async function fetchApplicationCard(id: string): Promise<Answer<PlayerCardPayload>> {
  const r = await call<PlayerCardPayload>(applicationCardPath(id));
  if (r.ok && !isCardPayload(r.data)) return { ok: false, status: 0, error: EDIT_WORDS.failed };
  return r;
}

export const proposeRoleWords = (roleId: string, key: RoleEditKey, text: string) =>
  call<{ success: true; draftId: string; key: RoleEditKey; review: string }>(
    `/api/people/me/role-card/roles/${encodeURIComponent(roleId)}/propose`,
    "POST",
    { key, text },
  );

// ── The owner's own words ──────────────────────────────────────────────────

/** The card word each personal key writes. */
const CARD_WORD_OF: Partial<Record<PersonalEditKey, CardWordKey>> = {
  howIHold: "howIHold",
  growingEdge: "growingEdge",
  whoCouldHoldNext: "nextHolder",
};

const lines = (v: string) =>
  v
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

/** "Title: done when" per line, at most three. Blank clears the group. Pure. */
export function seasonalGoalsFromText(value: string): SeasonalGoal[] | null {
  const goals = lines(value)
    .slice(0, 3)
    .map((l) => {
      const [title, ...rest] = l.split(":");
      return { title: title.trim(), doneWhen: rest.join(":").trim() || null };
    });
  return goals.length ? goals : null;
}

/**
 * The body `PUT /api/season-plans/mine/card` gets for one personal word, given
 * what the newest version holds. Null for a key that saves another way (the
 * aim and the load). Pure.
 */
export function cardBodyFor(
  key: PersonalEditKey,
  value: string,
  held: { servesGoals: ServedGoal[]; cardWords: CardWords | null },
  opts: { goal?: string } = {},
): CardBody | null {
  const text = value.trim();
  const word = CARD_WORD_OF[key];
  if (word) {
    const next: CardWords = { ...(held.cardWords ?? {}) };
    if (text) next[word] = text;
    else delete next[word];
    return { cardWords: Object.keys(next).length ? next : null };
  }
  switch (key) {
    case "seasonalGoals":
      return { seasonalGoals: seasonalGoalsFromText(value) };
    case "servesGoal": {
      // One of the season's goals per line; a goal kept keeps how it helps.
      const helps = new Map(held.servesGoals.map((g) => [g.goal, g.howItHelps]));
      const goals = Array.from(new Set(lines(value))).map((goal) => ({ goal, howItHelps: helps.get(goal) ?? null }));
      return { servesGoals: goals.length ? goals : null };
    }
    case "howItHelps": {
      if (!opts.goal) return null;
      return { servesGoals: held.servesGoals.map((g) => (g.goal === opts.goal ? { goal: g.goal, howItHelps: text || null } : g)) };
    }
    default:
      return null;
  }
}

/** What the newest version holds of the card's groups, out of `GET /api/season-plans/mine`. */
function heldGroups(mine: MinePayload): { servesGoals: ServedGoal[]; cardWords: CardWords | null } {
  const p = mine.plan;
  const servesGoals = p?.servesGoals?.length ? p.servesGoals : p?.servesGoal ? [{ goal: p.servesGoal, howItHelps: null }] : [];
  return { servesGoals, cardWords: mine.cardWords ?? null };
}

/** A refusal in the card's words: no planning window is a plain sentence. */
function refused(r: { status: number; error: string }): Answer<true> {
  return { ok: false, status: r.status, error: r.status === 409 ? EDIT_WORDS.noSeason : r.error };
}

/**
 * Save one personal word to the owner's own record. A plan that was filed
 * before the save is filed again when the save changed what was filed, so a
 * word written on the card never quietly un-files a plan.
 */
export async function savePersonalWords(key: PersonalEditKey, value: string, opts: { goal?: string } = {}): Promise<Answer<true>> {
  if (key === "loadRead") {
    const level = Number(value);
    const saved = await saveMoonLoad(Number.isInteger(level) ? level : NaN);
    return saved.ok ? { ok: true, data: true } : refused(saved);
  }
  const mine = await fetchMine();
  if (!mine.ok) return refused(mine);
  const wasFiled = !!mine.data.filed && !mine.data.changedSinceFiling;
  let after: MinePayload;
  if (key === "aim") {
    const plan = mine.data.plan;
    const saved = await saveMine({
      aim: value,
      servesGoal: plan?.servesGoal ?? null,
      servesGoals: plan?.servesGoals?.length ? plan.servesGoals : null,
      commitments: plan?.commitments ?? {},
      handingBack: plan?.handingBack ?? [],
    });
    if (!saved.ok) return refused(saved);
    after = saved.data;
  } else {
    const body = cardBodyFor(key, value, heldGroups(mine.data), opts);
    if (!body) return { ok: false, status: 0, error: EDIT_WORDS.failed };
    const saved = await saveCard(body);
    if (!saved.ok) return refused(saved);
    after = saved.data;
  }
  if (wasFiled && after.changedSinceFiling !== false) {
    const filed = await fileMine();
    if (!filed.ok) return { ok: false, status: filed.status, error: filed.error };
  }
  return { ok: true, data: true };
}
