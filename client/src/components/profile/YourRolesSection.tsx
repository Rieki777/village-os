/**
 * THE `roles` SECTION OF A PROFILE: "Your roles", in the "now" band.
 *
 * Rye asked for the role proposal process to be found from the profile. This
 * is that door, on your own profile only: the seats you hold, the two acts
 * that lead anywhere ("Apply for a seat" opens the wizard, "Plan your season"
 * opens /season-plans/mine), and every application of yours still open, each
 * a link to its own page with where it stands.
 *
 * TWO READS, BOTH ALREADY THERE. `GET /api/season-plans/mine` carries the seats
 * you hold, the season being planned and `mayApply` (terms.read, the member
 * rung). `GET /api/governance/role-applications` carries the applications,
 * kept here to the ones you are the candidate on that can still move
 * (`OPEN_STATUSES`), from any season. The second read is asked only when the
 * first says you may apply, because it answers 401 to anybody else.
 *
 * A READER BELOW THE MEMBER RUNG is told before the wizard, never at its
 * Review step: the same sentence and the same rule MySeason uses (red team U5).
 *
 * Its own file because Profile.tsx sits under the file-lines ratchet.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { CalendarDays, UserPlus } from "lucide-react";
import { fetchMine, type HeldSeat, type MinePayload } from "@/components/seasonPlans/seasonPlansApi";
import { fetchApplications, type ServedApplication } from "@/components/governance/seatApplicationsApi";
import { OPEN_STATUSES } from "@shared/seatApplications";
import { applySeatsHref } from "@shared/seatApplyLinks";
import { civilDayWords } from "@shared/seasonPlans";

export const YOUR_ROLES_WORDS = {
  heading: "Your roles",
  holding: "The roles you hold.",
  noSeats: "You hold no roles yet.",
  until: (on: string) => `Until ${civilDayWords(on)}`,
  ended: "Its term has ended",
  apply: "Apply for a role",
  plan: "Plan your season",
  applyLine: "Pick up to five roles in one application. The village adopts it, or a role holder does.",
  membersOnly: "Applying for a role opens at the member rung. Once you reach it, you can apply here.",
  openHeading: "Your open applications",
  fits: "Find roles that fit your character",
  every: "See every role",
  failed: "Your roles did not load.",
  retry: "Retry",
} as const;

const PRIMARY =
  "inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-teal-deep px-5 text-sm font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2";
const SECOND =
  "inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-border px-5 text-sm font-semibold text-card-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring";
const QUIET_LINK =
  "inline-flex min-h-11 items-center px-1 text-sm font-medium text-notice underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring";

/** The applications this reader is the candidate on that can still move, newest first. */
export function openApplicationsOf(list: readonly ServedApplication[]): ServedApplication[] {
  return list
    .filter((a) => a.you?.isCandidate === true && OPEN_STATUSES.includes(a.status))
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}

function SeatRow({ seat }: { seat: HeldSeat }) {
  return (
    <li>
      <Link
        href={`/roles?seat=${encodeURIComponent(seat.id)}`}
        className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 rounded-lg border border-border/60 px-3 py-2 text-card-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="font-semibold">{seat.name}</span>
        <span className="text-sm text-muted-foreground">
          {seat.lapsed ? YOUR_ROLES_WORDS.ended : seat.termEndsOn ? YOUR_ROLES_WORDS.until(seat.termEndsOn) : ""}
        </span>
      </Link>
    </li>
  );
}

export default function YourRolesSection() {
  const [mine, setMine] = useState<MinePayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [apps, setApps] = useState<ServedApplication[]>([]);

  const load = useCallback(() => {
    let alive = true;
    setFailed(false);
    void fetchMine().then((a) => {
      if (!alive) return;
      if (a.ok && a.data && typeof a.data === "object") {
        setMine(a.data);
        if (a.data.mayApply !== false) {
          void fetchApplications().then((l) => {
            if (alive && l.ok && Array.isArray(l.data?.applications)) setApps(openApplicationsOf(l.data.applications));
          });
        }
      } else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => load(), [load]);

  const held = mine?.heldSeats ?? [];
  const mayApply = mine ? mine.mayApply !== false : false;

  return (
    <section id="sheet-roles" aria-labelledby="sheet-roles-h" className="scroll-mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <h2 id="sheet-roles-h" className="font-display text-2xl font-bold text-card-foreground">
        {YOUR_ROLES_WORDS.heading}
      </h2>
      {failed ? (
        <p role="status" className="mt-2 text-foreground">
          {YOUR_ROLES_WORDS.failed}{" "}
          <button type="button" onClick={load} className="min-h-11 font-medium text-notice underline underline-offset-2">
            {YOUR_ROLES_WORDS.retry}
          </button>
        </p>
      ) : mine ? (
        <>
          <p className="mt-2 text-foreground">{held.length > 0 ? YOUR_ROLES_WORDS.holding : YOUR_ROLES_WORDS.noSeats}</p>
          {held.length > 0 && (
            <ul className="mt-3 space-y-2">
              {held.map((s) => (
                <SeatRow key={s.id} seat={s} />
              ))}
            </ul>
          )}
          {mayApply ? (
            <>
              <p className="mt-4 text-muted-foreground">{YOUR_ROLES_WORDS.applyLine}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={applySeatsHref([], { seasonId: mine.season?.id ?? null })} className={PRIMARY}>
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  {YOUR_ROLES_WORDS.apply}
                </Link>
                <Link href="/season-plans/mine" className={SECOND}>
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  {YOUR_ROLES_WORDS.plan}
                </Link>
              </div>
            </>
          ) : (
            // A guest is told before the wizard, never at its Review step (red team U5).
            <p className="mt-4 text-foreground">{YOUR_ROLES_WORDS.membersOnly}</p>
          )}
          {apps.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold text-card-foreground">{YOUR_ROLES_WORDS.openHeading}</h3>
              <ul className="mt-2 space-y-2">
                {apps.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={a.href || `/role-applications/${encodeURIComponent(a.id)}`}
                      className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 rounded-lg border border-border/60 px-3 py-2 text-card-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="font-semibold">{a.seats.map((s) => s.name).join(", ")}</span>
                      <span className="text-sm text-notice">{a.statusWords}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-x-4">
        <Link href="/profile/characters" className={QUIET_LINK}>
          {YOUR_ROLES_WORDS.fits}
        </Link>
        <Link href="/roles" className={QUIET_LINK}>
          {YOUR_ROLES_WORDS.every}
        </Link>
      </div>
    </section>
  );
}
