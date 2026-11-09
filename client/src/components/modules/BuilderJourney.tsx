/**
 * THE BUILDER'S JOURNEY, a full section under the shelves (build days S3).
 *
 * The shelf keeps its small invitation card, which now points here. This
 * section holds the five steps, three worked examples and a block of text a
 * builder copies straight into their agent. Every word and link comes from
 * shared/builderJourney.ts, where check-voice reads it, and every link points
 * at the upstream repository, because modules ship by pull request there.
 */
import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { BookOpen, Bot, Check, ClipboardCopy } from "lucide-react";
import { BUILDER_EXAMPLES, BUILDER_STEPS, agentHandoffText } from "@shared/builderJourney";

export const BUILDER_JOURNEY_ID = "build-a-module";

export default function BuilderJourney() {
  const { t } = useLingui();
  const text = agentHandoffText();
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  };

  return (
    <section id={BUILDER_JOURNEY_ID} aria-labelledby="builder-journey-heading" className="mt-12 scroll-mt-20 rounded-2xl border border-teal-deep/30 bg-teal-deep/5 p-5 sm:p-8">
      <h2 id="builder-journey-heading" className="font-display text-2xl sm:text-3xl font-bold text-foreground">
        <Trans context="module library, builder section heading">Build a module</Trans>
      </h2>
      <p className="mt-2 max-w-2xl text-muted-foreground leading-relaxed">
        <Trans context="module library, builder section">
          Anyone can build for this platform, with an AI agent at your side. Five steps take you from an idea to a card on this
          page, in every village.
        </Trans>
      </p>

      <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {BUILDER_STEPS.map((s, i) => {
          const n = i + 1;
          return (
          <li key={s.title} className="min-w-0 rounded-xl border border-border bg-background p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-deep"><Trans context="module library, builder step number">Step {n}</Trans></p>
            <h3 className="mt-1 font-semibold text-foreground">{s.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{s.line}</p>
            {s.command ? (
              <code className="mt-2 block break-all rounded bg-muted px-2 py-1 text-xs text-foreground">{s.command}</code>
            ) : null}
            {s.link ? (
              <a href={s.link.href} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-[44px] items-center text-sm font-medium text-teal-deep underline">
                {s.link.label} ↗
              </a>
            ) : null}
          </li>
          );
        })}
      </ol>

      <h3 className="mt-8 flex items-center gap-2 text-lg font-semibold text-foreground">
        <BookOpen className="h-5 w-5 text-teal-deep" aria-hidden="true" />
        <Trans context="module library, builder section">Worked examples</Trans>
      </h3>
      <ul className="mt-3 grid gap-3 sm:grid-cols-3">
        {BUILDER_EXAMPLES.map((e) => (
          <li key={e.title} className="min-w-0 rounded-xl border border-border bg-background p-4">
            <a href={e.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-teal-deep underline">
              {e.title} ↗
            </a>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{e.line}</p>
          </li>
        ))}
      </ul>

      <h3 className="mt-8 flex items-center gap-2 text-lg font-semibold text-foreground">
        <Bot className="h-5 w-5 text-teal-deep" aria-hidden="true" />
        <Trans context="module library, builder section">Hand this to your agent</Trans>
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        <Trans context="module library, builder section">Copy it into the AI you build with, then add what your module should do.</Trans>
      </p>
      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-background p-4 text-xs text-foreground">{text}</pre>
      <button
        type="button"
        onClick={copy}
        className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-teal-deep px-4 py-2 text-sm font-semibold text-white hover:bg-teal-deep-dark"
      >
        {copied === "done" ? <Check className="h-4 w-4" aria-hidden="true" /> : <ClipboardCopy className="h-4 w-4" aria-hidden="true" />}
        {copied === "done" ? t({ message: "Copied", context: "module library, after copying the agent text" }) : t({ message: "Copy for your agent", context: "module library, copy the agent text" })}
      </button>
      <span role="status" className="ml-3 text-sm text-muted-foreground">
        {copied === "failed" ? t({ message: "Your browser blocked copying. Select the text above and copy it.", context: "module library, copy failed" }) : ""}
      </span>
    </section>
  );
}
