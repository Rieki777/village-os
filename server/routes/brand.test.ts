/**
 * THE VILLAGE'S CURRENCY IS SET AT LAUNCH (Rye, 2026-11-05, relayed by the
 * master coordinator: "currency lock: YES, set at launch").
 *
 * Work, Voice and cash are all counted in the village's currency, so changing
 * it after value has been issued would re-price every balance and every record
 * at a stroke. Before launch a village changes it freely; from launch the one
 * write path, PUT /api/admin/brand, refuses a different code in a sentence.
 * Driven over HTTP against the real route with the stores stubbed.
 */
import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { register } from "./brand";

let server: http.Server;
let base = "";
let stored: Record<string, any> = {};
let launchedAt: string | null = null;

const brand = () => ({
  project: { name: "", fiatCurrency: "", ...(stored.project ?? {}) },
  currency: { ...(stored.currency ?? {}) },
  images: { ...(stored.images ?? {}) },
  setup: { ...(stored.setup ?? {}) },
  theme: { ...(stored.theme ?? {}) },
  identityPack: { ...(stored.identityPack ?? {}) },
  skin: { ...(stored.skin ?? {}) },
});

async function put(project: Record<string, unknown>) {
  const res = await fetch(`${base}/api/admin/brand`, { // module-review-ok: the test client dialling its own in-process server on 127.0.0.1
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project }),
  });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  register(app, {
    isAdmin: async () => true,
    brandRepo: { put: async (next: any) => { stored = next; }, get: () => stored } as any,
    getBrand: brand,
    withoutOrphanedAlt: (images: any) => images,
    launchedAt: async () => launchedAt,
  });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  stored = { project: { name: "Hearth", fiatCurrency: "USD" } };
  launchedAt = null;
});

describe("the village's currency is set at launch", () => {
  it("changes freely before launch", async () => {
    const r = await put({ fiatCurrency: "CRC" });
    expect(r.status).toBe(200);
    expect(stored.project.fiatCurrency).toBe("CRC");
  });

  it("refuses a different currency once the village has launched, in a sentence, and keeps the old one", async () => {
    launchedAt = "2026-10-01T00:00:00.000Z";
    const r = await put({ fiatCurrency: "CRC" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("currency_locked");
    expect(r.body.error).toContain("USD");
    expect(r.body.error).toContain("set at launch");
    expect(stored.project.fiatCurrency).toBe("USD");
  });

  it("still saves the rest of the section after launch, the same currency included", async () => {
    launchedAt = "2026-10-01T00:00:00.000Z";
    expect((await put({ name: "Hearth Village", fiatCurrency: "usd" })).status).toBe(200);
    expect(stored.project.name).toBe("Hearth Village");
    expect((await put({ tagline: "together" })).status).toBe(200);
    expect(stored.project.fiatCurrency).toBe("USD");
  });

  it("lets a village that launched with no currency set one, once", async () => {
    launchedAt = "2026-10-01T00:00:00.000Z";
    stored = { project: { name: "Hearth", fiatCurrency: "" } };
    expect((await put({ fiatCurrency: "CRC" })).status).toBe(200);
    expect(stored.project.fiatCurrency).toBe("CRC");
    expect((await put({ fiatCurrency: "USD" })).status, "and then it is set").toBe(409);
  });
});
