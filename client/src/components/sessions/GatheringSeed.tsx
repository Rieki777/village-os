/**
 * "I'LL BE THERE", on a circle's row in Coming up (Phase C, the Gathering).
 *
 * The answer is the gatherings' own `going` (the lead's decision 1, no new
 * table): a circle's rhythm is one recurring gathering on the village
 * calendar, so the next meeting is one evening of it, and the button writes
 * through the gatherings' own door, `POST /api/events/:id/rsvp` with that
 * evening's `occurrenceKey`; "I can't come after all" takes it back with
 * `DELETE`. Every write reads `res.ok` before it says anything, and then the
 * page reads the list again, so the seed shows what the server holds.
 *
 * THE SEED OF LIFE fills one circle for each of us who said we will come,
 * seven at most; the seventh opens the seed's petals once (a bloom, never a
 * burst). While the viewer has not said, the next open circle waits in
 * firefly light: there is room for you. The circle's own members and admins
 * read the first names, alphabetical; anybody else reads how many. Nobody is
 * ordered by anything they did.
 *
 * One lit act per screen: the fireflies gather on "I'll be there" only on the
 * row the page names as `lead` (the viewer's own circle that meets soonest
 * and has not heard from them).
 *
 * Phone and desktop: on a phone the seed sits beside the words and the
 * button takes the row's width, under the thumb. On a desktop the seed grows,
 * and the words and the act sit in a line beside it.
 */
import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import type { ComingUpRow, SessionGathering } from "@shared/sessionRhythm";
import { circleWords } from "@shared/sessionTasks";
import { gameFetch } from "@/lib/gameApi";
import { Fireflies, SeedOfLife } from "@/components/journey/nature";
import { BTN_PRIMARY, BTN_QUIET, HINT } from "./roomUi";

/** The seed's seven circles. */
export const SEED_CIRCLES = 7;

/** How many circles of the seed are filled for this many answers. */
export function seedFilled(going: number): number {
  return Math.max(
    0,
    Math.min(SEED_CIRCLES, Math.floor(Number.isFinite(going) ? going : 0))
  );
}

/** "Ana, Ben and Zoe", in the reader's own language. */
function listOf(names: readonly string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, {
      style: "long",
      type: "conjunction",
    }).format(names);
  } catch {
    return names.join(", ");
  }
}

/** The server's sentence when it sent one, or null for a bare code. */
async function sentenceOf(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: unknown; message?: unknown };
    const text =
      typeof body?.message === "string"
        ? body.message
        : typeof body?.error === "string"
          ? body.error
          : "";
    return /\s/.test(text.trim()) ? text.trim() : null;
  } catch {
    return null;
  }
}

export interface GatheringSeedProps {
  row: ComingUpRow & { gathering: SessionGathering };
  /** The one lit act on the page: fireflies gather on this row's button. */
  lead?: boolean;
  onChanged: () => Promise<void> | void;
  onSaid?: (text: string) => void;
}

export default function GatheringSeed({
  row,
  lead = false,
  onChanged,
  onSaid,
}: GatheringSeedProps) {
  const { t, i18n } = useLingui();
  const g = row.gathering;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filled = seedFilled(g.going);
  const circle = circleWords(row.circleName);
  const failed = t({
    message: "That did not go through. Try again in a moment.",
    context: "coming up, i'll be there",
  });

  const answer = async (coming: boolean) => {
    setBusy(true);
    setError(null);
    const base = `/api/events/${encodeURIComponent(g.eventId)}/rsvp`;
    let ok = false;
    try {
      const res = coming
        ? await gameFetch(base, {
            method: "POST",
            body: JSON.stringify({
              status: "going",
              occurrenceKey: g.occurrenceKey,
            }),
          })
        : await gameFetch(
            `${base}?occurrence=${encodeURIComponent(g.occurrenceKey)}`,
            { method: "DELETE" }
          );
      ok = res.ok;
      if (!ok) setError((await sentenceOf(res)) ?? failed);
    } catch {
      setError(failed);
    }
    await onChanged();
    setBusy(false);
    if (ok)
      onSaid?.(
        coming
          ? t({
              message: `Thank you. The ${circle} will see you there.`,
              context: "coming up, i'll be there, said once it lands",
            })
          : t({
              message: `Thank you for saying. Your circle in the seed is open again.`,
              context: "coming up, i'll be there, said once it is taken back",
            })
      );
  };

  const named = g.names.length;
  const names = listOf(g.names, i18n.locale);
  const who =
    g.going === 0
      ? t({
          message:
            "Nobody has said yet. The seed fills as we say we will come.",
          context: "coming up, i'll be there",
        })
      : g.names.length > 0
        ? t({
            message: plural(named, {
              one: `${names} said they will be there.`,
              other: `${names} said they will be there.`,
            }),
            context: "coming up, i'll be there, the names of who said so",
          })
        : t({
            message: plural(g.going, {
              one: "# of us said we will be there.",
              other: "# of us said we will be there.",
            }),
            context: "coming up, i'll be there, how many said so",
          });
  const seedLabel = t({
    message: plural(filled, {
      one: "Seed of Life, # of seven circles filled",
      other: "Seed of Life, # of seven circles filled",
    }),
    context: "coming up, the seed drawing",
  });
  const act = (
    <button
      type="button"
      className={`w-full sm:w-auto ${BTN_PRIMARY}`}
      disabled={busy}
      onClick={() => void answer(true)}
      aria-describedby={`${row.circleId}-seed-who`}
    >
      {t({
        message: "I'll be there",
        context: "coming up, the answer to a meeting",
      })}
    </button>
  );

  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-border pt-3"
      data-testid="gathering-seed"
      data-going={g.going}
      data-mine={g.mine ? "true" : "false"}
    >
      <SeedOfLife
        total={SEED_CIRCLES}
        walked={filled}
        current={g.mine ? SEED_CIRCLES : undefined}
        glowCurrent={false}
        bloom
        size="sm"
        label={seedLabel}
        className="sm:size-16"
      />
      <div className="min-w-0 flex-1 basis-40">
        <p id={`${row.circleId}-seed-who`} className="text-sm text-foreground">
          {who}
        </p>
        {g.mine && (
          <p className={`${HINT} text-open`}>
            {t({
              message: "You said you will be there.",
              context: "coming up, i'll be there",
            })}
          </p>
        )}
      </div>
      {!row.openRoom && (
        <div className="w-full sm:w-auto">
          {g.mine ? (
            <button
              type="button"
              className={BTN_QUIET}
              disabled={busy}
              onClick={() => void answer(false)}
            >
              {t({
                message: "I can't come after all",
                context: "coming up, taking back i'll be there",
              })}
            </button>
          ) : lead ? (
            <Fireflies block>{act}</Fireflies>
          ) : (
            act
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="w-full text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
