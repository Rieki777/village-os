import { afterEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { emailHash, matchReady, secretVersion, MATCH_SWITCH_ENV, LINK_SECRET_ENV, SECRET_VERSION_ENV } from "./seraPersonMatch";
import { normalizeEmail, readMatch } from "../../shared/seraPersonMatch";

const valid = (s: string) => /^[A-Za-z0-9][A-Za-z0-9-]{7,127}$/.test(s);

describe("keyed-hash matching", () => {
  afterEach(() => { for (const k of [MATCH_SWITCH_ENV, LINK_SECRET_ENV, SECRET_VERSION_ENV, "SABERRA_PRIVACY_TOKEN"]) delete process.env[k]; });

  it("hashes the lowercased trimmed email with HMAC-SHA256 and never returns the email", () => {
    const h = emailHash("  Ana@Example.ORG ", "s3cret");
    expect(h).toBe(createHmac("sha256", "s3cret").update("ana@example.org").digest("hex"));
    expect(h).not.toContain("ana");
    expect(normalizeEmail(" A@B.c ")).toBe("a@b.c");
  });

  it("is off by default, and needs the secret and the privacy token", () => {
    expect(matchReady().ok).toBe(false);
    process.env[MATCH_SWITCH_ENV] = "on";
    expect(matchReady().ok).toBe(false);
    process.env[LINK_SECRET_ENV] = "x";
    expect(matchReady().ok).toBe(false);
    process.env.SABERRA_PRIVACY_TOKEN = "t";
    expect(matchReady().ok).toBe(true);
  });

  it("links on exactly one id, and sends none or several to review", () => {
    expect(readMatch({ owner_ids: ["40d0a88e-f36a-8150-9dd6-ec0acc8381fa"] }, valid)).toEqual({ kind: "link", owner: "40d0a88e-f36a-8150-9dd6-ec0acc8381fa" });
    expect(readMatch({ owner_ids: [] }, valid)).toMatchObject({ kind: "review", outcome: "none" });
    expect(readMatch({ owner_ids: ["aaaaaaaa-1", "bbbbbbbb-2"] }, valid)).toMatchObject({ kind: "review", outcome: "several", matches: 2 });
    expect(readMatch({ owner_ids: ["bad id"] }, valid)).toMatchObject({ outcome: "none" });
  });

  it("reads the secret version, default 1", () => {
    expect(secretVersion()).toBe(1);
    process.env[SECRET_VERSION_ENV] = "3";
    expect(secretVersion()).toBe(3);
  });
});
