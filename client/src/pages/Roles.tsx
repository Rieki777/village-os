import Layout from "@/components/Layout";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  ArrowRight,
  Briefcase,
  Shield,
  Lightbulb,
  ChevronDown,
  Users2,
  Zap,
  Leaf,
  Star,
  Home,
  Building2,
  CircleDot,
  Globe,
  Handshake,
  MessageCircle,
  ClipboardList,
  Scale,
} from "lucide-react";
import { useEffect, useState } from "react";
import InfoTip from "@/components/InfoTip";
import SeatClaimCard from "@/components/SeatClaimCard";
import { swatchFor } from "@/lib/swatch";
import { gameFetch } from "@/lib/gameApi";
import { PeopleLockNote, type PeopleTier } from "@/components/PeopleLock";
import SeatHistory from "@/components/power/SeatHistory";
import SeatNeeds from "@/components/power/SeatNeeds";
import { useAuth } from "@/contexts/AuthContext";

type RoleStatus = "filled" | "open" | "forming" | "partial";

interface RoleEntry {
  id: string;
  name: string;
  /** The circle this seat sits in, resolved from its id to a display name. */
  group: string;
  circleId?: string | null;
  status: RoleStatus;
  holders?: string[];
  holderNote?: string;
  aim: string;
  domain: string;
  accountabilities: string[];
  whyItMatters?: string;
  // Legacy key some stored cards may still carry.
  evolutionaryPurpose?: string;
  icon?: string;
  color?: string;
  /** A seeded demonstration seat. Its history is demo rows, so it stays off. */
  isExample?: boolean;
}

/** Icon names a card may reference; anything unknown falls back to CircleDot. */
const ICONS: Record<string, React.ElementType> = {
  Users, Briefcase, Shield, Lightbulb, Users2, Zap, Leaf, Star, Home,
  Building2, CircleDot, Globe, Handshake, MessageCircle, ClipboardList, Scale,
};

// The subtitles under each circle heading used to be a hardcoded map of one
// village's circle names, living in platform code: a fork got no subtitle for
// any circle it actually had. They come from the circle's own purpose now.

const statusBadge: Record<RoleStatus, { label: string; className: string }> = {
  filled: { label: "Filled", className: "bg-sage/15 text-sage border border-sage/30" },
  open: { label: "Open Role", className: "bg-amber/15 text-amber-700 border border-amber/40" },
  forming: { label: "Forming", className: "bg-teal/15 text-teal-deep border border-teal/30" },
  partial: { label: "Partially Filled", className: "bg-gold/20 text-amber-800 border border-gold/40" },
};

function normalizeStatus(s: unknown): RoleStatus {
  const v = String(s ?? "").toLowerCase();
  if (v.startsWith("fill")) return "filled";
  if (v.startsWith("part")) return "partial";
  if (v.startsWith("form")) return "forming";
  return "open";
}

interface RoleCardProps {
  role: RoleEntry;
  expanded: boolean;
  onToggle: () => void;
  index: number;
  /** Whether holder names reached this reader at all. */
  canSeePeople: boolean;
  /** Whether this reader may say what the seat is held for. */
  canTagNeeds: boolean;
}

