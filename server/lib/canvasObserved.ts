/**
 * THE SEE FRAME: what the live system already shows about a canvas block, as
 * plain facts (plan 2.3, "Five frames"; Wave 3a, 2026-09-28).
 *
 * Every frame of a block opens on "what we see today". This file reads it,
 * block by block, from the readers the platform already has, and says each
 * thing in one sentence with a link to the control that changes it.
 *
 * ── NEVER A SCORE ──────────────────────────────────────────────────────────
 *
 * A fact is a sentence and a link. Nothing here counts facts, grades them,
 * marks one good and another bad, or puts two numbers over each other: no
 * "N of M", no percent, no average. R55 governs this frame (the 1 to 5 radar
 * is the canvas baseline's one exception and it is not here). Where a setting
 * says one thing and the village's words another, the page shows both and the
 * reader draws the line.
 *
 * ── EVERY READ IS ONE THE PLATFORM ALREADY MAKES ───────────────────────────
 *
 *   roles                   READERS `roles.all` (villageReaders.ts)
 *   empty seats             READERS `seats.vacant`'s gate, then `loadRoles` and
 *                           `roleHolders` handed in, counted with the gate's own
 *                           lapse rule (`holdingHasLapsed`). The reader's SQL
 *                           counts every role_holders row, and a seat whose term
 *                           ran out stays in that table and grants nothing, so
 *                           the reader would call a lapsed seat held
 *   the week's gatherings   READERS `events.week`
 *   decisions on record     READERS `record.decisions`
 *   how many accounts       READERS `members.summary` (admins only, by its own audience)
 *   seat terms              `roleHolders` handed in, the rows the intake reads
 *   the season              `seasonNow` handed in, the season state every page reads
 *   dials                   `numberVar`, `stringVar`, `boolVar` (server/lib/variables.ts)
 *   module state            `effectiveLifecycle` (server/lib/modules.ts)
 *   the powers              `villageHandoverState` (server/lib/capabilityHolding.ts)
 *   the Birthing            `readGameStart` (server/lib/gameStart.ts)
 *   the purpose statement   `governingPurpose` (server/lib/governingPurpose.ts)
 *   exit and care           `readExitPolicy` handed in, `platformDefaultTermKeys`,
 *                           `intakeRoleForReaders`, `replyHoursOf`, `outsideContactNamed`
 *   the issuance cap        `issuanceCapDecisionFor` (server/lib/launch.ts)
 *   peers                   `peerSharedItems` (server/lib/network.ts)
 *   health                  `snapshotSeries` (server/lib/health.ts)
 *   tools, Work With Us,    handed in from the collections server/index.ts holds,
 *   the legal entity        so this file opens no second cache over those tables
 *
 * A reader is asked through its own gate, `readerRefusal`, which checks the
 * viewer's audience, the module switch and the capability exactly as it does
 * for the guide, so a fact a viewer may not read is simply absent. The answer
 * is then read WHOLE, never through `callReader`: that door caps every answer
 * to the guide's prompt budget (`capTokens`), and past the budget an array
 * comes back as `{ items, truncated }`, which a count here would read as
 * nothing at all. Ten described roles or eight gatherings in a week were
 * enough to tell a busy village it had none. No SQL is written here: the
 * raw-SQL register is at its ceiling, and every read above already exists.
 *
 * ── A READ THAT FAILS SAYS SO ──────────────────────────────────────────────
 *
 * Each fact is read on its own. One that throws becomes the sentence "This
 * could not be read just now", with the same link, so a broken read is never
 * mistaken for a quiet village and never takes the other facts down with it.
 */
