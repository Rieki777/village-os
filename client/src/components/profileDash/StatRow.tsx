/**
 * WHERE YOU STAND: the stat row under the hero (approved design, 2026-10-30).
 *
 * Five figures on a desktop, the first four on a phone, each off a payload the
 * page already holds. A figure whose read has not answered is left out rather
 * than drawn as zero, so the row never flashes a number that then corrects
 * itself.
 *
 * THE FIFTH FIGURE IS "POWERS OPEN", NOT A MOON STREAK. The design drew a
 * streak, and this platform keeps none on purpose (shared/sessionTasks.ts and
 * ProfileJourney say why: a streak punishes the moon somebody rests). Powers
 * open was already on the sheet and comes off the same catalogue the skill
 * tree draws from, so the two can never disagree.
 */
import { whole } from "./dashModel";

export interface Stat {
  key: string;
  glyph: string;
  value: number | null;
  label: string;
  /** The phone's one-word label, "Quests" for "Quests done". */
  short: string;
  /** Shown on a phone too. The design's phone row carries four. */
  phone: boolean;
}

export default function StatRow({ stats }: { stats: Stat[] }) {
  const known = stats.filter((s) => typeof s.value === "number" && Number.isFinite(s.value));
  if (known.length === 0) return null;
  return (
    <section aria-label="Where you stand">
      <ul className="m-0 grid list-none grid-cols-4 gap-2 p-0 sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))] sm:gap-4">
        {known.map((s) => (
          <li
            key={s.key}
            className={`${s.phone ? "flex" : "hidden sm:flex"} flex-col items-center gap-0 rounded-xl border border-dash-edge bg-card px-1.5 py-2.5 text-center sm:flex-row sm:items-center sm:gap-3.5 sm:rounded-[18px] sm:px-5 sm:py-[18px] sm:text-left`}
          >
            <span
              aria-hidden="true"
              className="hidden h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full border-2 border-dash-gold text-xl text-dash-gold-lit sm:flex"
            >
              {s.glyph}
            </span>
            <span className="min-w-0">
              <span className="block font-display text-2xl leading-none text-foreground sm:text-4xl">{whole(s.value as number)}</span>
              <span className="mt-0.5 block text-[10px] uppercase tracking-wider text-muted-foreground sm:text-xs sm:tracking-[0.17em]">
                <span className="sm:hidden">{s.short}</span>
                <span className="hidden sm:inline">{s.label}</span>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
