/**
 * THE END-OF-MOON REVIEW: the invoice, the import and the approvers' side
 * (module moon-review, lane B).
 *
 * The contract is shared/moonRecap.ts and every rule below is one of its
 * functions: `invoiceSendRefusal`, `approvalDecision`, `financeApprovalRefusal`,
 * `validatePack`, `memberView`. This file reads the store, runs the rule and
 * writes what the rule allowed. The SQL is server/repos/moonRecaps.ts and
 * server/repos/moonGather.ts.
 *
 *   sendInvoice        POST /api/me/moon/:cycle/send-invoice (decisions 16 revised, 21, 22)
 *   importPack         POST /api/me/moon/:cycle/import, preview then confirm (A2)
 *   reviewQueue        GET  /api/moon-review/queue
 *   reviewWork         POST /api/moon-review/:recap/work
 *   returnToMember     POST /api/moon-review/:recap/return
 *   approveInvoices    POST /api/moon-review/invoices/approve, in bulk
 *   setRange, voidOne  POST /api/moon-review/invoices/:id/range and /void
 *   confirmRoute       PUT  /api/moon-review/pay-routes/:user/confirm
 *   roomPanel          GET  /api/moon-review/rooms/:sessionId
 *   settlePaidInvoices the existing `/api/cash-owed/transfers` door, once a transfer pays
 *
 * ── WHO MAY APPROVE ───────────────────────────────────────────────────────
 *
 * The door asks the one gate (`mayAct`) only whether this person may open the
 * review at all. WHO MAY GIVE AN APPROVAL is `approvalDecision`, fed with the
 * person's keys read from the live holders of each key (`liveHoldersOf`,
 * which counts seats and never the admin short-circuit). So an admin, or a
 * break-glass, who holds no seat carrying the key is refused here by the
 * contract's own sentence, however the door let them in.
 *
 * ── AMOUNTS ───────────────────────────────────────────────────────────────
 *
 * The queue carries an invoice only for a reader the gate passes on
 * `cash.pay`. The room panel has no field that can hold an amount.
 */
import crypto from "node:crypto";
import type { Pool, PoolConnection } from "mysql2/promise";
import {
  APPROVAL_REFUSALS, APPROVE_ALONE_CAPABILITY, APPROVE_OWN_CAPABILITY, CONFIRM_OWN_ROUTE_REFUSED, INVOICE_APPROVE_CAPABILITY,
  LIMITS, NOTICE_WORDS, PAYMENT_DETAILS_REFUSED, RECAP_ID, RECAP_STATUS_WORDS, SELF_APPROVED_WORDS, WORK_APPROVE_CAPABILITY,
  approvalDecision, approvalHash, goalScoreProblem, invoicePaidFrom, parseMoonGoals, rowExistsRefusal, authorityNote, carriedTooOften, confirmRouteRefusal, coverage, eligibleApprovers,
  financeApprovalRefusal, goalScore, invoiceSendRefusal, invoiceTotals, isPayableLine, linesFromTerms, memberView, packMoonDates,
  parseAttestation, payerForRoute, rangeChangedNote, readingOf, recapEditable, recapStatusAfterWork, reviewDedupeKey,
  scoreContextOf, seatCoverage, seatReadingOf, taskScore, termsCarryMoney, validatePack, waitingStage,
  type ApprovalStage, type ApprovalSubject, type ApproverKeys, type ApproverPool, type BulkApproveResponse, type FromBlock,
  type ImportPackResponse, type InvoiceLine, type PayRouteRecord, type InvoiceView, type MoonAttestation, type QueueResponse, type QueueRow,
  type RecapItem, type ReviewEventKind, type RoleAudit, type RoomResponse, type SendInvoiceResponse,
} from "../../shared/moonRecap";
import { looksLikePaymentDetails, moneyWords } from "../../shared/seatSettings";
import { civilDateKey } from "../../shared/lunar";
import { readStick } from "../../shared/sessionTemplates";
import * as store from "../repos/moonRecaps";
import * as gatherStore from "../repos/moonGather";
import { cashOwedRowsByIds } from "../repos/cashOwed";
import { memberUserIdRows, personRow, memberNoRows } from "../repos/liveSessions";
import { useRow } from "../repos/sessionTemplates";
import { oweApprovedRoleCash } from "./cashOwed";
import {
  invoiceViewOf, linesOf, loadFrame, payersDoc, recapView, settingsDoc, summaryFor, type Frame, type FrameDeps, type Moon, type Outcome,
} from "./moonRecap";

const newId = (prefix: string): string => `${prefix}-${crypto.randomBytes(8).toString("hex")}`;
const refuse = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });
const dayIn = (iso: string | null, tz: string): string | null => (iso ? civilDateKey(new Date(iso), tz) : null);

/** Who holds a key through a live seat, admins left out (`liveHoldersOf`, server/index.ts). */
export type KeyHolders = (capability: string) => Promise<string[]>;

export interface Notice {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  actorUserId?: string | null;
  dedupeKey: string;
}

export interface ReviewDeps {
  keyHolders: KeyHolders;
  notify(n: Notice): Promise<unknown>;
  recordEvent(e: { kind: string; text: string; actorUserId: string; entityType: string; entityRef: string; audience: "admin" }): Promise<unknown>;
  nameOf(userId: string): Promise<string>;
}

/** The notice kind every moon review notice carries (shared/notificationKinds.ts). */
export const MOON_NOTICE = "moon_review";
const MY_MOON_LINK = "/profile#my-moon";

// ── Keys and the approval subject ────────────────────────────────────────────

/** Every live holder of the four keys `approvalDecision` reads. Never an admin who holds no seat. */
export async function approverPool(keyHolders: KeyHolders): Promise<ApproverPool> {
  const [approve, pay, alone, own] = await Promise.all([
    keyHolders(WORK_APPROVE_CAPABILITY), keyHolders(INVOICE_APPROVE_CAPABILITY), keyHolders(APPROVE_ALONE_CAPABILITY), keyHolders(APPROVE_OWN_CAPABILITY),
  ]);
  return { approve, pay, alone, own };
}

export function keysOf(userId: string, pool: ApproverPool): ApproverKeys {
  return { userId, approve: pool.approve.includes(userId), pay: pool.pay.includes(userId), alone: pool.alone.includes(userId), own: pool.own.includes(userId) };
}

function fromOf(raw: string | null): FromBlock | null {
  try {
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v.legalName === "string" ? { legalName: v.legalName, address: String(v.address ?? "") } : null;
  } catch {
    return null;
  }
}

/** What an approval binds to: payer, route, lines, currency, From and the kept items not returned. */
export function subjectOf(invoice: store.InvoiceRow | null, route: Pick<PayRouteRecord, "route"> | null, items: readonly RecapItem[]): ApprovalSubject {
  return {
    payerKey: invoice?.payerKey ?? null,
    route: invoice ? route?.route ?? null : null,
    currency: invoice?.currency ?? null,
    from: invoice ? fromOf(invoice.fromJson) : null,
    lines: invoice ? linesOf(invoice) : [],
    items: items.filter((i) => i.state === "kept" && i.review !== "returned"),
  };
}

