/**
 * AGAINST MY ROLE CARDS, and THE SCORE.
 *
 * The role cards block reads `coverage` exactly as the server computed it:
 * one block per role held, each accountability and deliverable with the kept
 * items under it, the quiet ones marked, then the season goals as chips with
 * their counts and the Outside my roles list with the role each item belongs
 * to (check 23).
 *
 * The score is two rings, task score and role coverage, each with its A4
 * reading: the band's name, its sentence and its context lines. It is the
 * member's alone, so the whole block sits inside `MemberOnly` and Room view
 * removes it.
 */
import {
  MOON_WORDS,
  MY_MOON_WORDS,
  OUTSIDE_MY_ROLES,
  scoreWords,
  type Coverage,
  type MyMoonResponse,
  type Reading,
  type RecapItem,
} from "@shared/moonRecap";
import { CHIP, MemberOnly, MUTED, Ring, Section } from "./moonUi";

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

export function ScoreBlock({ data }: { data: Pick<MyMoonResponse, "taskScore" | "taskReading" | "seatCoverage" | "seatReading"> }) {
  const seat = data.seatCoverage;
  return (
    <MemberOnly>
      <Section title={MY_MOON_WORDS.scoreHeading}>
        <div className="flex flex-col gap-4" data-testid="moon-score">
          <div className="flex items-start gap-3">
            <Ring pct={data.taskScore.pct} label={MY_MOON_WORDS.taskScore} />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="m-0 text-xs uppercase tracking-wide text-muted-foreground">{MY_MOON_WORDS.taskScore}</p>
              <p className="m-0 text-sm text-foreground">{scoreWords(data.taskScore)}</p>
              <ReadingLines reading={data.taskReading} />
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Ring pct={seat.pct} label={MY_MOON_WORDS.roleCoverage} />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="m-0 text-xs uppercase tracking-wide text-muted-foreground">{MY_MOON_WORDS.roleCoverage}</p>
              <p className="m-0 text-sm text-foreground">{seat.total > 0 ? `${seat.on} of ${seat.total}` : MY_MOON_WORDS.noLines}</p>
              <ReadingLines reading={data.seatReading} />
            </div>
          </div>
          <p className={MUTED}>{MY_MOON_WORDS.onlyYou}</p>
        </div>
      </Section>
    </MemberOnly>
  );
}
