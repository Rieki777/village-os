/**
 * A MEMBER'S COMPANIONS: who they are, what they bring, and what a yes opens
 * (0295; the contract with the outside service, sections 3, 5 and 8).
 *
 * ── WHO GETS ONE ─────────────────────────────────────────────────────────
 *
 * Every member gets a personal companion. A member who holds a role gets one
 * for that role when the village turned companions on for it
 * (`companions.role_ids`: "all", a list of role ids, or empty for none). A
 * role companion belongs to the ROLE: when the role passes on, the old
 * holder's companion retires and its undecided items move to the new holder's
 * (`syncArmy`). Quest and project companions are in the vocabulary and the
 * schema, and nothing creates one yet: that needs the flag on a quest the
 * contract names, which is its own change.
 *
 * ── WHAT A COMPANION BRINGS, AND THE TWO RULES THAT HOLD IT BACK ─────────
 *
 * An item is a question or a draft. `landItem` is the only way one is stored,
 * whoever wrote it (the village guide, the outside service through its sync,
 * or the member asking in chat), and it applies, in order:
 *
 *   1. Refusals, whole: an unknown kind, a kind with no door, a payload that
 *      fails its validator, a fraction, an email address or phone number
 *      anywhere. Nothing is stored and the sentence says why.
 *   2. Evidence: no quote or no source, and the item is HELD and never shown
 *      (the `external_proposals` rule). It is never released by the cap.
 *   3. The cap: per companion, per village day, questions only. The fourth
 *      question of a day lands held and opens the next morning, oldest first.
 *      Drafts are never capped: a hidden draft that wants to move money would
 *      be worse than a long list.
 *
 * ── NOTHING ACTS WITHOUT THE YES, AND THE YES IS A DOOR ──────────────────
 *
 * `planConfirm` checks the payload again, applies the member's edits, claims
 * the item (so two yeses open its door once) and says which existing door to
 * open. The route opens it as the member (server/routes/companions.ts), so
 * every check that door carries runs. This file never writes a ledger row, an
 * RSVP or a message itself.
 */
import { createHash, randomUUID } from "crypto";
import type { Pool } from "mysql2/promise";
import {
  addDays,
  applyEdits,
  carriesContact,
  defaultLook,
  DRAFT_DOORS,
  effectiveCap,
  isDraftKind,
  MAX_ANSWER,
  MAX_QUESTIONS_PER_MEMBER_PER_DAY,
  MAX_BODY,
  MAX_QUOTE,
  MAX_TITLE,
  parseLook,
  QUESTION_EXPIRY_DAYS,
  refusalFor,
  validateCompanionPayload,
  type CompanionItemView,
  type CompanionProvider,
  type CompanionView,
  type DraftKind,
  type ItemOrigin,
  type ItemStatus,
  type ItemType,
} from "../../shared/companionItems";
import { holderFirstName, roleWithHolders } from "../../shared/roleHolderLabel";
import {
  activeScopeCompanionsOutside,
  adoptScopeItems,
  companionsOf,
  decideItem,
  expireQuestions,
  insertCompanionIfAbsent,
  insertItem,
  itemByDedupeKey,
  itemById,
  itemsForCompanions,
  membersByIds,
  openHeld,
  questionsShownOn,
  circleSpeakersForBudget,
  questionsShownToMemberOn,
  releasableHeld,
  reopenItem,
  rolesHeldBy,
  rosterFor,
  setItemPayload,
  updateCompanion,
  type CompanionRow,
  type ItemRow,
} from "../repos/companions";

/** What every call here needs to know about the village right now. */
export interface CompanionsEnv {
  pool: Pool;
  /** Today in the village's own zone, YYYY-MM-DD. The cap and the expiry count this day. */
  today: string;
  /** `companions.max_questions_per_day`. */
  ceiling: number;
  /** `companions.role_ids`: "all", a comma-separated list of role ids, or "" for none. */
  roleScope: string;
  /** The village guide's name, named above every chat it answers. */
  guideName: string;
}

const PERSONAL_NAME = "Personal companion";
/** What a personal companion is called until the member names it. */
export const DEFAULT_PERSONAL_NAME = "Pip";