/** The approval hash of a recap as it stands now. */
export async function currentHash(pool: Pool | PoolConnection, recap: store.RecapRow): Promise<string> {
  const [items, invoice, route] = await Promise.all([store.itemsOf(pool, recap.id), store.invoiceForRecap(pool, recap.id), store.payRouteOf(pool, recap.userId)]);
  return approvalHash(subjectOf(invoice, route, items));
}

async function event(db: Pool | PoolConnection, e: Partial<store.ReviewEventInsert> & { kind: ReviewEventKind; recapId: string | null; userId: string | null; actorUserId: string | null }): Promise<void> {
  await store.insertReviewEvent(db, {
    recapId: e.recapId, invoiceId: e.invoiceId ?? null, userId: e.userId, kind: e.kind, actorUserId: e.actorUserId, actorRole: e.actorRole ?? null,
    amountMinor: e.amountMinor ?? null, currency: e.currency ?? null, hash: e.hash ?? null, note: e.note ?? null, selfApproved: e.selfApproved,
  });
}

async function tell(deps: Pick<ReviewDeps, "notify">, n: { userId: string; title: string; kind: string; recapId: string; round: number; actorUserId?: string | null; body?: string | null }): Promise<void> {
  await deps.notify({
    userId: n.userId, type: MOON_NOTICE, title: n.title, body: n.body ?? null, link: MY_MOON_LINK, actorUserId: n.actorUserId ?? null,
    dedupeKey: reviewDedupeKey(n.kind, n.recapId, n.round, n.userId),
  }).catch(() => undefined);
}

// ── Send the draft invoice (decisions 16 revised, 21, 22) ────────────────────

/**
 * SEND THE DRAFT INVOICE FOR APPROVAL. The member's own invoice is the legal
 * one, so this needs its number, and on the contractor route its electronic
 * key. Every refusal is the contract's sentence (`invoiceSendRefusal`): an
 * empty payers document or empty settings refuse first, with
 * `SEND_REFUSALS.notConfigured`. The recap needs no route; only this does.
 *
 * The invoice is written inside one transaction that reads the payer's next
 * bill ref under a lock. A resend after a take-back or a return updates the
 * same row; a resend after Finance voided it for a new range writes the next
 * revision, which carries Finance's figure and needs a new number.
 *
 * An invoice sent after the work was approved clears that approval: the
 * approval was bound to a recap with no invoice in it.
 */
export async function sendInvoice(pool: Pool, userId: string, moon: Moon, frame: Frame, body: unknown, deps: Pick<ReviewDeps, "notify" | "keyHolders">): Promise<Outcome<SendInvoiceResponse>> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const [payers, settings, route] = await Promise.all([payersDoc(pool), settingsDoc(pool), store.payRouteOf(pool, userId)]);
  const recap = await store.recapFor(pool, userId, moon.bounds.id);
  if (!recap) return refuse(409, "send_recap_first");
  if (recap.financeApprovedAt || (recap.status === "approved" && !recap.workApprovedAt)) return refuse(409, "not_editable");

  const history = await store.invoiceHistory(pool, recap.id);
  const live = history.filter((i) => i.status !== "void").pop() ?? null;
  if (live && (live.status === "waiting" || live.status === "approved" || live.status === "paid")) return refuse(409, "already_sent");
  // Finance's figures from the newest void revision: a range it set stays set.
  const lastVoid = history.filter((i) => i.status === "void").pop() ?? null;
  const finals: Record<string, number> = {};
  for (const l of lastVoid ? linesOf(lastVoid) : []) if (l.finalMinor !== null && l.basis === "range") finals[l.applicationId] = l.finalMinor;
  const proposals: Record<string, number> = {};
  if (b.rangeProposals && typeof b.rangeProposals === "object") {
    for (const [k, v] of Object.entries(b.rangeProposals as Record<string, unknown>)) if (Number.isInteger(v)) proposals[k] = v as number;
  }
  const lines = linesFromTerms(frame.terms, moon.days, proposals, finals);
  const routeKind = route?.route ?? "pending";
  const payer = route ? payerForRoute(payers, route.route, route.payerKey) : null;
  const attestation = b.attestation === undefined || b.attestation === null ? null : parseAttestation(b.attestation, routeKind, moon.days);
  const memberNumber = typeof b.memberNumber === "string" ? b.memberNumber.trim() : null;
  const externalInvoiceKey = typeof b.externalInvoiceKey === "string" && b.externalInvoiceKey.trim() ? b.externalInvoiceKey.trim() : null;
  const pilotAckVersion = typeof b.pilotAckVersion === "string" ? b.pilotAckVersion : null;
  const used = (await store.memberNumbersOf(pool, userId)).filter((n) => !live || n !== live.memberNumber);

  const refusal = invoiceSendRefusal({ route: routeKind, payer, lines, attestation, pilotAckVersion, settings, payers, memberNumber, externalInvoiceKey, usedNumbers: used });
  if (refusal) return refuse(400, refusal);
  if (!route?.legalName) return refuse(400, "Fill in your legal name and address on your pay route before you send an invoice.");
  if (looksLikePaymentDetails(memberNumber as string)) return refuse(400, PAYMENT_DETAILS_REFUSED);

  const totals = invoiceTotals(lines);
  const from: FromBlock = { legalName: route.legalName, address: route.address ?? "" };
  const att = (attestation as { ok: true; value: MoonAttestation }).value;
  const conn = await pool.getConnection();
  let invoiceId: string;
  try {
    await conn.beginTransaction();
    if (live) {
      invoiceId = live.id;
      const n = await store.resendInvoice(conn, live.id, {
        currency: totals[0].currency, totalMinor: totals[0].minor, linesJson: JSON.stringify(lines), fromJson: JSON.stringify(from),
        attestationJson: JSON.stringify(att), memberNumber: memberNumber as string, externalInvoiceKey: routeKind === "local_contractor" ? externalInvoiceKey : null,
      });
      if (n === 0) throw new Error("raced");
    } else {
      invoiceId = newId("mv");
      const payerKey = (payer as NonNullable<typeof payer>).key;
      await store.insertInvoice(conn, {
        id: invoiceId, recapId: recap.id, userId, cycleId: moon.bounds.id, payerKey,
        revision: await store.nextInvoiceRevision(conn, userId, moon.bounds.id, payerKey),
        billRefSeq: await store.nextBillRefSeq(conn, payerKey), memberNumber: memberNumber as string,
        currency: totals[0].currency, totalMinor: totals[0].minor, linesJson: JSON.stringify(lines), fromJson: JSON.stringify(from),
        attestationJson: JSON.stringify(att), externalInvoiceKey: routeKind === "local_contractor" ? externalInvoiceKey : null, voidOf: lastVoid?.id ?? null,
      });
    }
    if (pilotAckVersion && route.pilotAckVersion !== pilotAckVersion) await store.setPilotAck(conn, userId, pilotAckVersion);
    // Approved work was bound to a recap with no invoice: it is read again.
    if (recap.workApprovedAt) await store.clearApprovals(conn, recap.id);
    await event(conn, { kind: "invoice_sent", recapId: recap.id, invoiceId, userId, actorUserId: userId, amountMinor: totals[0].minor, currency: totals[0].currency });
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => undefined);
    if (e instanceof Error && e.message === "raced") return refuse(409, "already_sent");
    if ((e as { code?: string })?.code === "ER_DUP_ENTRY") return refuse(409, "already_sent");
    throw e;
  } finally {
    conn.release();
  }
  const stored = await store.invoiceById(pool, invoiceId);
  const view = invoiceViewOf({ stored, terms: frame.terms, moon, route: await store.payRouteOf(pool, userId), payers, settings, today: civilDateKey(new Date(), moon.timeZone) });
  return { ok: true, value: { invoice: view as InvoiceView } };
}

