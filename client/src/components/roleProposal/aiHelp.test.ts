/**
 * The AI help seam (role proposals PR C): with no guide route on the server,
 * the one adapter answers "not configured" for every step, so the button is
 * never drawn (the steps' own tests assert that on the page).
 */
import { describe, expect, it } from "vitest";
import { aiHelpStatus, NOT_CONFIGURED } from "./aiHelp";

describe("AI help", () => {
  it.each([["words" as const], ["season" as const]])("is not configured on the %s step", async (step) => {
    expect(await aiHelpStatus(step)).toEqual(NOT_CONFIGURED);
    expect(NOT_CONFIGURED).toEqual({ configured: false, reason: "not configured" });
  });
});
