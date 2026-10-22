// @vitest-environment jsdom
/**
 * "Start from your ReGen Civics profile", read off the rendered screen.
 *
 * WHAT THIS PINS:
 *
 *   1. READING WRITES NOTHING. Pasting a file and reading it makes GET calls
 *      only; the first write is the founder's press of Load.
 *   2. A FILE OF ANOTHER SHAPE IS REFUSED WHOLE, in the sentence the reader
 *      gives, and the preview never appears.
 *   3. EACH PART HAS ITS OWN TICK, and an unticked part sends nothing.
 *   4. EVERY WRITE GOES THROUGH A ROUTE THAT ALREADY EXISTED, in order: the
 *      needs scope, the whole-village figure, the org draft and its lines; and
 *      only after Publish, the circles' ways of deciding and the seats' tags.
 *
 * `fetch` is stubbed. The routes have their own server tests, and the draft a
 * real card builds is published against a real schema in
 * server/lib/regenImportDraft.test.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProfileImport from "./ProfileImport";
import ProfileImportDoor from "./ProfileImportDoor";
import { keepFile } from "@/lib/profilePrefill";

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const ROOT = path.join(HERE, "..", "..", "..", "..");
const CARD = fs.readFileSync(path.join(ROOT, "shared", "__fixtures__", "regen-card-riverbend.json"), "utf8");
const SEED = JSON.parse(fs.readFileSync(path.join(ROOT, "server", "seeds", "circles-seed.json"), "utf8")) as Array<{ id: string; name: string }>;

type Call = { method: string; url: string; body: any };
let calls: Call[] = [];

function stubFetch() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = String(init?.method ?? "GET");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const json = (status: number, data: unknown) => ({ ok: status < 400, status, json: async () => data });
    if (method === "GET" && url === "/api/admin/org/drafts") return json(200, []);
    if (method === "GET" && url === "/api/needs/scope") return json(200, { scope: [], summary: { answered: false } });
    if (method === "GET" && url === "/api/org") {
      return json(200, { circles: SEED.map((c) => ({ id: c.id, name: c.name, status: "active", isExample: false, aliases: [] })), roles: [] });
    }
    if (method === "GET" && url === "/api/season") return json(200, { current: { id: "s1", startsOn: "2026-09-22", endsOn: "2026-12-21" } });
    if (method === "PUT" && url === "/api/admin/needs/scope") return json(200, { success: true });
    if (method === "PUT" && url.startsWith("/api/admin/variables/")) return json(200, { success: true });
    if (method === "POST" && url === "/api/admin/org/drafts") return json(200, { success: true, id: "draft-1" });
    if (method === "POST" && url === "/api/admin/org/drafts/draft-1/changes") return json(200, { success: true, id: "dch" });
    if (method === "GET" && url === "/api/admin/org/drafts/draft-1/preview") {
      return json(200, { lines: [{ reads: 'Create the circle "Living Water"', blocked: null }, { reads: "Put Ana in Water keeper", blocked: null }], blocked: 0 });
    }
    if (method === "POST" && url === "/api/admin/org/drafts/draft-1/publish") return json(200, { success: true, applied: 20 });
    if (method === "PUT" && url.startsWith("/api/org/circles/")) return json(200, { success: true });
    if (method === "POST" && url === "/api/admin/needs/links") return json(200, { success: true });
    return json(404, { error: `unstubbed ${method} ${url}` });
  }));
}

beforeEach(() => {
  keepFile("");
  stubFetch();
});
afterEach(() => vi.unstubAllGlobals());

const writes = () => calls.filter((c) => c.method !== "GET");

async function readCard(text = CARD) {
  render(<ProfileImport password="pw" onOpenTab={() => {}} />);
  fireEvent.change(screen.getByLabelText("Paste the file from your ReGen Civics profile"), { target: { value: text } });
  await userEvent.click(screen.getByRole("button", { name: "Read the file" }));
}

describe("reading a file", () => {
  it("refuses a file of another shape, whole, in the reader's sentence", async () => {
    await readCard(JSON.stringify({ schema: "someone-else/plan@3", needs: [] }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain('This file says it is "someone-else/plan@3"');
    expect(screen.queryByText("Load what you kept")).toBeNull();
    expect(writes()).toEqual([]);
  });

  it("shows every part with its own tick, and writes nothing yet", async () => {
    await readCard();
    expect(await screen.findByText("The human needs your village is here to meet")).toBeTruthy();
    expect(screen.getByText("Your circles and roles, as one draft")).toBeTruthy();
    expect(screen.getByText("Who holds the roles")).toBeTruthy();
    expect(screen.getByText("The circles this village started with")).toBeTruthy();
    expect(screen.getByText("Love: Alive, for 60 percent of your people.")).toBeTruthy();
    expect(screen.getByText("Ana in Water keeper")).toBeTruthy();
    expect(screen.getByText(/Your cards name more than one way/)).toBeTruthy();
    expect(writes()).toEqual([]);
  });
});

describe("loading what the founder kept", () => {
  it("sends the needs, the figure and the draft, then waits for Publish", async () => {
    await readCard();
    await screen.findByText("The human needs your village is here to meet");
    // Untick one seat: nothing about it may be sent.
    await userEvent.click(screen.getByRole("checkbox", { name: "Cook" }));
    await userEvent.click(screen.getByRole("button", { name: "Load what you kept" }));
    await screen.findByText("Your draft, line by line");

    const w = writes();
    expect(w[0]).toMatchObject({ method: "PUT", url: "/api/admin/needs/scope" });
    expect(w[0].body.needs.map((n: any) => n.needKey)).toEqual(["love", "vitality", "honesty", "custom:spiritual-practice"]);
    expect(w[1]).toEqual({ method: "PUT", url: "/api/admin/variables/needs.totality_target_pct", body: { value: 40 } });
    expect(w[2]).toMatchObject({ method: "POST", url: "/api/admin/org/drafts" });
    expect(w[2].body.title).toBe("Started from Riverbend Farm's ReGen Civics profile");
    const lines = w.slice(3).map((c) => `${c.body.op} ${c.body.orgRoleId}`);
    expect(lines.some((l) => l.startsWith("create_seat cook-"))).toBe(false);
    expect(lines.filter((l) => l.startsWith("create_circle"))).toHaveLength(5);
    expect(lines.filter((l) => l.startsWith("seat_holder"))).toHaveLength(2);
    expect(lines.filter((l) => l.startsWith("rest_circle"))).toHaveLength(SEED.length);
    // Nothing that needs the seats to exist has gone yet.
    expect(w.some((c) => c.url.includes("/publish") || c.url === "/api/admin/needs/links" || c.url.startsWith("/api/org/circles/"))).toBe(false);
    expect(screen.getByText("Put Ana in Water keeper")).toBeTruthy();
    // The words for their own editors stay on screen once the draft exists.
    expect(screen.getByRole("button", { name: "Put it in the purpose box" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Open Quests with this one" })).toHaveLength(2);
  });

  it("publishes, then declares how circles decide and tags the seats", async () => {
    await readCard();
    await screen.findByText("The human needs your village is here to meet");
    await userEvent.click(screen.getByRole("button", { name: "Load what you kept" }));
    await userEvent.click(await screen.findByRole("button", { name: "Publish this draft" }));
    await screen.findByText("Your published draft");

    const after = writes().slice(writes().findIndex((c) => c.url.endsWith("/publish")));
    expect(after[0].url).toBe("/api/admin/org/drafts/draft-1/publish");
    expect(after.find((c) => c.url.startsWith("/api/org/circles/"))).toEqual({
      method: "PUT",
      url: "/api/org/circles/living-water/decides",
      body: { decidesBy: "consent" },
    });
    const tags = after.filter((c) => c.url === "/api/admin/needs/links").map((c) => `${c.body.subjectRef.replace(/-[a-z0-9]+$/, "")} ${c.body.needKey} ${c.body.weight}`);
    expect(tags).toEqual([
      "water-keeper vitality partial",
      "river-voice vitality partial",
      "cook vitality partial",
      "heart-keeper love primary",
      "ceremony-holder custom:spiritual-practice primary",
    ]);
    expect(screen.getByRole("button", { name: "Revert the draft" })).toBeTruthy();
  });

  it("sends no draft at all when the circles and seats are unticked", async () => {
    await readCard();
    await screen.findByText("The human needs your village is here to meet");
    await userEvent.click(screen.getByRole("checkbox", { name: "Your circles and roles, as one draft" }));
    await userEvent.click(screen.getByRole("button", { name: "Load what you kept" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("4 human needs."));
    expect(writes().some((c) => c.url.startsWith("/api/admin/org/drafts"))).toBe(false);
  });

  it("shows a draft an earlier load left open, and publishes it only after it is read", async () => {
    const real = globalThis.fetch as any;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET" && url === "/api/admin/org/drafts") {
        calls.push({ method: "GET", url, body: undefined });
        return { ok: true, status: 200, json: async () => [
          { id: "draft-1", status: "open", title: "Started from Riverbend Farm's ReGen Civics profile", changes: [{}, {}] },
          { id: "draft-9", status: "open", title: "Somebody's own reorganisation", changes: [{}] },
        ] };
      }
      return real(url, init);
    }));
    render(<ProfileImport password="pw" onOpenTab={() => {}} />);
    expect(await screen.findByText(/Started from Riverbend Farm's ReGen Civics profile, 2 lines/)).toBeTruthy();
    expect(screen.queryByText(/Somebody's own reorganisation/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish this draft" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Read it" }));
    expect(await screen.findByText("Put Ana in Water keeper")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Publish this draft" }));
    await screen.findByText("Your published draft");
    // No file was read this time, so nothing waits on the seats: the publish is the only write.
    expect(writes().map((c) => c.url)).toEqual(["/api/admin/org/drafts/draft-1/publish"]);
  });

  it("reads the same file again when the founder comes back from another editor", async () => {
    const first = render(<ProfileImport password="pw" onOpenTab={() => {}} />);
    fireEvent.change(screen.getByLabelText("Paste the file from your ReGen Civics profile"), { target: { value: CARD } });
    await userEvent.click(screen.getByRole("button", { name: "Read the file" }));
    await screen.findByText("The human needs your village is here to meet");
    first.unmount();
    // The Setup Wizard mounts the door again; it opens, and the file is read with no paste.
    render(<ProfileImportDoor password="pw" onOpenTab={() => {}} />);
    expect(await screen.findByText("The human needs your village is here to meet")).toBeTruthy();
    expect(writes()).toEqual([]);
    // Closing the card lets the file go.
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: "Start from my profile" })).toBeTruthy();
  });

  it("stops at a refused needs write and sends nothing after it", async () => {
    const real = globalThis.fetch as any;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT" && url === "/api/admin/needs/scope") {
        calls.push({ method: "PUT", url, body: JSON.parse(String(init.body)) });
        return { ok: false, status: 400, json: async () => ({ error: "A breadth is a whole number of percent, from 0 to 100." }) };
      }
      return real(url, init);
    }));
    await readCard();
    await screen.findByText("The human needs your village is here to meet");
    await userEvent.click(screen.getByRole("button", { name: "Load what you kept" }));
    expect(await screen.findByText(/A breadth is a whole number of percent, from 0 to 100\./)).toBeTruthy();
    expect(writes().map((c) => c.url)).toEqual(["/api/admin/needs/scope"]);
  });
});
