/**
 * "JOIN THE FOUNDING TEAM" (phase A, lane A3, build list 2.1, 2.3 and 1.11):
 * the top of the Roles and Circles page while the village has turned the
 * section on (`org.founding_team`) and named its roles
 * (`org.founding_team_roles`, read by shared/foundingTeam.ts on the server).
 *
 * THE FOUNDING REGISTER. Same night world, quieter: larger display type, more
 * space, gold rules, and the Seed of Life only as structure behind the
 * heading. No moss and no game words here. One role is open at a time, so the
 * one firefly cluster sits on that card's one act, "Apply for this role".
 *
 * Phone and desktop: on a phone each role is a full-width row, and opening one
 * puts its card directly under it, one thing at a time. From lg the rows sit
 * in a column beside the open card, so a reader moves between the roles
 * without losing the card they are reading.
 */
import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { SECTION_WORDS, type RoleCardSections, type VillagePay } from "@shared/roleCardSections";
import { seedOfLifeCentres, fx } from "@/components/journey/nature";
import FullRoleCard from "./FullRoleCard";
import { useWide } from "./useWide";

/** The Seed of Life as quiet line work: structure, never ornament that moves. */
function SeedLines({ className = "" }: { className?: string }) {
  const centres = seedOfLifeCentres(60, 60, 20);
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" className={`pointer-events-none text-notice ${className}`}>
      {centres.map((c, i) => (
        <circle key={i} cx={fx(c.x)} cy={fx(c.y)} r={20} fill="none" stroke="currentColor" strokeWidth={0.4} />
      ))}
      <circle cx={60} cy={60} r={40} fill="none" stroke="currentColor" strokeWidth={0.4} />
    </svg>
  );
}

export interface FoundingRole {
  seat: Record<string, any>;
  circleName: string | null;
  sections: RoleCardSections | null;
}

/**
 * `lead`: the section opens the page (design pass M1 and D-04, 12 Nov 2026). Its heading is then the
 * page's h1, and on a phone the spacing is tighter so the role rows sit in the first screen.
 */
export default function FoundingTeam({ roles, initialOpen = null, villagePay = null, lead = false }: { roles: FoundingRole[]; initialOpen?: string | null; villagePay?: VillagePay | null; lead?: boolean }) {
  const { t } = useLingui();
  const headingId = `${useId().replace(/[^a-zA-Z0-9]/g, "")}-founding`;
  const Heading = lead ? "h1" : "h2";
  const wide = useWide();
  // A phone opens on the list, one thing at a time; a desktop opens on the first role beside it.
  const [open, setOpen] = useState<string | null>(initialOpen);
  // `open` is null until a reader chooses, and "" once a phone reader closes the open row.
  const shown = open === null ? (wide ? String(roles[0]?.seat?.id ?? "") || null : null) : open || null;
  if (roles.length === 0) return null;
  const current = roles.find((r) => String(r.seat.id) === shown) ?? null;

  return (
    <section aria-labelledby={headingId} className={`relative mx-auto max-w-6xl ${lead ? "mb-10 sm:mb-16" : "mb-16"}`} data-founding-team="">
      <div className={`relative overflow-hidden ${lead ? "border-b py-4 sm:border-t sm:py-14" : "border-y py-10 sm:py-14"} border-notice/40`}>
        <SeedLines className="absolute -right-10 -top-10 size-64 opacity-20 sm:size-80" />
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-notice">{t({ message: "Founding team", context: "founding team section eyebrow" })}</p>
        <Heading id={headingId} className="mt-3 font-display text-4xl leading-tight text-foreground sm:text-6xl">
          {t({ message: "Join the founding team", context: "founding team section heading" })}
        </Heading>
        <p className={`${lead ? "mt-3" : "mt-5"} max-w-2xl text-lg leading-relaxed text-muted-foreground sm:mt-5 sm:text-xl`}>
          {t({ message: "We are building our team of people who will lead each domain of the village from the foundation through to completion.", context: "founding team section lede" })}
        </p>
      </div>

      <div className={`${lead ? "mt-5" : "mt-10"} grid gap-6 sm:mt-10 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10`}>
        <ul className="grid gap-3 self-start lg:sticky lg:top-28" aria-label={t({ message: "The founding roles", context: "founding team list" })}>
          {roles.map((r) => {
            const id = String(r.seat.id);
            const here = shown === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  aria-expanded={here}
                  aria-controls={`${headingId}-card`}
                  onClick={() => setOpen(here && !wide ? "" : id)}
                  className={`flex min-h-16 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${here ? "border-notice bg-notice/10" : "border-border bg-card hover:border-notice/60"}`}
                  data-founding-role={id}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-lg leading-snug text-card-foreground">{String(r.seat.name ?? "")}</span>
                    {(r.circleName || r.sections?.paid) && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {[r.circleName, r.sections?.paid ? SECTION_WORDS.paid : null].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                  <ChevronRight className={`size-5 shrink-0 text-notice transition-transform ${here && !wide ? "rotate-90" : ""}`} aria-hidden="true" />
                </button>
                {/* A phone reads the open card right under its row. */}
                {here && !wide && (
                  <div className="mt-3" id={`${headingId}-card`}>
                    <FullRoleCard seat={r.seat} circleName={r.circleName} sections={r.sections} villagePay={villagePay} register="founding" lifted={lead} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {wide && (
        <div id={`${headingId}-card`}>
          {current ? (
            <FullRoleCard key={String(current.seat.id)} seat={current.seat} circleName={current.circleName} sections={current.sections} villagePay={villagePay} register="founding" lifted={lead} />
          ) : (
            <p className="rounded-2xl border border-dashed border-notice/40 p-8 text-muted-foreground">{t({ message: "Choose a role to read it in full.", context: "founding team, no role open" })}</p>
          )}
        </div>
        )}
      </div>
    </section>
  );
}
