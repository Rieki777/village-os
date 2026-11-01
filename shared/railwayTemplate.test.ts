/**
 * THE TEMPLATE SHEET CANNOT FORGET WHAT A VILLAGE NEEDS AT DEPLOY.
 *
 * shared/railwayTemplate.ts is typed into Railway's dashboard by hand, so a
 * variable it leaves out is only found by a village that deployed and broke.
 * This holds it to the two places that say what a deploy needs: the soil
 * guild's required environment handles (shared/guilds.ts) and what
 * scripts/fork-init.mjs generates today.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLATFORM_GUILDS, SEEDS_BY_ID } from "./guilds";
import { HEX64, TEMPLATE_VARIABLES } from "./railwayTemplate";

const byName = new Map(TEMPLATE_VARIABLES.map((v) => [v.name, v]));
const ENV_EXAMPLE = readFileSync(join(__dirname, "..", ".env.example"), "utf8");
const FORK_INIT = readFileSync(join(__dirname, "..", "scripts", "fork-init.mjs"), "utf8");

describe("the one-click template sheet", () => {
  it("covers every required environment handle in the soil guild", () => {
    const soil = PLATFORM_GUILDS.find((g) => g.id === "soil");
    expect(soil).toBeDefined();
    for (const id of soil?.seeds ?? []) {
      const seed = SEEDS_BY_ID[id];
      if (!seed || seed.need !== "required") continue;
      for (const h of seed.handles) if (h.store === "env") expect(byName.has(h.name), `${id} needs ${h.name}`).toBe(true);
    }
  });

  it("covers everything fork-init generates for a hosted village", () => {
    const generated = Array.from(FORK_INIT.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):\s*\{\s*value:[^}]*note:\s*"generated(?:, one-time)?"/gm), (m) => m[1]);
    expect(generated.length, "the generated names were read").toBeGreaterThan(3);
    for (const name of generated) expect(byName.has(name), name).toBe(true);
  });

  it("names only variables .env.example documents", () => {
    for (const v of TEMPLATE_VARIABLES) expect(new RegExp(`^${v.name}=`, "m").test(ENV_EXAMPLE), v.name).toBe(true);
  });

  it("generates the three sealing and signing keys in the 64-hex shape the server requires", () => {
    for (const name of ["AUTH_TOKEN_SECRET", "MEMBER_SECRETS_KEY", "VILLAGE_SECRETS_KEY"]) {
      expect(byName.get(name)?.source).toBe("generated");
      expect(byName.get(name)?.value).toBe(HEX64);
    }
  });

  it("asks the founder for as little as possible, and says what is still unproven", () => {
    expect(TEMPLATE_VARIABLES.filter((v) => v.source === "founder").map((v) => v.name)).toEqual(["BREAK_GLASS_ADMIN_EMAIL"]);
    expect(TEMPLATE_VARIABLES.filter((v) => v.certainty === "unverified").map((v) => v.name).sort()).toEqual(["ADMIN_PASSWORD", "DATABASE_URL", "FRONTEND_URL"]);
  });
});
