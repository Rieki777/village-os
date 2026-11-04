/**
 * The End of moon template is seeded once, and only while the moon-review
 * module is on (spec section 9). These cases run the seeding against a small
 * in-memory stand-in for `live_session_templates` that answers exactly the
 * statements server/repos/sessionTemplates.ts sends for seeding and listing,
 * with INSERT IGNORE on `seed_key` as the real unique key does. The last two
 * go through the real `GET /api/session-templates` door, with the module's
 * lifecycle loaded into the real registry, so the route's own check is what
 * is tested. No database needed.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";
import { ensureMoonSeeded, ensureSeeded } from "./lib/sessionTemplates";
import { loadModuleSettings } from "./lib/modules";
import { register } from "./routes/sessionTemplates";
import { DEFAULT_TEMPLATES, MOON_TEMPLATE, TEMPLATES_API, type TemplatesPayload } from "../shared/sessionTemplates";

interface Row {
  id: number;
  name: string;
  category: string;
  summary: string;
  circle_id: string | null;
  duration_min: number | null;
  flow: string;
  position: number;
  status: "active" | "archived";
  feeds_from_id: number | null;
  seed_key: string | null;
  updated_by_no: number;
  updated_at: Date;
}

function fakeTable() {
  const rows: Row[] = [];
  let modules: Array<{ module_id: string; lifecycle: string; config: null; updated_at: null }> = [];
  const inserts: string[] = [];
  const query = async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM module_settings")) return [modules, []];
    if (sql.startsWith("SELECT `id`, `seed_key`, `feeds_from_id` FROM `live_session_templates`")) {
      return [rows.filter((r) => r.seed_key != null).map((r) => ({ id: r.id, seed_key: r.seed_key, feeds_from_id: r.feeds_from_id })), []];
    }
    if (sql.startsWith("INSERT IGNORE INTO `live_session_templates`")) {
      const [name, category, summary, durationMin, flow, position, seedKey, now] = params as [string, string, string, number | null, string, number, string, Date];
      if (rows.some((r) => r.seed_key === seedKey)) return [{ affectedRows: 0 }, []];
      inserts.push(seedKey);
      rows.push({
        id: rows.length + 1,
        name,
        category,
        summary,
        circle_id: null,
        duration_min: durationMin,
        flow,
        position,
        status: "active",
        feeds_from_id: null,
        seed_key: seedKey,
        updated_by_no: 0,
        updated_at: now,
      });
      return [{ affectedRows: 1, insertId: rows.length }, []];
    }
    if (sql.startsWith("UPDATE `live_session_templates` SET `feeds_from_id`")) {
      const [from, id] = params as [number, number];
      const r = rows.find((x) => x.id === id);
      if (r && r.feeds_from_id == null && r.updated_by_no === 0) r.feeds_from_id = from;
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith("SELECT") && sql.includes("FROM `live_session_templates` ORDER BY")) {
      return [[...rows].sort((a, b) => a.category.localeCompare(b.category) || a.position - b.position || a.id - b.id), []];
    }
    throw new Error(`the stand-in table does not know this statement: ${sql}`);
  };
  return {
    pool: { query } as unknown as Pool,
    rows,
    inserts,
    setMoon(lifecycle: string | null) {
      modules = lifecycle ? [{ module_id: "moon-review", lifecycle, config: null, updated_at: null }] : [];
    },
  };
}

const moonRows = (rows: Row[]) => rows.filter((r) => r.seed_key === MOON_TEMPLATE.seedKey);

describe("seeding the End of moon template", () => {
  it("writes nothing while the module is off", async () => {
    const t = fakeTable();
    await ensureSeeded(t.pool);
    expect(await ensureMoonSeeded(t.pool, false)).toBe(false);
    expect(moonRows(t.rows)).toHaveLength(0);
    expect(t.rows).toHaveLength(DEFAULT_TEMPLATES.length);
  });

  it("writes it once while the module is on, with its category and flow", async () => {
    const t = fakeTable();
    await ensureSeeded(t.pool);
    expect(await ensureMoonSeeded(t.pool, true)).toBe(true);
    expect(await ensureMoonSeeded(t.pool, true)).toBe(false);
    const [row] = moonRows(t.rows);
    expect(moonRows(t.rows)).toHaveLength(1);
    expect(row.category).toBe("Moon rhythm");
    expect(JSON.parse(row.flow).map((s: { kind: string }) => s.kind)).toEqual(MOON_TEMPLATE.flow.map((s) => s.kind));
    expect(t.inserts.filter((k) => k === MOON_TEMPLATE.seedKey)).toHaveLength(1);
  });

  it("never writes it again once archived or edited", async () => {
    const t = fakeTable();
    await ensureMoonSeeded(t.pool, true);
    const [row] = moonRows(t.rows);
    row.status = "archived";
    row.name = "Our own moon circle";
    await ensureMoonSeeded(t.pool, true);
    expect(moonRows(t.rows)).toHaveLength(1);
    expect(moonRows(t.rows)[0].name).toBe("Our own moon circle");
  });

  it("still seeds the three defaults when the End of moon seed landed first", async () => {
    const t = fakeTable();
    await ensureMoonSeeded(t.pool, true);
    await ensureSeeded(t.pool);
    expect(t.rows.map((r) => r.seed_key).sort()).toEqual([...DEFAULT_TEMPLATES.map((s) => s.seedKey), MOON_TEMPLATE.seedKey].sort());
  });
});

describe("the templates door seeds by the module's lifecycle", () => {
  afterAll(async () => {
    // Leave the registry as every other file finds it: nothing stored, every module off.
    await loadModuleSettings(fakeTable().pool);
  });

  const listAs = async (t: ReturnType<typeof fakeTable>) => {
    const handlers = new Map<string, (req: unknown, res: unknown) => Promise<unknown>>();
    const record = (method: string) => (p: string, h: (req: unknown, res: unknown) => Promise<unknown>) => handlers.set(`${method} ${p}`, h);
    const app = { get: record("GET"), post: record("POST"), patch: record("PATCH"), put: record("PUT"), delete: record("DELETE"), use: () => undefined };
    register(app as never, {
      authedUser: async () => ({ id: "m-ana" }),
      isAdmin: async () => false,
      getPool: () => t.pool,
      mayAct: async () => ({ ok: true }),
      seasonState: () => ({ current: null }),
    } as never);
    const out: { status: number; body: TemplatesPayload | undefined } = { status: 200, body: undefined };
    const res = {
      status(c: number) {
        out.status = c;
        return res;
      },
      json(b: TemplatesPayload) {
        out.body = b;
        return res;
      },
      setHeader() {},
    };
    await handlers.get(`GET ${TEMPLATES_API}`)!({ params: {}, query: {}, body: {} }, res);
    return out;
  };

  it("lists no End of moon while the module is off", async () => {
    const t = fakeTable();
    t.setMoon(null);
    await loadModuleSettings(t.pool);
    const out = await listAs(t);
    expect(out.status).toBe(200);
    expect(out.body!.templates.map((x) => x.name)).not.toContain(MOON_TEMPLATE.name);
    expect(moonRows(t.rows)).toHaveLength(0);
  });

  it("lists it once the module is on, and only once", async () => {
    const t = fakeTable();
    t.setMoon("members");
    await loadModuleSettings(t.pool);
    await listAs(t);
    const out = await listAs(t);
    const moon = out.body!.templates.filter((x) => x.name === MOON_TEMPLATE.name);
    expect(moon).toHaveLength(1);
    expect(moon[0].category).toBe("Moon rhythm");
    expect(moon[0].flow.map((s) => s.title)).toEqual(MOON_TEMPLATE.flow.map((s) => s.title));
    expect(moonRows(t.rows)).toHaveLength(1);
  });
});
