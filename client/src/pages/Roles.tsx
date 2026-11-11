import ArchetypeStep from "@/components/roleDraft/ArchetypeStep";
import CircleName from "@/components/circles/CircleName";
import { anchorCircleId } from "@shared/circlePicker";
import SeasonGoals from "@/components/roleDraft/SeasonGoals";
import { BTN_NOTICE, BTN_PRIMARY, BTN_SECONDARY, CARD, H1, H2, LINK, RING, TILE, WORLD } from "@/components/journey/look";
import NotListedChip from "@/components/NotListedChip";
import Layout from "@/components/Layout";
import { Link } from "wouter";
import { m, AnimatePresence } from "framer-motion";
import { ArrowRight, Briefcase, ChevronDown, Link2 } from "lucide-react";
import { iconFor } from "@/lib/circleIcons";
import { useEffect, useId, useRef, useState } from "react";
import { prefersReducedMotion } from "@/components/natural/useReducedMotion";
import InfoTip from "@/components/InfoTip";
import SeatClaimCard from "@/components/SeatClaimCard";
import { swatchFor } from "@/lib/swatch";
import { gameFetch, useSeason } from "@/lib/gameApi";
import { PeopleLockNote, type PeopleTier } from "@/components/PeopleLock";
import SeatAction from "@/components/power/SeatAction";
import { applyHrefFor, guardedAction, termsSlotFor } from "@/components/power/SeatTermsSlot";
import SeatHistory from "@/components/power/SeatHistory";
import SeatNeeds from "@/components/power/SeatNeeds";
import VillageConflictSteps from "@/components/governance/VillageConflictSteps";
import SeatTradingCard from "@/components/power/SeatTradingCard";
import EditRoleButton, { NewRoleFromCardButton } from "@/components/roleEdit/EditRoleButton";
import SeatVendorFacts from "@/components/power/SeatVendorFacts";
import RoleHolderCards from "@/components/playerCard/RoleHolderCards";
import RaiseTension from "@/components/roleTension/RaiseTension";
import { agentProposalHref, proposeRoleHref } from "@/components/roleProposal/QuickPath";
import { useClassNames } from "@/components/power/useClassNames";
import { useModule } from "@/modules/ModuleProvider";
import { useAuth } from "@/contexts/AuthContext";
import { Trans, useLingui } from "@lingui/react/macro";
import { isSeatState, type SeatStateWord, type SheetContext } from "@shared/roleSheet";
import { fromOrgSeat, orgHolderName, seasonForSheet, seatHistoryShown } from "@shared/roleSheetInputs";
import { coordinatingCircle } from "@shared/coordinatingCircle";
import FoundingTeam, { type FoundingRole } from "@/components/roleCard/FoundingTeam";
import FullRoleCard from "@/components/roleCard/FullRoleCard";
import { readFoundingTeam, type FoundingTeamAnswer } from "@/components/roleCard/roleCardApi";

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


// The subtitles under each circle heading used to be a hardcoded map of one
// village's circle names, living in platform code: a fork got no subtitle for
// any circle it actually had. They come from the circle's own purpose now.

