import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./saberraSync", () => ({ preflight: () => ({ ok: true, client: { baseUrl: "https://sera.example", token: "SYNC", fetchImpl: fetch } }) }));
const seen: { token: string; tool?: string; args?: unknown }[] = [];
vi.mock("./saberraClient", () => ({
  openSession: async (c: any) => (seen.push({ token: c.token }), "s"),
  listTools: async () => ({ ok: true, tools: [{ name: "hard_delete_person_tasks" }] }),
  callToolJson: async (c: any, _s: string, tool: string, args: unknown) => (seen.push({ token: c.token, tool, args }), { ok: true, value: { count: 2, task_ids: ["a", "b"] } }),
}));

import { NEEDS_FULL_SCOPE, callPrivacyTool, libraryExportFor, privacyClient, readHardDelete } from "./saberraPrivacy";

afterEach(() => { delete process.env.SABERRA_PRIVACY_TOKEN; seen.length = 0; });

describe("the privacy connection", () => {
  it("never falls back to the sync key", async () => {
    expect(privacyClient()).toBeNull();
    const r = await callPrivacyTool("hard_delete_person_tasks", { owner_id: "o" });
    expect(r).toEqual({ ok: false, needsFullScope: true, error: NEEDS_FULL_SCOPE });
    expect(seen).toEqual([]);
  });
  it("uses only the privacy token, and a dry run sends no confirm", async () => {
    process.env.SABERRA_PRIVACY_TOKEN = "PRIV";
    const r = await callPrivacyTool("hard_delete_person_tasks", { owner_id: "o" });
    expect(r.ok).toBe(true);
    expect(seen.every((s) => s.token === "PRIV")).toBe(true);
    expect(seen.find((s) => s.tool)?.args).toEqual({ owner_id: "o" });
  });
  it("reads the count and ids, and says plainly that Sera has no export yet", async () => {
    expect(readHardDelete({ count: 2, task_ids: ["a", "b"] })).toEqual({ count: 2, ids: ["a", "b"], archived: false });
    process.env.SABERRA_PRIVACY_TOKEN = "PRIV";
    expect(await libraryExportFor("o")).toMatchObject({ offered: false });
  });
});
