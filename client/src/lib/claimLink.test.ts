import { describe, expect, it } from "vitest";
import { claimLinkHere } from "./claimLink";

describe("the claim link, on the address the founder is using", () => {
  const token = "/set-password?token=abc.def";

  it("moves a link built for a domain that does not answer yet onto the working address", () => {
    expect(claimLinkHere(`https://village.example${token}`, "https://village-app.up.railway.app")).toBe(
      `https://village-app.up.railway.app${token}`,
    );
  });

  it("rescues a link left at its localhost example", () => {
    expect(claimLinkHere(`http://localhost:3000${token}`, "https://village.example")).toBe(`https://village.example${token}`);
  });

  it("anchors a relative link, the shape the server sends with no FRONTEND_URL", () => {
    expect(claimLinkHere(token, "https://village.example/")).toBe(`https://village.example${token}`);
  });
});
