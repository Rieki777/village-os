/**
 * WHETHER A CIRCLE'S PERIOD CAN BE JUDGED, READ AT AN INSTANT.
 *
 *   GET /api/resources/completion?circleId=&periodId=&at=
 *
 * One route, in its own module. `server/lib/circleBonusGate.ts` holds the
 * ballot lookup, `shared/circleBonusGate.ts` holds the shape and the
 * sentences, and this file holds the translation between an HTTP query and
 * those two.
 *
 * IT MOUNTS BEHIND requireModule("resources"), which server/index.ts installs
 * on the /api/resources prefix before this module's register() runs. The
 * module ships OFF, and while it is off this path is a 404. Nothing here
 * re-checks that.
 *
 * SIGNED IN ONLY, for the reason `server/routes/circleBurn.ts` gives about the
 * same data: what a circle has already issued is a tighter fact than what it
 * declared it may issue, and this route carries that plus a village's answer
 * about that circle's work.
 *
 * ── THIS ROUTE PAYS NOTHING AND AUTHORISES NOTHING ─────────────────────────
 *
 * It is a GET. It moves no value, opens no ballot and writes no row. The
 * payload carries three components and a list of refusals, and a village
 * decides. See the shared header for why an automatic payout was refused
 * instead of guarded.
 *
 * ── WHERE THE COMMITMENT READER COMES FROM, AND WHY IT FINDS NOTHING ───────
 *
 * `commitmentFor` is wired to `noCommitmentOnRecord` below, which is the one
 * place this build says out loud that no table stores what a circle took on.
 * That was measured across all 167 tables of a migrated schema:
 * `circle_budgets` is the only table carrying both a circle and a period, and
 * what it holds is an amount, a unit and a 500-character note. A note is a
 * label on an envelope and it is not a commitment, so reading one as a
 * commitment would manufacture a record the village never wrote.
 *
 * The day a village records one, this line changes and nothing else does.
 *
 * ── THE ENVELOPE MAPPING IS A SECOND COPY, AND IT IS NAMED ─────────────────
 *
 * The twelve lines that turn `listBudgets` rows into `CircleEnvelope` also
 * live in `server/routes/circleBurn.ts`. Both read the same lib function, so
 * the shared seam is `listBudgets` and what is duplicated is the field
 * renaming. Factoring it out would mean editing that route while another lane
 * is extending the meter for treasuries, so it is copied and said here.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { bonusGateFor, clockModeNow } from "../lib/circleBonusGate";
import {
  BLIND_SPOT,
  circleRollProblem,
  commitmentSentence,
  ELECTORATE_UNDECIDED,
  spendSentence,
  voteSentence,
  type CommitmentRecord,
  type CompletionElectorate,
  type GateWords,
} from "../../shared/circleBonusGate";
import { burnFor, type CircleEnvelope, type SeasonSpan } from "../lib/circleBurn";
import { circleStatusReader } from "../lib/circleTreasury";
import { amountWords, listBudgets } from "../lib/resources";
import { tokenDef } from "../lib/ledger";

const TOKEN_UNIT = /^token:([a-z0-9][a-z0-9-]{0,30})$/;

/**
 * The commitment reader this build ships: it finds nothing, every time.
 *
 * A STUB THAT RETURNS NULL AND A READER THAT SEARCHED AND FOUND NOTHING ARE
 * THE SAME ANSWER HERE, and the difference is only whether anybody knows. This
 * function exists so the absence has a name, a comment and one call site, so a
 * later lane replaces one line and every refusal in the reading starts
 * answering differently.
 */
async function noCommitmentOnRecord(): Promise<CommitmentRecord | null> {
  return null;
}

/** Why nothing can be judged yet, in the words a member reads. */
export const NO_COMMITMENT_STORE =
  "This village has nowhere to write down what a circle takes on for a period. Until it does, " +
  "a completion vote would be asking members to agree with a memory, so this reading refuses to " +
  "answer instead of guessing.";

type Deps = Pick<AppDeps, "getPool" | "authedUser"> & {
  /** The village's circles, for names. Read, never written here. */
  circlesRepo: { all(): unknown[] };
  /** The dated season calendar and the zone it turns in. */
  seasonState(): { seasons?: unknown[]; timezone?: string };
};