// ── The moon pack (A2) ───────────────────────────────────────────────────────

export interface ImportDeps {
  /** The next moon's cycle id, where the pack's next goals go. */
  nextCycleId: string;
  /** The directory, for a thanked name. */
  members?: () => Promise<Array<{ userId: string; name: string }>>;
}

/**
 * IMPORT A MOON PACK, in two calls (A2). The first answers the preview and
 * its hash and writes nothing. The second writes, and only when its
 * `previewHash` is the one the first call answered for the same pack against
 * the same recap: a recap that moved in between gets a new preview.
 *
 * Imported items arrive kept, pending review, and Approvers only: the member
 * flips one to Members. A pack item naming a Sera task the recap already holds
 * merges into it. Next goals go to the next moon under the limit of five open.
 * The role audit merges by role, and the member's own entries win. Own words
 * and thanks fill only what the member left empty. One `imported` event names
 * the counts and the pack's sha256; the pack itself is never stored.
 */
export async function importPack(pool: Pool, userId: string, moon: Moon, frame: Frame, body: unknown, deps: ImportDeps): Promise<Outcome<ImportPackResponse>> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (b.pack === undefined) return refuse(400, "not_a_pack");
  const existing = await store.recapFor(pool, userId, moon.bounds.id);
  if (existing && !recapEditable(existing.status)) return refuse(409, "not_editable");
  const ctx = {
    moon: packMoonDates(moon.bounds, moon.timeZone),
    seats: frame.roles.map((r) => ({ roleId: r.roleId, name: r.name })),
    allRoles: await gatherStore.allRoleNames(pool),
    seasonGoals: frame.seasonGoals,
    existingKeys: existing ? await store.itemKeysOf(pool, existing.id) : new Map<string, string>(),
    members: deps.members ? await deps.members().catch(() => []) : [],
  };
  const read = await validatePack(b.pack, ctx);
  if (!read.ok) return { ok: false, status: 400, error: read.error };
  if (b.confirm !== true) return { ok: true, value: { written: false, preview: read.preview, previewHash: read.previewHash } };
  if (b.previewHash !== read.previewHash) return refuse(409, "preview_changed");

  const recap = existing ?? (await store.ensureRecap(pool, { id: newId("mr"), userId, cycleId: moon.bounds.id, seasonId: frame.seasonId }));
  if (!recapEditable(recap.status)) return refuse(409, "not_editable");
  let position = await store.itemCount(pool, recap.id);
  let added = 0;
  for (const p of read.preview.add) {
    if (position >= LIMITS.items) break;
    const wrote = await store.insertItem(pool, {
      id: newId("mi"), recapId: recap.id, origin: "claude", dedupeKey: p.dedupeKey, text: p.text,
      originNote: p.evidenceRef ? p.evidenceRef.slice(0, LIMITS.originNote) : null, doneOn: p.evidenceOn, evidenceUrl: p.evidenceUrl,
      roleId: p.roleId, seasonGoalId: p.seasonGoalId, state: "kept", visibility: "approvers", position,
      setOn: p.evidenceOn, taskStatus: p.taskStatus, redirectTo: p.redirectTo, letGoReason: p.letGoReason, evidenceKind: p.evidenceKind,
      evidenceOn: p.evidenceOn, accountabilityWords: p.accountabilityWords, belongsToSeatWords: p.belongsToSeatWords,
    });
    if (wrote) {
      added += 1;
      position += 1;
    }
  }
  let merged = 0;
  for (const m of read.preview.merge) {
    merged += await store.mergePackItem(pool, m.itemId, recap.id, {
      text: m.text, taskStatus: m.taskStatus, redirectTo: m.redirectTo, letGoReason: m.letGoReason, evidenceKind: m.evidenceKind,
      evidenceUrl: m.evidenceUrl, evidenceOn: m.evidenceOn, roleId: m.roleId, seasonGoalId: m.seasonGoalId,
    });
  }

  // The role audit by role, the member's own entries winning; own words only when empty.
  const audit: RoleAudit = (() => {
    try {
      const v = recap.roleAuditJson ? JSON.parse(recap.roleAuditJson) : null;
      return v && Array.isArray(v.roles) && Array.isArray(v.newRoles) ? (v as RoleAudit) : { roles: [], newRoles: [] };
    } catch {
      return { roles: [], newRoles: [] };
    }
  })();
  for (const a of read.preview.roleAudit) {
    if (!audit.roles.some((r) => r.roleId === a.roleId)) audit.roles.push({ roleId: a.roleId, choice: a.verdict, note: a.why });
  }
  await store.saveRecapWords(pool, recap.id, recap.ownWords ?? read.preview.ownWords, JSON.stringify(audit));
  if (!recap.thanksJson && read.preview.thanks.length > 0) await store.saveThanks(pool, recap.id, JSON.stringify(read.preview.thanks));

  const next = await store.goalsFor(pool, userId, deps.nextCycleId);
  let open = next.filter((g) => g.status === "open").length;
  let goalPos = next.reduce((m, g) => Math.max(m, g.position + 1), 0);
  for (const g of read.preview.nextGoals) {
    if (open >= 5) break;
    if (next.some((x) => x.text === g.text)) continue;
    const wrote = await store.insertGoal(pool, {
      id: newId("mg"), userId, cycleId: deps.nextCycleId, position: goalPos, text: g.text, doneWhen: g.doneWhen, seasonGoalId: g.seasonGoalId,
      carriedFromId: g.carriedFromId, carryCount: g.carriedFromId ? 1 : 0,
    });
    if (wrote) {
      open += 1;
      goalPos += 1;
    }
  }
  const skipped = read.preview.skip.length + (read.preview.add.length - added);
  await event(pool, {
    kind: "imported", recapId: recap.id, userId, actorUserId: userId, hash: read.packSha256,
    note: JSON.stringify({ added, merged, skipped }),
  });
  return { ok: true, value: { written: true, added, merged, skipped, items: await store.itemsOf(pool, recap.id) } };
}

// ── The review queue ─────────────────────────────────────────────────────────