function RoleCard({ role, expanded, onToggle, index, canSeePeople, canTagNeeds }: RoleCardProps) {
  const Icon = ICONS[role.icon ?? ""] ?? CircleDot;
  // Admin-editable colour, resolved together with the ink that stays legible
  // on it. See client/src/lib/swatch.ts.
  const swatch = swatchFor(role.color);
  const badge = statusBadge[role.status];
  const holders = (role.holders ?? []).filter(Boolean);
  const why = role.whyItMatters ?? role.evolutionaryPurpose ?? "";
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.04 }}
    >
      <button
        onClick={onToggle}
        className="w-full text-left bg-card hover:bg-card/80 transition-colors p-5 rounded-xl border border-border"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={`w-10 h-10 ${swatch.bg} rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5`}>
              <Icon className={`w-5 h-5 ${swatch.ink}`} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-0.5">
                <h3 className="font-display text-lg font-bold text-foreground leading-tight">{role.name}</h3>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.className}`}>
                  {badge.label}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {role.group}
                {holders.length > 0 && (
                  <span className="text-sage font-medium"> · {holders.join(", ")}</span>
                )}
              </p>
            </div>
          </div>
          <ChevronDown
            className={`w-5 h-5 text-muted-foreground transition-transform flex-shrink-0 mt-2 ${expanded ? "rotate-180" : ""}`}
          />
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
            <div className="bg-muted/30 p-6 rounded-b-xl border border-t-0 border-border space-y-5">
              {(holders.length > 0 || role.holderNote) && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Held By</h4>
                  <p className="text-sm text-foreground leading-relaxed">
                    {holders.length > 0 ? holders.join(", ") : "open"}
                    {role.holderNote && (
                      <span className="text-muted-foreground italic"> {role.holderNote}</span>
                    )}
                  </p>
                </div>
              )}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Aim
                  <InfoTip tip="The aim is what this role works toward: the outcome it exists to keep alive." label="What an aim is" />
                </h4>
                <p className="text-sm text-foreground leading-relaxed">{role.aim}</p>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Domain
                  <InfoTip tip="The domain is what this role decides on without asking. Inside it the role holder has real authority; outside it they bring proposals." label="What a domain is" />
                </h4>
                <p className="text-sm text-muted-foreground leading-relaxed">{role.domain}</p>
              </div>
              {(role.accountabilities ?? []).length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Key Accountabilities
                    <InfoTip tip="Accountabilities are the ongoing activities the circle can count on this role to keep doing." label="What accountabilities are" />
                  </h4>
                  <ul className="space-y-1.5">
                    {role.accountabilities.filter(Boolean).map((a) => (
                      <li key={a} className="text-sm text-muted-foreground flex gap-2">
                        <span className="text-sage mt-0.5 flex-shrink-0">✓</span>
                        {a}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {why && (
                <div className="pt-4 border-t border-border">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Why This Role Matters</h4>
                  <p className="text-sm text-muted-foreground italic leading-relaxed">{why}</p>
                </div>
              )}
              {/* "Held By" above is the seat today. This is the seat's whole
                  record, ended holdings included, which is the half a village
                  loses when it keeps its org chart in a document. Fetched only
                  once a reader opens the card. */}
              {!role.isExample && (
                <div className="pt-4 border-t border-border">
                  <SeatHistory roleId={role.id} canSeePeople={canSeePeople} />
                </div>
              )}
              {/* Which of the village's needs this seat carries (R18). A
                  description of the seat and never a condition on holding it:
                  who may sit here is decided by `org.seat` and by nothing
                  written on this line. */}
              {!role.isExample && (
                <div className="pt-4 border-t border-border">
                  <SeatNeeds roleId={role.id} canEdit={canTagNeeds} />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function Roles() {
  const [expandedRole, setExpandedRole] = useState<string | null>(null);
  const [roles, setRoles] = useState<RoleEntry[] | null>(null);
  const [circles, setCircles] = useState<any[]>([]);
  const [failed, setFailed] = useState(false);
  const [people, setPeople] = useState<PeopleTier | null>(null);
  const [seatCounts, setSeatCounts] = useState({ seats: 0, held: 0 });
  // Who may say what a seat is held for. The server refuses everybody else by
  // itself; this only decides whether the control is drawn.
  const { user } = useAuth();
  const canTagNeeds = !!user && (user.role === "admin" || user.role === "founder");

  // Seats are rows now (0049), not cards in a document. `state` arrives
  // DERIVED from live holdings against the seat count, so the page can no
  // longer show a seat marked filled with nobody in it, which the card-shaped
  // chart did for two seats at once.
  //
  // `gameFetch` carries the member's token; the bare `fetch` this replaces did
  // not. `/api/org` tiers holder names behind `map.viewPeople` and reads the
  // Authorization header alone, so this page asked as a stranger every time
  // and the holders list was empty for every reader it ever had.
  useEffect(() => {
    gameFetch("/api/org")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (!data || !Array.isArray(data.roles)) throw new Error("bad shape");
        const circleById = new Map<string, any>(
          (data.circles ?? []).map((c: any) => [c.id, c]),
        );
        setCircles(data.circles ?? []);
        setPeople(data.people ?? null);
        setSeatCounts({
          seats: (data.roles as any[]).reduce((n, r: any) => n + Number(r.seats ?? 0), 0),
          held: (data.roles as any[]).reduce((n, r: any) => n + Number(r.holderCount ?? 0), 0),
        });
        setRoles(
          (data.roles as any[]).map((r: any, i: number) => ({
            id: String(r.id ?? `role-${i}`),
            name: String(r.name ?? "Untitled role"),
            circleId: r.circleId ?? null,
            group: String(circleById.get(r.circleId)?.name ?? "Unplaced roles"),
            status: normalizeStatus(r.state),
            holders: (r.holders ?? []).map((h: any) => h.name).filter(Boolean),
            holderNote: (r.holders ?? []).map((h: any) => h.note).filter(Boolean).join(" "),
            aim: String(r.aim ?? ""),
            domain: String(r.domain ?? ""),
            accountabilities: Array.isArray(r.accountabilities) ? r.accountabilities : [],
            whyItMatters: r.whyItMatters ?? "",
            icon: r.icon ?? undefined,
            color: r.color ?? undefined,
            isExample: !!r.isExample,
          })),
        );
      })
      .catch(() => setFailed(true));
  }, []);

  const toggle = (id: string) =>
    setExpandedRole((prev) => (prev === id ? null : id));

  // Grouped by circle, in the order the village sorted its circles, with a
  // dormant circle's seats still listed under it.
  const circleOrder = new Map(circles.map((c, i) => [c.name, i]));
  const groups: { title: string; subtitle: string; roles: RoleEntry[] }[] = [];
  for (const role of roles ?? []) {
    const g = groups.find((x) => x.title === role.group);
    if (g) g.roles.push(role);
    else {
      const circle = circles.find((c) => c.name === role.group);
      groups.push({ title: role.group, subtitle: circle?.purpose ?? "", roles: [role] });
    }
  }
  groups.sort(
    (a, b) => (circleOrder.get(a.title) ?? 999) - (circleOrder.get(b.title) ?? 999),
  );

  return (
    <Layout>
      <section className="py-24 bg-background">
        <div className="container">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-16"
          >
            <div className="w-16 h-16 rounded-full bg-sage/10 flex items-center justify-center mx-auto mb-6">
              <Briefcase className="w-8 h-8 text-sage" />
            </div>
            <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground mb-4">
              Roles and Circles
            </h1>
            {/* R46 enchant-first: the forest image carries the surface; the
                sociocracy mechanics live in the three tooltips. */}
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              The village organizes itself the way a forest does:{" "}
              <InfoTip tip="Circles are sociocratic working groups with real authority over their own domain. Decisions inside a circle pass by consent.">circles</InfoTip>{" "}
              of care, each holding its own ground, and every{" "}
              <InfoTip tip="A role is a named responsibility inside a circle, with an aim, a domain, and accountabilities. The role belongs to the circle, and a person steps into it.">role</InfoTip>{" "}
              is a way to hold some of it with your own hands, by{" "}
              <InfoTip tip="A decision moves forward when nobody holds a reasoned objection. Consent is quieter than consensus and faster than voting.">consent</InfoTip>.
            </p>
          </motion.div>

          <div className="max-w-4xl mx-auto">
            {/* Offered here because this is the page that names you: the
                seat the village wrote down under your name is right below.
                Renders nothing for anyone with nothing to claim, which is
                every visit after the first. */}
            <SeatClaimCard />
            {/* How it works */}
            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="mb-14 grid sm:grid-cols-3 gap-4"
            >
              {[
                { label: "Circles", description: "Working groups with real authority. Each circle has an aim (what it works toward) and a domain (what it decides on), and links back to the General Coordinating Circle." },
                { label: "Roles", description: "Specific responsibilities inside a circle. One person can hold many roles. If a person leaves, the role stays and gets reassigned." },
                { label: "Consent", description: "Decisions move forward when no one has a reasoned objection that the proposal would cause harm or block the aim. Everyone loving them is not the bar." },
              ].map((item) => (
                <div key={item.label} className="rounded-xl bg-muted/30 border border-border p-5">
                  <div className="text-sm font-bold text-foreground mb-1">{item.label}</div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{item.description}</p>
                </div>
              ))}
            </motion.div>

            {/* Members-only people: every seat card below still carries its
                aim, its domain and whether it is held. This says whose names
                are missing and how to reach them. */}
            {roles !== null && (
              <div className="mb-12">
                <PeopleLockNote people={people} seats={seatCounts.seats} held={seatCounts.held} />
              </div>
            )}
            {/* Same always-present polite region as Circles.tsx: the node is
                in the DOM from first paint, so the change from the loading
                line to the failure line is the thing announced. */}
            <div role="status">
              {roles === null && !failed && (
                <div className="text-center text-muted-foreground py-16">Loading roles…</div>
              )}
              {failed && (
                <div className="text-center text-muted-foreground py-16">
                  The roles list is catching its breath. Please refresh in a moment.
                </div>
              )}
            </div>

            {groups.map(({ title, subtitle, roles: groupRoles }) => (
              <div className="mb-14" key={title}>
                <div className="mb-6">
                  <h2 className="font-display text-2xl font-bold text-foreground mb-1">{title}</h2>
                  {subtitle && (
                    <p className="text-muted-foreground text-sm">{subtitle}</p>
                  )}
                </div>
                <div className="space-y-3">
                  {groupRoles.map((role, i) => (
                    <RoleCard
                      key={role.id}
                      role={role}
                      expanded={expandedRole === role.id}
                      onToggle={() => toggle(role.id)}
                      index={i}
                      canSeePeople={!!people?.visible}
                      canTagNeeds={canTagNeeds}
                    />
                  ))}
                </div>
              </div>
            ))}

            {/* How tensions work */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mt-4 bg-sage/5 p-8 rounded-2xl border border-sage/20"
            >
              <h2 className="font-display text-2xl font-bold text-foreground mb-4">
                How Roles Evolve
              </h2>
              <p className="text-muted-foreground mb-4">
                A "tension" in sociocracy language is any felt gap between how things are and how they could be. Any team member who feels a tension brings it to their circle meeting. The circle holds space and decides together whether to adjust a role, create a new one, retire one, or send it up to the Leadership Circle.
              </p>
              <p className="text-muted-foreground">
                Decisions are made by consent. Consent means no one holds a reasoned objection based on their ability to do their work. It does not require unanimous agreement. The circle tries the change for an agreed period, then evaluates. Roles here are invitations to a specific way of serving the living purpose, not fixed job descriptions.
              </p>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mt-12 text-center"
          >
            <Link href="/circles" className="inline-flex items-center gap-2 px-6 py-3 bg-sage text-white rounded-lg hover:bg-sage/90 transition-colors font-medium">
              Explore Our Circles
              <ArrowRight className="w-4 h-4" />
            </Link>
          </motion.div>
        </div>
      </section>
    </Layout>
  );
}
