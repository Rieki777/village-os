/**
 * The stamped facts the role-journey measures are computed from (L11).
 *
 * Reads the application stamps (`application_steps`, the review lane), the
 * onboarding path (`onboarding_paths`, `onboarding_items`) and the moon
 * renewals (`role_moon_renewals`). TOLERANT: a table that does not exist yet
 * (a lane not landed in this release) reads as no facts, never as an error.
 *
 * Returns season, circle and instants only. No user id, application ref, name
 * or email leaves this file: refs and ids are used inside the queries to join
 * and are dropped from what is returned. Instants are read with
 * UNIX_TIMESTAMP so the host's offset cannot shift them.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { ApplicationFact, HolderFact } from "../../shared/roleMeasures";

async function rows(pool: Pool, sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  try {
    const [r] = await pool.query<RowDataPacket[]>(sql, params);
    return r;
  } catch (e: any) {
    if (e?.errno === 1146 || e?.code === "ER_NO_SUCH_TABLE" || e?.errno === 1054 || e?.code === "ER_BAD_FIELD_ERROR") return [];
    throw e;
  }
}

const ms = (v: unknown): number | null => (v === null || v === undefined ? null : Math.round(Number(v) * 1000));

function firstRoleOf(raw: unknown, key: "seat_ids" | "roles"): string | null {
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (key === "roles" && v && typeof v === "object") v = (v as any).roles;
  if (!Array.isArray(v) || v.length === 0) return null;
  const f = v[0];
  const id = typeof f === "string" ? f : f?.roleId;
  return typeof id === "string" && id ? id : null;
}

export async function applicationFacts(pool: Pool): Promise<ApplicationFact[]> {
  const steps = await rows(
    pool,
    "SELECT application_ref AS ref, kind, UNIX_TIMESTAMP(MIN(stamped_at)) AS t FROM application_steps " +
      "WHERE kind IN ('confirmed','first_reply','interview','decided') GROUP BY application_ref, kind",
  );
  if (steps.length === 0) return [];
  const byRef = new Map<string, Record<string, number | null>>();
  for (const s of steps) {
    const m = byRef.get(String(s.ref)) ?? {};
    m[String(s.kind)] = ms(s.t);
    byRef.set(String(s.ref), m);
  }
  // Where each application sat: its season and its first role's circle.
  const place = new Map<string, { seasonId: string | null; roleId: string | null }>();
  for (const a of await rows(pool, "SELECT id, term_season_id AS season, seat_ids AS ids FROM seat_applications")) {
    place.set(String(a.id), { seasonId: a.season ? String(a.season) : null, roleId: firstRoleOf(a.ids, "seat_ids") });
  }
  for (const a of await rows(pool, "SELECT id, target_season_id AS season, body_json AS body FROM open_role_proposals")) {
    place.set(String(a.id), { seasonId: a.season ? String(a.season) : null, roleId: firstRoleOf(a.body, "roles") });
  }
  const circles = new Map<string, string | null>();
  for (const r of await rows(pool, "SELECT id, circle_id FROM org_roles")) circles.set(String(r.id), r.circle_id ? String(r.circle_id) : null);

  const out: ApplicationFact[] = [];
  for (const [ref, t] of Array.from(byRef.entries())) {
    if (t.confirmed == null) continue;
    const p = place.get(ref);
    out.push({
      seasonId: p?.seasonId ?? null,
      circleId: p?.roleId ? (circles.get(p.roleId) ?? null) : null,
      confirmedAt: t.confirmed,
      firstReplyAt: t.first_reply ?? null,
      firstInterviewAt: t.interview ?? null,
      decidedAt: t.decided ?? null,
    });
  }
  return out;
}

export async function holderFacts(pool: Pool): Promise<HolderFact[]> {
  const seatings = await rows(
    pool,
    "SELECT a.id, a.season_id AS season, r.circle_id AS circle, UNIX_TIMESTAMP(a.started_at) AS started, UNIX_TIMESTAMP(a.ended_at) AS ended " +
      "FROM org_role_assignments a JOIN org_roles r ON r.id = a.org_role_id " +
      "WHERE a.holder_kind = 'member' AND a.is_example = 0",
  );
  if (seatings.length === 0) return [];
  const paths = new Map<string, { opened: number | null; done: number | null; quest: number | null }>();
  for (const p of await rows(
    pool,
    "SELECT p.assignment_id AS aid, UNIX_TIMESTAMP(p.opened_on) AS opened, COUNT(i.id) AS items, SUM(i.done_at IS NULL) AS open_items, " +
      "UNIX_TIMESTAMP(MAX(i.done_at)) AS last_done, UNIX_TIMESTAMP(MAX(CASE WHEN i.kind = 'quest' THEN i.done_at END)) AS quest " +
      "FROM onboarding_paths p LEFT JOIN onboarding_items i ON i.path_id = p.id GROUP BY p.id, p.assignment_id, p.opened_on",
  )) {
    const complete = Number(p.items) > 0 && Number(p.open_items) === 0;
    paths.set(String(p.aid), { opened: ms(p.opened), done: complete ? ms(p.last_done) : null, quest: ms(p.quest) });
  }
  const renewals = new Map<string, { due: number; renewed: number }>();
  for (const x of await rows(
    pool,
    "SELECT assignment_id AS aid, COUNT(*) AS due, SUM(status = 'renewed') AS renewed FROM role_moon_renewals " +
      "WHERE for_term_ends_at <= NOW() GROUP BY assignment_id",
  )) {
    renewals.set(String(x.aid), { due: Number(x.due), renewed: Number(x.renewed ?? 0) });
  }
  return seatings.map((s) => {
    const path = paths.get(String(s.id));
    const ren = renewals.get(String(s.id));
    return {
      seasonId: s.season ? String(s.season) : null,
      circleId: s.circle ? String(s.circle) : null,
      startedAt: ms(s.started) ?? 0,
      endedAt: ms(s.ended),
      pathOpenedAt: path?.opened ?? null,
      pathDoneAt: path?.done ?? null,
      firstQuestDoneAt: path?.quest ?? null,
      renewalsDue: ren?.due ?? 0,
      renewalsRenewed: ren?.renewed ?? 0,
    };
  });
}

/** Circle names by id, for the page. A circle is not a person. */
export async function circleNames(pool: Pool): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const r of await rows(pool, "SELECT id, name FROM circles")) out.set(String(r.id), String(r.name));
  return out;
}
