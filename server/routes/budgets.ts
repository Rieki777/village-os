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
 *
 * Every write goes through `importBudgetLines` (server/lib/budgets.ts), the
 * one write path, and through ONE door (R21), `budgetDoor` below:
 *
 *   holder     a live holder of `role.pay`, asked the deny-aware way
 *              (`holderOnlyDecision`, the gate with the admin short-circuit
 *              taken out), writes, recorded as the role they hold it through;
 *   admin      before the launch vote carries (`launchedByVote`), with nobody
 *              holding the power and the village not holding it, an admin
 *              writes, recorded as "admin, before launch";
 *   refused    anything else, with the suggestion path named: after launch
 *              with nobody holding it, or with the village holding it, the
 *              change is a suggestion (R22), which goes to a vote.
 *
 * And the payee conflict: a write that touches a line naming a role the
 * writer is seated in is refused, with the suggestion path named, so the
 * village decides it.
 *
 * A preview needs only the member rung, because every member reads the budget
 * and may suggest an upload "with the same preview" (R22). It answers what the
 * door would say, so the page shows the right banner before anybody confirms.
 *
 * `PUT /api/org/roles/:id/pay` (server/routes/valuation.ts) also asks for
 * `role.pay`. Moving it to this door is the valuation lane's, and this file
 * leaves it where it is.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { markAdminGate } from "../lib/adminGate";
import { registerAdminEditControl, type Refusal } from "../lib/adminSuggestions";
import {
  BY_VILLAGE_VOTE,
  budgetLines,
  cashBudgetLeft,
  configureBudgets,
  importBudgetLines,
  latestSyncs,
  stateRevision,
  type ImportInput,
  type ImportResult,
  type ImportRow,
  type ImportScope,
  type StoredLine,
} from "../lib/budgets";
import { leftTheVillage } from "../lib/formerMember";
import { holderOnlyDecision } from "../lib/holderOnly";
import { listOrgAssignments } from "../lib/orgChart";
import { launchedByVote } from "../lib/orgDraftDecide";
import { ADMIN_BEFORE_LAUNCH, CASH_CATEGORIES, IMPORT_ROWS_MAX, lineShareOfMoon, moonPeriod, sharedDays, type NumberFormatChoice } from "../../shared/budgets";
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
};

/** Where a refused write is sent instead (R21, R22). */
export const BUDGET_SUGGESTION_PATH = "/api/admin/suggestions";
export const BUDGET_CONTROL = "budget_lines";
const SUGGEST = { path: BUDGET_SUGGESTION_PATH, control: BUDGET_CONTROL };
const MEMBER_RUNG = "member";
const WRITES_PER_WINDOW = 60;
const PREVIEWS_PER_WINDOW = 240;
const WINDOW_MS = 10 * 60 * 1000;

/** The door's answer for one person (R21). */
export type BudgetDoor =
  | { ok: true; via: "holder" | "admin_before_launch"; byAs: string }
  | { ok: false; status: 401 | 403 | 409; body: { error: string; code: string; suggest?: typeof SUGGEST; holders?: string[] } };

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

const PAYEE_CONFLICT =
  "This changes a budget line for a role you hold, so the village decides it. Suggest the change, and it goes to the other holders or to a vote.";

