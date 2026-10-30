/**
 * "ROLES THAT FIT THIS CHARACTER", on the character select (/profile/characters).
 *
 * Rye asked for the character selection to be a place "where you can click on
 * what roles you want to apply for and make a proposal". So under the chosen
 * class, the open seats that suit it, each a small card with its circle, its
 * aim and its open places, and a box to add it. Up to five, the most one
 * application holds, and "Propose these" opens "Apply for a seat" with every
 * picked seat already on the list (`applySeatsHref`).
 *
 * ── HOW A CHARACTER MAPS TO A SEAT, AND IT IS NOT A NEW MAPPING ─────────────
 *
 * A character IS a class: `player_characters.archetype_key` holds one of the
 * five keys in shared/archetypes.ts. A seat carries the same keys in
 * `org_roles.archetypes` (0069), which an admin tags. The server already joins
 * the two in `openPathsFor` (server/lib/characters.ts), the read behind this
 * page's "Open paths", so the seats offered here are exactly that answer: the
 * host passes its ids in (`fits`), and nothing on the client guesses at a fit.
 * A seat nobody tagged suits no class here, the same as in "Open paths"; it
 * is still on the chart, and "See every role" goes there.
 *
 * The rest of each card comes from `/api/org` through `loadOrg`, the same one
 * read the wizard's seat list makes, so a seat cannot be offered here under
 * one name and listed there under another.
 *
 * ── WHO MAY PICK ────────────────────────────────────────────────────────────
 *
 * Open means not full: `state` is anything but "filled", the rule
 * SeatPicksField and `applyHrefFor` both apply (red team U4). Picking is for a
 * reader who reads terms, told by the same presence test `applyHrefFor` makes:
 * `/api/org` sends `termsOffer` on a seat only to a reader holding terms.read.
 * Anybody else reads the cards and the sentence MySeason says, before the
 * wizard and never at its Review step (red team U5).
 *
 * Frozen inks on a frozen `bg-white` card, the way this page's class card is
 * built. No `text-gray-*`: that ratchet is full.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { loadOrg } from "@/components/governance/pickSources";
import { MAX_SEATS } from "@shared/seatApplications";
import { applySeatsHref } from "@shared/seatApplyLinks";
import { lineWord, type GeneKeysView } from "@shared/geneKeys";
import { readPeopleGeneKeys } from "@/lib/geneKeysApi";
import { useMyGeneKeys } from "@/components/geneKeys/useMyGeneKeys";

export const ROLES_FIT_WORDS = {
  heading: "Roles that fit this character",
  line: (name: string) => `Open roles on the chart that suit ${name}. Add the ones you want, then propose them in one application.`,
  loading: "Finding the roles.",
  failed: "The roles did not load.",
  retry: "Retry",
  none: "No open role on the chart fits this character yet.",
  add: (seat: string) => `Add ${seat}`,
  picked: (n: number) => `${n} of at most ${MAX_SEATS} picked.`,
  propose: "Propose these",
  pickFirst: "Pick a role to propose it.",
  membersOnly: "Applying for a role opens at the member rung. Once you reach it, you can apply here.",
  every: "See every role",
  places: (n: number) => (n === 1 ? "1 place open" : `${n} places open`),
  /** Every suggestion says why (Rye, 2026-10-23): the character always, and a line the circle lacks when the member carries one. */
  why: (character: string, circle: string | null, line: number | null) =>
    line && circle
      ? `Why you: it suits ${character}, and nobody in ${circle} holds line ${line} (${lineWord(line)}) yet.`
      : `Why you: it suits ${character}.`,
} as const;

/** One seat as this section draws it. */
export interface FitSeat {
  id: string;
  name: string;
  circle: string | null;
  /** The circle's id, so its holders' lines can be read for "Why you". */
  circleId: string | null;
  aim: string | null;
  openPlaces: number;
}

