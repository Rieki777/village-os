/**
 * THE CASH BUDGET OVER HTTP (budgets spec v0.2, PR 1a: the server, which works
 * without the knowledge library).
 *
 *   GET   /api/budgets?moon=                       every member reads the moon's lines and figure (R23)
 *   POST  /api/admin/budgets/import                an upload: preview, then confirm the preview (R14)
 *   POST  /api/admin/budgets/lines                 one line added by hand
 *   PATCH /api/admin/budgets/lines/:id             one line edited by hand
 *   POST  /api/admin/budgets/lines/:id/withdraw    withdrawn, never deleted (R3)
 *   POST  /api/admin/budgets/lines/:id/restore     and back
 *   POST  /api/admin/budgets/lines/:id/lock-rate   a person locks a rate on a line in another currency (spec 5a)
 *   POST  /api/admin/budgets/lock-rates            the same for many lines: preview, then confirm the preview
 *   GET   /api/budgets/ahead?from=&count=          every member reads 1 to 12 moons ahead (R30)
 *   PUT   /api/admin/budgets/notes/:period         a note on how to read a period, through the same door (R32)
 *   POST  /api/admin/budgets/sources/:source       turn a source on, off, or between auto and review (R18)
 *   POST  /api/admin/budgets/sync/:source          Sync budget: read a source now (R19, PR 2, server/routes/budgetSync.ts)
 *   GET   /api/budgets/circles?moon=               every circle on the chart with its plan and envelope (R31)
 *   PUT   /api/admin/budgets/envelopes/:circleId/:periodKey   a circle's envelope, through the same door (R35)
 *
 * CIRCLE IS THE KEY (v0.5, R34). A line for the whole village sits on the
 * village's own circle (the `budgets.village_circle_id` game variable, or the
 * chart's link, lead or single root circle). An envelope is what a circle may
 * plan for a period: its lines are measured against it and a pass warns,
 * never blocks, and the moon's figure still counts lines.
 *
 * A SOURCE'S STANDING SWITCH (v0.4, R18; Rye, 9 Nov). Turning a source on is
 * an act of the same door, previewed with the share before and after, bound
 * by revision and logged; every member reads who turned it on, by role. In
 * `auto` mode what the source sends counts at once, as the holder's standing
 * act; in `review` it waits for a person. `recheckSource` (server/lib/budgets.ts)
 * turns the switch off when its setter no longer holds `role.pay`, and this
 * module wires it to the live holders at boot.
 *
 * PROVENANCE (R29). An upload may name itself ("November budget sheet") and
 * link its sheet over https. The read names the newest import per source and
 * dates each header figure by the newest change that fed it; the link goes
 * only to the door and to `cash.pay` holders, because a private sheet's
 * address is not every member's to open.
 *
 * A LOCKED RATE (spec 5a, option b; Rye, 9 Nov). `{ use: "provider" }` locks
 * the newest stored daily rate, read here on the server through
 * `latestRates`; `{ rate, sourceNote }` locks a rate a person typed. Refused
 * with no stored rate, or one older than 14 days. Rates are never read by the
 * client, and `fx_rates` stays display-only: a lock is a person's act, the
 * same door as every other budget write, and the line counts at the locked
 * rate until a person locks again. Drift is shown, never applied.
 *
 * Every write goes through `importBudgetLines` (server/lib/budgets.ts), the
 * one write path, and through ONE door (R21), `budgetDoorOf` below:
 *
 *   holder     a live holder of `role.pay`, asked the deny-aware way
 *              (`holderOnlyDecision`, the gate with the admin short-circuit
 *              taken out), writes, recorded as the role they hold it through;
 *   admin      before the launch vote carries (`launchedByVote`), with nobody
 *              holding the power and the village not holding it, an admin
 *              writes, recorded as "admin, before launch";
 *   refused    anything else, with the suggestion path named: after launch
 *              with nobody holding it, or with the village holding it, the
 *              change is a suggestion (R22), which goes to a vote. A refusal
 *              names roles, never an account.
 *
 * And the payee conflict: a write that touches a line naming a role the
 * writer is seated in is refused, with the suggestion path named. A suggestion
 * goes to the live holders who hold no role it pays, and to a vote when every
 * holder holds one or nobody holds the power (V10).
 *
 * Every write has a vote path (B3): the cash budget's lines, a circle's
 * envelope, a period's note and a source's switch each have a suggestion
 * control whose Accept and ballot closer call the same function the direct
 * route calls.
 *
 * A preview needs only the member rung, because every member reads the budget
 * and may suggest an upload "with the same preview" (R22). It answers what the
 * door would say, so the page shows the right banner before anybody confirms,
 * and it shows spent only to `cash.pay` holders, like every other read (B2).
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { markAdminGate } from "../lib/adminGate";
import { registerAdminEditControl, type Refusal } from "../lib/adminSuggestions";
import {
  BUDGET_KEEPER,
  BY_VILLAGE_VOTE,
  budgetAhead,
  budgetCircleNames,
  budgetCircles,
  budgetLines,
  budgetRoleNames,
  budgetRateDrift,
  budgetShareHistory,
  budgetSourceStates,
  budgetVillageCircle,
  cashBudgetLeft,
  configureBudgets,
  displayLabel,
  displaySourceLabel,
  envelopeVersion,
  importBudgetLines,
  latestSyncs,
  periodNote,
  periodNoteVersion,
  setEnvelope,
  setPeriodNote,
  sourceVersion,
  stateRevision,
  stillHeld,
  switchBudgetSource,
  type ImportInput,
  type ImportResult,
  type ImportRow,
  type ImportScope,
  type PreviewLine,
  type StoredLine,
} from "../lib/budgets";
import { leftTheVillage } from "../lib/formerMember";
import { holderOnlyDecision } from "../lib/holderOnly";
import { register as registerBudgetSync } from "./budgetSync";
import { listOrgAssignments } from "../lib/orgChart";
import { launchedByVote } from "../lib/orgDraftDecide";
import { ADMIN_BEFORE_LAUNCH, CASH_CATEGORIES, IMPORT_ROWS_MAX, VILLAGE_WIDE, inVillageCurrency, lineShareOfMoon, moonPeriod, moonPlan, sharedDays, type NumberFormatChoice } from "../../shared/budgets";
import { hasCapability, type CapabilityCtx } from "../../shared/capabilities";
import { formatMoney } from "../../shared/money";
import { currentCycle } from "../lib/gratitude-cycles";
import { villageTimezone } from "../lib/villageReaders";

type Deps = Pick<AppDeps, "authedUser" | "capabilityCtx" | "getPool" | "overLimit" | "seasonState"> & {
  /** Who holds a power live, the admin short-circuit excluded (`liveHoldersOf`, server/index.ts). */
  liveHoldersOf(capability: string): Promise<string[]>;
  /** The village's currency as configured, "" when it is not set (R8). */
  projectCurrency(): string;
  /** The roles whose definition carries a power (`rolesCarrying`, server/index.ts). */
  rolesCarrying(capability: string): Array<{ id: string; name: string }>;
  /** Every role holding (`loadRoleHolders`, server/index.ts), for the role a writer acts through. */
  roleHolders(): Array<{ roleId: string; userId: string }>;
  /** Has the launch vote carried. Defaults to `launchedByVote`. */
  launched?(): Promise<boolean>;
  /** Has this account left the village. Defaults to `leftTheVillage`. */
  isFormerMember?(user: any): Promise<boolean>;
  /** The org roles this person is seated in, for the payee conflict. Defaults to their live seatings. */
  seatedRoleIds?(userId: string): Promise<string[]>;
  /** The server's secret every budget revision is keyed under (V7); a per-boot key without it. */
  revisionSecret?: string;
};

