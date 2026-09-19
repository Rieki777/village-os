// @vitest-environment jsdom
/**
 * A longtext value reaches a member as TEXT.
 *
 * THE DEFECT THIS PINS. A longtext dial is the one variable type whose value
 * is typed by one person in Admin and read by another on a page, so it is the
 * one where "render it as markup" would be a stored cross-site scripting hole
 * with an admin form attached to it. The first test is that one, and it is
 * written against the rendered DOM rather than against the component's source,
 * because "there is no dangerouslySetInnerHTML in this file" is a claim about
 * today's code and "no script element appeared" is a claim about behaviour.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import LongText, { longTextParts } from "./LongText";

describe("LongText", () => {
  it("renders markup as the characters somebody typed, never as elements", () => {
    const { container } = render(<LongText text={'<script>alert(1)</script><b>bold</b>'} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toBe("<script>alert(1)</script><b>bold</b>");
  });

  it("keeps the line breaks in the text and in the styling", () => {
    const { container } = render(<LongText text={"first line\n\nthird line"} />);
    expect(container.textContent).toBe("first line\n\nthird line");
    expect(container.firstElementChild?.className).toContain("whitespace-pre-wrap");
  });

  it("links an http(s) address, and opens it safely", () => {
    render(<LongText text="The guide is at https://example.org/guide for anybody." />);
    const link = screen.getByRole("link", { name: "https://example.org/guide" });
    expect(link.getAttribute("href")).toBe("https://example.org/guide");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
  });

  it("links nothing whose scheme could carry code", () => {
    const { container } = render(
      <LongText text="javascript:alert(1) data:text/html,<b>x</b> mailto:someone@example.org" />,
    );
    expect(container.querySelectorAll("a").length).toBe(0);
  });

  it("leaves a sentence's full stop out of the address and in the words", () => {
    const { container } = render(<LongText text="Read https://example.org/guide." />);
    const link = screen.getByRole("link", { name: "https://example.org/guide" });
    expect(link.getAttribute("href")).toBe("https://example.org/guide");
    // The stop is still on the page, just not in the address.
    expect(container.textContent).toBe("Read https://example.org/guide.");
  });
});

describe("longTextParts", () => {
  it("splits text from links and loses not one character", () => {
    const value = "before https://example.org/a, and https://example.org/b) after";
    const parts = longTextParts(value);
    expect(parts.map((p) => p.text).join("")).toBe(value);
    expect(parts.filter((p) => p.href).map((p) => p.href)).toEqual([
      "https://example.org/a",
      "https://example.org/b",
    ]);
  });

  it("answers one text part for a value with no address in it", () => {
    expect(longTextParts("just words")).toEqual([{ text: "just words", href: null }]);
  });
});
