/**
 * AGAINST MY ROLE CARDS, and THE SCORE.
 *
 * The role cards block reads `coverage` exactly as the server computed it:
 * one block per role held, each accountability and deliverable with the kept
 * items under it, the quiet ones marked, then the season goals as chips with
 * their counts and the Outside my roles list with the role each item belongs
 * to (check 23).
 *
 * The score is drawn as a garden bed (see ScoreBlock). It is the member's
 * alone, so the whole block sits inside `MemberOnly` and Room view removes it.
 */
import {
  MOON_WORDS,
  MY_MOON_WORDS,
  OUTSIDE_MY_ROLES,
  type Coverage,
  type MyMoonResponse,
  type Reading,
  type RecapItem,
} from "@shared/moonRecap";
import { CHIP, MemberOnly, MUTED, Section } from "./moonUi";

export function RoleCardsBlock({ coverage, items, outsideRoles }: { coverage: Coverage; items: readonly RecapItem[]; outsideRoles: MyMoonResponse["outsideRoles"] }) {
  const textOf = (id: string) => items.find((i) => i.id === id)?.text ?? "";
  return (
    <Section title={MOON_WORDS.againstMyCards}>
      {coverage.roles.map((r) => (
        <div key={r.roleId} className="flex flex-col gap-2" data-testid="coverage-role">
          <h4 className="m-0 text-base font-semibold text-foreground">{r.name}</h4>
          {r.lines.length === 0 ? <p className={MUTED}>{MY_MOON_WORDS.noLines}</p> : null}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {r.lines.map((l) => (
              <li key={`${l.kind}:${l.words}`} className="rounded-lg border border-border p-2">
                <p className="m-0 text-sm font-medium text-foreground">{l.words}</p>
                {l.itemIds.length === 0 ? (
                  <p className="m-0 text-xs text-muted-foreground">{MY_MOON_WORDS.quiet}</p>
                ) : (
                  <ul className="m-0 list-disc pl-5 text-sm text-foreground">
                    {l.itemIds.map((id) => <li key={id}>{textOf(id)}</li>)}
                  </ul>
                )}
              </li>
            ))}
            {r.untagged.length > 0 ? (
              <li className="rounded-lg border border-dashed border-border p-2">
                <p className="m-0 text-sm font-medium text-foreground">{MY_MOON_WORDS.none}</p>
                <ul className="m-0 list-disc pl-5 text-sm text-foreground">
                  {r.untagged.map((id) => <li key={id}>{textOf(id)}</li>)}
                </ul>
              </li>
            ) : null}
          </ul>
        </div>
      ))}

      {coverage.seasonGoals.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h4 className="m-0 text-base font-semibold text-foreground">{MOON_WORDS.seasonGoals}</h4>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {coverage.seasonGoals.map((g) => (
              <li key={g.id} className={CHIP}>
                {g.words} <strong>{g.count}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {coverage.ownGoals.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h4 className="m-0 text-base font-semibold text-foreground">{MOON_WORDS.myGoals}</h4>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {coverage.ownGoals.map((g) => (
              <li key={g.words} className={CHIP}>
                {g.words} <strong>{g.count}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <h4 className="m-0 text-base font-semibold text-foreground">{OUTSIDE_MY_ROLES}</h4>
        {outsideRoles.items.length === 0 ? (
          <p className={MUTED}>{MY_MOON_WORDS.noOutside}</p>
        ) : (
          <ul className="m-0 list-disc pl-5 text-sm text-foreground">
            {outsideRoles.items.map((i) => (
              <li key={i.itemId}>
                {i.text} <span className="text-muted-foreground">· {i.belongsTo}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

function ReadingLines({ reading }: { reading: Reading | null }) {
  if (!reading) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 text-sm font-semibold text-foreground" data-testid="band">{reading.label}</p>
      <p className="m-0 text-sm text-foreground">{reading.says}</p>
      {reading.lines.map((l) => <p key={l} className="m-0 text-xs text-muted-foreground">{l}</p>)}
    </div>
  );
}

/** The garden's own words (the prune, wave 2, C11). Member only, never on the approvers' queue. */
export const GARDEN_WORDS = {
  heading: "Your garden this moon",
  tasks: "What you tended",
  roles: "Your role cards",
  flowered: "flowered",
  bud: "in bud",
  seed: "seed kept",
  tended: "tended",
  resting: "resting",
  nothingYet: "Nothing to count yet",
  note: "A gentle note on this moon",
  onlyYou: "Only you see this garden. It never sets pay and is never ranked.",
} as const;

export type Plant = "flowered" | "bud" | "seed";

/** One plant per counted item, in the order a bed fills: flowers, then buds, then seeds kept. */
export function gardenBed(score: Pick<MyMoonResponse["taskScore"], "done" | "partly" | "carry">): Plant[] {
  const n = (v: number) => Math.max(0, Math.floor(Number(v) || 0));
  return [
    ...Array<Plant>(n(score.done)).fill("flowered"),
    ...Array<Plant>(n(score.partly)).fill("bud"),
    ...Array<Plant>(n(score.carry)).fill("seed"),
  ];
}

function PlantGlyph({ kind }: { kind: Plant | "tended" | "resting" }) {
  return (
    <svg viewBox="0 0 20 24" aria-hidden="true" data-plant={kind} className="h-6 w-5 shrink-0 sm:h-9 sm:w-7">
      <line x1="2" y1="22" x2="18" y2="22" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" className="text-muted-foreground" />
      {kind === "seed" || kind === "resting" ? (
        <ellipse cx="10" cy="19.5" rx="2.2" ry="1.6" className="fill-muted-foreground" />
      ) : (
        <>
          <path d="M10 22 V11" className="stroke-open" strokeWidth="1.5" fill="none" />
          <path d="M10 16 C7 15, 6 13, 6.5 12 C8 12.5, 9.5 14, 10 16 Z" className="fill-open" />
          {kind === "flowered" || kind === "tended" ? (
            <g className="fill-notice">
              <circle cx="10" cy="6" r="2.4" />
              <circle cx="6.8" cy="8.2" r="2.4" />
              <circle cx="13.2" cy="8.2" r="2.4" />
              <circle cx="8" cy="11" r="2.1" />
              <circle cx="12" cy="11" r="2.1" />
              <circle cx="10" cy="8.7" r="1.6" className="fill-background" />
            </g>
          ) : (
            <ellipse cx="10" cy="8.5" rx="2.4" ry="3.4" className="fill-open" />
          )}
        </>
      )}
    </svg>
  );
}

/**
 * THE SCORE, REDRAWN AS A GARDEN BED (the prune, wave 2, C11; member's own view only).
 *
 * The two rings and the percent are gone. What was tended this moon grows as a
 * bed: a flower for each thing done, a bud for each thing partly done, a seed
 * kept for each thing carried, the same three words The Gathering reads back
 * on a Friday. The role cards are beds too, tended or resting. The band
 * sentences stay, folded under a gentle note the member can open. The server's
 * score is unchanged and so is the approvers' queue, which is the lead's
 * decision (D3) and is untouched here.
 */
export function ScoreBlock({ data }: { data: Pick<MyMoonResponse, "taskScore" | "taskReading" | "seatCoverage" | "seatReading"> }) {
  const seat = data.seatCoverage;
  const plants = gardenBed(data.taskScore);
  const tendedBeds = Math.max(0, Math.min(seat.total, seat.on));
  const beds = [
    ...Array<"tended">(tendedBeds).fill("tended"),
    ...Array<"resting">(Math.max(0, seat.total - tendedBeds)).fill("resting"),
  ];
  const said = (n: number, w: string) => (n > 0 ? `${n} ${w}` : "");
  const plantWords = [
    said(data.taskScore.done, GARDEN_WORDS.flowered),
    said(data.taskScore.partly, GARDEN_WORDS.bud),
    said(data.taskScore.carry, GARDEN_WORDS.seed),
  ].filter(Boolean).join(", ");
  return (
    <MemberOnly>
      <Section title={GARDEN_WORDS.heading}>
        <div className="flex flex-col gap-5" data-testid="moon-score">
          <div className="flex flex-col gap-2">
            <p className="m-0 text-xs uppercase tracking-wide text-muted-foreground">{GARDEN_WORDS.tasks}</p>
            {plants.length === 0 ? (
              <p className={MUTED}>{GARDEN_WORDS.nothingYet}</p>
            ) : (
              <div role="img" aria-label={plantWords} data-testid="garden-bed" className="flex flex-wrap items-end gap-1 rounded-xl border border-border bg-muted px-3 py-2">
                {plants.map((p, i) => <PlantGlyph key={i} kind={p} />)}
              </div>
            )}
          </div>
          {seat.total > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="m-0 text-xs uppercase tracking-wide text-muted-foreground">{GARDEN_WORDS.roles}</p>
              <div
                role="img"
                aria-label={[said(tendedBeds, GARDEN_WORDS.tended), said(seat.total - tendedBeds, GARDEN_WORDS.resting)].filter(Boolean).join(", ")}
                data-testid="role-beds"
                className="flex flex-wrap items-end gap-1 rounded-xl border border-border bg-muted px-3 py-2"
              >
                {beds.map((b, i) => <PlantGlyph key={i} kind={b} />)}
              </div>
            </div>
          ) : null}
          {data.taskReading || data.seatReading ? (
            <details className="rounded-lg border border-border p-3">
              <summary className="min-h-11 cursor-pointer text-sm font-medium text-foreground">{GARDEN_WORDS.note}</summary>
              <div className="mt-2 flex flex-col gap-3">
                <ReadingLines reading={data.taskReading} />
                <ReadingLines reading={data.seatReading} />
              </div>
            </details>
          ) : null}
          <p className={MUTED}>{GARDEN_WORDS.onlyYou}</p>
        </div>
      </Section>
    </MemberOnly>
  );
}
