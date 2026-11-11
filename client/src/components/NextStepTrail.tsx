/**
 * The Trail (R47), now THE ROOT STRIP: the one next step, under the header on
 * every page (the Root, game feel wave 2, 11 Nov 2026).
 *
 * This file is the shell's half and stays tiny on purpose. The app shell loads
 * on the first page, and the strip draws with the nature kit and reads the
 * path conductor, neither of which belongs there. So this decides only WHERE
 * the strip is quiet and loads the strip itself (components/path/RootLine.tsx)
 * as its own lazy chunk.
 *
 * QUIET WHERE IT WOULD REPEAT ITSELF OR INTRUDE. It stays away from the
 * profile, which draws the same step as a full card, from the whole-path page,
 * from the doors (sign in, join, set a password), from the team's own rooms,
 * and from the page the step points at: a step that goes nowhere is noise.
 *
 * A visitor sees it too: their step is the front door.
 */
import { Suspense, lazy } from "react";

const RootLine = lazy(() => import("./path/RootLine"));

const QUIET_EXACT = new Set(["/profile", "/path", "/login", "/register", "/forgot-password", "/set-password", "/verify-email"]);
const QUIET_PREFIX = ["/admin", "/project-history", "/journey-to-launch", "/claim", "/application-status", "/sessions/"];

export function isQuietPath(path: string, stepHref?: string | null): boolean {
  const bare = path.split(/[?#]/)[0] || "/";
  if (QUIET_EXACT.has(bare)) return true;
  if (QUIET_PREFIX.some((p) => bare === p || bare.startsWith(p.endsWith("/") ? p : `${p}/`))) return true;
  if (stepHref && stepHref.split(/[?#]/)[0] === bare) return true;
  return false;
}

export default function NextStepTrail() {
  return (
    <Suspense fallback={null}>
      <RootLine quiet={isQuietPath} />
    </Suspense>
  );
}
