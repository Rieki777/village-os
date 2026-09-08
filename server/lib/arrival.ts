/**
 * SOMEBODY ARRIVED, AND SOMEBODY IS TOLD.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Registration used to write one `health_events` row and stop. No notification,
 * no email, no alert to anybody. The most important event in a village happened
 * in silence, which is the opposite of what the product is for: a person joined
 * and the village found out only if somebody happened to scroll a feed.
 *
 * ── WHO IS TOLD, AND WHY IT IS A SEAT AND NOT A LIST ────────────────────────
 *
 * Rye's ruling, 2026-09-08: greeting belongs to a named seat. Whichever circle
 * does outreach holds a role for it, and arrival reaches whoever sits there.
 * A seat is self-maintaining in a way a list of people is not: the village
 * re-seats it every season and the routing follows, with nobody editing config.
 *
 * `arrival.greeter_role` names that role. It is empty by default, because a
 * fresh village has no org chart yet and this must work on its first day.
 *
 * ── THE FALLBACK IS THE POINT, NOT A CONVENIENCE ────────────────────────────
 *
 * With no greeter seat named, or with the seat sitting VACANT, the admins are
 * told instead. A village that has not organised itself yet still finds out
 * that somebody joined, and a village whose greeter stepped down last week does
 * not silently stop greeting people. The failure this guards against is the one
 * that already happened: a mechanism that quietly reaches nobody.
 *
 * A DOCUMENTED HOLDER IS NOT A RECIPIENT. `org_role_assignments` can name a
 * real person the village has not connected to an account yet, and there is
 * nobody for a notification to reach. Those are skipped when counting whether
 * the seat is filled, the same way the map's contact surface skips them.
 */

/** The shape this needs from a seating row. Structural, so the repo owns it. */
export interface SeatRow {
  orgRoleId?: unknown;
  holderKind?: unknown;
  userId?: unknown;
  endedAt?: unknown;
}

/**
 * The member ids that should hear about an arrival.
 *
 * Returns an empty list when nobody can be reached through the seat, and the
 * caller falls back to the admins. Pure, so the decision can be read and tested
 * without a database or a village.
 */
export function greetersFor(roleId: string, seats: readonly SeatRow[]): string[] {
  const wanted = String(roleId ?? "").trim();
  if (!wanted) return [];
  const ids: string[] = [];
  for (const s of seats) {
    if (String(s.orgRoleId ?? "") !== wanted) continue;
    // A seating that has ended is a person who used to greet.
    if (s.endedAt != null) continue;
    // Only a member with an account can be notified.
    if (String(s.holderKind ?? "") !== "member") continue;
    const id = String(s.userId ?? "");
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * The words a greeter reads, and the link that lands them on the person.
 *
 * The name is the arriving member's, because a notification that says "a new
 * member joined" makes somebody go and look up who. The point of telling a
 * greeter is that they can say hello, so the notice carries what they need to
 * do that and nothing else.
 */
export function arrivalNotice(name: string, handle: string): { title: string; link: string } {
  const who = String(name ?? "").trim() || "Someone new";
  const h = String(handle ?? "").trim();
  return {
    title: `${who} just joined. Say hello.`,
    link: h ? `/profile/${h}` : "/members",
  };
}

/**
 * One stable key per arrival, per recipient.
 *
 * `dedupe_key` is NOT NULL with a unique index, and a retried insert is a
 * no-op, so this is what stops a greeter hearing about the same person twice
 * if anything upstream runs again. Keyed on the arriving member rather than on
 * a clock, because the same arrival must produce the same key forever.
 */
export function arrivalDedupeKey(newMemberId: string, recipientId: string): string {
  return `arrival:${newMemberId}:${recipientId}`;
}

/** What `greetArrival` needs from the host, so this file opens no connections. */
export interface GreetDeps {
  /** `arrival.greeter_role`, read through the variables registry. */
  greeterRoleId: string;
  /** Every seating row, live and ended. */
  seats: readonly SeatRow[];
  /** Every member, for the admin fallback. */
  everyone: readonly { id?: unknown; role?: unknown }[];
  notify: (input: {
    userId: string;
    type: string;
    title: string;
    link?: string | null;
    actorUserId?: string | null;
    dedupeKey: string;
  }) => Promise<unknown>;
}

/**
 * Tell whoever greets that somebody arrived.
 *
 * Orchestrated here rather than in the route, because `server/index.ts` is
 * ratcheted on lines and a route module is free on that count. The route calls
 * this once and passes what it already holds.
 *
 * Never throws into the caller. Registration must succeed even when the
 * notification does not: a person who cannot be greeted still joined, and a
 * failed greeting is not a reason to refuse them an account.
 */
export async function greetArrival(
  member: { id: string; name: string; handle: string },
  deps: GreetDeps,
): Promise<string[]> {
  try {
    const seated = greetersFor(deps.greeterRoleId, deps.seats);
    const recipients =
      seated.length > 0
        ? seated
        : deps.everyone
            .filter((u) => u.role === "admin" || u.role === "founder")
            .map((u) => String(u.id ?? ""))
            .filter(Boolean);
    // Never tell somebody they arrived.
    const told = recipients.filter((id) => id !== member.id);
    const { title, link } = arrivalNotice(member.name, member.handle);
    for (const userId of told) {
      await deps.notify({
        userId,
        type: "arrival",
        title,
        link,
        actorUserId: member.id,
        dedupeKey: arrivalDedupeKey(member.id, userId),
      });
    }
    return told;
  } catch {
    return [];
  }
}
