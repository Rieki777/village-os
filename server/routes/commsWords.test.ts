import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { provisionTestDb, testDbConfigured, testPool, type TestDb } from "../db/testDb";
import type { PostOfficeDeps } from "../lib/comms/postOffice";
import type { Transport, TransportMessage } from "../lib/comms/transport";
import { register } from "./commsWords";

/**
 * The Words routes, driven through their handlers against a provisioned
 * schema and a recording provider. The module gate in front of them is the
 * e2e suite's to prove (server/commsWords.e2e.test.ts); here the question is
 * what the handlers answer and, above all, that the preview a founder reads is
 * exactly what the post office is handed when they press "Send me a test".
 */

const configured = testDbConfigured();
let db: TestDb;
let pool: Pool;

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

/** A fake Express that keeps the last handler of each route, skipping the module gate before it. */
function collect(): { app: any; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>();
  const record = (method: string) => (path: string, ...fns: Handler[]) => {
    handlers.set(`${method} ${path}`, fns[fns.length - 1]);
  };
  return { app: { get: record("GET"), post: record("POST"), put: record("PUT"), delete: record("DELETE") }, handlers };
}

function makeRes() {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: any) {
      out.body = body;
      return res;
    },
    set() {
      return res;
    },
  };
  return { res, out };
}

const ADMIN = { id: "u-admin", name: "Ada Lovelace", email: "ada@village.example.test", role: "admin" };

function setup(opts: { user?: any; mayLook?: boolean; mayChange?: boolean } = {}) {
  const sent: TransportMessage[] = [];
  const transport: Transport = {
    name: "resend",
    async send(m) {
      sent.push(m);
      return { ok: true, providerId: `prov_${sent.length}` };
    },
  };
  const office: PostOfficeDeps = {
    getPool: () => pool,
    transport,
    sender: () => "Village <hello@village.example.test>",
    hasApiKey: () => true,
    origin: () => "https://village.example.test",
  };
  const user = opts.user === undefined ? ADMIN : opts.user;
  const { app, handlers } = collect();
  register(app, {
    authedUser: async () => user,
    mayStillSee: async () => opts.mayLook ?? true,
    guardCapability: async (_req: any, res: any, _cap: any, refusal: any) => {
      if (opts.mayChange ?? true) return true;
      res.status(refusal.status).json(refusal.body);
      return false;
    },
    getPool: () => pool,
    commsPostOffice: office,
  } as any);
  const call = async (method: string, route: string, req: { params?: Record<string, string>; body?: unknown } = {}) => {
    const handler = handlers.get(`${method} ${route}`);
    if (!handler) throw new Error(`no handler for ${method} ${route}`);
    const { res, out } = makeRes();
    await handler({ params: req.params ?? {}, body: req.body ?? {}, headers: {} }, res);
    return out;
  };
  return { call, sent, handlers };
}

beforeAll(async () => {
  if (!configured) return;
  db = await provisionTestDb();
  pool = testPool(db, { connectionLimit: 4 });
});

afterAll(async () => {
  await pool?.end();
  await db?.drop();
});