export interface QueueReader {
  userId: string;
  /** The gate passed this reader on `cash.pay`: the queue carries amounts. */
  cashView: boolean;
}

/**
 * THE REVIEW QUEUE: every SENT recap of the moon, what it waits on, who can
 * give each approval (by name, from the live holders, never an admin who holds
 * no seat), the roles and Outside my roles per person, and the reading first
 * with the numbers after it (A4). The invoice, the only part with an amount,
 * is in a row only for a `cash.pay` reader.
 */
export async function reviewQueue(pool: Pool, moon: Moon, reader: QueueReader, deps: FrameDeps & Pick<ReviewDeps, "keyHolders" | "nameOf">): Promise<QueueResponse> {
  const [recaps, holders, payers, settings] = await Promise.all([store.recapsForCycle(pool, moon.bounds.id), approverPool(deps.keyHolders), payersDoc(pool), settingsDoc(pool)]);
  const today = civilDateKey(new Date(), moon.timeZone);
  const rows: QueueRow[] = [];
  const rolesWithNoItems: QueueResponse["rolesWithNoItems"] = [];
  const noEligible: QueueResponse["noEligible"] = [];
  for (const r of recaps.filter((x) => x.status !== "draft" && x.sentAt)) {
    const [items, invoice, route, frame] = await Promise.all([
      store.itemsOf(pool, r.id), store.invoiceForRecap(pool, r.id), store.payRouteOf(pool, r.userId), loadFrame(pool, r.userId, moon, deps),
    ]);
    const view = recapView(r, !!invoice, moon.timeZone);
    const cov = coverage({ roles: frame.roles, items, seasonGoals: frame.seasonGoals, ownGoals: frame.ownGoals });
    const eligible = eligibleApprovers({ memberUserId: r.userId, pool: holders, workApprovedBy: r.workApprovedBy });
    const stage = waitingStage({ status: r.status, workApprovedAt: r.workApprovedAt, hasInvoice: !!invoice, financeApprovedAt: r.financeApprovedAt });
    if (stage && eligible[stage].length === 0) noEligible.push({ recapId: r.id, stage });
    const heldIds = frame.roles.map((x) => x.roleId);
    const outside = items.filter((i) => i.state === "kept" && (!i.roleId || !heldIds.includes(i.roleId))).length;
    const t = taskScore(items, moon.days);
    const seats = seatCoverage(frame.roles, items);
    for (const roleId of cov.rolesWithNoItems) rolesWithNoItems.push({ userId: r.userId, roleId, name: frame.roles.find((x) => x.roleId === roleId)?.name ?? roleId });
    const hash = await approvalHash(subjectOf(invoice, route, items));
    let cash: QueueRow["invoice"] = null;
    if (reader.cashView && invoice) {
      const base = invoiceViewOf({ stored: invoice, terms: frame.terms, moon, route, payers, settings, today, summary: summaryFor({ stored: invoice, recap: r, items, seasonGoals: frame.seasonGoals, payers, moon, timeZone: moon.timeZone }) }) as InvoiceView;
      const payer = payers.payers.find((p) => p.key === invoice.payerKey) ?? null;
      const check = route ? financeApprovalRefusal({ route, settings, attestation: invoice.attestation, moonLastDay: moon.days.lastDay, expectedOn: invoice.expectedOn ?? today }) : null;
      cash = {
        ...base,
        routeCheck: !route ? "No pay route." : check ? ("refusal" in check ? check.refusal : check.hold) : null,
        taxFormValid: !!route && (route.taxFormKind === "none" ? !settings.taxFormRoutes.includes(route.route) : !!route.taxFormSignedOn && (!route.taxFormExpiresOn || route.taxFormExpiresOn >= (invoice.expectedOn ?? today))),
        authorityNote: payer ? authorityNote(payer) : null,
        queueNote: payer?.queueNote ?? null,
        hash,
      };
      if (invoice.selfApproved) cash = { ...cash, statusLine: `${cash.statusLine}. ${SELF_APPROVED_WORDS}` };
    }
    const names = async (ids: readonly string[]) => Promise.all(ids.map((id) => deps.nameOf(id)));
    rows.push({
      recapId: r.id, userId: r.userId, name: await deps.nameOf(r.userId), status: r.status, waitingOn: view.waitingOn, dueOn: view.dueOn,
      selfApproved: r.selfApproved, workApprovers: await names(eligible.work), invoiceApprovers: invoice ? await names(eligible.invoice) : [],
      roles: cov.roles.map((x) => ({ roleId: x.roleId, name: x.name, itemCount: x.itemCount })), outsideMyRoles: outside,
      hash,
      taskReading: readingOf(t, scoreContextOf(t, outside)), seatReading: seatReadingOf(seats.on, seats.total), score: { numHalves: t.numHalves, den: t.den, pct: t.pct },
      items,
      invoice: cash,
    });
  }
  return { moon: moon.ref, rows, rolesWithNoItems, noEligible };
}

// ── The work approval ────────────────────────────────────────────────────────

/**
 * APPROVE THE WORK, or return items with a note. Each item named comes back
 * approved or returned; a returned item needs its note, which names what is
 * missing, never how to work. Any returned item returns the recap. With none
 * returned, every kept item is approved and the work approval is written,
 * bound to the hash the approver read.
 */
