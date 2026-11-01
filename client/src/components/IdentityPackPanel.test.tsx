// @vitest-environment jsdom
/**
 * The identity pack's picker, asserted as a founder meets it.
 *
 * Two sentences from Rye opened this work, and each one is a test below,
 * because both describe something you can only see by rendering the panel:
 *
 *   "this 'choose file' needs to be a much more obvious button! The 'add
 *    reference' shouldn't appear until I choose a file."
 *   "The identity pack should be able to handle all sorts of file types. In
 *    this case I'm trying to upload an HTML that shows the whole style guide."
 *
 * WHY A COMPONENT TEST AND NOT A SCREENSHOT. A screenshot proves a button was
 * drawn once on one machine and cannot be re-checked by anybody later. These
 * assertions run on every commit and fail on the exact regression that would
 * matter: Add reference coming back before there is anything to add, the
 * picker sliding back to a bare input, or the label reverting to a promise
 * about images the door no longer keeps.
 *
 * `fetch` is stubbed. The route behind it has its own suite over real HTTP
 * against a real volume (server/routes/brandUploads.test.ts); what is under
 * test here is what the founder can see and press.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import IdentityPackPanel from "./IdentityPackPanel";

const EMPTY_PACK = { brand: { identityPack: { description: "", never: "", references: [] } } };

const PACK_WITH_A_STYLE_GUIDE = {
  brand: {
    identityPack: {
      description: "hand-built timber and lime plaster",
      never: "",
      references: [
        { url: "/api/uploads/brand-1-aaaaa.webp", thumbUrl: "/api/uploads/brand-1-aaaaa.thumb.webp", kind: "image", name: "wall.jpg" },
        { url: "/api/uploads/brand-2-bbbbb.html", thumbUrl: null, kind: "file", name: "village-style-guide.html", mimeType: "text/html" },
        // A reference saved before the door widened: no `kind` at all.
        { url: "/api/uploads/brand-0-ccccc.webp", thumbUrl: null },
      ],
    },
  },
};

const stubGet = (payload: unknown) =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => payload })));

const file = (name: string, type: string, body = "x") =>
  new File([body], name, { type });

/** The picker, once the panel's own load has resolved. */
const pickerInput = () => document.getElementById("identity-pack-file") as HTMLInputElement;

describe("the identity pack picker", () => {
  beforeEach(() => stubGet(EMPTY_PACK));
  // Unmount first: a describe's own afterEach runs before setup.ts's cleanup.
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("offers an obvious Choose file button and keeps Add reference away until there is a file", async () => {
    render(<IdentityPackPanel password="secret" />);

    const choose = await screen.findByText("Choose file");
    expect(choose.tagName, "the visible control is a label, so it is styleable and clickable").toBe("LABEL");
    expect(choose.getAttribute("for")).toBe("identity-pack-file");
    // Exactly one label points at the picker, so its accessible name is not
    // a coin toss between this and the section heading above it.
    expect(document.querySelectorAll('label[for="identity-pack-file"]').length).toBe(1);

    // CONTROL, in the same test as the claim: the picker IS on the page, so
    // "Add reference is absent" cannot be an empty render reading as a pass.
    expect(pickerInput()).toBeTruthy();
    expect(screen.queryByText("Add reference"), "nothing to add yet").toBeNull();

    fireEvent.change(pickerInput(), { target: { files: [file("village-style-guide.html", "text/html")] } });

    await waitFor(() => expect(screen.getByText("Add reference")).toBeTruthy());
    // And the chosen file is named on screen, so the founder can see what is queued.
    expect(screen.getByText("village-style-guide.html")).toBeTruthy();
    expect(screen.getByText("Choose a different file")).toBeTruthy();
  });

  it("says files, not images, everywhere a founder reads it", async () => {
    render(<IdentityPackPanel password="secret" />);
    expect(await screen.findByText("Reference files")).toBeTruthy();
    expect(screen.queryByText("Reference images")).toBeNull();
    // The rights line makes a claim about the same things, so it moved too.
    const rights = screen.getByText(/Our project holds the rights/);
    expect(rights.textContent).toContain("reference files");
    expect(rights.textContent).not.toContain("reference images");
  });

  it("accepts a style guide, not only pictures", async () => {
    render(<IdentityPackPanel password="secret" />);
    await screen.findByText("Choose file");
    const accept = pickerInput().getAttribute("accept") ?? "";
    for (const wanted of ["text/html", "text/css", "application/pdf", ".svg", ".md", "image/jpeg"]) {
      expect(accept, `accept must admit ${wanted}`).toContain(wanted);
    }
  });

  it("posts the chosen file and stores its name and kind beside the address", async () => {
    const post = vi.fn(async (url: string) => {
      if (String(url).endsWith("/brand/image")) {
        return {
          ok: true,
          json: async () => ({
            url: "/api/uploads/brand-9-zzzzz.html",
            thumbUrl: null,
            kind: "file",
            mimeType: "text/html",
            originalName: "village-style-guide.html",
          }),
        };
      }
      return { ok: true, json: async () => EMPTY_PACK };
    });
    vi.stubGlobal("fetch", post);

    render(<IdentityPackPanel password="secret" />);
    await screen.findByText("Choose file");
    fireEvent.change(pickerInput(), { target: { files: [file("village-style-guide.html", "text/html")] } });
    fireEvent.click(await screen.findByText("Add reference"));

    await waitFor(() => {
      const call = post.mock.calls.find((c) => String(c[0]).endsWith("/brand/image"));
      expect(call, "the upload must have gone to the brand door").toBeTruthy();
    });
    // The queued file is cleared, so Add reference goes away again.
    await waitFor(() => expect(screen.queryByText("Add reference")).toBeNull());
    // And the new reference is on screen as a file tile, named.
    expect(screen.getByText("HTML")).toBeTruthy();
    expect(screen.getByText("village-style-guide.html")).toBeTruthy();
  });

  it("draws a picture as a picture and a document as a named file tile", async () => {
    stubGet(PACK_WITH_A_STYLE_GUIDE);
    render(<IdentityPackPanel password="secret" />);

    await screen.findByText("Reference files");
    // The document: a tile carrying its type and its filename.
    expect(screen.getByText("HTML")).toBeTruthy();
    expect(screen.getByText("village-style-guide.html")).toBeTruthy();
    // The two pictures: real images, and NOT file tiles. The second of them
    // carries no `kind`, which is every reference saved before this change.
    const images = document.querySelectorAll("img");
    expect(images.length, "both pictures render as images").toBe(2);
    expect(document.querySelectorAll('a[href^="/api/uploads/"]').length, "only the document is a link").toBe(1);
  });
});
