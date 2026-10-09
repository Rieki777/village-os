// @vitest-environment jsdom
/**
 * A sitting, end to end through the real flow, the real outbox and the real
 * gameFetch: only `fetch` and storage are stand-ins.
 *
 * What is pinned: light asks fewer questions than deep and both counts come
 * from shared/journal.ts; Next and Back move one question at a time and keep
 * what was written; the review shows every answer editable and Save sends
 * what the review holds; the guide being unavailable is one calm sentence and
 * never stands between the member and Save; and an open sitting survives the
 * page going away.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { JOURNAL_PRACTICE_DEFS, PULSE_METRICS, questionsFor, type JournalEntryInput } from "@shared/journal";
import { TOKEN_KEY } from "@/lib/gameApi";
import { enqueue, flushOutbox, pendingFor } from "@/lib/journalOutbox";
import TodayTab from "./TodayTab";
import { GUIDE_RESTING } from "./GuidePanel";
import { readDraft } from "./sitting";

const OWNER = "usr-wren";

/** A session token shaped like the server's, so the outbox can tell whose it is. */
function tokenFor(userId: string): string {
  const claims = JSON.stringify({ userId, email: `${userId}@example.test`, timestamp: 1, v: 0 });
  return `${btoa(claims).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.sig`;
}

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
let guideAnswer: () => Response;

/** Every body POSTed to a path, parsed. */
const bodiesTo = (path: string) =>
  fetchMock.mock.calls
    .filter(([url, init]) => url === path && (init as RequestInit | undefined)?.method === "POST")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));

