import { describe, expect, it, vi } from "vitest";

/**
 * Every call a sync makes to the outside service carries a deadline (R169).
 * The sync's client had none, so a service that accepted the connection and
 * never answered held the sync lock until the process restarted.
 */
vi.mock("./secrets", () => ({
  secretStatus: () => ({ key: "sera_api_secret", configured: true, source: "admin", last4: "oken", setBy: null, setAt: null, atRest: "sealed", unreadable: false }),
  villageSecretsConfigured: () => true,
  villageSecretsKeyProblem: () => null,
  secretValue: () => "t0ken",
}));
vi.mock("./modules", () => ({
  moduleConfig: () => ({ apiUrl: "https://service.example.test/mcp" }),
  effectiveLifecycle: () => "members",
}));
vi.mock("./identity", () => ({ instanceIdentity: () => ({ instanceId: "village-1", bornAt: "" }) }));

import { preflight, SYNC_CALL_TIMEOUT_MS } from "./saberraSync";

describe("the client a sync calls the service with", () => {
  it("carries a deadline on every call", () => {
    const p = preflight();
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.client.timeoutMs).toBe(SYNC_CALL_TIMEOUT_MS);
    expect(SYNC_CALL_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
