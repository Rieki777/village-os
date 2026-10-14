/**
 * WHO MAY SWITCH A MODULE, AND WHAT TURNING ONE ON TAKES WITH IT.
 *
 * Rye, 2026-10-09, binding:
 *
 *   - The public Module Library and the admin Module Library are ONE page. A
 *     signed-in founder or admin explores it and turns modules on directly
 *     before the village launches.
 *   - "Launch" is the launch ballot carrying, which is the moment
 *     `founderPowerStands()` (server/lib/gameStart.ts) goes false.
 *   - After launch, turning a module ON follows who holds the power. A live
 *     holder of `module.switch` turns it on directly. With no holder, anyone
 *     signed in may propose it, and the proposal is a binding village vote
 *     (a `module_lifecycle` change set, applied by server/lib/changeset.ts).
 *   - After launch an admin may still PAUSE or turn OFF directly, as a safety
 *     valve. It is logged on the module's history and announced. Turning ON
 *     never goes around the holder-or-vote rule.
 *
 * Everything here is pure and holds no registry values, so the client can
 * import it without pulling `shared/modules.ts` (and every module's readiness
 * reader) into the bundle. The server asks the same functions, so the button a
 * person sees and the answer the route gives are one decision.
 */
import type { ModuleLifecycle } from "./modules";

/** The four rungs, widest last. A local copy so the client never loads the registry. */
export const SWITCH_RANK: Record<ModuleLifecycle, number> = { off: 0, preview: 1, members: 2, public: 3 };

export const LIFECYCLE_ORDER: readonly ModuleLifecycle[] = ["off", "preview", "members", "public"];

export function isLifecycle(v: unknown): v is ModuleLifecycle {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(SWITCH_RANK, v);
}

/** True when `to` lets more people in than `from`. Off to preview counts: it is turning something on. */
export function widens(from: ModuleLifecycle, to: ModuleLifecycle): boolean {
  return SWITCH_RANK[to] > SWITCH_RANK[from];
}

/**
 * Modules whose lifecycle a change set may never move, whatever the vote said.
 * One entry, and it is the module the vote itself runs on: a set that turned
 * governance off would strand every open ballot and the vote to switch it back
 * could not be held. Lives here so the validator in server/lib/mechanics.ts and
 * the executor in server/lib/changeset.ts read the same set.
 */
export const NEVER_BY_CHANGESET: ReadonlySet<string> = new Set(["governance"]);

/** The capability key a village gives to whoever switches modules on after launch. */
export const MODULE_SWITCH_KEY = "module.switch" as const;

// ── How the page sees its reader ────────────────────────────────────────────

export type ViewerMode = "visitor" | "member" | "steward";

/** Decided by the server and sent on the catalog. The client never reads `user.role` for this. */
export interface LibraryViewer {
  mode: ViewerMode;
  /** The launch ballot has carried. */
  launched: boolean;
  /** May turn a module ON with one press, right now. */
  canSwitch: boolean;
  /** May pause or turn a module off with one press, right now. */
  canPause: boolean;
}

export function libraryViewer(input: {
  signedIn: boolean;
  /** An admin or founder account. */
  admin: boolean;
  /** A live holder of `module.switch`, counted without the admin short-circuit. */
  holder: boolean;
  launched: boolean;
}): LibraryViewer {
  const { signedIn, admin, holder, launched } = input;
  const mode: ViewerMode = admin ? "steward" : signedIn ? "member" : "visitor";
  return {
    mode,
    launched,
    canSwitch: launched ? holder : admin,
    canPause: admin || (launched && holder),
  };
}

// ── The switch itself ───────────────────────────────────────────────────────

export type SwitchVerdict =
  | { ok: true; announce: boolean }
  | { ok: false; status: 401 | 403; error: string; proposeInstead?: true };

/** Said to an admin who is not the holder, after launch, when they press Turn on. */
export const AFTER_LAUNCH_ON =
  "Since the launch, turning a module on is the village's call. Propose it and the village decides, or ask whoever looks after modules here.";