export async function reviewWork(pool: Pool, actorId: string, recapId: string, body: unknown, deps: Pick<ReviewDeps, "keyHolders" | "notify" | "nameOf">): Promise<Outcome<{ recap: ReturnType<typeof recapView> }>> {
  if (!RECAP_ID.test(recapId)) return refuse(404, "not_found");
  const recap = await store.recapById(pool, recapId);
  if (!recap) return refuse(404, "not_found");
  if (recap.status !== "waiting" || recap.workApprovedAt) return refuse(409, APPROVAL_REFUSALS.notWaiting);
  const holders = await approverPool(deps.keyHolders);
  const decision = approvalDecision({ stage: "work", actor: keysOf(actorId, holders), memberUserId: recap.userId, workApprovedBy: null, approveHolders: holders.approve });
  if (!decision.ok) return refuse(403, decision.refusal);
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const hash = await currentHash(pool, recap);
  if (b.hash !== hash) return refuse(409, APPROVAL_REFUSALS.hashChanged);

  const items = await store.itemsOf(pool, recap.id);
  const asked = Array.isArray(b.items) ? (b.items as Array<Record<string, unknown>>) : [];
  const returned: Array<{ id: string; note: string }> = [];
  for (const a of asked) {
    const item = items.find((i) => i.id === a?.id);
    if (!item) return refuse(400, "item_not_in_recap");
    if (a.review === "returned") {
      const note = typeof a.note === "string" ? a.note.replace(/\s+/g, " ").trim() : "";
      if (!note || note.length > LIMITS.reviewNote) return refuse(400, "note_required");
      returned.push({ id: item.id, note });
    } else if (a.review !== "approved") {
      return refuse(400, "review_is_approved_or_returned");
    }
  }
  const recapNote = typeof b.note === "string" ? b.note.replace(/\s+/g, " ").trim().slice(0, LIMITS.returnNote) : "";
  const invoice = await store.invoiceForRecap(pool, recap.id);
  if (returned.length > 0) {
    for (const r of returned) await store.setItemReview(pool, r.id, recap.id, "returned", r.note);
    if ((await store.returnRecap(pool, { id: recap.id, by: actorId, note: recapNote || returned.map((r) => r.note).join(" "), keepWork: false })) === 0) return refuse(409, APPROVAL_REFUSALS.notWaiting);
    if (invoice) await store.setInvoiceStatus(pool, invoice.id, ["waiting"], "returned");
    await event(pool, { kind: "returned", recapId: recap.id, userId: recap.userId, actorUserId: actorId, actorRole: WORK_APPROVE_CAPABILITY, hash, note: recapNote || null });
    await tell(deps, { userId: recap.userId, title: NOTICE_WORDS.returned, kind: "returned", recapId: recap.id, round: recap.round, actorUserId: actorId });
  } else {
    for (const i of items) if (i.state === "kept") await store.setItemReview(pool, i.id, recap.id, "approved", null);
    const next = recapStatusAfterWork(!!invoice);
    const n = await store.setWorkApproved(pool, { id: recap.id, by: actorId, hash, nextStatus: next, selfApproved: decision.selfApproved, alone: decision.alone });
    if (n === 0) return refuse(409, APPROVAL_REFUSALS.notWaiting);
    await event(pool, { kind: "work_approved", recapId: recap.id, userId: recap.userId, actorUserId: actorId, actorRole: WORK_APPROVE_CAPABILITY, hash, selfApproved: decision.selfApproved });
    if (decision.selfApproved) await event(pool, { kind: "self_approved", recapId: recap.id, userId: recap.userId, actorUserId: actorId, actorRole: WORK_APPROVE_CAPABILITY, hash, selfApproved: true, note: SELF_APPROVED_WORDS });
    await tell(deps, { userId: recap.userId, title: next === "approved" ? NOTICE_WORDS.approved : NOTICE_WORDS.workApproved, kind: "work_approved", recapId: recap.id, round: recap.round, actorUserId: actorId });
    if (decision.selfApproved) await tellReviewers(deps, recap, actorId);
  }
  const after = await store.recapById(pool, recap.id);
  return { ok: true, value: { recap: recapView(after ?? recap, !!invoice, "UTC") } };
}

/** A self-approval shows to the founders' and stewards' groups for review after the fact (decision 19). */
async function tellReviewers(deps: Pick<ReviewDeps, "keyHolders" | "notify" | "nameOf">, recap: store.RecapRow, actorId: string): Promise<void> {
  const name = await deps.nameOf(recap.userId);
  for (const u of await deps.keyHolders(APPROVE_ALONE_CAPABILITY)) {
    if (u === actorId) continue;
    await tell(deps, { userId: u, title: NOTICE_WORDS.selfApprovedForReview(name), kind: "self_approved", recapId: recap.id, round: recap.round, actorUserId: actorId });
  }
}

/** RETURN TO THE MEMBER, at either stage, with a note. A Finance return keeps the work approval. */
export async function returnToMember(pool: Pool, actorId: string, recapId: string, body: unknown, deps: Pick<ReviewDeps, "keyHolders" | "notify">): Promise<Outcome<{ recap: ReturnType<typeof recapView> }>> {
  if (!RECAP_ID.test(recapId)) return refuse(404, "not_found");
  const recap = await store.recapById(pool, recapId);
  if (!recap) return refuse(404, "not_found");
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const stage: ApprovalStage = b.stage === "invoice" ? "invoice" : "work";
  const note = typeof b.note === "string" ? b.note.replace(/\s+/g, " ").trim() : "";
  if (!note || note.length > LIMITS.returnNote) return refuse(400, "note_required");
  const invoice = await store.invoiceForRecap(pool, recap.id);
  const waiting = waitingStage({ status: recap.status, workApprovedAt: recap.workApprovedAt, hasInvoice: !!invoice, financeApprovedAt: recap.financeApprovedAt });
  if (waiting !== stage) return refuse(409, APPROVAL_REFUSALS.notWaiting);
  const holders = await approverPool(deps.keyHolders);
  const decision = approvalDecision({ stage, actor: keysOf(actorId, holders), memberUserId: recap.userId, workApprovedBy: stage === "invoice" ? recap.workApprovedBy : null, approveHolders: holders.approve });
  if (!decision.ok && decision.refusal !== APPROVAL_REFUSALS.sameApprover) return refuse(403, decision.refusal);
  if ((await store.returnRecap(pool, { id: recap.id, by: actorId, note, keepWork: stage === "invoice" })) === 0) return refuse(409, APPROVAL_REFUSALS.notWaiting);
  if (invoice) await store.setInvoiceStatus(pool, invoice.id, ["waiting"], "returned");
  await event(pool, { kind: "returned", recapId: recap.id, invoiceId: invoice?.id ?? null, userId: recap.userId, actorUserId: actorId, actorRole: stage === "work" ? WORK_APPROVE_CAPABILITY : INVOICE_APPROVE_CAPABILITY, note });
  await tell(deps, { userId: recap.userId, title: NOTICE_WORDS.returned, body: note, kind: "returned", recapId: recap.id, round: recap.round, actorUserId: actorId });
  const after = await store.recapById(pool, recap.id);
  return { ok: true, value: { recap: recapView(after ?? recap, !!invoice, "UTC") } };
}

// ── Finance: approve in bulk, set a range, void ──────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ApproveDeps = Pick<ReviewDeps, "notify" | "keyHolders" | "nameOf"> & {
  /** The moon's last civil day for a cycle id, for the nomad status check. */
  lastDayOf(cycleId: string): string | null;
};

/**
 * ONE INVOICE'S FINANCE APPROVAL, every check a single approval runs. Answers
 * null when approved, or the sentence it stays out with, or a hold.
 */
