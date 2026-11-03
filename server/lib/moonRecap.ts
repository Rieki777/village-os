/**
 * THE END-OF-MOON REVIEW: the member's side (module moon-review, lane B).
 *
 * The contract is shared/moonRecap.ts: every rule with no database in it and
 * every sentence a member reads. The SQL is server/repos/moonRecaps.ts (the
 * five moon tables) and server/repos/moonGather.ts (what the review reads from
 * other domains). This file only joins them, so it stays thin over the
 * contract, which is still moving (lane A parts 2 and 3).
 *
 *   resolveMoon     a cycle id, or the open moon, as bounds and civil days
 *   loadFrame       roles held, terms in force, the season, its goals and the
 *                   member's own seasonal goals, for one member and one moon
 *   gatherMoon      the board first, then accepted room tasks (check 36)
 *   myMoon          `GET /api/me/moon`
 *   memberMoon      `GET /api/members/:handle/moon`, through `memberView`
 *   sendRecap, takeBack, addItem, editItem, the pay route
 *
 * ── THE MOON ──────────────────────────────────────────────────────────────
 *
 * Bounds come from the village clock (`activeClock`), the days from the
 * contract's `moonDays` in the village time zone (the season document's
 * `timezone`, the one every seat's term is read in). A moon that has not
 * started yet is no moon a member can recap.
 *
 * ── WHAT NEVER CROSSES ────────────────────────────────────────────────────
 *
 * A task's `private_detail` and `minutes` are never read (the repo names its
 * columns). Quests are never read at all. The in-app Sera draft is off
 * (spec section 18): nothing here calls `ask_sera`.
 */
import crypto from "node:crypto";
import type { Pool } from "mysql2/promise";
import {
  ATTESTATION_MISSING, ITEM_TEXT_EMPTY, LIMITS, MOON_WORDS, NO_TERMS, PAYERS_DOC_KEY, EMPTY_PAYERS, PAY_ROUTES,
  PILOT_ACK_TEXT, PILOT_ACK_VERSION, RECAP_STATUS_WORDS, SERA_CLOSED_NOTE, SUPPORT_LINE, auditTensions, billRef, billToOf,
  coverage, daysHeldIn, deliverableLines, endOfMoonFriday, heldDuring, invoiceDueOn, invoiceSendRefusal, invoiceStatusLine,
  invoiceTotals, itemDedupeKey, linesFromTerms, memberView, moonDays, parseItemFields, parsePayRouteInput, parsePayers,
  parseRoleAudit, payRouteWords, payerForRoute, periodWords, recapEditable, routeChangeClearsConfirmation, termsCarryMoney,
  waitingLine, waitingStage, workDueOn,
  type AssignmentRow, type FromBlock, type InvoiceLine, type InvoiceView, type ItemOrigin, type ItemResponse, type ItemState,
  type MemberMoonResponse, type MoonDays, type PayRouteRecord, type MoonRef, type MyMoonResponse, type PayRouteResponse, type PayersDoc,
  type RecapItem, type RecapView, type RoleAudit, type RoleHeld, type SeasonGoalRef, type SendRecapResponse, type SeraState,
  type TakeBackResponse, type TermsInForce,
} from "../../shared/moonRecap";
import type { CycleBounds, CycleClock } from "../../shared/cycleClock";
import { civilDateKey } from "../../shared/lunar";
import type { AccomplishmentMoon } from "../../shared/taskAccomplishments";
import { SCREEN_REASON_WORDS, type ScreenReason } from "../../shared/memberTaskFeedback";
import type { SeatSettings } from "../../shared/seatSettings";
import * as store from "../repos/moonRecaps";
import * as gatherStore from "../repos/moonGather";
import type { BoardPress, BoardTask, RoleCardWords, SeatingRow } from "../repos/moonGather";
import { planVersions, moonLoadOf } from "../repos/seasonPlans";
import { readApplications } from "../repos/seatApplications";
import { dbDocument } from "../repos/store-db";
import { heldTermsFor } from "./heldTerms";
import { raiseTension, type TensionDeps } from "./roleTensions";

const newId = (prefix: string): string => `${prefix}-${crypto.randomBytes(8).toString("hex")}`;
const dayIn = (iso: string | Date | null, tz: string): string | null => (iso ? civilDateKey(iso instanceof Date ? iso : new Date(iso), tz) : null);

// ── The moon ─────────────────────────────────────────────────────────────────

/** A cycle id's bounds on this clock, or null when the id is not one of its moons. */
export function boundsForCycleId(clock: CycleClock, id: string): CycleBounds | null {
  const parsed = clock.parseId(String(id ?? ""));
  if (!parsed || parsed.clock !== clock.mode || parsed.cycleNumber === null) return null;
  const b = clock.boundsFor(clock.startOf(parsed.cycleNumber));
  return b.id === id ? b : null;
}

export interface Moon {
  bounds: CycleBounds;
  days: MoonDays;
  ref: MoonRef;
  timeZone: string;
}

