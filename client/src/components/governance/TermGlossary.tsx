/**
 * "What does this mean?" for the jargon on a terms card and a role's domain.
 * Plain words first, then the official word. No motion: it is a disclosure.
 */
import { GLOSSARY, GLOSSARY_TITLE } from "@shared/termCards";

export default function TermGlossary() {
  return (
    <details className="rounded-xl border border-border bg-card px-3 py-0.5 text-foreground" data-term-glossary="">
      <summary className="flex min-h-11 cursor-pointer list-none items-center text-[13px] font-semibold leading-snug text-foreground [&::-webkit-details-marker]:hidden">
        {GLOSSARY_TITLE}
      </summary>
      <dl className="mb-3 mt-1 grid gap-3">
        {GLOSSARY.map((g) => (
          <div key={g.key} className="grid gap-0.5" data-gloss={g.key}>
            <dt className="break-words text-[13px] leading-snug text-foreground">{g.plain}</dt>
            <dd className="text-[13px] font-semibold uppercase tracking-wide text-foreground">{g.word}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
