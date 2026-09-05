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
import CirclesMiniMap, { type MiniCircle, type MiniSeat } from "@/components/CirclesMiniMap";
import InfoTip from "@/components/InfoTip";
import { swatchFor } from "@/lib/swatch";
import { gameFetch } from "@/lib/gameApi";
import { PeopleLockNote, type PeopleTier } from "@/components/PeopleLock";

interface CircleEntry {
  id: string;
  name: string;
  subtitle?: string;
  stage: "today" | "future";
  description?: string;
  domain?: string;
  members?: string;
  focus: string[];
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

function CircleCard({ circle, expanded, onToggle, index }: {
  circle: CircleEntry;
  expanded: boolean;
  onToggle: () => void;
  index: number;
}) {
  const Icon = ICONS[circle.icon ?? ""] ?? CircleDot;
  // The icon swatch and the focus-area pills below are both drawn on this
  // colour, so the ink travels with it rather than being assumed to be white.
  const swatch = swatchFor(circle.color);
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
            <div className={`w-12 h-12 ${swatch.bg} rounded-lg flex items-center justify-center flex-shrink-0 mt-1`}>
              <Icon className={`w-6 h-6 ${swatch.ink}`} />
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

              {circle.focus.length > 0 && (
                <div>
                  <h4 className="font-semibold text-foreground mb-3">Key Focus Areas</h4>
                  <div className="flex flex-wrap gap-2">
                    {circle.focus.filter(Boolean).map((area) => (
                      <span key={area} className={`px-3 py-1 rounded-full text-xs font-medium ${swatch.bg} ${swatch.ink} shadow-sm`}>
                        {area}
                      </span>
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
  // The rows as they arrived, kept for the mini map. The cards flatten a
  // circle into prose (`focus`, `members`) and drop the nesting and the
  // seat states, which are exactly what the picture is made of.
  const [raw, setRaw] = useState<{ circles: MiniCircle[]; seats: MiniSeat[] }>({ circles: [], seats: [] });
  const [failed, setFailed] = useState(false);
  const [people, setPeople] = useState<PeopleTier | null>(null);
  const [seatCounts, setSeatCounts] = useState({ seats: 0, held: 0 });

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
        setRaw({
          circles: (data.circles as MiniCircle[]) ?? [],
          seats: (data.roles as MiniSeat[]) ?? [],
        });
        setSeatCounts({
          seats: (data.roles ?? []).reduce((n: number, r: any) => n + Number(r.seats ?? 0), 0),
          held: (data.roles ?? []).reduce((n: number, r: any) => n + Number(r.holderCount ?? 0), 0),
        });
        setCircles(
          (data.circles as any[]).map((c: any, i: number) => {
            const seats = seatsByCircle.get(c.id) ?? [];
            const heldBy = seats
              .flatMap((s: any) => (s.holders ?? []).map((h: any) => h.name))
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
              focus: seats.map((s: any) => s.name).filter(Boolean),
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
                    />
                  ))}
                </div>
              </div>
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