export function register(app: Express, deps: Deps): void {
  const { getPool, authedUser, circlesRepo, seasonState } = deps;

  app.get("/api/resources/completion", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to read how a circle's period stands" });

    const circleId = String(req.query.circleId ?? "").trim();
    if (!circleId) return res.status(400).json({ error: "circleId names the circle this answers about" });
    const periodId = String(req.query.periodId ?? "").trim();
    if (!periodId) return res.status(400).json({ error: "periodId names the period this answers about" });

    /*
     * THE INSTANT IS A PARAMETER AND THE DEFAULT IS ONLY A DEFAULT, the same
     * rule the burn route keeps. For a finished period this is the period's
     * end, because that is where the spend has to be read.
     */
    const at = parseInstant(req.query.at);
    if (!at) return res.status(400).json({ error: "at must be an ISO instant" });

    /*
     * THE ELECTORATE IS NAMED BY THE CALLER AND VALIDATED HERE. Only one value
     * can be served today, and the refusal carries the reason rather than a
     * bare 400: who votes on a circle's completion has not been decided, and a
     * caller asking for the circle-scoped roll is asking for something this
     * codebase deliberately removed.
     */
    const wanted = String(req.query.electorate ?? "village");
    if (wanted !== "village" && wanted !== "circle") {
      return res.status(400).json({ error: "electorate is village or circle", ruling: ELECTORATE_UNDECIDED });
    }
    const electorate = wanted as CompletionElectorate;
    const rollProblem = circleRollProblem(electorate);
    if (rollProblem) {
      return res.status(400).json({ error: rollProblem, ruling: ELECTORATE_UNDECIDED });
    }

    const pool = getPool();
    const budgets = await listBudgets(pool);
    const envelopes: CircleEnvelope[] = budgets.map((b) => ({
      circleId: b.circleId,
      unit: b.unit,
      seasonCapMinor: b.amountMinor,
      cycleCapMinor: b.cycleAmountMinor,
      seasonId: b.seasonId,
      // 0181: which model the circle runs on, the change queued against it,
      // and what it held when it last went dormant. `burnFor` decides which
      // model is RUNNING at the instant asked for; this only carries them.
      mode: b.mode,
      pending: b.pending,
      dormant: b.dormant,
    }));

    const season = seasonState();
    const seasons = (Array.isArray(season.seasons) ? season.seasons : []) as SeasonSpan[];
    const timeZone = String(season.timezone || "UTC");
    /*
     * READ HERE AND NOT AT BOOT. Anything reading a game variable while the
     * server starts reads the platform default. `clockModeNow` also survives a
     * tree where the rhythm dial has not landed; its own comment says what
     * that costs the burn route today.
     */
    const clockMode = clockModeNow();

    const reading = await bonusGateFor(
      { circleId, periodId, at },
      {
        conn: pool,
        commitmentFor: noCommitmentOnRecord,
        burnFor: (id, instant) =>
          burnFor(
            { circleId: id, at: instant },
            {
              conn: pool, moduleOn: true, envelopes, clockMode, seasons, timeZone, tokenTypeFor,
              // A circle this route cannot name reads dormant and never active:
              // a dormant circle's treasury has been swept, so the conservative
              // answer is the one that does not imply a live balance.
              circleStatusFor: circleStatusReader(circlesRepo),
            },
          ),
        electorate,
      },
    );

    const words = gateWords(circlesRepo);
    res.json({
      ...reading,
      clock: clockMode,
      timeZone,
      sentences: {
        commitment: commitmentSentence(reading.commitment, words, circleId),
        vote: voteSentence(reading.vote, words, circleId),
        spend: spendSentence(reading.spend, words, circleId),
      },
      /*
       * BOTH OF THESE RIDE EVERY RESPONSE AND NEITHER IS CONDITIONAL. The
       * blind spot is what the reading cannot see about a circle whose work is
       * care; `noCommitmentStore` is what this build cannot see about any
       * circle at all. A surface that dropped either would be presenting a
       * partial reading as a whole one.
       */
      blindSpot: BLIND_SPOT,
      noCommitmentStore: NO_COMMITMENT_STORE,
      ruling: ELECTORATE_UNDECIDED,
    });
  });
}

/** Which ledger token an envelope's unit is denominated in. Null is not a zero. */
function tokenTypeFor(unit: string): string | null {
  const m = TOKEN_UNIT.exec(String(unit ?? ""));
  if (!m) return null;
  return tokenDef(m[1]) ? m[1] : null;
}

function gateWords(circlesRepo: { all(): unknown[] }): GateWords {
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
