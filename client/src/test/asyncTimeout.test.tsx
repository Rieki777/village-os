// @vitest-environment jsdom
/**
 * Pins the one line in setup.ts that stops 707 waitFor calls being one-second
 * gates inside two-minute tests.
 *
 * This is its own control. If the `configure` call in client/src/test/setup.ts
 * is removed, reordered after a test file loads, or loses its value to a
 * refactor, `getConfig().asyncUtilTimeout` reads react-testing-library's own
 * 1000 default and the first assertion fails by name. The second assertion
 * proves the number is actually obeyed rather than merely stored: it waits for
 * something that cannot be true until after the old default would have given up.
 */
import { describe, expect, it } from "vitest";
import { getConfig, waitFor } from "@testing-library/react";

const RTL_DEFAULT = 1000;

describe("the configured async util timeout", () => {
  it("is raised above react-testing-library's own default", () => {
    expect(getConfig().asyncUtilTimeout).toBeGreaterThan(RTL_DEFAULT);
  });

  it("is obeyed, so a condition that settles after the old default still passes", async () => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
    }, RTL_DEFAULT + 400);
    try {
      await waitFor(() => expect(settled).toBe(true));
    } finally {
      clearTimeout(timer);
    }
    expect(settled).toBe(true);
  });
});
