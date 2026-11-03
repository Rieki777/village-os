/**
 * "What does this mean?" for the jargon on a terms card and a role's domain.
 * Plain words first, then the official word. No motion: it is a disclosure.
 */
import { GLOSSARY, GLOSSARY_TITLE } from "@shared/termCards";

export default function TermGlossary() {
  return (
    <details className="rounded-xl border border-border bg-card p-3 text-foreground" data-term-glossary="">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
        {GLOSSARY_TITLE}
      </summary>
      <dl className="mt-2 grid gap-3">
        {GLOSSARY.map((g) => (
          <div key={g.key} className="grid gap-0.5" data-gloss={g.key}>
            <dt className="break-words text-sm text-foreground">{g.plain}</dt>
            <dd className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.word}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