import type { Pool } from "mysql2/promise";
import { capabilityLabel, type Capability } from "../../shared/capabilities";
import { hasGoverningPurpose } from "../../shared/governingPurpose";
import { VARIABLES_BY_KEY } from "../../shared/gameVariables";
import type { CanvasBlockId } from "../../shared/governanceCanvas";
import { LIFECYCLE_RANK } from "../../shared/modules";
import { villageHandoverState } from "./capabilityHolding";
import { outsideContactNamed, platformDefaultTermKeys, replyHoursOf } from "./exitPolicy";
import { readGameStart } from "./gameStart";
import { governingPurpose } from "./governingPurpose";
import { snapshotSeries } from "./health";
import { issuanceCapDecisionFor } from "./launch";
import { effectiveLifecycle } from "./modules";
import { peerSharedItems } from "./network";
import { intakeRoleForReaders, type IntakeHolding } from "./restorativeIntake";
import { holdingHasLapsed } from "./stewardship";
import { boolVar, numberVar, stringVar } from "./variables";
import { READERS, readerRefusal, type ReaderViewer, type VillageReader } from "./villageReaders";

/** One thing the live system shows, in a sentence, with where to change it. */
export interface ObservedFact {
  /** Stable within a block, so a page can key on it. */
  id: string;
  text: string;
  href: string;
  /** The link's words. */
  label: string;
}

export interface ObservedDeps {
  pool: Pool;
  viewer: ReaderViewer;
  readExitPolicy(): any;
  loadRoles(): ReadonlyArray<{ id: string; name?: string | null; isExample?: unknown }>;
  roleHolders(): ReadonlyArray<IntakeHolding>;
  /** The tools the Tools Hub lists, as its collection holds them. */
  tools(): ReadonlyArray<{ enabled?: unknown; isExample?: unknown }>;
  /** Every inbox row, to count the Work With Us enquiries. */
  submissions(): ReadonlyArray<{ type?: unknown }>;
  /** The legal entity a member joins, as the Love Letter prints it, or "". */
  legalEntityLabel(): string;
  /** The season running now, or null when there is none. */
  seasonNow(): { name: string; endsOn: string | null } | null;
  /** Testable clock. */
  now?: Date;
}

const UNREADABLE = "This could not be read just now.";