/** Whether the village turned companions on for this role. */
export function roleHasCompanion(roleScope: string, roleId: string): boolean {
  const s = String(roleScope ?? "").trim();
  if (!s) return false;
  if (s.toLowerCase() === "all") return true;
  return s.split(",").map((x) => x.trim()).filter(Boolean).includes(roleId);
}

/** The engine's display name. The outside one is named by its own name. */
export function engineName(provider: CompanionProvider, guideName: string): string {
  return provider === "saberra" ? "Sera" : guideName.trim() || "The village guide";
}

// ── The army ─────────────────────────────────────────────────────────────

/**
 * Make the member's army match who they are today: their personal companion,
 * and one for each role they hold that has one. A role they no longer hold
 * retires its companion. A role they now hold takes over the undecided items
 * of whoever held it before, and that person's companion retires.
 */
export async function syncArmy(env: CompanionsEnv, userId: string): Promise<CompanionRow[]> {
  const pool = env.pool;
  let mine = await companionsOf(pool, userId);
  if (!mine.some((c) => c.scope === "personal")) {
    await insertCompanionIfAbsent(pool, {
      id: `comp-${randomUUID().slice(0, 12)}`,
      ownerUserId: userId,
      scope: "personal",
      scopeId: "",
      provider: "village",
      name: DEFAULT_PERSONAL_NAME,
      look: JSON.stringify(defaultLook(0)),
      dailyQuestionCap: 3,
      sortOrder: 0,
    });
  }
  const held = (await rolesHeldBy(pool, userId)).filter((r) => roleHasCompanion(env.roleScope, r.roleId));
  const heldIds = held.map((r) => r.roleId);
  mine = await companionsOf(pool, userId);

  for (let i = 0; i < held.length; i++) {
    const role = held[i];
    const existing = mine.find((c) => c.scope === "role" && c.scopeId === role.roleId);
    if (!existing) {
      await insertCompanionIfAbsent(pool, {
        id: `comp-${randomUUID().slice(0, 12)}`,
        ownerUserId: userId,
        scope: "role",
        scopeId: role.roleId,
        provider: "village",
        name: role.name.slice(0, 60),
        look: JSON.stringify(defaultLook(i + 1)),
        dailyQuestionCap: 3,
        sortOrder: i + 1,
      });
    } else if (existing.status === "retired") {
      await updateCompanion(pool, existing.id, { status: "active" });
    }
  }
  // Roles let go of: their companions retire. Their items stay for whoever holds the role next.
  for (const c of mine) {
    if (c.scope === "role" && c.status !== "retired" && !heldIds.includes(c.scopeId)) {
      await updateCompanion(pool, c.id, { status: "retired" });
    }
  }
  mine = await companionsOf(pool, userId);
  // Roles taken on: anybody else's live companion on it retires, and its undecided items come here.
  if (held.length > 0) {
    const roster = await rosterFor(pool, heldIds);
    for (const role of held) {
      const holders = (roster.get(role.roleId)?.holders ?? []).map((h) => h.id);
      for (const stale of await activeScopeCompanionsOutside(pool, "role", role.roleId, holders)) {
        await updateCompanion(pool, stale.id, { status: "retired" });
      }
      const here = mine.find((c) => c.scope === "role" && c.scopeId === role.roleId);
      if (here) await adoptScopeItems(pool, "role", role.roleId, here);
    }
  }
  return mine;
}

// ── Landing ──────────────────────────────────────────────────────────────

export interface LandInput {
  type: ItemType;
  kind?: DraftKind | string | null;
  title: string;
  body?: string | null;
  payload?: Record<string, unknown> | null;
  quote?: string | null;
  sourceRef?: string | null;
  sourceOccurredAt?: Date | null;
  origin: ItemOrigin;
  externalRef?: string | null;
  /** Given by the caller when it has a stable identity for the item; otherwise hashed from the content. */
  dedupeKey?: string | null;
  blocking?: boolean;
  dueOn?: string | null;
}

export type LandResult =
  | { ok: true; outcome: "stored" | "duplicate"; item: ItemRow }
  | { ok: false; error: string };

