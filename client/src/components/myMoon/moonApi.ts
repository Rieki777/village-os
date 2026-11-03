/**
 * MY MOON'S CALLS, built on the door table in shared/moonRecap.ts
 * (`MOON_ROUTES`) and its request and response types, which are the contract
 * with the server lanes. Nothing here decides who may do what: every door asks
 * the server's one gate, and a refusal comes back as a sentence to show.
 *
 * Every call carries the member's token (`gameFetch`): this deployment
 * authenticates by `Authorization: Bearer` alone.
 *
 * ── CONTRACT GAPS, NAMED WHERE THEY ARE READ ──────────────────────────────
 *
 * The page reads a few fields the contract does not carry yet. Each is
 * optional, so the page works without it and lights up the day the server
 * sends it:
 *   - `MyMoonResponse` has no `guideUrl` (B1) and no `thanks` (A7).
 *   - `SendRecapRequest` has no `thanks`.
 *   - `QueueRow` has no items, no approval `hash` and no reading (A4), so the
 *     work review cannot approve per item from the queue alone, and the
 *     invoice in it has no `hash` for `BulkApproveRequest`.
 */
import { gameFetch } from "@/lib/gameApi";
import {
  MOON_ROUTES,
  PACK_REFUSAL_WORDS,
  type AskSeraResponse,
  type BulkApproveRequest,
  type BulkApproveResponse,
  type GatherResponse,
  type GoalInput,
  type ImportPackResponse,
  type ItemFields,
  type ItemResponse,
  type MemberMoonResponse,
  type MyMoonResponse,
  type PackRefusalCode,
  type PayRouteRequest,
  type PayRouteResponse,
  type QueueResponse,
  type QueueRow,
  type RangeAnswerRequest,
  type Reading,
  type RecapItem,
  type ReturnRequest,
  type ScoreGoalRequest,
  type SendInvoiceRequest,
  type SendInvoiceResponse,
  type SendRecapRequest,
  type SendRecapResponse,
  type TakeBackResponse,
  type ThanksEntry,
  type WorkReviewRequest,
  MY_MOON_WORDS,
} from "@shared/moonRecap";

export type Answer<T> = { ok: true; data: T } | { ok: false; status: number; error: string; code: string | null };

/** The page's reading of `GET /api/me/moon`, with the fields the contract does not carry yet. */
export type MyMoonData = MyMoonResponse & { guideUrl?: string | null; thanks?: ThanksEntry[] };

/** A queue row, with the fields the work review and bulk approval need and the contract does not carry yet. */
export type QueueRowView = QueueRow & {
  items?: RecapItem[];
  hash?: string;
  taskReading?: Reading | null;
  seatReading?: Reading | null;
  invoice: (NonNullable<QueueRow["invoice"]> & { hash?: string }) | null;
};
export type QueueData = Omit<QueueResponse, "rows"> & { rows: QueueRowView[] };

const isPackCode = (v: unknown): v is PackRefusalCode => typeof v === "string" && v in PACK_REFUSAL_WORDS;

/** A refusal as a sentence: the server's `message`, a pack code's words, or the page's fallback. Never a bare code. */
export function refusalWords(body: unknown, fallback: string = MY_MOON_WORDS.failed): string {
  const b = (body ?? {}) as { message?: unknown; error?: unknown };
  if (typeof b.message === "string" && b.message.trim()) return b.message.trim();
  if (isPackCode(b.error)) return PACK_REFUSAL_WORDS[b.error];
  // A sentence the server sent as `error` (the contract's words carry a space and end in a stop).
  if (typeof b.error === "string" && /\s/.test(b.error) && /[.!?]$/.test(b.error.trim())) return b.error.trim();
  return fallback;
}

type Method = "GET" | "POST" | "PUT" | "PATCH";

