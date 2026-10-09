/**
 * The anonymous mechanics feed lists every dial and withholds a value that can
 * carry a credential. On 2026-10-05 Amora's `GET /api/game/mechanics` was
 * publishing `tokens.base_rpc_url` as a full Alchemy endpoint, key in the path,
 * to anyone who asked. These pin the flag on that dial, the shape check that
 * covers a dial nobody flagged, and what the feed sends in place of the value.
 *
 * Every key below is fake on purpose and says so.
 */
import { describe, expect, it } from "vitest";
import {
  VARIABLES,
  VARIABLES_BY_KEY,
  looksLikeCredential,
  publicValueFields,
  withheldFromPublic,
} from "./gameVariables";

const FAKE_ALCHEMY = "https://base-mainnet.g.alchemy.com/v2/FAKE-key-not-real-0000";

describe("looksLikeCredential", () => {
  it.each([
    [FAKE_ALCHEMY, "a provider key in the path"],
    ["https://mainnet.infura.io/v3/00000000000000000000000000000000", "an Infura project id"],
    ["https://api.example.org/data?apikey=FAKE", "a key in the query"],
    ["https://api.example.org/data?a=1&access_token=FAKE", "a token in the query"],
    ["https://user:FAKE@rpc.example.org/", "a password in the address"],
  ])("recognises %s (%s)", (value) => {
    expect(looksLikeCredential(value)).toBe(true);
  });

  it.each([
    "https://mainnet.base.org",
    "https://app.hypha.earth/dho/a-village",
    "0x1111111111111111111111111111111111111111",
    "https://example.org/keys?page=2",
    "105",
    "",
  ])("leaves %j alone", (value) => {
    expect(looksLikeCredential(value)).toBe(false);
  });
});

describe("the RPC dial", () => {
  it("is flagged, so its value is withheld even when it holds no key yet", () => {
    expect(VARIABLES_BY_KEY["tokens.base_rpc_url"].withheld).toBe(true);
    expect(withheldFromPublic({ withheld: true, value: "https://mainnet.base.org" })).toBe(true);
  });

  it("is the only flagged dial today, so a new flag is a decision someone made on purpose", () => {
    expect(VARIABLES.filter((v) => v.withheld).map((v) => v.key)).toEqual(["tokens.base_rpc_url"]);
  });
});

describe("publicValueFields", () => {
  it("sends an ordinary dial's value through untouched", () => {
    expect(publicValueFields({ default: "100", value: "105", parsed: 105 })).toEqual({
      default: "100",
      value: "105",
      parsed: 105,
      withheld: false,
    });
  });

  it("keeps a flagged dial listed, withholds its value, and keeps its public default", () => {
    const out = publicValueFields({ withheld: true, default: "https://mainnet.base.org", value: FAKE_ALCHEMY, parsed: FAKE_ALCHEMY });
    expect(out).toEqual({ default: "https://mainnet.base.org", value: "", parsed: null, withheld: true });
    expect(JSON.stringify(out)).not.toContain("FAKE-key");
  });

  it("withholds a credential-shaped value on a dial nobody flagged", () => {
    const out = publicValueFields({ default: "", value: FAKE_ALCHEMY, parsed: FAKE_ALCHEMY });
    expect(out.withheld).toBe(true);
    expect(JSON.stringify(out)).not.toContain("FAKE-key");
  });
});
