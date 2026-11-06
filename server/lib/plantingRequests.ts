/**
 * THE SETUP GAME'S CO-SIGN: after launch, a keystone key waits for a second
 * person (SETUP_GAME_COSIGN_DESIGN_2026-10-31 in the Amora folder; the
 * coordinator took its five defaults on 2026-10-31).
 *
 * `keystoneRule` (shared/guilds.ts) has said it since 2026-10-13: before launch
 * any one founder plants a keystone; after launch it takes a second person's
 * co-sign, or a cooling-off pause when nobody else can co-sign. This file is
 * the enforcing half, at the one door every key is saved through
 * (`PUT /api/admin/integrations/:key`).
 *
 *   who co-signs     any OTHER admin with their own login, the mint co-sign's
 *                    rule (0106). Never the person who asked, never an agent.
 *   nobody else      ONE ADMIN MUST NOT BE LOCKED OUT (the coordinator's fix).
 *                    The request lands after `platform.cosign_cooling_hours`
 *                    on its own, and the steward and founder role holders are
 *                    told, and may decline it in that time.
 *   expiry           an unsigned co-sign is dropped after
 *                    `platform.cosign_expiry_hours`, and its value wiped.
 *   clearing a key   stays immediate and is never held here: a leaked key must
 *                    always be pullable at once.
 *
 * THE VALUE is sealed with VILLAGE_SECRETS_KEY exactly as the store seals it,
 * read back only at the moment it is planted, and wiped the moment the request
 * leaves `pending`. Nothing here ever returns it.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "mysql2/promise";
import { SEEDS, keystoneRule, type PlantingPhase } from "../../shared/guilds";
import { NO_VILLAGE_SECRETS_KEY_SENTENCE, putSecret, villageSecretsKey, type SecretKey } from "./secrets";
import { openWith, sealWith } from "./sealedBox";
import { numberVar } from "./variables";
import * as repo from "../repos/plantingRequests";
import type { NotifyInput } from "./notify";
import { launchBallotCarried } from "./launch";

/**
 * WHICH SIDE OF LAUNCH A PLANTING IS ON, for the co-sign and for what the
 * setup game shows. ONE function, so the game never shows a co-sign the door
 * does not ask for.
 *
 * The launch ballot carrying (`launchBallotCarried`), Rye's "before they go
 * live" and the module switch's meaning of launch. It is NOT `plantingPhase`
 * (game start), which reads as live for a village migration 0112 marked
 * started and for every village the test harness provisions: that would hold
 * a pre-launch village's keys for a co-sign. The coordinator confirmed the
 * launch ballot on 2026-10-31, and rejected game start for exactly those 0112
 * villages: Amora's launch vote is pending on purpose, so it is not live.
 */
export async function cosignPhase(pool: Pool): Promise<PlantingPhase> {
  return (await launchBallotCarried(pool)) ? "after-launch" : "before-launch";
}

/** Slots whose seed is a keystone held in the village's own store: the only ones a co-sign can hold. Derived, never typed. */
export const COSIGN_SLOTS: ReadonlyMap<string, string> = new Map(
  SEEDS.filter((s) => s.risk === "keystone").flatMap((s) =>
    s.handles.flatMap((h) => (h.store === "village-secret" ? [[h.slot, s.title] as [string, string]] : [])),
  ),
);

/** True when saving this slot in this phase waits for a second person. */
export function needsCosign(slot: string, phase: PlantingPhase): boolean {
  return COSIGN_SLOTS.has(slot) && keystoneRule("keystone", phase).approval === "co-sign-or-cooling-off";
}

export interface Person {
  id: string;
  name: string;
}

export interface AskInput {
  slot: string;
  value: string;
  requestedBy: Person;
  /** Every admin with their own login, the asker included or not: the asker is taken out here. */
  admins: readonly Person[];
  /** Steward and founder role holders, told during a cooling-off. */
  objectors: readonly string[];
  notify: (n: NotifyInput) => Promise<unknown>;
  env?: NodeJS.ProcessEnv;
}

export interface Asked {
  asked: true;
  id: string;
  mode: repo.PlantingMode;
  message: string;
}