export function moonOf(bounds: CycleBounds, timeZone: string): Moon {
  const days = moonDays(bounds, timeZone);
  return {
    bounds,
    days,
    timeZone,
    ref: {
      cycleId: bounds.id,
      firstDay: days.firstDay,
      lastDay: days.lastDay,
      periodWords: periodWords(days.firstDay, days.lastDay),
      endOfMoonFriday: endOfMoonFriday(bounds, timeZone),
    },
  };
}

/** The moon a cycle id names, never one that has not begun. Null for an unknown id. */
export function resolveMoon(clock: CycleClock, cycleId: string | null, timeZone: string, now = new Date()): Moon | null {
  const bounds = cycleId ? boundsForCycleId(clock, cycleId) : clock.boundsFor(now);
  if (!bounds || bounds.startsAt.getTime() > now.getTime()) return null;
  return moonOf(bounds, timeZone);
}

/**
 * `GET /api/me/moon` with no cycle: the member's OLDEST moon still in Draft or
 * Returned, else the open moon. Moons from another clock are passed over.
 */
export function defaultCycleId(clock: CycleClock, recaps: ReadonlyArray<Pick<store.RecapRow, "cycleId" | "status">>, now = new Date()): string {
  const open = clock.boundsFor(now);
  const editable = recaps
    .filter((r) => r.status === "draft" || r.status === "returned")
    .map((r) => ({ id: r.cycleId, n: clock.parseId(r.cycleId) }))
    .filter((r): r is { id: string; n: NonNullable<typeof r.n> } => !!r.n && r.n.clock === clock.mode && r.n.cycleNumber !== null && (r.n.cycleNumber as number) <= open.cycleNumber)
    .sort((a, b) => (a.n.cycleNumber as number) - (b.n.cycleNumber as number));
  return editable[0]?.id ?? open.id;
}

// ── Roles held, and terms in force ───────────────────────────────────────────

/** A seating as the contract reads it, its dates in village time. */
export function assignmentOf(s: SeatingRow, timeZone: string): AssignmentRow {
  return {
    id: s.id, roleId: s.roleId, userId: s.userId, holderKind: s.holderKind, isExample: s.isExample, applicationId: s.applicationId,
    startedOn: dayIn(s.startedAt, timeZone), endedOn: dayIn(s.endedAt, timeZone),
  };
}

/**
 * THE ROLES HELD DURING A MOON, one per role. Seatings come from
 * `org_role_assignments` alone and pass the contract's `heldDuring`; a role
 * held twice in one moon adds its days, capped at the moon's.
 */
export function rolesHeldFrom(
  seatings: readonly AssignmentRow[],
  cards: readonly RoleCardWords[],
  deliverablesOf: (applicationId: string | null) => string | null,
  moon: Pick<MoonDays, "firstDay" | "lastDay" | "days">,
): RoleHeld[] {
  const byRole = new Map<string, RoleHeld>();
  for (const a of seatings) {
    if (!heldDuring(a, moon)) continue;
    const card = cards.find((c) => c.id === a.roleId);
    if (!card) continue;
    const prev = byRole.get(a.roleId);
    const days = daysHeldIn(a, moon);
    if (prev) {
      prev.daysHeld = Math.min(moon.days, prev.daysHeld + days);
      if (a.applicationId) {
        prev.applicationId = a.applicationId;
        prev.deliverables = deliverableLines(deliverablesOf(a.applicationId));
      }
      continue;
    }
    byRole.set(a.roleId, {
      roleId: a.roleId,
      name: card.name,
      circleId: card.circleId,
      // Accountabilities and the CCOS responsibilities. Never the time commitment.
      accountabilities: [...card.accountabilities, ...card.responsibilities],
      deliverables: deliverableLines(deliverablesOf(a.applicationId)),
      applicationId: a.applicationId,
      daysHeld: days,
    });
  }
  return Array.from(byRole.values());
}

/**
 * One entry per adopted application in force, never one per seat: an
 * application covering three seats records its pay once (check 3).
 */
export function termsFrom(
  seatings: readonly AssignmentRow[],
  roles: readonly RoleHeld[],
  apps: ReadonlyArray<{ id: string; settings: unknown; deliverables: string | null }>,
  inForce: ReadonlySet<string>,
  moon: Pick<MoonDays, "firstDay" | "lastDay">,
): TermsInForce[] {
  const out: TermsInForce[] = [];
  for (const app of apps) {
    if (!inForce.has(app.id)) continue;
    const mine = seatings
      .filter((a) => a.applicationId === app.id && heldDuring(a, moon))
      .sort((x, y) => String(x.startedOn ?? "").localeCompare(String(y.startedOn ?? "")) || x.id.localeCompare(y.id));
    if (mine.length === 0) continue;
    const roleIds = Array.from(new Set(mine.map((a) => a.roleId)));
    out.push({
      applicationId: app.id,
      firstSeatId: mine[0].id,
      roleIds,
      roleNames: roleIds.map((id) => roles.find((r) => r.roleId === id)?.name ?? id),
      settings: (app.settings ?? null) as SeatSettings | null,
      deliverables: app.deliverables,
      daysHeld: Math.max(...mine.map((a) => daysHeldIn(a, moon))),
    });
  }
  return out;
}