/**
 * May this actor move this module from `from` to `to`?
 *
 * Before launch: admins and founders, as it has always been.
 * After launch: the holder may do anything; an admin who is not the holder may
 * only narrow, and that narrowing is announced; nobody else may switch at all.
 * `announce` is only ever true after launch, because before it nothing is
 * public yet and a preview must stay quiet.
 */
export function switchVerdict(input: {
  launched: boolean;
  admin: boolean;
  holder: boolean;
  from: ModuleLifecycle;
  to: ModuleLifecycle;
}): SwitchVerdict {
  const { launched, admin, holder, from, to } = input;
  if (!launched) {
    return admin ? { ok: true, announce: false } : { ok: false, status: 401, error: "auth_required" };
  }
  const visible = (lc: ModuleLifecycle) => SWITCH_RANK[lc] >= SWITCH_RANK.members;
  const announce = visible(from) || visible(to);
  if (holder) return { ok: true, announce };
  if (!admin) return { ok: false, status: 401, error: "auth_required" };
  if (widens(from, to)) return { ok: false, status: 403, error: AFTER_LAUNCH_ON, proposeInstead: true };
  return { ok: true, announce };
}

// ── What turning one on takes with it ───────────────────────────────────────

/** The slice of a module a plan reads. Catalog rows and admin rows both fit. */
export interface PlanModule {
  id: string;
  name: string;
  core: boolean;
  requires: string[];
  /** What it is being served as now. Absent reads as off. */
  lifecycle?: string | null;
  withdrawn?: { since: string } | null;
  legalReview?: boolean;
}

const servedAs = (m: PlanModule | undefined): ModuleLifecycle =>
  !m ? "off" : m.core ? "public" : isLifecycle(m.lifecycle) ? m.lifecycle : "off";

/**
 * Every module that has to move so `ids` can stand at `to`, dependencies first.
 *
 * A module stays out of the plan when it already stands at `to` or wider, and
 * a core module never enters it. The order is the one the server accepts: a
 * module may not stand wider than what it depends on, so each dependency is
 * switched before the module that needs it. A dependency cycle cannot happen
 * in the registry, and the `visiting` set means a hand-made one still ends.
 */
export function turnOnPlan(ids: readonly string[], to: ModuleLifecycle, all: readonly PlanModule[]): PlanModule[] {
  const byId = new Map(all.map((m) => [m.id, m]));
  const out: PlanModule[] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (placed.has(id) || visiting.has(id)) return;
    const m = byId.get(id);
    if (!m || m.core) return;
    visiting.add(id);
    for (const dep of m.requires) visit(dep);
    visiting.delete(id);
    if (SWITCH_RANK[servedAs(m)] >= SWITCH_RANK[to]) return;
    placed.add(id);
    out.push(m);
  };
  for (const id of ids) visit(id);
  return out;
}

/** The plain sentence that names what a module needs: "Stays also needs Commerce". */
export function alsoNeedsLine(target: PlanModule, plan: readonly PlanModule[]): string | null {
  const others = plan.filter((m) => m.id !== target.id).map((m) => m.name);
  if (others.length === 0) return null;
  return `${target.name} also needs ${joinNames(others)}`;
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The change set a proposal carries, in the order the plan put it. */
export function turnOnChangeSet(plan: readonly PlanModule[], to: ModuleLifecycle) {
  return plan.map((m) => ({ kind: "module_lifecycle" as const, moduleId: m.id, to }));
}

/** The title a turn-on proposal carries. Platform-written, so two asks for one module read alike. */
export function turnOnTitle(names: readonly string[]): string {
  return `Turn on ${joinNames(names)}`.slice(0, 200);
}

/** Lifecycle words a member reads, on a proposal and on the history strip. */
export const LIFECYCLE_WORDS: Record<ModuleLifecycle, string> = {
  off: "Off",
  preview: "Preview",
  members: "On for members",
  public: "On for everyone",
};

export function lifecycleWords(v: string | null | undefined): string {
  return isLifecycle(v) ? LIFECYCLE_WORDS[v] : String(v ?? "");
}
