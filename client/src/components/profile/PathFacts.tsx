/**
 * WHAT A PATH ACTUALLY HOLDS, for a member who walks it.
 *
 * ── WHY THIS IS SEPARATE FROM THE LADDER ────────────────────────────────────
 *
 * `PathLadder` draws WHERE somebody stands: four rungs, some lit. It was the
 * whole of what the profile knew, and it left a member able to see that they
 * had reached "venture opened" and unable to see WHICH venture. The rows were
 * on the server the entire time; `laddersFor` narrows them to the two dated
 * fields a rung needs and drops the name, the summary, the link, the detail.
 *
 * So this reads the same rows for what they SAY. Both projections come off one
 * fetch and one set of queries, which is why the second half cost no round
 * trip: see the `paths` key in `server/routes/pathLadders.ts`.
 *
 * ── AN EMPTY PATH SAYS WHAT WOULD FILL IT ───────────────────────────────────
 *
 * A member who claims a path on Monday has nothing on it until somebody
 * records something. An empty box there reads as broken, and hiding the
 * section reads as the claim not having worked. Each one names the act that
 * would put a first row in it, which is the same posture the record band takes
 * while it is empty.
 *
 * ── NO DATE ARITHMETIC HAPPENS HERE ─────────────────────────────────────────
 *
 * Every instant arrives as a village moon, already resolved against the
 * village's own first moon, and `villageMoonLabel` is the one producer of the
 * words. `live` and `listed` arrive as booleans for the same reason: a client
 * that compares dates is a second opinion about when something ended.
 */
import { ExternalLink } from "lucide-react";
import { PATH_LADDERS, type PathParticulars } from "@shared/pathLadders";
import { villageMoonLabel } from "@shared/villageMoon";
import type { VillageMoon } from "@shared/villageMoon";

/** A moon, or nothing at all. Never a guess and never an empty bracket. */
function Moon({ moon, prefix }: { moon: VillageMoon | null; prefix: string }) {
  const label = villageMoonLabel(moon);
  if (!label) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {prefix} {label}
    </p>
  );
}

