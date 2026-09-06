/**
 * THE SEEDED GENERATOR, so a preview can be run again and answer the same
 * thing.
 *
 * A dry run that used `Math.random` would give a village a different answer
 * every time it opened the same page, and a member who saw two answers has
 * been told nothing by either. So the seed is part of `SimInput`, it is
 * printed in `SimResult`, and this is the only randomness the engine hands a
 * model.
 *
 * ── WHICH GENERATOR, AND WHY ───────────────────────────────────────────────
 *
 * MULBERRY32, by Tommy Ettinger (public domain). Chosen for three reasons
 * that matter here and nowhere else:
 *
 *  1. It holds ONE 32-bit word of state, so a whole generator serialises to a
 *     number. A pass that has to be resumed or compared carries that word.
 *  2. It is pure integer arithmetic through `Math.imul`, so it produces the
 *     same sequence on every engine this build runs on. A generator that
 *     drifted between Node 22 in CI and Node 25 on a dev box would make a
 *     "same seed, same answer" test a coin toss.
 *  3. It passes gjrand's full suite at this state size, which is far more
 *     than a cycle simulation asks of it.
 *
 * It is NOT cryptographic and must never be reached for where that matters.
 * Nothing in a preview needs it to be.
 */
import type { Rng } from "./types";

/**
 * A generator for `seed`. Two generators made from the same seed give the
 * same sequence for as long as either is asked.
 */
export function makeRng(seed: number): Rng {
  // The seed is coerced the way the algorithm reads it: a 32-bit unsigned
  // word. A caller passing 1.5, NaN or a negative therefore gets a defined
  // generator, and the same one every time, which is what determinism means.
  let state = toWord(seed);
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(n: number): number {
      const bound = Math.floor(Number(n));
      if (!Number.isFinite(bound) || bound <= 0) return 0;
      return Math.floor(next() * bound);
    },
  };
}

/** The 32-bit unsigned word a seed reduces to, total over every input. */
export function toWord(seed: number): number {
  const n = Number(seed);
  return Number.isFinite(n) ? Math.trunc(n) >>> 0 : 0;
}