/** Where a refused write is sent instead (R21, R22). */
export const BUDGET_SUGGESTION_PATH = "/api/admin/suggestions";
export const BUDGET_CONTROL = "budget_lines";
type Suggest = { path: string; control: string };
const suggestOn = (control: string): Suggest => ({ path: BUDGET_SUGGESTION_PATH, control });
const SUGGEST = suggestOn(BUDGET_CONTROL);
const MEMBER_RUNG = "member";
const WRITES_PER_WINDOW = 60;
const PREVIEWS_PER_WINDOW = 240;
const READS_PER_WINDOW = 600;
const WINDOW_MS = 10 * 60 * 1000;

/** The door's answer for one person (R21). A refusal names roles, never an account. */
type BudgetDoor =
  | { ok: true; via: "holder" | "admin_before_launch"; byAs: string }
  | { ok: false; status: 401 | 403 | 409; body: { error: string; code: string; suggest?: Suggest; holdersAs?: string[] } };

interface BudgetDoorDeps {
  liveHoldersOf(capability: string): Promise<string[]>;
  rolesCarrying(capability: string): Array<{ id: string; name: string }>;
  roleHolders(): Array<{ roleId: string; userId: string }>;
  launched(): Promise<boolean>;
}

/**
 * THE BUDGET'S DOOR FOR `role.pay` (R21). `actingAs` names
 * the role a holder acts through, for `changed_as`: a role's label, never a
 * person and never the machine key. `door(user, ctx)` answers one person:
 * deny-aware first, then a live holder, then the admin's fallback until the
 * launch vote (and only while nobody holds the power and the village does not),
 * otherwise a refusal naming the suggestion path. The village's one shared
 * check for `role.pay` is the valuation lane's (`holderDoor`, PR #1027); this
 * door's holder and admin part moves onto it once that lands on main, and the
 * budget's own checks (the payee conflict, ended moons, the suggestion path)
 * stay on top of it.
 */
function budgetDoorOf(deps: BudgetDoorDeps): { door(user: any, ctx: CapabilityCtx | null, control?: string): Promise<BudgetDoor>; actingAs(userId: string): string } {
  const actingAs = (userId: string): string => {
    const held = new Set(deps.roleHolders().filter((h) => String(h.userId) === userId).map((h) => String(h.roleId)));
    const names = deps.rolesCarrying("role.pay").filter((r) => held.has(String(r.id))).map((r) => r.name);
    return (names.join(", ") || BUDGET_KEEPER).slice(0, 120);
  };
  const holdersAs = (): string[] => {
    const roles = deps.rolesCarrying("role.pay").map((r) => r.name);
    return roles.length ? roles : [BUDGET_KEEPER];
  };
  async function door(user: any, ctx: CapabilityCtx | null, control = BUDGET_CONTROL): Promise<BudgetDoor> {
    const suggest = suggestOn(control);
    // Deny-aware first: a warning badge on the power refuses a holder and the admin fallback alike.
    if ((ctx?.badgeDenies ?? []).includes("role.pay")) {
      return { ok: false, status: 403, body: { error: "A warning badge takes the budget power from you, so you cannot change the budget. Suggest the change instead.", code: "denied", suggest } };
    }
    const holders = await deps.liveHoldersOf("role.pay");
    const ans = holderOnlyDecision({ capability: "role.pay", ctx, liveHolders: holders, label: "the cash budget" });
    if (ans.ok && ans.via === "holder") return { ok: true, via: "holder", byAs: actingAs(String(user.id)) };
    if (ans.ok) {
      // The operator fallback: an admin, nobody holding the power, the village not holding it.
      if (await deps.launched()) {
        return {
          ok: false,
          status: 409,
          body: { error: "Nobody holds the budget power since the launch vote, so a change to the budget goes to the village. Suggest the change, and it goes to a vote.", code: "nobody_holds_it", suggest },
        };
      }
      return { ok: true, via: "admin_before_launch", byAs: ADMIN_BEFORE_LAUNCH };
    }
    if (ans.body.code === "auth_required") return { ok: false, status: 401, body: { error: "Sign in first.", code: "auth_required" } };
    if (ans.body.code === "village_holds_it") {
      return { ok: false, status: 409, body: { error: "The village holds the budget power, so a change to the budget goes to a vote. Suggest the change.", code: "village_holds_it", suggest } };
    }
    return {
      ok: false,
      status: 403,
      body: { error: "Only the people who hold the budget power change the budget. Suggest the change, and it goes to them.", code: "holders_only", suggest, holdersAs: holdersAs() },
    };
  }
  return { door, actingAs };
}

/** Every role id a preview's writes touch, before and after, for the payee conflict. */
export function rolesTouched(p: Pick<ImportResult, "added" | "changed">): string[] {
  const ids = new Set<string>();
  for (const a of p.added) if (a.roleId) ids.add(a.roleId);
  for (const c of p.changed) {
    if (c.roleId) ids.add(c.roleId);
    if (c.before.roleId) ids.add(c.before.roleId);
  }
  return Array.from(ids);
}

/** What a member reads in place of a source's words held for naming somebody (M9). */
export const HELD_WORDS = "A line from a source, held for its words until a holder renames it";

/**
 * A preview or a write's answer as THIS reader may see it (B2): spent comes
 * from the cash the village owes, which only `cash.pay` holders read (R23), so
 * every line in an answer is shaped the way `lineView` shapes a read; and a
 * source's words held for naming somebody (`heldWords`, id to words) stay
 * with the people who keep the budget (M9).
 */
export function cashView<T extends Pick<ImportResult, "added" | "changed"> & Partial<Pick<ImportResult, "withdrawn" | "withdrawnLines" | "stillListed" | "keptWithdrawn" | "lineChanges" | "flags">>>(
  r: T,
  mayReadCash: boolean,
  heldWords?: ReadonlyMap<string, string>,
): T {
  if (mayReadCash && !heldWords?.size) return r;
  const held = (id: string | null | undefined) => !!id && !!heldWords?.has(id);
  const hide = <L extends PreviewLine>(l: L): L => ({ ...l, spentMinor: mayReadCash ? l.spentMinor : null, ...(held(l.id) && heldWords?.get(l.id!) === l.label ? { label: HELD_WORDS } : {}) });
  const named = <L extends { id: string | null; label: string }>(l: L): L => (held(l.id) ? { ...l, label: HELD_WORDS } : l);
  const out: T = { ...r, added: r.added.map(hide), changed: r.changed.map((c) => ({ ...hide(c), before: hide(c.before) })) };
  if (!heldWords?.size) return out;
  // A withdrawal, a line still listed or kept withdrawn, a line's change, an overlap: each may name a held line (V6).
  if (r.withdrawnLines) {
    const lines = r.withdrawnLines.map(named);
    Object.assign(out, { withdrawnLines: lines, withdrawn: lines.map((l) => l.label) });
  }
  if (r.stillListed) Object.assign(out, { stillListed: r.stillListed.map(named) });
  if (r.keptWithdrawn) Object.assign(out, { keptWithdrawn: r.keptWithdrawn.map(named) });
  if (r.lineChanges) Object.assign(out, { lineChanges: r.lineChanges.map(named) });
  if (r.flags) {
    Object.assign(out, {
      flags: r.flags.map((f) => ((f.ids ?? []).some(held) ? { ...f, message: "This touches a line held for its words, which the people who keep the budget rename." } : f)),
    });
  }
  return out;
}

