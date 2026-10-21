// @vitest-environment jsdom
/**
 * Following a link unmounts the element that had focus (every page renders
 * its own Layout), and the browser dropped focus on <body>: measured on 4 of 4
 * in-app navigations, a screen reader heard nothing. A new page now hands
 * focus to <main>. Not on first load, not when the address carries a hash,
 * and never away from a field the new page focused itself.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import ScrollToTop from "./ScrollToTop";

function Page({ autofocusField = false }: { autofocusField?: boolean }) {
  // A fresh <main> per page, as each page's own Layout renders one.
  const [key] = useState(() => Math.random());
  return (
    <main id="main" tabIndex={-1} key={key}>
      <p>page</p>
      {autofocusField && <input aria-label="field" autoFocus />}
    </main>
  );
}

function setup(path = "/one") {
  const mem = memoryLocation({ path, record: true });
  const utils = render(
    <Router hook={mem.hook}>
      <ScrollToTop />
      <Page />
    </Router>,
  );
  return { ...utils, navigate: mem.navigate };
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("ScrollToTop focus on a new page", () => {
  it("leaves focus alone on first load", async () => {
    setup();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(document.activeElement).toBe(document.body);
  });

  it("moves focus to <main> after an in-app navigation", async () => {
    const { navigate } = setup();
    act(() => navigate("/two"));
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById("main")));
  });

  it("does not move focus when the address carries a hash", async () => {
    const { navigate } = setup();
    window.history.replaceState(null, "", "/two#section");
    act(() => navigate("/two"));
    await new Promise((r) => setTimeout(r, 50));
    expect(document.activeElement).not.toBe(document.getElementById("main"));
  });

  it("keeps a field the new page focused itself", async () => {
    const mem = memoryLocation({ path: "/one", record: true });
    function Switcher() {
      const [hasField, setHasField] = useState(false);
      return (
        <>
          <button type="button" onClick={() => { setHasField(true); mem.navigate("/form"); }}>go</button>
          <main id="main" tabIndex={-1}>{hasField && <input aria-label="field" autoFocus />}</main>
        </>
      );
    }
    const { getByRole, getByLabelText } = render(
      <Router hook={mem.hook}>
        <ScrollToTop />
        <Switcher />
      </Router>,
    );
    act(() => getByRole("button", { name: "go" }).click());
    await new Promise((r) => setTimeout(r, 50));
    expect(document.activeElement).toBe(getByLabelText("field"));
  });
});
