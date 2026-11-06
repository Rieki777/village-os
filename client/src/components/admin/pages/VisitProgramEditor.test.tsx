// @vitest-environment jsdom
/**
 * Admin, Pages, Visit: the visit program (shared/visitProgram.ts).
 *
 * FINDINGS item 17: a village could edit the three ways to visit it started
 * with and nothing else. These pin that a way to visit can be added, removed
 * and moved, that the order saved is the order shown, that a box stops at its
 * limit, and that the editor says what a blank button link does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import VisitProgramEditor from "./VisitProgramEditor";
import PagesEditor from "./PagesEditor";
import { MAX_VISIT_TYPES, VISIT_TYPE_FIELDS } from "@shared/visitProgram";

const card = (id: string, title: string, order: number) => ({
  id,
  title,
  duration: "",
  format: "",
  cost: "",
  description: "",
  cta_label: "",
  cta_url: "",
  order,
});

let program: any;
let puts: any[];

beforeEach(() => {
  puts = [];
  program = {
    hero_subtitle: "Walk the land with us.",
    // Stored out of order on purpose: the editor lists them as the page does.
    visit_types: [card("tour", "Land Tour", 2), card("call", "Community Call", 1)],
    logistics: { getting_there: "Bus.", accommodation: "", what_to_bring: "", contact_note: "" },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any, init?: any) => {
      if (String(url).endsWith("/api/admin/visit-config")) {
        if (init?.method === "PUT") {
          puts.push(JSON.parse(init.body));
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        return new Response(JSON.stringify(program), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const titles = () => screen.getAllByLabelText(/^Name/).map((el) => (el as HTMLInputElement).value);
const save = () => fireEvent.click(screen.getByRole("button", { name: /Save the visit program/ }));

describe("the visit program editor", () => {
  it("lists the ways to visit in the order the page shows them", async () => {
    render(<VisitProgramEditor password="pw" />);
    await screen.findByText("Ways to visit");
    expect(titles()).toEqual(["Community Call", "Land Tour"]);
  });

  it("moves a way to visit, and saves the new order as the order", async () => {
    render(<VisitProgramEditor password="pw" />);
    await screen.findByText("Ways to visit");
    fireEvent.click(screen.getByRole("button", { name: "Move way to visit 2 up" }));
    expect(titles()).toEqual(["Land Tour", "Community Call"]);
    save();
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].visit_types.map((t: any) => [t.id, t.order])).toEqual([
      ["tour", 1],
      ["call", 2],
    ]);
  });

  it("removes a way to visit", async () => {
    render(<VisitProgramEditor password="pw" />);
    await screen.findByText("Ways to visit");
    fireEvent.click(screen.getByRole("button", { name: "Remove way to visit 1" }));
    save();
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].visit_types.map((t: any) => t.id)).toEqual(["tour"]);
    // The rest of the program goes back as it came.
    expect(puts[0].hero_subtitle).toBe("Walk the land with us.");
    expect(puts[0].logistics.getting_there).toBe("Bus.");
  });

  it("adds a way to visit, and waits for its name before it saves", async () => {
    render(<VisitProgramEditor password="pw" />);
    await screen.findByText("Ways to visit");
    fireEvent.click(screen.getByRole("button", { name: /Add a way to visit \(2 of/ }));
    expect(titles()).toHaveLength(3);
    expect(screen.getByRole("button", { name: /Save the visit program/ })).toBeDisabled();
    expect(screen.getByText("Way to visit 3: Name cannot be blank.")).toBeInTheDocument();

    fireEvent.change(screen.getAllByLabelText(/^Name/)[2], { target: { value: "Work Weekend" } });
    save();
    await waitFor(() => expect(puts).toHaveLength(1));
    const added = puts[0].visit_types[2];
    expect(added).toMatchObject({ title: "Work Weekend", order: 3, cta_url: "" });
    expect(added.id).toMatch(/^visit-/);
    expect(added.id).not.toBe("call");
  });

  it(`stops adding at ${MAX_VISIT_TYPES}`, async () => {
    program.visit_types = Array.from({ length: MAX_VISIT_TYPES }, (_, i) => card(`c${i}`, `Card ${i}`, i + 1));
    render(<VisitProgramEditor password="pw" />);
    await screen.findByText("Ways to visit");
    expect(screen.getByRole("button", { name: new RegExp(`Add a way to visit \\(${MAX_VISIT_TYPES} of`) })).toBeDisabled();
  });

  it("stops a box at its limit", async () => {
    render(<VisitProgramEditor password="pw" />);
    await screen.findByText("Ways to visit");
    const max = VISIT_TYPE_FIELDS.find((f) => f.key === "title")!.max;
    const box = screen.getAllByLabelText(/^Name/)[0] as HTMLInputElement;
    fireEvent.change(box, { target: { value: "x".repeat(max + 10) } });
    expect(box.value).toHaveLength(max);
  });

  it("says what a blank button link does, beside the box", async () => {
    render(<VisitProgramEditor password="pw" />);
    await screen.findByText("Ways to visit");
    const first = screen.getAllByLabelText(/^Button goes to/)[0].closest("div")!.parentElement!;
    expect(within(first).getByText(/Leave blank and the button takes visitors to the visit form/)).toBeInTheDocument();
  });

  it("says a program that could not be read cannot be saved over", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 })));
    render(<VisitProgramEditor password="pw" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Saving is off until it reads/);
    expect(screen.queryByRole("button", { name: /Save the visit program/ })).toBeNull();
  });
});

describe("where the visit program is edited", () => {
  it("sits in Admin, Pages under the Visit page, and nowhere else in that editor", async () => {
    render(<PagesEditor password="pw" />);
    await screen.findByLabelText("Page");
    expect(screen.queryByText("Visit Program")).toBeNull();
    fireEvent.change(screen.getByLabelText("Page"), { target: { value: "visit" } });
    expect(await screen.findByText("Visit Program")).toBeInTheDocument();
    expect(await screen.findByText("Ways to visit")).toBeInTheDocument();
  });

  it("holds the page picker while the program has unsaved changes", async () => {
    render(<PagesEditor password="pw" />);
    await screen.findByLabelText("Page");
    fireEvent.change(screen.getByLabelText("Page"), { target: { value: "visit" } });
    await screen.findByText("Ways to visit");
    fireEvent.click(screen.getByRole("button", { name: "Remove way to visit 1" }));
    await waitFor(() => expect(screen.getByLabelText("Page")).toBeDisabled());
  });
});