// ── Gather: the board first, then the rooms ──────────────────────────────────

/** What one board task or room task becomes in the recap. */
export interface GatherCandidate {
  origin: ItemOrigin;
  dedupeKey: string;
  text: string;
  originNote: string | null;
  doneOn: string | null;
  roleId: string | null;
  seasonGoalId: string | null;
  state: ItemState;
  /**
   * The section 16 status. TODO(lane A, #836): `moon_recap_items.task_status`
   * (with `let_go_reason` and `redirect_to`) is not on main, so this is
   * computed and not stored yet. Store it once `insertItem` takes it.
   */
  taskStatus: "done" | "carry" | "let_go" | "redirect";
}

/**
 * CHECK 36, AS A RULE. For each board task SET within the moon (`created_on`):
 *
 *   pressed Done by the member, done inside the moon   kept, done
 *   closed by the Sera sync (done, no Done press)       suggested, "Closed in Sera"
 *   open, or done after the moon ended                  suggested, carry
 *   removed by the member                               suggested, let go (or
 *                                                       redirect), with the reason
 *
 * A press is told from a sync close by the member's own feedback row, never
 * by a timestamp. A task set before the moon never arrives (the repo reads by
 * `created_on`, and this checks again). Title only.
 */
export function boardCandidates(
  tasks: readonly BoardTask[],
  presses: readonly BoardPress[],
  moon: Pick<MoonDays, "firstDay" | "lastDay">,
  timeZone: string,
  heldRoleIds: readonly string[],
): GatherCandidate[] {
  const out: GatherCandidate[] = [];
  const latest = new Map<string, BoardPress>();
  for (const p of presses) if (!latest.has(p.taskId)) latest.set(p.taskId, p);
  const pressedDone = new Set(presses.filter((p) => p.action === "done").map((p) => p.taskId));
  for (const t of tasks) {
    if (t.createdOn < moon.firstDay || t.createdOn > moon.lastDay) continue;
    const text = t.title.replace(/\s+/g, " ").trim().slice(0, LIMITS.itemText);
    if (!text) continue;
    const base = {
      origin: (t.source === "sera" && t.externalId ? "sera" : "task") as ItemOrigin,
      dedupeKey: t.source === "sera" && t.externalId ? itemDedupeKey("sera", t.externalId) : itemDedupeKey("task", t.id),
      text,
      roleId: t.roleId && heldRoleIds.includes(t.roleId) ? t.roleId : null,
      seasonGoalId: t.servesGoalId,
    };
    if (t.status === "done") {
      const doneOn = dayIn(t.doneAt, timeZone);
      if (!pressedDone.has(t.id)) {
        // No Done press: the sync closed it, or nothing the member said did.
        out.push({ ...base, originNote: t.source === "sera" ? SERA_CLOSED_NOTE : null, doneOn, state: "suggested", taskStatus: "done" });
      } else if (doneOn && doneOn >= moon.firstDay && doneOn <= moon.lastDay) {
        out.push({ ...base, originNote: null, doneOn, state: "kept", taskStatus: "done" });
      } else {
        out.push({ ...base, originNote: null, doneOn: null, state: "suggested", taskStatus: "carry" });
      }
    } else if (t.status === "open") {
      out.push({ ...base, originNote: null, doneOn: null, state: "suggested", taskStatus: "carry" });
    } else {
      const press = latest.get(t.id);
      const redirect = press?.action === "redirect" || t.removeReason === "redirected";
      const reason = (press?.screenReason ?? t.removeReason) as ScreenReason | null;
      const note = reason && reason in SCREEN_REASON_WORDS ? SCREEN_REASON_WORDS[reason] : null;
      out.push({ ...base, originNote: note ? note.slice(0, LIMITS.originNote) : null, doneOn: null, state: "suggested", taskStatus: redirect ? "redirect" : "let_go" });
    }
  }
  return out;
}

/**
 * Accepted room tasks done inside the moon's instants. Somebody else accepted
 * the work, so it arrives kept. The role it was held by counts only when the
 * member held that role this moon; otherwise it reads as Outside my roles.
 */
export function roomCandidates(moons: readonly AccomplishmentMoon[], bounds: Pick<CycleBounds, "startsAt" | "endsAt">, timeZone: string, heldRoleIds: readonly string[]): GatherCandidate[] {
  const from = bounds.startsAt.getTime();
  const to = bounds.endsAt.getTime();
  const out: GatherCandidate[] = [];
  for (const m of moons) {
    for (const a of m.items) {
      const at = Date.parse(a.doneAt ?? a.acceptedAt);
      if (!Number.isFinite(at) || at < from || at >= to) continue;
      const text = String(a.text ?? "").replace(/\s+/g, " ").trim().slice(0, LIMITS.itemText);
      if (!text) continue;
      out.push({
        origin: "room",
        dedupeKey: itemDedupeKey("room", String(a.entryId)),
        text,
        originNote: null,
        doneOn: dayIn(new Date(at), timeZone),
        roleId: a.roleId && heldRoleIds.includes(a.roleId) ? a.roleId : null,
        seasonGoalId: null,
        state: "kept",
        taskStatus: "done",
      });
    }
  }
  return out;
}

