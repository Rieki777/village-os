/**
 * The event spine (S11): recordEvent() is the ONE way anything lands in the
 * village's history — the public Pulse and the admin audit trail are the same
 * table, split by audience. Every row can carry WHO (actorUserId) and WHAT it
 * was about (entityType/entityRef), which is what the old activity log lost
 * with every line it wrote.
 *
 * Recording never throws into the caller: an event is a trace of a mutation
 * that already happened, and failing the mutation because its trace failed
 * would invert their importance. Failures are logged loudly instead.
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * WHAT KIND of actor did this (S74). Assistant paths pass 'agent', so the first
 * time a village dislikes something an agent did, someone can name which
 * integration it was and revoke exactly that one. Defaults to 'human', which is
 * what every existing call site correctly means.
 */
export const ACTOR_KINDS = ["human", "agent", "system", "peer"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export interface EventInput {
  kind: string;
  text: string;
  actorUserId?: string | null;
  actorKind?: ActorKind;
  /**
   * WHICH INTEGRATION did this, when `actorKind` is 'agent'.
   *
   * `actor_kind` alone answers "a machine did this" and stops there. A village
   * running three integrations that dislikes one of them needs the next
   * question answered too, and revocation works on the module id: turning a
   * module off is the lever a village actually has. Null for a human, and null
   * for an agent whose caller did not name itself, which reads as unattributed
   * rather than as any particular module.
   */
  originModuleId?: string | null;
  entityType?: string | null;
  entityRef?: string | null;
  audience?: "public" | "admin";
}

export interface EventRow {
  id: string;
  kind: string;
  text: string;
  actorUserId: string | null;
  /**
   * Written since 0052 and, until now, never read: `EventRow` omitted it and
   * both readers named their columns, so the one fact that tells a village a
   * machine acted could not reach a screen. Revocation by integration is not
   * real until somebody can see which rows an integration wrote.
   */
  actorKind: ActorKind;
  originModuleId: string | null;
  entityType: string | null;
  entityRef: string | null;
  audience: "public" | "admin";
  at: string;
}

/**
 * SOMETHING THAT WANTS TO KNOW AN EVENT WAS RECORDED.
 *
 * The canvas's key moments (server/lib/canvasRevisit.ts) are the first: a
 * founder claiming the instance, a peer village added, a circle accepted from
 * a draft and the Birthing opened each already record an audit event here, so
 * the moment hangs off the event rather than adding a line to the route that
 * recorded it. That is what keeps `server/index.ts`, where those routes live,
 * from growing.
 *
 * THE RULES, and each one protects the caller of `recordEvent`:
 *
 *  - An observer is told only after the row is written. A failed insert is
 *    not an event, so nothing downstream of it fires.
 *  - An observer is SYNCHRONOUS and must return at once. One that has work to
 *    do starts it and returns, and the work may never be awaited by the
 *    request that recorded the event.
 *  - An observer that throws is logged and skipped. The event stands, the
 *    other observers still run, and the mutation that recorded it is never
 *    told: an event is a trace, and so is anything hanging off it.
 */
export type EventObserver = (e: Readonly<EventInput>) => void;

const observers = new Set<EventObserver>();

/** Start telling `fn` about every event recorded from now on. Returns the way to stop. */
export function observeEvents(fn: EventObserver): () => void {
  observers.add(fn);
  return () => {
    observers.delete(fn);
  };
}

function tellObservers(e: EventInput): void {
  for (const fn of Array.from(observers)) {
    try {
      fn(e);
    } catch (err) {
      console.error("[events] an observer threw (the event stands)", err);
    }
  }
}

export async function recordEvent(pool: Pool, e: EventInput): Promise<void> {
  try {
    await pool.query(
      "INSERT INTO health_events (id, kind, text, actor_user_id, actor_kind, origin_module_id, entity_type, entity_ref, audience) " +
        "VALUES (?,?,?,?,?,?,?,?,?)",
      [
        `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        e.kind,
        e.text,
        e.actorUserId ?? null,
        e.actorKind ?? "human",
        e.originModuleId ?? null,
        e.entityType ?? null,
        e.entityRef ?? null,
        e.audience ?? "public",
      ],
    );
  } catch (err) {
    console.error("[events] recordEvent failed (mutation unaffected)", err);
    return;
  }
  tellObservers(e);
}

function rowToEvent(r: RowDataPacket): EventRow {
  return {
    id: String(r.id),
    kind: String(r.kind),
    text: String(r.text),
    actorUserId: r.actor_user_id ?? null,
    actorKind: ACTOR_KINDS.includes(r.actor_kind as ActorKind) ? (r.actor_kind as ActorKind) : "human",
    originModuleId: r.origin_module_id ?? null,
    entityType: r.entity_type ?? null,
    entityRef: r.entity_ref ?? null,
    audience: r.audience === "admin" ? "admin" : "public",
    at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
  };
}

/** Newest first. The Village Pulse reads audience='public'. */
export async function recentEvents(
  pool: Pool,
  audience: "public" | "admin",
  limit = 30,
): Promise<EventRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    // Example events are illustrative, not history. This spine feeds the
    // public Pulse and the feed's "village happenings", so an unfiltered read
    // presents seeded copy as things that actually happened here.
    "SELECT id, kind, text, actor_user_id, actor_kind, origin_module_id, entity_type, entity_ref, audience, at " +
      "FROM health_events WHERE audience = ? AND is_example = 0 ORDER BY at DESC, id DESC LIMIT ?",
    [audience, Math.max(1, Math.min(500, limit))],
  );
  return rows.map(rowToEvent);
}

/*
 * `deleteEvent` used to sit here, with `DELETE /api/admin/activity/:id` as its
 * only caller. Both went in the same pass. This spine writes the record of
 * what a village did; the one function that unwrote a line of it was reachable
 * over curl and nowhere else.
 */
