/**
 * WHAT A MODULE NEEDS, AS A READER SEES IT.
 *
 * Every module declares its guild: the seeds from the closed catalog in
 * `shared/guilds.ts` (keys, accounts, webhooks) that must be planted before it
 * can run. This turns those ids into the short lines the Module Library shows
 * on a module's page and in a founder's planning basket, so a founder picking
 * modules knows what comes with each one (Rye, 2026-10-09: "when a village
 * founder is picking modules we should automatically know what comes with
 * what module").
 *
 * Every word shown comes from the seed catalog, which the platform writes.
 * Nothing here composes consent text, and no secret value is ever read: a seed
 * is a description of a key, never the key.
 *
 * Built on the server (the catalog route), so the 1,200-line seed catalog
 * stays out of the client bundle.
 */
import { SEEDS_BY_ID, type GuildSeed } from "./guilds";

export interface ModuleNeed {
  id: string;
  title: string;
  /** Where the founder acts, by name. */
  provider: string;
  consequence: string;
  cost: string;
  undo: string;
  /** Production, money, or sending as the village. */
  keystone: boolean;
  required: boolean;
  /** One sentence: renewed every year, or why it never rotates. */
  rotation: string;
}

function rotationLine(seed: GuildSeed): string {
  return "every" in seed.rotation ? "Renewed every year." : seed.rotation.never;
}

/**
 * The needs for one module, in its guild order. An id the catalog does not
 * hold is skipped: intake (`guildProblems`) refuses one before it lands, so
 * this only ever meets a module that is already wrong somewhere else.
 */
export function moduleNeeds(guild: readonly string[] | undefined): ModuleNeed[] {
  const out: ModuleNeed[] = [];
  for (const id of guild ?? []) {
    const seed = SEEDS_BY_ID[id];
    if (!seed) continue;
    out.push({
      id: seed.id,
      title: seed.title,
      provider: seed.provider.name,
      consequence: seed.consequence,
      cost: seed.cost,
      undo: seed.undo,
      keystone: seed.risk === "keystone",
      required: seed.need === "required",
      rotation: rotationLine(seed),
    });
  }
  return out;
}

/**
 * The needs of a whole plan, each seed once, with the modules that share it.
 * Two money modules both need the Stripe key, and a founder plants it once.
 */
export function planNeeds(
  plan: readonly { id: string; name: string; needs?: readonly ModuleNeed[] | null }[],
): { need: ModuleNeed; forModules: string[] }[] {
  const byId = new Map<string, { need: ModuleNeed; forModules: string[] }>();
  for (const m of plan) {
    for (const need of m.needs ?? []) {
      const row = byId.get(need.id);
      if (row) row.forModules.push(m.name);
      else byId.set(need.id, { need, forModules: [m.name] });
    }
  }
  return Array.from(byId.values());
}