// ── The frame: everything one member's moon is read against ─────────────────

export interface FrameDeps {
  timeZone: string;
  /** The season document's seasons, each with its goals (`seasonState().seasons`). */
  seasons: ReadonlyArray<{ id: string; startsOn?: string; endsOn?: string; goals?: ReadonlyArray<{ id: string; text: string }> }>;
}

export interface Frame {
  roles: RoleHeld[];
  seatings: AssignmentRow[];
  terms: TermsInForce[];
  seasonId: string | null;
  seasonGoals: SeasonGoalRef[];
  ownGoals: string[];
}

/** The season running on a day: the latest that has begun and not ended. */
export function seasonOn<T extends { startsOn?: string; endsOn?: string }>(seasons: readonly T[], day: string): T | null {
  const running = seasons
    .filter((s) => s.startsOn && s.startsOn <= day && (!s.endsOn || day < s.endsOn))
    .sort((a, b) => String(a.startsOn).localeCompare(String(b.startsOn)));
  return running[running.length - 1] ?? null;
}

export async function loadFrame(pool: Pool, userId: string, moon: Moon, deps: FrameDeps): Promise<Frame> {
  const seatings = (await gatherStore.seatingsOfMember(pool, userId)).map((s) => assignmentOf(s, deps.timeZone));
  const held = seatings.filter((a) => heldDuring(a, moon.days));
  const cards = await gatherStore.roleCardsFor(pool, Array.from(new Set(held.map((a) => a.roleId))));
  const appIds = Array.from(new Set(held.map((a) => a.applicationId).filter((x): x is string => !!x)));
  const apps = await readApplications(pool, appIds);
  const roles = rolesHeldFrom(held, cards, (id) => apps.find((a) => a.id === id)?.deliverables ?? null, moon.days);

  // Terms IN FORCE only: an alignment in force, or an adopted application
  // written before alignments existed.
  const terms = await heldTermsFor(pool, held.map((a) => ({ applicationId: a.applicationId ?? undefined })), { timezone: deps.timeZone, nameOf: () => "" });
  const inForce = new Set(
    apps.filter((a) => {
      const t = terms.get(a.id);
      return t?.alignment ? t.alignment.state === "in-force" : a.status === "adopted";
    }).map((a) => a.id),
  );

  const season = seasonOn(deps.seasons, moon.days.lastDay);
  const seasonGoals = (season?.goals ?? []).map((g) => ({ id: g.id, words: g.text }));
  let ownGoals: string[] = [];
  if (season) {
    const filed = (await planVersions(pool, userId, season.id)).filter((p) => p.filedAt);
    const newest = filed[filed.length - 1];
    ownGoals = (newest?.seasonalGoals ?? []).map((g) => String(g.title ?? "").trim()).filter(Boolean);
  }
  return {
    roles,
    seatings: held,
    terms: termsFrom(held, roles, apps, inForce, moon.days),
    seasonId: season?.id ?? null,
    seasonGoals,
    ownGoals,
  };
}

// ── Gather ───────────────────────────────────────────────────────────────────

export interface GatherDeps extends FrameDeps {
  /** The member's accepted room tasks (`accomplishmentsOf`, read as the owner). */
  accomplishments(userId: string): Promise<AccomplishmentMoon[]>;
}

/**
 * Bring in the moon's work. Idempotent: an item's dedupe key is unique per
 * recap, so a second gather adds nothing, and a key another of the member's
 * recaps already holds is skipped, so one piece of work is never in two.
 */
export async function gatherMoon(pool: Pool, userId: string, moon: Moon, frame: Frame, deps: GatherDeps): Promise<{ recap: store.RecapRow; added: number }> {
  const recap = await store.ensureRecap(pool, { id: newId("mr"), userId, cycleId: moon.bounds.id, seasonId: frame.seasonId });
  if (!recapEditable(recap.status)) return { recap, added: 0 };
  const heldRoleIds = frame.roles.map((r) => r.roleId);
  const tasks = await gatherStore.boardTasksCreatedIn(pool, userId, moon.days.firstDay, moon.days.lastDay);
  const presses = await gatherStore.pressesFor(pool, userId, tasks.map((t) => t.id));
  const candidates = [
    ...boardCandidates(tasks, presses, moon.days, moon.timeZone, heldRoleIds),
    ...roomCandidates(await deps.accomplishments(userId), moon.bounds, moon.timeZone, heldRoleIds),
  ];
  const elsewhere = await store.keysInOtherRecaps(pool, userId, recap.id, candidates.map((c) => c.dedupeKey));
  let position = await store.itemCount(pool, recap.id);
  let added = 0;
  for (const c of candidates) {
    if (elsewhere.has(c.dedupeKey)) continue;
    if (position >= LIMITS.items) break;
    const wrote = await store.insertItem(pool, {
      id: newId("mi"), recapId: recap.id, origin: c.origin, dedupeKey: c.dedupeKey, text: c.text, originNote: c.originNote,
      doneOn: c.doneOn, evidenceUrl: null, roleId: c.roleId, seasonGoalId: c.seasonGoalId, state: c.state, visibility: "members", position,
    });
    if (wrote) {
      added += 1;
      position += 1;
    }
  }
  return { recap, added };
}

