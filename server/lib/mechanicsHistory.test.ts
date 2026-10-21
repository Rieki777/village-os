/**
 * The public amendment feed keeps a credential's row and never its value.
 *
 * `tokens.base_rpc_url` is the dial that published Amora's Alchemy key on
 * 2026-10-05. The snapshot was closed then; these hold the history, which is
 * the second door to the same value.
 */
import { describe, expect, it } from "vitest";
import { VARIABLES_BY_KEY } from "../../shared/gameVariables";
import { publicAmendment, type AmendmentRow } from "./mechanicsHistory";

const KEY_URL = "https://base-mainnet.g.alchemy.com/v2/AbCdEfGhIjKlMnOpQrStUvWx123456";

const row = (over: Partial<AmendmentRow>): AmendmentRow => ({
  id: "mech-1",
  config_key: "tokens.base_rpc_url",
  old_value: null,
  new_value: KEY_URL,
  actor_user_id: "user-1",
  source: "admin",
  proposal_ref: null,
  note: null,
  at: new Date("2026-10-20T12:00:00Z"),
  ...over,
});

describe("publicAmendment", () => {
  it("is asked about a dial the registry really flags", () => {
    // A rename that dropped the flag would make every test below vacuous.
    expect(VARIABLES_BY_KEY["tokens.base_rpc_url"]?.withheld).toBe(true);
  });

  it("withholds both values of a flagged dial, and keeps the row", () => {
    const def = VARIABLES_BY_KEY["tokens.base_rpc_url"];
    const out = publicAmendment(row({ old_value: KEY_URL.replace("123456", "654321") }), def, "Rye");
    expect(JSON.stringify(out)).not.toContain("alchemy");
    expect(out.from).toBe("");
    expect(out.to).toBe("");
    expect(out.withheld).toBe(true);
    expect(out.key).toBe("tokens.base_rpc_url");
    expect(out.by).toBe("Rye");
    expect(out.at).toBe("2026-10-20T12:00:00.000Z");
  });

  it("withholds a credential-shaped value on a dial nobody flagged", () => {
    const def = { label: "Some endpoint", default: "", withheld: undefined };
    const out = publicAmendment(row({ config_key: "example.endpoint", new_value: "https://api.example.test/x?api_key=SECRET123" }), def, null);
    expect(JSON.stringify(out)).not.toContain("SECRET123");
    expect(out.withheld).toBe(true);
  });

  it("leaves an ordinary amendment exactly as it was", () => {
    const def = { label: "Sensing days", default: "7", withheld: undefined };
    const out = publicAmendment(row({ config_key: "governance.sensing_days", old_value: null, new_value: "10" }), def, "Ana");
    expect(out).toMatchObject({ from: "7", fromWasDefault: true, to: "10", toIsDefault: false, withheld: false, label: "Sensing days" });
  });

  it("falls back to the key when the registry no longer knows the dial", () => {
    const out = publicAmendment(row({ config_key: "retired.dial", old_value: "1", new_value: "2" }), undefined, null);
    expect(out).toMatchObject({ label: "retired.dial", from: "1", to: "2", withheld: false });
  });
});
