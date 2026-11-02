/**
 * WHAT THE ISSUANCE CAP SAYS IT COUNTS (2026-11-01). The dial and the Mint by
 * hand panel said the cap counted "every door and not by hand alone", while the
 * sum reads only the mint faucet (`cycleIssuanceRows` over `MINT_FAUCET`,
 * server/lib/mintCap.ts). Pay for work issues from its own faucets and was
 * never counted, which is right by Rye's ruling of 2026-10-22: "we definitely
 * can't have caps on what things pay". So the words change, and the scope stays.
 */
import { describe, expect, it } from "vitest";
import { VARIABLES } from "./gameVariables";
import { MINT_CAP_SCOPE } from "./mintCapWords";

const dial = () => VARIABLES.find((v) => v.key === "ledger.admin_mint_cycle_cap")!;

describe("the issuance cap's words", () => {
  it("names the mint faucet and says what it does not count", () => {
    expect(MINT_CAP_SCOPE).toContain("mint faucet");
    expect(MINT_CAP_SCOPE).toContain("Pay for quests, roles and accepted proposals");
    expect(MINT_CAP_SCOPE).toContain("gratitude pool");
    expect(MINT_CAP_SCOPE).toContain("are not counted");
  });

  it("puts the same scope on the dial, and never claims every door of every faucet", () => {
    expect(dial().description).toContain(MINT_CAP_SCOPE);
    expect(dial().description).not.toContain("counted across every door");
    expect(dial().description).not.toContain("every door that issues this token");
  });
});