async function approveOne(
  pool: Pool,
  actorId: string,
  holders: ApproverPool,
  req: { id: string; hash: string; expectedOn: string; fx: { rate: string; source: string; date: string } | null },
  deps: ApproveDeps,
): Promise<{ refusal: string } | { hold: string } | null> {
  const invoice = await store.invoiceById(pool, req.id);
  if (!invoice || invoice.status !== "waiting") return { refusal: APPROVAL_REFUSALS.notWaiting };
  const recap = await store.recapById(pool, invoice.recapId);
  if (!recap || recap.status !== "waiting") return { refusal: APPROVAL_REFUSALS.notWaiting };
  if (!recap.workApprovedAt) return { refusal: APPROVAL_REFUSALS.workFirst };
  const decision = approvalDecision({ stage: "invoice", actor: keysOf(actorId, holders), memberUserId: recap.userId, workApprovedBy: recap.workApprovedBy, approveHolders: holders.approve });
  if (!decision.ok) return { refusal: decision.refusal };
  const hash = await currentHash(pool, recap);
  if (req.hash !== hash || recap.approvalHash !== hash) return { refusal: APPROVAL_REFUSALS.hashChanged };
  const route = await store.payRouteOf(pool, recap.userId);
  if (!route) return { refusal: "The pay route is not confirmed yet. Another person holding the cash power confirms it." };
  const settings = await settingsDoc(pool);
  const check = financeApprovalRefusal({ route, settings, attestation: invoice.attestation, moonLastDay: deps.lastDayOf(invoice.cycleId) ?? invoice.cycleId, expectedOn: req.expectedOn });
  if (check) return check;

  const items = await store.itemsOf(pool, recap.id);
  const approvedIds = items.filter((i) => i.state === "kept" && i.review === "approved");
  const lines: InvoiceLine[] = linesOf(invoice).map((l) => ({ ...l, approvedItemIds: approvedIds.filter((i) => i.roleId !== null && l.roleIds.includes(i.roleId)).map((i) => i.id) }));
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const owed = await oweApprovedRoleCash(conn, { cycleId: invoice.cycleId, userId: recap.userId, invoiceTitle: `moon ${invoice.cycleId}, invoice ${invoice.memberNumber}`, lines });
    if (!owed.ok) {
      await conn.rollback();
      return { refusal: rowExistsRefusal(owed.rowId) };
    }
    const own = { selfApproved: decision.selfApproved, alone: decision.alone };
    const a = await store.setInvoiceApproved(conn, { id: invoice.id, by: actorId, hash, expectedOn: req.expectedOn, linesJson: JSON.stringify(owed.lines), fxRate: req.fx?.rate ?? null, fxSource: req.fx?.source ?? null, fxDate: req.fx?.date ?? null, ...own });
    const f = a === 1 ? await store.setFinanceApproved(conn, { id: recap.id, by: actorId, hash, ...own }) : 0;
    if (a !== 1 || f !== 1) {
      await conn.rollback();
      return { refusal: APPROVAL_REFUSALS.notWaiting };
    }
    const total = invoiceTotals(owed.lines)[0];
    await event(conn, { kind: "invoice_approved", recapId: recap.id, invoiceId: invoice.id, userId: recap.userId, actorUserId: actorId, actorRole: INVOICE_APPROVE_CAPABILITY, amountMinor: total?.minor ?? null, currency: total?.currency ?? null, hash, selfApproved: decision.selfApproved });
    if (decision.selfApproved) await event(conn, { kind: "self_approved", recapId: recap.id, invoiceId: invoice.id, userId: recap.userId, actorUserId: actorId, actorRole: INVOICE_APPROVE_CAPABILITY, hash, selfApproved: true, note: SELF_APPROVED_WORDS });
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => undefined);
    throw e;
  } finally {
    conn.release();
  }
  await tell(deps, { userId: recap.userId, title: NOTICE_WORDS.approved, kind: "invoice_approved", recapId: recap.id, round: recap.round, actorUserId: actorId });
  if (decision.selfApproved) await tellReviewers(deps, recap, actorId);
  return null;
}

/**
 * APPROVE INVOICES IN BULK (decision 16). Each one runs every check a single
 * approval runs, and one that fails stays out with its sentence while the
 * rest pass. Never half of one invoice: each is its own transaction.
 */
export async function approveInvoices(pool: Pool, actorId: string, body: unknown, deps: ApproveDeps): Promise<Outcome<BulkApproveResponse>> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const list = Array.isArray(b.invoices) ? (b.invoices as Array<Record<string, unknown>>) : [];
  if (list.length === 0) return refuse(400, "no_invoices");
  if (list.length > LIMITS.bulkApprove) return refuse(400, `One approval carries ${LIMITS.bulkApprove} invoices at most.`);
  const holders = await approverPool(deps.keyHolders);
  const out: BulkApproveResponse = { approved: [], refused: [], held: [] };
  const seen = new Set<string>();
  for (const r of list) {
    const id = typeof r?.id === "string" ? r.id : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const expectedOn = typeof r.expectedOn === "string" && DATE_RE.test(r.expectedOn) ? r.expectedOn : "";
    const fxRaw = r.fx && typeof r.fx === "object" ? (r.fx as Record<string, unknown>) : null;
    const fx = fxRaw && typeof fxRaw.rate === "string" && typeof fxRaw.source === "string" && typeof fxRaw.date === "string" && DATE_RE.test(fxRaw.date)
      ? { rate: fxRaw.rate.slice(0, 32), source: fxRaw.source.slice(0, LIMITS.fxSource), date: fxRaw.date }
      : null;
    const res = await approveOne(pool, actorId, holders, { id, hash: typeof r.hash === "string" ? r.hash : "", expectedOn, fx }, deps);
    if (res === null) out.approved.push(id);
    else if ("hold" in res) out.held.push({ id, reason: res.hold });
    else out.refused.push({ id, reason: res.refusal });
  }
  return { ok: true, value: out };
}

/** Who may act on an invoice for Finance: the invoice stage's rule, read without the same-approver limit. */
async function financeActor(pool: Pool, actorId: string, invoice: store.InvoiceRow, deps: Pick<ReviewDeps, "keyHolders">): Promise<string | null> {
  const holders = await approverPool(deps.keyHolders);
  const d = approvalDecision({ stage: "invoice", actor: keysOf(actorId, holders), memberUserId: invoice.userId, workApprovedBy: null, approveHolders: holders.approve });
  return d.ok ? null : d.refusal;
}

/**
 * FINANCE SETS A RANGE (decision 16 revised). The line takes Finance's
 * figure, the invoice is voided and the recap goes back to the member with
 * the new figure, keeping its work approval. The member voids and reissues
 * their own invoice and sends again with its new number; the next send
 * carries the figure from the voided revision.
 */
export async function setRange(pool: Pool, actorId: string, invoiceId: string, body: unknown, deps: Pick<ReviewDeps, "keyHolders" | "notify">): Promise<Outcome<{ voided: string }>> {
  const invoice = await store.invoiceById(pool, invoiceId);
  if (!invoice) return refuse(404, "not_found");
  const no = await financeActor(pool, actorId, invoice, deps);
  if (no) return refuse(403, no);
  if (invoice.status !== "waiting") return refuse(409, APPROVAL_REFUSALS.notWaiting);
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const finalMinor = Number(b.finalMinor);
  const note = typeof b.note === "string" ? b.note.replace(/\s+/g, " ").trim() : "";
  if (!Number.isInteger(finalMinor) || finalMinor < 0) return refuse(400, "A range amount is a whole number of minor units.");
  if (!note || note.length > LIMITS.reviewNote) return refuse(400, "note_required");
  const lines = linesOf(invoice);
  const line = lines.find((l) => l.applicationId === b.applicationId && l.basis === "range");
  if (!line || !line.currency) return refuse(400, "not_a_range_line");
  const changed = lines.map((l) => (l === line ? { ...l, finalMinor } : l));
  const recap = await store.recapById(pool, invoice.recapId);
  if (!recap) return refuse(404, "not_found");
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await store.setInvoiceLines(conn, invoice.id, JSON.stringify(changed), invoice.totalMinor);
    if ((await store.voidInvoice(conn, invoice.id)) !== 1) throw new Error("raced");
    const words = rangeChangedNote(line.roleNames, `${moneyWords(finalMinor, line.currency)} ${line.per === "month" ? "a month" : "per moon"}`);
    if (recap.status === "waiting") await store.returnRecap(conn, { id: recap.id, by: actorId, note: words, keepWork: true });
    await event(conn, { kind: "amount_set", recapId: recap.id, invoiceId: invoice.id, userId: invoice.userId, actorUserId: actorId, actorRole: INVOICE_APPROVE_CAPABILITY, amountMinor: finalMinor, currency: line.currency, note });
    await event(conn, { kind: "void", recapId: recap.id, invoiceId: invoice.id, userId: invoice.userId, actorUserId: actorId, actorRole: INVOICE_APPROVE_CAPABILITY, note: words });
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => undefined);
    if (e instanceof Error && e.message === "raced") return refuse(409, APPROVAL_REFUSALS.notWaiting);
    throw e;
  } finally {
    conn.release();
  }
  await tell(deps, { userId: invoice.userId, title: NOTICE_WORDS.rangeChanged, kind: "amount_set", recapId: recap.id, round: recap.round, actorUserId: actorId });
  return { ok: true, value: { voided: invoice.id } };
}

