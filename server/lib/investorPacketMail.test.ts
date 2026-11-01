/**
 * THE INVESTOR PACKET RECEIPT, through the Words.
 *
 * Which email goes is decided by what went with it, and the documents become
 * the `packet.documents` links. The words themselves are held to their brief
 * with every other default (shared/comms/defaults/words.test.ts), including
 * that neither promises a reply by any time.
 */
import { describe, expect, it } from "vitest";
import { composeEmail } from "../../shared/comms/letterHtml";
import { platformTemplate } from "../../shared/comms/defaults/templates";
import { investorPacketKey, packetLinks } from "./investorPacketMail";

const DOCS = [
  { title: "Summary <2026>", href: "https://v.example/api/uploads/summary.pdf", pageHref: "https://v.example/investor" },
  { title: "Land plan", href: "https://v.example/api/uploads/plan.pdf", pageHref: null },
];

describe("the investor packet receipt", () => {
  it("sends the packet only when documents went with it", () => {
    expect(investorPacketKey(DOCS)).toBe("investor.packet");
    expect(investorPacketKey([])).toBe("investor.thanks");
  });

  it("lists each document, then its page on the site where it has one", () => {
    expect(packetLinks(DOCS)).toEqual([
      { label: "Summary <2026>", href: "https://v.example/api/uploads/summary.pdf" },
      { label: "Summary <2026>, on the site", href: "https://v.example/investor" },
      { label: "Land plan", href: "https://v.example/api/uploads/plan.pdf" },
    ]);
  });

  it("renders in the village's look, escapes the titles, and promises no time", () => {
    const words = platformTemplate("investor.packet")!;
    const email = composeEmail({
      words,
      values: { "person.firstName": "Ivy", "packet.documents": { links: packetLinks(DOCS) } },
      village: { name: "Willowbrook", url: "https://v.example", logoUrl: null, seed: "#3b6e8f", character: "civic", postalAddress: "" },
      kind: "essential",
      templateKey: "investor.packet",
    });
    expect(email.subject).toBe("Your Willowbrook investor packet");
    expect(email.html).toContain("Summary &lt;2026&gt;");
    expect(email.html).not.toContain("Summary <2026>");
    expect(email.text).toContain("- Land plan: https://v.example/api/uploads/plan.pdf");
    expect(email.text).not.toMatch(/48|hours/i);
    expect(email.html).not.toMatch(/#2D5A5A/i);
  });
});
