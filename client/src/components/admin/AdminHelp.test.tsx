// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { ADMIN_TABS } from "./adminAreas";
import { whatIsThis } from "./adminWords";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminHelp from "./AdminHelp";

describe("what is this", () => {
  it("has a sentence for every tab", () => {
    for (const tab of ADMIN_TABS) {
      const words = whatIsThis(tab.key);
      expect(words.help.length, tab.key).toBeGreaterThan(8);
    }
  });

  it("opens the sentence for the tab that is open", async () => {
    render(<AdminHelp tab="submissions" />);
    await userEvent.click(screen.getByRole("button", { name: "What is this?" }));
    expect(screen.getByText(/Requests people sent/)).toBeTruthy();
  });
});
