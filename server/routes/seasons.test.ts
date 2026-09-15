/**
 * The season save, through the real registration and the real handler body.
 *
 * `register` is called against a fake Express that records handlers by method
 * and path, the shape `server/routes/circleBonusGate.test.ts` uses. The season
 * document is the real `dbDocument` store on a scratch schema, so what the
 * route stores is read back from the `app_config` row itself.
 *
 * Two changes met in this handler and each could quietly undo the other:
 *   - the save stores `seasonDocumentToStore`'s decision, so an empty list and
 *     the derived list the Season tab was shown both store `seasons: []`, and an
 *     unknown zone is refused in words (server/lib/seasonCalendar.ts);
 *   - the save then moves every seat that follows its season onto the calendar
 *     as it now stands (`restampSeatsToCalendar`).
 * A stored [] derives its seasons on read, so it must still reach the move, and
 * a derived season id must be the same on every read or following seats stop
 * matching their season.
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionTestDb, testDbConfigured, type TestDb } from "../db/testDb";
import { dbDocument } from "../repos/store-db";
import { GAME_CONFIG } from "../../shared/gameConfig";
import { civilDateInstant } from "../../shared/seatTerms";
import { normalizeSeasonConfig } from "../lib/seasonCalendar";
import { register } from "./seasons";

const configured = testDbConfigured();
if (!configured) {
  // eslint-disable-next-line no-console
  console.warn("[seasons.routes.test] TEST_DATABASE_URL not set. The season save is UNCHECKED here.");
}

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

/** A fake Express that keeps the handlers `register` hands it. */
function collect(): { app: any; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (p: string, handler: Handler) => {
    handlers.set(`${method} ${p}`, handler);
  };
  return {
    app: { get: record("GET"), post: record("POST"), put: record("PUT"), delete: record("DELETE") },
    handlers,
  };
}

/** Captures what a handler answered. */
function makeRes() {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
  };
  return { res, out };
}

interface Holding {
  id: string;
  roleId: string;
  userId: string;
  seasonId: string | null;
  termEndsAt: Date | null;
  termFollowsSeason: boolean;
}