describe.skipIf(!configured)("the Words routes", () => {
  it("registers every route the screen calls", () => {
    expect([...setup().handlers.keys()].sort()).toEqual([
      "GET /api/admin/comms/words",
      "GET /api/admin/comms/words/:key",
      "POST /api/admin/comms/words/:key/adopt",
      "POST /api/admin/comms/words/:key/preview",
      "POST /api/admin/comms/words/:key/restore",
      "POST /api/admin/comms/words/:key/test",
      "PUT /api/admin/comms/words/:key",
    ]);
  });

  it("sends the test with exactly the subject, HTML and text the preview showed", async () => {
    const { call, sent } = setup();
    const body = {
      draft: {
        subject: "A seat for {{person.firstName}} at {{gathering.title}}",
        preheader: "Your preview line",
        bodyMd: "Hi {{person.firstName}},\n\n- **When:** {{gathering.when}}\n\n[See the gathering]({{gathering.url}})",
      },
    };
    const preview = await call("POST", "/api/admin/comms/words/:key/preview", { params: { key: "gathering.confirm" }, body });
    expect(preview.status).toBe(200);
    expect(preview.body.subject).toBe("A seat for Ada at Community supper");

    const test = await call("POST", "/api/admin/comms/words/:key/test", { params: { key: "gathering.confirm" }, body });
    expect(test.status, JSON.stringify(test.body)).toBe(200);
    expect(test.body).toMatchObject({ status: "sent", sentTo: ADMIN.email });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(ADMIN.email);
    expect(sent[0].kind).toBe("essential");
    expect(sent[0].subject).toBe(preview.body.subject);
    expect(sent[0].html).toBe(preview.body.html);
    expect(sent[0].text).toBe(preview.body.text);

    const [rows] = await pool.query<RowDataPacket[]>( // module-review-ok: reading back the scratch schema this suite provisioned
      "SELECT kind, origin, status, template_key FROM comms_messages WHERE id = ?",
      [test.body.messageId],
    );
    expect(rows[0]).toMatchObject({ kind: "essential", origin: "comms.test", status: "sent", template_key: "gathering.confirm" });
  });

  it("previews the saved words when there is no draft, and greets whoever is asking", async () => {
    const { call } = setup();
    const preview = await call("POST", "/api/admin/comms/words/:key/preview", { params: { key: "gathering.reminder_day" } });
    expect(preview.body).toMatchObject({ source: "platform", version: 1, kind: "events", missing: [], unknown: [], voice: [] });
    expect(preview.body.text.startsWith("Hi Ada,")).toBe(true);
    expect(preview.body.subject).toBe("Tomorrow: Community supper");
  });

  it("warns in the preview about a field the email cannot use, and refuses to save it", async () => {
    const { call } = setup();
    const draft = { subject: "Hello", bodyMd: "Hi {{path.name}} {{gathering.titel}}" };
    const preview = await call("POST", "/api/admin/comms/words/:key/preview", { params: { key: "gathering.confirm" }, body: { draft } });
    expect(preview.status).toBe(200);
    expect(preview.body.unknown).toEqual(["gathering.titel"]);
    expect(preview.body.problems).toHaveLength(2);
    const save = await call("PUT", "/api/admin/comms/words/:key", { params: { key: "gathering.confirm" }, body: draft });
    expect(save.status).toBe(400);
    expect(save.body.problems).toEqual([
      "{{gathering.titel}} is not a field. Pick one from the list.",
      "{{path.name}} is never known when this email is sent. Pick one from the list.",
    ]);
  });

  it("saves, restores and adopts, answering the fresh words each time", async () => {
    const { call } = setup();
    const key = "member.welcome.check_in";
    const saved = await call("PUT", "/api/admin/comms/words/:key", {
      params: { key },
      body: { subject: "Two weeks with {{village.name}}", preheader: "", bodyMd: "Hi {{person.firstName}}, how is it going?" },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.saved).toBe(2);
    expect(saved.body.detail.live).toMatchObject({ source: "village", version: 2, subject: "Two weeks with {{village.name}}" });
    expect(saved.body.detail.versions.map((v: any) => v.version)).toEqual([2, 1]);

    const restored = await call("POST", "/api/admin/comms/words/:key/restore", { params: { key }, body: { version: 1 } });
    expect(restored.body.detail.live.version).toBe(1);
    expect((await call("POST", "/api/admin/comms/words/:key/restore", { params: { key }, body: { version: 7 } })).status).toBe(404);

    const adopted = await call("POST", "/api/admin/comms/words/:key/adopt", { params: { key } });
    expect(adopted.body.adopted).toBe(3);
    expect(adopted.body.detail.live).toMatchObject({ version: 3, platformVersion: 1 });
  });

  it("lists every email in its group, and tells the editor which fields each one may use", async () => {
    const { call } = setup();
    const list = await call("GET", "/api/admin/comms/words");
    const keys = list.body.groups.flatMap((g: any) => g.items.map((i: any) => i.key));
    expect(keys).toContain("gathering.confirm");
    expect(keys).toContain("path.investor.welcome");
    expect(list.body.groups.find((g: any) => g.id === "path.steward").title).toBe("Village Steward path");
    const detail = await call("GET", "/api/admin/comms/words/:key", { params: { key: "poll.invite" } });
    expect(detail.body.fields.map((f: any) => f.key)).toContain("poll.options");
    expect(detail.body.fields.map((f: any) => f.key)).not.toContain("path.name");
    expect((await call("GET", "/api/admin/comms/words/:key", { params: { key: "no.such.words" } })).status).toBe(404);
  });

  it("answers a stranger 401, a member without the power 403, and refuses the act to anybody the gate refuses", async () => {
    expect((await setup({ user: null }).call("GET", "/api/admin/comms/words")).status).toBe(401);
    expect((await setup({ mayLook: false }).call("GET", "/api/admin/comms/words")).status).toBe(403);
    const refused = setup({ mayChange: false });
    const save = await refused.call("PUT", "/api/admin/comms/words/:key", { params: { key: "gathering.confirm" }, body: { subject: "x", bodyMd: "y" } });
    expect(save.status).toBe(403);
    const test = await refused.call("POST", "/api/admin/comms/words/:key/test", { params: { key: "gathering.confirm" } });
    expect(test.status).toBe(403);
    expect(refused.sent).toHaveLength(0);
  });
});
