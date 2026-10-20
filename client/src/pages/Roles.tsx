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
  Link2,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { prefersReducedMotion } from "@/components/natural/useReducedMotion";
import InfoTip from "@/components/InfoTip";
import SeatClaimCard from "@/components/SeatClaimCard";
import { swatchFor } from "@/lib/swatch";
import { gameFetch, useSeason } from "@/lib/gameApi";
import { PeopleLockNote, type PeopleTier } from "@/components/PeopleLock";
import SeatAction from "@/components/power/SeatAction";
import { applyHrefFor, termsSlotFor } from "@/components/power/SeatTermsSlot";
import SeatHistory from "@/components/power/SeatHistory";
import SeatNeeds from "@/components/power/SeatNeeds";
import SeatTradingCard from "@/components/power/SeatTradingCard";
import SeatVendorFacts from "@/components/power/SeatVendorFacts";
import { useClassNames } from "@/components/power/useClassNames";
import { useModule } from "@/modules/ModuleProvider";
import { useAuth } from "@/contexts/AuthContext";
import { STATE_WORDS, isSeatState, type SeatStateWord, type SheetContext } from "@shared/roleSheet";
import { fromOrgSeat, orgHolderName, seasonForSheet, seatHistoryShown } from "@shared/roleSheetInputs";

interface RoleEntry {
  id: string;
  name: string;
  /** The circle this seat sits in, resolved from its id to a display name. */
  group: string;
  circleId?: string | null;
  status: SeatStateWord;
  holders?: string[];
  icon?: string;
  color?: string;
  /** A seeded demonstration seat. Its history is demo rows, so it stays off. */
  isExample?: boolean;
  /** The `/api/org` row as it arrived, which the role card reads for itself. */
  raw: any;
}

/** What every expanded card on the page reads besides its own row. */
interface SheetSource {
  circles: any[];
  people: PeopleTier | null;
  village: unknown;
  ctx: SheetContext;
  /** The raise-hand route lives under `/api/map`, so the door follows that module. */
  raiseHand: boolean;
  /** Whether the seat's history is shown to this reader (`seatHistoryShown`). */
  historyShown: boolean;
}

/** Icon names a card may reference; anything unknown falls back to CircleDot. */
const ICONS: Record<string, React.ElementType> = {
  Users, Briefcase, Shield, Lightbulb, Users2, Zap, Leaf, Star, Home,
  Building2, CircleDot, Globe, Handshake, MessageCircle, ClipboardList, Scale,
};

// The subtitles under each circle heading used to be a hardcoded map of one
// village's circle names, living in platform code: a fork got no subtitle for
// any circle it actually had. They come from the circle's own purpose now.

// The header's badge says the seat's state in the card's own words
// (`STATE_WORDS`), keyed by the union, so the row and the card below it can
// never disagree and a sixth state cannot draw an empty badge. A seat whose
// term reached its date used to fall through to "Open Role" here.
const statusBadge: Record<SeatStateWord, string> = {
  filled: "bg-sage/15 text-sage border border-sage/30",
  open: "bg-amber/15 text-amber-700 border border-amber/40",
  forming: "bg-teal/15 text-teal-deep border border-teal/30",
  partial: "bg-gold/20 text-amber-800 border border-gold/40",
  expired: "bg-gold/20 text-amber-800 border border-gold/40",
};

function normalizeStatus(s: unknown): SeatStateWord {
  const v = String(s ?? "").toLowerCase();
  if (isSeatState(v)) return v;
  if (v.startsWith("fill")) return "filled";
  if (v.startsWith("part")) return "partial";
  if (v.startsWith("form")) return "forming";
  return "open";
}

// ONE SEAT'S CARD IS A LINK: `/roles?seat=<id>`, the way /map/circles keeps
// `?focus=` (VillageMap.tsx, `focusFromUrl` and `focusTo`). A steward
// recruiting for a seat sends the link and the reader lands on that card.
// A seat id is a slug of the seat's own name (`createOrgRole`), so no person
// is ever written into the address.

/** The seat the address names, read once on arrival. */
function seatFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("seat") || null;
}

/**
 * Keeps the address in the bar the link to whatever is open. REPLACED and
 * never pushed: opening and closing rows is reading one page, so Back still
 * leaves it in one press. Nothing is pushed, so no popstate listener either.
 */
function writeSeatToUrl(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("seat", id);
  else url.searchParams.delete("seat");
  window.history.replaceState(window.history.state, "", url.toString());
}

/** The absolute link to one seat's card. */
function seatLink(id: string): string {
  const url = new URL("/roles", window.location.origin);
  url.searchParams.set("seat", id);
  return url.toString();
}

