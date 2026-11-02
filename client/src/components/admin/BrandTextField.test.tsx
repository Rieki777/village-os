// @vitest-environment jsdom
/**
 * THE "SHOW NOTHING HERE" CHOICE ON MAKE THIS YOURS (readiness R088).
 *
 * The box is what Admin's `brandField` renders for every identity field. Only
 * the Tagline and the Footer introduction carry the choice, because only their
 * readers cope with nothing (shared/brandCleared.ts says which and why).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import BrandTextField from "./BrandTextField";
import { measureSetup } from "./setupProgress";

afterEach(cleanup);

describe("BrandTextField", () => {
  it("offers the choice on the tagline, and ticking it stores the field as cleared and empty", () => {
    const onProject = vi.fn();
    render(
      <BrandTextField fieldKey="tagline" label="Tagline" defaultVal="healing the land" project={{ name: "Riverbend", tagline: "ours" }} onProject={onProject} />,
    );
    fireEvent.click(screen.getByLabelText("Show nothing here"));
    expect(onProject).toHaveBeenCalledWith({ name: "Riverbend", tagline: "", cleared: ["tagline"] });
  });

  it("says nothing shows while cleared, and keeps the box shut so a stale tick cannot hide typing", () => {
    render(
      <BrandTextField fieldKey="footerBlurb" label="Footer introduction" defaultVal="A platform sentence." project={{ footerBlurb: "", cleared: ["footerBlurb"] }} onProject={() => {}} />,
    );
    expect(screen.getByText("Nothing shows on the site here.")).toBeTruthy();
    expect((screen.getByLabelText("Footer introduction") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByText(/Platform default/)).toBeNull();
  });

  it("names the platform default on a blank box, which still inherits it", () => {
    render(
      <BrandTextField fieldKey="tagline" label="Tagline" defaultVal="healing the land" project={{ tagline: "" }} onProject={() => {}} />,
    );
    expect(screen.getByText("Platform default: healing the land")).toBeTruthy();
    expect((screen.getByLabelText("Show nothing here") as HTMLInputElement).checked).toBe(false);
  });

  it("offers no choice on a field whose readers cannot cope with nothing", () => {
    render(<BrandTextField fieldKey="name" label="Project name" defaultVal="Unnamed Village" project={{}} onProject={() => {}} />);
    expect(screen.queryByLabelText("Show nothing here")).toBeNull();
  });
});

describe("the Identity step", () => {
  it("counts a cleared tagline and footer line as answered, and a blank one as not", () => {
    const filled = { name: "Riverbend", memberName: "Neighbour", location: "The weald" };
    const cleared = measureSetup({ project: { ...filled, tagline: "", footerBlurb: "", cleared: ["tagline", "footerBlurb"] } } as any)
      .find((r) => r.key === "identity")!;
    expect(cleared.blank).toEqual([]);
    const blank = measureSetup({ project: { ...filled, tagline: "", footerBlurb: "" } } as any).find((r) => r.key === "identity")!;
    expect(blank.blank).toEqual(["Tagline", "Footer introduction"]);
  });
});
