// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import BookingOffer from "./BookingOffer";

describe("BookingOffer", () => {
  it("shows the no-link copy for a missing or non-https link", () => {
    for (const url of [null, undefined, "http://cal.example/x", "javascript:alert(1)"]) {
      const { unmount } = render(<BookingOffer bookingUrl={url} />);
      expect(screen.getByText("We'll write to you to find a time")).toBeTruthy();
      expect(screen.queryByTestId("booking-link")).toBeNull();
      unmount();
    }
  });
  it("links an https schedule in a new tab", () => {
    render(<BookingOffer bookingUrl="https://calendar.app.google/abc" what="a time for this interview" />);
    const a = screen.getByTestId("booking-link") as HTMLAnchorElement;
    expect(a.href).toBe("https://calendar.app.google/abc");
    expect(a.rel).toContain("noopener");
  });
});