// ── Views ────────────────────────────────────────────────────────────────────

function seraStateOf(raw: string | null): SeraState {
  const idle: SeraState = { state: "idle", added: 0, startedAt: null, finishedAt: null, line: null };
  if (!raw) return idle;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? { ...idle, ...v } : idle;
  } catch {
    return idle;
  }
}

function auditOf(raw: string | null): RoleAudit {
  try {
    const v = raw ? JSON.parse(raw) : null;
    return v && Array.isArray(v.roles) && Array.isArray(v.newRoles) ? (v as RoleAudit) : { roles: [], newRoles: [] };
  } catch {
    return { roles: [], newRoles: [] };
  }
}

export function recapView(r: store.RecapRow, hasInvoice: boolean, timeZone: string): RecapView {
  const stage = waitingStage({ status: r.status, workApprovedAt: r.workApprovedAt, hasInvoice, financeApprovedAt: r.financeApprovedAt });
  const opened = stage === "work" ? dayIn(r.sentAt, timeZone) : stage === "invoice" ? dayIn(r.workApprovedAt, timeZone) : null;
  const dueOn = opened ? (stage === "work" ? workDueOn(opened) : invoiceDueOn(opened)) : null;
  return {
    id: r.id,
    cycleId: r.cycleId,
    seasonId: r.seasonId,
    status: r.status,
    statusLine: stage ? waitingLine(stage, dueOn) : RECAP_STATUS_WORDS[r.status],
    round: r.round,
    ownWords: r.ownWords,
    roleAudit: auditOf(r.roleAuditJson),
    sentAt: r.sentAt,
    waitingOn: stage,
    dueOn,
    workApprovedAt: r.workApprovedAt,
    financeApprovedAt: r.financeApprovedAt,
    returnedNote: r.returnedNote,
    sera: seraStateOf(r.seraState),
  };
}

export async function payersDoc(pool: Pool): Promise<PayersDoc> {
  const doc = dbDocument(pool, PAYERS_DOC_KEY, EMPTY_PAYERS as unknown as Record<string, unknown>);
  await doc.load();
  const parsed = parsePayers(doc.exists() ? doc.get() : null);
  return parsed.ok ? parsed.value : EMPTY_PAYERS;
}

function fromOf(raw: string | null): FromBlock | null {
  try {
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v.legalName === "string" ? { legalName: v.legalName, address: String(v.address ?? "") } : null;
  } catch {
    return null;
  }
}

/**
 * The invoice as the member reads it: the sent one when there is one, else the
 * draft drawn from the terms in force. `sendRefusal` names only what stands in
 * the way before the send form: the attestation, the pilot note and the
 * invoice number are typed at send and are not counted against a draft.
 */
export function invoiceViewOf(input: {
  stored: store.InvoiceRow | null;
  terms: readonly TermsInForce[];
  moon: Moon;
  route: PayRouteRecord | null;
  payers: PayersDoc;
  today: string;
}): InvoiceView | null {
  const { stored, moon, payers, today } = input;
  const period = moon.ref.periodWords;
  if (stored) {
    let lines: InvoiceLine[] = [];
    try {
      lines = JSON.parse(stored.linesJson) as InvoiceLine[];
    } catch {
      lines = [];
    }
    const payer = payers.payers.find((p) => p.key === stored.payerKey) ?? null;
    return {
      id: stored.id, status: stored.status, statusLine: invoiceStatusLine({ status: stored.status, expectedOn: stored.expectedOn, paidOn: stored.paidOn }, today),
      memberNumber: stored.memberNumber, billRef: billRef(stored.payerKey, stored.billRefSeq), billTo: payer ? billToOf(payer) : null,
      from: fromOf(stored.fromJson), period, lines, currency: stored.currency, totalMinor: stored.totalMinor, expectedOn: stored.expectedOn,
      paidOn: stored.paidOn, selfApproved: stored.selfApproved, supportLine: SUPPORT_LINE, externalInvoiceKey: stored.externalInvoiceKey,
      // TODO(lane B, by Tuesday): the work summary once both approvals are in.
      workSummary: null, workSummaryHtml: null, sendRefusal: null,
    };
  }
  if (!termsCarryMoney(input.terms)) return null;
  const lines = linesFromTerms(input.terms, moon.days);
  const route = input.route;
  const payer = route ? payerForRoute(payers, route.route, route.payerKey) : null;
  const totals = invoiceTotals(lines);
  const refusal = invoiceSendRefusal({
    route: route?.route ?? "pending", payer, lines, attestation: null, pilotAckVersion: route?.pilotAckVersion ?? null, memberNumber: null, externalInvoiceKey: null,
  });
  return {
    id: null, status: "draft", statusLine: RECAP_STATUS_WORDS.draft, memberNumber: null, billRef: null, billTo: payer ? billToOf(payer) : null,
    from: route?.legalName ? { legalName: route.legalName, address: route.address ?? "" } : null, period, lines,
    currency: totals.length === 1 ? totals[0].currency : null, totalMinor: totals.length === 1 ? totals[0].minor : null,
    expectedOn: null, paidOn: null, selfApproved: false, supportLine: SUPPORT_LINE, externalInvoiceKey: null, workSummary: null, workSummaryHtml: null,
    sendRefusal: refusal === ATTESTATION_MISSING ? null : refusal,
  };
}

