// @vitest-environment jsdom
/**
 * The 404 renders without the shell, so it has to be its own main landmark.
 * Before, it was the one page whose landmark list was empty (axe
 * landmark-one-main and region, at both widths), and every route whose module
 * is off lands here.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import NotFound from "./NotFound";

describe("NotFound landmarks", () => {
  it("is a main landmark holding the heading and the way back", () => {
    render(<NotFound />);
    const main = screen.getByRole("main");
    expect(within(main).getByRole("heading", { level: 1 })).toBeTruthy();
    expect(within(main).getByRole("button", { name: /back to the village/i })).toBeTruthy();
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("carries the language selector, because it renders without the shell (spec i18n US2)", () => {
    render(<NotFound />);
    expect(screen.getByRole("button", { name: /^Language: English \(EN\)/ })).toBeTruthy();
  });
});
