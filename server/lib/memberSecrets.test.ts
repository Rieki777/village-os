/**
 * The member key store (round 4, lane L6). Harm metric 6 lives here:
 * MEMBER_SECRETS_KEY unset refuses storage with the sentence, and never falls
 * back to a per-process key.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  MEMBER_SECRETS_ENV,
  NO_MEMBER_SECRETS_KEY_SENTENCE,
  cleanBaseUrl,
  memberSecretsConfigured,
  open,
  seal,
  storeMemberKey,
} from "./memberSecrets";

const KEY = "ab".repeat(32);
const withKey = { [MEMBER_SECRETS_ENV]: KEY } as NodeJS.ProcessEnv;
const without = {} as NodeJS.ProcessEnv;

afterEach(() => {
  delete process.env[MEMBER_SECRETS_ENV];
});

describe("the key", () => {
  it("is configured only by 32 hex bytes", () => {
    expect(memberSecretsConfigured(withKey)).toBe(true);
    expect(memberSecretsConfigured(without)).toBe(false);
    expect(memberSecretsConfigured({ [MEMBER_SECRETS_ENV]: "short" } as NodeJS.ProcessEnv)).toBe(false);
    expect(memberSecretsConfigured({ [MEMBER_SECRETS_ENV]: "zz".repeat(32) } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("seal and open", () => {
  it("round-trips a plaintext", () => {
    const sealed = seal("sk-ant-example-0000", withKey);
    expect(open(sealed, withKey)).toBe("sk-ant-example-0000");
  });

  it("never stores the plaintext, in any field", () => {
    const sealed = seal("sk-ant-example-0000", withKey);
    for (const v of Object.values(sealed)) {
      expect(v).not.toContain("sk-ant");
      expect(v).not.toBe("sk-ant-example-0000");
    }
  });

  it("uses a fresh iv every time, so equal keys make unequal rows", () => {
    const a = seal("same", withKey);
    const b = seal("same", withKey);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("refuses to open a tampered row instead of returning garbage", () => {
    const sealed = seal("sk-ant-example-0000", withKey);
    const flipped = Buffer.from(sealed.ciphertext, "base64");
    flipped[0] ^= 0xff;
    expect(open({ ...sealed, ciphertext: flipped.toString("base64") }, withKey)).toBeNull();
  });

  it("opens nothing under the wrong key", () => {
    const sealed = seal("sk-ant-example-0000", withKey);
    expect(open(sealed, { [MEMBER_SECRETS_ENV]: "cd".repeat(32) } as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("absent key refuses, with the sentence (harm metric 6)", () => {
  it("seal throws the sentence", () => {
    expect(() => seal("anything", without)).toThrow(NO_MEMBER_SECRETS_KEY_SENTENCE);
  });

  it("open returns null and never invents a key", () => {
    const sealed = seal("x", withKey);
    expect(open(sealed, without)).toBeNull();
  });

  it("storeMemberKey answers the sentence before it touches the pool", async () => {
    let touched = 0;
    const pool = { query: async () => { touched += 1; return [[]]; } } as any;
    const r = await storeMemberKey(pool, "u-1", { provider: "anthropic", key: "sk-ant-example-0000" }, without, 0);
    expect(r).toEqual({ ok: false, error: NO_MEMBER_SECRETS_KEY_SENTENCE });
    expect(touched).toBe(0);
    expect(NO_MEMBER_SECRETS_KEY_SENTENCE).toBe("this deployment has no member-secrets key; ask your operator");
  });
});

describe("base URL", () => {
  it("accepts https and strips a trailing slash", () => {
    expect(cleanBaseUrl("https://openrouter.ai/api/")).toEqual({ ok: true, url: "https://openrouter.ai/api" });
  });
  it("treats blank as none", () => {
    expect(cleanBaseUrl("")).toEqual({ ok: true, url: null });
  });
  it("refuses http and credentials", () => {
    expect(cleanBaseUrl("http://localhost:11434").ok).toBe(false);
    expect(cleanBaseUrl("https://user:pw@example.com").ok).toBe(false);
  });
  it("an openai_compatible key needs a base URL and a model", async () => {
    const pool = { query: async () => [[]] } as any;
    const r = await storeMemberKey(pool, "u-1", { provider: "openai_compatible", key: "sk-or-example-0000" }, withKey, 0);
    expect(r.ok).toBe(false);
    const noModel = await storeMemberKey(pool, "u-1", { provider: "openai_compatible", key: "sk-or-example-0000", baseUrl: "https://93.184.216.34" }, withKey, 0);
    expect(noModel).toMatchObject({ ok: false, error: expect.stringContaining("model") });
  });

  it("refuses a base URL in a private range with a generic sentence, before any write", async () => {
    let touched = 0;
    const pool = { query: async () => { touched += 1; return [[]]; } } as any;
    for (const baseUrl of ["https://127.0.0.1:11434", "https://10.0.0.5", "https://169.254.169.254", "https://192.168.1.2:8443"]) {
      const r = await storeMemberKey(pool, "u-1", { provider: "openai_compatible", key: "sk-or-example-0000", baseUrl, model: "m" }, withKey, 0);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toBe("That base URL is not reachable from here. It must be a public https host");
        expect(r.error).not.toContain(baseUrl.slice(8, 15));
      }
    }
    expect(touched).toBe(0);
  });
});