/** Places still to fill: every place on an open or lapsed seat, the gap on a partly held one. */
export function openPlacesOf(seat: { state?: string; seats?: number; holderCount?: number; holders?: Array<{ lapsed?: boolean }> }): number {
  const seats = Math.max(1, Number(seat.seats ?? 1));
  if (seat.state === "open" || seat.state === "expired") return seats;
  const listed = Array.isArray(seat.holders) && seat.holders.length > 0;
  const current = listed ? seat.holders!.filter((h) => !h?.lapsed).length : Number(seat.holderCount ?? 0);
  return Math.max(1, seats - current);
}

/**
 * The fitting seats out of the org chart, in the order the server ranked them
 * (recruiting first). Examples, unknown ids and full seats are left out.
 */
export function fittingSeats(org: { roles?: any[]; circles?: any[] } | null, fitIds: readonly string[]): FitSeat[] {
  const roles = Array.isArray(org?.roles) ? org!.roles : [];
  const circles = Array.isArray(org?.circles) ? org!.circles : [];
  const out: FitSeat[] = [];
  for (const id of fitIds) {
    const r = roles.find((x) => String(x?.id ?? "") === id);
    if (!r || r.isExample || r.state === "filled") continue;
    const circle = circles.find((c) => String(c?.id ?? "") === String(r.circleId ?? ""));
    out.push({
      id,
      name: String(r.name ?? id),
      circle: circle?.name ? String(circle.name) : null,
      circleId: r.circleId ? String(r.circleId) : null,
      aim: r.aim ? String(r.aim) : r.description ? String(r.description) : null,
      openPlaces: openPlacesOf(r),
    });
  }
  return out;
}

/** Everyone holding a role in each circle, by id, as /api/org gives a signed-in member. */
export function holdersByCircle(org: { roles?: any[] } | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of Array.isArray(org?.roles) ? org!.roles : []) {
    const circle = r?.circleId ? String(r.circleId) : "";
    if (!circle) continue;
    for (const h of Array.isArray(r.holders) ? r.holders : []) {
      if (!h?.userId || h?.lapsed) continue;
      const list = out.get(circle) ?? [];
      if (!list.includes(String(h.userId))) list.push(String(h.userId));
      out.set(circle, list);
    }
  }
  return out;
}

/**
 * The member's line a circle has nobody holding, or null. Only lines its holders
 * SHOW count as held, so a hidden member never shows up as a gap filled.
 */
export function lineThisCircleLacks(mine: readonly number[] | null, holders: readonly string[], people: Record<string, GeneKeysView>): number | null {
  if (!mine) return null;
  const held = new Set<number>();
  for (const id of holders) for (const l of people[id]?.lines ?? []) held.add(l);
  return mine.find((l) => !held.has(l)) ?? null;
}

/** True when the chart was read by somebody who reads terms (`termsOffer` is present). */
export function readsTerms(org: { roles?: any[] } | null): boolean {
  return Array.isArray(org?.roles) && org!.roles.some((r) => r && typeof r === "object" && "termsOffer" in r);
}

