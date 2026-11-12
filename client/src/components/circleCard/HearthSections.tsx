/**
 * THE HEARTH'S SECTIONS (Phase D, lane D1), in the order a newcomer asks:
 * when do we meet, what do we tend, who holds what, what did we decide. Each
 * draws what arrived and decides nothing; a part with nothing to say draws
 * nothing, so a quiet circle stays quiet.
 *
 *   WeMeet       the next meeting, with "I'll be there" filling a Seed of
 *                Life, one circle per person coming. The page's ONE lit act:
 *                the only fireflies on the page sit on its button.
 *   WeTend       the circle's open work as plants (seed, bud, flower).
 *   WhoHolds     each role with its stone, held or open, its holder's card
 *                and the door to apply.
 *   WeDecided    what the circle decided: each decision by consent, and how
 *                its words were adopted, marked with a vesica (two circles
 *                met). A proposal still open never carries one.
 *   LinkedCircles  the circles the threads reach, as doors.
 *   QuietHearth  a circle with no roles yet: one sentence and one door.
 *
 * Words are Lingui messages with their Spanish in es.po; the card's own words
 * (role names, state words, the adoption lines) arrive from the server.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useLingui } from "@lingui/react/macro";
import { ArrowRight } from "lucide-react";
import { Fireflies, SeedOfLife, Vesica } from "@/components/journey/nature";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, CARD_FEATURED, DOOR, EYEBROW, HINT, LINK, TILE } from "@/components/journey/look";
import WorkPayBlock from "@/components/WorkPayBlock";
import type { AdoptionOut, FactsOut, RoleRowOut } from "@shared/circleCard";
import type { CircleDecision } from "@shared/sessionDecisions";
import { CIRCLE_CARD_WORDS as W } from "@shared/circleCardWords";
import { SEED_CIRCLES, seedFill, type LinkedCircle, type PlantState, type TendRow } from "./hearthModel";
import type { MeetState } from "./useHearth";
import { roleRowId } from "./Hearth";
import Plant from "./Plant";

/**
 * Where Live Sessions lives (shared/circleCard.ts `SESSIONS_HREF`). Spelled here
 * because a value import of that module pulls the card's whole server-side model
 * into this chunk, and the build then folded its imports onto the first page.
 */
export const SESSIONS_HREF = "/sessions";

const H2 = "font-display text-xl font-bold text-card-foreground sm:text-2xl";

// ── We meet ─────────────────────────────────────────────────────────────────

/** "Friday 13 November, 18:00", in the reader's language and the village's zone. */
function whenWords(iso: string, locale: string, timeZone: string | null): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      // The village speaks in the 24-hour clock ("Every Friday at 18:00"), so the meeting does too.
      hourCycle: "h23",
      ...(timeZone ? { timeZone } : {}),
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

