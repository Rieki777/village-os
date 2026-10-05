/**
 * THE LIVING MAP ARTIFACT'S WINDOW, AND THE ONLY PLACE A TEST EVALUATES CODE IN IT.
 *
 * The shared/mapArtifact*.test.ts suites load the real artifact
 * (docs/prototypes/grounds-v0.html) into jsdom with its scripts switched on,
 * then read and steer it through its own globals. Those globals are top-level
 * `const` and `let` bindings (`const cam`, `const SCENE`, `let JWALK`), which
 * live in the window's global scope and are NOT properties of the window:
 * `window.cam` is undefined, while evaluating `cam` in the window gives the
 * camera. So an eval is the one way in, and it is always a string the test
 * wrote or one the artifact itself holds (a button's own `onclick`, the worker
 * source the page builds), run inside a jsdom window that lives only as long
 * as the test.
 *
 * WHY THESE LIVE HERE. Module intake (scripts/validate-module.mjs) greps every
 * added line for eval and `new Function`, because remote or computed code
 * defeats review, and a genuine exception takes a `module-review-ok:` waiver
 * on the flagged line itself. Fifteen suites each declaring and calling their
 * own `window.eval` came to 48 such lines on 2026-10-02, when they moved here.
 * Here they are two, each waived on its line, and the suites import them. A
 * suite that writes `window.eval` again is a new finding, which keeps this
 * list short enough to read.
 *
 * Kept beside the suites in a `test/` folder, the way client/src/test holds
 * the helpers the client's tests share.
 */

/** The jsdom window the artifact runs in: a browser window, with that realm's own globals. */
export type ArtifactWindow = Window & typeof globalThis;

/**
 * Evaluate `src` in the artifact window's global scope and hand back its value.
 *
 * `window.eval` called as a method is an indirect eval, so it runs at the
 * window's global scope wherever this function is called from, and sees the
 * artifact's top-level bindings exactly as a script on that page would.
 */
export function evalIn<T = unknown>(window: ArtifactWindow, src: string): T {
  return window.eval(src) as T; // module-review-ok: evaluates the artifact's own globals inside a jsdom sandbox, in a test
}

/**
 * `data`, rebuilt by the window's own JSON, so every object and array in it
 * belongs to the artifact's realm, the way a structured clone posted by the
 * shell arrives. The window's JSON is looked up by name inside the window,
 * so it is that realm's own and never this file's.
 */
export function ownCopy<T>(window: ArtifactWindow, data: T): T {
  return evalIn<JSON>(window, "JSON").parse(JSON.stringify(data)) as T;
}

/**
 * The artifact's bake worker, built from the source text its page makes
 * (`bakeWorkerSource()`), as a function of the one name a worker is handed
 * from outside, `postMessage`.
 *
 * It runs in the TEST's realm and not the window's, on purpose: the page's
 * realm is slow at arithmetic, and a worker has no document and none of the
 * page's globals anyway, so a step that reached for one throws here before it
 * would throw in a browser's worker. The source is run whole, never spliced.
 */
export function workerFromSource<M>(source: string): (postMessage: (message: M) => void) => void {
  return new Function("postMessage", source) as (postMessage: (message: M) => void) => void; // module-review-ok: compiles the worker source the artifact's own page builds, in a test, the way a browser starts that worker
}
