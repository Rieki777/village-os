/**
 * TWO SIGNATURES TO REPLACE THE VILLAGE SIGNING KEY AFTER LAUNCH (the
 * coordinator, 2026-11-08, on Rye's two-signature rule: "it needs a co-sign
 * whenever 2 or more people can sign, the same as keystone secrets. One signer
 * alone may act only when they're the only possible signer, and it's logged").
 *
 * WHO CAN SIGN is the keystone co-sign's rule (server/lib/plantingRequests.ts):
 * every admin or founder with their own login, plus the admin pressing the
 * button. An agent never signs: a co-sign is a second person.
 *
 * WHEN IT APPLIES is the keystone's too: after the launch ballot carried
 * (`cosignPhase`). Before launch any one admin replaces the key at once, as a
 * founder plants a keystone at once.
 *
 * THE SHAPE IS THE HAND-OVER'S CO-SIGN (server/lib/handoverCosign.ts): ONE
 * pending request in one `app_config` document, naming who asked and which key
 * it replaces, completed only by a different signer, and gone after
 * `platform.cosign_expiry_hours` if nobody signs. A request for a key that has
 * since been replaced is stale, and a new press starts a fresh one.
 *
 * TWO SECOND SIGNERS PRESSING AT ONCE replace the key once: the co-sign is
 * claimed with INSERT IGNORE on the request's id before the key is touched
 * (server/repos/signingKeyRow.ts), and given back if the replacement fails.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "mysql2/promise";
import type { PlantingPhase } from "../../shared/guilds";
import { readConfigDocument, writeConfigDocument } from "../repos/appConfigDocs";
import { numberVar } from "./variables";

export const PENDING_ROTATION_KEY = "signing-key-rotation-pending";

export interface PendingRotation {
  id: string;
  requestedBy: string;
  requestedAt: string;
  expiresAt: string;
  /** The key this request replaces. Once that key is gone, the request is stale. */
  fromKid: string;
}

/** Two or more people able to sign, after launch, means two signatures. */
export function rotationNeedsCosign(phase: PlantingPhase, signers: readonly string[]): boolean {
  return phase === "after-launch" && new Set(signers.filter(Boolean)).size >= 2;
}

function expiryHours(): number {
  const n = Number(numberVar("platform.cosign_expiry_hours"));
  return Number.isFinite(n) && n > 0 ? n : 72;
}

/** The request waiting now, or null when there is none or it has lapsed. */
export async function readPendingRotation(pool: Pool, now: Date = new Date()): Promise<PendingRotation | null> {
  const doc = await readConfigDocument<Partial<PendingRotation>>(pool, PENDING_ROTATION_KEY);
  if (!doc?.id || !doc.requestedBy || !doc.expiresAt || !doc.fromKid) return null;
  if (new Date(String(doc.expiresAt)).getTime() <= now.getTime()) return null;
  return {
    id: String(doc.id),
    requestedBy: String(doc.requestedBy),
    requestedAt: String(doc.requestedAt ?? ""),
    expiresAt: String(doc.expiresAt),
    fromKid: String(doc.fromKid),
  };
}

export async function askForRotation(pool: Pool, requestedBy: string, fromKid: string, now: Date = new Date()): Promise<PendingRotation> {
  const pending: PendingRotation = {
    id: `rotate-${randomUUID()}`,
    requestedBy,
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + expiryHours() * 3600_000).toISOString(),
    fromKid,
  };
  await writeConfigDocument(pool, PENDING_ROTATION_KEY, { ...pending });
  return pending;
}

/** The request is done with: signed, declined, withdrawn, or replaced by a rotation that needed none. */
export async function clearPendingRotation(pool: Pool): Promise<void> {
  await writeConfigDocument(pool, PENDING_ROTATION_KEY, { cleared: true });
}

export interface RotationAsk {
  phase: PlantingPhase;
  /** Every admin or founder with their own login. */
  signers: readonly string[];
  actor: string;
  /** False for an agent token: it may ask, and it never co-signs. */
  actorIsPerson: boolean;
  pending: PendingRotation | null;
  currentKid: string;
}

export type RotationDecision =
  /** Replace it now. `alone` is the logged case: after launch, with nobody else able to sign. */
  | { kind: "rotate"; alone: boolean }
  /** Open a request (or show the one this actor already opened) and wait for a second signer. */
  | { kind: "ask"; existing: PendingRotation | null }
  /** A different signer completes the request. */
  | { kind: "cosign"; pending: PendingRotation }
  | { kind: "refuse"; status: number; error: string };

/** What one press of "replace the key" does. Pure, so every branch is tested without a server. */
export function decideRotation(a: RotationAsk): RotationDecision {
  const able = [...a.signers, a.actor];
  if (!rotationNeedsCosign(a.phase, able)) return { kind: "rotate", alone: a.phase === "after-launch" };
  const pending = a.pending && a.pending.fromKid === a.currentKid ? a.pending : null;
  if (!pending) return { kind: "ask", existing: null };
  if (pending.requestedBy === a.actor) return { kind: "ask", existing: pending };
  if (!a.actorIsPerson) {
    return { kind: "refuse", status: 403, error: "A co-sign is a second person, signed in with their own login. An agent cannot give one." };
  }
  if (!a.signers.includes(a.actor)) {
    return { kind: "refuse", status: 403, error: "Co-signing a new signing key is for an admin with their own login." };
  }
  return { kind: "cosign", pending };
}
