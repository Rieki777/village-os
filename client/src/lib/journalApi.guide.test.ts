// @vitest-environment jsdom
/**
 * The journal guide's reply as the page reads it. The page used to rebuild it
 * from three fields, so who answered and the tasks the guide noticed were
 * dropped on the way in, and the task card never drew (found by the
 * end-to-end QA pass, 2026-11-09; every unit test mocked this function).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { askGuide } from "./journalApi";

afterEach(() => vi.unstubAllGlobals());

const reply = (body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as any));
const req = { practice: "morning", depth: "light", answers: [], messages: [{ role: "user", content: "hi" }] } as any;

describe("askGuide", () => {
  it("keeps who answered and the tasks the guide noticed", async () => {
    reply({ reply: "r", nextQuestion: "q", reflection: "", guide: { id: "saberra", name: "Sera" }, suggestedTasks: ["Water the beds"], doneTasks: [{ id: "t1", title: "Call Ana" }] });
    expect(await askGuide(req)).toEqual({
      reply: "r", nextQuestion: "q", reflection: "",
      guide: { id: "saberra", name: "Sera" },
      suggestedTasks: ["Water the beds"],
      doneTasks: [{ id: "t1", title: "Call Ana" }],
    });
  });

  it("reads an older server's reply, and drops anything odd", async () => {
    reply({ reply: "r", nextQuestion: "", reflection: "", guide: { id: "someone", name: 3 }, suggestedTasks: [7, "ok"], doneTasks: [{ id: 1 }] });
    expect(await askGuide(req)).toEqual({ reply: "r", nextQuestion: "", reflection: "", suggestedTasks: ["ok"], doneTasks: [] });
  });
});
