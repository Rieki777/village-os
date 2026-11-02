/**
 * TWO SIGNATURES TO HAND A POWER TO THE VILLAGE (Rye, 2026-11-01): whenever
 * two or more people may sign, a launch selection or a hand-over after launch
 * waits for a second, different signer.
 *
 * Who may sign is the hand-over control's own rule (server/routes/
 * stewardHandover.ts): the live stewards, and before the Game starts the
 * founders as well. With one person able to sign, their act lands at once,
 * because nobody exists to ask.
 *
 * THE SHAPE IS #747's CO-SIGN (the setup game's keystone keys): one pending
 * request that names who asked, completed only by somebody else who may sign,
 * and gone after a while if nobody does. Never the person who asked.
 *
 * ONE PENDING REQUEST, in one `app_config` document. A signer who sends the
 * SAME list signs it; a signer who sends a different list starts a new
 * request in its place, which the village's record shows. A request made on
 * one side of the launch never completes on the other: the stage is part of
 * what was signed.
 */
import type { Pool } from "mysql2/promise";
import type { Capability } from "../../shared/capabilities";
import { readConfigDocument, writeConfigDocument } from "../repos/appConfigDocs";
import { onlyHandoverPowers } from "./launchHandover";

export const PENDING_HANDOVER_KEY = "handover-pending";

/** How long a request waits for its second signature: a week, then it is gone. */
export const COSIGN_WAIT_DAYS = 7;

export type HandoverStage = "launch" | "now";

export interface PendingHandover {
  stage: HandoverStage;
  /** In `HANDOVER_SET` order, so two signers sending one list in two orders sign the same request. */
  capabilities: Capability[];
  requestedBy: string;
  requestedAt: string;
  expiresAt: string;
}

/** Two or more people able to sign means two signatures. */
export function needsCosign(signers: readonly string[]): boolean {
  return new Set(signers).size >= 2;
}

/** The request waiting on this side of the launch, or null when there is none, it has lapsed, or it belongs to the other side. */
export async function readPendingHandover(pool: Pool, stage: HandoverStage, now: Date = new Date()): Promise<PendingHandover | null> {
  const doc = await readConfigDocument<Partial<PendingHandover>>(pool, PENDING_HANDOVER_KEY);
  if (!doc || doc.stage !== stage || !doc.requestedBy || !doc.expiresAt) return null;
  if (new Date(String(doc.expiresAt)).getTime() <= now.getTime()) return null;
  return {
    stage,
    capabilities: onlyHandoverPowers(doc.capabilities),
    requestedBy: String(doc.requestedBy),
    requestedAt: String(doc.requestedAt ?? ""),
    expiresAt: String(doc.expiresAt),
  };
}

export async function askForCosign(
  pool: Pool,
  stage: HandoverStage,
  capabilities: readonly string[],
  requestedBy: string,
  now: Date = new Date(),
): Promise<PendingHandover> {
  const pending: PendingHandover = {
    stage,
    capabilities: onlyHandoverPowers(capabilities),
    requestedBy,
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + COSIGN_WAIT_DAYS * 86400000).toISOString(),
  };
  await writeConfigDocument(pool, PENDING_HANDOVER_KEY, { ...pending });
  return pending;
}

/** The request is done with: signed, or replaced by the act it asked for. */
export async function clearPendingHandover(pool: Pool): Promise<void> {
  await writeConfigDocument(pool, PENDING_HANDOVER_KEY, { cleared: true });
}

/** Is this the same list, whatever order it came in. */
export function sameList(a: readonly string[], b: readonly string[]): boolean {
  const x = onlyHandoverPowers(a);
  const y = onlyHandoverPowers(b);
  return x.length === y.length && x.every((c, i) => c === y[i]);
}