export interface MyMoonDeps extends FrameDeps {
  clock: CycleClock;
  /** Live holders of `cash.pay`, admins left out, named on the page. */
  cashPayHolderNames(): Promise<string[]>;
  now?: Date;
}

export async function myMoon(pool: Pool, userId: string, moon: Moon, deps: MyMoonDeps): Promise<MyMoonResponse> {
  const frame = await loadFrame(pool, userId, moon, deps);
  const recap = await store.recapFor(pool, userId, moon.bounds.id);
  const items = recap ? await store.itemsOf(pool, recap.id) : [];
  const stored = recap ? await store.invoiceForRecap(pool, recap.id) : null;
  const route = await store.payRouteOf(pool, userId);
  const payers = await payersDoc(pool);
  const today = civilDateKey(deps.now ?? new Date(), deps.timeZone);
  const invoiceNeeded = termsCarryMoney(frame.terms);

  const recaps = await store.recapsOf(pool, userId);
  const moons: MyMoonResponse["moons"] = [];
  const seen = new Set<string>();
  for (const id of [deps.clock.boundsFor(deps.now ?? new Date()).id, ...recaps.map((r) => r.cycleId)]) {
    if (seen.has(id)) continue;
    seen.add(id);
    const b = boundsForCycleId(deps.clock, id);
    if (!b) continue;
    const d = moonDays(b, deps.timeZone);
    const r = recaps.find((x) => x.cycleId === id) ?? null;
    moons.push({ cycleId: id, periodWords: periodWords(d.firstDay, d.lastDay), status: r?.status ?? null, statusWords: r ? RECAP_STATUS_WORDS[r.status] : RECAP_STATUS_WORDS.draft });
  }

  return {
    moon: moon.ref,
    moons,
    recap: recap ? recapView(recap, !!stored, deps.timeZone) : null,
    items,
    roles: frame.roles,
    coverage: coverage({ roles: frame.roles, items, seasonGoals: frame.seasonGoals, ownGoals: frame.ownGoals }),
    seasonGoals: frame.seasonGoals,
    ownGoals: frame.ownGoals,
    moonLoad: (await moonLoadOf(pool, userId, moon.bounds.id))?.level ?? null,
    invoiceNeeded,
    noTermsLine: !invoiceNeeded && frame.roles.length > 0 ? NO_TERMS : null,
    invoice: invoiceViewOf({ stored, terms: frame.terms, moon, route, payers, today }),
    payRoute: route,
    routeChoices: PAY_ROUTES.map((r) => ({ route: r, words: payRouteWords(r, payers.hostCountryName) })),
    pilotAck: { version: PILOT_ACK_VERSION, text: PILOT_ACK_TEXT, acceptedVersion: route?.pilotAckVersion ?? null },
    cashPayHolders: await deps.cashPayHolderNames(),
  };
}

/**
 * ANOTHER MEMBER'S READING of a sent recap, through the contract's
 * `memberView`: kept items marked Members, grouped by role, a count of the
 * Approvers only ones, and a room item only where `canSeeTask` passes for
 * this reader (`visibleRoomEntries` is `accomplishmentsOf` read AS the reader).
 *
 * TODO(lane A, A1): once `moon_recap_items.evidence_kind` exists, drop
 * `evidenceUrl` for kinds mail, notes, drive and file here (check 26).
 */
export async function memberMoon(
  pool: Pool,
  ownerId: string,
  moon: Moon,
  deps: FrameDeps & { visibleRoomEntries(): Promise<Set<number>> },
): Promise<MemberMoonResponse> {
  const recap = await store.recapFor(pool, ownerId, moon.bounds.id);
  if (!recap || recap.status === "draft") return { moon: moon.ref, roles: [] };
  const frame = await loadFrame(pool, ownerId, moon, deps);
  const items = await store.itemsOf(pool, recap.id);
  const entryOf = await gatherStore.roomEntryIdsOfRecap(pool, recap.id);
  const visible = entryOf.size > 0 ? await deps.visibleRoomEntries() : new Set<number>();
  return {
    moon: moon.ref,
    roles: memberView({
      status: recap.status,
      roles: frame.roles.map((r) => ({ roleId: r.roleId, name: r.name })),
      items,
      roomVisible: (i: RecapItem) => {
        const entry = entryOf.get(i.id);
        return entry !== undefined && visible.has(entry);
      },
    }),
  };
}

