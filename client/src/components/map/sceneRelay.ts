/**
 * The map asking the village to keep, publish, discard or roll back its
 * work.
 *
 * Same relay discipline as the promises in LivingMap.tsx and for the same
 * reasons: the shell decides nothing, the route owns every permission
 * question and every sentence, and A REPLY GOES BACK ON EVERY PATH including
 * a thrown fetch. The map's rule is that silence means the optimistic state
 * stands, which is right when it runs standalone from `file://` and dangerous
 * here: a village that answered "you may not publish" has to reach the
 * person, or they will believe the land moved when it did not.
 *
 * The nonce is echoed exactly and never inspected, so a reply to a publish
 * the member already replaced cannot apply itself over the newer one. `send`
 * is where the caller attaches it.
 *
 * Out of LivingMap.tsx so the order of the restore branch can be tested
 * without mounting a frame: the page is at the line ceiling, and this is the
 * one relay whose ORDER is the behaviour.
 *
 * A REFUSAL TRAVELS WHOLE. The route's sentence (`message`, else `error`)
 * and the status both go back. Forwarding the bare `error` turned a 401
 * into the code "auth_required" on the map, toasted as it stood by the undo
 * button, and without the status the map could not tell a refusal no retry
 * will fix (signed out, the hand gone) from a connection that dropped, so it
 * retried both forever.
 */
import { gameFetch } from "@/lib/gameApi";

export type SceneReply = Record<string, unknown>;

/** The village's no, as the map needs it: the sentence and the status. */
function refusal(res: Response, body: any): SceneReply {
  return { ok: false, status: res.status, error: body?.message ?? body?.error };
}

export async function relaySceneMessage(
  msg: any,
  send: (r: SceneReply) => void,
  pushConfig: () => Promise<void>,
): Promise<void> {
  // The scene is stringified ONCE, here, and that exact text is what the
  // server stores. Building it twice would risk two different strings.
  const sceneText = () => {
    try {
      return JSON.stringify(msg.scene);
    } catch {
      return null;
    }
  };

  try {
    if (msg.type === "draft-save") {
      const scene = sceneText();
      if (!scene) return send({ ok: false, error: "That draft could not be written down." });
      const res = await gameFetch("/api/map/draft", {
        method: "PUT",
        body: JSON.stringify({ scene, baseVersion: msg.baseVersion ?? 0 }),
      });
      const body = await res.json().catch(() => null);
      return send(res.ok ? { ok: true, baseVersion: body?.baseVersion } : refusal(res, body));
    }

    if (msg.type === "draft-discard") {
      const res = await gameFetch("/api/map/draft", { method: "DELETE" });
      const body = await res.json().catch(() => null);
      return send(res.ok ? { ok: true } : refusal(res, body));
    }

    if (msg.type === "publish") {
      const scene = sceneText();
      if (!scene) return send({ ok: false, error: "That scene could not be written down." });
      const res = await gameFetch("/api/map/publish", {
        method: "POST",
        body: JSON.stringify({ scene, baseVersion: msg.baseVersion ?? 0, note: msg.note ?? null }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) return send({ ok: true, version: body?.version, live: body?.live });
      // 409 carries WHO moved the map and WHEN. It travels untouched: the
      // route owns that sentence so there is one place it is written.
      return send({ ...refusal(res, body), reason: body?.reason, live: body?.live });
    }

    if (msg.type === "restore") {
      const version = Number(msg.version);
      // The version this undoes, so the village can refuse when something
      // newer is live. Passed through untouched: the route decides.
      const from = Number(msg.from);
      const res = await gameFetch(`/api/map/revisions/${version}/restore`, {
        method: "POST",
        ...(Number.isInteger(from) && from > 0 ? { body: JSON.stringify({ from }) } : {}),
      });
      const body = await res.json().catch(() => null);
      // 409 names who published since, and what is live: the same card a
      // refused publish carries.
      if (!res.ok) return send({ ...refusal(res, body), reason: body?.reason, live: body?.live });
      /*
       * THE LAND THAT CAME BACK GOES TO THE MAP BEFORE THE ANSWER DOES. An
       * undo puts an older scene live and the map was never shown it: the
       * cartographer kept looking at the change they had just undone, "View
       * as visitor" called it the live map, and their next small publish
       * carried it straight back. The config push is the same one every map
       * boots from, so the map takes the restored scene through the one door
       * every scene comes in by, and decides there whether it may repaint
       * over unpublished work. Awaited, so the scene lands first and the
       * answer finds it. A push that fails keeps the map's own land, and
       * the undo is still reported as done, because it is.
       */
      await pushConfig().catch(() => undefined);
      return send({ ok: true, version: body?.version, live: body?.live });
    }
  } catch {
    return send({ ok: false, error: "The village could not be reached. Your work is still here." });
  }
}
