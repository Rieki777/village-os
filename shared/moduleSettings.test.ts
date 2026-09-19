/**
 * WHICH CARD A SETTING APPEARS ON, pinned.
 *
 * Rye, 2026-09-15: "ALL settings dealing with modules should exist inside the
 * module card/section so that it is easy to know where they are at and make
 * the right adjustments." That makes ownership a mechanical question rather
 * than a matter of where somebody happened to put a control, and
 * `modulesOwning` is the one answer. These are the invariants that keep it one
 * answer: the namespace map is real, a listed key is real, and the dials that
 * belong to nobody stay where a founder can still find them.
 *
 * THE DENOMINATOR IS DELIBERATE. A test that asserted only the keys I moved
 * would pass while the next dial to land went missing, which is the failure
 * this whole change exists to end. So the namespace rule is asserted over the
 * WHOLE registry: every dial whose prefix names a module is owned by it, no
 * exceptions list.
 */
import { describe, expect, it } from "vitest";
import { MODULES, MODULES_BY_ID, MODULE_KEY_PREFIXES, modulesOwning } from "./modules";
import { VARIABLES, VARIABLES_BY_KEY } from "./gameVariables";

describe("the module key namespaces", () => {
  it("every namespace names a module that exists", () => {
    for (const [prefix, id] of Object.entries(MODULE_KEY_PREFIXES)) {
      expect(MODULES_BY_ID[id], `${prefix}.* points at "${id}"`).toBeTruthy();
    }
  });

  it("owns every dial in its namespace, across the whole registry", () => {
    for (const v of VARIABLES) {
      const prefix = v.key.split(".")[0];
      const owner = MODULE_KEY_PREFIXES[prefix];
      if (!owner) continue;
      expect(modulesOwning(v.key), v.key).toContain(owner);
    }
  });

  it("owns the GENERATED progression dials without listing one of them", () => {
    // These keys are built at load time out of GAME_CONFIG.stages and
    // STAGE_UNLOCKS. A hand-written list would go stale the day a village adds
    // a stage, silently, which is the whole reason ownership reads a namespace.
    expect(MODULES_BY_ID.progression.variableKeys).toEqual([]);
    const generated = VARIABLES.map((v) => v.key).filter((k) => k.startsWith("progression."));
    expect(generated.length).toBeGreaterThan(20);
    for (const key of generated) expect(modulesOwning(key), key).toEqual(["progression"]);
  });
});

describe("what each module lists beyond its namespace", () => {
  it("lists only keys the registry actually has", () => {
    for (const m of MODULES) {
      for (const key of m.variableKeys) {
        expect(VARIABLES_BY_KEY[key], `${m.id} lists ${key}`).toBeTruthy();
      }
    }
  });

  it("owns every key it lists", () => {
    for (const m of MODULES) {
      for (const key of m.variableKeys) {
        expect(modulesOwning(key), `${m.id} lists ${key}`).toContain(m.id);
      }
    }
  });

  it("shows a shared dial on both cards, and says which pairs those are", () => {
    // Each pair is a reading of the code, not a guess: both modules' own
    // routes or libs read the key. The card renders the other module's name
    // beside it so a founder changing one knows who else moves.
    const pairs: Array<[string, string[]]> = [
      ["payments.purchase_limit_per_order_usd", ["stays", "exchange"]],
      ["payments.purchase_limit_30d_usd", ["stays", "exchange"]],
      ["payments.purchase_limit_annual_usd", ["stays", "exchange"]],
      ["feed.max_hearts_per_recipient_per_cycle", ["gratitude", "feed"]],
      ["feed.category_slug", ["forum", "feed"]],
      ["map.public_structure", ["map", "resources"]],
      ["events.rsvp_enabled", ["map", "events"]],
      ["gratitude.base_budget", ["gratitude", "health"]],
      ["health.alert_change_pct", ["gratitude", "health"]],
      ["governance.weight_mode", ["exchange", "governance"]],
      ["governance.weight_token", ["exchange", "governance"]],
      ["governance.default_method", ["governance", "hypha"]],
      ["ledger.admin_mint_cosign_over", ["resources"]],
      ["assistant.synthesis_batch", ["automation"]],
      ["payments.donation_max_usd", ["commerce"]],
      ["cycle.mode", ["gratitude"]],
      ["tokens.base_rpc_url", ["hypha"]],
    ];
    for (const [key, owners] of pairs) {
      expect(modulesOwning(key).sort(), key).toEqual([...owners].sort());
    }
  });
});

describe("the dials no module owns", () => {
  it("leaves the platform's own settings in Game Mechanics", () => {
    // If one of these ever gains an owner it should be because somebody moved
    // it deliberately, not because a namespace quietly swallowed it.
    const platform = [
      "economy.voice_decay_pct",
      "exit.cooling_days",
      "needs.aggregate_floor",
      "org.public_people",
      "auth.session_days",
      "platform.feedback_relay",
      "village.first_moon_at",
      "membership.vouches_required",
      "arrival.greeter_role",
      "ledger.admin_mint_cycle_cap",
      "tokens.show_economics_section",
      // The redemption dials are a live lane's, and this change deliberately
      // does not claim them: there is no redemption module in the registry
      // yet, so they stay platform dials until that lane lands one.
      "redemption.per_member_per_cycle",
    ];
    for (const key of platform) {
      expect(VARIABLES_BY_KEY[key], key).toBeTruthy();
      expect(modulesOwning(key), key).toEqual([]);
    }
  });

  it("answers an empty list for a key that is not a dial at all", () => {
    expect(modulesOwning("")).toEqual([]);
    expect(modulesOwning("nothing.like.this")).toEqual([]);
  });
});
