// @vitest-environment jsdom
/**
 * WHERE A CONFLICT GOES, AS A MEMBER READS IT ON /exit-policy (2026-09-27).
 *
 * The launch checklist's `conflict-door` row passes with an intake role that
 * somebody holds, or with a named outside contact alone, and either way with a
 * reply time. The cheapest passing setup for a small village is the second:
 * no intake role, an outside contact, and a reply time. The page used to print
 * "The village promises you a reply" and "You can also bring it to somebody
 * outside" whatever the setup, so that village told a member in conflict about
 * a promise with nobody behind it and an "also" beside a door that was not
 * there. The four setups this file holds apart:
 *
 *   an intake role and an outside contact: the reply is the intake role's, and
 *     the outside contact is also there;
 *   the outside contact alone: it is the way in, with the reply, and no "also";
 *   a reply time with no door at all: nothing is promised;
 *   nothing stated: neither line.
 *
 * Read signed out, because the page is public and these lines are printed to
 * anybody. `Layout` is a passthrough; the subject is the restorative card.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock("@/lib/gameApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gameApi")>()),
  authToken: () => null,
}));

import ExitPolicy from "./ExitPolicy";

const CONTACT = { name: "Jo Bell", organisation: "Cohort Care", howToReach: "ombuds@example.test" };

function serve(restorative: Record<string, unknown>) {
  const policy = {
    placeholder: false,
    voluntary: { noticePeriodDays: 21, valuationMethod: "Ours.", unwindSteps: ["Hand back the keys"] },
    involuntary: { process: "Two stewards sit with the person first." },
    restorative: { steps: ["Somebody who was not involved hears both people"], ...restorative },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ policy }) })),
  );
}

/** The restorative card's text, once the policy has arrived. */
async function card(): Promise<string> {
  const heading = await screen.findByText("Repair before departure");
  await screen.findByText("Somebody who was not involved hears both people");
  return heading.closest("div.bg-card")?.textContent ?? "";
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ExitPolicy, the conflict door", () => {
  it("ties the reply to the intake role, and offers the outside contact as well", async () => {
    serve({ intakeContactRole: "care", intakeRole: { id: "care", name: "Care" }, replyHours: 48, outsideContact: CONTACT });
    render(<ExitPolicy />);
    const text = await card();
    expect(text).toContain("Bring it to the Care role and you hear back within 48 hours.");
    expect(text).toContain("You can also bring it to somebody outside the village: Jo Bell, Cohort Care. ombuds@example.test");
    expect(text).not.toContain("The village promises you a reply");
  });

  it("with the outside contact as the only door, names it as the way in, with the reply, and never says also", async () => {
    serve({ intakeContactRole: "", replyHours: 1, outsideContact: CONTACT });
    render(<ExitPolicy />);
    const text = await card();
    expect(text).toContain(
      "Bring it to somebody outside the village: Jo Bell, Cohort Care. ombuds@example.test You hear back within 1 hour.",
    );
    expect(text).not.toContain("also");
    expect(text).not.toContain("intake role");
  });

  it("promises no reply when there is no door at all", async () => {
    serve({ intakeContactRole: "", replyHours: 48 });
    render(<ExitPolicy />);
    const text = await card();
    expect(text).not.toContain("48 hours");
    expect(text).not.toContain("hear back");
    expect(text).not.toContain("outside the village");
  });

  it("prints neither line before the village has stated them", async () => {
    serve({ intakeContactRole: "care", intakeRole: { id: "care", name: "Care" } });
    render(<ExitPolicy />);
    const text = await card();
    expect(text).not.toContain("hear back");
    expect(text).not.toContain("outside the village");
  });
});