function clean(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function hashKey(parts: unknown[]): string {
  return `h:${createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 48)}`;
}

/**
 * Store one item for one companion, or refuse it whole with a sentence.
 * The only write into `companion_items`.
 */
export async function landItem(env: CompanionsEnv, companion: CompanionRow, input: LandInput): Promise<LandResult> {
  const pool = env.pool;
  if (input.type !== "question" && input.type !== "draft") return { ok: false, error: "An item is a question or a draft." };
  const title = clean(input.title, MAX_TITLE + 1);
  if (!title) return { ok: false, error: "An item needs a title." };
  if (title.length > MAX_TITLE) return { ok: false, error: `A title holds up to ${MAX_TITLE} characters.` };
  const body = clean(input.body, MAX_BODY + 1);
  if (body && body.length > MAX_BODY) return { ok: false, error: `A body holds up to ${MAX_BODY} characters.` };
  const quote = clean(input.quote, MAX_QUOTE);
  const sourceRef = clean(input.sourceRef, 400);

  let kind: DraftKind | null = null;
  let payload: Record<string, unknown> | null = null;
  if (input.type === "draft") {
    if (!isDraftKind(input.kind)) return { ok: false, error: `This village does not know the draft kind "${String(input.kind ?? "").slice(0, 32)}".` };
    kind = input.kind;
    const why = validateCompanionPayload(kind, input.payload ?? null);
    if (why) return { ok: false, error: why };
    payload = { ...(input.payload as Record<string, unknown>) };
  } else if (input.kind) {
    return { ok: false, error: "A question carries no draft kind." };
  }
  if (carriesContact([title, body, quote])) return { ok: false, error: "An item may not carry an email address or a phone number." };
  if (input.dueOn != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.dueOn))) return { ok: false, error: "due_on must be a date." };

  const dedupeKey =
    clean(input.dedupeKey, 191) ??
    (input.externalRef ? `${input.origin}:${String(input.externalRef).slice(0, 160)}` : hashKey([companion.id, input.type, kind, title, payload]));
  const already = await itemByDedupeKey(pool, dedupeKey);
  if (already) return { ok: true, outcome: "duplicate", item: already };

  let status: ItemStatus = "open";
  if (!quote || !sourceRef) status = "held";
  else if (input.type === "question") {
    const cap = effectiveCap(companion.dailyQuestionCap, env.ceiling);
    if ((await questionsShownOn(pool, companion.id, env.today)) >= cap) status = "held";
    // And the member's own ceiling, across every companion they have.
    else if ((await questionsShownToMemberOn(pool, companion.ownerUserId, env.today)) >= MAX_QUESTIONS_PER_MEMBER_PER_DAY) status = "held";
  }

  const id = `citem-${randomUUID().slice(0, 12)}`;
  const stored = await insertItem(pool, {
    id,
    companionId: companion.id,
    ownerUserId: companion.ownerUserId,
    type: input.type,
    draftKind: kind,
    title,
    body,
    payload,
    quote,
    sourceRef,
    sourceOccurredAt: input.sourceOccurredAt ?? null,
    origin: input.origin,
    externalRef: clean(input.externalRef, 128),
    dedupeKey,
    blocking: Boolean(input.blocking),
    dueOn: input.dueOn ?? null,
    dayKey: env.today,
    status,
  });
  const row = stored ? await itemById(pool, id) : await itemByDedupeKey(pool, dedupeKey);
  if (!row) return { ok: false, error: "That item could not be stored." };
  return { ok: true, outcome: stored ? "stored" : "duplicate", item: row };
}

/**
 * A purchase's yes: the budget spend that pays the member back lands as a
 * draft on the personal companion of whoever speaks for the circle, and that
 * person's own yes records it through the treasury's spend door. Keyed on the
 * purchase, so a second yes finds the hand-off already made.
 */
export async function handOffPurchase(
  env: CompanionsEnv,
  item: ItemRow,
  plan: Extract<ConfirmPlan, { way: "payback" }>,
): Promise<{ ok: true; landedId: string } | { ok: false; status: number; error: string }> {
  const personal = (await syncArmy(env, plan.holderId)).find((c) => c.scope === "personal");
  if (!personal) return { ok: false, status: 409, error: "The person who speaks for this circle has no companion to hand this to." };
  const landed = await landItem(env, personal, {
    type: "draft",
    kind: "budget_spend",
    title: String(plan.spend.note ?? item.title).slice(0, MAX_TITLE),
    payload: plan.spend,
    quote: item.quote,
    sourceRef: `companion:${item.id}`,
    origin: item.origin,
    dedupeKey: `payback:${item.id}`,
  });
  if (!landed.ok) return { ok: false, status: 409, error: landed.error };
  return { ok: true, landedId: landed.item.id };
}

