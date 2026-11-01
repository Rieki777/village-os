/**
 * The choices on the last step of finding your lines (client/src/pages/GeneKeys.tsx):
 * who sees them, whether Maia may use them, and, only when the member came
 * from a session card's invitation, whether session cards read them.
 *
 * Consent is never implied. Each choice is a box of its own with its own words,
 * and every box starts as the member left it last time (`seedChoices`), so a
 * newcomer starts with nothing ticked beyond the page's long-standing "show"
 * for who sees the lines. A page reached any other way asks nothing about cards
 * and sends no card answer, so an earlier answer stands (`savePayload`).
 */
import type { OwnGeneKeysView } from "@shared/geneKeys";

export interface Choices {
  visibility: "show" | "hide";
  maia: boolean;
  cards: boolean;
}

export const SHARE_WORDS = {
  maia: "Let Maia use my lines to guide me",
  maiaLine: "Maia shapes quest and role suggestions to how you work best.",
  cards: "Read me on session cards",
  cardsLine: "When a live session pulls a card, it reads your lines too, while they are shown and Maia may use them. Your own line on it is private to you until you share it.",
} as const;

/** The boxes as the member left them, or nothing ticked for somebody new. */
export function seedChoices(before: OwnGeneKeysView | null | undefined): Choices {
  return before
    ? { visibility: before.visibility, maia: before.maia, cards: before.inCards }
    : { visibility: "show", maia: false, cards: false };
}

/** The choices as the save sends them: a card answer only when the page asked for one. */
export function savePayload(c: Choices, fromCard: boolean): { visibility: "show" | "hide"; maia: boolean; cards?: boolean } {
  return fromCard ? { visibility: c.visibility, maia: c.maia, cards: c.cards } : { visibility: c.visibility, maia: c.maia };
}

function Box({ checked, onChange, title, line }: { checked: boolean; onChange: (v: boolean) => void; title: string; line: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-1 h-5 w-5 accent-notice" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex flex-col">
        <span className="font-medium">{title}</span>
        <span className="text-sm text-muted-foreground">{line}</span>
      </span>
    </label>
  );
}

export default function ShareChoices({ fromCard, choices, onChange }: { fromCard: boolean; choices: Choices; onChange: (c: Choices) => void }) {
  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Who sees your lines</legend>
        {(
          [
            ["show", "Show them on my profile", "Your seal sits by your portrait. Your circle sees your lines."],
            ["hide", "Keep them to me", "Only you see them. Nobody else, anywhere."],
          ] as const
        ).map(([value, title, line]) => (
          <label key={value} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-4">
            <input
              type="radio"
              name="gk-visibility"
              className="mt-1 h-5 w-5 accent-notice"
              checked={choices.visibility === value}
              onChange={() => onChange({ ...choices, visibility: value })}
            />
            <span className="flex flex-col">
              <span className="font-medium">{title}</span>
              <span className="text-sm text-muted-foreground">{line}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Box checked={choices.maia} onChange={(maia) => onChange({ ...choices, maia })} title={SHARE_WORDS.maia} line={SHARE_WORDS.maiaLine} />
      {fromCard ? (
        <Box checked={choices.cards} onChange={(cards) => onChange({ ...choices, cards })} title={SHARE_WORDS.cards} line={SHARE_WORDS.cardsLine} />
      ) : null}
    </>
  );
}