export function WeMeet({
  meet,
  facts,
  signedIn,
  answer,
}: {
  meet: MeetState | null;
  /** The card's own "How we meet" lines (rhythm, last met), or null when Live Sessions draws nothing. */
  facts: FactsOut | null;
  signedIn: boolean;
  answer: (status: "going" | "declined") => Promise<{ ok: true } | { ok: false; error: string | null }>;
}) {
  const { t, i18n } = useLingui();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const g = meet?.gathering ?? null;
  if (!g && !facts) return null;

  const send = async (status: "going" | "declined") => {
    setBusy(true);
    setSaid(null);
    const out = await answer(status);
    setBusy(false);
    if (out.ok) {
      setSaid(
        status === "going"
          ? t({ message: `We will see you there. Your circle fills the seed.`, context: "circle hearth, we meet" })
          : t({ message: `Thank you for saying. We will miss you this time.`, context: "circle hearth, we meet" }),
      );
    } else {
      setSaid(out.error ?? t({ message: `That did not reach us. Try again in a moment.`, context: "circle hearth, we meet" }));
    }
  };

  const coming =
    !g || g.going === 0
      ? t({ message: `Nobody has said yet. The seed fills as we say we will come.`, context: "circle hearth, we meet" })
      : g.going === 1
        ? t({ message: `One of us said they will be there.`, context: "circle hearth, we meet" })
        : t({ message: `${g.going} of us said we will be there.`, context: "circle hearth, we meet" });
  const mayAnswer = !!g && signedIn && meet!.answersOpen && g.answerHere;
  // A gathering on the calendar says the next meeting itself, so the card's own "Next meeting" line steps aside.
  const nextPrefix = W.nextMeeting("");
  const lines = facts ? facts.lines.filter((l) => !g || !l.startsWith(nextPrefix)) : [];

  return (
    <section aria-labelledby="hearth-meet-h" className={CARD_FEATURED} data-hearth-meet="" data-going={g?.going ?? ""}>
      <p id="hearth-meet-h" className={EYEBROW}>
        {t({ message: `We meet`, context: "circle hearth, we meet" })}
      </p>
      {g ? <p className="mt-2 font-display text-xl leading-snug text-card-foreground sm:text-2xl">{whenWords(g.startsAt, i18n.locale, meet!.timezone)}</p> : null}
      {lines.length ? (
        <div className="mt-2 grid gap-1">
          {lines.map((l, i) => (
            <p key={i} className={HINT}>
              {l}
            </p>
          ))}
        </div>
      ) : null}
      {g ? (
        <div className="mt-4 flex items-center gap-4 lg:flex-col lg:text-center">
          <SeedOfLife
            size="md"
            total={SEED_CIRCLES}
            walked={seedFill(g.going)}
            current={-1}
            label={t({ message: `The seed for this meeting: ${seedFill(g.going)} of ${SEED_CIRCLES} circles filled`, context: "circle hearth, we meet" })}
          />
          <p className="text-sm text-card-foreground">{coming}</p>
        </div>
      ) : null}
      {mayAnswer ? (
        <div className="mt-5 grid gap-3">
          {g!.mine ? (
            <>
              <p className="text-sm font-medium text-open">{t({ message: `You said you will be there.`, context: "circle hearth, we meet" })}</p>
              <button type="button" disabled={busy} onClick={() => void send("declined")} className={BTN_SECONDARY}>
                {t({ message: `I can't come after all`, context: "circle hearth, we meet" })}
              </button>
            </>
          ) : (
            <>
              <Fireflies block count={6}>
                <button type="button" disabled={busy} onClick={() => void send("going")} className={`${BTN_PRIMARY} w-full`} data-next-act="">
                  {t({ message: `I'll be there`, context: "circle hearth, we meet" })}
                </button>
              </Fireflies>
              <button type="button" disabled={busy} onClick={() => void send("declined")} className={BTN_SECONDARY}>
                {t({ message: `I can't come this time`, context: "circle hearth, we meet" })}
              </button>
            </>
          )}
        </div>
      ) : g && signedIn && meet!.answersOpen && !g.answerHere ? (
        <Link href="/events" className={`${LINK} mt-4 inline-flex min-h-11 items-center`}>
          {t({ message: `Answer on the calendar`, context: "circle hearth, we meet" })}
        </Link>
      ) : null}
      {said ? (
        <p role="status" className="mt-3 text-sm text-card-foreground">
          {said}
        </p>
      ) : null}
      {facts && !g
        ? facts.links.map((l) => (
            <Link key={l.href} href={l.href} className={`${LINK} mt-3 inline-flex min-h-11 items-center`}>
              {l.label}
            </Link>
          ))
        : null}
    </section>
  );
}

// ── What we tend ────────────────────────────────────────────────────────────

