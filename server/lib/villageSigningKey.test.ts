/**
 * The four states the village signing key can be in, and what each one costs.
 *
 * WHAT THIS PROVES: the state machine in `ensureSigningKey`: mint sealed,
 * upgrade a plaintext row in place, keep first boot working with no key set,
 * and refuse to sign rather than boot-fail when a sealed key cannot be opened.
 * The `app_config` row is a fake here, holding exactly the one row this code
 * touches, so every branch runs with no MySQL and no contention.
 *
 * WHAT IT DOES NOT PROVE: that MySQL stores and returns the document
 * unchanged. That hop belongs to the e2e boot, which runs the real query
 * against a real scratch schema. A fake that agreed with a real database about
 * everything except the thing that mattered is the failure worth naming here.
 */
import { generateKeyPairSync } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canSign,
  ensureSigningKey,
  NO_SIGNING_KEY_SENTENCE,
  resetSigningKeyForTests,
  signDocument,
  signingKeyAtRest,
  verifyDocument,
} from "./villageExport";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

/** The one `app_config` row this code reads and writes, and nothing else. */
function fakePool(seed?: string) {
  const store: { value: string | undefined } = { value: seed };
  const writes: string[] = [];
  const pool = {
    async query(sql: string, params?: any[]): Promise<any> {
      if (/^SELECT/i.test(sql)) {
        return [store.value === undefined ? [] : [{ value: store.value }]];
      }
      if (/^INSERT IGNORE/i.test(sql)) {
        // INSERT IGNORE: the row wins only if there is not one already, which
        // is what settles two concurrent first boots on one key.
        if (store.value === undefined) store.value = String(params?.[0]);
        writes.push("insert");
        return [{}];
      }
      if (/^UPDATE/i.test(sql)) {
        store.value = String(params?.[0]);
        writes.push("update");
        return [{}];
      }
      throw new Error(`fake pool saw an unexpected statement: ${sql}`);
    },
  };
  return { pool: pool as any, store, writes };
}

const doc = () => (store: { value: string | undefined }) => JSON.parse(String(store.value));

afterEach(() => {
  resetSigningKeyForTests();
});

