// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import RoleDiscoverTab from "./RoleDiscoverTab";

let puts: Array<{ auth: string; body: any }> = [];
function serve(putStatus = 200) {
  puts = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (init?.method === "PUT") {
      puts.push({ auth: String((init.headers as Record<string, string>).Authorization), body: JSON.parse(String(init.body)) });
      return putStatus === 200 ? json({ mapping: puts[0].body.mapping }) : json({ error: "You do not hold the power to do this." }, putStatus);
    }
    if (String(url).includes("/archetypes")) return json([{ key: "building", name: "The Builder" }, { key: "catalyzing", name: "The Catalyst" }]);
    return json({ mapping: { humanDesign: {}, lines: {} } });
  }));
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the discover mapping in Admin", () => {
  it("saves the ticked characters for a type and a line", async () => {
    serve();
    render(<RoleDiscoverTab password="tok" />);
    const projector = (await screen.findAllByText("Projector"))[0].closest("fieldset") as HTMLElement;
    fireEvent.click(projector.querySelector("input[type=checkbox]")!);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].auth).toBe("Bearer tok");
    expect(puts[0].body.mapping.humanDesign).toEqual({ Projector: ["building"] });
  });
  it("says the server's refusal and keeps the ticks", async () => {
    serve(403);
    const { toast } = await import("sonner");
    render(<RoleDiscoverTab password="tok" />);
    fireEvent.click(((await screen.findAllByText("Projector"))[0].closest("fieldset") as HTMLElement).querySelector("input[type=checkbox]")!);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You do not hold the power to do this."));
  });
});
