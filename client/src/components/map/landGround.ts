/**
 * The ground the map draws its village on, as the map's config carries it.
 *
 * The artifact ships the seed's satellite plate baked in, and for a long time
 * that was the ONLY ground a deployment could have: a new village's map
 * needed a developer, three Python scripts and a redeploy of a 5.7 MB file.
 * This is what makes the ground data instead of code -- the village's own
 * picture, fetched once into the uploads volume by
 * `POST /api/admin/land/imagery` and served from there.
 *
 * ABSENT MEANS KEEP YOUR OWN, the same rule the walk and the scene follow. A
 * village that has not placed itself answers `imageryUrl: null`, this returns
 * null and the config carries no ground, so the map draws the seed it was
 * built with. That is the ordinary state of a fresh fork and not a failure.
 *
 * IT TRAVELS IN THE CONFIG (N19). It used to be a separate `{type:'ground'}`
 * message sent beside the config, and the map posts `land-ready`, which lifts
 * the shell's cover, once it has applied the config. Nothing waited for the
 * ground: MEASURED in Chromium with the village's plate held 8 s, the cover
 * lifted at 3.1 s over the seed's own coast and caption, and the village's
 * ground replaced it 7.6 s later in plain view. Inside the config the map
 * knows there is a ground coming and holds its cover until it has drawn. The
 * shell still sends it ahead on its own the moment it is known, so the
 * picture downloads while the config is on its way; the map loads it once.
 *
 * THE PICTURE TRAVELS WITH ITS FRAME. A URL on its own told the map nothing
 * about where the picture was taken or how much ground it covers, so the map
 * stretched it across a frame it was never cut for: three times too large and
 * 345 m off on the one village this was built for. `frame` carries only what
 * the route was already willing to publish:
 *
 *   spanM   the width, which sets the scale and names no place
 *   seed    one yes-or-no, worked out on the server: does this picture show
 *           the seed's own rectangle? If so the seed's surround, place names
 *           and caption still describe the ground and stay; if not they are
 *           another place's geography and the map takes them down
 *   centre  whatever /api/land gives, which is null at "hidden" and rounded
 *           at "approximate". The map uses it for coordinates it shows and
 *           shows none when it is null
 *
 * No surround travels with it yet. A wider fetch does not exist on this route,
 * and a village standing anywhere but the seed's own rectangle gets no
 * borrowed coastline in the meantime. When that fetch lands it attaches here
 * as `surround: { url, rect }`.
 */
export interface LandGround {
  core: { url: string };
  frame: {
    spanM: number | null;
    seed: boolean;
    centre: { lat: number; lon: number } | null;
  };
}

/**
 * The village's own ground from its land record, or null to keep the seed.
 * Pure: the shell reads `GET /api/land` once per boot (configPush.ts
 * `readLand`) and the same answer gives this ground and the seed verdict, so
 * a null record (a read that failed) keeps the seed too.
 */
export function landGroundOf(body: Record<string, any> | null | undefined): LandGround | null {
  const url = typeof body?.imageryUrl === "string" ? body.imageryUrl : "";
  if (!url) return null;
  const spanM = Number(body?.spanM);
  const c = body?.centre;
  return {
    core: { url },
    frame: {
      spanM: Number.isFinite(spanM) && spanM > 0 ? spanM : null,
      seed: body?.seedFrame === true,
      centre:
        c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lon))
          ? { lat: Number(c.lat), lon: Number(c.lon) }
          : null,
    },
  };
}