// ── Writes ───────────────────────────────────────────────────────────────────

export type Outcome<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const refuse = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

/** A member adds an item by hand while the recap is theirs to edit. */
export async function addItem(pool: Pool, userId: string, moon: Moon, frame: Frame, body: unknown): Promise<Outcome<ItemResponse>> {
  const parsed = parseItemFields(body);
  if (!parsed.ok) return refuse(400, parsed.error);
  const f = parsed.value;
  if (!f.text) return refuse(400, ITEM_TEXT_EMPTY);
  if (f.roleId && !frame.roles.some((r) => r.roleId === f.roleId)) return refuse(400, "role_not_held");
  const recap = await store.ensureRecap(pool, { id: newId("mr"), userId, cycleId: moon.bounds.id, seasonId: frame.seasonId });
  if (!recapEditable(recap.status)) return refuse(409, "not_editable");
  const position = await store.itemCount(pool, recap.id);
  if (position >= LIMITS.items) return refuse(409, "too_many_items");
  const id = newId("mi");
  await store.insertItem(pool, {
    id, recapId: recap.id, origin: "hand", dedupeKey: itemDedupeKey("hand", id), text: f.text, originNote: null, doneOn: null,
    evidenceUrl: f.evidenceUrl ?? null, roleId: f.roleId ?? null, seasonGoalId: f.seasonGoalId ?? null, state: f.state ?? "kept",
    visibility: f.visibility ?? "members", position,
  });
  const { evidenceAsset, proofInSummary, accountabilityWords, ownGoalWords } = f;
  await store.updateItem(pool, id, { evidenceAsset, proofInSummary, accountabilityWords, ownGoalWords });
  const cleared = await store.clearApprovals(pool, recap.id);
  const item = await store.itemById(pool, id);
  if (!item) throw new Error("moon recap: an item just written could not be read back");
  const { recapId: _r, ...out } = item;
  return { ok: true, value: { item: out, approvalsCleared: cleared > 0 } };
}

/** A member edits one of their own items while the recap is theirs to edit. Any edit clears both approvals. */
export async function editItem(pool: Pool, userId: string, itemId: string, body: unknown, heldRoleIdsOf: (cycleId: string) => Promise<string[]>): Promise<Outcome<ItemResponse>> {
  const item = await store.itemById(pool, itemId);
  const recap = item ? await store.recapById(pool, item.recapId) : null;
  if (!item || !recap || recap.userId !== userId) return refuse(404, "not_found");
  if (!recapEditable(recap.status)) return refuse(409, "not_editable");
  const parsed = parseItemFields(body);
  if (!parsed.ok) return refuse(400, parsed.error);
  if (parsed.value.roleId && !(await heldRoleIdsOf(recap.cycleId)).includes(parsed.value.roleId)) return refuse(400, "role_not_held");
  await store.updateItem(pool, itemId, parsed.value);
  const cleared = await store.clearApprovals(pool, recap.id);
  const after = await store.itemById(pool, itemId);
  if (!after) return refuse(404, "not_found");
  const { recapId: _r, ...out } = after;
  return { ok: true, value: { item: out, approvalsCleared: cleared > 0 } };
}

export interface SendDeps {
  tensionDeps: TensionDeps;
  recordEvent(e: { kind: string; text: string; actorUserId: string; entityType: string; entityRef: string; audience: "admin" }): Promise<void>;
}

/**
 * SEND MY RECAP. Needs no pay route. Saves the member's own words and role
 * audit, locks the recap at Waiting on approval, writes a review event and a
 * health event, and on the first send raises each Expand, Contract or Hand
 * back as a tension with that role.
 *
 * TODO(lane B): a new role the audit names belongs in the core circle's
 * backlog, and no function in server/lib/roleTensions.ts takes a tension with
 * no role. Until one exists, new roles are stored in the audit and not raised.
 * TODO(lane A): notices to the work approvers need a notification kind in
 * shared/notificationKinds.ts; none is sent until it exists.
 */