export function WeTend({ tend }: { tend: { rows: TendRow[]; more: number } | null }) {
  const { t } = useLingui();
  if (!tend || !tend.rows.length) return null;
  const state: Record<PlantState, string> = {
    seed: t({ message: `A seed, waiting for hands`, context: "circle hearth, a plant" }),
    bud: t({ message: `In bud, being carried`, context: "circle hearth, a plant" }),
    flower: t({ message: `Flowered`, context: "circle hearth, a plant" }),
  };
  return (
    <section aria-labelledby="hearth-tend-h" className={CARD} data-hearth-tend="">
      <p id="hearth-tend-h" role="heading" aria-level={2} className={EYEBROW}>
        {t({ message: `What we tend`, context: "circle hearth, what we tend" })}
      </p>
      <ul className="mt-4 grid gap-3">
        {tend.rows.map((r) => (
          <li key={r.id}>
            <Link href={r.href} className={`${TILE} flex min-h-11 items-center gap-3 hover:border-notice`} data-tend={r.plant}>
              <Plant state={r.plant} />
              <span className="grid min-w-0">
                <span className="font-medium text-card-foreground">{r.title}</span>
                <span className="text-xs text-muted-foreground">{state[r.plant]}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {tend.more > 0 ? (
        <Link href="/quests" className={`${LINK} mt-3 inline-flex min-h-11 items-center text-sm`}>
          {t({ message: `See all our work on the quest board`, context: "circle hearth, what we tend" })}
        </Link>
      ) : null}
    </section>
  );
}

// ── Who holds what ──────────────────────────────────────────────────────────

export function WhoHolds({ roles, heading, note }: { roles: RoleRowOut[]; heading: string; note: string | null }) {
  const { t } = useLingui();
  return (
    <section aria-label={heading} className={CARD} data-hearth-holds="" data-circle-roles="">
      <p role="heading" aria-level={2} className={EYEBROW}>
        {t({ message: `Who holds what`, context: "circle hearth, who holds what" })}
      </p>
      <p className={`${H2} sr-only`}>{heading}</p>
      <ul className="mt-2 divide-y divide-border">
        {roles.map((r) => (
          <li key={r.id} id={roleRowId(r.id)} className="grid scroll-mt-28 gap-1 py-3" data-circle-role={r.id}>
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full border font-display ${r.filled ? "border-open text-foreground" : "border-dashed border-border text-muted-foreground"}`}
              >
                {r.name.trim().charAt(0).toLocaleUpperCase()}
              </span>
              <div className="grid min-w-0 flex-1">
                <Link href={r.href} className="inline-flex min-h-11 items-center font-medium text-card-foreground underline-offset-2 hover:underline">
                  {r.name}
                </Link>
                <span className={`text-xs ${r.filled ? "text-muted-foreground" : "text-notice"}`}>{r.stateWords}</span>
              </div>
            </div>
            {r.pay ? (
              <div className="pl-12 text-xs">
                <WorkPayBlock pay={r.pay} />
              </div>
            ) : null}
            {r.holderCards.length || r.applyHref ? (
              <div className="flex flex-wrap gap-x-4 pl-12">
                {r.holderCards.map((h) => (
                  <Link key={h.href} href={h.href} aria-label={h.ariaLabel} className={`${LINK} inline-flex min-h-11 items-center text-sm`}>
                    {h.label}
                  </Link>
                ))}
                {r.applyHref ? (
                  <Link href={r.applyHref} className={`${LINK} inline-flex min-h-11 items-center text-sm`}>
                    {r.applyLabel}
                  </Link>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {note ? <p className={`${HINT} mt-2`}>{note}</p> : null}
    </section>
  );
}

// ── What we decided ─────────────────────────────────────────────────────────

/** How many decisions the hearth shows; the whole log is on Sessions. */
export const DECIDED_MAX = 5;

/** A village date (YYYY-MM-DD) in the reader's language: "5 Nov 2026", "5 nov 2026". */
function dayWords(key: string, locale: string): string {
  const t = Date.parse(`${key}T12:00:00Z`);
  if (Number.isNaN(t)) return key;
  try {
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(t));
  } catch {
    return key;
  }
}

export function WeDecided({ decisions, adoption }: { decisions: CircleDecision[] | null; adoption: AdoptionOut | null }) {
  const { t, i18n } = useLingui();
  const shown = (decisions ?? []).slice(0, DECIDED_MAX);
  const adopted = adoption ? (adoption.lines.length ? adoption.lines.map((l) => ({ what: l.what, how: l.how })) : [{ what: adoption.latest, how: "" }]) : [];
  if (!shown.length && !adopted.length) return null;
  const consent = t({ message: `Decided by consent`, context: "circle hearth, what we decided" });
  return (
    <section aria-labelledby="hearth-decided-h" className={CARD} data-hearth-decided="">
      <p id="hearth-decided-h" role="heading" aria-level={2} className={EYEBROW}>
        {t({ message: `What we decided`, context: "circle hearth, what we decided" })}
      </p>
      <ul className="mt-2 divide-y divide-border">
        {shown.map((d) => (
          <li key={`d-${d.entryId}`} className="flex items-start gap-3 py-3" data-decided="session">
            <Vesica met size="sm" label={consent} className="mt-0.5 shrink-0" />
            <div className="grid min-w-0">
              <p className="text-card-foreground">{d.text}</p>
              <p className="text-xs text-muted-foreground">{t({ message: `By consent, ${dayWords(d.decidedOn, i18n.locale)}`, context: "circle hearth, what we decided" })}</p>
            </div>
          </li>
        ))}
        {adopted.map((a, i) => (
          <li key={`a-${i}`} className="flex items-start gap-3 py-3" data-decided="words">
            <Vesica met size="sm" label={t({ message: `Our words, adopted`, context: "circle hearth, what we decided" })} className="mt-0.5 shrink-0" />
            <div className="grid min-w-0">
              <p className="text-card-foreground">{a.what}</p>
              {a.how ? <p className="text-xs text-muted-foreground">{a.how}</p> : null}
            </div>
          </li>
        ))}
      </ul>
      {decisions && decisions.length ? (
        <Link href={SESSIONS_HREF} className={`${LINK} mt-2 inline-flex min-h-11 items-center text-sm`}>
          {t({ message: `The whole log and its review dates are in Sessions`, context: "circle hearth, what we decided" })}
        </Link>
      ) : null}
    </section>
  );
}

// ── Linked circles ──────────────────────────────────────────────────────────

export function LinkedCircles({ links }: { links: readonly LinkedCircle[] }) {
  const { t } = useLingui();
  if (!links.length) return null;
  return (
    <section aria-labelledby="hearth-links-h" className={CARD} data-hearth-links="">
      <p id="hearth-links-h" role="heading" aria-level={2} className={EYEBROW}>
        {t({ message: `Linked circles`, context: "circle hearth, linked circles" })}
      </p>
      <ul className="mt-3 grid gap-2">
        {links.map((l) => (
          <li key={l.id}>
            <Link href={l.href} className={DOOR}>
              <span className="grid min-w-0">
                <span className="truncate">{l.name}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {l.how === "parent"
                    ? t({ message: `We sit within this circle`, context: "circle hearth, linked circles" })
                    : t({ message: `This circle sits within ours`, context: "circle hearth, linked circles" })}
                </span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground group-hover:text-notice" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── The quiet hearth ────────────────────────────────────────────────────────

/** A circle with no roles yet: the embers, one sentence and one door. */
export function QuietHearth({ signedIn }: { signedIn: boolean }) {
  const { t } = useLingui();
  return (
    <div className="grid justify-items-center gap-3 text-center" data-hearth-quiet="">
      <p className={HINT}>{t({ message: `No roles sit at this hearth yet. The fire is lit for the first.`, context: "circle hearth, quiet" })}</p>
      <Link href={signedIn ? "/role-proposals/new" : "/propose-a-role"} className={BTN_SECONDARY}>
        {t({ message: `Propose a role for this circle`, context: "circle hearth, quiet" })}
      </Link>
    </div>
  );
}
