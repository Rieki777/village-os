// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ErasePrepPanel from "./ErasePrepPanel";

afterEach(cleanup);

describe("before you erase a member", () => {
  it("opens with the member whose Delete was pressed already chosen", () => {
    const players = [{ id: "u1", name: "Ana", email: "a@x.org" }, { id: "u2", name: "Bo", email: "b@x.org" }] as never;
    render(<ErasePrepPanel password="p" players={players} initialUserId="u2" onContinue={() => {}} onCancel={() => {}} />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("u2");
    expect(screen.getByRole("button", { name: "Export their tasks" })).toBeTruthy();
  });
});