/** Live or ended, in the one place both branches can be read together. */
function Standing({ live, word }: { live: boolean; word: string }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
        live ? "bg-open/15 text-open" : "bg-muted text-muted-foreground"
      }`}
    >
      {live ? "Live" : word}
    </span>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <li className="rounded-xl border border-border px-4 py-3">{children}</li>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/**
 * The four bodies. Split out so each path's shape can be read on its own: an
 * investor's facts and a resident's reservations have nothing structural in
 * common, and one generic renderer over both would have to invent a shape
 * neither of them has.
 */
function InvestorFacts({ facts }: { facts: NonNullable<PathParticulars["investor"]>["facts"] }) {
  if (facts.length === 0) return <Empty>Nothing recorded yet. Facts appear here as the village records them.</Empty>;
  // The words for each fact key already exist: the investor ladder in
  // `shared/pathLadders.ts` names all four, and its rung ids match
  // `INVESTOR_FACTS` exactly, held there by a test. A second table here would
  // be one more hand-kept map to drift.
  const nameOf = (key: string) =>
    PATH_LADDERS.investor.rungs.find((r) => r.id === key)?.name ?? key;
  return (
    <ul className="space-y-2">
      {facts.map((f) => (
        <Card key={f.id}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="font-medium text-card-foreground">{nameOf(f.fact)}</span>
            <Standing live={f.live} word="Ended" />
          </div>
          {f.detail ? <p className="mt-1 text-sm text-muted-foreground">{f.detail}</p> : null}
          <Moon moon={f.startedMoon} prefix="Recorded" />
          {f.live ? null : <Moon moon={f.endedMoon} prefix="Ended" />}
          {f.endedReason ? <p className="text-xs text-muted-foreground">{f.endedReason}</p> : null}
        </Card>
      ))}
    </ul>
  );
}

function Ventures({ ventures }: { ventures: NonNullable<PathParticulars["prosperity-creator"]>["ventures"] }) {
  if (ventures.length === 0) return <Empty>No ventures open yet. The first one you open appears here.</Empty>;
  return (
    <ul className="space-y-2">
      {ventures.map((v) => (
        <Card key={v.id}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="font-medium text-card-foreground">{v.name}</span>
            <Standing live={v.live} word="Closed" />
          </div>
          {v.kind ? <p className="mt-0.5 text-xs uppercase tracking-wide text-muted-foreground">{v.kind}</p> : null}
          {v.summary ? <p className="mt-1 text-sm text-muted-foreground">{v.summary}</p> : null}
          <Moon moon={v.openedMoon} prefix="Opened" />
          {v.listed ? <Moon moon={v.listedMoon} prefix="Listed for the village" /> : null}
          {v.live ? null : <Moon moon={v.closedMoon} prefix="Closed" />}
          {v.closedReason ? <p className="text-xs text-muted-foreground">{v.closedReason}</p> : null}
          {v.link ? (
            <a
              href={v.link}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-foreground underline underline-offset-2"
            >
              Visit
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ) : null}
        </Card>
      ))}
    </ul>
  );
}

function Reservations({ reservations }: { reservations: NonNullable<PathParticulars["resident"]>["reservations"] }) {
  if (reservations.length === 0) return <Empty>Nothing reserved yet. A reservation you make appears here.</Empty>;
  return (
    <ul className="space-y-2">
      {reservations.map((r) => (
        <Card key={r.id}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="font-medium text-card-foreground">{r.homeType}</span>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {r.status}
            </span>
          </div>
          {r.structureKey ? <p className="mt-0.5 text-sm text-muted-foreground">{r.structureKey}</p> : null}
          <Moon moon={r.madeMoon} prefix="Reserved" />
        </Card>
      ))}
    </ul>
  );
}

function Seats({ seats }: { seats: NonNullable<PathParticulars["steward"]>["seats"] }) {
  if (seats.length === 0) return <Empty>No seats held yet. A seat the village gives you appears here.</Empty>;
  return (
    <ul className="space-y-2">
      {seats.map((s) => (
        <Card key={s.id}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="font-medium text-card-foreground">{s.roleName}</span>
            <Standing live={s.live} word="Stepped down" />
          </div>
          {s.representsCircle ? (
            <p className="mt-0.5 text-sm text-muted-foreground">Speaks for a circle.</p>
          ) : null}
          <Moon moon={s.startedMoon} prefix="Seated" />
          {s.live ? null : <Moon moon={s.endedMoon} prefix="Ended" />}
          {s.endedReason ? <p className="text-xs text-muted-foreground">{s.endedReason}</p> : null}
        </Card>
      ))}
    </ul>
  );
}

/**
 * One path's particulars, or nothing.
 *
 * Nothing is the right answer in two different cases and they must not be
 * confused: the payload has not arrived (`particulars` is null), and this
 * member does not walk this path (the key is absent). Both draw nothing. A key
 * that IS present with an empty list is the third case, and that one draws the
 * section with its own sentence about what would fill it.
 */
export default function PathFacts({
  pathId,
  title,
  particulars,
}: {
  pathId: string;
  /** The village's own label for this path, from the offer. */
  title: string;
  particulars: PathParticulars | null;
}) {
  if (!particulars) return null;

  let body: React.ReactNode = null;
  if (pathId === "investor" && particulars.investor) {
    body = <InvestorFacts facts={particulars.investor.facts} />;
  } else if (pathId === "prosperity-creator" && particulars["prosperity-creator"]) {
    body = <Ventures ventures={particulars["prosperity-creator"].ventures} />;
  } else if (pathId === "resident" && particulars.resident) {
    body = <Reservations reservations={particulars.resident.reservations} />;
  } else if (pathId === "steward" && particulars.steward) {
    body = <Seats seats={particulars.steward.seats} />;
  }
  if (!body) return null;

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <h2 className="font-display text-2xl font-bold text-card-foreground">{title}</h2>
      <div className="mt-4">{body}</div>
    </section>
  );
}
