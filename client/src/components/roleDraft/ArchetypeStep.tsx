/**
 * STEP ONE on /roles: pick an archetype. The cards read the village's own cast
 * (`GET /api/archetypes`: name, subtitle, blurb, examples), the same words the
 * character page and the selection board use, so there is one copy of them.
 * Picking a card opens the selection board with that archetype already chosen
 * (`/roles/select?archetype=<key>`, read by pages/RoleDraft.tsx). "See all
 * roles" is the other way through, and is handled by the page.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { ARCHETYPE_PARAM, characterArt } from "@shared/roleDraft";
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
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-notice">{t({ message: "Step one", context: "roles page archetypes" })}</p>
      <h2 id="roles-step-one-h" className="mt-1 font-display text-3xl font-bold text-foreground text-balance">
        {t({ message: "Select your archetype to help you find your role", context: "roles page archetypes" })}
      </h2>
      <p className="mt-2 max-w-[66ch] text-muted-foreground">
        {t({ message: "An archetype is the kind of work you do best. Choose the one that fits you most, and you can add more on the next page. Many people play two or three, and you may choose all five.", context: "roles page archetypes" })}
      </p>
      {cast.length > 0 && (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cast.map((c, i) => {
            const picks = c.examples.slice(0, 2).map(lower);
            const drawnTo = picks.join(` ${t({ message: "or", context: "roles page archetypes, between two examples" })} `);
            return (
              <li key={c.key} className="sel-rise flex" style={{ animationDelay: `${i * 70}ms` }}>
                <Link
                  href={`/roles/select?${ARCHETYPE_PARAM}=${encodeURIComponent(c.key)}`}
                  className="sel-lift group flex w-full flex-col overflow-hidden rounded-2xl border-2 border-border bg-card text-card-foreground hover:border-notice focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="flex items-center gap-4 p-4 pb-2">
                    <ArtImage src={characterArt(c.key)} className="relative size-20 shrink-0 rounded-full border-2 border-notice ring-0 ring-notice/30 ring-offset-2 ring-offset-card transition-shadow group-hover:ring-4" imgClassName="object-top" />
                    <span className="min-w-0">
                      <span className="block font-display text-xl font-bold leading-tight">{c.name}</span>
                      {c.subtitle && <span className="mt-0.5 block text-xs font-semibold text-muted-foreground">{c.subtitle}</span>}
                    </span>
                  </span>
                  <span className="flex flex-1 flex-col gap-2 px-4 pb-4 text-sm">
                    {c.blurb && <span className="leading-relaxed">{c.blurb}</span>}
                    {picks.length > 0 && (
                      <span className="leading-relaxed text-muted-foreground">
                        <span className="font-semibold text-foreground">{t({ message: "You might pick this if", context: "roles page archetypes" })}</span>{" "}
                        {t({ message: `you are drawn to ${drawnTo}.`, context: "roles page archetypes" })}
                      </span>
                    )}
                    <span className="mt-auto inline-flex min-h-11 w-fit items-center gap-2 rounded-full border-2 border-notice px-4 font-bold text-foreground transition-colors group-hover:bg-notice group-hover:text-background">
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
            className="jw-btn inline-flex min-h-11 items-center gap-2 rounded-full border-2 border-notice bg-card px-5 text-sm font-bold text-foreground hover:bg-notice/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {t({ message: "See all roles", context: "roles page archetypes" })}
          </button>
          <span className="text-sm text-muted-foreground">{t({ message: "Or look at every role and circle first.", context: "roles page archetypes" })}</span>
        </div>
      )}
    </section>
  );
}