const hours = (key: string, fallback: number): number => {
  const n = Number(numberVar(key));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export async function askToPlant(pool: Pool, input: AskInput): Promise<Asked> {
  const key = villageSecretsKey(input.env ?? process.env);
  if (!key) throw new Error(NO_VILLAGE_SECRETS_KEY_SENTENCE);
  const value = input.value.trim();
  const cosigners = input.admins.filter((a) => a.id !== input.requestedBy.id);
  const mode: repo.PlantingMode = cosigners.length > 0 ? "cosign" : "cooling_off";
  const coolingHours = hours("platform.cosign_cooling_hours", 48);
  const id = `plant-${randomUUID()}`;
  await repo.insertPlantingRequest(pool, {
    id,
    slot: input.slot,
    sealed: sealWith(key, value),
    last4: value.slice(-4),
    requestedBy: input.requestedBy.id,
    mode,
    coolingHours,
    expiryHours: hours("platform.cosign_expiry_hours", 72),
  });
  const what = COSIGN_SLOTS.get(input.slot) ?? input.slot;
  if (mode === "cosign") {
    for (const c of cosigners) {
      await input.notify({
        userId: c.id,
        type: "governance",
        title: `${input.requestedBy.name} asked you to co-sign a key: ${what}`,
        body: "The village has launched, so a key that touches money, email or the hosting needs a second admin. Open the setup game to co-sign or decline it.",
        link: "/setup-game",
        actorUserId: input.requestedBy.id,
        dedupeKey: `planting:${id}:${c.id}`,
      });
    }
    return { asked: true, id, mode, message: "Asked for a co-sign. Another admin approves it in the setup game, and then it is saved." };
  }
  for (const uid of Array.from(new Set(input.objectors))) {
    if (uid === input.requestedBy.id) continue;
    await input.notify({
      userId: uid,
      type: "governance",
      title: `A key lands in ${coolingHours} hours unless somebody declines it: ${what}`,
      body: `${input.requestedBy.name} saved it, and nobody else can co-sign. Open the setup game to decline it before it lands.`,
      link: "/setup-game",
      actorUserId: input.requestedBy.id,
      dedupeKey: `planting:${id}:${uid}`,
    });
  }
  return {
    asked: true,
    id,
    mode,
    message: `Nobody else can co-sign, so it lands in ${coolingHours} hours unless a steward or founder declines it.`,
  };
}

export type Decision = { ok: true } | { ok: false; status: number; error: string };

/** Plant a pending request's value: the claim, then the save, and the claim put back if the save fails. */
async function plant(pool: Pool, row: repo.PlantingRequestRow, by: string, env: NodeJS.ProcessEnv): Promise<Decision> {
  const key = villageSecretsKey(env);
  const sealed = await repo.sealedValueOf(pool, row.id);
  const value = key && sealed ? openWith(key, sealed) : null;
  if (!value) {
    await repo.decidePlantingRequest(pool, row.id, "expired", by);
    return { ok: false, status: 409, error: "This key can no longer be opened here, so nothing was saved. Save it again." };
  }
  if (!(await repo.decidePlantingRequest(pool, row.id, "planted", by))) {
    return { ok: false, status: 409, error: "Somebody else has just decided this key." };
  }
  try {
    await putSecret(pool, row.slot as SecretKey, value, row.requestedBy, env);
  } catch (e: any) {
    await repo.reopenPlantingRequest(pool, row.id);
    return { ok: false, status: 503, error: String(e?.message ?? e) };
  }
  await repo.wipePlantedValue(pool, row.id);
  return { ok: true };
}

export async function cosignPlanting(pool: Pool, id: string, by: Person, env: NodeJS.ProcessEnv = process.env): Promise<Decision> {
  const row = await repo.plantingRequestById(pool, id);
  if (!row) return { ok: false, status: 404, error: "No such key is waiting." };
  if (row.status !== "pending") return { ok: false, status: 409, error: `This key is already ${row.status}.` };
  if (row.requestedBy === by.id) return { ok: false, status: 409, error: "A co-sign means somebody else. You asked for this key." };
  return plant(pool, row, by.id, env);
}

/** Decline (anybody who may), or withdraw (the person who asked). The value is wiped either way. */
export async function declinePlanting(pool: Pool, id: string, by: Person): Promise<Decision> {
  const row = await repo.plantingRequestById(pool, id);
  if (!row) return { ok: false, status: 404, error: "No such key is waiting." };
  if (row.status !== "pending") return { ok: false, status: 409, error: `This key is already ${row.status}.` };
  const status = row.requestedBy === by.id ? "withdrawn" : "declined";
  return (await repo.decidePlantingRequest(pool, id, status, by.id))
    ? { ok: true }
    : { ok: false, status: 409, error: "Somebody else has just decided this key." };
}

/** The job: cooling-offs whose time has come land, unsigned co-signs expire. */
export async function sweepPlantings(pool: Pool, env: NodeJS.ProcessEnv = process.env): Promise<{ landed: number; expired: number }> {
  const due = await repo.duePlantingRequests(pool);
  let landed = 0;
  for (const id of due.land) {
    const row = await repo.plantingRequestById(pool, id);
    if (row && (await plant(pool, row, "cooling-off", env)).ok) landed += 1;
  }
  let expired = 0;
  for (const id of due.expire) if (await repo.decidePlantingRequest(pool, id, "expired", "expiry")) expired += 1;
  return { landed, expired };
}

/** What the setup game shows: never a value, only its last four characters. */
export async function waitingPlantings(pool: Pool): Promise<Array<repo.PlantingRequestRow & { title: string }>> {
  return (await repo.pendingPlantingRequests(pool)).map((r) => ({ ...r, title: COSIGN_SLOTS.get(r.slot) ?? r.slot }));
}