/**
 * The day turns for one companion: questions unanswered for seven days
 * expire, and held questions open, oldest first, up to today's cap.
 */
export async function turnTheDay(env: CompanionsEnv, companion: CompanionRow): Promise<void> {
  await expireQuestions(env.pool, addDays(env.today, -QUESTION_EXPIRY_DAYS), companion.ownerUserId);
  const cap = effectiveCap(companion.dailyQuestionCap, env.ceiling);
  const room = Math.min(
    cap - (await questionsShownOn(env.pool, companion.id, env.today)),
    MAX_QUESTIONS_PER_MEMBER_PER_DAY - (await questionsShownToMemberOn(env.pool, companion.ownerUserId, env.today)),
  );
  if (room > 0) await openHeld(env.pool, await releasableHeld(env.pool, companion.id, room), env.today);
}

// ── What the member reads ────────────────────────────────────────────────

/** How a member reads a source reference. Unknown shapes read as themselves. */
export function sourceWords(ref: string | null, quote: string | null): string {
  const r = String(ref ?? "");
  const where = r.startsWith("chat:")
    ? "you said this in chat"
    : r.startsWith("event:")
      ? "the gathering's page"
      : r.startsWith("sera:")
        ? "the outside service's record"
        : r || "no source";
  return quote ? `Source: ${where}. "${quote}"` : `Source: ${where}.`;
}

/** Everything a draft might name, resolved off the live roster in one pass. */
export interface Names {
  role(roleId: string): string;
  person(userId: string): string;
  handle(userId: string): string | null;
  /** The sole live holder of a role, or why there is not exactly one. */
  soleHolder(roleId: string): { ok: true; userId: string } | { ok: false; error: string };
}

export async function namesFor(pool: Pool, items: readonly { payload: Record<string, unknown> | null }[]): Promise<Names> {
  const roleIds = new Set<string>();
  const userIds = new Set<string>();
  for (const it of items) {
    const p = it.payload ?? {};
    if (typeof p.toRoleId === "string") roleIds.add(p.toRoleId);
    if (typeof p.toUserId === "string") userIds.add(p.toUserId);
  }
  const [roster, people] = await Promise.all([rosterFor(pool, Array.from(roleIds)), membersByIds(pool, Array.from(userIds))]);
  const heldBy = new Map<string, string>();
  for (const id of Array.from(userIds)) {
    const r = await rolesHeldBy(pool, id);
    if (r[0]) heldBy.set(id, r[0].name);
  }
  return {
    role: (roleId) => {
      const r = roster.get(roleId);
      return r ? roleWithHolders(r.name, r.holders.map((h) => h.name)) : "a role this village no longer has";
    },
    person: (userId) => {
      const p = people.get(userId);
      if (!p) return "a member who has left";
      const first = holderFirstName(p.name) || "a member";
      const role = heldBy.get(userId);
      return role ? roleWithHolders(role, [p.name]) : first;
    },
    handle: (userId) => people.get(userId)?.handle ?? null,
    soleHolder: (roleId) => {
      const r = roster.get(roleId);
      if (!r) return { ok: false, error: "That role is not in this village any more." };
      if (r.holders.length === 0) return { ok: false, error: `${r.name} has no holder right now, so there is nobody to send this to.` };
      if (r.holders.length > 1) return { ok: false, error: `${roleWithHolders(r.name, r.holders.map((h) => h.name))} has more than one holder. Edit the draft to name one.` };
      return { ok: true, userId: r.holders[0].id };
    },
  };
}

/** The money and token words a draft shows, given by the caller that knows the village's tokens. */
export interface Words {
  tokenAmount(slug: string, amountMinor: number): string;
  recognition(amount: number): string;
  /** The token a circle budget spends in, or null when the village has no such budget. */
  budgetToken?(budgetId: string): string | null;
}

function whoOf(p: Record<string, unknown>, names: Names): string {
  if (typeof p.toRoleId === "string") return names.role(p.toRoleId);
  if (typeof p.toUserId === "string") return names.person(p.toUserId);
  return "nobody";
}