const PAYEE_CONFLICT =
  "This changes a budget line for a role you hold, so you cannot make it yourself. Suggest it: it goes to the holders who hold no role it pays, or to a village vote when every holder holds one.";

export function register(app: Express, deps: Deps): void {
  const { authedUser, capabilityCtx, getPool, overLimit, liveHoldersOf, projectCurrency, rolesCarrying, roleHolders } = deps;
  const launched = deps.launched ?? (() => launchedByVote(getPool()));
  const isFormer = deps.isFormerMember ?? ((user: any) => leftTheVillage(getPool(), user));
  const seatedRoleIds =
    deps.seatedRoleIds ?? (async (userId: string) => (await listOrgAssignments(getPool())).filter((a) => String(a.userId ?? "") === userId).map((a) => a.orgRoleId));
  const { door: budgetDoor, actingAs } = budgetDoorOf({ liveHoldersOf, rolesCarrying, roleHolders, launched });

  configureBudgets({
    currency: () => String(projectCurrency() ?? "").trim().toUpperCase(),
    seasons: () => (deps.seasonState().seasons ?? []).map((s: any) => ({ id: String(s.id), startsOn: s.startsOn ?? null, endsOn: s.endsOn ?? null })),
    // The switch's re-check (R18, P1) asks the live, bridged count, the same one the door asks.
    rolePayHolders: () => liveHoldersOf("role.pay"),
    holdsRolePay: async (userId: string) => (await liveHoldersOf("role.pay")).includes(userId),
    seatedRoleIds,
    launched: () => launched(),
    ...(deps.revisionSecret ? { revisionSecret: () => String(deps.revisionSecret) } : {}),
  });

  /** Each holder's seated roles, for the payee conflict, read once (V10). */
  const seatsOf = async (userIds: readonly string[]): Promise<Map<string, Set<string>>> => {
    if (deps.seatedRoleIds) return new Map(await Promise.all(userIds.map(async (u) => [u, new Set(await seatedRoleIds(u))] as const)));
    const all = await listOrgAssignments(getPool());
    return new Map(userIds.map((u) => [u, new Set(all.filter((a) => String(a.userId ?? "") === u).map((a) => a.orgRoleId))]));
  };
  /** The holders who hold none of the roles a suggestion pays: the people who may decide it (V10). */
  const unconflicted = async (rolesPaid: readonly string[], holders: readonly string[]): Promise<string[]> => {
    if (!rolesPaid.length) return [...holders];
    const seats = await seatsOf(holders);
    return holders.filter((h) => !rolesPaid.some((r) => seats.get(h)?.has(r)));
  };

  /** Signed in, still in the village, at the member rung. Answers the refusal and returns null otherwise. */
  async function member(req: any, res: any): Promise<{ user: any; ctx: CapabilityCtx } | null> {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required", message: "Sign in to read the budget." });
      return null;
    }
    if (await isFormer(user)) {
      res.status(403).json({ error: "former_member", message: "The budget is read by members of the village." });
      return null;
    }
    const ctx = await capabilityCtx(user);
    const needed = ctx.stageIndexOf(MEMBER_RUNG);
    if (needed < 0 || ctx.stageIndex < needed) {
      res.status(403).json({ error: "members_only", message: "The budget is read by members of the village, from the member rung." });
      return null;
    }
    return { user, ctx };
  }

  const formatOf = (raw: any): NumberFormatChoice => ({
    locale: typeof raw?.locale === "string" && raw.locale.trim() ? raw.locale.trim().slice(0, 35) : "en",
    chosen: raw?.chosen === true,
  });
  const tooMany = (res: any) => res.status(429).json({ error: "too_many", message: "That is a lot of budget changes in a few minutes. Wait a little and try again." });

  /**
   * One import through the door. A preview needs the member rung and says
   * what the door would answer; a confirm needs the door, and is refused on a
   * payee conflict. Every answer is shaped for its reader (B2).
   */
  async function run(
    req: any,
    res: any,
    build: (body: any) => { source: "upload" | "manual"; lines: ImportRow[]; scope: ImportScope | null; sourceLabel?: string | null; sourceLink?: string | null } | { problem: string },
  ) {
    markAdminGate(req); // a gate is consulted here: the default-deny under /api/admin needs to hear it
    const who = await member(req, res);
    if (!who) return;
    const uid = String(who.user.id);
    const body = req.body ?? {};
    const dryRun = body.dryRun !== false;
    if (await overLimit(`budget-${dryRun ? "preview" : "write"}:${uid}`, dryRun ? PREVIEWS_PER_WINDOW : WRITES_PER_WINDOW, WINDOW_MS)) return tooMany(res);
    const built = build(body);
    if ("problem" in built) return res.status(400).json({ error: "refused", message: built.problem });
    const mayReadCash = hasCapability("cash.pay", who.ctx);
    const door = await budgetDoor(who.user, who.ctx);
    // A source's held words go only to the people who keep the budget (M9).
    const heldWords = door.ok ? undefined : new Map((await budgetLines(getPool())).filter((l) => l.nameHeld).map((l) => [l.id, l.label]));
    const view = <T extends Pick<ImportResult, "added" | "changed">>(r: T): T => cashView(r, mayReadCash, heldWords);
    const input: ImportInput = {
      source: built.source,
      lines: built.lines,
      scope: built.scope,
      by: uid,
      byAs: door.ok ? door.byAs : null,
      dryRun: true,
      format: formatOf(body.format),
      sourceLabel: built.sourceLabel ?? null,
      sourceLink: built.sourceLink ?? null,
    };
    const preview = await importBudgetLines(getPool(), input);
    if (!preview.ok) return res.status(preview.status).json(view(preview));
    if (preview.refused.some((r) => r.reason === "no_line")) return res.status(404).json({ error: "not_found", message: "There is no budget line with that id." });
    const seated = new Set(await seatedRoleIds(uid));
    const conflict = rolesTouched(preview).some((id) => seated.has(id));
    const doorView = door.ok
      ? conflict
        ? { mayWrite: false, code: "payee_conflict", message: PAYEE_CONFLICT, suggest: SUGGEST }
        : { mayWrite: true, via: door.via }
      : { mayWrite: false, code: door.body.code, message: door.body.error, suggest: door.body.suggest ?? null };
    if (dryRun) return res.json({ ...view(preview), door: doorView });
    if (!door.ok) return res.status(door.status).json(door.body);
    if (conflict) return res.status(409).json({ error: PAYEE_CONFLICT, code: "payee_conflict", suggest: SUGGEST });
    const revision = typeof body.revision === "string" && body.revision ? body.revision : null;
    const done = await importBudgetLines(getPool(), { ...input, dryRun: false, revision, stateRevision: null });
    res.status(done.status).json({ ...view(done), door: doorView });
  }

  const rowsOf = (raw: unknown): ImportRow[] | null => (Array.isArray(raw) ? (raw.filter((r) => r && typeof r === "object") as ImportRow[]) : null);
  const one = (raw: any): ImportRow => {
    const { id: _id, action: _action, adoptedAs: _adoptedAs, ...rest } = raw && typeof raw === "object" ? raw : ({} as any);
    return rest as ImportRow;
  };

  app.post("/api/admin/budgets/import", (req, res) =>
    run(req, res, (body) => {
      const lines = rowsOf(body.lines);
      if (!lines || !lines.length) return { problem: "Send the rows to import." };
      if (lines.length > IMPORT_ROWS_MAX) return { problem: `One import carries at most ${IMPORT_ROWS_MAX} lines. Split the sheet by period and import each part.` };
      const scope: ImportScope | null = body.scope && typeof body.scope === "object" ? { periods: rowsOfText(body.scope.periods), circles: circlesOf(body.scope.circles), whole: body.scope.whole === true } : null;
      const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 600) : null);
      return { source: "upload", lines: lines.map(one), scope, sourceLabel: text(body.sourceLabel), sourceLink: text(body.sourceLink) };
    }),
  );

  app.post("/api/admin/budgets/lines", (req, res) =>
    run(req, res, (body) => (body.line && typeof body.line === "object" ? { source: "manual", lines: [one(body.line)], scope: null } : { problem: "Send the line to add." })),
  );

  app.patch("/api/admin/budgets/lines/:id", (req, res) =>
    run(req, res, (body) => ({ source: "manual", lines: [{ ...one(body.changes ?? {}), id: String(req.params.id) }], scope: null })),
  );

  /**
   * One press on one line: withdraw, restore, or lock a rate. Each is undone
   * by another press, so the press previews and confirms at once, unless the
   * caller names a revision or asks for the preview.
   */
  async function onePress(req: any, res: any, row: ImportRow) {
    const body = req.body ?? {};
    if (body.dryRun === undefined && !body.revision) {
      markAdminGate(req);
      const who = await member(req, res);
      if (!who) return;
      if (await overLimit(`budget-preview:${String(who.user.id)}`, PREVIEWS_PER_WINDOW, WINDOW_MS)) return tooMany(res);
      const p = await importBudgetLines(getPool(), { source: "manual", lines: [row], by: String(who.user.id), byAs: null, dryRun: true });
      req.body = { ...body, dryRun: false, revision: p.revision };
    }
    return run(req, res, () => ({ source: "manual", lines: [row], scope: null }));
  }
  app.post("/api/admin/budgets/lines/:id/withdraw", (req, res) => onePress(req, res, { id: String(req.params.id), action: "withdraw" }));
  app.post("/api/admin/budgets/lines/:id/restore", (req, res) => onePress(req, res, { id: String(req.params.id), action: "restore" }));

  /** A lock row from a body: the stored daily rate, or a typed rate with where it comes from. */
  const lockRow = (id: string, body: any): ImportRow =>
    body?.use === "provider"
      ? { id, action: "lock", use: "provider" }
      : { id, action: "lock", rate: typeof body?.rate === "number" || typeof body?.rate === "string" ? body.rate : "", sourceNote: typeof body?.sourceNote === "string" ? body.sourceNote : "" };
  app.post("/api/admin/budgets/lines/:id/lock-rate", (req, res) => onePress(req, res, lockRow(String(req.params.id), req.body)));
  app.post("/api/admin/budgets/lock-rates", (req, res) =>
    run(req, res, (body) => {
      const ids = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === "string" && x).map(String) : [];
      if (!ids.length) return { problem: "Name the lines to lock a rate on." };
      if (ids.length > IMPORT_ROWS_MAX) return { problem: `Lock at most ${IMPORT_ROWS_MAX} lines at once.` };
      return { source: "manual", lines: ids.map((id: string) => lockRow(id, body)), scope: null };
    }),
  );

  // Sync budget, the schedule and the on-open read (R19, PR 2), through this file's one door.
  const seraReads = registerBudgetSync(app, { getPool, overLimit, doorFor: (req, res) => doorFor(req, res, BUDGET_CONTROL) });

  // ── Reading (R23) ─────────────────────────────────────────────────────────

  app.get("/api/budgets", async (req, res) => {
    const who = await member(req, res);
    if (!who) return;
    if (await overLimit(`budget-read:${String(who.user.id)}`, READS_PER_WINDOW, WINDOW_MS)) return res.status(429).json({ error: "too_many", message: "That is a lot of reads in a few minutes. Wait a little and try again." });
    const moonId = typeof req.query?.moon === "string" && req.query.moon ? String(req.query.moon) : currentCycle().id;
    const moon = moonPeriod(moonId, villageTimezone());
    if (!moon) return res.status(400).json({ error: "bad_moon", message: "Name a moon by its id, like the one the moon review shows." });
    const pool = getPool();
    const door = await budgetDoor(who.user, who.ctx);
    // Committed and spent below the village total come from `cash_owed`, which is holder-only (R23).
    const mayReadCash = hasCapability("cash.pay", who.ctx);
    // A source's line held for its words stays out of the members' view until a holder renames it (M9).
    const every = await budgetLines(pool);
    const heldIds = new Set(every.filter((l) => stillHeld(l)).map((l) => l.id));
    const all = every.filter((l) => door.ok || !heldIds.has(l.id));
    const figure = await cashBudgetLeft(pool, moonId);
    const span = { id: moonId, startsOn: moon.startsOn, endsOn: moon.endsOn, days: moon.days };
    const touching = all.filter((l) => sharedDays(l, span) > 0);
    const village = String(projectCurrency() ?? "").trim().toUpperCase();
    const sourceTotals: Record<string, Record<string, number>> = {};
    for (const l of touching) {
      const converted = village ? inVillageCurrency(l, village) : null;
      if (l.status === "withdrawn" || l.status === "draft" || l.nameHeld || !CASH_CATEGORIES.includes(l.category) || converted === null) continue;
      const bySource = (sourceTotals[l.source] = sourceTotals[l.source] ?? {});
      bySource[l.category] = (bySource[l.category] ?? 0) + lineShareOfMoon({ ...l, plannedMinor: converted }, span).countedMinor;
    }
    const drift = (await budgetRateDrift(pool)).filter((d) => touching.some((l) => l.id === d.id));
    // Who keeps the budget, or pays cash, may open the sheet an import came from (R29).
    const mayReadLink = door.ok || mayReadCash;
    const syncs = (await latestSyncs(pool)).map((s) => ({ ...s, sourceLink: mayReadLink ? s.sourceLink : null }));
    // Each header figure is dated by the newest change that fed it (R29).
    const fedPlanned = figure ? figure.working.lines.map((w) => all.find((l) => l.id === w.id)?.changedAt ?? null).filter((x): x is string => !!x).sort().pop() ?? null : null;
    const fedCommitted = figure?.working.committed.asOf ?? null;
    const left = [fedPlanned, fedCommitted].filter((x): x is string => !!x).sort().pop() ?? null;
    // Where it goes (R31): the moon's plan per circle, village-wide lines placed on the village's circle as they are read (M2).
    const names = await budgetCircleNames(pool);
    const villageCircle = await budgetVillageCircle(pool);
    const merged = new Map<string, { circleId: string | null; byCategory: Record<string, number>; totalMinor: number }>();
    for (const c of moonPlan(all, span, village || null).byCircle) {
      const id = c.circleId === VILLAGE_WIDE || c.circleId === null ? villageCircle?.id ?? null : c.circleId;
      const into = merged.get(String(id)) ?? { circleId: id, byCategory: { role_pay: 0, quest_pay: 0, materials: 0, other: 0 }, totalMinor: 0 };
      for (const k of Object.keys(c.byCategory)) into.byCategory[k] += (c.byCategory as Record<string, number>)[k];
      into.totalMinor += c.totalMinor;
      merged.set(String(id), into);
    }
    const byCircle = Array.from(merged.values())
      .sort((a, b) => String(a.circleId ?? "") < String(b.circleId ?? "") ? -1 : 1)
      .map((c) => ({ circleId: c.circleId, circleName: c.circleId ? names.get(c.circleId) ?? null : null, byCategory: c.byCategory, totalMinor: c.totalMinor }));
    const circlesView = await budgetCircles(pool, moonId);
    const envelopes = (circlesView?.circles ?? [])
      .filter((c) => c.envelope)
      .map((c) => ({ circleId: c.id, circleName: c.name, plannedMinor: c.plannedMinor, envelopeMinor: c.envelope!.forMoonMinor, periodKey: c.envelope!.periodKey, goalNote: c.envelope!.goalNote, changedAs: c.envelope!.changedAs, over: c.over, envelopeOverlap: c.envelopeOverlap }));
    const note = await periodNote(pool, moonId);
    // Who switched each source on is read by role, never by account (R18).
    const sources = (await budgetSourceStates(pool)).map(({ setBy: _setBy, ...s }) => s);
    const lockedAs = new Map(all.map((l) => [l.id, l.fxLockedAs ?? null]));
    res.json({
      moon: span,
      villageCurrency: village || null,
      stateRevision: stateRevision(all),
      lines: touching.map((l) => lineView(l, mayReadCash, village, door.ok)),
      figure: figure
        ? {
            ...figure,
            working: {
              ...figure.working,
              // The role a rate was locked as, kept as written, never an account (S10).
              lines: figure.working.lines.map(({ fx, ...l }) => ({ ...l, fx: fx ? { rate: fx.rate, source: fx.source, asOf: fx.asOf, lockedAt: fx.lockedAt, lockedAs: lockedAs.get(l.id) ?? null } : null })),
              // A line held for its words stays with the door, by id as well as by words (V6).
              notCounted: door.ok ? figure.working.notCounted : figure.working.notCounted.filter((n) => !heldIds.has(n.id)),
              committed: mayReadCash ? figure.working.committed : null,
            },
          }
        : null,
      drift,
      driftWarning: drift.some((d) => d.overThreshold),
      sourceTotals,
      syncs,
      asOf: { planned: fedPlanned, committed: fedCommitted, left },
      byCircle,
      villageCircle,
      envelopes,
      sources,
      // The moon's share moving, for members here and never on the public pulse (S5).
      shareHistory: await budgetShareHistory(pool),
      note: note ? { periodKey: note.periodKey, note: note.note, changedAt: note.changedAt, changedAs: note.changedAs } : null,
      mayReadCash,
      door: door.ok ? { mayWrite: true, via: door.via } : { mayWrite: false, code: door.body.code, message: door.body.error, suggest: door.body.suggest ?? null },
    });
    // Opening the section queues a read of the sources, after the answer and never holding it up (R19).
    seraReads.opened();
  });

  // ── Moons ahead (R30) ─────────────────────────────────────────────────────

  app.get("/api/budgets/ahead", async (req, res) => {
    const who = await member(req, res);
    if (!who) return;
    if (await overLimit(`budget-read:${String(who.user.id)}`, READS_PER_WINDOW, WINDOW_MS)) return res.status(429).json({ error: "too_many", message: "That is a lot of reads in a few minutes. Wait a little and try again." });
    const raw = String(req.query?.count ?? "6");
    const count = /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
    if (!(count >= 1 && count <= 12)) return res.status(400).json({ error: "bad_count", message: "Ask for 1 to 12 moons ahead." });
    const from = typeof req.query?.from === "string" && req.query.from ? String(req.query.from) : currentCycle().id;
    const ahead = await budgetAhead(getPool(), from, count);
    if (!ahead) return res.status(400).json({ error: "bad_moon", message: "Name the first moon by its id, like the one the moon review shows." });
    res.json(ahead);
  });

  /** A write through the door for one of the other three controls: the door's refusal keeps its suggestion path (B3). */
  async function doorFor(req: any, res: any, control: string): Promise<{ uid: string; byAs: string; via: string; dryRun: boolean; ctx: CapabilityCtx } | null> {
    markAdminGate(req); // a gate is consulted here: the default-deny under /api/admin needs to hear it
    const who = await member(req, res);
    if (!who) return null;
    const uid = String(who.user.id);
    const dryRun = (req.body ?? {}).dryRun !== false;
    if (await overLimit(`budget-${dryRun ? "preview" : "write"}:${uid}`, dryRun ? PREVIEWS_PER_WINDOW : WRITES_PER_WINDOW, WINDOW_MS)) {
      tooMany(res);
      return null;
    }
    const door = await budgetDoor(who.user, who.ctx, control);
    if (!door.ok) {
      res.status(door.status).json(door.body);
      return null;
    }
    return { uid, byAs: door.byAs, via: door.via, dryRun, ctx: who.ctx };
  }

  // ── How to read a period (R32) ────────────────────────────────────────────

  app.put("/api/admin/budgets/notes/:period", async (req, res) => {
    const w = await doorFor(req, res, "budget_notes");
    if (!w) return;
    const out = await setPeriodNote(getPool(), { period: String(req.params.period), note: typeof req.body?.note === "string" ? req.body.note : "", by: w.uid, byAs: w.byAs });
    if (!out.ok) return res.status(out.status).json({ error: out.code, message: out.message });
    res.json(out);
  });

  // ── The circles view (R31) and a circle's envelope (R35) ──────────────────

  app.get("/api/budgets/circles", async (req, res) => {
    const who = await member(req, res);
    if (!who) return;
    if (await overLimit(`budget-read:${String(who.user.id)}`, READS_PER_WINDOW, WINDOW_MS)) return res.status(429).json({ error: "too_many", message: "That is a lot of reads in a few minutes. Wait a little and try again." });
    const moonId = typeof req.query?.moon === "string" && req.query.moon ? String(req.query.moon) : currentCycle().id;
    const view = await budgetCircles(getPool(), moonId);
    if (!view) return res.status(400).json({ error: "bad_moon", message: "Name a moon by its id, like the one the moon review shows." });
    // Committed per circle comes from `cash_owed`, which is holder-only (R23).
    const mayReadCash = hasCapability("cash.pay", who.ctx);
    res.json({
      ...view,
      unplacedCommittedMinor: mayReadCash ? view.unplacedCommittedMinor : null,
      circles: view.circles.map((c) => ({ ...c, committedMinor: mayReadCash ? c.committedMinor : null, envelope: c.envelope ? (({ changedAt, changedAs, goalNote, plannedMinor, forMoonMinor, periodKey, periodKind, startsOn, endsOn, currency }) => ({ changedAt, changedAs, goalNote, plannedMinor, forMoonMinor, periodKey, periodKind, startsOn, endsOn, currency }))(c.envelope) : null })),
      mayReadCash,
    });
  });

  app.put("/api/admin/budgets/envelopes/:circleId/:periodKey", async (req, res) => {
    const w = await doorFor(req, res, "budget_envelopes");
    if (!w) return;
    const body = req.body ?? {};
    const out = await setEnvelope(getPool(), {
      circleId: String(req.params.circleId),
      period: String(req.params.periodKey),
      planned: typeof body.planned === "number" || typeof body.planned === "string" ? body.planned : "",
      goalNote: typeof body.goalNote === "string" ? body.goalNote : null,
      format: formatOf(body.format),
      by: w.uid,
      byAs: w.byAs,
      dryRun: w.dryRun,
      revision: typeof body.revision === "string" ? body.revision : null,
    });
    if (!out.ok) return res.status(out.status).json({ error: out.code, message: out.message });
    res.json({ ...out, door: { mayWrite: true, via: w.via } });
  });

  // ── A source's standing switch (R18) ──────────────────────────────────────

  app.post("/api/admin/budgets/sources/:source", async (req, res) => {
    const w = await doorFor(req, res, "budget_sources");
    if (!w) return;
    const body = req.body ?? {};
    // The mode and the schedule are checked by `switchBudgetSource`, which refuses anything else by name. The
    // payee conflict is refused there too, before anything is written (B1).
    const out = await switchBudgetSource(getPool(), {
      source: String(req.params.source),
      on: body.on === true,
      mode: body.mode === undefined ? "auto" : body.mode,
      schedule: body.schedule === undefined ? "daily" : body.schedule,
      by: w.uid,
      byAs: w.byAs,
      dryRun: w.dryRun,
      revision: typeof body.revision === "string" ? body.revision : null,
      seatedRoleIds: await seatedRoleIds(w.uid),
    });
    if (!out.ok) {
      // A conflict answer carries no revision, no setter and no preview (B1), and names the vote path.
      if (out.code === "payee_conflict") return res.status(409).json({ error: out.message, code: out.code, suggest: suggestOn("budget_sources") });
      return res.status(out.status).json({ error: out.code, message: out.message });
    }
    const { before, ...rest } = out;
    const { setBy: _setBy, ...beforeView } = before;
    res.json({ ...rest, before: beforeView, door: { mayWrite: true, via: w.via } });
  });

  // ── The suggestion controls (R22, B3) ─────────────────────────────────────

  /** Who an Accept or a carried vote writes as: the accepting holder's role, or the village. */
  const decider = (by?: { decidedBy: string }) => {
    const village = !by || by.decidedBy.startsWith("village:");
    return { village, by: village ? null : by!.decidedBy, byAs: village ? BY_VILLAGE_VOTE : actingAs(by!.decidedBy) };
  };
  /** The roles a stored suggestion pays, written at creation (V10). */
  const rolesPaidOf = (payload: unknown): string[] => {
    const r = (payload as { rolesPaid?: unknown } | null)?.rolesPaid;
    return Array.isArray(r) ? r.filter((x): x is string => typeof x === "string") : [];
  };

  /*
   * THE CASH BUDGET'S LINES. A member's suggested change is the same import the
   * direct routes take, every act included (add, change, withdraw, restore,
   * lock, adopt: V1), with only an adoption's words taken off, since the
   * adoption is made as whoever decides it. It is checked by a dry run at
   * creation (refused or held rows, or no change at all, are refused), bound to
   * the lines it touches and what it does to them (S7), sent to the holders who
   * hold no role it pays and to a vote when there are none (V10), and applied
   * whole or not at all.
   */
  const cleanRows = (rows: ImportRow[]): ImportRow[] =>
    rows.map((r) => {
      const { adoptedAs: _adoptedAs, ...rest } = r as ImportRow;
      return rest;
    });
  /** The queue's freshness reads, cached a short while by payload and the budget as it stands (nit). */
  const versions = new Map<string, { at: number; version: string }>();
  const VERSION_TTL_MS = 30_000;
  const linesInput = (p: SuggestedImport, by: string | null, byAs: string | null): ImportInput => ({
    source: p.source, lines: cleanRows(p.lines), scope: p.scope ?? null, by, byAs, dryRun: true, format: formatOf(p.format),
  });
  registerAdminEditControl("budget_lines", {
    read: async () => {
      const all = await budgetLines(getPool());
      const version = stateRevision(all);
      return { value: { revision: version, lines: all.filter((l) => l.status !== "withdrawn").length }, version };
    },
    problem: suggestionProblem,
    prepare: async (payload, suggestedBy) => {
      const problem = suggestionProblem(payload);
      if (problem) return { problem, payload };
      const p = payload as SuggestedImport;
      const cleaned: SuggestedImport = { source: p.source, lines: cleanRows(p.lines), scope: p.scope ?? null, format: p.format };
      const r = await importBudgetLines(getPool(), linesInput(cleaned, suggestedBy, null));
      if (!r.ok) return { problem: r.message ?? "This change cannot be read.", payload };
      if (r.refused.length || r.held.length) return { problem: "Some rows of this change cannot be applied as written. Preview it, fix the rows, then suggest it.", payload };
      if (!r.added.length && !r.changed.length) return { problem: "This change would leave the budget as it is, so there is nothing to suggest.", payload };
      return { problem: null, payload: { ...cleaned, rolesPaid: rolesTouched(r).sort() }, version: r.touchedRevision };
    },
    versionFor: async (payload) => {
      const key = JSON.stringify([payload, stateRevision(await budgetLines(getPool())), projectCurrency()]);
      const hit = versions.get(key);
      if (hit && Date.now() - hit.at < VERSION_TTL_MS) return hit.version;
      const version = (await importBudgetLines(getPool(), linesInput(payload as SuggestedImport, null, null))).touchedRevision;
      if (versions.size > 200) versions.clear();
      versions.set(key, { at: Date.now(), version });
      return version;
    },
    deciders: (payload, holders) => unconflicted(rolesPaidOf(payload), holders),
    apply: async (payload, was, by): Promise<{ ok: true } | Refusal> => {
      const d = decider(by);
      const base = linesInput(payload as SuggestedImport, d.by, d.byAs);
      const preview = await importBudgetLines(getPool(), base);
      if (!preview.ok) return { ok: false, status: preview.status, body: { error: preview.message, code: preview.code } };
      if (preview.touchedRevision !== was) {
        return { ok: false, status: 409, body: { error: "The lines this suggestion changes moved since it was made. Suggest it again on the budget as it is now.", code: "stale" } };
      }
      if (preview.refused.length || preview.held.length) {
        return { ok: false, status: 400, body: { error: "Some rows of this suggestion can no longer be read as written, so nothing was applied. Suggest it again.", code: "payload_refused" } };
      }
      if (!d.village) {
        const seated = new Set(await seatedRoleIds(d.by!));
        if (rolesTouched(preview).some((id) => seated.has(id))) return { ok: false, status: 409, body: { error: PAYEE_CONFLICT, code: "payee_conflict" } };
      }
      const done = await importBudgetLines(getPool(), { ...base, dryRun: false, revision: preview.revision });
      if (!done.ok) return { ok: false, status: done.status, body: { error: done.message, code: done.code } };
      return { ok: true };
    },
    describe: async (payload) => {
      if (suggestionProblem(payload)) return ["The suggested lines cannot be read."];
      const r = await importBudgetLines(getPool(), linesInput(payload as SuggestedImport, null, null));
      return ballotLines(r, String(projectCurrency() ?? "").toUpperCase(), { circles: await budgetCircleNames(getPool()), roles: await budgetRoleNames(getPool()) });
    },
  });

  // A circle's envelope (R35): the same `setEnvelope` the direct route calls.
  registerAdminEditControl("budget_envelopes", {
    read: async () => ({ value: {}, version: "envelopes" }),
    problem: (payload) => {
      const p = payload as Partial<SuggestedEnvelope> | null;
      if (!p || typeof p !== "object" || typeof p.circleId !== "string" || typeof p.period !== "string") return "A suggested envelope names its circle and its period.";
      if (typeof p.planned !== "string" && typeof p.planned !== "number") return "A suggested envelope says its amount.";
      return null;
    },
    prepare: async (payload, suggestedBy) => {
      const p = payload as SuggestedEnvelope;
      const r = await setEnvelope(getPool(), { ...envelopeInput(p), by: suggestedBy, byAs: null, dryRun: true });
      if (!r.ok) return { problem: r.message, payload };
      return { problem: null, payload: envelopeInput(p), version: await envelopeVersion(getPool(), p.circleId, p.period) };
    },
    versionFor: async (payload) => envelopeVersion(getPool(), (payload as SuggestedEnvelope).circleId, (payload as SuggestedEnvelope).period),
    apply: async (payload, was, by) => {
      const p = payload as SuggestedEnvelope;
      if ((await envelopeVersion(getPool(), p.circleId, p.period)) !== was) return { ok: false, status: 409, body: { error: "This envelope changed since the suggestion was made. Suggest it again.", code: "stale" } };
      const d = decider(by);
      const dry = await setEnvelope(getPool(), { ...envelopeInput(p), by: d.by, byAs: d.byAs, dryRun: true });
      if (!dry.ok) return { ok: false, status: dry.status, body: { error: dry.message, code: dry.code } };
      // The version the suggestion was made on is checked again inside the budget lock.
      const done = await setEnvelope(getPool(), { ...envelopeInput(p), by: d.by, byAs: d.byAs, dryRun: false, revision: dry.revision, expectVersion: was });
      return done.ok ? { ok: true } : { ok: false, status: done.status, body: { error: done.message, code: done.code } };
    },
    describe: async (payload) => {
      const p = payload as SuggestedEnvelope;
      const r = await setEnvelope(getPool(), { ...envelopeInput(p), by: null, byAs: null, dryRun: true });
      if (!r.ok) return [`This envelope cannot be set as written: ${r.message}`];
      const was = r.before ? formatMoney(r.before.plannedMinor, r.before.currency) : "no envelope";
      const circle = (await budgetCircleNames(getPool())).get(r.after.circleId) ?? "a circle";
      return [`Sets the envelope of ${circle} for ${r.after.periodKey}: from ${was} to ${formatMoney(r.after.plannedMinor, r.after.currency)}.`, `Its lines plan ${formatMoney(r.circlePlannedMinor, r.after.currency)} for that period.`];
    },
  });

  // A period's note (R32): the same `setPeriodNote` the direct route calls.
  registerAdminEditControl("budget_notes", {
    read: async () => ({ value: {}, version: "notes" }),
    problem: (payload) => {
      const p = payload as Partial<SuggestedNote> | null;
      return p && typeof p === "object" && typeof p.period === "string" && typeof p.note === "string" ? null : "A suggested note names its period and its words.";
    },
    prepare: async (payload, suggestedBy) => {
      const p = payload as SuggestedNote;
      const r = await setPeriodNote(getPool(), { period: p.period, note: p.note, by: suggestedBy, byAs: null, dryRun: true });
      if (!r.ok) return { problem: r.message, payload };
      return { problem: null, payload: { period: p.period, note: p.note }, version: await periodNoteVersion(getPool(), p.period) };
    },
    versionFor: async (payload) => periodNoteVersion(getPool(), (payload as SuggestedNote).period),
    apply: async (payload, was, by) => {
      const p = payload as SuggestedNote;
      if ((await periodNoteVersion(getPool(), p.period)) !== was) return { ok: false, status: 409, body: { error: "This note changed since the suggestion was made. Suggest it again.", code: "stale" } };
      const d = decider(by);
      // The version the suggestion was made on is checked again inside the budget lock.
      const done = await setPeriodNote(getPool(), { period: p.period, note: p.note, by: d.by, byAs: d.byAs, expectVersion: was });
      return done.ok ? { ok: true } : { ok: false, status: done.status, body: { error: done.message, code: done.code } };
    },
    describe: async (payload) => {
      const p = payload as SuggestedNote;
      return p.note.trim() ? [`Sets the note on how to read ${p.period}:`, p.note.trim()] : [`Clears the note on how to read ${p.period}.`];
    },
  });

  // A source's standing switch (R18): the same `switchBudgetSource` the direct route calls.
  registerAdminEditControl("budget_sources", {
    read: async () => ({ value: {}, version: "sources" }),
    problem: (payload) => {
      const p = payload as Partial<SuggestedSwitch> | null;
      return p && typeof p === "object" && typeof p.source === "string" && typeof p.on === "boolean" ? null : "A suggested switch names its source and whether it is on.";
    },
    prepare: async (payload, suggestedBy) => {
      const p = payload as SuggestedSwitch;
      const r = await switchBudgetSource(getPool(), { ...switchInput(p), by: suggestedBy, byAs: null, dryRun: true });
      if (!r.ok) return { problem: r.message, payload };
      return { problem: null, payload: { ...switchInput(p), rolesPaid: r.rolesPaid }, version: await sourceVersion(getPool(), p.source) };
    },
    versionFor: async (payload) => sourceVersion(getPool(), (payload as SuggestedSwitch).source),
    deciders: (payload, holders) => unconflicted(rolesPaidOf(payload), holders),
    apply: async (payload, was, by) => {
      const p = payload as SuggestedSwitch;
      if ((await sourceVersion(getPool(), p.source)) !== was) return { ok: false, status: 409, body: { error: "This source changed since the suggestion was made. Suggest it again.", code: "stale" } };
      const d = decider(by);
      const seated = d.village ? [] : await seatedRoleIds(d.by!);
      const dry = await switchBudgetSource(getPool(), { ...switchInput(p), by: d.by, byAs: d.byAs, dryRun: true, seatedRoleIds: seated });
      if (!dry.ok) return { ok: false, status: dry.status, body: { error: dry.message, code: dry.code } };
      const done = await switchBudgetSource(getPool(), { ...switchInput(p), by: d.by, byAs: d.byAs, dryRun: false, revision: dry.revision, seatedRoleIds: seated });
      return done.ok ? { ok: true } : { ok: false, status: done.status, body: { error: done.message, code: done.code } };
    },
    describe: async (payload) => {
      const p = payload as SuggestedSwitch;
      const r = await switchBudgetSource(getPool(), { ...switchInput(p), by: null, byAs: BY_VILLAGE_VOTE, dryRun: true });
      const share = r.ok ? shareWords(r.shareBefore, r.shareAfter, String(projectCurrency() ?? "").toUpperCase()) : [];
      return [p.on ? `Turns ${p.source} on, ${switchInput(p).mode === "review" ? "waiting for review" : "applying what it sends at once"}, read ${switchInput(p).schedule}.` : `Turns ${p.source} off. What it already sent keeps counting.`, ...(r.ok ? [`${r.adopts} line(s) it already sent count from now.`] : []), ...share];
    },
  });
}

