/**
 * STEP ONE on /roles: pick an archetype. The cards read the village's own cast
 * (`GET /api/archetypes`: name, subtitle, blurb, examples), the same words the
 * character page and the selection board use, so there is one copy of them.
 * Picking a card opens the selection board with that archetype already chosen
 * (`/roles/select?archetype=<key>`, read by pages/RoleDraft.tsx). "See all
 * roles" is the other way through, and is handled by the page.
 */
import { Fragment, useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { ARCHETYPE_PARAM, characterArt } from "@shared/roleDraft";
import { BTN_SECONDARY, EYEBROW, LEDE } from "@/components/journey/look";
import ArtImage from "./ArtImage";

interface Archetype {
  key: string;
  name: string;
  subtitle: string;
  blurb: string;
  examples: string[];
}

/** "Facilitating community sessions" reads inside a sentence as "facilitating community sessions". */
function lower(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

export default function ArchetypeStep({ onSeeAll, allShown }: { onSeeAll: () => void; allShown: boolean }) {
  const { t } = useLingui();
  const [cast, setCast] = useState<Archetype[]>([]);
  useEffect(() => {
    let live = true;
    fetch("/api/archetypes")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (!live || !Array.isArray(d)) return;
        setCast(
          d
            .filter((a: any) => a && typeof a.key === "string")
            .map((a: any) => ({
              key: a.key,
              name: String(a.name ?? a.key),
              subtitle: String(a.subtitle ?? ""),
              blurb: String(a.blurb ?? ""),
              examples: Array.isArray(a.examples) ? a.examples.filter((e: unknown) => typeof e === "string" && e.trim()).map(String) : [],
            })),
        );
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  return (
    <section aria-labelledby="roles-step-one-h" className="mx-auto mb-12 max-w-5xl text-left">
      <p className={EYEBROW}>{t({ message: "Step one", context: "roles page archetypes" })}</p>
      <h2 id="roles-step-one-h" className="mt-2 font-display text-3xl leading-tight text-foreground text-balance">
        {t({ message: "Select your archetype to help you find your role", context: "roles page archetypes" })}
      </h2>
      <p className={`mt-2 ${LEDE}`}>
        {t({ message: "An archetype is the kind of work you do best. Choose the one that fits you most, and you can add more on the next page. Many people play two or three, and you may choose all five.", context: "roles page archetypes" })}
      </p>
      {cast.length > 0 && (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cast.map((c, i) => {
            const picks = c.examples.slice(0, 2).map(lower);
            return (
              <li key={c.key} className="sel-rise flex" style={{ animationDelay: `${i * 70}ms` }}>
                <Link
                  href={`/roles/select?${ARCHETYPE_PARAM}=${encodeURIComponent(c.key)}`}
                  className="sel-lift group flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-sm hover:border-notice focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="flex items-center gap-4 p-4 pb-2">
                    <ArtImage src={characterArt(c.key)} className="relative size-20 shrink-0 rounded-full border-2 border-notice ring-0 ring-notice/30 ring-offset-2 ring-offset-card transition-shadow group-hover:ring-4" imgClassName="object-top" />
                    <span className="min-w-0">
                      <span className="block font-display text-xl leading-tight">{c.name}</span>
                      {c.subtitle && <span className="mt-0.5 block text-xs font-semibold text-muted-foreground">{c.subtitle}</span>}
                    </span>
                  </span>
                  <span className="flex flex-1 flex-col gap-2 px-4 pb-4 text-sm">
                    {c.blurb && <span className="leading-relaxed">{c.blurb}</span>}
                    {picks.length > 0 && (
                      <span className="leading-relaxed text-muted-foreground">
                        {/* The examples are the village's own words, in its own language. They sit
                            as quoted labels after the sentence, never spliced into it, so a Spanish
                            reader gets a whole Spanish sentence and then the village's words. */}
                        <span className="font-semibold text-foreground">{t({ message: "You might pick this if you are drawn to:", context: "roles page archetypes, before the village's own examples" })}</span>{" "}
                        {picks.map((p, j) => (
                          <Fragment key={j}>
                            {j > 0 && ` ${t({ message: "or", context: "roles page archetypes, between two examples" })} `}
                            <q>{p}</q>
                          </Fragment>
                        ))}
                      </span>
                    )}
                    <span className="mt-auto inline-flex min-h-11 w-fit items-center gap-2 rounded-lg border border-notice/70 px-4 font-medium text-notice transition-colors group-hover:bg-notice group-hover:text-background">
                      {t({ message: `Start as ${c.name}`, context: "roles page archetypes" })}
                      <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {!allShown && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onSeeAll}
            className={BTN_SECONDARY}
          >
            {t({ message: "See all roles", context: "roles page archetypes" })}
          </button>
          <span className="text-sm text-muted-foreground">{t({ message: "Or look at every role and circle first.", context: "roles page archetypes" })}</span>
        </div>
      )}
    </section>
  );
}
