/**
 * DOORS OPEN TO YOU (the prune, waves 1 and 2, display only; 11 Nov 2026).
 *
 * This panel used to say "Stage reached · You are a Member", draw the whole
 * twelve-rung ladder as a strip with "stage 5 of 12", and count the quests
 * left to the next rung. Nothing scores or ranks a person, so it now draws the
 * doors a person has actually walked through, each named by what it lets them
 * do, as one circle of a seed per door. Never "how far up", never what is
 * ahead. The gate, the stage ids and every floor are untouched: the doors come
 * off the same capability catalogue the gate itself serves.
 *
 * The next step is the server's own `nextAction` (server/lib/nextAction.ts),
 * drawn only where the Your path card is not already saying it, so there is
 * still one answer to "what now" on the page.
 *
 * Dismissing it hides it until a new door opens. The choice is kept in this
 * browser per set of doors.
 */
import { useEffect, useId, useState } from "react";
import { Link } from "wouter";
import { readStored, writeStored } from "@/lib/safeStorage";
import { doorsWalked, youCanNow, type DoorCapability } from "@shared/doorsOpened";
import { BTN_GOLD, KICKER, LINK } from "./dashUi";

const DISMISS_KEY = "profile.doorsPanel.dismissed";

export default function StagePanel({
  catalogue,
  stages,
  nextAction,
}: {
  catalogue: readonly DoorCapability[];
  stages: ReadonlyArray<{ id: string }>;
  nextAction: { label: string; href: string } | null;
}) {
  const doors = doorsWalked(catalogue, stages).flatMap((g) => g.doors);
  const signature = doors.join("|");
  const headingId = useId();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const got = readStored("local", DISMISS_KEY);
    setDismissed(got.status === "value" && got.value === signature);
  }, [signature]);

  if (dismissed || (doors.length === 0 && !nextAction)) return null;

  const dismiss = () => {
    writeStored("local", DISMISS_KEY, signature);
    setDismissed(true);
  };

  return (
    <section
      aria-labelledby={headingId}
      data-testid="doors-panel"
      className="relative flex flex-wrap items-start gap-7 rounded-2xl border border-border bg-card p-4 shadow-sm sm:px-7 sm:py-6"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Hide until a new door opens"
        className="absolute right-3 top-3 hidden h-11 w-11 items-center justify-center rounded-lg text-2xl text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex"
      >
        <span aria-hidden="true">×</span>
      </button>

      {doors.length > 0 ? (
        <div className="flex min-w-0 flex-[1_1_460px] flex-col gap-3">
          <div>
            <p className={KICKER}>Doors open to you</p>
            <h2 id={headingId} className="m-0 font-display text-[26px] leading-tight sm:text-[32px]">
              What you can do here
            </h2>
          </div>
          {/* One circle per door walked through, overlapping like the seed of life grows: the seed is the
              set of doors, never a position on a ladder. Drawn, then named in words beside it. */}
          <ul className="m-0 flex list-none flex-col gap-2 p-0 sm:grid sm:grid-cols-2 sm:gap-x-6">
            {doors.map((d) => (
              <li key={d} className="flex min-h-11 items-center gap-3 text-[15px] text-foreground">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6 shrink-0 text-open">
                  <circle cx="12" cy="12" r="7" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="1.5" />
                  <circle cx="12" cy="12" r="2" fill="currentColor" />
                </svg>
                <span>{youCanNow(d)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {nextAction ? (
        <div className="flex w-full flex-[1_1_300px] items-center gap-3 rounded-xl border border-dash-gold-edge bg-dash-next p-3.5 sm:flex-col sm:items-stretch sm:gap-2.5 sm:p-5">
          <div className="min-w-0 flex-1">
            <p className={KICKER} id={doors.length === 0 ? headingId : undefined}>
              Your next step
            </p>
            <p className="m-0 mt-0.5 text-base font-medium sm:font-display sm:text-[26px] sm:leading-tight">{nextAction.label}</p>
          </div>
          <Link href={nextAction.href} className={`${BTN_GOLD} shrink-0 self-center sm:self-start`}>
            Go <span aria-hidden="true">→</span>
          </Link>
          <p className="m-0 mt-1 hidden text-[13px] text-muted-foreground sm:block">
            Other ways forward:{" "}
            <Link href="/propose-quest" className={LINK}>
              Propose a quest
            </Link>{" "}
            ·{" "}
            <Link href="/roles" className={LINK}>
              Apply for a role
            </Link>
          </p>
        </div>
      ) : null}
    </section>
  );
}
