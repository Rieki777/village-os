/**
 * THE HAND-WRITTEN EMAILS WEAR THE VILLAGE'S COLOUR (audit, 2026-10-22).
 *
 * Notices, digests, the session task emails and the Work With Us receipt each
 * typed one village's teal, #2D5A5A, into their band, buttons and links. Each
 * frame now takes the village's brand colour from its caller, and the
 * platform's neutral when there is none. Asserted on each frame's own output.
 */
import { describe, expect, it } from "vitest";
import { emailAccent, NEUTRAL_ACCENT } from "./emailAccent";
import { emailShell } from "./notify";
import { taskEmailHtml } from "./sessionTaskMail";
import { workWithUsAckEmail } from "./workWithUsAck";
import { brandColour } from "./themeCss";

const OLD_TEAL = /#2D5A5A/i;

describe("the colour an email outside comms wears", () => {
  it("takes a plain hex colour and refuses anything else", () => {
    expect(emailAccent("#3b6e8f")).toBe("#3b6e8f");
    expect(emailAccent("#abc")).toBe("#abc");
    expect(emailAccent("")).toBe(NEUTRAL_ACCENT);
    expect(emailAccent(undefined)).toBe(NEUTRAL_ACCENT);
    expect(emailAccent("red")).toBe(NEUTRAL_ACCENT);
    expect(emailAccent('#fff" onload="x')).toBe(NEUTRAL_ACCENT);
    expect(emailAccent("url(javascript:x)")).toBe(NEUTRAL_ACCENT);
  });

  it("is the site's own brand colour, derived from the seed, and the neutral with no seed", () => {
    const derived = brandColour({ seed: "#3b6e8f", character: "civic" } as never);
    expect(emailAccent(derived)).toBe(derived);
    expect(brandColour(null)).toBe(NEUTRAL_ACCENT);
  });

  it("colours the notice frame's band, and the neutral when no colour is given", () => {
    expect(emailShell("Willowbrook", "<p>Hi</p>", "#3b6e8f")).toContain("background:#3b6e8f");
    expect(emailShell("Willowbrook", "<p>Hi</p>")).toContain(`background:${NEUTRAL_ACCENT}`);
    expect(emailShell("Willowbrook", "<p>Hi</p>", "#3b6e8f")).not.toMatch(OLD_TEAL);
  });

  it("colours the session task email's band and button", () => {
    const html = taskEmailHtml("Willowbrook", { subject: "Your tasks", text: "", blocks: [{ kind: "button", label: "See the board", href: "https://v.example/tasks" }] } as never, "#3b6e8f");
    expect(html.match(/background:#3b6e8f/g)?.length).toBe(2);
    expect(html).not.toMatch(OLD_TEAL);
  });

  it("colours the Work With Us receipt's band", () => {
    expect(workWithUsAckEmail({}, { village: "Willowbrook" }, "Ana", "#3b6e8f").html).toContain("background:#3b6e8f");
    const neutral = workWithUsAckEmail({}, { village: "Willowbrook" }, "Ana").html;
    expect(neutral).toContain(`background:${NEUTRAL_ACCENT}`);
    expect(neutral).not.toMatch(OLD_TEAL);
  });
});
