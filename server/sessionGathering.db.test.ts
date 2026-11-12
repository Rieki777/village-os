/**
 * "I'll be there" for a circle's next meeting, against a real schema (Phase C,
 * the Gathering; server/lib/sessionGathering.ts).
 *
 * The lead's decision: reuse the gatherings' own `going` answer, and add a
 * table only if a session cannot map to a gathering. It can. A circle's rhythm
 * is mirrored onto the village calendar as one recurring gathering, so its
 * next meeting is one evening of it, and this suite proves the three links:
 *
 *   1. Coming up names that gathering and that evening, and the evening is a
 *      real one of the calendar's own expansion (occurrenceOf finds it).
 *   2. An answer written through the gatherings' own `rsvp()` (the door
 *      `POST /api/events/:id/rsvp` calls) fills the row: the count, whether
 *      it is the viewer's own, and first names, alphabetical, only for the
 *      circle's own members and admins.
 *   3. While the events module is off, nothing is offered: the door the
 *      button would use is closed.
 *
 * No TEST_DATABASE_URL and the suite skips (harness rule).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type mysql from "mysql2/promise";
import {
  provisionTestDb,
  testDbConfigured,
  testPool,
  type TestDb,
} from "./db/testDb";
import { loadModuleSettings } from "./lib/modules";
import { calendarIdFor, getCalendarRow, occurrenceOf } from "./lib/calendar";
import { rsvp, withdrawRsvp } from "./lib/gatherings";
import { villageTimezone } from "./lib/villageReaders";
import { register as registerRoom } from "./routes/liveSessions";
import { register as registerLibrary } from "./routes/sessionLibrary";
import { register as registerRhythm } from "./routes/sessionRhythm";
import { register as registerCalendar } from "./routes/sessionCalendar";
import { usersRepo } from "./repos/users";
import { MIRROR_SOURCE } from "../shared/sessionCalendar";
import type { ComingUpRow } from "../shared/sessionRhythm";

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

function collect(): { app: any; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (p: string, handler: Handler) => {
    handlers.set(`${method} ${p}`, handler);
  };
  return {
    app: {
      get: record("GET"),
      post: record("POST"),
      put: record("PUT"),
      patch: record("PATCH"),
      delete: record("DELETE"),
      use: () => undefined,
    },
    handlers,
  };
}

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
    type: () => res,
    send(body: unknown) {
      out.body = body;
      return res;
    },
    setHeader: () => undefined,
    end: () => res,
  };
  return { res, out };
}

const PEOPLE: Record<string, any> = {
  "m-ana": {
    id: "m-ana",
    name: "Ana Reyes",
    email: "ana@village.example.test",
    membershipGranted: true,
  },
  "m-zoe": {
    id: "m-zoe",
    name: "Zoe Lind",
    email: "zoe@village.example.test",
    membershipGranted: true,
  },
  "m-ben": {
    id: "m-ben",
    name: "Ben Ortiz",
    email: "ben@village.example.test",
    membershipGranted: true,
  },
  "m-founder": {
    id: "m-founder",
    name: "Founding Admin",
    role: "admin",
    email: "founder@village.example.test",
  },
};

const DAY_MS = 86_400_000;
const configured = testDbConfigured();

describe.skipIf(!configured)(
  "I'll be there: a circle's next meeting is an evening of a gathering",
  () => {
    let db: TestDb;
    let pool: mysql.Pool;
    let handlers: Map<string, Handler>;
    let whoami: string | null = null;
    const CIRCLES = [
      { id: "c-garden", name: "Garden circle", status: "active" },
    ];
    const EVENT = calendarIdFor({
      sourceModule: MIRROR_SOURCE,
      sourceId: "c-garden",
    });

    const q = async (sql: string, params: unknown[] = []) =>
      (await pool.query<any[]>(sql, params))[0]; // module-review-ok: fixture SQL against the S5 scratch schema this suite provisioned, never a production table

    const as = async (who: string | null, key: string, req: any = {}) => {
      whoami = who;
      const handler = handlers.get(key);
      if (!handler) throw new Error(`no handler registered for ${key}`);
      const { res, out } = makeRes();
      await handler(
        { params: {}, body: {}, query: {}, headers: {}, ...req },
        res
      );
      return out;
    };
    const garden = async (who: string): Promise<ComingUpRow> => {
      const out = await as(who, "GET /api/sessions");
      expect(out.status, JSON.stringify(out.body)).toBe(200);
      const row = out.body.comingUp.rows.find(
        (r: ComingUpRow) => r.circleId === "c-garden"
      );
      expect(row).toBeTruthy();
      return row;
    };
    const eventsModule = async (value: string) => {
      await q("INSERT INTO `module_settings` (`module_id`, `lifecycle`) VALUES ('events', ?) ON DUPLICATE KEY UPDATE `lifecycle` = VALUES(`lifecycle`)", [value]); // module-review-ok: moves the events module in the scratch schema this suite provisioned, the way an admin would
      await loadModuleSettings(pool);
    };

    beforeAll(async () => {
      db = await provisionTestDb();
      pool = testPool(db, { connectionLimit: 4 });
      await q("INSERT INTO `module_settings` (`module_id`, `lifecycle`) VALUES ('sessions', 'members')"); // module-review-ok: turns Live Sessions on in the scratch schema this suite provisioned, since the mirror measures the module's state
      await eventsModule("members");
      for (const p of Object.values(PEOPLE))
        await usersRepo(pool).add({
          id: p.id,
          name: p.name,
          email: p.email,
          passwordHash: "x",
          paths: [],
        });
      const c = collect();
      const deps = {
        authedUser: async () =>
          whoami ? { ...(PEOPLE[whoami] ?? { id: whoami }), id: whoami } : null,
        isAdmin: async () => whoami === "m-founder",
        getPool: () => pool,
        overLimit: async () => false,
        members: { byId: async (id: string) => PEOPLE[id] ?? null },
        notify: async () => ({ fresh: true }),
        notifyAdmins: async () => undefined,
        circlesRepo: { all: () => CIRCLES },
        lapseContext: () => ({ currentSeasonId: null, cadence: "never" }),
        clientIp: () => "203.0.113.9",
        deploymentOrigin: () => "https://village.example.test",
        projectName: () => "Village",
      } as any;
      registerRoom(c.app, deps);
      registerLibrary(c.app, deps);
      registerRhythm(c.app, deps);
      registerCalendar(c.app, deps);
      handlers = c.handlers;
      const weekday = new Date(Date.now() + 2 * DAY_MS).getUTCDay();
      const set = await as(
        "m-founder",
        "PUT /api/sessions/circles/:circleId/rhythm",
        {
          params: { circleId: "c-garden" },
          body: { kind: "weekly", weekday, everyWeeks: 1, time: "18:00" },
        }
      );
      expect(set.status, JSON.stringify(set.body)).toBe(200);
    }, 240_000);

    afterAll(async () => {
      await pool?.end();
      await db?.drop();
    });

    it("names the mirrored gathering and an evening the calendar itself holds, with nobody coming yet", async () => {
      const row = await garden("m-ana");
      expect(row.gathering).toEqual({
        eventId: EVENT,
        occurrenceKey: row.next.key,
        going: 0,
        mine: false,
        names: [],
      });
      // The key is one of the calendar's own evenings of that gathering, not merely a well-formed date.
      const cal = await getCalendarRow(pool, EVENT);
      expect(cal).toBeTruthy();
      const occ = occurrenceOf(
        cal!,
        row.gathering!.occurrenceKey,
        villageTimezone()
      );
      expect(occ?.occurrenceKey).toBe(row.next.key);
      expect(occ?.startsAt.toISOString()).toBe(
        new Date(row.next.at).toISOString()
      );
    });

    it("fills from the gatherings' own going: a count for anybody, first names alphabetical for the circle's keepers", async () => {
      for (const who of ["m-zoe", "m-ana"]) {
        const out = await rsvp(
          pool,
          EVENT,
          who,
          "going",
          undefined,
          (await garden(who)).next.key
        );
        expect(out.ok, JSON.stringify(out)).toBe(true);
      }
      // A `maybe` is not "I'll be there".
      expect(
        (
          await rsvp(
            pool,
            EVENT,
            "m-ben",
            "maybe",
            undefined,
            (await garden("m-ben")).next.key
          )
        ).ok
      ).toBe(true);

      const ana = await garden("m-ana");
      // Ana is no keeper of the garden: she sees how many and that she is one, and no names.
      expect(ana.gathering).toMatchObject({ going: 2, mine: true, names: [] });
      const ben = await garden("m-ben");
      expect(ben.gathering).toMatchObject({ going: 2, mine: false, names: [] });
      // An admin reads the names, first names only, alphabetical, never in order of anything a person did.
      const founder = await garden("m-founder");
      expect(founder.gathering).toMatchObject({
        going: 2,
        mine: false,
        names: ["Ana", "Zoe"],
      });
    });

    it("takes the answer back through the gatherings' own withdraw", async () => {
      expect(
        await withdrawRsvp(
          pool,
          EVENT,
          "m-ana",
          (await garden("m-ana")).next.key
        )
      ).toBe(true);
      expect((await garden("m-ana")).gathering).toMatchObject({
        going: 1,
        mine: false,
      });
    });

    it("offers nothing while the events module is off, because the door the button uses is closed", async () => {
      await eventsModule("off");
      expect((await garden("m-zoe")).gathering).toBeNull();
      await eventsModule("members");
      expect((await garden("m-zoe")).gathering).toMatchObject({
        going: 1,
        mine: true,
      });
    });
  }
);