export async function call<T>(path: string, method: Method = "GET", body?: unknown, init: RequestInit = {}): Promise<Answer<T>> {
  try {
    const res = await gameFetch(path, { ...init, method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const out = await res.json().catch(() => null);
    if (!res.ok) {
      const code = out && typeof out.error === "string" ? out.error : null;
      return { ok: false, status: res.status, error: refusalWords(out), code };
    }
    return { ok: true, data: out as T };
  } catch {
    return { ok: false, status: 0, error: MY_MOON_WORDS.failed, code: null };
  }
}

/** A door with its `:name` parts filled in. */
export function door(template: string, params: Record<string, string> = {}): string {
  return template.replace(/:([a-zA-Z]+)/g, (_, k: string) => encodeURIComponent(params[k] ?? ""));
}

const withCycle = (path: string, cycle: string | null) => (cycle ? `${path}?cycle=${encodeURIComponent(cycle)}` : path);

// ── The member's own doors ─────────────────────────────────────────────────

export const fetchMyMoon = (cycle: string | null) => call<MyMoonData>(withCycle(MOON_ROUTES.myMoon, cycle));
export const gather = (cycle: string) => call<GatherResponse>(door(MOON_ROUTES.gather, { cycle }), "POST", {});
export const askSera = (cycle: string) => call<AskSeraResponse>(door(MOON_ROUTES.askSera, { cycle }), "POST", {});
export const addItem = (cycle: string, text: string) => call<ItemResponse>(door(MOON_ROUTES.addItem, { cycle }), "POST", { text, state: "kept" });
export const editItem = (id: string, fields: ItemFields) => call<ItemResponse>(door(MOON_ROUTES.editItem, { id }), "PATCH", fields);
export const sendRecap = (cycle: string, body: SendRecapRequest & { thanks?: ThanksEntry[] }) =>
  call<SendRecapResponse>(door(MOON_ROUTES.sendRecap, { cycle }), "POST", body);
export const takeBack = (cycle: string) => call<TakeBackResponse>(door(MOON_ROUTES.takeBack, { cycle }), "POST", {});
export const sendInvoice = (cycle: string, body: SendInvoiceRequest) => call<SendInvoiceResponse>(door(MOON_ROUTES.sendInvoice, { cycle }), "POST", body);
export const rangeAnswer = (cycle: string, body: RangeAnswerRequest) => call<unknown>(door(MOON_ROUTES.rangeAnswer, { cycle }), "POST", body);
export const saveNextGoals = (cycle: string, goals: Array<GoalInput & { carriedFromId?: string | null }>) =>
  call<unknown>(door(MOON_ROUTES.nextGoals, { cycle }), "PUT", { goals });
export const scoreGoal = (id: string, body: ScoreGoalRequest) => call<unknown>(door(MOON_ROUTES.scoreGoal, { id }), "PATCH", body);
export const importPack = (cycle: string, pack: unknown, confirm?: { previewHash: string }) =>
  call<ImportPackResponse>(door(MOON_ROUTES.importPack, { cycle }), "POST", confirm ? { pack, confirm: true, previewHash: confirm.previewHash } : { pack });
export const savePayRoute = (body: PayRouteRequest) => call<PayRouteResponse>(MOON_ROUTES.payRoute, "PUT", body);

/** Another member's sent recap, as `memberView` reads it. */
export const fetchMemberMoon = (handle: string, cycle: string | null = null) =>
  call<MemberMoonResponse>(withCycle(door(MOON_ROUTES.memberMoon, { handle: handle.replace(/^@/, "") }), cycle));

/** The directory search the messaging door already serves. Empty when it is closed. */
export async function findMembers(q: string): Promise<Array<{ userId: string; name: string; handle: string | null }>> {
  if (q.trim().length < 2) return [];
  const r = await call<Array<{ userId: string; name: string; handle: string | null }>>(`/api/messages/people?q=${encodeURIComponent(q.trim())}`);
  return r.ok && Array.isArray(r.data) ? r.data : [];
}

/** Every role on the village, for "the role it belongs to" and a Fill verdict. */
export async function fetchVillageRoles(): Promise<Array<{ id: string; name: string }>> {
  const r = await call<Array<{ id: string; name: string; isExample?: boolean }>>("/api/roles");
  return r.ok && Array.isArray(r.data) ? r.data.filter((x) => !x.isExample).map((x) => ({ id: String(x.id), name: String(x.name) })) : [];
}

// ── The approvers' doors ───────────────────────────────────────────────────

/** `headers` lets the admin desk pass its own session header. */
export const fetchQueue = (cycle: string | null, init: RequestInit = {}) => call<QueueData>(withCycle(MOON_ROUTES.queue, cycle), "GET", undefined, init);
export const reviewWork = (recap: string, body: WorkReviewRequest, init: RequestInit = {}) => call<unknown>(door(MOON_ROUTES.work, { recap }), "POST", body, init);
export const returnRecap = (recap: string, body: ReturnRequest, init: RequestInit = {}) => call<unknown>(door(MOON_ROUTES.returnRecap, { recap }), "POST", body, init);
export const approveInvoices = (body: BulkApproveRequest, init: RequestInit = {}) => call<BulkApproveResponse>(MOON_ROUTES.approveInvoices, "POST", body, init);

/** Copy words to the clipboard. False when the browser refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
