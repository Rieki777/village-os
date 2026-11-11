// @vitest-environment jsdom
/** The member door's About you step says where links and files go: the village's own contact address, and nothing when it has none. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const links = vi.hoisted(() => ({ contactEmail: "hello@example.org" }));

vi.mock("@/lib/gameApi", () => ({ useVillageLinks: () => ({ contactEmail: links.contactEmail, mailTo: () => "" }) }));
vi.mock("./pickSources", () => ({ loadOrg: () => Promise.resolve({ roles: [] }) }));

import AboutYouField from "./AboutYouField";

const show = () => render(<AboutYouField field={{ id: "aboutYou" } as any} value={undefined} onChange={() => {}} answers={{}} />);

afterEach(cleanup);

describe("the member door's About you step", () => {
  it("names the village's contact address for links and files", () => {
    links.contactEmail = "hello@example.org";
    show();
    expect(screen.getByText("Send links, a CV or any other files to hello@example.org with your name in the subject line.")).toBeTruthy();
  });

  it("hides the line when the village has no contact address", () => {
    links.contactEmail = "";
    show();
    expect(screen.queryByText(/Send links, a CV/)).toBeNull();
  });
});
