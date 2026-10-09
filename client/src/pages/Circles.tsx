import Layout from "@/components/Layout";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  ArrowRight,
  Home,
  Building,
  Leaf,
  Zap,
  ChevronDown,
  Stethoscope,
  BookOpen,
  Palette,
  DollarSign,
  Users2,
  Lightbulb,
  Building2,
  Briefcase,
  Handshake,
  CircleDot,
} from "lucide-react";
import { useEffect, useState } from "react";
import CircleScene from "@/components/CircleScene";
import CirclesMiniMap from "@/components/CirclesMiniMap";
import { cssColourForCircle } from "@shared/circleView";
import InfoTip from "@/components/InfoTip";
import { gameFetch, useSeason } from "@/lib/gameApi";
import { PeopleLockNote, type PeopleTier } from "@/components/PeopleLock";
import SeatAction from "@/components/power/SeatAction";
import SeatHistory from "@/components/power/SeatHistory";
import SeatSheet from "@/components/power/SeatSheet";
import SeatTradingCard from "@/components/power/SeatTradingCard";
import { useClassNames } from "@/components/power/useClassNames";
import { useModule } from "@/modules/ModuleProvider";
import { fromOrgSeat, orgHolderName, seasonForSheet, seatHistoryShown } from "@shared/roleSheetInputs";

interface CircleEntry {
  id: string;
  name: string;
  subtitle?: string;
  stage: "today" | "future";
  description?: string;
  domain?: string;
  members?: string;
  /** The seats this circle carries, which are its focus areas. Each opens its card. */
  seats: Array<{ id: string; name: string }>;
  icon?: string;
  color?: string;
  /** Optional scene override (motif id or /api/uploads/…); keywords otherwise. */
  scene?: string;
}

/** Icon names a card may reference; anything unknown falls back to CircleDot. */
const ICONS: Record<string, React.ElementType> = {
  Users, Home, Building, Leaf, Zap, Stethoscope, BookOpen, Palette,
  DollarSign, Users2, Lightbulb, Building2, Briefcase, Handshake, CircleDot,
};