interface SuggestedImport {
  source: "upload" | "manual";
  lines: ImportRow[];
  scope?: ImportScope | null;
  format?: NumberFormatChoice;
  /** The roles the change pays, written at creation (V10). */
  rolesPaid?: string[];
}
interface SuggestedEnvelope {
  circleId: string;
  period: string;
  planned: string | number;
  goalNote?: string | null;
  format?: NumberFormatChoice;
}
interface SuggestedNote {
  period: string;
  note: string;
}
interface SuggestedSwitch {
  source: string;
  on: boolean;
  mode?: "auto" | "review";
  schedule?: "daily" | "hourly" | "off";
  rolesPaid?: string[];
}

const envelopeInput = (p: SuggestedEnvelope) => ({
  circleId: String(p.circleId),
  period: String(p.period),
  planned: typeof p.planned === "number" ? p.planned : String(p.planned ?? ""),
  goalNote: typeof p.goalNote === "string" ? p.goalNote : null,
  format: p.format && typeof p.format.locale === "string" ? { locale: p.format.locale.slice(0, 35), chosen: p.format.chosen === true } : undefined,
});
const switchInput = (p: SuggestedSwitch) => ({
  source: String(p.source),
  on: p.on === true,
  mode: (p.mode === "review" ? "review" : "auto") as "auto" | "review",
  schedule: (p.schedule === "hourly" ? "hourly" : p.schedule === "off" ? "off" : "daily") as "daily" | "hourly" | "off",
});