/** What a draft moves, in plain words. People are named "Role (FirstName)", off the roster as it is now. */
export function draftDetail(kind: DraftKind, p: Record<string, unknown>, names: Names, words: Words): string {
  switch (kind) {
    case "rsvp":
      return `Your answer: ${String(p.status)}.`;
    case "token_payment":
      return `${words.tokenAmount(String(p.tokenType), Number(p.amountMinor))} to ${whoOf(p, names)}.${p.note ? `\n"${String(p.note)}"` : ""}`;
    case "budget_spend":
    {
      const slug = words.budgetToken?.(String(p.budgetId)) ?? null;
      const amount = slug ? words.tokenAmount(slug, Number(p.amountMinor)) : "An amount";
      return `${amount} from the circle budget, to ${whoOf(p, names)}.${p.note ? `\n"${String(p.note)}"` : ""}`;
    }
    case "purchase":
    {
      const slug = words.budgetToken?.(String(p.budgetId)) ?? null;
      const amount = slug ? words.tokenAmount(slug, Number(p.amountMinor)) : "An amount";
      return [
        `${amount} paid back to you from the circle budget.`,
        p.note ? `"${String(p.note)}"` : "",
        p.toOutside ? `Bought from: ${String(p.toOutside)}` : "",
      ].filter(Boolean).join("\n");
    }
    case "gratitude_note":
      return `${words.recognition(Number(p.amount))} to ${whoOf(p, names)}.\n"${String(p.message)}"`;
    case "message":
      return `${p.conversationId ? "To the conversation" : `To ${whoOf(p, names)}`}:\n"${String(p.body)}"`;
    case "quest":
      return [p.description ? String(p.description) : "", p.firstStep ? `First step: ${String(p.firstStep)}` : ""].filter(Boolean).join("\n");
    case "email":
      return `Subject: ${String(p.subject)}\n"${String(p.text)}"`;
    default:
      return "";
  }
}

export function mailtoFor(p: Record<string, unknown>): string {
  return `mailto:?subject=${encodeURIComponent(String(p.subject ?? ""))}&body=${encodeURIComponent(String(p.text ?? ""))}`;
}

function scopeLine(c: CompanionRow, roleNames: Map<string, string>): string {
  if (c.scope === "personal") return PERSONAL_NAME;
  if (c.scope === "role") return `${roleNames.get(c.scopeId) ?? "Role"} companion`;
  if (c.scope === "quest") return "Quest companion";
  return "Project companion";
}

function itemView(it: ItemRow, names: Names, words: Words): CompanionItemView {
  const kind = it.type === "draft" && isDraftKind(it.draftKind) ? it.draftKind : null;
  const door = kind ? DRAFT_DOORS[kind] : null;
  return {
    id: it.id,
    type: it.type,
    kind,
    status: it.status,
    title: it.title,
    body: it.body,
    detail: kind && it.payload ? draftDetail(kind, it.payload, names, words) : null,
    onYes: door ? door.onYes : null,
    yesLabel: door ? door.yesLabel : null,
    editable: door ? door.editable : [],
    payload: it.payload,
    source: sourceWords(it.sourceRef, it.quote),
    blocking: it.blocking,
    dueOn: it.dueOn,
    dayKey: it.dayKey,
    answer: it.answer,
    outcomeRef: it.outcomeRef,
    mailto: kind === "email" && it.payload ? mailtoFor(it.payload) : null,
  };
}

/** The Monday that starts the week holding `today`. */
export function weekStart(today: string): string {
  const d = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, -((d + 6) % 7));
}

/**
 * The member's whole army as the profile reads it. Turns the day for each
 * companion first, so a held question opens and a stale one expires on the
 * first read of the morning without waiting for a job.
 */
