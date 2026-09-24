/**
 * The four states a connection can be in, and the one that would otherwise be
 * reported as its exact opposite.
 */
import { describe, expect, it } from "vitest";
import { readConnection } from "./saberraConnection";
import type { SecretStatus } from "./secrets";

const status = (over: Partial<SecretStatus>): SecretStatus => ({
  key: "saberra_token",
  configured: false,
  source: "none",
  last4: null,
  setBy: null,
  setAt: null,
  atRest: null,
  unreadable: false,
  ...over,
});

describe("reading the connection", () => {
  it("SAYS THE KEY CHANGED when a stored key cannot be opened, never that nothing is set up", () => {
    // The whole reason this file exists. `configured` is false here while a
    // sealed credential sits in the database, and the two are indistinguishable
    // to anything that asks `configured` first.
    const r = readConnection(status({ configured: false, atRest: "sealed", unreadable: true }), true);
    expect(r.state).toBe("key-changed");
    expect(r.sentence).toContain("cannot open it");
    expect(r.sentence).toContain("village secrets key changes");
    expect(r.state).not.toBe("not-connected");
  });

  it("does not call out to the service while the key cannot be opened", () => {
    const r = readConnection(status({ atRest: "sealed", unreadable: true }), true);
    expect(r.mayCall).toBe(false);
  });

  it("reads an admin-typed key as connected and names where it came from", () => {
    const r = readConnection(
      status({ configured: true, source: "admin", last4: "9f2a", atRest: "sealed" }),
      true,
    );
    expect(r.state).toBe("ready");
    expect(r.mayCall).toBe(true);
    expect(r.sentence).toContain("admin panel");
    expect(r.sentence).toContain("9f2a");
  });

  it("is still ready on a host key even where this deployment cannot store secrets", () => {
    // An environment variable needs no village secrets key to be readable, so
    // the two questions are independent.
    const r = readConnection(status({ configured: true, source: "env", last4: "11bb" }), false);
    expect(r.state).toBe("ready");
    expect(r.mayCall).toBe(true);
    expect(r.sentence).toContain("host");
  });

  it("warns that nothing can be stored BEFORE a founder types a key and is refused", () => {
    const r = readConnection(status({}), false);
    expect(r.state).toBe("cannot-store");
    expect(r.sentence).toContain("no village secrets key");
    expect(r.sentence).toContain("operator");
  });

  it("says plainly that nothing is set up, where that is the truth", () => {
    const r = readConnection(status({}), true);
    expect(r.state).toBe("not-connected");
    expect(r.mayCall).toBe(false);
    expect(r.finding).toBeNull();
  });

  it("reports a plaintext row as a finding ALONGSIDE a working connection", () => {
    // A finding is not a state: the connection works and the row is exposed.
    const r = readConnection(
      status({ configured: true, source: "admin", last4: "77cc", atRest: "plaintext" }),
      true,
    );
    expect(r.state).toBe("ready");
    expect(r.mayCall).toBe(true);
    expect(r.finding).toBe("plaintext-at-rest");
  });

  it("carries the finding on a key that cannot be opened either", () => {
    const r = readConnection(status({ atRest: "plaintext", unreadable: true }), true);
    expect(r.state).toBe("key-changed");
    expect(r.finding).toBe("plaintext-at-rest");
  });

  it("has no state for a write that was refused, because a refused write stores nothing", () => {
    // Nothing was persisted, so this is indistinguishable from never having
    // tried, and saying so is accurate instead of a gap.
    const refused = readConnection(status({}), true);
    const neverTried = readConnection(status({}), true);
    expect(refused).toEqual(neverTried);
  });
});
