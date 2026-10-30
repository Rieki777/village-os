/**
 * THE SEASON SUMMARY CARD, as the member reads it on their own profile (idea 4).
 *
 * The member's screen shows everything, cash included, because it is theirs.
 * A section the member has left out of the shared picture says so beside its
 * heading, so what they see and what they post are never confused.
 *
 * Drawn in the profile's night world (`.sheet-night` in index.css): every
 * colour is a token, so a village's own gold reaches it.
 */
import { formatMoney } from "@shared/money";
import { CONTRIBUTION_WORDS, type SeasonSummary, type ShareChoices } from "@shared/seasonSummary";
import { amountText, firstName, seasonSpan, termText } from "@/lib/seasonCard";
import { useTokenName } from "@/hooks/useTokenNames";

function Heading({ children, shared }: { children: string; shared: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <h4 className="text-xs font-semibold uppercase tracking-widest text-notice">{children}</h4>
      {!shared && <span className="text-xs text-muted-foreground">Only you see this</span>}
    </div>
  );
}

export default function SeasonSummaryCard({ summary, choices }: { summary: SeasonSummary; choices: ShareChoices }) {
  const s = summary;
  const thanks = useTokenName();
  const who = firstName(s.member.name);
  const earned = [...s.tokens, ...s.voice];
  const nothingYet =
    earned.length === 0 && s.cash.length === 0 && s.top.length === 0 && s.badges.length === 0 &&
    s.gratitude.sentNotes === 0 && s.gratitude.receivedNotes === 0;

  return (
    <article
      aria-labelledby="season-summary-title"
      className="relative overflow-hidden rounded-2xl border border-notice bg-card p-6 text-card-foreground shadow-sm sm:p-8 space-y-6"
    >
      <header className="text-center space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-notice">
          {s.season.name} · {seasonSpan(s.season)}
        </p>
        <h3 id="season-summary-title" className="font-display text-4xl sm:text-5xl">
          {who ? `${who}'s season` : "Your season"}
        </h3>
        {!s.season.closed && <p className="text-sm text-muted-foreground">This season is still running. The summary so far.</p>}
      </header>

      {nothingYet && (
        <p className="text-center text-sm text-muted-foreground">
          Nothing was recorded for you in this season. The next one is yours to fill.
        </p>
      )}

      {earned.length > 0 && (
        <section className="space-y-2">
          <Heading shared={choices.earnings}>What you earned</Heading>
          <ul className="flex flex-wrap gap-2">
            {earned.map((t) => (
              <li key={t.token} className="rounded-full border border-border px-4 py-1.5 text-sm">
                <span className="font-semibold">{amountText(t.amount)}</span> {t.name}
              </li>
            ))}
          </ul>
        </section>
      )}

      {s.cash.length > 0 && (
        <section className="space-y-2">
          <Heading shared={choices.cash}>Cash</Heading>
          <ul className="space-y-1 text-sm">
            {s.cash.map((c) => (
              <li key={c.currency}>
                <span className="font-semibold">{formatMoney(c.earnedMinor, c.currency)}</span> earned,{" "}
                {formatMoney(c.paidMinor, c.currency)} paid so far
              </li>
            ))}
          </ul>
        </section>
      )}

      {(s.gratitude.sentNotes > 0 || s.gratitude.receivedNotes > 0) && (
        <section className="space-y-2">
          <Heading shared={choices.gratitude}>{thanks}</Heading>
          <p className="text-sm">
            You sent {s.gratitude.sentNotes} {s.gratitude.sentNotes === 1 ? "note" : "notes"}
            {s.gratitude.people > 0 ? ` to ${s.gratitude.people} ${s.gratitude.people === 1 ? "person" : "people"}` : ""}, and
            received {s.gratitude.receivedNotes}.
          </p>
        </section>
      )}

      {s.top.length > 0 && (
        <section className="space-y-2">
          <Heading shared>What you carried</Heading>
          <ol className="space-y-2">
            {s.top.map((c) => (
              <li key={`${c.kind}:${c.id}`} className="rounded-xl border border-border bg-muted p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">{CONTRIBUTION_WORDS[c.kind]}</p>
                <p className="font-semibold">{c.title}</p>
                {c.kind === "role" && c.term && <p className="text-sm text-muted-foreground">{termText(c.term)}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {s.badges.length > 0 && (
        <section className="space-y-2">
          <Heading shared>Badges</Heading>
          <ul className="flex flex-wrap gap-2">
            {s.badges.map((b) => (
              <li key={b.id} className="rounded-full border border-notice px-4 py-1.5 text-sm text-notice">
                {b.name}{b.count > 1 ? ` ×${b.count}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-center font-display text-xl italic text-notice">Thank you for the season</p>
    </article>
  );
}