export async function armyView(
  env: CompanionsEnv,
  userId: string,
  words: Words,
  portraitUrl: (key: string) => string | null = () => null,
): Promise<CompanionView[]> {
  const army = (await syncArmy(env, userId)).filter((c) => c.status !== "retired");
  for (const c of army) await turnTheDay(env, c);
  const since = `${weekStart(env.today)} 00:00:00`;
  const items = await itemsForCompanions(env.pool, army.map((c) => c.id), since);
  const names = await namesFor(env.pool, items);
  const roleIds = army.filter((c) => c.scope === "role").map((c) => c.scopeId);
  const roster = await rosterFor(env.pool, roleIds);
  const roleNames = new Map(Array.from(roster.entries()).map(([id, r]) => [id, r.name] as [string, string]));

  return army.map((c, i): CompanionView => {
    const mine = items.filter((it) => it.companionId === c.id);
    const shown = mine.filter((it) => it.status !== "held");
    const done = new Map<string, number>();
    for (const it of mine) {
      if (it.status !== "confirmed" || !it.draftKind) continue;
      done.set(it.draftKind, (done.get(it.draftKind) ?? 0) + 1);
    }
    return {
      id: c.id,
      scope: c.scope,
      scopeId: c.scopeId,
      provider: c.provider,
      engine: engineName(c.provider, env.guideName),
      engineConnected: c.provider === "village",
      chatEngine: engineName("village", env.guideName),
      name: c.name,
      scopeLine: scopeLine(c, roleNames),
      look: parseLook(c.look) ?? defaultLook(i),
      lookUrl: (() => {
        const l = parseLook(c.look);
        return l && l.source !== "choose" && l.portraitKey ? portraitUrl(l.portraitKey) : null;
      })(),
      dailyCap: effectiveCap(c.dailyQuestionCap, env.ceiling),
      status: c.status,
      sortOrder: c.sortOrder,
      questions: shown.filter((it) => it.type === "question" && (it.status === "open" || it.dayKey === env.today)).map((it) => itemView(it, names, words)),
      drafts: shown.filter((it) => it.type === "draft" && (it.status === "open" || it.dayKey === env.today)).map((it) => itemView(it, names, words)),
      heldCount: mine.filter((it) => it.status === "held" && it.type === "question" && it.quote && it.sourceRef).length,
      doneThisWeek: Array.from(done.entries()).map(([kind, count]) => ({ kind: kind as DraftKind, count })),
    };
  });
}

// ── Deciding ─────────────────────────────────────────────────────────────

export type Decision = { ok: true; item: ItemRow } | { ok: false; status: number; error: string };

async function ownOpenItem(pool: Pool, userId: string, itemId: string): Promise<Decision> {
  const it = await itemById(pool, itemId);
  if (!it || it.ownerUserId !== userId) return { ok: false, status: 404, error: "Not found" };
  if (it.status !== "open") return { ok: false, status: 409, error: `That was already ${it.status}.` };
  return { ok: true, item: it };
}

/** The member's answer to a question. Stored as their words; nothing else moves. */
export async function answerQuestion(pool: Pool, userId: string, itemId: string, answer: unknown): Promise<Decision> {
  const got = await ownOpenItem(pool, userId, itemId);
  if (!got.ok) return got;
  if (got.item.type !== "question") return { ok: false, status: 400, error: "A draft is confirmed or declined. Only a question takes an answer." };
  const words = String(answer ?? "").trim();
  if (!words) return { ok: false, status: 400, error: "Write your answer first." };
  if (words.length > MAX_ANSWER) return { ok: false, status: 400, error: `An answer holds up to ${MAX_ANSWER} characters.` };
  if (!(await decideItem(pool, itemId, ["open"], "answered", { answer: words }))) return { ok: false, status: 409, error: "That was already decided." };
  return { ok: true, item: (await itemById(pool, itemId))! };
}

/** No to a draft, or "not mine" to a question. Nothing happens, and the companion is told. */
export async function declineItem(pool: Pool, userId: string, itemId: string): Promise<Decision> {
  const got = await ownOpenItem(pool, userId, itemId);
  if (!got.ok) return got;
  if (!(await decideItem(pool, itemId, ["open"], "declined"))) return { ok: false, status: 409, error: "That was already decided." };
  return { ok: true, item: (await itemById(pool, itemId))! };
}

/** One request to an existing door, made as the member. */
export interface DoorCall {
  method: "POST";
  path: string;
  body: Record<string, unknown>;
}

/**
 * What a yes does, worked out before anything moves.
 *
 *   http      open these doors in order, as the member; a later step may read
 *             an earlier step's answer (`then`)
 *   quest     put the idea in the review inbox (`proposeQuestIdea`)
 *   rsvp      confirm the member draft behind it, re-proposing it first when
 *             the member changed their answer
 *   mail      nothing moves; the member's own mail opens
 */
