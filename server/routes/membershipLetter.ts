/**
 * THE MEMBERSHIP LETTER, AS THE VILLAGE'S INPUTS RENDER IT NOW (seat settings PR9).
 *
 *   GET /api/membership-letter   the letter's title, words, parts and version
 *
 * Public, like the Love Letter page that reads it and like the two content
 * sections it is made from (`GET /api/content/covenant`, `/legal`): a visitor
 * reads the letter before they have an account. It carries the village's own
 * words and nothing about any member, and it writes nothing.
 *
 * The page draws the letter from this answer and sends `version` back with a
 * member's signing, so the words a member aligns with are the words they read
 * (server/lib/membershipLetter.ts, `judgeSigning`). The signing itself still
 * arrives through the one public form door, `POST /api/forms/submit`, which
 * hands the same inputs to `landPublicSubmission`.
 *
 * REGISTERED from server/index.ts with one exempt line, and the two helpers
 * that file needs ride on the same exempt import.
 */
import type { Express } from "express";
import type { LetterSource } from "../../shared/membershipLetter";
import { currentLetter } from "../lib/membershipLetter";

export { letterSourceFrom } from "../../shared/membershipLetter";
export { legacySigningOf } from "../lib/membershipLetter";

interface Deps {
  /** The village's inputs now: `letterSourceFrom(mergedConfig(), contentRepo.get())`. */
  letterSource: () => LetterSource;
}

export function register(app: Express, deps: Deps): void {
  app.get("/api/membership-letter", (_req, res) => {
    // Never cached: a founder editing the covenant must not leave a member reading yesterday's words.
    res.setHeader("Cache-Control", "no-store");
    res.json(currentLetter(deps.letterSource()));
  });
}
