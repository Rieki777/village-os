/**
 * THE SETUP GAME'S MAP, `GET /api/admin/setup-game`.
 *
 * Rye, 2026-10-31: "let's get this shipped and I want to be able to play this
 * game right now for setting up amora's settings like resend". The setup game
 * (the approved prototype in SETUP_GAME_DESIGN_2026-10-09.md) draws every layer
 * of the forest from the closed seed catalog in shared/guilds.ts. That catalog
 * stays out of the client bundle, for the same reason the Module Library serves
 * `moduleNeeds` from the server, so this route hands the page the catalog's
 * words and the state of each seed's handles, and nothing more.
 *
 * WHAT NEVER LEAVES. A secret's value. A village-secret handle answers whether
 * it is planted, where from, and its last four characters, exactly what
 * `GET /api/admin/integrations` already shows the same admin. An env handle
 * answers whether the variable is set, never its value. Every sentence a seed
 * carries is platform copy from the catalog: the page writes no consent text of
 * its own, and no agent ever does (the setup game's first rule).
 *
 * WHAT IT DOES NOT DECIDE. Whether a seed is ALIVE. Presence is not health
 * (ruling of 2026-10-13, "green means a live check passed"), so the page merges
 * this answer with the live readers that already exist: the launch rows at
 * `GET /api/admin/launch` (keyed by `launchRequirement`) and the comms setup
 * checklist at `GET /api/admin/comms/settings`, whose item 13 is the delivered
 * test email. A seed with neither stays "planted, not yet proven".
 *
 * Admin only, the door `/api/admin/integrations` and `/api/admin/launch` use. A
 * read that creates nothing and calls nobody, so there is nothing to bound.
 * Registered from server/routes/moduleLibrary.ts, so server/index.ts does not
 * grow.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { PLATFORM_GUILDS, SEEDS_BY_ID, keystoneRule, type GuildSeed, type PlantingPhase } from "../../shared/guilds";
import { MODULES } from "../../shared/modules";
import { getPool } from "../db/pool";
import { plantingPhase } from "../lib/gameStart";
import { effectiveLifecycle } from "../lib/modules";
import { SECRET_KEYS, secretStatus, type SecretKey } from "../lib/secrets";

/** One handle, as the page may see it. Never a value. */
export interface HandleState {
  store: "village-secret" | "env" | "dns" | "module-config" | "slot-to-build";
  /** The slot, variable, record or config key, by name. */
  name: string;
  /** True or false where this server can tell; null where only a live check can. */
  planted: boolean | null;
  /** Where a planted village secret came from, and its last four characters. */
  source?: "admin" | "env" | "none";
  last4?: string | null;
}

export interface SeedState {
  id: string;
  title: string;
  kind: GuildSeed["kind"];
  provider: string;
  url: string | null;
  consequence: string;
  undo: string;
  cost: string;
  need: GuildSeed["need"];
  keystone: boolean;
  /** A read pause before planting, always, for a keystone. */
  readPause: boolean;
  /** Who may say yes now: one founder before launch, a co-sign after. */
  approval: "one-founder" | "co-sign-or-cooling-off";
  lifespan: GuildSeed["lifespan"];
  bootstrap: boolean;
  dependsOn: string[];
  launchRequirement: string | null;
  /** `alive` is the only strength that can ever turn a seed green. */
  liveStrength: "present" | "confirmed" | "alive";
  proves: string;
  byHand: string | null;
  handles: HandleState[];
  /** What the handles alone say: all planted, some, none, or not knowable here. */
  planted: "yes" | "partly" | "no" | "unknown";
}

export interface SetupGameMap {
  village: string;
  phase: PlantingPhase;
  layers: Array<{ id: string; layer: string; title: string; seeds: string[] }>;
  modules: Array<{ id: string; name: string; group: string | null; setup: "none" | "optional" | "required"; lifecycle: string; core: boolean; seeds: string[] }>;
  seeds: Record<string, SeedState>;
}

/** What the map reads about handles. Injected so a test never touches a store. */
export interface HandleReader {
  secret(slot: string): { configured: boolean; source: "admin" | "env" | "none"; last4: string | null } | null;
  env(name: string): boolean;
}

