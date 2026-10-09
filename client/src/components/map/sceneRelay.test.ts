/**
 * AN UNDO SHOWS THE MAP THE LAND IT PUT BACK, BEFORE IT SAYS IT WORKED.
 *
 * On 2026-10-01 a cartographer who pressed "Undo this" after a publish got
 * "Version 6 is live again" over a map still showing version 7. The relay
 * answered the restore and stopped there, so the map never saw the scene
 * that had gone live: "View as visitor" called the undone land the live map,
 * and the next small publish shipped the undone change again.
 *
 * The restore branch now pushes the village's config, which carries the
 * published scene, and only then answers. The ORDER is the behaviour: the
 * map takes the scene in through applyScene, then reads the answer, so this
 * pins the order and not just that both happened.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const gameFetch = vi.fn();
vi.mock("@/lib/gameApi", () => ({ gameFetch: (...a: unknown[]) => gameFetch(...a) }));

import { relaySceneMessage } from "./sceneRelay";

const reply = (ok: boolean, body: unknown, status = ok ? 200 : 400) => ({ ok, status, json: async () => body });

let order: string[];
let sent: Record<string, unknown>[];
const send = (r: Record<string, unknown>) => {
  order.push("answer");
  sent.push(r);
};
const pushConfig = vi.fn(async () => {
  order.push("config");
});

beforeEach(() => {
  order = [];
  sent = [];
  gameFetch.mockReset();
  pushConfig.mockClear();
});

describe("restoring an earlier version", () => {
  it("pushes the village's config, with the restored scene, before it answers", async () => {
    gameFetch.mockResolvedValue(reply(true, { ok: true, version: 8, live: { version: 8, previous: 7 } }));
    await relaySceneMessage({ type: "restore", nonce: "n1", version: 6 }, send, pushConfig);
    expect(gameFetch).toHaveBeenCalledWith("/api/map/revisions/6/restore", { method: "POST" });
    expect(order).toEqual(["config", "answer"]);
    expect(sent[0]).toEqual({ ok: true, version: 8, live: { version: 8, previous: 7 } });
  });

  it("pushes nothing when the village refused, and passes its sentence on", async () => {
    gameFetch.mockResolvedValue(reply(false, { error: "Putting an earlier map back is a cartographer's work." }, 403));
    await relaySceneMessage({ type: "restore", nonce: "n2", version: 6 }, send, pushConfig);
    expect(pushConfig).not.toHaveBeenCalled();
    expect(sent).toEqual([{ ok: false, status: 403, error: "Putting an earlier map back is a cartographer's work." }]);
  });

  /* ROUND 3, FINDING 2. The map says which version the undo takes back, so
     the village can refuse once a colleague has published after it, and the
     refusal carries who and what is live, as a refused publish does. */
  it("tells the village which version it undoes, and carries a stale refusal back whole", async () => {
    const live = { version: 8, by: "Other Admin", at: "2026-10-02" };
    gameFetch.mockResolvedValue(reply(false, { ok: false, reason: "stale", error: "Other Admin published version 8 after version 7.", live }, 409));
    await relaySceneMessage({ type: "restore", nonce: "n4", version: 6, from: 7 }, send, pushConfig);
    expect(gameFetch).toHaveBeenCalledWith("/api/map/revisions/6/restore", { method: "POST", body: JSON.stringify({ from: 7 }) });
    expect(pushConfig).not.toHaveBeenCalled();
    expect(sent).toEqual([{ ok: false, status: 409, reason: "stale", error: "Other Admin published version 8 after version 7.", live }]);
  });

  it("still reports the undo as done when the config push itself fails", async () => {
    gameFetch.mockResolvedValue(reply(true, { ok: true, version: 8, live: { version: 8 } }));
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    await relaySceneMessage({ type: "restore", nonce: "n3", version: 6 }, send, failing);
    expect(failing).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([{ ok: true, version: 8, live: { version: 8 } }]);
  });
});

describe("the other verbs are unchanged by the move out of LivingMap", () => {
  it("publishes the exact text of the scene and does not push config", async () => {
    gameFetch.mockResolvedValue(reply(true, { ok: true, version: 7, live: { version: 7 } }));
    await relaySceneMessage({ type: "publish", scene: { a: 1 }, baseVersion: 6, note: "n" }, send, pushConfig);
    expect(gameFetch).toHaveBeenCalledWith("/api/map/publish", {
      method: "POST",
      body: JSON.stringify({ scene: JSON.stringify({ a: 1 }), baseVersion: 6, note: "n" }),
    });
    expect(pushConfig).not.toHaveBeenCalled();
    expect(sent).toEqual([{ ok: true, version: 7, live: { version: 7 } }]);
  });

  /* N22 and D28. A refusal carried only `error`, so a 401 reached the map
     as the code "auth_required", and without the status the map could not
     tell a refusal no retry fixes from a dropped connection. */
  it("carries the route's sentence and the status of a refused save", async () => {
    gameFetch.mockResolvedValue(reply(false, { error: "auth_required", message: "Sign in to keep a draft of the map." }, 401));
    await relaySceneMessage({ type: "draft-save", scene: { a: 1 }, baseVersion: 6 }, send, pushConfig);
    expect(sent).toEqual([{ ok: false, status: 401, error: "Sign in to keep a draft of the map." }]);
  });

  it("falls back to the code when the route gave no sentence", async () => {
    gameFetch.mockResolvedValue(reply(false, { error: "auth_required" }, 401));
    await relaySceneMessage({ type: "draft-discard" }, send, pushConfig);
    expect(sent).toEqual([{ ok: false, status: 401, error: "auth_required" }]);
  });

  it("answers every path, a thrown fetch included", async () => {
    gameFetch.mockRejectedValue(new Error("network"));
    await relaySceneMessage({ type: "draft-discard" }, send, pushConfig);
    expect(sent).toEqual([{ ok: false, error: "The village could not be reached. Your work is still here." }]);
  });
});
