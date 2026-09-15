/**
 * THE TEST RUN, moved off the admin shelf (R12).
 *
 * Rye: "any member as all members may suggest upgrades and will need to run
 * models and tests."
 *
 * The run itself is unchanged and lives where it always did, in
 * `server/lib/dryRun.ts`: it takes a snapshot, walks the moons forward, and
 * returns a report. It opens no connection and writes no row. What moved is
 * the DOOR. `POST /api/admin/dry-run` refused every signed-in member with
 * `auth_required`, so the one tool that answers "would these settings work"
 * was reachable only by the two people least likely to be surprised by the
 * answer. A member who is about to be asked to vote the village's Game on had
 * no way to check it first.
 *
 * ── ONE DOOR, NOT TWO ───────────────────────────────────────────────────────
 *
 * The admin route is deleted, not kept beside this one. Two routes onto one
 * computation is two places for a gate to drift, and the founder's ruling does
 * not carve out a founder's copy. An admin signs in and presses the same
 * button on the same page; what they get back is wider, and the paragraph
 * below says exactly how much wider and why.
 *
 * ── WHAT A MEMBER'S REPORT LEAVES OUT ───────────────────────────────────────
 *
 * Two facts about a village are the founding team's working state and not yet
 * the village's rules:
 *
 *   a rule that is SWITCHED OFF. It pays nobody and it is not what this
 *   village does. It may be a draft, an abandoned idea, or a lever somebody
 *   turned down last moon.
 *
 *   a QUEUED CHANGE. `mint_rules` carries four `pending_*` columns that an
 *   admin fills from the Mint panel, and until the moon they name arrives the
 *   change has not happened. A member reading it would be reading a decision
 *   nobody has announced.
 *
 * Neither is a secret worth a lock, and neither belongs in the answer to "what
 * does my village do". So the member's snapshot drops both, through
 * `audience: "member"` in `server/lib/dryRun.ts`, and the admin's snapshot is
 * exactly what it has always been. Everything else in the report is the same
 * for both: the dials, the enabled rules, the allowance table, the jobs, the
 * refusals. `/api/game/mechanics` already answers a stranger with this
 * village's mechanics, so an enabled rule's amount is not new to anybody.
 *
 * THE ADMIN VARIANT IS A WIDER VIEW OF ONE ROUTE, never a second route. It is
 * kept because the founder asked for it by name: a queued change and the moon
 * it lands in is R86's own feature, and the Mint panel is where a founder
 * queues one. Deleting it here would take a shipped answer away from the
 * person who needs it most.
 *
 * ── WHY A RATE LIMIT, AND WHY IT IS PER PERSON ──────────────────────────────
 *
 * Every run costs three reads and up to forty turns of arithmetic. That was
 * fine while two accounts could reach it. Opened to the roll it is a button
 * any member can hold down, so each person gets their own hourly budget,
 * keyed on their user id. Keying on the address instead would have punished a
 * whole village behind one router, and would have let one member with two
 * networks spend twice.
 *
 * The guard fails open on a database outage, like every other one here: an
 * unreachable `rate_hits` table must not take the tool down.
 */
import type { Express } from "express";
import { MODULES } from "../../shared/modules";
import type { AppDeps } from "../lib/appDeps";
import { dryRun, MAX_MOONS } from "../lib/dryRun";
import { villageId } from "../lib/economy";
import { readGameStart } from "../lib/gameStart";
import { effectiveLifecycle } from "../lib/modules";
import { registeredJobs } from "../lib/scheduler";
import { moonOneCycle } from "../lib/villageMoon";

/**
 * One person's budget, and the window it slides over.
 *
 * Twenty an hour is far more than a person pressing a button wants and far
 * less than a loop. Exported so a test asserts against the number the route
 * actually uses; a test that restated it would keep passing on the day it
 * changed.
 */
export const RUNS_PER_WINDOW = 20;
export const RUN_WINDOW_MS = 60 * 60 * 1000;

type Deps = Pick<AppDeps, "authedUser" | "isAdmin" | "overLimit" | "getPool">;

