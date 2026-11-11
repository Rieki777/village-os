/**
 * The two stand-ins the rehearsal boots beside the server, so a night's run
 * never sends a real email and never calls a real model.
 *
 *   - Mail: the repository's own fake Resend (server/testkit/fakeResend.ts),
 *     which records every email the post office sends. The server reaches it
 *     through RESEND_API_BASE. Every email lands in `mail.emails()` and the run
 *     writes them to emails.json.
 *   - The AI endpoint: a stub of the Messages API that answers every call with
 *     one canned reply carrying every draft kind the guide asks for (aim, story,
 *     goals). The server reaches it through ANTHROPIC_BASE_URL. Its calls are
 *     counted and written to ai-calls.json. The words are made up and plain, and
 *     the rehearsal never judges a person by them.
 *
 * This file imports TypeScript, so the runner starts under tsx
 * (`node --import tsx scripts/rehearsal/run.mjs`).
 */
import http from "node:http";
import { startFakeResend } from "../../server/testkit/fakeResend.ts";

export const MAIL_KEY = "re_rehearsal_not_real";

export async function startMail() {
  return startFakeResend({ apiKey: MAIL_KEY });
}

const CANNED = {
  aim: "Keep our shared work clear and trusted, so every circle can plan with confidence.",
  story: "I have looked after shared work for small groups for years and I want it to serve one place.",
  goals: [
    { title: "Publish the first weekly view", doneWhen: "every circle has read it", moves: "A weekly view" },
    { title: "One living plan", doneWhen: "the first circle reads it together", moves: "One living plan" },
    { title: "Everything on time", doneWhen: "nothing is late this moon", moves: "Everything on time" },
  ],
};

/** Starts the AI stub on `port` (0 picks one). Resolves to { url, calls(), close() }. */
export async function startAiStub(port = 0) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      calls.push({ path: req.url, at: new Date().toISOString(), bytes: body.length });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_rehearsal",
          type: "message",
          role: "assistant",
          model: "rehearsal-stub",
          content: [{ type: "text", text: JSON.stringify(CANNED) }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    });
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const actual = server.address().port;
  return {
    url: `http://127.0.0.1:${actual}`,
    calls: () => calls.slice(),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
