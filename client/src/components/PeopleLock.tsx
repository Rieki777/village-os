/**
 * What a reader is seeing when a village keeps its people for members.
 *
 * R57 made the village's people public by default and gave a village one dial
 * to close them (`org.public_people`, the "secret society" setting). This is
 * the sentence the closed setting owes a reader.
 *
 * ── WHY IT EXISTS AT ALL ─────────────────────────────────────────────────
 *
 * `/api/org` answers a locked-out reader with `holders: []`, which is exactly
 * what it answers when nobody holds a seat yet. A page that renders both the
 * same way tells a visitor the village is empty, and /circles did precisely
 * that: it printed "3 roles, none held yet" over three seats with people in
 * them, because the holder names never arrived. An empty render is not a
 * neutral outcome here, it is a false one.
 *
 * ── WHAT IT MAY AND MAY NOT SAY (R56) ────────────────────────────────────
 *
 * State what is true, then get out of the way. The village chose this, and no
 * sentence here may argue with the choice: there is no "unfortunately", no
 * nudge to go and ask somebody to change it, no hint that open would be
 * better. A COUNT IS A FACT and it is the whole invitation: "18 seats, 12 of
 * them held" says the village is alive and busy without naming one person.
 * Both numbers are already public on every tier, so this adds no exposure.
 *
 * The two closed cases are genuinely different and are told apart, because
 * "sign in" is useless advice to somebody already signed in:
 *
 *   signed out  the names are one sign-in away, so offer the door.
 *   signed in   this village grants seeing its people by role, and this
 *               reader does not hold it. Saying so beats a button that would
 *               land them back where they started.
 */
import { Link, useLocation } from "wouter";
import { Users } from "lucide-react";
import { internalPath } from "@/lib/internalPath";

export interface PeopleTier {
  /** Are holder names in the payload this page just read? */
  visible: boolean;
  /** Has the village closed its people to members? */
  membersOnly: boolean;
  /** Is this reader signed in? */
  signedIn: boolean;
}


export function PeopleLockNote({
  people,
  seats,
  held,
}: {
  people?: PeopleTier | null;
  /** Seats declared across the whole page. */
  seats: number;
  /** How many of them are held. Both numbers come from the public tier. */
  held: number;
}) {
  const [location] = useLocation();
  // Nothing to explain: the names are here, or the village has none to show.
  if (!people || people.visible || held === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-muted/30 p-6 md:p-8 text-center max-w-2xl mx-auto">
      <div className="w-12 h-12 rounded-full bg-sage/10 flex items-center justify-center mx-auto mb-4">
        <Users className="w-6 h-6 text-sage" />
      </div>
      <p className="font-display text-2xl font-bold text-foreground mb-2">
        {seats} {seats === 1 ? "seat" : "seats"}, {held} of them held
      </p>
      <p className="text-muted-foreground mb-6 leading-relaxed">
        This village keeps the names of the people holding them for members. Every circle,
        every seat and every open call is on this page.
      </p>
      {people.signedIn ? (
        <p className="text-sm text-muted-foreground">
          Seeing who holds a seat is granted by role here, and your account does not carry it yet.
        </p>
      ) : (
        <Link
          href={`/login?next=${encodeURIComponent(internalPath(location) ?? "/")}`}
          className="inline-flex items-center min-h-[44px] px-5 rounded-lg bg-teal-deep text-white font-semibold"
        >
          Sign in to see who holds them
        </Link>
      )}
    </div>
  );
}

export default PeopleLockNote;
