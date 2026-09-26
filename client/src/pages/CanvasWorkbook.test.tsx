// @vitest-environment jsdom
/**
 * THE PRINTABLE CANVAS WORKBOOK, RENDERED (2026-09-25).
 *
 * Reads /canvas/workbook the way a person holding the printout would: the
 * village's name, the credit at the top and at the foot, the four
 * foundations, all twelve blocks in canvas order (each with the canvas's
 * question and description, our own questions, lines to write on and the
 * five levels to circle), a blank Decision Matrix and the four key moments.
 *
 * Then the controls: Print calls the browser's print, the paper choice moves
 * the stylesheet's `@page` size, and "Save as Markdown" hands over a file
 * built in the browser, with no request to anywhere.
 *
 * And the line R55 draws, as a TOTAL comparator: every digit on the page must
 * be a block's number, a level's numeral beside its word, or the A in A4. A
 * circled level is a reading of one block, never a score.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { CANVAS_FOUNDATIONS, CANVAS_LEVELS, CANVAS_ORDER } from "@shared/governanceCanvas";
import {
  CANVAS_BLOCK_TEXT,
  CANVAS_CREDIT,
  CANVAS_DECISION_MATRIX_COLUMNS,
  CANVAS_FOUNDATION_TEXT,
  CANVAS_KEY_MOMENTS,
  CANVAS_SCALE_TEXT,
} from "@shared/governanceCanvasText";
import { MATRIX_BLANK_ROWS } from "@/lib/canvasWorkbook";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="layout">{children}</div>,
}));

let config: { project: { name: string } } | null = { project: { name: "Willowbrook" } };
vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gameApi")>()),
  useGameConfig: () => config,
}));

import CanvasWorkbook from "./CanvasWorkbook";

/** A Blob's text, through FileReader where the environment's Blob has no text(). */
function readBlob(b: Blob): Promise<string> {
  if (typeof b.text === "function") return b.text();
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.readAsText(b);
  });
}

beforeEach(() => {
  config = { project: { name: "Willowbrook" } };
  // The workbook reads nothing over the network. Any request is a failure.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      throw new Error(`the workbook called ${url}, and it should call nothing`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("what the printed workbook carries", () => {
  it("names the village and credits the canvas at the top and at the foot", () => {
    render(<CanvasWorkbook />);
    expect(screen.getByTestId("workbook-village").textContent).toBe("Willowbrook");
    for (const id of ["workbook-credit-top", "workbook-credit-end"]) {
      const credit = within(screen.getByTestId(id));
      const link = credit.getByRole("link", { name: CANVAS_CREDIT.text });
      expect(link.getAttribute("href")).toBe(CANVAS_CREDIT.url);
      // On paper a link cannot be clicked, so the address is printed too.
      expect(screen.getByTestId(id).textContent).toContain(CANVAS_CREDIT.url);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls back to a plain phrase before the village's name has arrived", () => {
    config = null;
    render(<CanvasWorkbook />);
    expect(screen.getByTestId("workbook-village").textContent).toBe("Your village");
  });

  it("lays out the five levels and the four foundations in the canvas's words", () => {
    render(<CanvasWorkbook />);
    const levels = within(screen.getByTestId("workbook-levels"));
    for (const level of CANVAS_LEVELS) {
      expect(levels.getByText(`${level} ${CANVAS_SCALE_TEXT[level].word}`)).toBeTruthy();
      expect(levels.getByText(CANVAS_SCALE_TEXT[level].meaning)).toBeTruthy();
    }
    const foundations = within(screen.getByTestId("workbook-foundations"));
    for (const f of CANVAS_FOUNDATIONS) {
      expect(foundations.getByText(CANVAS_FOUNDATION_TEXT[f].name)).toBeTruthy();
      expect(foundations.getByText(CANVAS_FOUNDATION_TEXT[f].description)).toBeTruthy();
    }
  });

  it("gives all twelve blocks, in canvas order, the canvas's words, our questions, room to write and the levels to circle", () => {
    render(<CanvasWorkbook />);
    const blocks = screen.getAllByTestId(/^workbook-block-/);
    expect(blocks.map((b) => b.getAttribute("data-testid"))).toEqual(CANVAS_ORDER.map((b) => `workbook-block-${b.id}`));

    for (const block of CANVAS_ORDER) {
      const card = within(screen.getByTestId(`workbook-block-${block.id}`));
      expect(card.getByRole("heading", { level: 3 }).textContent).toBe(`Block ${block.number}: ${block.name}`);
      expect(card.getByText(CANVAS_BLOCK_TEXT[block.id].question)).toBeTruthy();
      expect(card.getByText(CANVAS_BLOCK_TEXT[block.id].description)).toBeTruthy();
      expect(card.getByText(block.question)).toBeTruthy();
      for (const p of block.prompts) expect(card.getByText(p)).toBeTruthy();
      expect(card.getByText("What we say")).toBeTruthy();
      expect(card.getByText("Why, in one sentence")).toBeTruthy();
      const circle = card.getByRole("list", { name: `Levels for ${block.name}, circle one` });
      expect(within(circle).getAllByRole("listitem").map((li) => li.textContent)).toEqual(
        CANVAS_LEVELS.map((l) => `${l} ${CANVAS_SCALE_TEXT[l].word}`),
      );
    }
  });

  it("leaves a Decision Matrix blank under the canvas's five columns, and names the four key moments", () => {
    render(<CanvasWorkbook />);
    const matrix = screen.getByTestId("workbook-matrix");
    expect(within(matrix).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      ...CANVAS_DECISION_MATRIX_COLUMNS,
    ]);
    const bodyRows = Array.from(matrix.querySelectorAll("tbody tr"));
    expect(bodyRows).toHaveLength(MATRIX_BLANK_ROWS);
    for (const r of bodyRows) {
      expect(r.querySelectorAll("td")).toHaveLength(CANVAS_DECISION_MATRIX_COLUMNS.length);
      expect(r.textContent).toBe("");
    }
    const moments = within(screen.getByTestId("workbook-moments"));
    expect(moments.getAllByRole("listitem").map((li) => li.textContent)).toEqual([...CANVAS_KEY_MOMENTS]);
  });

  it("shows no digit but a block's number, a level's numeral beside its word, or the A in A4", () => {
    const { container } = render(<CanvasWorkbook />);
    const allowed = [
      ...CANVAS_ORDER.map((b) => `Block ${b.number}:`),
      ...CANVAS_LEVELS.map((l) => `${l} ${CANVAS_SCALE_TEXT[l].word}`),
      "A4",
    ].sort((a, b) => b.length - a.length); // "Block 12:" before "Block 1:"
    // The print stylesheet is machinery, not something a reader sees.
    const text = (container.textContent ?? "").replace(screen.getByTestId("workbook-print-css").textContent ?? "", " ");
    // What DID render: every block heading, and a row of five levels per block.
    for (const b of CANVAS_ORDER) expect(text).toContain(`Block ${b.number}: ${b.name}`);
    let rest = text;
    for (const s of allowed) rest = rest.split(s).join(" ");
    expect(rest.match(/.{0,30}\d.{0,30}/g)).toBeNull();
  });
});

