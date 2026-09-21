/**
 * The handle on the break-glass, tested where it is testable.
 *
 * This repo's client tests are pure logic and there is no jsdom, so the
 * reading of a refusal and the sentences it turns into are the whole surface
 * here. The wrapper itself, the dialog and the replay carrying the header are
 * driven for real by `server/glassHandle.routes.e2e.test.ts` and by a browser
 * on a booted server, because a fake `fetch` asserting that a fake header was
 * set proves nothing about either.
 */
import { describe, expect, it } from "vitest";
import {
  breakGlassCopy,
  declinedMessage,
  declinedRefusal,
  readOverrideRefusal,
  OVERRIDE_HEADER,
} from "./breakGlass";

const REFUSAL = {
  error: "This village holds this one. Steward Circle looks after it now, and you are not seated there.",
  capability: "forum.moderate",
  villageHolds: true,
  requiresOverride: true,
  overrideAvailable: true,
  holder: "Steward Circle",
  title: "The forum",
  consequence: "hide posts and act on reports for the whole community",
};

describe("reading the one refusal that has a way through", () => {
  it("reads the facts off a village-held 409", () => {
    const ask = readOverrideRefusal(409, REFUSAL);
    expect(ask).toEqual({
      capability: "forum.moderate",
      title: "The forum",
      holder: "Steward Circle",
      consequence: "hide posts and act on reports for the whole community",
    });
  });

  it("ignores every other 409 in the product", () => {
    // The escalation confirm, the already-open ask, the closed ballot. Each
    // one is a real 409 with its own control, and offering to break glass on
    // any of them would be an answer to a question nobody asked.
    expect(readOverrideRefusal(409, { error: "nope", requiresConfirmation: true })).toBeNull();
    expect(readOverrideRefusal(409, { error: "You already have this ask open" })).toBeNull();
    expect(readOverrideRefusal(409, { requiresOverride: false, capability: "forum.moderate" })).toBeNull();
  });

  it("ignores every other status, including a 403 that carries the flag", () => {
    expect(readOverrideRefusal(403, REFUSAL)).toBeNull();
    expect(readOverrideRefusal(200, REFUSAL)).toBeNull();
    expect(readOverrideRefusal(401, REFUSAL)).toBeNull();
  });

  it("refuses a body that is not an object, and an array", () => {
    expect(readOverrideRefusal(409, null)).toBeNull();
    expect(readOverrideRefusal(409, "requiresOverride")).toBeNull();
    expect(readOverrideRefusal(409, [REFUSAL])).toBeNull();
  });

  it("needs a capability, because the whole dialog is about one power", () => {
    expect(readOverrideRefusal(409, { requiresOverride: true, overrideAvailable: true })).toBeNull();
    expect(readOverrideRefusal(409, { requiresOverride: true, overrideAvailable: true, capability: "" })).toBeNull();
    expect(readOverrideRefusal(409, { requiresOverride: true, overrideAvailable: true, capability: 7 })).toBeNull();
  });

  /*
   * Rye, 2026-09-21: only a founder seated as a steward with the veto may
   * reach past a village-held power. The server says so per requester, and
   * a question it would refuse after it was answered is the one thing this
   * reader must never produce.
   */
  it("offers nothing to somebody the server would refuse, and leaves their sentence alone", () => {
    const plain = {
      ...REFUSAL,
      overrideAvailable: false,
      error: "This village holds this one, and Steward Circle looks after it now. " +
        "A founder can override it only while seated as a steward with the veto.",
    };
    expect(readOverrideRefusal(409, plain)).toBeNull();
    // Absent is not yes. A body that does not say is a body that does not offer.
    const { overrideAvailable: _unsaid, ...silent } = REFUSAL;
    expect(readOverrideRefusal(409, silent)).toBeNull();
    expect(readOverrideRefusal(409, { ...REFUSAL, overrideAvailable: "true" })).toBeNull();
    // The control: the same body with the flag set IS a question.
    expect(readOverrideRefusal(409, { ...plain, overrideAvailable: true })).not.toBeNull();
  });

  it("prints the key when the registry has no title for it", () => {
    // The honest fallback, and the same one `capabilityLabel` makes on the
    // server: a missing title is a missing row, and saying the key out loud
    // is how somebody finds out.
    const ask = readOverrideRefusal(409, { requiresOverride: true, overrideAvailable: true, capability: "dial.set" });
    expect(ask?.title).toBe("dial.set");
  });

  it("keeps a missing holder and a missing consequence missing", () => {
    const ask = readOverrideRefusal(409, {
      requiresOverride: true,
      overrideAvailable: true,
      capability: "dial.set",
      holder: "",
      consequence: null,
    });
    expect(ask?.holder).toBeNull();
    expect(ask?.consequence).toBeNull();
  });
});

