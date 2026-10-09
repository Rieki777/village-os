/**
 * What the shell's config push says about the LAND: which scene, and whether
 * the seed's own ground belongs under it.
 *
 * Two decisions, both pure, so they are tested without a frame. LivingMap's
 * `pushConfig` sends what they return.
 *
 * ── THE SCENE ────────────────────────────────────────────────────────────
 * A published scene travels as JSON text and is parsed here, once. NOTHING
 * PUBLISHED (`scene: null` with `sceneVersion: 0`, which only a server that
 * answered says) is no longer "keep your own": the map's own is another
 * village's land. It gets `blankScene()` instead, once per frame, because
 * the map treats every version-0 push as news and a second one, sent when a
 * skin is saved, would tell a cartographer mid-draft that the live map had
 * changed. Anything the server did not answer still sends no scene at all.
 *
 * ── THE GROUND ───────────────────────────────────────────────────────────
 * `seedFrame` from `GET /api/land` says whether this village stands on the
 * seed's own rectangle. The map took the seed's coast and place names down
 * only under a village with its own picture; under one without, it drew the
 * seed's satellite, coast, place names and district names as the village's.
 * The verdict rides the config push, ahead of the scene, so the land is
 * painted once on the right ground and the cover lifts on it. A land read
 * that fails says nothing, and the map keeps what it would have drawn before.
 *
 * The land read is the one the ground push makes as well, so the shell asks
 * once per boot and hands the same answer to both.
 */
import { blankScene } from "@shared/mapFromMasterplan";

export type LandAnswer = Record<string, any> | null;

/** The village's public land record, or null when it could not be read. */
export function readLand(): Promise<LandAnswer> {
  return fetch("/api/land")
    .then(async (res) => (res.ok ? ((await res.json()) as LandAnswer) : null))
    .catch(() => null);
}

/** Whether the village stands on the seed's rectangle, or null when nothing reliable was said. */
export function seedGroundOf(land: LandAnswer): boolean | null {
  return land && typeof land.seedFrame === "boolean" ? land.seedFrame : null;
}

/**
 * The scene part of a config push, from the config route's answer.
 *
 * Returns null when no scene should be sent: the server sent one that will
 * not parse (the map keeps the land it already has, a strictly better failure
 * than a half-applied scene), or said nothing usable, or the blank has
 * already been sent to this frame.
 */
export function configScene(
  body: any,
  blankAlreadySent: boolean,
): { scene: unknown; sceneVersion: number; blank: boolean } | null {
  if (typeof body?.scene === "string" && body.scene) {
    try {
      return { scene: JSON.parse(body.scene), sceneVersion: Number(body.sceneVersion) || 0, blank: false };
    } catch {
      return null;
    }
  }
  if (body?.scene === null && body?.sceneVersion === 0 && !blankAlreadySent) {
    return { scene: blankScene(), sceneVersion: 0, blank: true };
  }
  return null;
}
