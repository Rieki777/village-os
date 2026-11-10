/**
 * Moon renewal (G11, D25).
 *
 * A holder whose term is shorter than two cycles sees "Carry on into the next
 * moon?" in the term's last week and files it with next moon's contribution.
 * One holder of the power to fill roles then renews every filed role in a
 * single action, which writes the next moon's term. Nothing here runs from a
 * job: a renewal is always a person's act (14 Sept ruling, no auto-extend).
 */
import type { Pool } from "mysql2/promise";
import { termWarningOpensFor, type CycleClock } from "../../shared/cycleClock";
import { CONTRIBUTION_MAX, nextMoonTermEnd } from "../../shared/moonRenewal";
import {
  fileRenewal,
  filedRenewals,
  liveSeatingsOfUser,
  renewSeating,
  renewalFor,
  seatingFacts,
  withdrawRenewal,
} from "../repos/roleAccess";

export interface CarryOnCard {
  assignmentId: string;
  orgRoleId: string;
  roleName: string;
  termEndsAt: string;
  nextTermEndsAt: string;
  filed: boolean;
  contribution: string | null;
}

/** The carry-on cards a member sees now: live one-moon terms whose last week has begun. */
export async function carryOnCardsFor(pool: Pool, userId: string, now: Date, clock: CycleClock): Promise<CarryOnCard[]> {
  const out: CarryOnCard[] = [];
  for (const s of await liveSeatingsOfUser(pool, userId)) {
    if (s.termEndsAt.getTime() <= now.getTime()) continue;
    if (now.getTime() < termWarningOpensFor(s.startedAt, s.termEndsAt, clock).getTime()) continue;
    const short = termWarningOpensFor(s.startedAt, s.termEndsAt, clock).getTime() !== termWarningOpensFor(null, s.termEndsAt, clock).getTime();
    if (!short) continue;
    const r = await renewalFor(pool, s.id, s.termEndsAt);
    out.push({
      assignmentId: s.id,
      orgRoleId: s.orgRoleId,
      roleName: s.roleName,
      termEndsAt: s.termEndsAt.toISOString(),
      nextTermEndsAt: nextMoonTermEnd(s.termEndsAt, clock).toISOString(),
      filed: !!r && r.status === "filed",
      contribution: r && r.status !== "withdrawn" ? r.contribution : null,
    });
  }
  return out;
}

export type FileResult = { ok: true } | { ok: false; status: number; error: string };

/** The holder files "carry on" with next moon's contribution. Their own seating, inside the last week. */
export async function fileCarryOn(pool: Pool, userId: string, assignmentId: string, contribution: string, now: Date, clock: CycleClock): Promise<FileResult> {
  const text = String(contribution ?? "").trim();
  if (!text) return { ok: false, status: 400, error: "Say what you will contribute next moon." };
  if (text.length > CONTRIBUTION_MAX) return { ok: false, status: 400, error: `At most ${CONTRIBUTION_MAX} characters.` };
  const cards = await carryOnCardsFor(pool, userId, now, clock);
  const card = cards.find((c) => c.assignmentId === assignmentId);
  if (!card) return { ok: false, status: 409, error: "This role is not open for carrying on yet." };
  const seat = await seatingFacts(pool, assignmentId);
  if (!seat || !seat.termEndsAt || seat.userId !== userId) return { ok: false, status: 404, error: "No such role." };
  await fileRenewal(pool, { assignmentId, orgRoleId: seat.orgRoleId, userId, forTermEndsAt: seat.termEndsAt, contribution: text });
  return { ok: true };
}

export async function withdrawCarryOn(pool: Pool, userId: string, assignmentId: string): Promise<boolean> {
  const seat = await seatingFacts(pool, assignmentId);
  if (!seat?.termEndsAt || seat.userId !== userId) return false;
  return withdrawRenewal(pool, assignmentId, seat.termEndsAt, userId);
}

export interface RenewAllResult {
  renewed: Array<{ assignmentId: string; userId: string; nextTermEndsAt: string }>;
  skipped: number;
}

/**
 * ONE ACTION, EVERY FILED ROLE. Each seating gets the next moon's term; a
 * filed carry-on whose seating has ended or whose term already moved is
 * skipped and reported, never forced. The holder is told once per term.
 */
export async function renewAllFiled(
  pool: Pool,
  actorId: string,
  clock: CycleClock,
  notify?: (input: { userId: string; type: string; title: string; body?: string | null; link?: string | null; dedupeKey: string }) => Promise<unknown>,
): Promise<RenewAllResult> {
  const res: RenewAllResult = { renewed: [], skipped: 0 };
  for (const r of await filedRenewals(pool)) {
    const next = nextMoonTermEnd(r.forTermEndsAt, clock);
    const ok = await renewSeating(pool, r, next, actorId);
    if (!ok) {
      res.skipped += 1;
      continue;
    }
    res.renewed.push({ assignmentId: r.assignmentId, userId: r.userId, nextTermEndsAt: next.toISOString() });
    if (notify) {
      await notify({
        userId: r.userId,
        type: "governance",
        title: "Your role carries on into the next moon",
        body: null,
        link: "/season-plan",
        dedupeKey: `moon-renewed:${r.assignmentId}:${next.toISOString().slice(0, 10)}`,
      }).catch(() => undefined);
    }
  }
  return res;
}