export type ConfirmPlan =
  | { way: "http"; first: DoorCall; then?: (firstAnswer: any) => DoorCall | { error: string } }
  | { way: "quest"; prose: { title: string; description: string | null; firstStep: string | null } }
  | { way: "rsvp"; eventId: string; status: string; occurrenceKey: string | null; memberDraftId: string | null; changed: boolean }
  | { way: "mail"; mailto: string }
  /** A purchase: hand a budget spend that pays the member back to whoever speaks for the circle. */
  | { way: "payback"; holderId: string; spend: Record<string, unknown> };

export type Planned =
  | { ok: true; item: ItemRow; kind: DraftKind; payload: Record<string, unknown>; edited: string[]; plan: ConfirmPlan }
  | { ok: false; status: number; error: string };

function recipientOf(p: Record<string, unknown>, names: Names, self: string): { ok: true; userId: string } | { ok: false; error: string } {
  if (typeof p.toUserId === "string") {
    if (p.toUserId === self) return { ok: false, error: "That draft names you. Edit it to name someone else." };
    return { ok: true, userId: p.toUserId };
  }
  if (typeof p.toRoleId === "string") {
    const sole = names.soleHolder(p.toRoleId);
    if (!sole.ok) return sole;
    if (sole.userId === self) return { ok: false, error: "You hold that role yourself, so this would pay you." };
    return sole;
  }
  return { ok: false, error: "That draft names nobody." };
}

/**
 * Check a yes and say which door it opens, WITHOUT claiming the item. The
 * route claims it (`claimForDoor`) the moment before the door opens, and
 * gives it back (`releaseClaim`) if the door refuses.
 */
export async function planConfirm(pool: Pool, userId: string, itemId: string, edits: unknown): Promise<Planned> {
  const got = await ownOpenItem(pool, userId, itemId);
  if (!got.ok) return got;
  const it = got.item;
  if (it.type !== "draft" || !isDraftKind(it.draftKind)) return { ok: false, status: 400, error: "Only a draft takes a yes. A question takes an answer." };
  const kind = it.draftKind;
  const refused = refusalFor(kind);
  if (refused) return { ok: false, status: 409, error: refused };
  const merged = applyEdits(kind, it.payload ?? {}, edits);
  if (!merged.ok) return { ok: false, status: 400, error: merged.error };
  const why = validateCompanionPayload(kind, merged.payload);
  if (why) return { ok: false, status: 400, error: why };
  const p = merged.payload;
  const names = await namesFor(pool, [{ payload: p }]);
  const nonce = `companion-${it.id}`;

  const base = { ok: true as const, item: it, kind, payload: p, edited: merged.edited };
  switch (kind) {
    case "rsvp":
      return {
        ...base,
        plan: {
          way: "rsvp",
          eventId: String(p.eventId),
          status: String(p.status),
          occurrenceKey: typeof p.occurrenceKey === "string" ? p.occurrenceKey : null,
          memberDraftId: typeof p.memberDraftId === "string" ? p.memberDraftId : null,
          changed: merged.edited.includes("status"),
        },
      };
    case "token_payment": {
      const to = recipientOf(p, names, userId);
      if (!to.ok) return { ok: false, status: 409, error: to.error };
      return {
        ...base,
        plan: { way: "http", first: { method: "POST", path: "/api/wallet/send", body: { to: to.userId, tokenType: p.tokenType, amount: p.amountMinor, note: p.note ?? "", clientNonce: nonce } } },
      };
    }
    case "purchase": {
      // The member's yes cannot record a spend that pays the member, so it
      // hands one to the person who speaks for the circle (`handOffPurchase`).
      const speakers = await circleSpeakersForBudget(pool, String(p.budgetId));
      if (!speakers) return { ok: false, status: 404, error: "No such budget" };
      const others = speakers.holders.filter((h) => h !== userId);
      if (speakers.holders.includes(userId)) {
        return { ok: false, status: 409, error: "You speak for this circle yourself, and a spend never pays the person asking. Ask another steward to record it." };
      }
      if (others.length === 0) return { ok: false, status: 409, error: "Nobody speaks for this circle yet, so there is nobody to pay you back. Ask an admin." };
      if (others.length > 1) return { ok: false, status: 409, error: "More than one person speaks for this circle, so this cannot pick who pays you back. Ask one of them." };
      const what = typeof p.note === "string" && p.note.trim() ? p.note.trim() : it.title;
      const me = await namesFor(pool, [{ payload: { toUserId: userId } }]);
      return {
        ...base,
        plan: {
          way: "payback",
          holderId: others[0],
          spend: { budgetId: String(p.budgetId), amountMinor: p.amountMinor, note: `Pay back ${me.person(userId)}: ${what}`.slice(0, 180), toUserId: userId },
        },
      };
    }
    case "budget_spend": {
      const to = recipientOf(p, names, userId);
      if (!to.ok) return { ok: false, status: 409, error: to.error };
      return {
        ...base,
        plan: {
          way: "http",
          first: { method: "POST", path: `/api/admin/resources/budgets/${encodeURIComponent(String(p.budgetId))}/spend`, body: { amountMinor: p.amountMinor, toUserId: to.userId, note: p.note ?? "", requestId: nonce } },
        },
      };
    }
    case "gratitude_note": {
      const to = recipientOf(p, names, userId);
      if (!to.ok) return { ok: false, status: 409, error: to.error };
      const handle = names.handle(to.userId);
      if (!handle) return { ok: false, status: 409, error: "That member has no handle to send to." };
      return { ...base, plan: { way: "http", first: { method: "POST", path: "/api/game/gratitude/send", body: { to: `@${handle}`, amount: p.amount, message: p.message } } } };
    }
    case "message": {
      const body = String(p.body);
      if (typeof p.conversationId === "string" && p.conversationId) {
        return { ...base, plan: { way: "http", first: { method: "POST", path: `/api/messages/${encodeURIComponent(p.conversationId)}/messages`, body: { body } } } };
      }
      const to = recipientOf(p, names, userId);
      if (!to.ok) return { ok: false, status: 409, error: to.error };
      return {
        ...base,
        plan: {
          way: "http",
          first: { method: "POST", path: "/api/messages/direct", body: { userId: to.userId } },
          then: (opened: any) =>
            typeof opened?.id === "string" || typeof opened?.id === "number"
              ? { method: "POST", path: `/api/messages/${encodeURIComponent(String(opened.id))}/messages`, body: { body } }
              : { error: "The conversation could not be opened." },
        },
      };
    }
    case "quest":
      return {
        ...base,
        plan: { way: "quest", prose: { title: String(p.title), description: p.description ? String(p.description) : null, firstStep: p.firstStep ? String(p.firstStep) : null } },
      };
    case "email":
      return { ...base, plan: { way: "mail", mailto: mailtoFor(p) } };
  }
  return { ok: false, status: 409, error: "That kind has no door." };
}