/** The share before and after, in words for a ballot (S7). Figures members already read, nothing more. */
function shareWords(before: ImportResult["shareBefore"], after: ImportResult["shareAfter"], currency: string): string[] {
  const left = (s: ImportResult["shareBefore"]) => (s.set && s.leftMinor !== null ? `${formatMoney(s.leftMinor, currency || "XXX")} left` : "no budget");
  const pct = (s: ImportResult["shareBefore"]) => (s.sharePct === null ? "" : `, a cash share of ${s.sharePct}%`);
  return [`This moon's cash budget: ${left(before)}${pct(before)} now, and ${left(after)}${pct(after)} if this carries.`];
}

/**
 * WHAT A SUGGESTED BUDGET CHANGE DOES, in words for its ballot (S7): each
 * line's act (adds, changes, withdraws, restores, locks a rate on, adopts),
 * every field that differs, and the cash share before and after.
 */
export function ballotLines(r: ImportResult, currency: string, names: { circles?: ReadonlyMap<string, string>; roles?: ReadonlyMap<string, string> } = {}): string[] {
  const money = (minor: number | null, cur: string) => (minor === null ? "none" : formatMoney(minor, cur));
  const circleName = (id: string | null) => (id === VILLAGE_WIDE ? "the whole village" : id === null ? null : names.circles?.get(id) ?? "a circle not on the chart");
  const roleName = (id: string | null) => (id === null ? null : names.roles?.get(id) ?? "a role not on the chart");
  const fields = (a: PreviewLine, b: PreviewLine): string[] => {
    const out: string[] = [];
    const diff = (name: string, x: unknown, y: unknown, show: (v: any) => string = String) => {
      if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`${name} from ${x === null || x === undefined ? "none" : show(x)} to ${y === null || y === undefined ? "none" : show(y)}`);
    };
    diff("label", a.label, b.label);
    diff("period", a.periodKey, b.periodKey);
    diff("circle", circleName(a.circleId), circleName(b.circleId));
    diff("role", roleName(a.roleId), roleName(b.roleId));
    diff("category", a.category, b.category);
    diff("currency", a.currency, b.currency);
    diff("planned", a.plannedMinor, b.plannedMinor, (v) => money(v, b.currency));
    diff("status", a.status, b.status);
    diff("rate", a.fx ? `${a.fx.rate} (${a.fx.source ?? "no source"})` : null, b.fx ? `${b.fx.rate} (${b.fx.source ?? "no source"})` : null);
    diff(`in ${currency || "the village's currency"}`, a.convertedMinor, b.convertedMinor, (v) => money(v, currency || "XXX"));
    return out;
  };
  const verbs: Record<string, string> = { change: "Changes", restore: "Restores", withdraw: "Withdraws", lock: "Locks a rate on", adopt: "Adopts" };
  const lines = [
    ...r.added.map((a) => {
      const where = a.circleId === VILLAGE_WIDE ? "for the whole village" : `in ${circleName(a.circleId)}`;
      return `Adds "${a.label}": ${money(a.plannedMinor, a.currency)}, ${a.category.replace("_", " ")}, for ${a.periodKey}, ${where}${a.roleId ? `, for the role ${roleName(a.roleId)}` : ""}.`;
    }),
    ...r.changed.map((c) => {
      const what = fields(c.before, c);
      const counts = c.op === "adopt" ? " It counts from now." : c.op === "withdraw" ? " It stops counting, and stays on the record." : "";
      return `${verbs[c.op] ?? "Changes"} "${c.before.label}"${what.length ? `: ${what.join("; ")}` : ""}.${counts}`;
    }),
    ...r.refused.map((x) => `Row ${x.row} cannot be read: ${x.message}`),
  ];
  return [...(lines.length ? lines : ["Nothing differs from the budget as it stands."]), ...shareWords(r.shareBefore, r.shareAfter, currency)];
}

