/**
 * What the map promises, and what the site is allowed to answer.
 *
 * A visitor standing on the Living Map can say they are coming to a gathering
 * or that they will take a quest. The map toggles optimistically, posts to the
 * shell, and waits. This module is the shared vocabulary of that exchange, so
 * the artifact, the server and the tests all name the same things.
 *
 * The wire shape belongs to the MAP, agreed with the map lane and implemented
 * in `docs/prototypes/grounds-v0.html`. Field names stay snake-free and exactly
 * as the artifact reads them.
 *
 * ── THREE RULES THAT ARE EASY TO BREAK ───────────────────────────────────
 *
 * 1. REPLY TO EVERY POST, including withdrawals and failures. The map cannot
 *    tell a missing reply from a missing shell.
 * 2. SILENCE MEANS THE OPTIMISTIC STATE STANDS. The artifact runs from
 *    `file://` with no parent in every QA suite, so a reply that never comes
 *    has to be survivable. The map waits 4s and moves on.
 * 3. ECHO THE NONCE EXACTLY. Nothing else correlates a reply to a post. Toggle
 *    on-off-on inside the window and three replies come back with the same
 *    `id` and `kind`; without the nonce a late one overwrites the state the
 *    person actually chose.
 */

/** Which promise. The map sends these as its message `type`. */
import type { ResolvedNextStep } from "./questNextStep";

export const PROMISE_KINDS = ["rsvp", "claim"] as const;
export type PromiseKind = (typeof PROMISE_KINDS)[number];

/**
 * Why a promise did not stand. Every one of these has a DIFFERENT remedy,
 * which is the only reason they are separate values.
 *
 * - `anonymous`  nobody is signed in. `href` is the way in.
 * - `not-yet`    signed in, and the capability gate says no. Signing in again
 *                fixes nothing; a steward has to open it.
 * - `closed`     the village has this switched off, or the thing is not
 *                taking answers, or it is a standing example.
 * - `paid`       the gathering asks for credits at the door. A member could
 *                walk in; a ONE-TAP lantern with no price beside it is what
 *                cannot say yes for them. Separate from `closed` because the
 *                remedy is different and because calling it closed was false
 *                to somebody who was welcome: the door to open is the
 *                gathering itself, where the fee is printed before anybody
 *                agrees to it, and `href` carries it.
 * - `full`       capacity.
 * - `not-here`   this village has never brought the scene across, so the row
 *                does not exist and never did. THE DEFAULT STATE OF A FRESH
 *                FORK, and the common case rather than the rare one. It is not
 *                an error and must not read like one.
 * - `gone`       the scene IS here and this one is not: deleted or cancelled.
 * - `error`      anything else. The map says so plainly and reverts.
 */
export const PROMISE_REASONS = [
  "anonymous", "not-yet", "closed", "paid", "full", "not-here", "gone", "error",
] as const;
export type PromiseReason = (typeof PROMISE_REASONS)[number];

/** What the map sends. `nonce` is opaque here and only ever echoed. */
export interface PromiseRequest {
  kind: PromiseKind;
  /** The map's own key: a scene event id, or a quest key. Never derived here. */
  id: string;
  /** True to make the promise, false to take it back. */
  on: boolean;
}

/**
 * What the shell sends back.
 *
 * `state` is the truth AFTER the server answered, and it is what the map
 * draws. It is not the same question as `ok`: asking to claim something you
 * already claimed is `ok: true, state: "on"`, because the person's intent is
 * satisfied and there is nothing to undo.
 */
export interface PromiseResult {
  ok: boolean;
  state: "on" | "off";
  reason?: PromiseReason;
  /** Authoritative going-count for a gathering. The map's own number yields. */
  count?: number;
  /** Where to send someone: the way in for `anonymous`, the gathering for `paid`. */
  href?: string;
  /** For a claim that is on: the next-step box (shared/questNextStep.ts), structured parts only. */
  next?: ResolvedNextStep | null;
}

export function isPromiseKind(v: unknown): v is PromiseKind {
  return typeof v === "string" && (PROMISE_KINDS as readonly string[]).includes(v);
}