/** Claim the item for its yes. False when somebody's other yes got there first. */
export async function claimForDoor(pool: Pool, planned: Extract<Planned, { ok: true }>): Promise<boolean> {
  return decideItem(pool, planned.item.id, ["open"], "confirmed", {
    editedFields: planned.edited.length ? planned.edited : null,
    payload: planned.payload,
  });
}

/** The door refused: the item opens again, as it was. */
export async function releaseClaim(pool: Pool, planned: Extract<Planned, { ok: true }>): Promise<void> {
  await reopenItem(pool, planned.item.id, "confirmed");
  if (planned.item.payload) await setItemPayload(pool, planned.item.id, planned.item.payload);
}

/** Record what the yes made, once the door said yes. */
export async function recordOutcome(pool: Pool, itemId: string, outcomeRef: string): Promise<void> {
  await decideItem(pool, itemId, ["confirmed"], "confirmed", { outcomeRef: outcomeRef.slice(0, 128) });
}

/** What a door's answer made, as a short reference. Never an amount, never a member's id. */
export function outcomeRefFrom(kind: DraftKind, answer: any): string {
  const pick = (...v: unknown[]) => String(v.find((x) => x !== undefined && x !== null && x !== "") ?? kind);
  switch (kind) {
    case "token_payment":
      return `wallet_transfer:${pick(answer?.transferId, answer?.id, "sent")}`;
    case "budget_spend":
      return `budget_spend:${pick(answer?.movementId, answer?.id, answer?.transferId, "recorded")}`;
    case "gratitude_note":
      return `gratitude:${pick(answer?.entry?.id, "sent")}`;
    case "message":
      return `message:${pick(answer?.message?.id, answer?.id, "sent")}`;
    default:
      return kind;
  }
}
