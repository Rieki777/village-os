/**
 * The read-back's person half: who holds which seat, said without saying who.
 *
 * ── WHAT THIS IS FOR ─────────────────────────────────────────────────────
 *
 * A connected module reasons about the live structure. `/api/public/org.json`
 * gives it the shape, signed and person-free, carrying counts and never people.
 * That is enough to know a seat exists and not enough to know a seat changed
 * hands, which is exactly the thing an assistant reasoning about a village
 * needs to notice.
 *
 * This route is the missing half, and the whole design problem is that it must
 * carry occupancy without carrying identity. It answers with an opaque subject
 * reference, a seat, and a term. It never carries a name, an email, our
 * internal member id, a focus string or a note, because the last two are free
 * text a human typed and free text a human typed is where a name ends up.
 *
 * ── WHY `map.viewPeople` AND NOT A NEW CAPABILITY ────────────────────────
 *
 * `map.viewPeople` already governs this exact class of information: its own
 * description is "see which named people hold which seats". This route returns
 * strictly less than that capability already permits, since it drops the names,
 * so gating it here grants nobody anything they did not already have. A new
 * capability would have been a fifth entry in four total Records plus a plain
 * array the compiler cannot check, in exchange for no additional safety.
 *
 * One property worth stating because it is easy to lose in a later edit: the
 * gate is the capability and never `isAdmin`. A steward who keeps the queues
 * without holding the whole admin panel is the person this whole surface was
 * built for.
 *
 * ── WHY DOCUMENTED HOLDERS CARRY NO REFERENCE ────────────────────────────
 *
 * A subject reference resolves to an account. A documented holder is a real
 * person WITHOUT one: an admin typed their name onto a card. There is no
 * account to reference, so the seat reports that it is held and by what kind of
 * holder, and stops there. An agent is a documented holder too, marked, which
 * is how a reader can tell a seat carried by software from a seat carried by
 * somebody who never signed up.
 */
import type { Express } from "express";
import type { Pool } from "mysql2/promise";
import type { AppDeps } from "../lib/appDeps";
import { liveSeatings, type SeatingRow } from "../repos/seatHoldings";
import { subjectRefsFor } from "../lib/subjectRefs";

type Deps = Pick<AppDeps, "guardCapability" | "getPool">;

/** What a holder is, from the outside, with no way back to a person. */
type HolderKind = "member" | "agent" | "documented";

interface SeatHolding {
  orgRoleId: string;
  holder: HolderKind;
  /** Present only for a member holding, because only an account has one. */
  subjectRef: string | null;
  since: string | null;
  termEndsAt: string | null;
}

function iso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * "Agent" is this document's word and not the table's, which is why the
 * decision is made here rather than in the read: the row carries `holder_kind`
 * and `is_agent` as two independent columns, and a seat held by software is
 * reported as one kind because that is the distinction a reader of THIS
 * document needs. The read stays the table's shape; the naming stays ours.
 */
function kindOf(row: SeatingRow): HolderKind {
  if (row.isAgent) return "agent";
  return row.holderKind === "member" ? "member" : "documented";
}

export async function liveHoldings(pool: Pool): Promise<SeatHolding[]> {
  const rows = await liveSeatings(pool);

  // Members only. A documented holder has no account, so asking for a reference
  // would issue one against a null id.
  const memberIds = rows
    .filter((r) => kindOf(r) === "member" && r.userId !== null && r.userId !== "")
    .map((r) => String(r.userId));
  const refs = await subjectRefsFor(pool, memberIds);

  return rows.map((r) => {
    const holder = kindOf(r);
    const userId = r.userId;
    return {
      orgRoleId: r.orgRoleId,
      holder,
      subjectRef: holder === "member" && userId ? (refs.get(userId) ?? null) : null,
      since: iso(r.startedAt),
      termEndsAt: iso(r.termEndsAt),
    };
  });
}

export function register(app: Express, deps: Deps): void {
  const { guardCapability, getPool } = deps;

  /**
   * Every live seating, as references rather than people.
   *
   * `protocol` is versioned for the same reason the public export's is: a
   * consumer that pins a version can be told the shape changed instead of
   * discovering it. Note it reads `holders/1` and not `org/1`, which is a
   * different document.
   */
  app.get("/api/org/holders", async (req, res) => {
    if (!(await guardCapability(req, res, "map.viewPeople"))) return;
    try {
      const holdings = await liveHoldings(getPool());
      res.json({
        protocol: "holders/1",
        // Counted from what is being returned, so the number and the list can
        // never disagree with each other.
        count: holdings.length,
        holdings,
      });
    } catch (e: any) {
      // A read failure is reported as one. An empty list here would read as a
      // village with nobody in any seat, which is a sentence nobody should
      // publish by accident.
      res.status(500).json({ error: "holders_unavailable", detail: String(e?.message ?? e).slice(0, 200) });
    }
  });
}