// The header's badge says the seat's state in the card's own words
// (`STATE_WORDS`), keyed by the union, so the row and the card below it can
// never disagree and a sixth state cannot draw an empty badge. A seat whose
// term reached its date used to fall through to "Open Role" here.
const statusBadge: Record<SeatStateWord, string> = {
  // The sheet's state colours (docs/DESIGN_RULE.md): held is living green, open is the gold of
  // what can be taken up, the rest are quiet. Semantic tokens, so they read on the night ground.
  filled: "bg-open/10 text-open border border-open/40",
  open: "bg-notice/10 text-notice border border-notice/50",
  forming: "bg-muted text-foreground border border-border",
  partial: "bg-muted text-foreground border border-border",
  expired: "bg-muted text-muted-foreground border border-border",
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
  const { t } = useLingui();
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
    const timer = window.setTimeout(() => setSaid(""), 4000);
    return () => window.clearTimeout(timer);
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
      ? t({ message: `Link to ${seatName} copied.`, context: "roles page, role link" })
      : said === "refused"
        ? t`Copying did not work here. The link is selected in the field below.`
        : "";
  return (
    <div className="pt-4 border-t border-border space-y-2">
      <button
        type="button"
        onClick={copy}
        aria-label={t({ message: `Copy link to ${seatName}`, context: "roles page, role link" })}
        className="inline-flex items-center gap-2 min-h-[44px] text-sm font-medium text-foreground underline underline-offset-2"
      >
        <Link2 className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
        {t({ message: `Copy link`, context: "roles page, role link" })}
      </button>
      {refused > 0 && (
        <input
          ref={field}
          type="text"
          readOnly
          value={link}
          aria-label={t({ message: `Link to ${seatName}`, context: "roles page, role link" })}
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
  const { t } = useLingui();
  const vendorName = useModule("saberra")?.name ?? t({ message: `the connected service`, context: "roles page, a connected service's fallback name" });
  const stateWords: Record<SeatStateWord, string> = {
    open: t({ message: `Open`, context: "roles page, role state" }),
    partial: t({ message: `Partly held`, context: "roles page, role state" }),
    filled: t({ message: `Held`, context: "roles page, role state" }),
    forming: t({ message: `Forming`, context: "roles page, role state" }),
    expired: t`Ready to be re-chosen`,
  };
  const headerId = `${useId().replace(/[^a-zA-Z0-9]/g, "")}-seat`;
  const Icon = iconFor(role.icon);
  // Admin-editable colour, resolved together with the ink that stays legible
  // on it. See client/src/lib/swatch.ts.
  const swatch = swatchFor(role.color);
  const holders = (role.holders ?? []).filter(Boolean);
  const [fullOpen, setFullOpen] = useState(false);
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
    <m.div
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
        className="w-full text-left bg-card hover:bg-muted transition-colors p-5 rounded-xl border border-border shadow-sm scroll-mt-28 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
                  {stateWords[role.status]}
                </span>
                <NotListedChip role={role.raw} />
                {/* 0374: the card says an agent may hold it (a card that has not said shows nothing). */}
                {(role.raw?.card?.heldBy === "agent" || role.raw?.card?.heldBy === "either") && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-muted text-foreground border border-border" data-testid="agent-may-hold">
                    <Trans context="roles directory chip">Can be held by an agent</Trans>
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {role.group}
                {holders.length > 0 && (
                  <span className="text-open font-medium"> · {holders.join(", ")}</span>
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
          <m.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-muted p-6 rounded-b-xl border border-t-0 border-border space-y-5">
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
                action={guardedAction(role.raw, <SeatAction circleId={role.circleId ?? null} applyHref={applyHrefFor(role.raw)} />)}
                settings={termsSlotFor(role.raw)}
              />
              {/* The full card: everything the role editor holds, read-only (build list 4.4). */}
              {!role.isExample && (
                <details className="group rounded-xl border border-border bg-card" data-full-card-details={role.id} onToggle={(e) => setFullOpen((e.currentTarget as HTMLDetailsElement).open)}>
                  <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 py-2 text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                    <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
                    {t({ message: "Read the full card", context: "roles page, opens a role's full card" })}
                  </summary>
                  <div className="p-2 sm:p-3">
                    {/* Mounted once opened, so a closed row reads nothing more. */}
                    {fullOpen && <FullRoleCard seat={role.raw} circleName={role.group} showTitle={false} labelledBy={headerId} />}
                  </div>
                </details>
              )}
              {/* The seat as a link, for sending to whoever might hold it.
                  Outside the night card, in this page's own light inks. Not
                  on a demonstration seat: nobody is recruited for one, so a
                  link to it has nothing to ask anybody. */}
              {!role.isExample && <RoleHolderCards role={role.raw} />}
              {!role.isExample && <SeatLinkCopy seatId={role.id} seatName={role.name} />}
              {/* For a holder of the power to decide the structure, and nobody else: the editor is its own chunk. */}
              {!role.isExample && <EditRoleButton roleId={role.id} onSaved={() => window.location.reload()} />}
              {!role.isExample && (
                <Link href={proposeRoleHref(role.id)} className={`w-fit ${BTN_NOTICE}`}>
                  {t`Propose this role for next season`}
                </Link>
              )}
              {!role.isExample && role.raw?.card?.agentMayHold === true && (
                <Link href={agentProposalHref(role.id)} className={`w-fit ${BTN_SECONDARY}`}>
                  <Trans context="roles directory: a member proposes an agent they keep">Propose an agent for this role</Trans>
                </Link>
              )}
              {!role.isExample && <RaiseTension roleId={role.id} roleName={role.name} />}
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
          </m.div>
        )}
      </AnimatePresence>
    </m.div>
  );
}

export default function Roles() {
  // The seat a link named. Rows mount only once the seats load, so the
  // matching row mounts open and arriving (scrolled to, focused); a miss is
  // said in one line.
  const [linked] = useState<string | null>(seatFromUrl);
  const [expandedRole, setExpandedRole] = useState<string | null>(linked);
  const [linkMissed, setLinkMissed] = useState(false);
  // The roles stay behind step one until the visitor picks an archetype (which leaves the
  // page) or presses "See all roles". A link to one seat is a question about that seat, so it shows them.
  const [showAll, setShowAll] = useState(linked !== null);
  const allHeading = useRef<HTMLHeadingElement>(null);
  const revealed = useRef(linked !== null);
  useEffect(() => {
    if (showAll && !revealed.current) allHeading.current?.focus();
    revealed.current = showAll;
  }, [showAll]);
  const [roles, setRoles] = useState<RoleEntry[] | null>(null);
  const [circles, setCircles] = useState<any[]>([]);
  const [failed, setFailed] = useState(false);
  const [people, setPeople] = useState<PeopleTier | null>(null);
  const [village, setVillage] = useState<unknown>(undefined);
  const [historyShown, setHistoryShown] = useState(false);
  const [seatCounts, setSeatCounts] = useState({ seats: 0, held: 0 });
  // The founding team section (org.founding_team). Null until read; a failed read is the section off.
  const [founding, setFounding] = useState<FoundingTeamAnswer | null>(null);
  // VERIFY 2.2: the server sends an unlisted role to a steward or an admin, with its chip. The
  // page used to list them all by default, so a founder checking "List only these" still saw
  // every role and read the update as not taken. Now the page shows what a visitor sees, and
  // the admin view is one switch away.
  const [showUnlisted, setShowUnlisted] = useState(false);
  useEffect(() => {
    let live = true;
    void readFoundingTeam().then((a) => live && setFounding(a));
    return () => {
      live = false;
    };
  }, []);
  // Who may say what a seat is held for. The server refuses everybody else by
  // itself; this only decides whether the control is drawn.
  const { user } = useAuth();
  const { t } = useLingui();
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

  // The circle the others link back to is the village's own top circle, or
  // none. This line named "the General Coordinating Circle" to every village.
  // Held invisible until /api/org answers, so the sentence never grows a
  // clause in front of the reader.
  const coordinator = coordinatingCircle(circles);
  const anchorId = anchorCircleId(circles);
  const orgPending = roles === null && !failed;
  // A link to one role (?seat=) names that role in the page heading, not the whole page.
  const linkedName = linked ? ((roles ?? []) as Array<{ id: string; name: string }>).find((r) => r.id === linked)?.name ?? null : null;
  const circlesHow = coordinator
    ? t`Working groups with real authority. Each circle has an aim (what it works toward) and a domain (what it decides on), and links back to the ${String(coordinator.name)}.`
    : t`Working groups with real authority. Each circle has an aim (what it works toward) and a domain (what it decides on).`;

  // Grouped by circle, in the order the village sorted its circles, with a
  // dormant circle's seats still listed under it.
  const circleOrder = new Map(circles.map((c, i) => [c.name, i]));
  const featured: FoundingRole[] = founding?.on
    ? founding.roleIds
        .map((id) => (roles ?? []).find((r) => r.id === id))
        .filter((r): r is RoleEntry => !!r && r.raw?.listed !== false)
        .map((r) => ({ seat: r.raw, circleName: r.group, sections: founding.sections[r.id] ?? null }))
    : [];
  const featuredShown = new Set(featured.map((f) => String(f.seat.id)));
  const unlistedCount = (roles ?? []).filter((r) => r.raw?.listed === false).length;
  // Each role appears once: a featured role lives in the founding section. A linked seat is a
  // question about that seat, so it shows wherever it is.
  const directory = (roles ?? []).filter((r) => r.id === linked || ((showUnlisted || r.raw?.listed !== false) && !featuredShown.has(r.id)));
  const groups: { title: string; subtitle: string; circleId: string | null; roles: RoleEntry[] }[] = [];
  for (const role of directory) {
    const g = groups.find((x) => x.title === role.group);
    if (g) g.roles.push(role);
    else {
      const circle = circles.find((c) => c.name === role.group);
      groups.push({ title: role.group, subtitle: circle?.purpose ?? "", circleId: circle?.id ?? null, roles: [role] });
    }
  }
  groups.sort(
    (a, b) => (circleOrder.get(a.title) ?? 999) - (circleOrder.get(b.title) ?? 999),
  );

  return (
    <Layout>
      {/* The sheet's world (docs/DESIGN_RULE.md): the same night ground and display face as the profile. */}
      <section className={`${WORLD} py-16 sm:py-24`}>
        <div className="container">
          {/* Header */}
          <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-16"
          >
            <div className={`${RING} mx-auto mb-6 size-16`}>
              <Briefcase className="w-7 h-7" aria-hidden="true" />
            </div>
            <h1 className={`${H1} mb-4`}>
              {linkedName ?? t({ message: `Roles and Circles`, context: "roles page" })}
            </h1>
            {/* R46 enchant-first: the forest image carries the surface; the
                sociocracy mechanics live in the three tooltips. */}
            <p className="text-lg leading-relaxed text-muted-foreground max-w-2xl mx-auto sm:text-xl">
              {t`The village organizes itself the way a forest does:`}{" "}
              <InfoTip tip={t`Circles are sociocratic working groups with real authority over their own domain. Decisions inside a circle pass by consent.`}>{t({ message: `circles`, context: "roles page, intro word with a tooltip" })}</InfoTip>{" "}
              {t`of care, each holding its own ground, and every`}{" "}
              <InfoTip tip={t`A role is a named responsibility inside a circle, with an aim, a domain, and accountabilities. The role belongs to the circle, and a person steps into it.`}>{t({ message: `role`, context: "roles page, intro word with a tooltip" })}</InfoTip>{" "}
              {t`is a way to hold some of it with your own hands, by`}{" "}
              <InfoTip tip={t`A decision moves forward when nobody holds a reasoned objection. Consent is quieter than consensus and faster than voting.`}>{t({ message: `consent`, context: "roles page, intro word with a tooltip" })}</InfoTip>.
            </p>
            <div className="mt-4 flex justify-center">
              <NewRoleFromCardButton onMade={() => window.location.reload()} />
            </div>
            {canTagNeeds && (
              <p className="mt-3 text-sm">
                <Link href="/role-measures" className={LINK}>
                  {t({ message: "How roles are going", context: "roles page measures door" })}
                </Link>
              </p>
            )}
            {/* The draft board: pick characters, scout, shortlist, apply (pages/RoleDraft.tsx). While the
                founding team is featured, its one act per card is the page's primary act, so this stays off. */}
            {featured.length === 0 && (
              <Link
                href="/roles/select"
                className={`mt-6 ${BTN_PRIMARY}`}
              >
                {t({ message: "Browse the open roles", context: "roles page button" })}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            )}
          </m.div>

          {featured.length > 0 && <FoundingTeam roles={featured} villagePay={founding?.villagePay ?? null} />}

          {/* OTHER WAYS TO JOIN: clearly secondary to the founding team, and open from the start. */}
          <section aria-labelledby="other-ways" className="mx-auto mb-14 max-w-4xl" data-other-ways="">
            <h2 id="other-ways" className={`${H2} mb-2`}>{t({ message: "Other ways to join", context: "roles page, other ways to join" })}</h2>
            <p className="mb-4 text-sm text-muted-foreground">{t({ message: "Not every way in is a founding role. Each of these is open now.", context: "roles page, other ways to join" })}</p>
            <ul className="grid gap-3 sm:grid-cols-2">
              <li className={TILE}>
                <Link href="/role-proposals/new" className={`inline-flex min-h-11 items-center gap-2 ${LINK}`} data-propose-new-role="">
                  {t({ message: "Propose a new role", context: "roles page, other ways to join" })}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">{t({ message: "Propose is for a role we do not list. Tell us the role you see, and the village decides.", context: "roles page, other ways to join" })}</p>
              </li>
              <li className={TILE}>
                <Link href="/quests" className={`inline-flex min-h-11 items-center gap-2 ${LINK}`}>
                  {t({ message: "Take a quest, alone or with others", context: "roles page, other ways to join" })}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </li>
            </ul>
          </section>

          <SeasonGoals />
          <ArchetypeStep allShown={showAll} onSeeAll={() => setShowAll(true)} />

          <div className="max-w-4xl mx-auto">
            {/* Offered here because this is the page that names you: the
                seat the village wrote down under your name is right below.
                Renders nothing for anyone with nothing to claim, which is
                every visit after the first. */}
            <SeatClaimCard />
            {/* How it works */}
            <m.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="mb-14 grid sm:grid-cols-3 gap-4"
            >
              {[
                { label: t({ message: `Circles`, context: "roles page, how it works" }), description: circlesHow, pending: orgPending },
                { label: t({ message: `Roles`, context: "roles page, how it works" }), description: t`Specific responsibilities inside a circle. One person can hold many roles. If a person leaves, the role stays and gets reassigned.` },
                { label: t({ message: `Consent`, context: "roles page, how it works" }), description: t`Decisions move forward when no one has a reasoned objection that the proposal would cause harm or block the aim. Everyone loving them is not the bar.` },
              ].map((item) => (
                <div key={item.label} className={TILE}>
                  <div className="text-sm font-bold text-foreground mb-1">{item.label}</div>
                  <p className={`text-xs text-muted-foreground leading-relaxed${"pending" in item && item.pending ? " invisible" : ""}`}>{item.description}</p>
                </div>
              ))}
            </m.div>

            {showAll && (
              <div>
                <h2 ref={allHeading} tabIndex={-1} className="mb-8 font-display text-3xl text-foreground focus:outline-none">
                  {t({ message: "All roles and circles", context: "roles page archetypes" })}
                </h2>
            {/* Members-only people: every seat card below still carries its
                aim, its domain and whether it is held. This says whose names
                are missing and how to reach them. */}
            {roles !== null && (
              <div className="mb-12">
                <PeopleLockNote people={people} seats={seatCounts.seats} held={seatCounts.held} />
              </div>
            )}
            {/* SLOT FOR LANE A4 (PR 1193, wt/a4-roots): <RootsFilterToggle noun="roles" /> renders here, and
                `directory` above is filtered by useRootsFilter(user?.id).apply(directory, (r) => r.raw?.archetypes ?? []).
                Left for the integrator: those imports are not on this branch's base. */}
            {/* The admin view: only a reader the server sent unlisted roles to has anything to switch on. */}
            {unlistedCount > 0 && (
              <label className="mb-8 flex min-h-11 items-center gap-3 rounded-xl border border-border bg-card px-4 py-2 text-sm text-foreground" data-show-unlisted="">
                <input type="checkbox" className="size-5 accent-notice" checked={showUnlisted} onChange={(e) => setShowUnlisted(e.target.checked)} />
                <span>
                  {t({ message: `Show the ${unlistedCount} roles visitors do not see (admin view)`, context: "roles page, steward switch for unlisted roles" })}
                </span>
              </label>
            )}
            {roles !== null && featured.length > 0 && groups.length === 0 && (
              <p className="mb-8 text-sm text-muted-foreground">{t({ message: "The roles open now are the founding roles above.", context: "roles page, empty directory" })}</p>
            )}
            {/* Same always-present polite region as Circles.tsx: the node is
                in the DOM from first paint, so the change from the loading
                line to the failure line is the thing announced. */}
            <div role="status">
              {roles === null && !failed && (
                <div className="text-center text-muted-foreground py-16">{t({ message: `Loading roles…`, context: "roles page" })}</div>
              )}
              {failed && (
                <div className="text-center text-muted-foreground py-16">
                  {t`The roles list is catching its breath. Please refresh in a moment.`}
                </div>
              )}
              {linkMissed && (
                <p className="text-center text-sm text-muted-foreground mb-8">
                  {t`That role is not on this page anymore.`}
                </p>
              )}
            </div>

            {groups.map(({ title, subtitle, circleId, roles: groupRoles }) => (
              <div className="mb-14" key={title}>
                <div className="mb-6">
                  <h2 className={`${H2} mb-1`}>{circleId ? <CircleName name={title} anchor={circleId === anchorId} /> : title}</h2>
                  {subtitle && (
                    <p className="text-muted-foreground text-sm">{subtitle}</p>
                  )}
                  {/* The circle's own card: its words, its roles and who agreed to them. */}
                  {circleId ? (
                    <Link
                      href={`/circles/${encodeURIComponent(circleId)}`}
                      className={`inline-flex min-h-11 items-center text-sm ${LINK}`}
                    >
                      {t`Open this circle's card`}
                    </Link>
                  ) : null}
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

              </div>
            )}

            {/* When a tension is between people: the village's own restorative
                steps, the same ones /governance prints. This block used to be
                a compiled process every fork published as its own, sending
                tensions up to a "Leadership Circle" no fork is given and
                promising a trial period and an evaluation that nothing in the
                platform schedules. The reasoning is in VillageConflictSteps. */}
            <m.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className={`mt-4 ${CARD}`}
            >
              <h2 className={`${H2} mb-4`}>
                {t({ message: "How we evolve through conflict", context: "roles page, conflict steps heading" })}
              </h2>
              <VillageConflictSteps />
            </m.div>
          </div>

          <m.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mt-12 text-center"
          >
            <Link href="/circles" className={BTN_SECONDARY}>
              {t({ message: `Explore Our Circles`, context: "roles page" })}
              <ArrowRight className="w-4 h-4" />
            </Link>
          </m.div>
        </div>
      </section>
    </Layout>
  );
}