/** What a suggested budget change must look like: the body an import or a hand line takes. */
export function suggestionProblem(payload: unknown): string | null {
  const p = payload as Partial<SuggestedImport> | null;
  if (!p || typeof p !== "object" || Array.isArray(p)) return "A suggested budget change is an import: its source and its rows.";
  if (p.source !== "upload" && p.source !== "manual") return "A suggested budget change is an upload or a hand line.";
  if (!Array.isArray(p.lines) || !p.lines.length) return "Send the rows the change makes.";
  if (p.lines.length > IMPORT_ROWS_MAX) return `One change carries at most ${IMPORT_ROWS_MAX} lines.`;
  if (p.lines.some((l) => !l || typeof l !== "object")) return "Every row is a line of the budget.";
  return null;
}

function rowsOfText(raw: unknown): string[] | undefined {
  return Array.isArray(raw) ? raw.filter((x) => typeof x === "string").slice(0, 50).map((x) => String(x).slice(0, 64)) : undefined;
}

function circlesOf(raw: unknown): Array<string | null> | undefined {
  return Array.isArray(raw) ? raw.filter((x) => x === null || typeof x === "string").slice(0, 200).map((x) => (x === null ? null : String(x).slice(0, 120))) : undefined;
}

/**
 * One line as a member reads it: never an account id, spent only for
 * `cash.pay` (R23, R25), the holder's rename in place of a source's words,
 * and the source's own words only to the people who keep the budget (M9).
 */
