// @vitest-environment jsdom
/**
 * The task emails choice in Notifications: three options in the task board's
 * own words, saved through the same PUT as every other cadence, shown only
 * where the village runs Live Sessions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TASK_COPY } from "@shared/sessionTasks";
import { reply } from "./taskFixture";

const modules = vi.hoisted(() => ({ sessions: true }));
vi.mock("@/modules/ModuleProvider", () => ({ useModuleOn: (id: string) => (id === "sessions" ? modules.sessions : false) }));
vi.mock("@/components/EmailFromVillage", () => ({ default: () => null }));
vi.mock("@/components/auth/ConfirmWithGoogle", () => ({
  useIdentityConfirm: () => ({ confirmed: false, returnError: "", reset: () => {} }),
  IdentityConfirmField: () => null,
  identityBody: () => ({}),
  identityReady: () => false,
}));

import NotifyPrefsPanel from "@/components/NotifyPrefsPanel";

const fetchMock = vi.fn();
const notify = { emailsOff: false, questsEmail: "immediate", rolesEmail: "immediate", gratitudeEmail: "daily", mentionsEmail: "immediate", repliesEmail: "immediate", messagesEmail: "immediate", governanceEmail: "daily", celebrations: "on" };

beforeEach(() => {
  modules.sessions = true;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/profile/prefs" && init?.method === "PUT") {
      const patch = JSON.parse(String(init.body)).notify;
      return reply(200, { notify: { ...notify, ...patch } });
    }
    if (url === "/api/profile/prefs") return reply(200, { notify });
    if (url === "/api/profile") return reply(200, { contactable: true });
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("task emails in Notifications", () => {
  it("offers the three choices, immediate until chosen, and saves tasksEmail", async () => {
    render(<NotifyPrefsPanel />);
    const select = (await screen.findByLabelText(TASK_COPY.pref.label)) as HTMLSelectElement;
    expect(select.value).toBe("immediate");
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      TASK_COPY.pref.options.immediate,
      TASK_COPY.pref.options.daily,
      TASK_COPY.pref.options.off,
    ]);

    fireEvent.change(select, { target: { value: "daily" } });
    await waitFor(() => expect(select.value).toBe("daily"));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ notify: { tasksEmail: "daily" } });
  });

  it("is not offered where the village does not run Live Sessions", async () => {
    modules.sessions = false;
    render(<NotifyPrefsPanel />);
    await screen.findByText("Email me about village activity");
    expect(screen.queryByLabelText(TASK_COPY.pref.label)).toBeNull();
  });
});