/**
 * VOID AN INVOICE, kept for the record. A paid one is never voided: a
 * correction found after payment is an adjustment line next moon. A recap
 * waiting on Finance goes back to the member, keeping its work approval.
 */
export async function voidOne(pool: Pool, actorId: string, invoiceId: string, body: unknown, deps: Pick<ReviewDeps, "keyHolders" | "notify">): Promise<Outcome<{ voided: string }>> {
  const invoice = await store.invoiceById(pool, invoiceId);
  if (!invoice) return refuse(404, "not_found");
  const no = await financeActor(pool, actorId, invoice, deps);
  if (no) return refuse(403, no);
  if (invoice.status === "paid" || invoice.status === "void") return refuse(409, "not_voidable");
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const note = typeof b.note === "string" ? b.note.replace(/\s+/g, " ").trim() : "";
  if (!note || note.length > LIMITS.returnNote) return refuse(400, "note_required");
  if ((await store.voidInvoice(pool, invoice.id)) !== 1) return refuse(409, "not_voidable");
  const recap = await store.recapById(pool, invoice.recapId);
  if (recap?.status === "waiting") await store.returnRecap(pool, { id: recap.id, by: actorId, note, keepWork: true });
  await event(pool, { kind: "void", recapId: invoice.recapId, invoiceId: invoice.id, userId: invoice.userId, actorUserId: actorId, actorRole: INVOICE_APPROVE_CAPABILITY, note });
  if (recap) await tell(deps, { userId: invoice.userId, title: NOTICE_WORDS.returned, body: note, kind: "void", recapId: recap.id, round: recap.round, actorUserId: actorId });
  return { ok: true, value: { voided: invoice.id } };
}

/** CONFIRM ANOTHER MEMBER'S PAY ROUTE: a live `cash.pay` holder, never their own. */
export async function confirmRoute(pool: Pool, actorId: string, memberId: string, deps: Pick<ReviewDeps, "keyHolders">): Promise<Outcome<{ confirmed: true }>> {
  const own = confirmRouteRefusal(actorId, memberId);
  if (own) return refuse(409, own);
  if (!(await deps.keyHolders(INVOICE_APPROVE_CAPABILITY)).includes(actorId)) return refuse(403, APPROVAL_REFUSALS.noKey);
  const route = await store.payRouteOf(pool, memberId);
  if (!route) return refuse(404, "not_found");
  if ((await store.confirmPayRoute(pool, memberId, actorId)) !== 1) return refuse(409, CONFIRM_OWN_ROUTE_REFUSED);
  await event(pool, { kind: "route_confirmed", recapId: null, userId: memberId, actorUserId: actorId, actorRole: INVOICE_APPROVE_CAPABILITY });
  return { ok: true, value: { confirmed: true } };
}

// ── Paid, through the existing transfers door ────────────────────────────────

/**
 * AFTER A TRANSFER: every approved invoice holding one of these cash owed rows
 * is read again, and one whose rows are now ALL paid becomes Paid
 * (`invoicePaidFrom`), on the transfer's own date when the door gave one. The
 * member reads the contract's "Your pay is sent" words. Nothing here moves
 * money; the door that recorded the transfer is the existing one.
 */
export async function settlePaidInvoices(pool: Pool, cashIds: readonly string[], transferDate: string | null, deps: Pick<ReviewDeps, "notify">): Promise<string[]> {
  if (cashIds.length === 0) return [];
  const wanted = new Set(cashIds);
  const paid: string[] = [];
  for (const inv of await store.approvedInvoices(pool)) {
    const ids = linesOf(inv).map((l) => l.cashOwedId).filter((x): x is string => !!x);
    if (!ids.some((id) => wanted.has(id))) continue;
    const rows = await cashOwedRowsByIds(pool, ids);
    if (rows.length !== ids.length) continue;
    const read = invoicePaidFrom(rows.map((r) => ({ state: String(r.state), paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null })));
    if (!read.paid) continue;
    const paidOn = transferDate ?? read.paidOn ?? new Date().toISOString().slice(0, 10);
    const total = rows.reduce((n, r) => n + Number(r.amount_minor), 0);
    if ((await store.markInvoicePaid(pool, inv.id, { paidOn, paidAmountMinor: total, paidCurrency: inv.currency, feesMinor: null, fundsSource: null })) !== 1) continue;
    await event(pool, { kind: "paid", recapId: inv.recapId, invoiceId: inv.id, userId: inv.userId, actorUserId: null, amountMinor: total, currency: inv.currency });
    await deps.notify({ userId: inv.userId, type: MOON_NOTICE, title: NOTICE_WORDS.paid(paidOn), link: MY_MOON_LINK, dedupeKey: `moon:paid:${inv.id}:${inv.userId}` }).catch(() => undefined);
    paid.push(inv.id);
  }
  return paid;
}

// ── The room panel ───────────────────────────────────────────────────────────

/**
 * THE ROOM'S TWO SECTIONS, for a member joined to that room: the stick
 * holder's sent recap as `memberView` reads it (no ids, no amounts, no review
 * notes), their goals, who is ready to share, and this viewer's own row. The
 * shape has no field that can hold an amount, a score or a moon load.
 */