export function register(app: Express, deps: Deps): void {
  const { authedUser, isAdmin, overLimit, getPool } = deps;

  /**
   * THE TEST RUN (R86, R12). Turn the village's cycles over quickly and read
   * what the settings would do.
   *
   * READS ONLY, and that is the whole design. `server/lib/dryRun.ts` carries
   * the reasoning; the short version is that R81 puts all minting behind
   * governance and R67 shuts issuance until the launch vote carries, so a run
   * that wrote would either meet the gate and teach the reader nothing, or
   * route around the gate and remove it. This route reads five facts and hands
   * them to a function that takes no pool.
   *
   * It is allowed on a village that has ALREADY started its Game, deliberately.
   * There is no accident available: nothing here can write, so anybody
   * checking what a dial change would do to next season is welcome to it. The
   * report says which of the two villages it was looking at.
   */
  app.post("/api/dry-run", async (req, res) => {
    const user = await authedUser(req);
    if (!user) {
      return res.status(401).json({
        error: "auth_required",
        message: "The test run reads this village's own settings, so it asks who you are first. Sign in and run it again.",
      });
    }

    // A length the caller asked for, or a refusal. A silent clamp would answer
    // a question nobody put, and the number is on the report.
    const asked = Number(req.body?.moons);
    if (!Number.isFinite(asked) || !Number.isInteger(asked) || asked < 1 || asked > MAX_MOONS) {
      return res.status(400).json({
        error: "bad_request",
        message: `A test run covers between 1 and ${MAX_MOONS} moons. You asked for ${req.body?.moons}.`,
      });
    }

    /*
     * The budget is spent BEFORE the reads, so a member who has run out costs
     * this server one INSERT and no village state at all.
     */
    if (await overLimit(`dry-run:${user.id}`, RUNS_PER_WINDOW, RUN_WINDOW_MS)) {
      return res.status(429).json({
        error: "too_many",
        message:
          `A test run reads every rule and dial this village holds, so each person may ask for ${RUNS_PER_WINDOW} ` +
          "of them an hour. You have used this hour's worth. The count slides, so the oldest of your runs " +
          "falls out of it within the hour and the button works again.",
      });
    }

    // Whether the wider view is owed. `isAdmin` marks the request as gated,
    // which is harmless outside /api/admin and is the contract every gate
    // helper keeps (server/lib/adminGate.ts).
    const wide = await isAdmin(req);

    const start = await readGameStart(getPool());
    const [seats] = await getPool().query<any[]>(
      "SELECT COUNT(*) AS n FROM `org_role_assignments` " +
        "WHERE `active_holder_key` IS NOT NULL AND `holder_kind` = 'member' AND `user_id` IS NOT NULL AND `is_example` = 0",
    );
    const [ruleRows] = await getPool().query<any[]>(
      "SELECT * FROM `mint_rules` WHERE `village_id` = ? ORDER BY `trigger`, `token_slug`",
      [villageId()],
    );

    const report = dryRun(
      {
        gameStarted: start.started,
        startedAt: start.startedAt,
        seatCount: Number(seats[0]?.n ?? 0),
        rules: ruleRows.map((r) => ({
          id: String(r.id),
          trigger: String(r.trigger),
          tokenSlug: String(r.token_slug),
          amount: r.amount === null || r.amount === undefined ? null : Number(r.amount),
          ceiling: Number(r.ceiling ?? 0),
          enabled: !!r.enabled,
          effectiveFromCycle: Number(r.effective_from_cycle ?? 0),
          pending:
            r.pending_from_cycle === null || r.pending_from_cycle === undefined
              ? null
              : {
                  amount: r.pending_amount === null || r.pending_amount === undefined ? null : Number(r.pending_amount),
                  ceiling: Number(r.pending_ceiling ?? 0),
                  enabled: !!r.pending_enabled,
                  fromCycle: Number(r.pending_from_cycle),
                },
        })),
        jobs: registeredJobs(),
        modulesOff: MODULES.filter((m) => effectiveLifecycle(m.id) === "off").map((m) => ({ id: m.id, name: m.name })),
      },
      { moons: asked, audience: wide ? "admin" : "member", moonOneCycle: await moonOneCycle(getPool()) },
    );
    res.json(report);
  });
}