describe.skipIf(!configured)("PUT /api/admin/seasons", () => {
  let db: TestDb;
  let pool: mysql.Pool;
  let repo: ReturnType<typeof dbDocument>;
  let handlers: Map<string, Handler>;
  const holdings: Holding[] = [];
  const written: Array<{ id: string; to: Date }> = [];
  const notices: Array<{ userId: string; dedupeKey: string }> = [];

  const rowValue = async (): Promise<any> => {
    const [rows] = await pool.query<any[]>("SELECT value FROM app_config WHERE config_key = 'season'"); // module-review-ok: fixture SQL against the S5 scratch schema, never a production table
    const v = rows[0]?.value;
    return typeof v === "string" ? JSON.parse(v) : v;
  };

  /** `seasonState` in miniature: the dated list, the running season and the zone, off the stored document. */
  const seasonState = () => {
    const cfg = normalizeSeasonConfig(repo.get());
    const today = new Date().toISOString().slice(0, 10);
    const sorted = cfg.seasons.filter((s) => s.startsOn).sort((a, b) => a.startsOn.localeCompare(b.startsOn));
    const running = sorted.filter((s) => s.startsOn <= today && (!s.endsOn || today < s.endsOn));
    const current = running.length ? running[running.length - 1] : null;
    return { current, seasons: sorted, cadence: cfg.cadence, timezone: cfg.timezone, needsNextSeason: false };
  };

  async function put(body: unknown) {
    const handler = handlers.get("PUT /api/admin/seasons");
    if (!handler) throw new Error("the season save did not register");
    const { res, out } = makeRes();
    await handler({ body }, res);
    return out;
  }

  beforeAll(async () => {
    db = await provisionTestDb();
    pool = mysql.createPool({ uri: db.url, timezone: "Z", connectionLimit: 2 }); // module-review-ok: the S5 scratch-schema harness pool
    repo = dbDocument(pool, "season", GAME_CONFIG.season as any);
    await repo.load();
    const { app, handlers: h } = collect();
    handlers = h;
    register(app, {
      isAdmin: async () => true,
      adminActor: () => ({ id: "admin-1" }),
      getPool: () => pool,
      notify: async (n: { userId: string; dedupeKey: string }) => {
        notices.push(n);
      },
      seasonState,
      getSeasonConfig: () => normalizeSeasonConfig(repo.get()),
      seasonRepo: repo,
      addActivity: async () => {},
      loadRoles: () => [{ id: "role-steward", name: "Steward" }],
      permissionHoldings: () => holdings,
      writePermissionTerms: async (moves: ReadonlyArray<{ id: string; to: Date }>) => {
        for (const m of moves) {
          written.push({ id: m.id, to: m.to });
          const held = holdings.find((x) => x.id === m.id);
          if (held) held.termEndsAt = m.to;
        }
      },
    } as any);
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it("stores an empty list as [], and still moves a seat that follows a derived season", async () => {
    const shown = normalizeSeasonConfig(repo.get());
    const season = shown.seasons[1];
    expect(season?.endsOn).toBeTruthy();
    const seasonEnd = civilDateInstant(season.endsOn, shown.timezone)!;
    // The seat's stored end is a day off its season's, as it would be after the season moved.
    holdings.push({
      id: "hold-1",
      roleId: "role-steward",
      userId: "member-1",
      seasonId: season.id,
      termEndsAt: new Date(seasonEnd.getTime() + 86_400_000),
      termFollowsSeason: true,
    });

    const out = await put({ seasons: [], cadence: shown.cadence, timezone: shown.timezone });

    expect(out.status).toBe(200);
    expect(out.body.success).toBe(true);
    expect((await rowValue()).seasons).toEqual([]);
    expect(out.body.seatsMoved).toEqual({ permission: 1, org: 0 });
    expect(written).toEqual([{ id: "hold-1", to: seasonEnd }]);
    expect(notices.map((n) => n.userId)).toEqual(["member-1"]);
    expect(notices[0].dedupeKey.startsWith("seat-restamp:hold-1:")).toBe(true);
  });

  it("stores the derived list it was shown as [], and moves nothing twice", async () => {
    const shown = normalizeSeasonConfig(repo.get());
    const out = await put({ seasons: shown.seasons, cadence: shown.cadence, timezone: shown.timezone });

    expect(out.status).toBe(200);
    expect((await rowValue()).seasons).toEqual([]);
    expect(out.body.seatsMoved).toEqual({ permission: 0, org: 0 });
    expect(written).toHaveLength(1);
  });

  it("refuses a zone this server cannot format, in words, and stores nothing", async () => {
    const before = await rowValue();
    const out = await put({ seasons: [], cadence: "quarterly", timezone: "Bogus/Zone" });

    expect(out.status).toBe(400);
    expect(out.body.error).toContain("is not a timezone this server knows");
    expect(await rowValue()).toEqual(before);
    expect(written).toHaveLength(1);
  });

  it("gives a derived season the same id on every read of the same stored document", async () => {
    const at = new Date("2026-09-14T12:00:00Z");
    // A broken zone can only arrive from an older release; the fallback must still be one fixed zone.
    await repo.put({ seasons: [], cadence: "quarterly", timezone: "Bogus/Zone" } as any);
    const first = dbDocument(pool, "season", GAME_CONFIG.season as any);
    await first.load();
    const second = dbDocument(pool, "season", GAME_CONFIG.season as any);
    await second.load();
    const ids = (d: ReturnType<typeof dbDocument>) => normalizeSeasonConfig(d.get(), at).seasons.map((s) => s.id);

    expect(ids(first).length).toBeGreaterThan(0);
    expect(ids(first)).toEqual(ids(second));
    expect(ids(first)).toEqual(ids(first));
    expect(ids(first)[0]).toMatch(/^season-\d{4}-\d{2}-\d{2}$/);
  });
});