beforeEach(() => {
  const store = memoryStorage();
  vi.stubGlobal("localStorage", store);
  store.setItem(TOKEN_KEY, tokenFor(OWNER));
  guideAnswer = () => json({ reply: "That sounds full.", nextQuestion: "", reflection: "" });
  fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/journal/entries") return json({ id: "e1" }, 201);
    if (url === "/api/journal/guide") return guideAnswer();
    return json({ error: "not-here" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const MORNING_AT_NINE = () => new Date(2026, 9, 2, 9, 0, 0);

function renderToday(now = MORNING_AT_NINE) {
  return render(<TodayTab owner={OWNER} village="Willowbrook" now={now} />);
}

const startPractice = (label: string) => fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}`) }));
const next = () => fireEvent.click(screen.getByRole("button", { name: /^(Next|Review)$/ }));
const back = () => fireEvent.click(screen.getByRole("button", { name: "Back" }));
const morning = (depth: "light" | "deep") => questionsFor("morning", depth);

describe("choosing how deep", () => {
  it("asks the light questions only, on a light morning", () => {
    renderToday();
    startPractice("Morning");
    expect(screen.getByText(`1 of ${morning("light").length}`)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: morning("light")[0]!.prompt })).toBeInTheDocument();
  });

  it("asks every question on a deep morning, and remembers the choice", () => {
    const first = renderToday();
    fireEvent.click(screen.getByRole("radio", { name: /Deep/ }));
    startPractice("Morning");
    expect(screen.getByText(`1 of ${morning("deep").length}`)).toBeInTheDocument();
    expect(morning("deep").length).toBeGreaterThan(morning("light").length);
    first.unmount();

    renderToday();
    expect(screen.getByRole("radio", { name: /Deep/ })).toBeChecked();
  });

  it("suggests morning before noon and evening after six", () => {
    const am = renderToday();
    expect(screen.getByRole("button", { name: /^Morning/ })).toHaveTextContent("Suggested now");
    expect(screen.getByRole("button", { name: /^Evening/ })).not.toHaveTextContent("Suggested now");
    am.unmount();

    renderToday(() => new Date(2026, 9, 2, 20, 0, 0));
    expect(screen.getByRole("button", { name: /^Evening/ })).toHaveTextContent("Suggested now");
    expect(screen.getByRole("button", { name: /^Morning/ })).not.toHaveTextContent("Suggested now");
  });

  it("suggests evening, never morning, at half past one in the night", () => {
    renderToday(() => new Date(2026, 9, 3, 1, 30, 0));
    expect(screen.getByRole("button", { name: /^Evening/ })).toHaveTextContent("Suggested now");
    expect(screen.getByRole("button", { name: /^Morning/ })).not.toHaveTextContent("Suggested now");
  });
});

/*
 * Ruling 2026-10-05: "All journal entries go to Saberra (if that module is
 * on) unless specifically marked private." The review step is where that is
 * decided, so it says so beside Save, and what it shows is what is sent.
 */
describe("where an entry goes", () => {
  const toReview = () => {
    renderToday();
    startPractice("Morning");
    fireEvent.change(screen.getByRole("textbox", { name: morning("light")[0]!.prompt }), { target: { value: "Slept deep." } });
    for (let i = 0; i < morning("light").length; i++) next();
  };

  it("saves an entry as shared unless the member keeps it private, and says so before Save", async () => {
    toReview();
    const keep = screen.getByRole("checkbox", { name: "Keep this entry private" });
    expect(keep).not.toBeChecked();
    expect(screen.getByText(/shared with the village's organisational memory when that is connected/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save to my journal" }));
    await waitFor(() => expect(bodiesTo("/api/journal/entries").length).toBe(1));
    expect(bodiesTo("/api/journal/entries")[0].privacy).toBe("internal");
  });

  it("sends a private entry as private", async () => {
    toReview();
    fireEvent.click(screen.getByRole("checkbox", { name: "Keep this entry private" }));
    expect(screen.getByText("It stays in this village, for you alone.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save to my journal" }));
    await waitFor(() => expect(bodiesTo("/api/journal/entries").length).toBe(1));
    expect(bodiesTo("/api/journal/entries")[0].privacy).toBe("private");
  });
});

describe("the weekly pulse asks what the founder asked for", () => {
  it("leads its light pass with role tensions, work between roles and missed opportunities", () => {
    const keys = questionsFor("pulse", "light").map((q) => q.key);
    expect(keys).toEqual(["role-tension", "unowned-work", "opportunity"]);
    renderToday();
    startPractice("Weekly pulse");
    for (let i = 0; i < PULSE_METRICS.length; i++) next();
    expect(screen.getByRole("heading", { name: "What tension are you experiencing in your role right now?" })).toBeInTheDocument();
    next();
    expect(screen.getByRole("heading", { name: "What do you see that needs doing and is not part of your role?" })).toBeInTheDocument();
    next();
    expect(screen.getByRole("heading", { name: "What opportunity for growth or revenue is Willowbrook not acting on?" })).toBeInTheDocument();
  });
});

describe("one question at a time", () => {
  it("moves with Next and Back and keeps what was written", () => {
    renderToday();
    startPractice("Morning");
    const [q1, q2] = morning("light");

    fireEvent.change(screen.getByRole("textbox", { name: q1!.prompt }), { target: { value: "Slept deep." } });
    next();
    expect(screen.getByText(`2 of ${morning("light").length}`)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: q2!.prompt })).toBeInTheDocument();

    back();
    expect(screen.getByText(`1 of ${morning("light").length}`)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: q1!.prompt })).toHaveValue("Slept deep.");
  });

  it("opens the pulse with its five numbers, the village's name filled in", () => {
    renderToday();
    startPractice("Weekly pulse");
    const total = PULSE_METRICS.length + questionsFor("pulse", "light").length;
    expect(screen.getByText(`1 of ${total}`)).toBeInTheDocument();
    const scale = screen.getByRole("group", { name: "How confident are you in Willowbrook right now?" });
    // Every point on the scale is its own radio, so arrow keys walk it.
    expect(scale.querySelectorAll('input[type="radio"]')).toHaveLength(5);
  });

  it("reads everything back, editable, and saves what the review holds", async () => {
    renderToday();
    startPractice("Morning");
    const qs = morning("light");
    fireEvent.change(screen.getByRole("textbox", { name: qs[0]!.prompt }), { target: { value: "Slept deep." } });
    for (let i = 0; i < qs.length; i++) next();

    expect(screen.getByRole("heading", { name: "Read it back" })).toBeInTheDocument();
    for (const q of qs) expect(screen.getByRole("textbox", { name: q.prompt })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: qs[1]!.prompt }), { target: { value: "One good walk." } });

    fireEvent.click(screen.getByRole("button", { name: "Save to my journal" }));
    expect(await screen.findByText("Saved to your journal.")).toBeInTheDocument();

    const [sent] = bodiesTo("/api/journal/entries") as JournalEntryInput[];
    expect(sent!.practice).toBe("morning");
    expect(sent!.depth).toBe("light");
    expect(sent!.answers.map((a) => [a.questionKey, a.text])).toEqual([
      [qs[0]!.key, "Slept deep."],
      [qs[1]!.key, "One good walk."],
    ]);
    expect(sent!.localHour).toBe(9);
    // Back on the picker, ready for the next page.
    expect(screen.getByRole("button", { name: /^Evening/ })).toBeInTheDocument();
  });

  it("keeps an open sitting on the device when the page goes away", () => {
    const first = renderToday();
    startPractice("Morning");
    fireEvent.change(screen.getByRole("textbox", { name: morning("light")[0]!.prompt }), {
      target: { value: "Half a thought" },
    });
    first.unmount();

    renderToday();
    expect(screen.getByText(/unfinished morning page/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pick it up" }));
    expect(screen.getByRole("textbox", { name: morning("light")[0]!.prompt })).toHaveValue("Half a thought");
  });
});

describe("the guide", () => {
  it("says it is resting when the server has no model, and Save still works", async () => {
    guideAnswer = () => json({ error: "assistant-unavailable" }, 503);
    renderToday();
    startPractice("Morning");
    const q1 = morning("light")[0]!;
    fireEvent.change(screen.getByRole("textbox", { name: q1.prompt }), { target: { value: "Tired." } });

    fireEvent.click(screen.getByRole("button", { name: "Ask the guide" }));
    const dialog = screen.getByRole("dialog", { name: "The guide" });
    expect(dialog).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Your message to the guide" }), {
      target: { value: "Why am I tired?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(await screen.findByText(GUIDE_RESTING)).toBeInTheDocument();
    // The request carried this sitting's words, and the typed question stays put.
    const [asked] = bodiesTo("/api/journal/guide");
    expect(asked.answers).toEqual([{ questionKey: q1.key, prompt: q1.prompt, text: "Tired." }]);
    expect(asked.messages).toEqual([{ role: "user", content: "Why am I tired?" }]);
    expect(screen.getByRole("textbox", { name: "Your message to the guide" })).toHaveValue("Why am I tired?");

    fireEvent.click(screen.getByRole("button", { name: "Close the guide" }));
    for (let i = 0; i < morning("light").length; i++) next();
    fireEvent.click(screen.getByRole("button", { name: "Save to my journal" }));
    expect(await screen.findByText("Saved to your journal.")).toBeInTheDocument();
  });

  it("adds an offered question to the page and keeps a confirmed reflection", async () => {
    guideAnswer = () =>
      json({ reply: "It sounds like rest matters.", nextQuestion: "What would rest look like tonight?", reflection: "You want more rest." });
    renderToday();
    startPractice("Morning");
    fireEvent.click(screen.getByRole("button", { name: "Ask the guide" }));
    fireEvent.click(screen.getByRole("button", { name: "Reflect this back to me" }));

    expect(await screen.findByText("It sounds like rest matters.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Add this question to my page/ }));
    });

    // The new question is the page's last before the review.
    expect(screen.getByRole("heading", { name: "What would rest look like tonight?" })).toBeInTheDocument();
    expect(screen.getByText(`${morning("light").length + 1} of ${morning("light").length + 1}`)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "What would rest look like tonight?" }), {
      target: { value: "Bed by ten." },
    });
    next();
    fireEvent.click(screen.getByRole("button", { name: "Save to my journal" }));
    await waitFor(() => expect(bodiesTo("/api/journal/entries")).toHaveLength(1));

    const [sent] = bodiesTo("/api/journal/entries") as JournalEntryInput[];
    expect(sent!.reflection).toBe("You want more rest.");
    expect(sent!.answers).toEqual([
      { questionKey: "guide-1", prompt: "What would rest look like tonight?", text: "Bed by ten." },
    ]);
  });
});

/** Write the first answer of a light morning and stop on the review. */
function writeMorningToReview(first = "Slept deep.") {
  startPractice("Morning");
  const qs = morning("light");
  fireEvent.change(screen.getByRole("textbox", { name: qs[0]!.prompt }), { target: { value: first } });
  for (let i = 0; i < qs.length; i++) next();
  return qs;
}

/**
 * Every POST still held open. A test that fails before releasing them would
 * leave the outbox's per-member flush waiting forever and fail every later
 * save in this file for a reason of its own, so afterEach lets them all go.
 */
const held: Array<() => void> = [];
afterEach(async () => {
  held.splice(0).forEach((r) => r());
  // Joins whatever run is still going and waits for it to end.
  await act(async () => {
    await flushOutbox(OWNER);
  });
});

/** Hold every entry POST open until `release` is called. */
function holdEntryPosts() {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/journal/entries") return new Promise<Response>((resolve) => held.push(() => resolve(json({ id: "e1" }, 201))));
    if (url === "/api/journal/guide") return guideAnswer();
    return json({ error: "not-here" }, 404);
  });
  return () => held.splice(0).forEach((r) => r());
}

describe("one page, one clientId, one save", () => {
  it("does not offer back a page that was saving when the tab went away", async () => {
    const release = holdEntryPosts();
    const first = renderToday();
    writeMorningToReview();
    fireEvent.click(screen.getByRole("button", { name: "Save to my journal" }));
    await waitFor(() => expect(bodiesTo("/api/journal/entries")).toHaveLength(1));

    // The member switches tabs while it still reads "Saving...", and back.
    first.unmount();
    renderToday();
    expect(screen.queryByRole("button", { name: "Pick it up" })).toBeNull();

    await act(async () => release());
    expect(screen.queryByRole("button", { name: "Pick it up" })).toBeNull();
    expect(readDraft(OWNER)).toBeNull();
  });

  it("drops an offer whose draft is gone by the time it is tapped", () => {
    const first = renderToday();
    startPractice("Morning");
    fireEvent.change(screen.getByRole("textbox", { name: morning("light")[0]!.prompt }), { target: { value: "Half a thought" } });
    first.unmount();
    renderToday();
    // Another tab saved the page meanwhile and let go of the draft.
    localStorage.removeItem(`village.journal.draft.${OWNER}`);

    fireEvent.click(screen.getByRole("button", { name: "Pick it up" }));

    expect(screen.queryByRole("button", { name: "Pick it up" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: morning("light")[0]!.prompt })).toBeNull();
  });

  it("picks up a page whose clientId is already on its way under a new one, so its new words are kept", async () => {
    const first = renderToday();
    startPractice("Morning");
    const q1 = morning("light")[0]!;
    fireEvent.change(screen.getByRole("textbox", { name: q1.prompt }), { target: { value: "Half a thought" } });
    first.unmount();
    const draft = readDraft(OWNER)!;
    // The same page is already in the outbox under that clientId.
    enqueue(OWNER, {
      clientId: draft.clientId,
      practice: "morning",
      depth: "light",
      answers: [{ questionKey: q1.key, prompt: q1.prompt, text: "Half a thought" }],
      writtenAt: new Date(2026, 9, 2, 8, 0, 0).toISOString(),
      localHour: 8,
    });

    renderToday();
    fireEvent.click(screen.getByRole("button", { name: "Pick it up" }));
    fireEvent.change(screen.getByRole("textbox", { name: q1.prompt }), { target: { value: "Half a thought, and the rest of it" } });
    for (let i = 0; i < morning("light").length; i++) next();
    fireEvent.click(screen.getByRole("button", { name: "Save to my journal" }));
    expect(await screen.findByText("Saved to your journal.")).toBeInTheDocument();

    const sent = bodiesTo("/api/journal/entries") as JournalEntryInput[];
    const fuller = sent.find((e) => e.answers[0]?.text === "Half a thought, and the rest of it");
    expect(fuller).toBeDefined();
    expect(fuller!.clientId).not.toBe(draft.clientId);
    expect(pendingFor(OWNER)).toEqual([]);
  });

  it("holds the page still while it saves, so the words on screen are the words that went", async () => {
    const release = holdEntryPosts();
    renderToday();
    const qs = writeMorningToReview("Slept deep.");
    fireEvent.click(screen.getByRole("button", { name: "Save to my journal" }));
    await waitFor(() => expect(bodiesTo("/api/journal/entries")).toHaveLength(1));

    fireEvent.change(screen.getByRole("textbox", { name: qs[0]!.prompt }), { target: { value: "Slept deep. Woke at five." } });
    expect(screen.getByRole("textbox", { name: qs[0]!.prompt })).toHaveValue("Slept deep.");

    await act(async () => release());
    expect(await screen.findByText("Saved to your journal.")).toBeInTheDocument();
    const [sent] = bodiesTo("/api/journal/entries") as JournalEntryInput[];
    expect(sent!.answers[0]!.text).toBe("Slept deep.");
  });
});

describe("a page the journal turns down", () => {
  const AHEAD = "That entry is dated more than a day ahead. Check this device's clock.";

  it("stays open with the journal's sentence, and saves under the same clientId once put right", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/journal/entries" ? json({ error: AHEAD }, 400) : json({ error: "not-here" }, 404),
    );
    renderToday();
    const qs = writeMorningToReview();
    fireEvent.click(screen.getByRole("button", { name: "Save to my journal" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(AHEAD);
    expect(alert).not.toHaveTextContent("back online");
    // Still the review, still the words, still on the device.
    expect(screen.getByRole("heading", { name: "Read it back" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: qs[0]!.prompt })).toHaveValue("Slept deep.");
    expect(readDraft(OWNER)?.texts[qs[0]!.key]).toBe("Slept deep.");

    fetchMock.mockImplementation(async () => json({ id: "e1" }, 201));
    fireEvent.click(screen.getByRole("button", { name: "Save to my journal" }));
    expect(await screen.findByText("Saved to your journal.")).toBeInTheDocument();

    const ids = (bodiesTo("/api/journal/entries") as JournalEntryInput[]).map((e) => e.clientId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(pendingFor(OWNER)).toEqual([]);
  });
});

describe("a guide reply that comes back late", () => {
  it("is dropped when the member has moved on to another page", async () => {
    let answer!: () => void;
    guideAnswer = () => json({ reply: "Mornings sound heavy.", nextQuestion: "", reflection: "" });
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/journal/guide") return new Promise<Response>((resolve) => (answer = () => resolve(guideAnswer())));
      return json({ id: "e1" }, 201);
    });
    renderToday();
    startPractice("Morning");
    fireEvent.click(screen.getByRole("button", { name: "Ask the guide" }));
    fireEvent.click(screen.getByRole("button", { name: "Reflect this back to me" }));
    await waitFor(() => expect(bodiesTo("/api/journal/guide")).toHaveLength(1));

    // On a desk the panel has no scrim: the member leaves for an evening page.
    fireEvent.click(screen.getByRole("button", { name: "Choose another practice" }));
    startPractice("Evening");
    await act(async () => answer());

    fireEvent.click(screen.getByRole("button", { name: "Ask the guide" }));
    expect(screen.queryByText("Mornings sound heavy.")).toBeNull();
    expect(screen.getByRole("button", { name: "Reflect this back to me" })).toBeInTheDocument();
  });
});

it("names every practice the contract defines on the picker", () => {
  renderToday();
  for (const def of Object.values(JOURNAL_PRACTICE_DEFS)) {
    expect(screen.getByRole("button", { name: new RegExp(`^${def.label}`) })).toBeInTheDocument();
  }
});
