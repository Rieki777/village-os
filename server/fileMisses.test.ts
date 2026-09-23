/**
 * No client page may look like a file, because the server now answers one 404.
 *
 * server/index.ts registers two rules beside the SPA fallback: anything under
 * `/images/` that express.static did not find, and any ROOT-LEVEL path whose
 * one segment ends in an extension (`/favicon.png`, `/wp-login.php`). Both
 * answer 404 text/plain, because a missing file that answered the app's HTML
 * with a 200 kept every uptime check green over a broken image.
 *
 * The rule is only safe while the router agrees with it. A page mounted at
 * `/about.html`, at `/images/...`, or at a bare `/:slug` whose slug may carry
 * a dot would be 404ed by the server before the client ever saw the URL, and
 * nothing else in the repository would notice: every client test renders the
 * page directly and never asks the server for it. So this file reads the
 * router the same way the QA sweeps do (scripts/qa/routes.mjs) and holds the
 * three conditions the rule depends on.
 *
 * `/profile/:handle` with a handle like `ada.lovelace` is fine and is the
 * reason the second rule is root-level only: two segments never reach it.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - scripts/ is untyped JavaScript, deliberately outside tsconfig
import { routes } from "../scripts/qa/routes.mjs";

const derived = routes() as { concrete: string[]; parameterised: string[]; total: number };
const every = [...derived.concrete, ...derived.parameterised];

describe("the router leaves room for the server's file rules", () => {
  it("reads a real router, not an empty list that would pass anything", () => {
    // 77 `path=` entries at the time of writing. A floor well under that, so
    // a new page never trips it and a deriver that finds nothing always does.
    expect(derived.total).toBeGreaterThan(40);
    expect(derived.concrete).toContain("/investor");
    expect(derived.parameterised).toContain("/profile/:handle");
  });

  it("mounts no page whose first segment has a dot in it", () => {
    const dotted = every.filter((p) => (p.split("/")[1] ?? "").includes("."));
    expect(dotted, "the server 404s a root-level name with an extension").toEqual([]);
  });

  it("mounts no page under /images", () => {
    expect(every.filter((p) => p === "/images" || p.startsWith("/images/"))).toEqual([]);
  });

  it("mounts no bare root-level parameter, whose value could carry a dot", () => {
    expect(every.filter((p) => /^\/:[^/]+$/.test(p))).toEqual([]);
  });
});
