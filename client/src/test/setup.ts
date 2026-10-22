/**
 * Global setup for CLIENT component tests only.
 *
 * Registered once in vitest.config.ts's `setupFiles`, so it runs before
 * every test file in the suite - server tests included. That is
 * deliberate, not an oversight: `@testing-library/jest-dom/vitest` only
 * calls `expect.extend(...)` at import time, which is inert without a DOM
 * and costs a server test nothing. Splitting this into a client-only setup
 * file would need a second vitest project/environment split, which is more
 * ceremony than this harness needs for its first component tests. If this
 * file ever needs something that actually touches `window` or `document` at
 * import time, THAT is the point to split it out, not before.
 *
 * The environment itself (jsdom vs node) is set PER TEST FILE with a
 * `// @vitest-environment jsdom` docblock at the top of the file, not here -
 * vitest.config.ts's own comment explains why the global environment stays
 * "node": the tests that matter most in this repo drive the real HTTP API of
 * the real built server, and flipping the global environment to jsdom would
 * be an unreviewed behaviour change touching every one of those files at
 * once.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";


/*
 * A waitFor THAT GIVES UP AFTER ONE SECOND INSIDE A TWO-MINUTE TEST.
 *
 * vitest.config.ts sets testTimeout to 120_000, and react-testing-library
 * keeps its own clock: asyncUtilTimeout, which every waitFor, findBy* and
 * waitForElementToBeRemoved obeys, defaults to 1000ms. Nothing here had ever
 * raised it, so 707 waitFor calls across 209 client test files were each a
 * one-second gate inside a test that had 119 seconds left to give them.
 *
 * On a loaded CI shard that race is lost, and it was lost twice in one hour on
 * 2026-10-22, both times reddening a pull request that had not touched the file:
 *
 *   #530  SaberraConfigPanel.test.tsx   expected 0 to be greater than 0
 *   #532  Review.questIdeas.test.tsx    Unable to find a label: "Village Credits"
 *
 * The second one was ALREADY written correctly, inside a waitFor. It simply ran
 * out of its second while the render waited on a fetch. Both pass locally and
 * both passed on the same tree in the other CI event, which is the signature of
 * a clock rather than a defect.
 *
 * This costs a green run NOTHING: a satisfied waitFor returns the moment its
 * condition holds, so the only thing a larger number changes is how long a
 * genuinely failing assertion takes to admit it. Nothing in the suite asserts
 * that a waitFor TIMES OUT, so there is no test whose meaning this inverts.
 *
 * A per-call timeout option still wins, which is how
 * SeatTradingCard.test.tsx keeps its deliberate 3000.
 */
configure({ asyncUtilTimeout: 5000 });

// vitest.config.ts does not set `test.globals`, so there is no ambient
// `afterEach` for @testing-library/react to auto-detect; register cleanup
// explicitly instead of relying on that auto-detection. Without it, a
// component from one test's render tree stays mounted into the next test in
// the same file, which surfaces as duplicate-element query failures that
// have nothing to do with the test that actually broke.
afterEach(() => {
  cleanup();
});