describe("a fresh village", () => {
  it("mints the key SEALED when VILLAGE_SECRETS_KEY is set", async () => {
    const { pool, store } = fakePool();
    const k = await ensureSigningKey(pool, { VILLAGE_SECRETS_KEY: KEY_A });

    const stored = doc()(store);
    expect(stored.privateKeySealed, "the private half is sealed").toBeTruthy();
    expect(stored.privateKeyPem, "no plaintext copy is left behind").toBeUndefined();
    // The bytes that ride in a database dump must not contain the key.
    expect(String(store.value)).not.toContain("PRIVATE KEY");
    expect(signingKeyAtRest()).toBe("sealed");
    expect(canSign()).toBe(true);
    expect(k.privateKeyPem).toContain("PRIVATE KEY");
  });

  it("STILL BOOTS with no key set, storing plaintext and saying so", async () => {
    // The tension this whole change exists for: fail-closed here would refuse
    // to start a village whose operator has not set the variable yet.
    const { pool, store } = fakePool();
    const k = await ensureSigningKey(pool, {});

    expect(doc()(store).privateKeyPem).toContain("PRIVATE KEY");
    expect(signingKeyAtRest()).toBe("plaintext");
    expect(canSign()).toBe(true);
    // And it is a usable village: it can sign, which is the point of booting.
    const signed = signDocument({ hello: "village" }, k, "2026-08-31T00:00:00.000Z");
    expect(verifyDocument(signed, k.publicKeyPem)).toBe(true);
  });

  it("names a key set in the wrong shape, and never calls it unset", async () => {
    // 2026-10-02: the variable was set, with quotes around it, and this line
    // said "not set". The boot log is where an operator looks first.
    const { pool, store } = fakePool();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await ensureSigningKey(pool, { VILLAGE_SECRETS_KEY: `"${KEY_A}"` });
      const said = warn.mock.calls.map((c) => c.map(String).join(" ")).join(" ");
      expect(said).toContain("[identity] the signing key is stored in PLAINTEXT.");
      expect(said).toContain("VILLAGE_SECRETS_KEY is set, but it is 66 characters with quotes around it.");
      expect(said).not.toContain("is not set");
      expect(said).not.toContain(KEY_A.slice(0, 8));
      // The shape the gate refuses seals nothing, exactly as an absent key.
      expect(doc()(store).privateKeyPem).toContain("PRIVATE KEY");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("a village that already has a plaintext key", () => {
  const legacy = () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    return {
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      createdAt: "2026-01-01T00:00:00.000Z",
    };
  };

  it("re-seals it in place on the next boot, with the SAME kid", async () => {
    const before = legacy();
    const { pool, store, writes } = fakePool(JSON.stringify(before));

    resetSigningKeyForTests();
    const asWas = await ensureSigningKey(pool, {});
    expect(signingKeyAtRest()).toBe("plaintext");

    resetSigningKeyForTests();
    const { pool: pool2, store: store2 } = fakePool(JSON.stringify(before));
    const upgraded = await ensureSigningKey(pool2, { VILLAGE_SECRETS_KEY: KEY_A });

    // THE THING PEERS CARE ABOUT: the identity did not change. A rotated key
    // makes every peer village pause with "signing key changed" and wait for a
    // human, so an at-rest change that moved the kid would be a fleet outage.
    expect(upgraded.kid).toBe(asWas.kid);
    expect(upgraded.publicKeyPem).toBe(before.publicKeyPem);
    expect(upgraded.privateKeyPem).toBe(before.privateKeyPem);

    expect(signingKeyAtRest()).toBe("sealed");
    expect(String(store2.value)).not.toContain("PRIVATE KEY");
    expect(doc()(store2).privateKeyPem).toBeUndefined();
    expect(writes).toEqual([]); // the first boot wrote nothing; the second did
  });

  it("keeps working, plaintext, when the re-seal write fails", async () => {
    const before = legacy();
    const pool = {
      async query(sql: string): Promise<any> {
        if (/^SELECT/i.test(sql)) return [[{ value: JSON.stringify(before) }]];
        throw new Error("app_config is read-only on this replica");
      },
    } as any;

    const k = await ensureSigningKey(pool, { VILLAGE_SECRETS_KEY: KEY_A });
    // A failed upgrade must not be reported as a success, and must not take
    // the village down either.
    expect(signingKeyAtRest()).toBe("plaintext");
    expect(canSign()).toBe(true);
    expect(k.privateKeyPem).toBe(before.privateKeyPem);
  });
});

describe("a sealed key this deployment cannot open", () => {
  it("boots, loads the public half, and REFUSES to sign", async () => {
    const { pool, store } = fakePool();
    const minted = await ensureSigningKey(pool, { VILLAGE_SECRETS_KEY: KEY_A });
    resetSigningKeyForTests();

    // The operator rotated or dropped the variable. Same row, wrong key.
    const stranded = await ensureSigningKey(pool, { VILLAGE_SECRETS_KEY: KEY_B });

    // It BOOTED. That is the requirement: never leave a village unable to start.
    expect(stranded.publicKeyPem).toBe(minted.publicKeyPem);
    expect(stranded.kid).toBe(minted.kid);
    expect(signingKeyAtRest()).toBe("unreadable");
    expect(canSign()).toBe(false);
    expect(stranded.privateKeyPem).toBeNull();
    // And it refuses rather than emitting an unsigned document, which is the
    // one outcome worse than a 503: a peer learning that proofs are optional.
    expect(() => signDocument({ a: 1 }, stranded, "2026-08-31T00:00:00.000Z")).toThrow(
      NO_SIGNING_KEY_SENTENCE,
    );
    expect(store.value, "nothing was overwritten by the failed open").toBeTruthy();
  });

  it("is the same answer when the variable is missing entirely", async () => {
    const { pool } = fakePool();
    await ensureSigningKey(pool, { VILLAGE_SECRETS_KEY: KEY_A });
    resetSigningKeyForTests();

    const stranded = await ensureSigningKey(pool, {});
    expect(signingKeyAtRest()).toBe("unreadable");
    expect(canSign()).toBe(false);
  });
});

describe("a corrupt document", () => {
  it("still refuses to guess, which is the one case that is NOT tolerated", async () => {
    const { pool } = fakePool(JSON.stringify({ createdAt: "2026-01-01T00:00:00.000Z" }));
    await expect(ensureSigningKey(pool, { VILLAGE_SECRETS_KEY: KEY_A })).rejects.toThrow(
      /carries no keypair/,
    );
  });
});