/** A date as a person reads it, from an ISO instant or a YYYY-MM-DD. */
function day(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

type FactReader = { id: string; href: string; label: string; read: () => Promise<string | null> };

/** Read every fact on its own; a throw becomes the unreadable sentence, a null is left out. */
async function readAll(readers: readonly FactReader[]): Promise<ObservedFact[]> {
  const out: ObservedFact[] = [];
  for (const r of readers) {
    let text: string | null;
    try {
      text = await r.read();
    } catch (e) {
      console.error(`[canvas-observed] ${r.id} could not be read`, e);
      text = UNREADABLE;
    }
    if (text) out.push({ id: r.id, text, href: r.href, label: r.label });
  }
  return out;
}

/**
 * The reader by its key. A key no reader carries any more throws, so the fact
 * says it could not be read instead of quietly leaving the frame.
 */
function readerNamed(key: string): VillageReader {
  const r = READERS.find((x) => x.key === key);
  if (!r) throw new Error(`no reader named ${key}`);
  return r;
}

/** Whether this viewer may call the reader (module on, audience, capability). */
function mayRead(deps: ObservedDeps, key: string): boolean {
  return readerRefusal(readerNamed(key), deps.viewer) === null;
}

/**
 * A reader's WHOLE answer, or null when this viewer may not call it. Read past
 * the reader's gate and never through `callReader`, whose prompt cap turns a
 * long list into `{ items, truncated }` (see the header).
 */
async function reader<T>(deps: ObservedDeps, key: string): Promise<T | null> {
  if (!mayRead(deps, key)) return null;
  return (await readerNamed(key).read({ pool: deps.pool, viewer: deps.viewer })) as T;
}

function exitFacts(deps: ObservedDeps, which: "terms" | "restorative"): FactReader[] {
  const policy = () => deps.readExitPolicy() ?? {};
  if (which === "terms") {
    return [
      {
        id: "exit-terms",
        href: "/exit-policy",
        label: "The exit policy",
        read: async () => {
          const p = policy();
          const stale = platformDefaultTermKeys(p).filter((k) => k !== "restorativeSteps");
          const steps = stale.length
            ? "Some exit terms are still in the platform's words."
            : "The exit terms are written in the village's own words.";
          return p.placeholder ? `${steps} The policy is still marked as a draft.` : steps;
        },
      },
    ];
  }
  return [
    {
      id: "restorative-steps",
      href: "/exit-policy",
      label: "The restorative steps",
      read: async () =>
        platformDefaultTermKeys(policy()).includes("restorativeSteps")
          ? "The restorative steps are still in the platform's words."
          : "The restorative steps are written in the village's own words.",
    },
    {
      id: "care-role",
      href: "/exit-policy",
      label: "Who receives a request for care",
      read: async () => {
        const role = intakeRoleForReaders(policy().restorative?.intakeContactRole, deps.loadRoles(), deps.roleHolders(), deps.now);
        if (!role) return "No role is named to receive a request for care.";
        return role.heldToday
          ? `${role.name} receives a request for care, and somebody holds that role today.`
          : `${role.name} receives a request for care, and nobody holds that role today.`;
      },
    },
    {
      id: "cover-role",
      href: "/exit-policy",
      label: "The cover role",
      read: async () => {
        const id = String(policy().restorative?.coverRole ?? "").trim();
        if (!id) return "No cover role is named for when the care role cannot answer.";
        const role = deps.loadRoles().find((r) => r.id === id);
        return `${role?.name || id} covers when the care role cannot answer.`;
      },
    },
    {
      id: "reply-time",
      href: "/exit-policy",
      label: "The promised reply time",
      read: async () => {
        const hours = replyHoursOf(policy().restorative?.replyHours);
        return hours === null ? "No reply time is promised to somebody who asks for care." : `A reply is promised within ${plural(hours, "hour", "hours")}.`;
      },
    },
    {
      id: "outside-contact",
      href: "/exit-policy",
      label: "The outside contact",
      // Named or not, and never the name: plan 4.6 keeps a person's name off
      // every surface a visitor could reach, and this frame is one step away.
      read: async () =>
        outsideContactNamed(policy().restorative?.outsideContact)
          ? "Somebody outside the village is named to bring a conflict to."
          : "Nobody outside the village is named to bring a conflict to.",
    },
  ];
}

function facts(block: CanvasBlockId, deps: ObservedDeps): FactReader[] {
  const now = deps.now ?? new Date();
  switch (block) {
    case "purpose":
      return [
        {
          id: "purpose-statement",
          href: "/admin?tab=setup",
          label: "The governing purpose statement",
          read: async () => {
            const doc = await governingPurpose(deps.pool);
            return hasGoverningPurpose(doc)
              ? `The governing purpose statement was written on ${day(doc.writtenAt)}.`
              : "No governing purpose statement is written yet.";
          },
        },
      ];
    case "team":
      return [
        {
          id: "vouches",
          href: "/game-mechanics",
          label: "How members are admitted",
          read: async () => {
            const n = numberVar("membership.vouches_required");
            return n > 0
              ? `A newcomer becomes a member after ${plural(n, "vouch", "vouches")}.`
              : "Vouching is off, so a steward's super vouch is how somebody is admitted.";
          },
        },
        {
          id: "invite-only",
          href: "/game-mechanics",
          label: "Who can ask to join",
          read: async () =>
            boolVar("membership.invite_only")
              ? "Joining is by invitation only."
              : "Anybody can make an account and ask to join.",
        },
        {
          id: "accounts",
          href: "/admin?tab=players",
          label: "The people here",
          read: async () => {
            const s = await reader<{ members: number }>(deps, "members.summary");
            return s ? `The village has ${plural(s.members, "account", "accounts")}.` : null;
          },
        },
        ...exitFacts(deps, "terms"),
      ];
    case "roles":
      return [
        {
          id: "roles-written",
          href: "/roles",
          label: "The roles",
          read: async () => {
            const roles = await reader<unknown[]>(deps, "roles.all");
            if (!roles) return null;
            return roles.length ? `${plural(roles.length, "role is", "roles are")} written down.` : "No role is written down yet.";
          },
        },
        {
          id: "roles-empty",
          href: "/roles",
          label: "Who holds what",
          read: async () => {
            // The seats reader's gate, and a count held today: a seat whose
            // term ran out is empty, the same answer the gate and the care
            // role's fact give (see the header).
            if (!mayRead(deps, "seats.vacant")) return null;
            const roles = deps.loadRoles().filter((r) => !r.isExample);
            if (!roles.length) return null;
            const holders = deps.roleHolders();
            const empty = roles
              .filter((r) => !holders.some((h) => h.roleId === r.id && !holdingHasLapsed(h, now)))
              .map((r) => String(r.name || r.id));
            return empty.length ? `Nobody holds ${listed(empty)} today.` : "Every role has somebody in it today.";
          },
        },
        {
          id: "seat-terms",
          href: "/roles",
          label: "Seat terms",
          read: async () => {
            const soon = now.getTime() + 30 * 24 * 60 * 60 * 1000;
            const ending = deps.roleHolders().filter((h) => {
              if (!h.termEndsAt) return false;
              const t = new Date(h.termEndsAt).getTime();
              return Number.isFinite(t) && t >= now.getTime() && t <= soon;
            });
            return ending.length
              ? `${plural(ending.length, "seat ends", "seats end")} in the next thirty days.`
              : "No seat ends in the next thirty days.";
          },
        },
      ];
    case "meetings":
      return [
        {
          id: "gatherings",
          href: "/events",
          label: "The calendar",
          read: async () => {
            const week = await reader<unknown[]>(deps, "events.week");
            if (!week) return "The calendar is switched off.";
            return week.length
              ? `${plural(week.length, "gathering is", "gatherings are")} on the calendar in the next seven days.`
              : "Nothing is on the calendar for the next seven days.";
          },
        },
        {
          id: "season",
          href: "/admin?tab=season",
          label: "The season",
          read: async () => {
            const s = deps.seasonNow();
            if (!s) return "No season is running.";
            return s.endsOn ? `The season now is ${s.name}, and it ends on ${day(s.endsOn)}.` : `The season now is ${s.name}.`;
          },
        },
      ];
    case "stakeholders":
      return [
        {
          id: "work-with-us",
          href: "/work-with-us",
          label: "Work With Us",
          read: async () => {
            const n = deps.submissions().filter((s) => s.type === "work-with-us").length;
            return n ? `${plural(n, "enquiry has", "enquiries have")} come in through Work With Us.` : "No enquiry has come in through Work With Us yet.";
          },
        },
        {
          id: "peers",
          href: "/network",
          label: "The network",
          read: async () => {
            const peers = (await peerSharedItems(deps.pool)).filter((p) => !p.isExample).map((p) => String(p.village));
            return peers.length ? `This village is linked with ${listed(peers)}.` : "This village is not linked with any other village yet.";
          },
        },
      ];
    case "coordination":
      return [
        {
          id: "tools",
          href: "/tools",
          label: "The Tools Hub",
          read: async () => {
            if (LIFECYCLE_RANK[effectiveLifecycle("tools")] < LIFECYCLE_RANK.members) return "The Tools Hub is switched off.";
            const n = deps.tools().filter((t) => !!t.enabled && !t.isExample).length;
            return n ? `${plural(n, "tool is", "tools are")} listed in the Tools Hub.` : "The Tools Hub lists no tools yet.";
          },
        },
      ];
    case "power":
      return [
        {
          id: "default-method",
          href: "/game-mechanics",
          label: "How ballots decide",
          read: async () => {
            const raw = stringVar("governance.default_method");
            const choice = VARIABLES_BY_KEY["governance.default_method"]?.choices?.find((c) => c.value === raw);
            return `Village-wide ballots decide by: ${choice?.label ?? raw}.`;
          },
        },
        {
          id: "governance-on",
          href: "/admin?tab=modules&module=governance",
          label: "Governance for members",
          read: async () =>
            LIFECYCLE_RANK[effectiveLifecycle("governance")] >= LIFECYCLE_RANK.members
              ? "Governance is on for members, so the village can vote here."
              : "Governance is off for members, so the village cannot vote here yet.",
        },
        {
          id: "powers-held",
          href: "/powers",
          label: "The village's powers",
          read: async () => {
            const h = await villageHandoverState(deps.pool);
            if (!h.held.length) return "The village holds none of its transferable powers yet. The administrators carry them.";
            return `The village holds these powers: ${listed(h.held.map((c) => capabilityLabel(c as Capability)))}.`;
          },
        },
        {
          id: "birthing",
          href: "/journey-to-launch",
          label: "The Birthing",
          read: async () => {
            const g = await readGameStart(deps.pool);
            return g.started ? `The Game started on ${day(g.startedAt)}.` : "The Game has not started yet.";
          },
        },
      ];
    case "conflict":
      return exitFacts(deps, "restorative");
    case "learning":
      return [
        {
          id: "decisions-recorded",
          href: "/governance",
          label: "The village record",
          read: async () => {
            const rows = await reader<Array<{ decidedOn: string | null }>>(deps, "record.decisions");
            if (!rows) return null;
            if (!rows.length) return "No decision is on the village record yet.";
            const newest = rows.find((r) => r.decidedOn)?.decidedOn ?? null;
            return newest ? `Decisions are on the village record, the newest from ${day(newest)}.` : "Decisions are on the village record.";
          },
        },
      ];
    case "resourcing":
      return [
        {
          id: "issuance-cap",
          href: "/game-mechanics",
          label: "The issuance cap",
          read: async () => {
            const d = await issuanceCapDecisionFor(deps.pool);
            const cap = `${d.capTokens} tokens per lunar cycle`;
            if (d.answer === "set") return `The village set its own issuance cap: ${cap}.`;
            // A decline stays on record after a number is set, and then the
            // number is the village's own (shared/issuanceCap.ts, `overridden`).
            if (d.answer === "declined" && d.overridden) {
              return `Asked at launch, the founders named no issuance cap of their own. The village has set one since: ${cap}.`;
            }
            if (d.answer === "declined") return `The founders chose to keep the platform's issuance cap: ${cap}.`;
            return `Nobody has decided the issuance cap yet, so the platform's ${cap} binds.`;
          },
        },
        {
          id: "pool-token",
          href: "/admin?tab=tokens",
          label: "The pool token",
          read: async () => {
            const token = stringVar("gratitude.pool_token").trim();
            return token ? `The cycle pool pays in ${token}.` : "No pool token is named.";
          },
        },
      ];
    case "legal":
      return [
        {
          id: "legal-entity",
          href: "/love-letter",
          label: "The Love Letter",
          read: async () => {
            const label = deps.legalEntityLabel().trim();
            return label
              ? `The Love Letter names the legal entity a member joins: ${label}.`
              : "No legal entity is published, so the Love Letter says a member joins the community.";
          },
        },
      ];
    case "impact":
      return [
        {
          id: "health",
          href: "/village-health",
          label: "Village health",
          read: async () => {
            if (LIFECYCLE_RANK[effectiveLifecycle("health")] < LIFECYCLE_RANK.members) {
              return "The health module is off, so members see no health readings here.";
            }
            const s = await snapshotSeries(deps.pool);
            return s.lunationsCollected
              ? `Health readings cover ${plural(s.lunationsCollected, "lunar cycle", "lunar cycles")}.`
              : "The health module is on, and no reading has been taken yet.";
          },
        },
      ];
  }
}

/** What the live system shows about one block. */
export async function observedFacts(block: CanvasBlockId, deps: ObservedDeps): Promise<ObservedFact[]> {
  return readAll(facts(block, deps));
}