function CircleCard({ circle, expanded, onToggle, index, onOpenSeat }: {
  circle: CircleEntry;
  expanded: boolean;
  onToggle: () => void;
  index: number;
  /** A seat chip was pressed: open that seat's card. */
  onOpenSeat: (seatId: string) => void;
}) {
  const Icon = ICONS[circle.icon ?? ""] ?? CircleDot;
  /*
   * THE CARD WEARS THE SAME COLOUR THE MAP DRAWS.
   *
   * These cards resolved colour through the brand tone layer, which is
   * NEUTRAL GREY on a deployment that has not chosen a seed (index.css says
   * so on purpose: an untouched fork renders nobody's brand). So the map was
   * eleven hues and this page was half grey, and the two surfaces disagreed
   * about what colour a circle is while agreeing about everything else.
   *
   * `cssColourForCircle` is the map's resolver, so a circle is one colour
   * everywhere: here, on the canvas, in the mini render and in the accordion
   * key. A categorical palette is not a brand, which is why it does not
   * belong in the tone layer.
   *
   * THE INK IS ALWAYS DARK, and that is measured rather than assumed. All
   * eleven hues are mid-tones: against the near-black foreground the worst
   * is rose at 5.05:1 and the best is teal at 10.13:1, so every one clears
   * AA. Against WHITE every one of them fails, the worst at 1.77:1, which is
   * why `swatchFor`'s white-ink pairings cannot be reused here.
   */
  const hue = cssColourForCircle({ id: circle.id, color: circle.color ?? null });
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.05 }}
    >
      <button
        onClick={onToggle}
        className="w-full text-left bg-card hover:bg-card/80 transition-colors rounded-xl border border-border overflow-hidden"
      >
        {/* The circle's scene: foundation art chosen by what the circle is
            about (shared/circleScenes.ts), drawn in the village's own palette
            via the tone tokens. Decorative — the name below carries meaning. */}
        <CircleScene circle={circle} />
        <div className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4 flex-1">
            <div
              className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 mt-1"
              style={{ background: hue }}
            >
              <Icon className="w-6 h-6 text-foreground" />
            </div>
            <div>
              <h3 className="font-display text-xl font-bold text-foreground">
                {circle.name}
              </h3>
              {circle.subtitle && (
                <p className="text-sm text-muted-foreground mt-1">
                  {circle.subtitle}
                </p>
              )}
            </div>
          </div>
          <ChevronDown
            className={`w-5 h-5 text-muted-foreground transition-transform flex-shrink-0 ${expanded ? "rotate-180" : ""}`}
          />
        </div>
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-muted/30 p-6 rounded-b-xl border border-t-0 border-border space-y-4">
              {circle.description && <p className="text-foreground">{circle.description}</p>}

              <div className="grid md:grid-cols-2 gap-6">
                {circle.domain && (
                  <div>
                    <h4 className="font-semibold text-foreground mb-2">Domain</h4>
                    <p className="text-sm text-muted-foreground">{circle.domain}</p>
                  </div>
                )}
                {circle.members && (
                  <div>
                    <h4 className="font-semibold text-foreground mb-2">Who's In It</h4>
                    <p className="text-sm text-muted-foreground">{circle.members}</p>
                  </div>
                )}
              </div>

              {circle.seats.length > 0 && (
                <div>
                  <h4 className="font-semibold text-foreground mb-3">Key Focus Areas</h4>
                  {/* Each seat opens its role card. These sit in the panel,
                      outside the header button, so no button nests in another. */}
                  <div className="flex flex-wrap gap-2">
                    {circle.seats.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => onOpenSeat(s.id)}
                        aria-haspopup="dialog"
                        className="inline-flex min-h-11 items-center rounded-full px-3.5 text-xs font-medium text-foreground shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        style={{ background: hue }}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  <strong>How it works:</strong> Each circle has autonomy within its domain and budget, uses consent-based decision-making, and is double-linked to the General Coordinating Circle so information flows both ways.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function Circles() {
  const [expandedCircle, setExpandedCircle] = useState<string | null>(null);
  const [circles, setCircles] = useState<CircleEntry[] | null>(null);
  // The rows as they arrived, kept whole for the mini map and the role card.
  // The circle cards flatten a circle into prose (`members`) and drop the
  // nesting and the seat states, which are exactly what both of those draw.
  const [raw, setRaw] = useState<{ circles: any[]; seats: any[]; village?: unknown }>({ circles: [], seats: [] });
  const [failed, setFailed] = useState(false);
  const [people, setPeople] = useState<PeopleTier | null>(null);
  const [seatCounts, setSeatCounts] = useState({ seats: 0, held: 0 });
  // The seat whose card is open in the sheet, by id.
  const [openSeat, setOpenSeat] = useState<string | null>(null);
  // The card's clock and the village's class names, one cached read each.
  const season = useSeason();
  const classNames = useClassNames();
  // A raised hand posts under `/api/map`, which the map module gates, so the
  // card offers one only while this reader's catalog lists that module as on.
  // The contact relay is the map's alone and is never offered here.
  const map = useModule("map");
  const raiseHand = !!map && map.lifecycle !== "off";

  // Circles are rows now (0049). What a circle IS and who is in it are read
  // from its seats rather than from hand-typed prose, so the page cannot go
  // on describing a circle the village stopped running.
  //
  // `gameFetch` carries the member's token; the bare `fetch` this replaces did
  // not, and `/api/org` tiers holder names behind `map.viewPeople` off the
  // Authorization header alone. So this page asked as a stranger however
  // signed in the reader was, and the names never arrived for anybody.
  useEffect(() => {
    gameFetch("/api/org")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (!data || !Array.isArray(data.circles)) throw new Error("bad shape");
        const seatsByCircle = new Map<string, any[]>();
        for (const r of data.roles ?? []) {
          const list = seatsByCircle.get(r.circleId) ?? [];
          list.push(r);
          seatsByCircle.set(r.circleId, list);
        }
        setPeople(data.people ?? null);
        setRaw({ circles: data.circles ?? [], seats: data.roles ?? [], village: data.village });
        setSeatCounts({
          seats: (data.roles ?? []).reduce((n: number, r: any) => n + Number(r.seats ?? 0), 0),
          held: (data.roles ?? []).reduce((n: number, r: any) => n + Number(r.holderCount ?? 0), 0),
        });
        setCircles(
          (data.circles as any[]).map((c: any, i: number) => {
            const seats = seatsByCircle.get(c.id) ?? [];
            // An agent's member row carries a vendor's name, so it is listed
            // as "An agent", the words the card and the public tier use.
            const heldBy = seats
              .flatMap((s: any) => (s.holders ?? []).map(orgHolderName))
              .filter(Boolean);
            /*
             * A LIE THIS PAGE HAS BEEN TELLING SINCE THE NAMES WERE TIERED.
             *
             * The members line below fell back to "3 roles, none held yet"
             * whenever `heldBy` came back empty, and `heldBy` is built from
             * holder NAMES, which /api/org withholds from anyone without
             * map.viewPeople. This page never sent a token, so the names were
             * withheld from everybody, and every circle with people in it
             * announced itself as unheld to every reader it ever had.
             *
             * `holderCount` is public at every tier and always has been, so
             * the count is what the fallback is built from now. Names when we
             * have them, the true count when we do not, and "none held yet"
             * only when that is a fact.
             */
            const heldSeats = seats.reduce(
              (n: number, s: any) => n + Number(s.holderCount ?? 0),
              0,
            );
            return {
              id: String(c.id ?? c.name ?? `circle-${i}`),
              name: String(c.name ?? "Untitled circle"),
              subtitle: c.purpose ?? "",
              description: c.purpose ?? "",
              // A forming or dormant circle is one the village has named and
              // not yet started running, which is what "future" always meant.
              stage: String(c.status ?? "active") === "active" ? "today" : "future",
              // The seats a circle carries ARE its focus areas.
              seats: seats.filter((s: any) => s.name).map((s: any) => ({ id: String(s.id), name: String(s.name) })),
              /*
               * These two travelled from the admin form into the database and
               * were then deleted by `/api/org`'s projection, one line before
               * the wire. Every card on this page drew the fallback swatch and
               * the fallback glyph however carefully a village had chosen
               * otherwise, and nothing anywhere reported a problem.
               *
               * `shared/circleView.ts` is the projection now and it carries
               * both, so a colour set once shows up here, on the power map and
               * in the mini render, which is the whole point of there being
               * one projection.
               */
              icon: c.icon ?? undefined,
              color: c.color ?? undefined,
              members: heldBy.length
                ? Array.from(new Set(heldBy)).join(", ")
                : seats.length
                  ? heldSeats
                    ? `${seats.length} role${seats.length === 1 ? "" : "s"}, ${heldSeats} seat${heldSeats === 1 ? "" : "s"} held`
                    : `${seats.length} role${seats.length === 1 ? "" : "s"}, none held yet`
                  : "",
            } as CircleEntry;
          }),
        );
      })
      .catch(() => setFailed(true));
  }, []);

  const toggle = (id: string) =>
    setExpandedCircle((prev) => (prev === id ? null : id));

  const today = (circles ?? []).filter((c) => c.stage === "today");
  const future = (circles ?? []).filter((c) => c.stage === "future");
  const openRow = openSeat ? (raw.seats.find((r) => String(r?.id) === openSeat) ?? null) : null;

  return (
    <Layout>
      <section className="py-24 bg-background">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-16"
          >
            <div className="w-16 h-16 rounded-full bg-sage/10 flex items-center justify-center mx-auto mb-6">
              <Users className="w-8 h-8 text-sage" />
            </div>
            <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-4">
              Our Sociocratic Circles
            </h1>
            {/* R46 enchant-first: the canopy image carries the surface; the
                sociocracy mechanics live in the tooltips. */}
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-6">
              Circles are how the village thinks: each one tends its own{" "}
              <InfoTip tip="A domain is the ground a circle decides on without asking anyone above it. Real authority lives inside it.">domain</InfoTip>{" "}
              the way a tree tends its own ground, and{" "}
              <InfoTip tip="Two people belong to both a circle and the circle above it, one chosen by each. News travels both ways, so no circle drifts alone.">double links</InfoTip>{" "}
              weave them into one canopy.
            </p>
            <Link href="/roles" className="inline-flex items-center gap-2 px-6 py-3 bg-sage text-white rounded-lg hover:bg-sage/90 transition-colors font-medium">
              View Open Roles
              <ArrowRight className="w-4 h-4" />
            </Link>
          </motion.div>

          <div className="max-w-4xl mx-auto">
            {/* Members-only people: the cards below still carry every circle
                and every seat, so this says which part is missing and why. */}
            {circles !== null && (
              <div className="mb-12">
                <PeopleLockNote people={people} seats={seatCounts.seats} held={seatCounts.held} />
              </div>
            )}
            {/* One region, present from first paint, that the loading line
                and the failure line take turns filling. A live region added
                to a node that MOUNTS with its own text is missed by some
                screen readers; this one is already there, so the swap from
                "Loading circles" to the refusal is what gets announced.
                role="status" and not "alert": a list that did not load is
                news, not an interruption of something the member was doing. */}
            <div role="status">
              {circles === null && !failed && (
                <div className="text-center text-muted-foreground py-16">Loading circles…</div>
              )}
              {failed && (
                <div className="text-center text-muted-foreground py-16">
                  The circles are catching their breath. Please refresh in a moment.
                </div>
              )}
            </div>

            {/* The door to the map. A column of cards says what each circle
                IS; only the picture says how they sit together, and which
                seats are still waiting. Live, so it cannot go stale against
                the village it draws. */}
            {raw.circles.length > 0 && (
              <div className="mb-14">
                <CirclesMiniMap circles={raw.circles} seats={raw.seats} />
              </div>
            )}

            {today.length > 0 && (
              <div className="mb-16">
                <div className="mb-6">
                  <h2 className="font-display text-2xl font-bold text-foreground mb-1">The Circles Today</h2>
                  <p className="text-muted-foreground text-sm">
                    How the team actually organizes right now, while the village is being built.
                  </p>
                </div>
                <div className="space-y-4">
                  {today.map((circle, index) => (
                    <CircleCard
                      key={circle.id}
                      circle={circle}
                      expanded={expandedCircle === circle.id}
                      onToggle={() => toggle(circle.id)}
                      index={index}
                      onOpenSeat={setOpenSeat}
                    />
                  ))}
                </div>
              </div>
            )}

            {future.length > 0 && (
              <div className="mb-4">
                <div className="mb-6">
                  <h2 className="font-display text-2xl font-bold text-foreground mb-1">As the Village Matures</h2>
                  <p className="text-muted-foreground text-sm">
                    As residents arrive, today's team circles grow into resident-led councils like these: domain-specific circles connected through elected representatives.
                  </p>
                </div>
                <div className="space-y-4">
                  {future.map((circle, index) => (
                    <CircleCard
                      key={circle.id}
                      circle={circle}
                      expanded={expandedCircle === circle.id}
                      onToggle={() => toggle(circle.id)}
                      index={index}
                      onOpenSeat={setOpenSeat}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* The seat a chip opened, as the same role card the map draws,
                in the phone sheet. `sheet-night` makes the sheet's own panel
                the night ground, so the card sits in no light frame. The
                sheet moves focus in, hands it back to the chip on close, and
                closes on Escape and on the backdrop. On a wide screen the
                sheet spans the window and the card keeps to this page's own
                column, so it opens flat at the width /roles shows it. */}
            {openRow && (
              <SeatSheet label={String(openRow.name ?? "")} onClose={() => setOpenSeat(null)} className="sheet-night px-3">
                <div className="mx-auto w-full max-w-4xl">
                  <SeatTradingCard
                    input={fromOrgSeat(openRow, raw.circles, people, raw.village, { raiseHand })}
                    ctx={{ now: new Date(), season: seasonForSheet(season), classNames }}
                    action={<SeatAction circleId={openRow.circleId ?? null} />}
                  />
                  {!openRow.isExample && (
                    <div className="mt-4 border-t border-border pt-3">
                      <SeatHistory roleId={String(openRow.id)} canSeePeople={seatHistoryShown(people, raw.seats)} />
                    </div>
                  )}
                </div>
              </SeatSheet>
            )}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mt-16 bg-sage/5 p-8 rounded-2xl border border-sage/20"
          >
            <h2 className="font-display text-2xl font-bold text-foreground mb-4">
              How Circles Work Together
            </h2>
            <div className="space-y-4 text-muted-foreground">
              <p>
                Each circle has <strong>a domain, a budget, and the authority</strong> to make decisions within that domain. When decisions affect multiple circles, the <strong>General Coordinating Circle</strong>, the four leads and circle representatives, coordinates. The Finance & Business Circle provides budget stewardship, oversight, and alignment across all circles.
              </p>
              <p>
                Circles use <strong>consent-based decision-making</strong>: a proposal moves forward unless someone has a reasoned objection that it would cause harm or prevent the circle from achieving its aim. This creates space for wisdom and prevents tyranny of the majority.
              </p>
              <p>
                Every circle is <strong>double-linked</strong> to the General Coordinating Circle by two people, so information flows both ways. Regular reporting, check-ins, and feedback keep the whole aligned and adaptable.
              </p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mt-12 text-center"
          >
            <Link href="/roles">
              <a className="inline-flex items-center gap-2 px-6 py-3 bg-sage text-white rounded-lg hover:bg-sage/90 transition-colors font-medium">
                Learn About Roles & Leadership
                <ArrowRight className="w-4 h-4" />
              </a>
            </Link>
          </motion.div>
        </div>
      </section>
    </Layout>
  );
}
