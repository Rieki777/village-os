/**
 * THE END DATE ON EVERY FORM THAT SEATS SOMEBODY.
 *
 * Rye, 2026-09-14: "we need to have the UI created when applying for a seat to
 * have the end date." Every seat has a term since 0199, and a seat with no
 * date asked ends when the running season ends. So every form that seats a
 * person, or asks to be seated, carries this: an optional date, the sentence
 * saying when the seat will end, and any caution, all live as the date moves.
 *
 * One component on four surfaces with three different looks (the map, the
 * admin panel, the proposal wizard), so the classes come in as a `look` and
 * the words and the rule stay here. The rule itself is `previewSeatTerm`,
 * which runs the server's own `resolveSeatTerm`.
 *
 * A REFUSAL IS SHOWN AS THE SERVER WORDS IT. When no season is running, or the
 * running one has no end date, the sentence says so and says what fixes it.
 * The form still lets somebody press the button, because the route is the
 * authority and its answer comes back in the same words.
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { useSeason } from "@/lib/gameApi";
import type { Capability } from "@shared/capabilities";
import { pickerBounds, previewSeatTerm, voteStartsAt } from "./seatTermPreview";

const STEWARD_VETO: Capability = "steward.veto";

/** True for a role whose capability list carries the steward veto. */
export const carriesStewardVeto = (capabilities: unknown): boolean =>
  Array.isArray(capabilities) && capabilities.includes(STEWARD_VETO);

export interface SeatTermLook {
  label: string;
  input: string;
  line: string;
  caution: string;
  refusal: string;
}

/** The map's look: theme tokens, because the map follows the viewer's theme. */
export const MAP_TERM_LOOK: SeatTermLook = {
  label: "block text-xs text-muted-foreground",
  input: "mt-1 w-full text-sm border border-border rounded-lg px-3 py-2 bg-background",
  line: "text-xs text-muted-foreground",
  caution: "text-xs text-amber-700",
  refusal: "text-xs text-red-600",
};

export default function SeatTermField({
  value,
  onChange,
  capAtSeasonEnd = false,
  look = MAP_TERM_LOOK,
  label = "End date (optional)",
  labelNode,
  inputId,
  describedBy,
  now,
  byVote = false,
}: {
  /** A civil date, YYYY-MM-DD, or empty for "with the season". */
  value: string;
  onChange: (next: string) => void;
  /** A steward's seat ends with the season at the latest. */
  capAtSeasonEnd?: boolean;
  look?: SeatTermLook;
  label?: string;
  /** A caller's own <label htmlFor={inputId}>, used in place of `label`. */
  labelNode?: ReactNode;
  inputId?: string;
  describedBy?: string;
  /** The clock, for tests. */
  now?: Date;
  /**
   * True on a form that OPENS A SEAT VOTE. The seat starts when the vote lands,
   * days or weeks after it closes, so the term is measured from the landing the
   * season payload forecasts. Every other form seats somebody now.
   */
  byVote?: boolean;
}) {
  const season = useSeason();
  const autoId = useId();
  const id = inputId ?? autoId;
  const lineId = `${id}-term`;
  const starts = season ? voteStartsAt(season, byVote) : null;
  const bounds = season ? pickerBounds(season, capAtSeasonEnd, starts) : {};
  const preview = season ? previewSeatTerm(season, { requestedEndsOn: value, capAtSeasonEnd, now, startsNoEarlierThan: starts }) : null;

  return (
    <div data-seat-term>
      {labelNode ?? (
        <label htmlFor={id} className={look.label}>
          {label}
        </label>
      )}
      <input
        id={id}
        type="date"
        value={value}
        min={bounds.min}
        max={bounds.max}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={[describedBy, lineId].filter(Boolean).join(" ")}
        className={look.input}
      />
      <div id={lineId} aria-live="polite" className="mt-1 space-y-1">
        {capAtSeasonEnd && <p className={look.line}>A steward's seat ends with the season at the latest.</p>}
        {preview?.state === "ok" && (
          <p className={look.line}>
            {preview.line}{" "}
            {value ? (
              <button type="button" onClick={() => onChange("")} className="underline underline-offset-2">
                End it with the season instead
              </button>
            ) : capAtSeasonEnd ? (
              "Pick a date to end it sooner."
            ) : (
              "Pick a date to end it sooner or later."
            )}
          </p>
        )}
        {preview?.state === "ok" && preview.caution && <p className={look.caution}>{preview.caution}</p>}
        {preview?.state === "refused" && (
          <p role="alert" className={look.refusal}>
            {preview.error}
          </p>
        )}
      </div>
    </div>
  );
}

let rolesCache: Promise<Array<{ id: string; capabilities?: unknown }> | null> | null = null;

/**
 * Whether a permission role carries the steward veto, read from the same
 * public `/api/roles` the wizard's role picker lists. False until it loads,
 * and false for a role it cannot find: the route applies the cap either way.
 */
export function useStewardSeat(roleId: string | null | undefined): boolean {
  const [steward, setSteward] = useState(false);
  useEffect(() => {
    if (!roleId) {
      setSteward(false);
      return;
    }
    let alive = true;
    if (!rolesCache) {
      rolesCache = fetch("/api/roles")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    }
    rolesCache.then((roles) => {
      if (alive) setSteward(carriesStewardVeto((roles ?? []).find((r) => r.id === roleId)?.capabilities));
    });
    return () => {
      alive = false;
    };
  }, [roleId]);
  return steward;
}

/** The field for a form that names a permission role by id. */
export function SeatTermForRole({
  roleId,
  ...rest
}: Omit<Parameters<typeof SeatTermField>[0], "capAtSeasonEnd"> & { roleId: string | null | undefined }) {
  const steward = useStewardSeat(roleId);
  return <SeatTermField {...rest} capAtSeasonEnd={steward} />;
}
