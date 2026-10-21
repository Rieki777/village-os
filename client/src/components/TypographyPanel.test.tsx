// @vitest-environment jsdom
/**
 * Typography saves its own three fields and nothing else.
 *
 * The Look panel and this one sit side by side and both write the brand
 * document's `theme`, which the server merges key by key. This panel loads the
 * theme once when the page opens. It used to post that whole copy back, so a
 * founder who saved a seed colour in Look and then a font here had the colour
 * written over with the blank it held at load time, and the site went back to
 * the neutral look with no error anywhere. The test loads a theme whose seed
 * is blank, changes the headings face, saves, and reads the body that left.
 *
 * `fetch` is stubbed; everything else is the real component.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { offeringsFor } from "@shared/fontCatalog";
import TypographyPanel from "./TypographyPanel";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

describe("TypographyPanel save", () => {
  it("sends only the three font fields, so a colour saved beside it survives", async () => {
    const stale = { seed: "", character: "", place: "", fontDisplay: "", fontBody: "", fontAccent: "" };
    const puts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        puts.push(body);
        return new Response(JSON.stringify({ success: true, brand: { theme: { ...stale, ...body.theme } } }), { status: 200 });
      }
      return new Response(JSON.stringify({ brand: { theme: stale } }), { status: 200 });
    }));

    render(<TypographyPanel password="pw" />);
    const display = offeringsFor("display")[0];
    const selects = await screen.findAllByRole("combobox");
    await userEvent.selectOptions(selects[0], display.id);
    await userEvent.click(screen.getByRole("button", { name: /save typography/i }));

    await waitFor(() => expect(puts).toHaveLength(1));
    const sent = (puts[0] as { theme: Record<string, string> }).theme;
    expect(Object.keys(sent).sort()).toEqual(["fontAccent", "fontBody", "fontDisplay"]);
    expect(sent.fontDisplay).toBe(display.stack);
    expect(sent).not.toHaveProperty("seed");
    expect(sent).not.toHaveProperty("character");
  });
});