export const liveHandleReader: HandleReader = {
  secret(slot) {
    if (!(SECRET_KEYS as readonly string[]).includes(slot)) return null;
    const s = secretStatus(slot as SecretKey);
    return { configured: s.configured, source: s.source as "admin" | "env" | "none", last4: s.last4 };
  },
  env(name) {
    return !!String(process.env[name] ?? "").trim();
  },
};

export function seedState(seed: GuildSeed, read: HandleReader, phase: PlantingPhase): SeedState {
  const handles: HandleState[] = seed.handles.map((h) => {
    switch (h.store) {
      case "village-secret": {
        const s = read.secret(h.slot);
        return s
          ? { store: h.store, name: h.slot, planted: s.configured, source: s.source, last4: s.last4 }
          : { store: h.store, name: h.slot, planted: null };
      }
      case "env":
        return { store: h.store, name: h.name, planted: read.env(h.name) };
      case "dns":
        return { store: h.store, name: h.record, planted: null };
      case "module-config":
        return { store: h.store, name: `${h.module}.${h.key}`, planted: null };
      case "slot-to-build":
        return { store: h.store, name: h.name, planted: null };
    }
  });
  // A village secret's env handle is its fallback for the SAME value, and
  // `secretStatus` already answers through it, so where a seed has a readable
  // village secret, the secrets decide. An env-only seed (the Google client's
  // id and secret, say) needs every variable it names.
  const secrets = handles.filter((h) => h.store === "village-secret" && h.planted !== null);
  const envs = handles.filter((h) => h.store === "env");
  const deciding = secrets.length > 0 ? secrets : envs;
  const yes = deciding.filter((h) => h.planted).length;
  const planted: SeedState["planted"] =
    deciding.length === 0 ? "unknown" : yes === deciding.length ? "yes" : yes > 0 ? "partly" : "no";
  const demand = keystoneRule(seed.risk, phase);
  return {
    id: seed.id,
    title: seed.title,
    kind: seed.kind,
    provider: seed.provider.name,
    url: seed.provider.url,
    consequence: seed.consequence,
    undo: seed.undo,
    cost: seed.cost,
    need: seed.need,
    keystone: seed.risk === "keystone",
    readPause: demand.readPause,
    approval: demand.approval,
    lifespan: seed.lifespan,
    bootstrap: !!seed.bootstrap,
    dependsOn: [...seed.dependsOn],
    launchRequirement: seed.launchRequirement ?? null,
    liveStrength: seed.liveCheck.strength,
    proves: seed.liveCheck.proves,
    byHand: seed.byHand?.how ?? null,
    handles,
    planted,
  };
}

export function setupGameMap(
  village: string,
  phase: PlantingPhase,
  read: HandleReader,
  lifecycleOf: (id: string) => string,
): SetupGameMap {
  const ids = new Set<string>();
  for (const g of PLATFORM_GUILDS) g.seeds.forEach((id) => ids.add(id));
  for (const m of MODULES) (m.guild ?? []).forEach((id) => ids.add(id));
  const seeds: Record<string, SeedState> = {};
  for (const id of Array.from(ids)) {
    const seed = SEEDS_BY_ID[id];
    if (seed) seeds[id] = seedState(seed, read, phase);
  }
  return {
    village,
    phase,
    layers: PLATFORM_GUILDS.map((g) => ({ id: g.id, layer: g.layer, title: g.title, seeds: g.seeds.filter((id) => !!seeds[id]) })),
    modules: MODULES.map((m) => ({
      id: m.id,
      name: m.name,
      group: m.group ?? null,
      setup: m.setup ?? "none",
      lifecycle: lifecycleOf(m.id),
      core: !!m.core,
      seeds: (m.guild ?? []).filter((id) => !!seeds[id]),
    })),
    seeds,
  };
}

type Deps = Pick<AppDeps, "isAdmin" | "projectName">;

export function register(app: Express, deps: Deps): void {
  app.get("/api/admin/setup-game", async (req, res) => {
    if (!(await deps.isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const phase = await plantingPhase(getPool());
    res.json(setupGameMap(deps.projectName(), phase, liveHandleReader, (id) => effectiveLifecycle(id)));
  });
}