export default function RolesThatFit({ archetypeName, fits }: { archetypeName: string; fits: readonly string[] | null }) {
  const [org, setOrg] = useState<{ roles?: any[]; circles?: any[] } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [picked, setPicked] = useState<string[]>([]);
  const fitKey = (fits ?? []).join(",");

  const read = () => {
    setStatus("loading");
    void loadOrg().then((o) => {
      setOrg(o);
      setStatus(o ? "ready" : "failed");
    });
  };
  useEffect(read, []);
  // Another character is another list: picks for the last one do not ride along unseen.
  useEffect(() => setPicked([]), [fitKey]);

  const seats = useMemo(() => fittingSeats(org, fits ?? []), [org, fitKey]);
  // "Why you" reads the circles' shown lines once, and only when the member has lines of their own.
  const { on: linesOn, mine } = useMyGeneKeys();
  const circleHolders = useMemo(() => holdersByCircle(org), [org]);
  const [people, setPeople] = useState<Record<string, GeneKeysView>>({});
  const askIds = useMemo(
    () => Array.from(new Set(seats.flatMap((s) => (s.circleId ? circleHolders.get(s.circleId) ?? [] : [])))).sort().join(","),
    [seats, circleHolders],
  );
  useEffect(() => {
    if (!linesOn || !mine || !askIds) return;
    let live = true;
    readPeopleGeneKeys(askIds.split(","))
      .then((p) => live && setPeople(p))
      .catch(() => live && setPeople({}));
    return () => {
      live = false;
    };
  }, [linesOn, mine, askIds]);
  const mayPick = readsTerms(org);
  const atMost = picked.length >= MAX_SEATS;
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_SEATS ? p : [...p, id]));

  return (
    <section aria-labelledby="roles-fit-h" className="mt-6 rounded-2xl bg-white p-6 shadow-lg">
      <h2 id="roles-fit-h" className="text-lg font-display font-bold text-teal-deep">
        {ROLES_FIT_WORDS.heading}
      </h2>
      <p className="mt-1 text-sm text-stone-700">{ROLES_FIT_WORDS.line(archetypeName)}</p>

      {fits === null || status === "loading" ? (
        <p role="status" className="mt-3 text-sm text-stone-700">{ROLES_FIT_WORDS.loading}</p>
      ) : status === "failed" ? (
        <p role="status" className="mt-3 text-sm text-red-700">
          {ROLES_FIT_WORDS.failed}{" "}
          <button type="button" onClick={read} className="min-h-11 font-medium text-teal-deep underline">
            {ROLES_FIT_WORDS.retry}
          </button>
        </p>
      ) : seats.length === 0 ? (
        <p className="mt-3 text-sm text-stone-700">{ROLES_FIT_WORDS.none}</p>
      ) : (
        <>
          {!mayPick && <p className="mt-3 text-sm text-stone-800">{ROLES_FIT_WORDS.membersOnly}</p>}
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {seats.map((s) => {
              const on = picked.includes(s.id);
              const box = `roles-fit-${s.id}`;
              return (
                <li
                  key={s.id}
                  className={`flex flex-col rounded-xl border p-4 ${on ? "border-teal-deep bg-teal-deep/5" : "border-stone-200"}`}
                >
                  <p className="font-semibold text-stone-900">{s.name}</p>
                  {s.circle && <p className="text-xs font-medium uppercase tracking-wide text-sage">{s.circle}</p>}
                  {s.aim && <p className="mt-2 line-clamp-3 text-sm text-stone-700">{s.aim}</p>}
                  <p className="mt-2 text-sm font-medium text-teal-deep">{ROLES_FIT_WORDS.places(s.openPlaces)}</p>
                  <p className="mt-1 text-sm text-stone-700">
                    {ROLES_FIT_WORDS.why(
                      archetypeName,
                      s.circle,
                      linesOn && mine ? lineThisCircleLacks(mine.lines, s.circleId ? circleHolders.get(s.circleId) ?? [] : [], people) : null,
                    )}
                  </p>
                  <div className="mt-auto flex flex-wrap items-center gap-x-3 pt-2">
                    {mayPick && (
                      <label htmlFor={box} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold text-stone-900">
                        <input
                          id={box}
                          type="checkbox"
                          checked={on}
                          disabled={!on && atMost}
                          onChange={() => toggle(s.id)}
                          aria-label={ROLES_FIT_WORDS.add(s.name)}
                          className="size-4 accent-teal-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
                        />
                        Add
                      </label>
                    )}
                    <Link href={`/roles?seat=${encodeURIComponent(s.id)}`} className="min-h-11 py-3 text-sm font-medium text-teal-deep underline">
                      Read the role
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
          {mayPick && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <p className="text-sm text-stone-700" aria-live="polite">
                {ROLES_FIT_WORDS.picked(picked.length)}
              </p>
              {picked.length > 0 ? (
                <Link
                  href={applySeatsHref(picked)}
                  className="inline-flex min-h-11 items-center rounded-lg bg-teal-deep px-5 text-sm font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2"
                >
                  {ROLES_FIT_WORDS.propose}
                </Link>
              ) : (
                <p className="text-sm text-stone-700">{ROLES_FIT_WORDS.pickFirst}</p>
              )}
            </div>
          )}
        </>
      )}
      <Link href="/roles" className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-teal-deep underline">
        {ROLES_FIT_WORDS.every}
      </Link>
    </section>
  );
}