function lineView(l: StoredLine, mayReadCash: boolean, village: string, isDoor: boolean) {
  return {
    // "Was X at the last sync" (R18), and the source's own "as of".
    prevPlannedMinor: l.prevPlannedMinor ?? null,
    prevSeenAt: l.prevSeenAt ?? null,
    sourceChangedAt: l.sourceChangedAt,
    convertedMinor: village ? inVillageCurrency(l, village) : null,
    // The role a rate was locked as, kept as written (S10).
    fx: l.fxRate ? { rate: l.fxRate, source: l.fxSource ?? null, asOf: l.fxAsOf ?? null, into: l.fxInto ?? null, lockedAt: l.fxLockedAt ?? null, lockedAs: l.fxLockedAs ?? null } : null,
    id: l.id,
    label: displayLabel(l),
    ...(isDoor ? { sourceWords: l.labelOverride ? l.label : null, nameHeld: stillHeld(l) } : {}),
    note: l.note,
    source: l.source,
    sourceLabel: isDoor ? l.sourceLabel : stillHeld(l) && (l.nameHeldCell ?? "").split(",").includes("source_label") ? null : displaySourceLabel(l),
    ...(isDoor ? { sourceLabelRenamed: l.sourceLabelOverride ?? null, heldOn: l.nameHeldCell ?? null } : {}),
    periodKind: l.periodKind,
    periodKey: l.periodKey,
    startsOn: l.startsOn,
    endsOn: l.endsOn,
    circleId: l.circleId,
    villageWide: l.circleId === VILLAGE_WIDE,
    roleId: l.roleId,
    matched: l.matched,
    category: l.category,
    plannedMinor: l.plannedMinor,
    spentMinor: mayReadCash ? l.spentMinor : null,
    currency: l.currency,
    status: l.status,
    withdrawnByHand: l.status === "withdrawn" && !l.withdrawnBySource,
    adopted: !!l.adoptedAt,
    adoptedAs: l.adoptedAs,
    changedAt: l.changedAt,
    changedAs: l.changedAs,
  };
}
