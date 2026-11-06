/**
 * The card's lower half, as the approved design draws it: the moon cycle (the
 * track with its new and full moons, any invoice the terms set and today, then
 * one card per moon), how I hold my roles, my applications in three columns
 * (past seasons, this season, next season), and the agreements in a small
 * closed <details> at the bottom, pay small and last. Agreements are never
 * edited here; they change through a new role application, and the owner is
 * told so in edit mode.
 */
import { useContext } from "react";
import { Link } from "wouter";
import { CARD_WORDS as W, type AgreementRow, type ApplicationOut, type PlayerCard, type Slot } from "@shared/playerCard";
import type { TrackMarkKind } from "@shared/playerCardHero";
import { EDIT_WORDS } from "@shared/playerCardEdit";
import { countWord } from "@shared/playerCardHero";
import { CardEditContext, EditInPlace, Eyebrow, SlotView } from "./cardParts";
import ProposalLinks from "@/components/roleProposal/ProposalLinks";

const MARK_CLASS: Record<TrackMarkKind, string> = { new: "pc-new", full: "pc-full", invoice: "pc-inv" };
const LEGEND: Record<TrackMarkKind, string> = { new: W.newMoon, full: W.fullMoon, invoice: W.invoiceDue };

function Track({ track }: { track: NonNullable<PlayerCard["timeline"]["track"]> }) {
  return (
    <>
      <div className="pc-track" aria-hidden="true" data-moon-track>
        <div className="pc-rail" />
        {track.today !== null ? <div className="pc-fill" style={{ width: `${track.today}%` }} /> : null}
        {track.marks.map((m) => (
          <span key={`${m.kind}-${m.at}`} className={`pc-mk ${MARK_CLASS[m.kind]}`} style={{ left: `${m.pct}%` }} />
        ))}
        {track.today !== null ? (
          <span className="pc-mk pc-today" style={{ left: `${track.today}%` }}>
            <b>{W.today}</b>
            <i />
          </span>
        ) : null}
      </div>
      <div className="pc-ends" aria-hidden="true">
        <span>{track.startLabel}</span>
        <span>{track.endLabel}</span>
      </div>
      <div className="pc-legend" aria-hidden="true">
        {track.kinds.map((k) => (
          <span key={k}>
            <i className={`pc-mk ${MARK_CLASS[k]}`} />
            {LEGEND[k]}
          </span>
        ))}
      </div>
    </>
  );
}

export function MoonTimeline({ timeline }: { timeline: PlayerCard["timeline"] }) {
  return (
    <section aria-labelledby="pc-moons-h" className="pc-panel">
      <div className="pc-headgroup">
        <Eyebrow gold>{W.timelineEyebrow}</Eyebrow>
        <h3 id="pc-moons-h" className="pc-h2">
          {timeline.heading}
        </h3>
        <p className="pc-lede pc-f14">{timeline.lede}</p>
      </div>
      {timeline.track ? <Track track={timeline.track} /> : null}
      <ol className="pc-moons">
        {timeline.moons.map((m) => (
          <li key={m.startsAt} aria-current={m.now ? "true" : undefined} className={`pc-moon${m.now ? " pc-now" : ""}`}>
            {m.title ? <h4 className="pc-h3">{m.title}</h4> : null}
            <p className="pc-dates">{m.label}</p>
            {m.markers.length ? (
              <ul>
                {m.markers.map((k, i) => (
                  <li key={i}>
                    {k.day}: {k.words}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
      {timeline.rhythm.length ? (
        <ul className="pc-list pc-dim">
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
    <section aria-labelledby="pc-hold-h" className="pc-panel">
      <h3 id="pc-hold-h" className="pc-h2">
        {howIHold.heading}
      </h3>
      <SlotView slot={howIHold.items}>
        {(items) => (
          <div className="pc-trio">
            {items.map((h) => (
              <div key={h.label} className="pc-mini">
                <Eyebrow>{h.label}</Eyebrow>
                <p className="pc-f14">{h.text}</p>
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
    <div className={`pc-histcol${now ? " pc-now" : ""}`}>
      <Eyebrow gold={now}>{heading}</Eyebrow>
      <SlotView slot={slot}>
        {(apps) => (
          <ul>
            {apps.map((a) => (
              <li key={a.id}>
                <Link href={a.href} className="pc-app">
                  <div>
                    <b>{a.title}</b>
                    {a.filed ? (
                      <>
                        <br />
                        <span>{a.filed}</span>
                      </>
                    ) : null}
                    {a.starts ? (
                      <>
                        <br />
                        <span>{a.starts}</span>
                      </>
                    ) : null}
                  </div>
                  <span className="pc-state">{a.status}</span>
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
    <section aria-labelledby="pc-apps-h" className="pc-panel">
      <div className="pc-headgroup">
        <Eyebrow gold>{W.historyEyebrow}</Eyebrow>
        <h3 id="pc-apps-h" className="pc-h2">
          {applications.heading}
        </h3>
      </div>
      <div className="pc-hist">
        <AppGroup heading={W.past} slot={applications.past} />
        <AppGroup heading={W.thisSeason} slot={applications.thisSeason} now />
        <AppGroup heading={W.nextSeason} slot={applications.nextSeason} />
      </div>
      {/* The owner's role proposals, each linked to where it stands (role proposals PR C). */}
      {owner ? <ProposalLinks /> : null}
    </section>
  );
}

function Rows({ rows }: { rows: AgreementRow[] }) {
  return (
    <dl className="pc-rows">
      {rows.map((row) => (
        <div key={row.label} className="pc-row">
          <dt>{row.label}</dt>
          <dd className={row.small ? "pc-money" : undefined}>
            {row.lines.map((l, i) => (
              <span key={i} style={{ display: "block" }}>
                {l}
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Agreements({ agreements, newApplicationHref }: { agreements: PlayerCard["agreements"]; newApplicationHref?: string }) {
  const { editing } = useContext(CardEditContext);
  const shown = agreements.roles.filter((r) => r.rows.kind !== "unread");
  if (!shown.length) return null;
  // Every role on the same terms: recorded once, as the design writes it.
  const keyOf = (r: (typeof shown)[number]) => JSON.stringify(r.rows);
  const once = shown.length > 1 && shown.every((r) => keyOf(r) === keyOf(shown[0]));
  return (
    <details className="pc-terms">
      <summary>
        <span className="pc-headgroup" style={{ gap: 2 }}>
          <span className="pc-eyebrow">{W.agreementsEyebrow}</span>
          <span className="pc-termstitle">{once ? W.termsOnce(countWord(shown.length).toLowerCase()) : agreements.heading}</span>
        </span>
        <span className="pc-gold" aria-hidden="true">
          ▾
        </span>
      </summary>
      {editing ? (
        <p className="pc-termsnote">
          {EDIT_WORDS.termsNote}{" "}
          {newApplicationHref ? (
            <Link href={newApplicationHref} className="pc-link">
              {EDIT_WORDS.newApplication}
            </Link>
          ) : null}
        </p>
      ) : null}
      {once ? (
        <SlotView slot={shown[0].rows}>{(rows) => <Rows rows={rows} />}</SlotView>
      ) : (
        shown.map((r) => (
          <div key={r.roleId}>
            <p className="pc-rowsrole">{r.title}</p>
            <SlotView slot={r.rows}>{(rows) => <Rows rows={rows} />}</SlotView>
          </div>
        ))
      )}
    </details>
  );
}
