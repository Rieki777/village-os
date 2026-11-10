/**
 * A FASTER CLOCK FOR THE LIVING MAP'S TIMER-BOUND TESTS.
 *
 * Some map suites prove behaviour that is defined by waiting: a save that is
 * "slower than eight seconds", a retry back-off, a refusal that must NOT retry
 * for a while. They waited in real time, so one file (mapArtifactDraftMark) held
 * a CI shard for 150 s, nearly all of it a test sleeping (CI audit, 2026-11-10).
 *
 * `speedUp(window)` runs the ARTIFACT'S clock `TIME_SCALE` times faster than the
 * test's: its setTimeout and setInterval delays are divided by the scale, and
 * its Date and performance.now run on the same scaled clock, so a comparison
 * the page makes between two readings ("has this been pending for 8 s") still
 * agrees with the timers it set. `settleFor(ms)` is the test-side wait for the
 * same span, so `settleFor(8500)` is 8.5 page-seconds in 1/TIME_SCALE the time.
 *
 * WHAT IT COSTS. Page code that runs for a long time on the CPU also reads as
 * longer in page time, by the same factor; a test that leans on a threshold near
 * a long synchronous stretch could trip early. The scale is therefore modest,
 * and a suite opts in one file at a time. Layout, rAF and the event loop are
 * not scaled. Only suites whose waits are all `settle(...)` calls opt in.
 */

export const TIME_SCALE = 6;

type Timer = (handler: TimerHandler, delay?: number, ...args: unknown[]) => number;

/** Scale the page's timers and clocks. Call from JSDOM's `beforeParse`. */
export function speedUp(w: Window & typeof globalThis): void {
  const realNow = Date.now.bind(Date);
  const t0 = realNow();
  const virtualNow = () => t0 + (realNow() - t0) * TIME_SCALE;

  const wrap = (name: "setTimeout" | "setInterval") => {
    const real = w[name].bind(w) as Timer;
    Object.defineProperty(w, name, {
      configurable: true,
      writable: true,
      value: (handler: TimerHandler, delay?: number, ...args: unknown[]) => real(handler, (Number(delay) || 0) / TIME_SCALE, ...args),
    });
  };
  wrap("setTimeout");
  wrap("setInterval");

  const RealDate = w.Date;
  class ScaledDate extends RealDate {
    constructor(...args: unknown[]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (args.length === 0) super(virtualNow());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      else super(...(args as [any]));
    }
    static override now() {
      return virtualNow();
    }
  }
  Object.defineProperty(w, "Date", { configurable: true, writable: true, value: ScaledDate });

  const perfStart = w.performance.now();
  const perfT0 = realNow();
  Object.defineProperty(w.performance, "now", {
    configurable: true,
    value: () => perfStart + (realNow() - perfT0) * TIME_SCALE,
  });
}

/** The test's wait for `ms` of PAGE time. */
export const settleFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms / TIME_SCALE));
