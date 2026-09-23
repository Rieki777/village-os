/**
 * Where the land is: the screen docs/VILLAGE_LAND.md section 6 specified.
 *
 * The routes it calls have existed, tested, since migration 0123 and could not
 * be reached by anybody: `scripts/check-admin-reach.mjs` carried two allowlist
 * lines saying exactly that. Those lines come out with this file.
 *
 * TWO THINGS THIS SCREEN IS CAREFUL ABOUT, both taken from the spec rather
 * than invented here.
 *
 *   THE PARSER RUNS IN THE BROWSER AND AGAIN ON THE WAY IN. `parseCoordinates`
 *   is imported from shared/, so a founder gets an answer as they type with no
 *   round trip, and the server re-parses regardless: a value validated only in
 *   a browser is a value not validated. The two cannot drift, because there is
 *   one function.
 *
 *   A FAILURE'S OWN WORDS ARE SHOWN VERBATIM. The copy in shared/land.ts is
 *   written for a founder and already says what to do next. Replacing it with
 *   "Invalid input" is the failure the spec calls out by name, and it would
 *   throw away the only sentence that helps.
 *
 * Each parcel is its own map and its own row. A project with one piece of
 * ground never sees the parcel controls do anything surprising: it has one
 * parcel, called 'home', and the list stays out of its way until there are two.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { API_BASE, authHeaders, refusal } from "@/components/admin/adminApi";
import {
  DEFAULT_PARCEL_SLUG,
  DEFAULT_SPAN_M,
  MAX_SPAN_M,
  MIN_SPAN_M,
  distanceM,
  isSeedFrame,
  parcelSlug,
  parseCoordinates,
  seedFrame,
} from "@shared/land";

/*
 * THE MAP'S OWN FRAME, and why this screen offers it.
 *
 * Every map ships with one picture baked in, cut to one rectangle of real
 * ground, and every building on a map that has not placed itself sits on that
 * rectangle. A picture fetched for any OTHER rectangle moves the ground under
 * every one of them. The easy way to do that by accident is to paste the
 * pin a mapping app gives you: for the village this map was first drawn for,
 * the pin is 345 metres from the rectangle's centre, and the default width is
 * a third of its span. So when somebody types a place near the map's own
 * ground and it is not the map's frame, this screen says so and offers the
 * frame, and a village anywhere else never sees the offer.
 */
const SEED = seedFrame();
const NEAR_SEED_M = 25_000;

type Parcel = {
  slug: string;
  label: string;
  sortOrder: number;
  centre: { lat: number; lon: number } | null;
  spanM: number;
  visibility: "hidden" | "approximate" | "exact";
  sourceText: string | null;
  /** Whether this parcel's frame is the map's own, worked out on the server. */
  seedFrame?: boolean;
  imagery: {
    provider: string | null;
    url: string | null;
    attribution: string;
    fetchedAt: string | null;
    error: string | null;
  };
};

/** What each visibility setting actually does, in the founder's words. */
const VISIBILITY: Array<{ id: Parcel["visibility"]; title: string; detail: string }> = [
  { id: "hidden", title: "Nobody", detail: "Visitors get no point on a map at all." },
  { id: "approximate", title: "Roughly where", detail: "Rounded to about a kilometre - the valley, not the driveway." },
  { id: "exact", title: "Exactly where", detail: "The coordinates you typed, as you typed them." },
];