export function register(app: Express, deps: Deps): void {
  const { authedUser, capabilityCtx, getPool, overLimit, liveHoldersOf, projectCurrency, rolesCarrying, roleHolders } = deps;
  const launched = deps.launched ?? (() => launchedByVote(getPool()));
  const isFormer = deps.isFormerMember ?? ((user: any) => leftTheVillage(getPool(), user));
  const seatedRoleIds =
    deps.seatedRoleIds ?? (async (userId: string) => (await listOrgAssignments(getPool())).filter((a) => String(a.userId ?? "") === userId).map((a) => a.orgRoleId));

  configureBudgets({
    currency: () => String(projectCurrency() ?? "").trim().toUpperCase(),
    seasons: () => (deps.seasonState().seasons ?? []).map((s: any) => ({ id: String(s.id), startsOn: s.startsOn ?? null, endsOn: s.endsOn ?? null })),
  });

  /** The role a holder acts through, named for `changed_as` (R1): a role, never a person. */
  const actingAs = (userId: string): string => {
    const held = new Set(roleHolders().filter((h) => String(h.userId) === userId).map((h) => String(h.roleId)));
    const names = rolesCarrying("role.pay").filter((r) => held.has(String(r.id))).map((r) => r.name);
    return (names.join(", ") || "a holder of role.pay").slice(0, 120);
  };

  /** THE ONE DOOR (R21). Asked of every write, a preview's banner and an Accept alike. */
  async function budgetDoor(user: any, ctx: CapabilityCtx | null): Promise<BudgetDoor> {
    // Deny-aware first: a warning badge on the power refuses a holder and the admin fallback alike.
    if ((ctx?.badgeDenies ?? []).includes("role.pay")) {
      return { ok: false, status: 403, body: { error: "A warning badge takes the budget power from you, so you cannot change the budget. Suggest the change instead.", code: "denied", suggest: SUGGEST } };
    }
    const holders = await liveHoldersOf("role.pay");
    const ans = holderOnlyDecision({ capability: "role.pay", ctx, liveHolders: holders, label: "the cash budget" });
    if (ans.ok && ans.via === "holder") return { ok: true, via: "holder", byAs: actingAs(String(user.id)) };
    if (ans.ok) {
      // The operator fallback: an admin, nobody holding the power, the village not holding it.
      if (await launched()) {
        return {
          ok: false,
          status: 409,
          body: {
            error: "Nobody holds the budget power since the launch vote, so a change to the budget goes to the village. Suggest the change, and it goes to a vote.",
            code: "nobody_holds_it",
            suggest: SUGGEST,
          },
        };
      }
      return { ok: true, via: "admin_before_launch", byAs: ADMIN_BEFORE_LAUNCH };
    }
    if (ans.body.code === "auth_required") return { ok: false, status: 401, body: { error: "Sign in first.", code: "auth_required" } };
    if (ans.body.code === "village_holds_it") {
      return { ok: false, status: 409, body: { error: "The village holds the budget power, so a change to the budget goes to a vote. Suggest the change.", code: "village_holds_it", suggest: SUGGEST } };
    }
    return {
      ok: false,
      status: 403,
      body: { error: "Only the people who hold the budget power change the budget. Suggest the change, and it goes to them.", code: "holders_only", suggest: SUGGEST, holders: ans.body.holders },
    };
  }

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

  /**
   * One import through the door. A preview needs the member rung and says
   * what the door would answer; a confirm needs the door, and is refused on a
   * payee conflict.
   */
  async function run(req: any, res: any, build: (body: any) => { source: "upload" | "manual"; lines: ImportRow[]; scope: ImportScope | null } | { problem: string }) {
    markAdminGate(req); // a gate is consulted here: the default-deny under /api/admin needs to hear it
    const who = await member(req, res);
    if (!who) return;
    const uid = String(who.user.id);
    const body = req.body ?? {};
    const dryRun = body.dryRun !== false;
    if (await overLimit(`budget-${dryRun ? "preview" : "write"}:${uid}`, dryRun ? PREVIEWS_PER_WINDOW : WRITES_PER_WINDOW, WINDOW_MS)) {
      return res.status(429).json({ error: "too_many", message: "That is a lot of budget changes in a few minutes. Wait a little and try again." });
    }
    const built = build(body);
    if ("problem" in built) return res.status(400).json({ error: "refused", message: built.problem });
    const door = await budgetDoor(who.user, who.ctx);
    const input: ImportInput = {
      source: built.source,
      lines: built.lines,
      scope: built.scope,
      by: uid,
      byAs: door.ok ? door.byAs : null,
      dryRun: true,
      format: formatOf(body.format),
    };
    const preview = await importBudgetLines(getPool(), input);
    if (!preview.ok) return res.status(preview.status).json(preview);
    const seated = new Set(await seatedRoleIds(uid));
    const conflict = rolesTouched(preview).some((id) => seated.has(id));
    const doorView = door.ok
      ? conflict
        ? { mayWrite: false, code: "payee_conflict", message: PAYEE_CONFLICT, suggest: SUGGEST }
        : { mayWrite: true, via: door.via }
      : { mayWrite: false, code: door.body.code, message: door.body.error, suggest: door.body.suggest ?? null };
    if (dryRun) return res.json({ ...preview, door: doorView });
    if (!door.ok) return res.status(door.status).json(door.body);
    if (conflict) return res.status(409).json({ error: PAYEE_CONFLICT, code: "payee_conflict", suggest: SUGGEST });
    const revision = typeof body.revision === "string" && body.revision ? body.revision : null;
    const done = await importBudgetLines(getPool(), { ...input, dryRun: false, revision, stateRevision: null });
    res.status(done.status).json({ ...done, door: doorView });
  }

  const rowsOf = (raw: unknown): ImportRow[] | null => (Array.isArray(raw) ? (raw.filter((r) => r && typeof r === "object") as ImportRow[]) : null);
  const one = (raw: any): ImportRow => {
    const { id: _id, action: _action, ...rest } = raw && typeof raw === "object" ? raw : ({} as any);
    return rest as ImportRow;
  };

  app.post("/api/admin/budgets/import", (req, res) =>
    run(req, res, (body) => {
      const lines = rowsOf(body.lines);
      if (!lines || !lines.length) return { problem: "Send the rows to import." };
      if (lines.length > IMPORT_ROWS_MAX) return { problem: `One import carries at most ${IMPORT_ROWS_MAX} lines. Split the sheet by period and import each part.` };
      const scope: ImportScope | null = body.scope && typeof body.scope === "object" ? { periods: rowsOfText(body.scope.periods), circles: circlesOf(body.scope.circles), whole: body.scope.whole === true } : null;
      return { source: "upload", lines: lines.map(one), scope };
    }),
  );

  app.post("/api/admin/budgets/lines", (req, res) =>
    run(req, res, (body) => (body.line && typeof body.line === "object" ? { source: "manual", lines: [one(body.line)], scope: null } : { problem: "Send the line to add." })),
  );

  app.patch("/api/admin/budgets/lines/:id", (req, res) =>
    run(req, res, (body) => ({ source: "manual", lines: [{ ...one(body.changes ?? {}), id: String(req.params.id) }], scope: null })),
  );

  /** Withdraw and restore: restorable by design, so a press previews and confirms at once unless a revision is named. */
  async function flip(req: any, res: any, action: "withdraw" | "restore") {
    const body = req.body ?? {};
    if (body.dryRun === undefined && !body.revision) {
      markAdminGate(req);
      const who = await member(req, res);
      if (!who) return;
      if (await overLimit(`budget-preview:${String(who.user.id)}`, PREVIEWS_PER_WINDOW, WINDOW_MS)) {
        return res.status(429).json({ error: "too_many", message: "That is a lot of budget changes in a few minutes. Wait a little and try again." });
      }
      const p = await importBudgetLines(getPool(), { source: "manual", lines: [{ id: String(req.params.id), action }], by: String(who.user.id), byAs: null, dryRun: true });
      req.body = { ...body, dryRun: false, revision: p.revision };
    }
    return run(req, res, () => ({ source: "manual", lines: [{ id: String(req.params.id), action }], scope: null }));
  }
  app.post("/api/admin/budgets/lines/:id/withdraw", (req, res) => flip(req, res, "withdraw"));
  app.post("/api/admin/budgets/lines/:id/restore", (req, res) => flip(req, res, "restore"));

  // ── Reading (R23) ─────────────────────────────────────────────────────────

  app.get("/api/budgets", async (req, res) => {
    const who = await member(req, res);
    if (!who) return;
    const moonId = typeof req.query?.moon === "string" && req.query.moon ? String(req.query.moon) : currentCycle().id;
    const moon = moonPeriod(moonId, villageTimezone());
    if (!moon) return res.status(400).json({ error: "bad_moon", message: "Name a moon by its id, like the one the moon review shows." });
    const pool = getPool();
    const all = await budgetLines(pool);
    const figure = await cashBudgetLeft(pool, moonId);
    // Committed and spent below the village total come from `cash_owed`, which is holder-only (R23).
    const mayReadCash = hasCapability("cash.pay", who.ctx);
    const span = { id: moonId, startsOn: moon.startsOn, endsOn: moon.endsOn, days: moon.days };
    const touching = all.filter((l) => sharedDays(l, span) > 0);
    const village = String(projectCurrency() ?? "").trim().toUpperCase();
    const sourceTotals: Record<string, Record<string, number>> = {};
    for (const l of touching) {
      if (l.status === "withdrawn" || l.status === "draft" || !CASH_CATEGORIES.includes(l.category) || l.currency !== village) continue;
      const bySource = (sourceTotals[l.source] = sourceTotals[l.source] ?? {});
      bySource[l.category] = (bySource[l.category] ?? 0) + lineShareOfMoon(l, span).countedMinor;
    }
    const door = await budgetDoor(who.user, who.ctx);
    res.json({
      moon: span,
      villageCurrency: village || null,
      stateRevision: stateRevision(all),
      lines: touching.map((l) => lineView(l, mayReadCash)),
      figure: figure
        ? { ...figure, working: { ...figure.working, committed: mayReadCash ? figure.working.committed : null } }
        : null,
      sourceTotals,
      syncs: await latestSyncs(pool),
      mayReadCash,
      door: door.ok ? { mayWrite: true, via: door.via } : { mayWrite: false, code: door.body.code, message: door.body.error, suggest: door.body.suggest ?? null },
    });
  });

  // ── The suggestion control (R22) ──────────────────────────────────────────

  /*
   * A member's suggested change to the budget is the same import the direct
   * routes take. Accept (a holder) and a carried vote both apply it through
   * `importBudgetLines`, bound to the budget state the suggestion was made on,
   * applied whole or not at all, and an Accept by a holder seated in a role
   * the change touches is refused, so the village decides it.
   */
  registerAdminEditControl("budget_lines", {
    read: async () => {
      const all = await budgetLines(getPool());
      const version = stateRevision(all);
      return { value: { revision: version, lines: all.filter((l) => l.status !== "withdrawn").length }, version };
    },
    problem: suggestionProblem,
    apply: async (payload, was, by): Promise<{ ok: true } | Refusal> => {
      const p = payload as SuggestedImport;
      const village = !by || by.decidedBy.startsWith("village:");
      const base: ImportInput = {
        source: p.source,
        lines: p.lines,
        scope: p.scope ?? null,
        by: village ? null : by!.decidedBy,
        byAs: village ? BY_VILLAGE_VOTE : actingAs(by!.decidedBy),
        dryRun: true,
        format: formatOf(p.format),
      };
      const preview = await importBudgetLines(getPool(), base);
      if (!preview.ok) return { ok: false, status: preview.status, body: { error: preview.message, code: preview.code } };
      if (preview.stateRevision !== was) {
        return { ok: false, status: 409, body: { error: "The budget changed since this suggestion was made. Suggest it again on the budget as it is now.", code: "stale" } };
      }
      if (preview.refused.length || preview.held.length) {
        return { ok: false, status: 400, body: { error: "Some rows of this suggestion can no longer be read as written, so nothing was applied. Suggest it again.", code: "payload_refused", refused: preview.refused, held: preview.held } };
      }
      if (!village) {
        const seated = new Set(await seatedRoleIds(by!.decidedBy));
        if (rolesTouched(preview).some((id) => seated.has(id))) return { ok: false, status: 409, body: { error: PAYEE_CONFLICT, code: "payee_conflict" } };
      }
      const done = await importBudgetLines(getPool(), { ...base, dryRun: false, stateRevision: was });
      if (!done.ok) return { ok: false, status: done.status, body: { error: done.message, code: done.code } };
      return { ok: true };
    },
    describe: async (payload) => {
      const p = payload as SuggestedImport;
      if (suggestionProblem(payload)) return ["The suggested lines cannot be read."];
      const r = await importBudgetLines(getPool(), { source: p.source, lines: p.lines, scope: p.scope ?? null, by: null, byAs: null, dryRun: true, format: formatOf(p.format) });
      const money = (minor: number, cur: string) => formatMoney(minor, cur);
      const out = [
        ...r.added.map((a) => `Adds "${a.label}", ${money(a.plannedMinor, a.currency)}, for ${a.periodKey}.`),
        ...r.changed.filter((c) => c.op !== "withdraw").map((c) => `Changes "${c.before.label}" from ${money(c.before.plannedMinor, c.before.currency)} to ${money(c.plannedMinor, c.currency)}.`),
        ...r.withdrawn.map((label) => `Withdraws "${label}".`),
        ...r.refused.map((x) => `Row ${x.row} cannot be read: ${x.message}`),
      ];
      return out.length ? out : ["Nothing differs from the budget as it stands."];
    },
  });
}