export async function sendRecap(pool: Pool, userId: string, moon: Moon, frame: Frame, body: unknown, deps: SendDeps): Promise<Outcome<SendRecapResponse>> {
  if (frame.roles.length === 0) return refuse(409, MOON_WORDS.noRecapRoles);
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const words = typeof b.ownWords === "string" ? b.ownWords.replace(/\s+/g, " ").trim() : "";
  if (words.length > LIMITS.ownWords) return refuse(400, `In my own words runs to ${LIMITS.ownWords} characters at most.`);
  const audit = parseRoleAudit(b.roleAudit, frame.roles.map((r) => r.roleId));
  if (!audit.ok) return refuse(400, audit.error);

  const recap = await store.ensureRecap(pool, { id: newId("mr"), userId, cycleId: moon.bounds.id, seasonId: frame.seasonId });
  if (!recapEditable(recap.status)) return refuse(409, "not_editable");
  await store.saveRecapWords(pool, recap.id, words || null, JSON.stringify(audit.value));
  if (recap.status === "returned") await store.resetItemReviews(pool, recap.id);
  if ((await store.markRecapSent(pool, recap.id, recap.round)) === 0) return refuse(409, "not_editable");
  await store.insertReviewEvent(pool, {
    recapId: recap.id, invoiceId: null, userId, kind: "sent", actorUserId: userId, actorRole: null, amountMinor: null, currency: null, hash: null, note: null,
  });
  await deps.recordEvent({ kind: "audit", text: `moon:recap-sent:${recap.id}`, actorUserId: userId, entityType: "moon_recap", entityRef: recap.id, audience: "admin" });

  let tensionsRaised = 0;
  if (recap.round === 0) {
    for (const t of auditTensions(audit.value)) {
      if (!t.roleId) continue;
      const text = (t.note ? `${t.title}: ${t.note}` : t.title).slice(0, 600);
      const out = await raiseTension(pool, { userId }, t.roleId, { text }, deps.tensionDeps).catch(() => null);
      if (out?.ok) tensionsRaised += 1;
    }
  }
  const after = await store.recapById(pool, recap.id);
  if (!after) throw new Error("moon recap: a recap just sent could not be read back");
  return { ok: true, value: { recap: recapView(after, !!(await store.invoiceForRecap(pool, after.id)), moon.timeZone), tensionsRaised } };
}

/** TAKE BACK: Waiting back to Draft, both approvals cleared, and a waiting invoice back to Draft with it. */
export async function takeBack(pool: Pool, userId: string, moon: Moon, deps: Pick<SendDeps, "recordEvent">, invoiceView: (stored: store.InvoiceRow | null) => InvoiceView | null): Promise<Outcome<TakeBackResponse>> {
  const recap = await store.recapFor(pool, userId, moon.bounds.id);
  if (!recap) return refuse(404, "not_found");
  if ((await store.takeBackRecap(pool, recap.id)) === 0) return refuse(409, "not_waiting");
  const inv = await store.invoiceForRecap(pool, recap.id);
  if (inv) await store.setInvoiceStatus(pool, inv.id, ["waiting", "returned"], "draft");
  await store.insertReviewEvent(pool, {
    recapId: recap.id, invoiceId: inv?.id ?? null, userId, kind: "taken_back", actorUserId: userId, actorRole: null, amountMinor: null, currency: null, hash: null, note: null,
  });
  await deps.recordEvent({ kind: "audit", text: `moon:recap-taken-back:${recap.id}`, actorUserId: userId, entityType: "moon_recap", entityRef: recap.id, audience: "admin" });
  const after = await store.recapById(pool, recap.id);
  const invAfter = await store.invoiceForRecap(pool, recap.id);
  return { ok: true, value: { recap: recapView(after ?? recap, !!invAfter, moon.timeZone), invoice: invoiceView(invAfter) } };
}

// ── The pay route ────────────────────────────────────────────────────────────

export async function payRouteResponse(pool: Pool, userId: string, cashPayHolders: string[]): Promise<PayRouteResponse> {
  const route = await store.payRouteOf(pool, userId);
  const payers = await payersDoc(pool);
  const payer = route ? payerForRoute(payers, route.route, route.payerKey) : null;
  return {
    payRoute: route,
    billTo: payer ? billToOf(payer) : null,
    routeChoices: PAY_ROUTES.map((r) => ({ route: r, words: payRouteWords(r, payers.hostCountryName) })),
    cashPayHolders,
  };
}

/** The member's own route. A change to a confirmed field clears the confirmation; the pilot note rides along. */
export async function putPayRoute(pool: Pool, userId: string, body: unknown): Promise<Outcome<null>> {
  const parsed = parsePayRouteInput(body);
  if (!parsed.ok) return refuse(400, parsed.error);
  const next = parsed.value;
  if (next.payerKey && !(await payersDoc(pool)).payers.some((p) => p.key === next.payerKey)) return refuse(400, "Choose one of the payers listed.");
  const before = await store.payRouteOf(pool, userId);
  const clear = routeChangeClearsConfirmation(before, next);
  await store.upsertPayRoute(pool, userId, next, clear);
  const ack = (body as Record<string, unknown>).pilotAckVersion;
  if (ack === PILOT_ACK_VERSION) await store.setPilotAck(pool, userId, PILOT_ACK_VERSION);
  if (clear) {
    await store.insertReviewEvent(pool, {
      recapId: null, invoiceId: null, userId, kind: "route_changed", actorUserId: userId, actorRole: null, amountMinor: null, currency: null, hash: null, note: null,
    });
  }
  return { ok: true, value: null };
}
