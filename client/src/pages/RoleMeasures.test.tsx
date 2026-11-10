// @vitest-environment jsdom
/**
 * /role-measures is for administrators. A visitor or a member sees one plain
 * sentence and the page asks the server for nothing; an admin gets the read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";

const auth = vi.hoisted(() => ({ user: null as any, loading: false, admin: false }));
const gameFetch = vi.hoisted(() => vi.fn());

vi.mock("@/components/Layout", () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/natural", () => ({ BreathingLoader: () => <div data-testid="loader" /> }));
vi.mock("@/lib/gameApi", () => ({ gameFetch }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: auth.user, loading: auth.loading }),
  useIsAdmin: () => auth.admin,
}));

import RoleMeasures from "./RoleMeasures";

const show = () =>
  render(
    <I18nProvider i18n={i18n}>
      <RoleMeasures />
    </I18nProvider>,
  );

describe("RoleMeasures, admin only", () => {
  beforeEach(() => {
    i18n.load("en", {});
    i18n.activate("en");
    gameFetch.mockReset();
    gameFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ rows: [] }) });
    Object.assign(auth, { user: null, loading: false, admin: false });
  });
  afterEach(cleanup);

  it("makes no request for a signed-out visitor", async () => {
    show();
    expect(await screen.findByTestId("measures-admin-only")).toBeTruthy();
    expect(gameFetch).not.toHaveBeenCalled();
  });

  it("makes no request for a signed-in member", async () => {
    auth.user = { id: "m-1", role: "member" };
    show();
    expect((await screen.findByTestId("measures-admin-only")).textContent).toContain("for administrators");
    expect(gameFetch).not.toHaveBeenCalled();
  });

  it("makes no request while the session is still resolving", () => {
    auth.loading = true;
    show();
    expect(gameFetch).not.toHaveBeenCalled();
  });

  it("reads the measures for an admin", async () => {
    auth.user = { id: "a-1", role: "admin" };
    auth.admin = true;
    show();
    await waitFor(() => expect(gameFetch).toHaveBeenCalledWith("/api/role-measures"));
    expect(screen.queryByTestId("measures-admin-only")).toBeNull();
  });
});