describe("the controls", () => {
  it("prints through the browser, and keeps its own controls off the paper", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<CanvasWorkbook />);
    fireEvent.click(screen.getByRole("button", { name: /print/i }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("workbook-toolbar").className).toContain("print-hide");
    const css = screen.getByTestId("workbook-print-css").textContent ?? "";
    expect(css).toMatch(/@media print \{[\s\S]*\.print-hide[\s\S]*display: none/);
    expect(css).toContain(".wb-break { break-before: page; }");
  });

  it("sets the page size to the paper the reader picks", () => {
    render(<CanvasWorkbook />);
    const css = () => screen.getByTestId("workbook-print-css").textContent ?? "";
    fireEvent.click(screen.getByLabelText("US Letter"));
    expect(css()).toContain("@page { size: letter;");
    fireEvent.click(screen.getByLabelText("A4"));
    expect(css()).toContain("@page { size: A4;");
    expect((screen.getByLabelText("A4") as HTMLInputElement).checked).toBe(true);
  });

  it("saves the workbook as a Markdown file built in the browser, named for the village", async () => {
    const blobs: Blob[] = [];
    const revoked: string[] = [];
    // jsdom has no object URLs, so the two statics are put in place for this
    // test and taken away again after the revoke timer has run.
    const u = URL as unknown as Record<string, unknown>;
    const before = { create: u.createObjectURL, revoke: u.revokeObjectURL };
    u.createObjectURL = (b: Blob) => {
      blobs.push(b);
      return "blob:workbook";
    };
    u.revokeObjectURL = (url: string) => revoked.push(url);
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(`${this.download} ${this.getAttribute("href")}`);
    });
    try {
      render(<CanvasWorkbook />);
      fireEvent.click(screen.getByRole("button", { name: /save as markdown/i }));

      expect(downloads).toEqual(["governance-canvas-workbook-willowbrook.md blob:workbook"]);
      expect(blobs).toHaveLength(1);
      expect(blobs[0].type).toBe("text/markdown;charset=utf-8");
      const text = await readBlob(blobs[0]);
      expect(text.split("\n")[0]).toBe("# Governance Canvas workbook for Willowbrook");
      expect(text).toContain(CANVAS_CREDIT.text);
      for (const b of CANVAS_ORDER) expect(text).toContain(CANVAS_BLOCK_TEXT[b.id].question);
      // The anchor is gone from the page and the object URL is let go.
      expect(document.querySelector('a[download]')).toBeNull();
      await new Promise((r) => setTimeout(r, 0));
      expect(revoked).toEqual(["blob:workbook"]);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      u.createObjectURL = before.create;
      u.revokeObjectURL = before.revoke;
    }
  });
});
