/**
 * THE CONFIDENTIALITY AGREEMENT, AND THE AGREEMENTS BEFORE A ROLE STARTS (role journey L7).
 *
 *   GET  /api/confidentiality           the village's agreement now: title, words, version,
 *                                       and for a signed-in member whether they hold it
 *   POST /api/profile/confidentiality   align with it {version}: one click, identity re-confirmed
 *
 * The words are the village's own, written in Admin as the `confidentiality`
 * content section (shared/confidentiality.ts). Reading them is public, like the
 * membership letter: the agreement carries the village's words and nothing about
 * any member. Aligning is a member's own act from their account, and asks the
 * village's identity re-confirm when the last one is older than fifteen
 * minutes, the confirmation the alignments door already serves
 * (`POST /api/profile/alignments/confirm`), so the page reuses its panel.
 *
 * This module also installs, at boot:
 *   - the role start gate the seating path asks (server/lib/roleStartAgreements.ts);
 * and serves `holdsConfidentiality`, which the capability context reads for
 * `records.confidential` (shared/capabilities.ts).
 *
 * REGISTERED from server/index.ts with one line. No `recordEvent`: the
 * alignment row is the record.
 */
import type { Express } from "express";
import { ALIGN_WORDS, RECONFIRM_FRESH_MS } from "../../shared/alignments";
import { CONFIDENTIALITY_SECTION, CONFIDENTIALITY_WORDS } from "../../shared/confidentiality";
import type { AppDeps } from "../lib/appDeps";
import { alignConfidentiality, currentAgreement, holdsCurrentAgreement } from "../lib/confidentiality";
import { confirmedUntil, confirmWithFor } from "../lib/identityConfirm";
import { installRoleStartGate, makeRoleStartGate, roleStartDials } from "../lib/roleStartAgreements";
import { seasonSaved } from "../lib/seasonTurn";
import { inApplicationTransaction } from "../repos/seatApplications";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "overLimit" | "members"> & {
  /** The village's content document now (`contentRepo.get()`). */
  content: () => Record<string, unknown> | null | undefined;
  boolVar: (key: string) => boolean;
  googleAvailable(): boolean;
  authSecret: string;
  /** Tests hand in a fixed instant. */
  now?: () => Date;
};

const ASKS = 10;
const WINDOW_MS = 10 * 60 * 1000;
/** How long the capability context trusts one answer about a member holding the agreement. */
const HOLDS_FRESH_MS = 60 * 1000;

const holds = new Map<string, { version: string; yes: boolean; at: number }>();

let readHolds: ((userId: string) => Promise<boolean>) | null = null;

/**
 * Whether a member holds the village's confidentiality agreement as it reads
 * now, for the capability context (`records.confidential`). False before this
 * module is registered, and false when the village has written none.
 */
export async function holdsConfidentiality(userId: string): Promise<boolean> {
  return readHolds ? readHolds(userId) : false;
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, overLimit, members } = deps;
  const now = () => (deps.now ? deps.now() : new Date());
  const agreement = () => currentAgreement((deps.content() ?? {})[CONFIDENTIALITY_SECTION]);

  installRoleStartGate(
    makeRoleStartGate({
      dials: () => roleStartDials(deps.boolVar),
      agreement,
      membershipGranted: async (id) => !!((await members.byId(id)) as any)?.membershipGranted,
    }),
    () => agreement() !== null,
  );

  readHolds = async (userId) => {
    const current = agreement();
    if (!current) return false;
    const seen = holds.get(userId);
    const t = now().getTime();
    if (seen && seen.version === current.version && t - seen.at < HOLDS_FRESH_MS) return seen.yes;
    const yes = await holdsCurrentAgreement(getPool(), userId, current, now());
    holds.set(userId, { version: current.version, yes, at: t });
    return yes;
  };


  app.get("/api/confidentiality", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const current = agreement();
    const user = await authedUser(req);
    const you = user && current ? { holds: await holdsCurrentAgreement(getPool(), String(user.id), current, now()) } : null;
    res.json({ agreement: current, you, message: current ? null : CONFIDENTIALITY_WORDS.none });
  });

  app.post("/api/profile/confidentiality", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to align." });
    const userId = String(user.id);
    if (await overLimit(`align-confidentiality:${userId}`, ASKS, WINDOW_MS)) {
      return res.status(429).json({ error: "too_many_asks", message: "That is a lot of aligning in a few minutes. Wait a little and try again." });
    }
    const current = agreement();
    if (!current) return res.status(409).json({ error: "no_agreement", message: CONFIDENTIALITY_WORDS.none });
    if (req.body?.version !== current.version) return res.status(409).json({ error: "words_changed", message: CONFIDENTIALITY_WORDS.changed, agreement: current });
    // One click, identity re-confirmed: the agreement binds a person, so a stale confirmation asks again.
    const until = confirmedUntil(user, RECONFIRM_FRESH_MS);
    if (until === null || now().getTime() > until) {
      return res.status(403).json({ error: "reconfirm_required", message: ALIGN_WORDS.reconfirmLine, confirmWith: confirmWithFor(user, deps.authSecret, deps.googleAvailable()) });
    }
    const out = await inApplicationTransaction(getPool(), (conn) => alignConfidentiality(conn, { agreement: current, userId, now: now() }));
    holds.delete(userId);
    // A role waiting on this alignment starts now rather than at the next hour.
    void seasonSaved();
    res.json({ success: true, textId: out.textId, already: out.already, alignedAt: now().toISOString() });
  });
}