interface SuggestedImport {
  source: "upload" | "manual";
  lines: ImportRow[];
  scope?: ImportScope | null;
  format?: NumberFormatChoice;
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
  return Array.isArray(raw) ? raw.filter((x) => typeof x === "string").map((x) => String(x).slice(0, 64)) : undefined;
}

function circlesOf(raw: unknown): Array<string | null> | undefined {
  return Array.isArray(raw) ? raw.filter((x) => x === null || typeof x === "string").map((x) => (x === null ? null : String(x).slice(0, 120))) : undefined;
}

/** One line as a member reads it: never an account id, and spent only for `cash.pay` (R23, R25). */
function lineView(l: StoredLine, mayReadCash: boolean) {
  return {
    id: l.id,
    label: l.label,
    note: l.note,
    source: l.source,
    sourceLabel: l.sourceLabel,
    periodKind: l.periodKind,
    periodKey: l.periodKey,
    startsOn: l.startsOn,
    endsOn: l.endsOn,
    circleId: l.circleId,
    roleId: l.roleId,
    matched: l.matched,
    category: l.category,
    plannedMinor: l.plannedMinor,
    spentMinor: mayReadCash ? l.spentMinor : null,
    currency: l.currency,
    status: l.status,
    adopted: !!l.adoptedAt,
    adoptedAs: l.adoptedAs,
    changedAt: l.changedAt,
    changedAs: l.changedAs,
  };
}
