/**
 * WHAT A MODULE NEEDS BEYOND ITS KEYS: the setup needs manifest.
 *
 * Named "setup needs" on purpose: shared/needs.ts is the ten human needs, and
 * shared/moduleNeeds.ts is the Module Library's reader over guild seeds.
 *
 * Every module already declares its guild, the seeds from the closed catalog
 * in `shared/guilds.ts` (keys, accounts, records) that must be planted before
 * it can run. The setup game's agent-first pass (2026-10-14, the design brief's
 * "One journey for every module") found that guilds cover only a fraction of
 * what standing a module up takes: 22 of 28 modules declare no seeds, and the
 * settings, words, content and people they wait for lived only in code, one
 * readiness hint at a time. Rye's ruling of 2026-11-01 (decision sheet item
 * 32): only the BEFORE-LAUNCH needs of the guilds a village chose block launch.
 *
 * A NEED IS EVERYTHING EXCEPT A SEED. Seeds stay in the guild and are never
 * copied here, so a key is described in exactly one place. A need is one of:
 *
 *   decision  a dial a founder sets (`ref` is the dial key in gameVariables).
 *   words     text only the village can write (`ref` names the field).
 *   content   something the village makes on the module's own screen: a
 *             circle, a room, a product. `ref` is the module's own id, because
 *             its readiness reader (server/lib/modules.ts) is what sees it.
 *   hands     a person who must hold a power (`ref` is the capability key).
 *   check     a live check that proves the module works end to end.
 *
 * WHERE A NEED SHOWS UP, by phase:
 *   before-enable  the module cannot sensibly switch on without it.
 *   before-launch  it blocks the launch vote, for a village that chose this
 *                  module.
 *   after-launch   it is asked after launch, as a handover.
 *   later          optional growth; never blocks.
 *
 * `since` is the platform release that added the need. A village that is
 * already live compares it against the needs it has seen, which is how a
 * module that gains a need reaches villages running it (the setup game's
 * "a new seed arrived" event).
 *
 * This file imports nothing, so module intake and the client can both load it.
 */

export type NeedKind = "decision" | "words" | "content" | "hands" | "check";
export type NeedScope = "village" | "member";
export type NeedPhase = "before-enable" | "before-launch" | "after-launch" | "later";

export interface SetupNeed {
  /** Unique within the module, kebab-case. */
  id: string;
  kind: NeedKind;
  /** The dial key, field name, readiness id or capability this need is about. */
  ref: string;
  /** What a founder reads, as a short imperative. Platform copy. */
  title: string;
  scope: NeedScope;
  phase: NeedPhase;
  need: "required" | "recommended" | "optional";
  /** An app route where it is done: "/admin?tab=…", "/modules/<id>" and the like. */
  fixAt: string;
  /** The platform release that added it, "1.2.0". */
  since: string;
  /** Read out of code, or still an open question. */
  certainty: "verified" | "unverified";
  /** Where in the repository the claim was read. */
  source: string;
}

/** What `needsProblems` reads about a module. Structural, so this file imports nothing. */
export interface SetupNeedsModule {
  id: string;
  setup?: "none" | "optional" | "required";
  guild?: readonly string[];
  setupNeeds?: readonly SetupNeed[];
}

export interface SetupNeedsContext {
  dialKeys: ReadonlySet<string>;
  capabilities: ReadonlySet<string>;
}

const NEED_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * Every problem with the modules' needs, as plain sentences. Empty means sound.
 * Module intake and the tests both call this, so there is one opinion.
 *
 * Without `ctx`, dial and capability references are not resolved: module
 * intake transpiles only a few shared files and cannot load the registries
 * those live in, so it checks the shape here and leaves resolution to
 * shared/setupNeeds.test.ts, which CI runs over the whole registry.
 */
export function setupNeedsProblems(defs: readonly SetupNeedsModule[], ctx?: SetupNeedsContext): string[] {
  const out: string[] = [];
  for (const m of defs) {
    const needs = m.setupNeeds ?? [];
    const setup = m.setup ?? "none";
    const requiredSeeds = (m.guild ?? []).length > 0;
    if (setup !== "none" && !needs.some((n) => n.need === "required") && !requiredSeeds) {
      out.push(`module "${m.id}" says its setup is ${setup} but declares no required need and no seed`);
    }
    const seen = new Set<string>();
    for (const n of needs) {
      const at = `module "${m.id}" need "${n.id}"`;
      if (!NEED_ID.test(n.id)) out.push(`${at}: the id is not kebab-case`);
      if (seen.has(n.id)) out.push(`${at}: the id appears twice`);
      seen.add(n.id);
      if (!n.title.trim()) out.push(`${at}: no title`);
      if (!n.fixAt.startsWith("/")) out.push(`${at}: fixAt must be an app route starting with "/"`);
      if (!SEMVER.test(n.since)) out.push(`${at}: since must be a release like 1.2.0`);
      if (!n.source.trim()) out.push(`${at}: no source`);
      switch (n.kind) {
        case "decision":
          if (ctx && !ctx.dialKeys.has(n.ref)) out.push(`${at}: "${n.ref}" is not a dial in shared/gameVariables.ts`);
          break;
        case "hands":
          if (ctx && !ctx.capabilities.has(n.ref)) out.push(`${at}: "${n.ref}" is not a capability in shared/capabilities.ts`);
          break;
        case "content":
          if (n.ref !== m.id) out.push(`${at}: content is seen by the module's own readiness reader, so ref must be "${m.id}"`);
          break;
        case "words":
        case "check":
          if (!n.ref.trim()) out.push(`${at}: no ref`);
          break;
      }
    }
  }
  return out;
}

/** The needs a village that chose these modules must meet before its launch vote opens. */
export function launchSetupNeeds<M extends SetupNeedsModule & { name?: string }>(chosen: readonly M[]): Array<{ module: M; need: SetupNeed }> {
  return chosen.flatMap((m) => (m.setupNeeds ?? []).filter((n) => n.phase === "before-launch" && n.need === "required").map((need) => ({ module: m, need })));
}
