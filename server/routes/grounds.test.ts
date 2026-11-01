/**
 * THE MAP ARTIFACT FOLLOWS THE MAP MODULE (readiness R056).
 *
 * `/grounds/index.html`, `/grounds/grounds-<hash>.html` and
 * `/grounds/manifest.json` were plain routes, so a village that never turned
 * the map on served the artifact to anyone who asked. These run the real
 * handlers in server/routes/grounds.ts on a real Express app, with the real
 * module gate (server/lib/modules.ts) fed a module_settings row through
 * `loadModuleSettings`, the way boot feeds it.
 *
 * The pages and the probe are gated differently on purpose, and the header of
 * grounds.ts says why: the shell loads the pages as an iframe `src`, which
 * carries no Bearer token, so the pages can only refuse an OFF map. The probe
 * is a fetch that does carry one, so it gets the whole gate.
 */
import fs from "fs";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadModuleSettings, wireModuleAuth } from "../lib/modules";
import type { ModuleLifecycle } from "../../shared/modules";
import { register } from "./grounds";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grounds-gate-"));
const groundsFile = path.join(dir, "grounds-v0.html");
fs.writeFileSync(groundsFile, "<!doctype html><title>A map</title><p>drawing code</p>");

let base = "";
let server: ReturnType<express.Express["listen"]> | undefined;

/** The map's stored lifecycle, set the way boot reads it: one module_settings row. */
async function mapIs(lifecycle: ModuleLifecycle | null) {
  const rows = lifecycle ? [{ module_id: "map", lifecycle, config: null, updated_at: null }] : [];
  await loadModuleSettings({ query: async () => [rows, []] } as any);
}

beforeAll(async () => {
  // A request carrying "Bearer admin" is an admin, "Bearer member" a member,
  // anything else a stranger. The gate asks these two and nothing more.
  wireModuleAuth({
    isAdmin: async (req: any) => req.headers.authorization === "Bearer admin",
    isAuthed: async (req: any) => ["Bearer admin", "Bearer member"].includes(req.headers.authorization),
    meterUserId: () => null,
  });
  const app = express();
  register(app, { groundsFile });
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  fs.rmSync(dir, { recursive: true, force: true });
});

const get = (p: string, who?: "admin" | "member") =>
  fetch(base + p, { redirect: "manual", headers: who ? { Authorization: `Bearer ${who}` } : {} }); // module-review-ok: the test client dialling its own in-process server on localhost

/** The hashed URL the probe names, read with an admin's session so the gate never decides it. */
async function hashedUrl(): Promise<string> {
  const before = await get("/grounds/manifest.json", "admin");
  return (await before.json()).url;
}

describe("a village whose map is off", () => {
  beforeEach(() => mapIs(null));

  it("serves none of the three, to anybody, with requireModule's own body", async () => {
    await mapIs("public");
    const hashed = await hashedUrl();
    await mapIs(null);
    for (const p of ["/grounds/index.html", hashed, "/grounds/manifest.json"]) {
      for (const who of [undefined, "member", "admin"] as const) {
        const res = await get(p, who);
        expect(res.status, `${p} as ${who ?? "a stranger"}`).toBe(404);
        expect(await res.json()).toEqual({ error: "module_disabled", module: "map" });
      }
    }
  });

  it("does not hand out the artifact through a stale hash either", async () => {
    const res = await get("/grounds/grounds-000000000000.html");
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
  });

  it("cannot be walked around by case or a trailing slash, which Express matches all the same", async () => {
    // Express routes case-insensitively and with a non-strict trailing slash
    // by default, so these reach the same handlers, and so the same gate.
    for (const p of ["/GROUNDS/INDEX.HTML", "/grounds/index.html/", "/Grounds/Manifest.json"]) {
      const res = await get(p);
      expect(res.status, p).toBe(404);
      expect(await res.json(), p).toEqual({ error: "module_disabled", module: "map" });
    }
  });

  it("treats an explicit off row the same as no row", async () => {
    await mapIs("off");
    expect((await get("/grounds/index.html")).status).toBe(404);
    expect((await get("/grounds/manifest.json", "admin")).status).toBe(404);
  });
});

describe("a village whose map is public", () => {
  beforeEach(() => mapIs("public"));

  it("serves the page, the hashed page and the probe to a stranger", async () => {
    const page = await get("/grounds/index.html");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toMatch(/text\/html/);
    expect(await page.text()).toContain("drawing code");

    const probe = await get("/grounds/manifest.json");
    expect(probe.status).toBe(200);
    const body = await probe.json();
    expect(body.present).toBe(true);
    expect(body.url).toMatch(/^\/grounds\/grounds-[0-9a-f]{12}\.html$/);

    const hashed = await get(body.url);
    expect(hashed.status).toBe(200);
    expect(hashed.headers.get("cache-control")).toContain("immutable");
  });

  it("still redirects a stale hash to the current one", async () => {
    const res = await get("/grounds/grounds-000000000000.html");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^\/grounds\/grounds-[0-9a-f]{12}\.html$/);
  });
});

describe("a village whose map is members-only", () => {
  beforeEach(() => mapIs("members"));

  it("answers the probe to a member and refuses it to a stranger", async () => {
    expect((await get("/grounds/manifest.json", "member")).status).toBe(200);
    const stranger = await get("/grounds/manifest.json");
    expect(stranger.status).toBe(401);
    expect(await stranger.json()).toEqual({ error: "auth_required", module: "map" });
  });

  it("still serves the page itself, because the iframe that loads it carries no token", async () => {
    // The shell's own load of the frame. Refusing this would blank the map for
    // the member it is being drawn for. See the header of grounds.ts.
    expect((await get("/grounds/index.html")).status).toBe(200);
  });
});

describe("a village previewing the map", () => {
  beforeEach(() => mapIs("preview"));

  it("answers the probe to an admin only, and hides it from a member as an off module", async () => {
    expect((await get("/grounds/manifest.json", "admin")).status).toBe(200);
    const member = await get("/grounds/manifest.json", "member");
    expect(member.status).toBe(404);
    expect(await member.json()).toEqual({ error: "module_disabled", module: "map" });
  });

  it("serves the page so the previewing admin's frame can draw", async () => {
    expect((await get("/grounds/index.html")).status).toBe(200);
  });
});

describe("an artifact missing from disk", () => {
  beforeEach(() => mapIs("public"));

  it("still says so in its own words, behind the gate", async () => {
    const moved = groundsFile + ".away";
    fs.renameSync(groundsFile, moved);
    try {
      expect(await (await get("/grounds/manifest.json")).json()).toEqual({ present: false });
      expect((await get("/grounds/index.html")).status).toBe(404);
      await mapIs(null);
      // Off outranks absent: a village with the map off learns nothing about the file.
      expect(await (await get("/grounds/manifest.json")).json()).toEqual({ error: "module_disabled", module: "map" });
    } finally {
      fs.renameSync(moved, groundsFile);
    }
  });
});