export default function LandTab({ password }: { password: string }) {
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [provider, setProvider] = useState<any>(null);
  const [slug, setSlug] = useState(DEFAULT_PARCEL_SLUG);
  const [text, setText] = useState("");
  const [label, setLabel] = useState("");
  const [span, setSpan] = useState(String(DEFAULT_SPAN_M));
  const [visibility, setVisibility] = useState<Parcel["visibility"]>("hidden");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"" | "saving" | "fetching">("");
  const [newLabel, setNewLabel] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/land`, { headers: authHeaders(password) });
      if (res.ok) {
        const d = await res.json();
        setParcels(d.parcels ?? []);
        setProvider(d.configured ?? null);
      }
    } catch {
      /* leave whatever loaded */
    }
    setLoading(false);
  }, [password]);

  useEffect(() => {
    load();
  }, [load]);

  /* Move the form onto whichever parcel is selected, including after a save. */
  useEffect(() => {
    const p = parcels.find((x) => x.slug === slug);
    if (!p) return;
    setText(p.sourceText ?? (p.centre ? `${p.centre.lat}, ${p.centre.lon}` : ""));
    setLabel(p.label);
    setSpan(String(p.spanM ?? DEFAULT_SPAN_M));
    setVisibility(p.visibility);
  }, [slug, parcels]);

  /* The live reading, from the same parser the server will run. */
  const parsed = useMemo(() => (text.trim() ? parseCoordinates(text) : null), [text]);
  const spanNum = Number(span);
  const spanBad =
    span.trim() !== "" && (!Number.isFinite(spanNum) || spanNum < MIN_SPAN_M || spanNum > MAX_SPAN_M);
  const active = parcels.find((p) => p.slug === slug) ?? null;
  const nearSeedMismatch =
    parsed?.ok === true &&
    !spanBad &&
    distanceM({ lat: parsed.lat, lon: parsed.lon }, SEED.centre) < NEAR_SEED_M &&
    !isSeedFrame({ lat: parsed.lat, lon: parsed.lon }, spanNum);
  const useMapFrame = () => {
    setText(`${SEED.centre.lat.toFixed(7)}, ${SEED.centre.lon.toFixed(7)}`);
    setSpan(String(SEED.spanM));
  };

  const save = async (confirmSwapped = false) => {
    setBusy("saving");
    const res = await fetch(`${API_BASE}/admin/land`, {
      method: "PUT",
      headers: authHeaders(password, { "Content-Type": "application/json" }),
      body: JSON.stringify({ text, spanM: spanNum, visibility, slug, label, confirmSwapped }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) {
      /*
       * A suspected transposition is not something a founder should have to
       * retype their way out of: the server sends back the other reading, so
       * offer it as a button and let them choose.
       */
      if (d?.error === "swap-suspected" && d?.suggestion) {
        toast.error(d.message, {
          action: {
            label: `Use ${d.suggestion.lat}, ${d.suggestion.lon}`,
            onClick: () => setText(`${d.suggestion.lat}, ${d.suggestion.lon}`),
          },
          duration: 12000,
        });
        return;
      }
      return toast.error(refusal(d, "That location was refused"));
    }
    toast.success("Saved. The map draws this the next time it loads.");
    await load();
  };

  /*
   * THE UNDO. Deletes the kept file as well as the reference, because a picture
   * still reachable at its old address is not private, and private is what the
   * visibility note tells a founder this button gives them.
   */
  const removePicture = async () => {
    if (!window.confirm("Remove this picture? The map goes back to its own ground, and the file is deleted.")) return;
    setBusy("fetching");
    const res = await fetch(`${API_BASE}/admin/land/imagery?slug=${encodeURIComponent(slug)}`, {
      method: "DELETE",
      headers: authHeaders(password),
    });
    const d = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) return toast.error(refusal(d, "The picture could not be removed"));
    toast.success("Picture removed. The map draws its own ground again.");
    await load();
  };

  const fetchPicture = async () => {
    setBusy("fetching");
    const res = await fetch(`${API_BASE}/admin/land/imagery`, {
      method: "POST",
      headers: authHeaders(password, { "Content-Type": "application/json" }),
      body: JSON.stringify({ slug }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) return toast.error(refusal(d, "The picture could not be fetched"));
    toast.success("Picture fetched and kept.");
    await load();
  };

  const addParcel = () => {
    const s = parcelSlug(newLabel);
    if (!s) return toast.error("Give the piece of land a name with a letter or a number in it.");
    if (parcels.some((p) => p.slug === s)) {
      return toast.error("This project already has a parcel by that name.");
    }
    /*
     * A parcel exists once it has a location. The new one starts selected and
     * empty rather than being written as a row with no ground, so a founder who
     * changes their mind has not left a nameless parcel in the database.
     */
    setParcels((prev) => [
      ...prev,
      {
        slug: s,
        label: newLabel.trim(),
        sortOrder: prev.length,
        centre: null,
        spanM: DEFAULT_SPAN_M,
        visibility: "hidden",
        sourceText: null,
        imagery: { provider: null, url: null, attribution: "", fetchedAt: null, error: null },
      },
    ]);
    setSlug(s);
    setNewLabel("");
  };

  if (loading) return <div className="text-center py-12 text-gray-400">Loading...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Where The Land Is</h2>
        <p className="text-sm text-gray-500 mt-1">
          Put this project on the real map. Paste the coordinates of your land and the village map
          draws a photograph of that actual ground underneath it.
        </p>
      </div>

      {parcels.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {parcels.map((p) => (
            <button
              key={p.slug}
              onClick={() => setSlug(p.slug)}
              className={`text-xs rounded-full px-3 py-1.5 border ${
                p.slug === slug
                  ? "bg-teal-deep text-white border-teal-deep"
                  : "bg-white text-gray-600 border-gray-200"
              }`}
            >
              {p.label || "The land"}
              {!p.centre && <span className="opacity-60"> · not placed</span>}
            </button>
          ))}
        </div>
      )}

      <div className="border border-gray-200 rounded-xl p-4 space-y-4">
        {parcels.length > 1 && (
          <div>
            <label className="block text-sm font-medium text-gray-900">
              What this piece of land is called
            </label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="North field"
              className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-900">Location</label>
          <p className="text-xs text-gray-500 mt-0.5">
            In Google Maps, long-press your land and copy the pair of numbers at the top. A map link
            works too.
          </p>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="9.2345, -83.8412"
            className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 font-mono"
          />
          {parsed && parsed.ok && (
            <div className={`mt-1.5 text-xs ${parsed.swap === "none" ? "text-gray-500" : "text-amber-700"}`}>
              Read as {formatName(parsed.format)}:{" "}
              <span className="font-mono">
                {parsed.lat}, {parsed.lon}
              </span>
              {parsed.swap !== "none" && parsed.swapped && (
                <>
                  {" · those two look like they arrived the other way round. "}
                  <button
                    onClick={() => setText(`${parsed.swapped!.lat}, ${parsed.swapped!.lon}`)}
                    className="underline font-medium"
                  >
                    use {parsed.swapped.lat}, {parsed.swapped.lon} instead
                  </button>
                </>
              )}
            </div>
          )}
          {parsed && !parsed.ok && (
            <div className="mt-1.5 text-xs text-red-600">
              {/* Verbatim. This copy is written for the founder and says what to do. */}
              {parsed.message}
              {parsed.suggestion && (
                <>
                  {" "}
                  <button
                    onClick={() => setText(`${parsed.suggestion!.lat}, ${parsed.suggestion!.lon}`)}
                    className="underline font-medium"
                  >
                    use {parsed.suggestion.lat}, {parsed.suggestion.lon}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-900">How wide across, in metres</label>
          <p className="text-xs text-gray-500 mt-0.5">
            How much ground to photograph - not the shape of your parcel, which you draw on the map
            itself.
          </p>
          <input
            value={span}
            onChange={(e) => setSpan(e.target.value)}
            inputMode="numeric"
            className="mt-1 w-40 text-sm border border-gray-200 rounded-lg px-3 py-2"
          />
          {nearSeedMismatch && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              This map's buildings were placed on a frame centred at{" "}
              <span className="font-mono">
                {SEED.centre.lat.toFixed(5)}, {SEED.centre.lon.toFixed(5)}
              </span>{" "}
              and {SEED.spanM.toLocaleString()} m across. A picture framed anywhere else moves the ground
              under every one of them.{" "}
              <button onClick={useMapFrame} className="underline font-medium">
                Use the map's frame
              </button>
            </div>
          )}
          {spanBad && (
            <div className="mt-1.5 text-xs text-red-600">
              Pick a number of metres between {MIN_SPAN_M} and {MAX_SPAN_M}. Most projects sit near{" "}
              {DEFAULT_SPAN_M}.
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-900">Who can see where this is</label>
          <div className="mt-1.5 space-y-1.5">
            {VISIBILITY.map((v) => (
              <label key={v.id} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={visibility === v.id}
                  onChange={() => setVisibility(v.id)}
                  className="mt-0.5"
                />
                <span className="text-sm text-gray-700">
                  <span className="font-medium text-gray-900">{v.title}</span> - {v.detail}
                </span>
              </label>
            ))}
          </div>
          {/*
            The spec requires this said in plain words next to the radios. The
            setting is named in a way that invites a founder to assume it covers
            the photograph too, and it does not.
          */}
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            These three settings cover the <strong>coordinates only</strong>. Your aerial picture is
            shown to visitors at every setting, including "Nobody". Use "Remove the picture" below if you
            would rather it were not.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            onClick={() => save(parsed?.ok === true && parsed.swap !== "none")}
            disabled={busy !== "" || !parsed?.ok || spanBad}
            className="text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium disabled:opacity-40"
          >
            {busy === "saving" ? "Saving..." : "Save this location"}
          </button>
          <button
            onClick={fetchPicture}
            disabled={busy !== "" || !active?.centre || !provider?.ready}
            className="text-sm border border-gray-300 text-gray-700 rounded-lg px-4 py-2 font-medium disabled:opacity-40"
          >
            {busy === "fetching" ? "Fetching..." : "Fetch the picture"}
          </button>
          {active?.imagery?.url && (
            <button
              onClick={removePicture}
              disabled={busy !== ""}
              className="text-sm border border-red-200 text-red-700 rounded-lg px-4 py-2 font-medium disabled:opacity-40"
            >
              Remove the picture
            </button>
          )}
        </div>

        {!provider?.providerId && (
          <p className="text-xs text-gray-500">
            No imagery provider is set up for this deployment, so there is nothing to fetch from yet.
            Until one is, the map draws its own ground.
          </p>
        )}
        {provider?.providerId && !provider?.ready && (
          <p className="text-xs text-amber-700">
            {provider.providerLabel} is selected and {provider.missingEnv} is not set, so there is no
            key to call it with.
          </p>
        )}
        {active?.imagery?.error && (
          <p className="text-xs text-red-600">Last attempt: {active.imagery.error}</p>
        )}
      </div>

      {active?.imagery?.url && (
        <div className="border border-gray-200 rounded-xl p-4">
          <h3 className="font-semibold text-gray-900 text-sm mb-2">The picture the map is drawing</h3>
          <img
            src={active.imagery.url}
            alt="Aerial photograph of this parcel"
            className="w-full max-w-lg rounded-lg"
          />
          <p className="text-[11px] text-gray-500 mt-1.5">{active.imagery.attribution}</p>
          <p className="text-xs text-gray-600 mt-2">
            {active.seedFrame
              ? "This picture matches the map's own frame, so the map keeps its coastline and place names."
              : "This picture sets its own frame. The map measures and places everything against it, and shows none of another place's names."}
          </p>
        </div>
      )}

      <div className="border border-dashed border-gray-300 rounded-xl p-4">
        <h3 className="font-semibold text-gray-900 text-sm">Another piece of land</h3>
        <p className="text-xs text-gray-500 mt-0.5 mb-2">
          Projects often hold several parcels in different places. Each one gets its own map, because
          two pieces of ground far apart share no single honest picture - the map gives you a way to
          jump between them.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="North field"
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5"
          />
          <button
            onClick={addParcel}
            disabled={!newLabel.trim()}
            className="text-sm bg-teal-deep text-white rounded-lg px-3 py-1.5 font-medium disabled:opacity-40"
          >
            Add
          </button>
          {newLabel.trim() && parcelSlug(newLabel) && (
            <span className="text-[11px] text-gray-400 font-mono">/{parcelSlug(newLabel)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** The parser's format id, said the way a founder would say it. */
function formatName(format: string): string {
  if (format === "decimal") return "a pair of decimal numbers";
  if (format === "dms") return "degrees, minutes and seconds";
  if (format === "google-url") return "a Google Maps link";
  return format;
}
