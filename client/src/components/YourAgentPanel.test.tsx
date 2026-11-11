// @vitest-environment jsdom
/**
 * Saving an Anthropic key under "Run the assistant on your key" opens the
 * connector panel (the lead, 2026-11-11). A key for another provider does not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import YourAgentPanel from "./YourAgentPanel";

vi.mock("@/components/voice/VoiceArea", () => ({ default: () => null }));

const SETUP = { origin: "https://village.example.org", skillsUrl: "https://village.example.org/api/agent/v1/skills", openapiUrl: "", tokenEnvVar: "VILLAGE_AGENT_TOKEN", scopes: [], readScopes: [], intentsOpen: false, memberSecrets: true, memberSecretsSentence: "", providers: [], signatureHeader: "" };

function answer(url: string, init?: RequestInit) {
  const body = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as any;
  if (url === "/api/agent/setup") return body(SETUP);
  if (url === "/api/agent/tokens") return body({ tokens: [] });
  if (url === "/api/agent/inbox") return body({ inbox: null, deliveries: [] });
  if (url === "/api/agent/key") return init?.method === "PUT" ? body({ ok: true }) : body({ key: null });
  if (url === "/api/agent/profile") return body({ profile: { aboutMe: "", aboutTier: "private", matchingConsent: false }, consentSentence: "" });
  if (url === "/api/agent/statements") return body({ statements: [] });
  if (url === "/api/agent/drafts") return body({ drafts: [] });
  return body({});
}

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* refused */ }
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => answer(String(url), init)));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openAndSave(provider: string) {
  render(<YourAgentPanel person="u-1" />);
  await userEvent.click(screen.getByRole("button", { name: "Set up" }));
  await screen.findByLabelText("API key");
  if (provider !== "anthropic") await userEvent.selectOptions(screen.getByLabelText("Provider"), provider);
  await userEvent.type(screen.getByLabelText("API key"), "sk-ant-0123456789");
  await userEvent.click(screen.getByRole("button", { name: "Save key" }));
}

describe("your agent, the key", () => {
  it("opens the connector panel once an Anthropic key is saved", async () => {
    await openAndSave("anthropic");
    await waitFor(() => expect(screen.getByTestId("connector-setup")).toBeTruthy());
    expect(screen.getByTestId("connector-url").textContent).toBe("https://village.example.org/api/agent/v1/mcp");
  });

  it("stays quiet for a key from another provider", async () => {
    await openAndSave("openai_compatible");
    await waitFor(() => expect(screen.getByText(/Saved\. The assistant answers/)).toBeTruthy());
    expect(screen.queryByTestId("connector-setup")).toBeNull();
  });
});