describe("the sentences an operator reads before deciding", () => {
  it("names the power, what it does, and who looks after it", () => {
    const copy = breakGlassCopy(readOverrideRefusal(409, REFUSAL)!);
    expect(copy.power).toBe(
      "The forum. Whoever holds it can hide posts and act on reports for the whole community.",
    );
    expect(copy.holder).toBe("Steward Circle looks after it now, and you are not seated there.");
  });

  it("says the record without inventing a holder or a consequence", () => {
    const copy = breakGlassCopy({
      capability: "dial.set",
      title: "dial.set",
      holder: null,
      consequence: null,
    });
    expect(copy.power).toBe("dial.set.");
    expect(copy.holder).toContain("The village looks after it now");
    expect(copy.holder).not.toContain("null");
    expect(copy.power).not.toContain("undefined");
  });

  it("states the consequence as a fact and never as an argument", () => {
    /*
     * R56 is what this case pins. The line says what happens and stops. It
     * does not ask whether somebody is sure, does not call anything
     * dangerous, and carries no exclamation, because an operator with a good
     * reason should not be talked out of a thing they are allowed to do.
     */
    const copy = breakGlassCopy(readOverrideRefusal(409, REFUSAL)!);
    expect(copy.record).toBe(
      "If the act goes through, the village's own feed carries a line naming you and this power, " +
        "and whoever holds it is told.",
    );
    expect(copy.record).not.toMatch(/!|sure\?|danger|warning|careful|irreversible/i);
    expect(copy.heading).not.toMatch(/\?/);
    expect(copy.confirm).toBe("Act anyway");
    expect(copy.dismiss).toBe("Leave it");
  });

  it("spells the header the way the server reads it", () => {
    expect(OVERRIDE_HEADER).toBe("x-capability-override");
  });
});

/**
 * The sentence the server writes for a terminal, word for word from
 * `overrideRefusal` in `server/index.ts`. It is here as the CONTROL: these
 * cases are only worth anything if the string they replace really does hand
 * somebody a header to send, and asserting that against a paraphrase would
 * prove nothing about what ships.
 */
const CURL_ERROR =
  "This village holds this one. Steward Circle looks after it now, and you are not seated there. " +
  "You can still act on it: send override with this request, or the x-capability-override header " +
  "when it carries no body, and the village will see that you did.";

describe("what an operator reads after they decline", () => {
  it("confirms the choice and names who kept it", () => {
    expect(declinedMessage(readOverrideRefusal(409, REFUSAL)!)).toBe(
      "Left it with Steward Circle. The act did not go through.",
    );
  });

  it("keeps a missing holder missing", () => {
    const message = declinedMessage({
      capability: "dial.set",
      title: "dial.set",
      holder: null,
      consequence: null,
    });
    expect(message).toBe("Left it with the village. The act did not go through.");
    expect(message).not.toContain("null");
  });

  it("hands nobody a terminal instruction", () => {
    // The whole point. The control below proves the string being replaced
    // really did carry one, so a green here is about the swap and not about
    // a refusal that never mentioned a header in the first place.
    expect(CURL_ERROR).toContain("x-capability-override");
    for (const ask of [readOverrideRefusal(409, REFUSAL)!, { capability: "c", title: "c", holder: null, consequence: null }]) {
      const message = declinedMessage(ask);
      expect(message).not.toContain("x-capability-override");
      expect(message).not.toContain("header");
      expect(message).not.toContain("override");
    }
  });

  it("swaps the sentence and keeps every other fact the server sent", async () => {
    const served = new Response(JSON.stringify({ ...REFUSAL, error: CURL_ERROR }), {
      status: 409,
      statusText: "Conflict",
      headers: { "content-type": "application/json", "content-length": "999" },
    });
    const body = await served.clone().json();
    const declined = declinedRefusal(served, body, readOverrideRefusal(409, body)!);

    expect(declined.status).toBe(409);
    expect(declined.ok).toBe(false);
    expect(declined.statusText).toBe("Conflict");

    const seen = await declined.json();
    expect(seen.error).toBe("Left it with Steward Circle. The act did not go through.");
    expect(seen.requiresOverride).toBe(true);
    expect(seen.villageHolds).toBe(true);
    expect(seen.capability).toBe("forum.moderate");
    expect(seen.holder).toBe("Steward Circle");
    expect(seen.title).toBe("The forum");
    expect(seen.consequence).toBe(REFUSAL.consequence);
  });

  it("drops the two headers it just invalidated", async () => {
    // `server/index.ts` mounts `compression`, so content-encoding is a header
    // a real 409 can arrive carrying, and the replacement body is not gzipped.
    const served = new Response(JSON.stringify({ ...REFUSAL, error: CURL_ERROR }), {
      status: 409,
      headers: {
        "content-type": "application/json",
        "content-length": "999",
        "content-encoding": "gzip",
      },
    });
    expect(served.headers.get("content-length")).toBe("999");
    expect(served.headers.get("content-encoding")).toBe("gzip");
    const declined = declinedRefusal(served, await served.clone().json(), readOverrideRefusal(409, REFUSAL)!);
    expect(declined.headers.get("content-length")).toBeNull();
    expect(declined.headers.get("content-encoding")).toBeNull();
    expect(declined.headers.get("content-type")).toBe("application/json");
  });

  it("survives a body it cannot spread", async () => {
    // `declinedRefusal` is only ever reached through a body that already read
    // as a refusal, so this can't happen today. It is here so that the day
    // something upstream changes, the operator gets a sentence and not a
    // thrown TypeError inside a fetch wrapper every page depends on.
    const served = new Response("[]", { status: 409 });
    const declined = declinedRefusal(served, [], readOverrideRefusal(409, REFUSAL)!);
    expect(await declined.json()).toEqual({
      error: "Left it with Steward Circle. The act did not go through.",
    });
  });
});
