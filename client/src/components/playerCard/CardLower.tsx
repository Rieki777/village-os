/**
 * The card's lower half: the moon timeline, how I hold my roles, my
 * applications, and my agreements in a small closed <details> at the bottom,
 * pay small and last. Agreements are never edited here; they change through a
 * new role application, and the owner is told so in edit mode.
 */
import { useContext } from "react";
import { Link } from "wouter";
import { CARD_WORDS as W, type ApplicationOut, type PlayerCard, type Slot } from "@shared/playerCard";
import { EDIT_WORDS } from "@shared/playerCardEdit";
import { CardEditContext, EditInPlace, Eyebrow, H2, LINK, SECTION, SlotView } from "./cardParts";
import ProposalLinks from "@/components/roleProposal/ProposalLinks";

export function MoonTimeline({ timeline }: { timeline: PlayerCard["timeline"] }) {
  return (
    <section aria-labelledby="pc-moons-h" className={`${SECTION} grid gap-4`}>
      <div className="grid gap-1">
        <h3 id="pc-moons-h" className={H2}>
          {timeline.heading}
        </h3>
        <p className="text-sm text-muted-foreground">{timeline.lede}</p>
      </div>
      <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {timeline.moons.map((m) => (
          <li
            key={m.startsAt}
            aria-current={m.now ? "true" : undefined}
            className={`rounded-xl border p-4 ${m.now ? "border-notice bg-muted" : "border-border/70"}`}
          >
            {m.title ? <p className="font-semibold">{m.title}</p> : null}
            <p className="text-sm text-muted-foreground">{m.label}</p>
            {m.markers.length ? (
              <ul className="mt-2 grid gap-1 text-sm">
                {m.markers.map((k, i) => (
                  <li key={i}>
                    <span className="font-medium">{k.day}:</span> {k.words}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
      {timeline.rhythm.length ? (
        <ul className="grid gap-1 text-sm">
          {timeline.rhythm.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function HowIHold({ howIHold }: { howIHold: PlayerCard["howIHold"] }) {
  if (howIHold.items.kind === "unread") return null;
  return (
    <section aria-labelledby="pc-hold-h" className={`${SECTION} grid gap-3`}>
      <h3 id="pc-hold-h" className={H2}>
        {howIHold.heading}
      </h3>
      <SlotView slot={howIHold.items}>
        {(items) => (
          <div className="grid gap-3 md:grid-cols-3">
            {items.map((h) => (
              <div key={h.label} className="rounded-xl border border-border/70 p-4">
                <Eyebrow>{h.label}</Eyebrow>
                <p className="mt-1 text-sm">{h.text}</p>
              </div>
            ))}
          </div>
        )}
      </SlotView>
      <EditInPlace
        target={{ kind: "personal", key: "howIHold" }}
        label={howIHold.heading}
        initial={howIHold.items.kind === "shown" ? howIHold.items.value.find((h) => h.label === howIHold.heading)?.text ?? "" : ""}
      />
    </section>
  );
}

function AppGroup({ heading, slot, now = false }: { heading: string; slot: Slot<ApplicationOut[]>; now?: boolean }) {
  return (
    <div className={`grid content-start gap-2 rounded-xl border p-4 ${now ? "border-notice" : "border-border/70"}`}>
      <Eyebrow gold={now}>{heading}</Eyebrow>
      <SlotView slot={slot}>
        {(apps) => (
          <ul className="grid gap-2">
            {apps.map((a) => (
              <li key={a.id}>
                <Link
                  href={a.href}
                  className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 rounded-lg border border-border/60 px-3 py-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="grid">
                    <span className="font-semibold">{a.title}</span>
                    {a.filed ? <span className="text-xs text-muted-foreground">{a.filed}</span> : null}
                    {a.starts ? <span className="text-xs text-muted-foreground">{a.starts}</span> : null}
                  </span>
                  <span className="text-sm text-notice">{a.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SlotView>
    </div>
  );
}

export function MyApplications({ applications }: { applications: PlayerCard["applications"] }) {
  const { owner } = useContext(CardEditContext);
  if (applications.thisSeason.kind === "unread") return null;
  return (
    <section aria-labelledby="pc-apps-h" className={`${SECTION} grid gap-3`}>
      <h3 id="pc-apps-h" className={H2}>
        {applications.heading}
      </h3>
      <div className="grid gap-3 md:grid-cols-3">
        <AppGroup heading={W.past} slot={applications.past} />
        <AppGroup heading={W.thisSeason} slot={applications.thisSeason} now />
        <AppGroup heading={W.nextSeason} slot={applications.nextSeason} />
      </div>
      {/* The owner's role proposals, each linked to where it stands (role proposals PR C). */}
      {owner ? <ProposalLinks /> : null}
    </section>
  );
}

export function Agreements({ agreements, newApplicationHref }: { agreements: PlayerCard["agreements"]; newApplicationHref?: string }) {
  const { editing } = useContext(CardEditContext);
  const shown = agreements.roles.filter((r) => r.rows.kind !== "unread");
  if (!shown.length) return null;
  return (
    <details className="rounded-2xl border border-border bg-card p-4 text-card-foreground sm:p-6">
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold">{agreements.heading}</summary>
      {editing ? (
        <p className="mt-2 text-sm">
          {EDIT_WORDS.termsNote}{" "}
          {newApplicationHref ? (
            <Link href={newApplicationHref} className={LINK}>
              {EDIT_WORDS.newApplication}
            </Link>
          ) : null}
        </p>
      ) : null}
      <div className="mt-3 grid gap-4">
        {shown.map((r) => (
          <div key={r.roleId} className="grid gap-2">
            <p className="font-semibold">{r.title}</p>
            <SlotView slot={r.rows}>
              {(rows) => (
                <dl className="grid gap-2">
                  {rows.map((row) => (
                    <div key={row.label} className={`grid gap-0.5 sm:grid-cols-[8rem_1fr] ${row.small ? "text-xs" : "text-sm"}`}>
                      <dt className="font-medium text-muted-foreground">{row.label}</dt>
                      <dd>
                        {row.lines.map((l, i) => (
                          <span key={i} className="block">
                            {l}
                          </span>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </SlotView>
          </div>
        ))}
      </div>
    </details>
  );
}
