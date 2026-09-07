/**
 * WHAT A CIRCLE HAS LEFT, READ AT AN INSTANT.
 *
 *   GET /api/resources/burn
 *
 * One route, in its own module. `server/lib/circleBurn.ts` holds the ledger
 * read and the windows, `shared/circleBurn.ts` holds the shape of the answer
 * and the sentences, and this file holds only the translation between an HTTP
 * query and those two.
 *
 * IT MOUNTS BEHIND requireModule("resources"), which server/index.ts installs
 * on the /api/resources prefix before this module's register() is called. The
 * module ships OFF, and while it is off this path is a 404. Nothing here
 * re-checks that and nothing here should: one place decides, and it is
 * upstream.
 *
 * THAT 404 IS THE FIRST OF THE FOUR EMPTY STATES and it is the one this route
 * cannot answer in words, because a 404 carries no body a member reads. The
 * sentence for it lives in `burnSentence` in shared/circleBurn.ts and the
 * client renders it from a `{ kind: "module_off" }` reading it builds itself.
 * That is why the sentence is in `shared` and not here.
 *
 * SIGNED IN ONLY. `GET /api/resources` serves strangers a public tier when
 * `map.public_structure` is on, and that tier deliberately carries no budgets.
 * What a circle has already issued is a tighter fact than what it declared it
 * may issue, so this route has no public tier at all.
 *
 * NOTHING HERE WRITES. There is no tap in this build: no route mints against a
 * circle budget, and this one only reads.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { burnFor, type CircleEnvelope, type SeasonSpan } from "../lib/circleBurn";
import { burnSentence, type BurnWords, type CircleBurnReading } from "../../shared/circleBurn";
// `treasuryTokenFor` is the ONE definition of "which token is this unit", in
// the library, because three routes and the circle-status hook all need it.
import { circleStatusReader, treasuryTokenFor as tokenTypeFor } from "../lib/circleTreasury";
import { amountWords, listBudgets } from "../lib/resources";
import { tokenDef } from "../lib/ledger";
import { clockModeNow } from "../lib/circleBonusGate";

type Deps = Pick<AppDeps, "getPool" | "authedUser"> & {
  /** The village's circles, for names. Read, never written here. */
  circlesRepo: { all(): unknown[] };
  /** The dated season calendar and the zone it turns in. */
  seasonState(): { seasons?: unknown[]; timezone?: string };
};

export function register(app: Express, deps: Deps): void {
  const { getPool, authedUser, circlesRepo, seasonState } = deps;

  app.get("/api/resources/burn", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to read what a circle has left" });

    /*
     * THE INSTANT IS A PARAMETER AND THE DEFAULT IS ONLY A DEFAULT.
     *
     * A member reading a circle page wants now. A ballot card wants the
     * instant its proposal LANDS, which for a Game change is the later of the
     * next cycle boundary after the ballot closes and the close plus the veto
     * window (`landingFor`, shared/governanceKinds.ts). Those are different
     * questions and a route that only answered the first would make the
     * ballot surface shift the window itself, which is a second copy of the
     * arithmetic in server/lib/circleBurn.ts.
     */
    const at = parseInstant(req.query.at);
    if (!at) return res.status(400).json({ error: "at must be an ISO instant" });

    const plus = Math.max(0, Math.trunc(Number(req.query.plus ?? 0) || 0));
    const unit = req.query.unit ? String(req.query.unit) : undefined;
    const only = req.query.circleId ? String(req.query.circleId) : null;

    const pool = getPool();
    const budgets = await listBudgets(pool);
    const envelopes: CircleEnvelope[] = budgets.map((b) => ({
      circleId: b.circleId,
      unit: b.unit,
      seasonCapMinor: b.amountMinor,
      cycleCapMinor: b.cycleAmountMinor,
      seasonId: b.seasonId,
      // 0181: which model, and the change queued against it. `burnFor` decides
      // which one is RUNNING at the instant asked for; this only carries both.
      mode: b.mode,
      pending: b.pending,
      dormant: b.dormant,
    }));

    const season = seasonState();
    const seasons = (Array.isArray(season.seasons) ? season.seasons : []) as SeasonSpan[];
    const timeZone = String(season.timezone || "UTC");

    /*
     * `cycle.mode` IS READ HERE AND NOT AT BOOT. Anything reading a game
     * variable while the server starts reads the platform default, because
     * the stores have not loaded yet. A village that keeps calendar months
     * would then be metered against lunations it does not use.
     *
     * IT IS READ THROUGH `clockModeNow` BECAUSE THE KEY DOES NOT EXIST YET.
     * `shared/cycleClock.ts` names `cycle.mode` in `CYCLE_SETTING_READERS` as
     * the key the rhythm dial publishes, and `shared/gameVariables.ts` does
     * not declare it on this tree. `variable()` throws on a key it does not
     * know, on purpose, so `stringVar("cycle.mode")` here threw `Unknown game
     * variable: cycle.mode` on every request, before this handler read
     * anything. `client/src/components/power/ResourcesPanel.tsx` fetches this
     * route on mount, so the member-facing panel got nothing at all.
     * `server/routes/circleBurn.test.ts` is the control that keeps it fixed.
     */
    const clockMode = clockModeNow();

    const words = burnWords(circlesRepo);
    /*
     * A CIRCLE'S STATUS IS READ FROM THE REPO AND NEVER DEFAULTED (0181).
     *
     * A circle this route cannot find is reported `dormant` and not `active`.
     * The reading uses the status to decide whether a treasury balance is a
     * live one, and the conservative direction for an unknown circle is the
     * one that says "held, not spendable", because the opposite invites a
     * spend against a circle nobody could name.
     */
    const circleStatusFor = circleStatusReader(circlesRepo);
    const targets = only ? [only] : distinct(envelopes.map((e) => e.circleId));

    const readings: Array<CircleBurnReading & { sentence: string }> = [];
    for (const circleId of targets) {
      const reading = await burnFor(
        { circleId, at, plus, unit },
        {
          conn: pool,
          moduleOn: true,
          envelopes,
          clockMode,
          seasons,
          timeZone,
          tokenTypeFor,
          circleStatusFor,
        },
      );
      readings.push({ ...reading, sentence: burnSentence(reading, words) });
    }

    res.json({ at: at.toISOString(), clock: clockMode, timeZone, plus, readings });
  });
}

function burnWords(circlesRepo: { all(): unknown[] }): BurnWords {
  const circles = circlesRepo.all() as Array<{ id?: string; name?: string }>;
  return {
    circleName: (id: string) => String(circles.find((c) => c?.id === id)?.name ?? id),
    amount: (minor: number, unit: string) =>
      amountWords(minor, unit, (slug: string) => {
        const d = tokenDef(slug);
        return d ? { name: d.name, decimals: d.decimals } : undefined;
      }),
  };
}

/** An ISO instant, or now when none was asked for, or null when it is junk. */
function parseInstant(raw: unknown): Date | null {
  if (raw === undefined || raw === null || String(raw) === "") return new Date();
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

function distinct(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