export async function roomPanel(pool: Pool, sessionId: number, viewerId: string, moon: Moon, deps: FrameDeps & Pick<ReviewDeps, "nameOf"> & { nextCycleId: string }): Promise<Outcome<RoomResponse>> {
  const viewerNo = (await memberNoRows(pool, viewerId))[0]?.no;
  if (viewerNo == null || (await personRow(pool, sessionId, Number(viewerNo))).length === 0) return refuse(404, "not_found");
  const use = await useRow(pool, sessionId);
  const stick = readStick(use[0]?.stick ?? null);
  const holderNo = stick.order[stick.at] ?? null;
  const holderId = holderNo == null ? null : ((await memberUserIdRows(pool, [holderNo]))[0]?.user_id as string | undefined) ?? null;
  const recaps = await store.recapsForCycle(pool, moon.bounds.id);
  const sent = recaps.filter((r) => r.status !== "draft" && r.sentAt);

  let recapPart: RoomResponse["recap"] = null;
  let goals: RoomResponse["goals"] = null;
  if (holderId) {
    const hr = sent.find((r) => r.userId === holderId) ?? null;
    if (hr) {
      const frame = await loadFrame(pool, holderId, moon, deps);
      const items = await store.itemsOf(pool, hr.id);
      // Room items here show only to the room as a whole, so none passes the per-reader filter.
      const roles = memberView({ status: hr.status, roles: frame.roles.map((r) => ({ roleId: r.roleId, name: r.name })), items, roomVisible: () => false });
      const cov = coverage({ roles: frame.roles, items: items.filter((i) => i.visibility === "members" && i.review !== "returned"), seasonGoals: frame.seasonGoals, ownGoals: [] });
      recapPart = {
        roles: roles.map((r) => ({ roleId: r.roleId, name: r.name, items: r.items.map((i) => ({ text: i.text, evidenceUrl: i.evidenceUrl })), heldPrivately: r.heldPrivately })),
        seasonGoals: cov.seasonGoals,
      };
    }
    const last = await store.goalsFor(pool, holderId, moon.bounds.id);
    const next = await store.goalsFor(pool, holderId, deps.nextCycleId);
    if (last.length > 0 || next.length > 0) {
      const s = goalScore(last);
      goals = {
        last: last.map((g) => ({ text: g.text, status: g.status, flagged: carriedTooOften(g) })),
        score: { numHalves: s.numHalves, den: s.den, pct: s.pct },
        next: next.map((g) => ({ text: g.text, doneWhen: g.doneWhen })),
      };
    }
  }
  const mine = recaps.find((r) => r.userId === viewerId) ?? null;
  const viewerFrame = await loadFrame(pool, viewerId, moon, deps);
  const ready: RoomResponse["ready"] = [];
  for (const r of sent) ready.push({ userId: r.userId, name: await deps.nameOf(r.userId) });
  return {
    ok: true,
    value: {
      moon: moon.ref,
      holder: holderId ? { userId: holderId, name: await deps.nameOf(holderId) } : null,
      recap: recapPart,
      ready,
      goals,
      mine: { recapStatus: mine?.status ?? null, statusWords: mine ? RECAP_STATUS_WORDS[mine.status] : RECAP_STATUS_WORDS.draft, invoiceNeeded: termsCarryMoney(viewerFrame.terms) },
      sentCount: sent.length,
    },
  };
}

/** Used by the tests: a line that carries money. */
export { isPayableLine };

// ── Moon goals (decision 20): the next moon's, and scoring last moon's ───────

export type GoalView = Awaited<ReturnType<typeof store.goalsFor>>[number] & { flagged: boolean };
const flagged = (g: Awaited<ReturnType<typeof store.goalsFor>>[number]): GoalView => ({ ...g, flagged: carriedTooOften(g) });

/** The next moon's goals, carried ones first. */
export async function nextGoals(pool: Pool, userId: string, nextCycleId: string): Promise<{ goals: GoalView[] }> {
  const all = await store.goalsFor(pool, userId, nextCycleId);
  return { goals: [...all.filter((g) => g.carriedFromId), ...all.filter((g) => !g.carriedFromId)].map(flagged) };
}

/**
 * SET THE NEXT MOON'S GOALS: three to five (`parseMoonGoals`). A goal naming
 * `carriedFromId` is one of the member's own earlier goals carried in, one
 * carry more; a carried goal already there takes the new words. The member's
 * own open goals that are not carried are replaced. At most five stay open.
 */
export async function putNextGoals(pool: Pool, userId: string, nextCycleId: string, body: unknown): Promise<Outcome<{ goals: GoalView[] }>> {
  const raw = (body && typeof body === "object" ? (body as Record<string, unknown>).goals : undefined) as unknown;
  const parsed = parseMoonGoals(raw);
  if (!parsed.ok) return refuse(400, parsed.error);
  const rawKept = (Array.isArray(raw) ? raw : []).filter((g) => g && typeof g === "object" && typeof (g as Record<string, unknown>).text === "string" && ((g as Record<string, unknown>).text as string).trim()) as Array<Record<string, unknown>>;
  const existing = await store.goalsFor(pool, userId, nextCycleId);
  for (const g of existing) if (g.status === "open" && !g.carriedFromId) await store.removeOpenGoal(pool, g.id, userId);
  const kept = await store.goalsFor(pool, userId, nextCycleId);
  let position = kept.reduce((m, g) => Math.max(m, g.position + 1), 0);
  let open = kept.filter((g) => g.status === "open").length;
  for (let i = 0; i < parsed.value.length; i++) {
    const g = parsed.value[i];
    const from = typeof rawKept[i]?.carriedFromId === "string" ? String(rawKept[i].carriedFromId) : null;
    const already = from ? kept.find((k) => k.carriedFromId === from) : undefined;
    if (already) {
      await store.updateGoalWords(pool, already.id, userId, g);
      continue;
    }
    const source = from ? await store.goalById(pool, from) : null;
    if (from && (!source || source.userId !== userId)) return refuse(400, "carried_goal_not_yours");
    if (open >= 5) return refuse(400, "Set 3 to 5 goals for the next moon.");
    if (await store.insertGoal(pool, { id: newId("mg"), userId, cycleId: nextCycleId, position, text: g.text, doneWhen: g.doneWhen, seasonGoalId: g.seasonGoalId, carriedFromId: from, carryCount: source ? source.carryCount + 1 : 0 })) {
      position += 1;
      open += 1;
    }
  }
  return { ok: true, value: await nextGoals(pool, userId, nextCycleId) };
}

/** SCORE ONE OF LAST MOON'S GOALS. Let go needs its reason. Only the member's own. */
export async function scoreOneGoal(pool: Pool, userId: string, goalId: string, body: unknown): Promise<Outcome<{ goal: GoalView }>> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const goal = await store.goalById(pool, goalId);
  if (!goal || goal.userId !== userId) return refuse(404, "not_found");
  const status = b.status;
  if (status !== "done" && status !== "partly" && status !== "carried" && status !== "let_go") return refuse(400, "A goal is Done, Partly, Carry or Let go.");
  const reason = typeof b.letGoReason === "string" ? b.letGoReason.replace(/\s+/g, " ").trim().slice(0, LIMITS.letGoReason) : null;
  const problem = goalScoreProblem(status, reason);
  if (problem) return refuse(400, problem);
  await store.scoreGoal(pool, goalId, userId, status, status === "let_go" ? reason : null);
  const after = await store.goalById(pool, goalId);
  return { ok: true, value: { goal: flagged(after ?? goal) } };
}
