/**
 * The card's top: the owner (the one person it names), their roles line and
 * the day of the season, then one tile per role linking down to it, each with
 * its health in three facts and one dot.
 */
import { CARD_WORDS as W, type HeaderOut, type PlayerCard } from "@shared/playerCard";
import type { HealthDot } from "@shared/playerCardHealth";
import { Eyebrow, LINK, SlotView } from "./cardParts";

const DOT: Record<HealthDot, string> = {
  steady: "bg-open",
  look: "bg-notice",
  act: "bg-destructive",
};

export function CardHeader({ header, walletHref }: { header: HeaderOut; walletHref?: string }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div
        aria-hidden="true"
        className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-4 border-notice/60 bg-muted font-display text-3xl text-card-foreground"
      >
        {header.portrait.kind === "sigil" ? header.portrait.letter : null}
      </div>
      <div className="grid gap-1">
        <h2 className="font-display text-3xl font-bold text-card-foreground">{header.name}</h2>
        {header.rolesLine ? <p className="text-card-foreground">{header.rolesLine}</p> : null}
        <SlotView slot={header.day}>{(d) => <p className="text-sm text-muted-foreground">{d.words}</p>}</SlotView>
        {walletHref ? (
          <a href={walletHref} className={LINK}>
            {W.wallet}
          </a>
        ) : null}
      </div>
    </header>
  );
}

export function RoleTiles({ tiles }: { tiles: PlayerCard["tiles"] }) {
  return (
    <nav aria-label={tiles.heading} className="grid gap-2">
      <Eyebrow gold>{tiles.heading}</Eyebrow>
      <SlotView slot={tiles.items}>
        {(items) => (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((t) => (
              <li key={t.roleId}>
                <a
                  href={`#${t.anchor}`}
                  className="flex min-h-11 flex-col gap-2 rounded-xl border border-border bg-card p-3 text-card-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="font-semibold">{t.title}</span>
                  {t.health ? (
                    <span className="grid gap-1 text-sm text-muted-foreground">
                      <span className="flex items-center gap-2 text-card-foreground">
                        <span className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[t.health.dot]}`} aria-hidden="true" />
                        <span>{t.health.dotWords}</span>
                      </span>
                      {t.health.facts.map((f) => (
                        <span key={f.key}>{f.words}</span>
                      ))}
                    </span>
                  ) : null}
                </a>
              </li>
            ))}
          </ul>
        )}
      </SlotView>
    </nav>
  );
}