/**
 * "Copy link" under one seat's card. The clipboard write runs inside the
 * click, which is the user activation a browser asks for. Where the clipboard
 * refuses or is missing (an http origin has no `navigator.clipboard`), the
 * link appears in a read-only field, selected, for the reader to copy by
 * hand. The polite line below is in the row from the moment it opens, so what
 * lands in it is announced.
 *
 * Every name here carries the seat. The control sits outside the card's
 * `aria-labelledby`, and a screen reader listing the page's buttons hears
 * each one on its own, so a fixed "this seat" read the same under every row
 * and named none of them. The visible words stay "Copy link" and open the
 * accessible name, so a reader who says what they see still reaches it.
 */
function SeatLinkCopy({ seatId, seatName }: { seatId: string; seatName: string }) {
  const link = seatLink(seatId);
  const [said, setSaid] = useState<"" | "copied" | "refused">("");
  // A count so a second refusal selects the field again.
  const [refused, setRefused] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!refused) return;
    field.current?.focus();
    field.current?.select();
  }, [refused]);
  useEffect(() => {
    if (said !== "copied") return;
    const t = window.setTimeout(() => setSaid(""), 4000);
    return () => window.clearTimeout(t);
  }, [said]);
  const fallBack = () => {
    setRefused((n) => n + 1);
    setSaid("refused");
  };
  const copy = () => {
    setSaid("");
    const clip = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clip?.writeText) return fallBack();
    clip.writeText(link).then(() => setSaid("copied"), fallBack);
  };
  const line =
    said === "copied"
      ? `Link to ${seatName} copied.`
      : said === "refused"
        ? "Copying did not work here. The link is selected in the field below."
        : "";
  return (
    <div className="pt-4 border-t border-border space-y-2">
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy link to ${seatName}`}
        className="inline-flex items-center gap-2 min-h-[44px] text-sm font-medium text-foreground underline underline-offset-2"
      >
        <Link2 className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
        Copy link
      </button>
      {refused > 0 && (
        <input
          ref={field}
          type="text"
          readOnly
          value={link}
          aria-label={`Link to ${seatName}`}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
        />
      )}
      <p role="status" className="text-xs text-muted-foreground">{line}</p>
    </div>
  );
}

interface RoleCardProps {
  role: RoleEntry;
  expanded: boolean;
  onToggle: () => void;
  index: number;
  /** Whether this reader may say what the seat is held for. */
  canTagNeeds: boolean;
  sheet: SheetSource;
  /** The reader arrived by a link to this seat (`?seat=`). */
  arrive: boolean;
}

function RoleCard({ role, expanded, onToggle, index, canTagNeeds, sheet, arrive }: RoleCardProps) {
  // Whose words the vendor panel shows. Taken from the listing rather than
  // written here, because another fork's connector is a different service
  // and a literal would be this platform naming one of them.
  const vendorName = useModule("saberra")?.name ?? "the connected service";
  const headerId = `${useId().replace(/[^a-zA-Z0-9]/g, "")}-seat`;
  const Icon = ICONS[role.icon ?? ""] ?? CircleDot;
  // Admin-editable colour, resolved together with the ink that stays legible
  // on it. See client/src/lib/swatch.ts.
  const swatch = swatchFor(role.color);
  const holders = (role.holders ?? []).filter(Boolean);
  // Arriving by a link to this seat: its header is scrolled to and takes
  // focus, so a keyboard or screen-reader reader starts at the seat they were
  // sent to. `instant` under reduced motion, because `html` scrolls smoothly
  // by default (index.css).
  const header = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = header.current;
    if (!arrive || !el) return;
    el.scrollIntoView?.({ behavior: prefersReducedMotion() ? "instant" : "smooth", block: "start" });
    el.focus({ preventScroll: true });
  }, [arrive]);
  return (
    <motion.div
      // The linked row is drawn in place. Its entrance offset is still on it
      // when the scroll is measured, so it would settle 20px higher, under
      // the sticky nav (measured in Chromium: header top 92, nav bottom 96).
      initial={arrive ? false : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.04 }}
    >
      <button
        ref={header}
        id={headerId}
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full text-left bg-card hover:bg-card/80 transition-colors p-5 rounded-xl border border-border scroll-mt-28"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={`w-10 h-10 ${swatch.bg} rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5`}>
              <Icon className={`w-5 h-5 ${swatch.ink}`} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-0.5">
                <h3 className="font-display text-lg font-bold text-foreground leading-tight">{role.name}</h3>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge[role.status]}`}>
                  {STATE_WORDS[role.status]}
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

      {/* The linked row arrives open, with no opening animation: measuring a
          height of "auto" makes framer-motion restore the scroll it found
          (`window.scrollTo(0, y)`), which cancels the smooth scroll above in
          its first frame and leaves the reader at the top of the page. */}
      <AnimatePresence initial={!arrive}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-muted/30 p-6 rounded-b-xl border border-t-0 border-border space-y-5">
              {/* The role card, the same one the map draws, from this page's
                  own `/api/org` row at whatever tier it was served. The row
                  header above already says the circle and the state, so the
                  card leaves both out and is named by that header. Its one
                  door is a raised hand, offered while the map module is on
                  for this reader; the contact relay stays on the map. */}
              <SeatTradingCard
                embedded
                labelledBy={headerId}
                input={fromOrgSeat(role.raw, sheet.circles, sheet.people, sheet.village, { raiseHand: sheet.raiseHand })}
                ctx={sheet.ctx}
                action={<SeatAction circleId={role.circleId ?? null} applyHref={applyHrefFor(role.raw)} />}
                settings={termsSlotFor(role.raw)}
              />
              {/* The seat as a link, for sending to whoever might hold it.
                  Outside the night card, in this page's own light inks. Not
                  on a demonstration seat: nobody is recruited for one, so a
                  link to it has nothing to ask anybody. */}
              {!role.isExample && <SeatLinkCopy seatId={role.id} seatName={role.name} />}
              {/* The card is the seat today. This is the seat's whole record,
                  ended holdings included, which is the half a village loses
                  when it keeps its org chart in a document. Fetched only once
                  a reader opens the card. */}
              {!role.isExample && (
                <div className="pt-4 border-t border-border">
                  <SeatHistory roleId={role.id} canSeePeople={sheet.historyShown} />
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
              {/* What a connected service holds about this seat, in that
                  service's own words. Open to every member on purpose: the
                  question it answers is whether to put your hand up for this
                  seat, and that is not a steward's question. Renders nothing
                  at all when no such module is on. */}
              {!role.isExample && (
                <div className="pt-4 border-t border-border empty:hidden empty:pt-0 empty:border-t-0">
                  <SeatVendorFacts entityKind="org_role" entityId={role.id} serviceName={vendorName} />
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
  // The seat a link named. Rows mount only once the seats load, so the
  // matching row mounts open and arriving (scrolled to, focused); a miss is
  // said in one line.
  const [linked] = useState<string | null>(seatFromUrl);
  const [expandedRole, setExpandedRole] = useState<string | null>(linked);
  const [linkMissed, setLinkMissed] = useState(false);
  const [roles, setRoles] = useState<RoleEntry[] | null>(null);
  const [circles, setCircles] = useState<any[]>([]);
  const [failed, setFailed] = useState(false);
  const [people, setPeople] = useState<PeopleTier | null>(null);
  const [village, setVillage] = useState<unknown>(undefined);
  const [historyShown, setHistoryShown] = useState(false);
  const [seatCounts, setSeatCounts] = useState({ seats: 0, held: 0 });
  // Who may say what a seat is held for. The server refuses everybody else by
  // itself; this only decides whether the control is drawn.
  const { user } = useAuth();
  const canTagNeeds = !!user && (user.role === "admin" || user.role === "founder");
  // The card's clock and the village's class names: one cached read each for
  // the whole page, however many rows are opened.
  const season = useSeason();
  const classNames = useClassNames();
  // A raised hand posts under `/api/map`, which the map module gates. Offered
  // only while this reader's catalog lists the module as on: a catalog that
  // failed to load offers nothing, because the door would answer 404.
  const map = useModule("map");
  const raiseHand = !!map && map.lifecycle !== "off";

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
        setVillage(data.village);
        setHistoryShown(seatHistoryShown(data.people, data.roles));
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
            // An agent's member row carries a vendor's name; the header says
            // "An agent", as the card under it and the public tier do.
            holders: (r.holders ?? []).map(orgHolderName).filter((n: string | null): n is string => !!n),
            icon: r.icon ?? undefined,
            color: r.color ?? undefined,
            isExample: !!r.isExample,
            raw: r,
          })),
        );
      })
      .catch(() => setFailed(true));
  }, []);

  // A link to a seat the page no longer lists closes nothing and opens
  // nothing: the line says so and the address drops the seat, so the bar
  // still names what is open. A failed load says its own line and leaves the
  // address alone, so a refresh tries the link again.
  useEffect(() => {
    if (!roles || !linked || roles.some((r) => r.id === linked)) return;
    setExpandedRole(null);
    setLinkMissed(true);
    writeSeatToUrl(null);
  }, [roles, linked]);

  const toggle = (id: string) => {
    const next = expandedRole === id ? null : id;
    setExpandedRole(next);
    setLinkMissed(false);
    writeSeatToUrl(next);
  };
  const sheet: SheetSource = {
    circles,
    people,
    village,
    ctx: { now: new Date(), season: seasonForSheet(season), classNames },
    raiseHand,
    historyShown,
  };

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
              {linkMissed && (
                <p className="text-center text-sm text-muted-foreground mb-8">
                  That seat is not on this page anymore.
                </p>
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
                      canTagNeeds={canTagNeeds}
                      sheet={sheet}
                      arrive={linked === role.id}
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
