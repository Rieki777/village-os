import { describe, expect, it } from "vitest";
import { statusLinkFor, withoutStatusLink } from "./applicantUpdates";
import { verifyLink } from "./comms/links";
import { applicantUpdate } from "../../shared/openProposalDecide";

describe("withoutStatusLink", () => {
  it("drops the status page link line and the blank lines before it", () => {
    expect(withoutStatusLink("Your proposal was read.\n\nYour status page link: https://x.test/s/1\n")).toBe("Your proposal was read.");
  });

  it("keeps the words after the link line", () => {
    expect(withoutStatusLink("One.\n\nYour status page link: https://x.test\nTwo.")).toBe("One.\nTwo.");
  });

  it("leaves text without the line alone", () => {
    expect(withoutStatusLink("  Plain words.\nMore.  ")).toBe("Plain words.\nMore.");
  });

  it("does not hang on a very long run of newlines", () => {
    const text = "a" + "\n".repeat(200_000) + "Your status page link" + "\n".repeat(200_000) + "z";
    const t0 = Date.now();
    const out = withoutStatusLink(text);
    expect(out.startsWith("a\n") && out.endsWith("z") && !out.includes("status page link")).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1000);
    const noMatch = "a" + "\n".repeat(200_000) + "Your status page lin";
    const t1 = Date.now();
    withoutStatusLink(noMatch);
    expect(Date.now() - t1).toBeLessThan(1000);
  });
});

describe("the status link in a letter", () => {
  const i = { firstName: "Ana", village: "V", roleNames: ["Gate"], replyDays: 3 };
  it("a letter given a link carries it, in either language, and the first-email pointer is gone", () => {
    for (const lang of ["en", "es"] as const) {
      for (const kind of ["conversation", "terms"] as const) {
        const text = applicantUpdate(kind, { ...i, lang, statusLink: "https://x.test/application-status/op-1?token=t" }).text;
        expect(text).toContain("https://x.test/application-status/op-1?token=t");
        expect(text).not.toMatch(/first email|primer correo/);
      }
    }
  });
  it("without a link the old pointer stays, so a door that cannot mint one still says something true", () => {
    expect(applicantUpdate("terms", i).text).toContain("first email we sent you");
  });
  it("a profile notice drops the line with the link in it", () => {
    for (const lang of ["en", "es"] as const) {
      const text = applicantUpdate("terms", { ...i, lang, statusLink: "https://x.test/application-status/op-1?token=t" }).text;
      expect(withoutStatusLink(text)).not.toContain("token=");
    }
  });
  it("the link is signed for this one proposal and refuses another purpose", () => {
    const link = statusLinkFor({ siteUrl: () => "https://x.test/" }, "op-abc")!;
    const token = new URL(link).searchParams.get("token")!;
    expect(link.startsWith("https://x.test/application-status/op-abc?token=")).toBe(true);
    expect(verifyLink("application_status", token)?.ref).toBe("op-abc");
    expect(verifyLink("unsubscribe", token)).toBeNull();
    expect(statusLinkFor({}, "op-abc")).toBeNull();
  });
});
