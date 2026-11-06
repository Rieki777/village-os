import { useEffect, useRef, useState } from "react";
import {
  HOME_FIELDS,
  INITIAL_PHASE,
  homeFieldValue,
  homePatch,
  isHomeNoOp,
  loadSettled,
  loadStarted,
  showsPlaceholder,
  type HomeField,
  type HomeTypeFounderRow,
  type HomeTypePatchBody,
} from "@/lib/housingForm";

/**
 * The homes this village offers (0131): the other half of the housing tab.
 *
 * ── WHAT THIS EXISTS TO END ──────────────────────────────────────────────
 * `client/src/pages/Housing.tsx` carried four home tiers as a module
 * constant, names and square footages and USD price bands, with a "Reserve
 * this home" button under each. `client/src/pages/ReserveHome.tsx` carried a
 * second copy of the same four sizes, worded differently for the same homes.
 * `/housing` is not module-gated, so EVERY village that deploys this platform
 * published those American figures under its own name, to prospective
 * residents, and no admin field anywhere could change one of them. Read live
 * on 2026-09-02 at a Costa Rican village publishing dollars and square feet
 * nobody there chose. This panel is the field that was missing.
 *
 * ── SELF-CONTAINED, AND MOUNTED IN ONE LINE ──────────────────────────────
 * Same reason HousingAdminPanel gives for its own existence: Admin.tsx is a
 * large file other workstreams edit and it carries a hard line ratchet, so
 * the mount is one line. It is a sibling of HousingAdminPanel rather than a
 * section inside it because that file is read as TEXT by
 * client/src/lib/housingForm.test.ts, which asserts on the shape of its
 * hamlet list, and growing a second feature inside it puts those assertions
 * and this feature in each other's way for no gain.
 *
 * ── EVERY BOX IS FREE TEXT, AND SENDS ONLY ITSELF ────────────────────────
 * Nothing here is a number input, and nothing supplies a currency symbol, a
 * unit, a conversion or a rounding. A village writes "0.5 hectares" or "45
 * m2" in size, and "45,000,000 colones" or "80k to 150k" or "ask us" in
 * price, and that is exactly what publishes. A sibling lane spent a day on
 * the mirror of this defect, a page asserting "Total Acres" over a figure a
 * founder meant as hectares.
 *
 * Each control sends the ONE field it owns, built by `homePatch` in
 * @/lib/housingForm where a test can run it, because a control that sends one
 * field cannot revert the four it never mentioned. An emptied box sends null
 * and clears the column, which is how a home is unpublished.
 *
 * ── THE BOXES ARE UNCONTROLLED, ON PURPOSE ───────────────────────────────
 * Same trade as the hamlet rows: a half-typed value survives a refresh that
 * lands mid-edit, at the cost of a value changed elsewhere not appearing in
 * the box until the tab is reopened. The badge and the heading DO update, and
 * no write is made from what a box holds unless a founder edits it, so a
 * stale box cannot become a stale write.
 */

const FIELD_CLASS = "w-full px-3 py-2 border border-stone-200 rounded-lg text-sm";

/**
 * What each box is called, what it is for, and what it must never imply.
 *
 * The hints are deliberately unit-free and currency-free. A placeholder is
 * content: whatever it says is what the next person copies, and half of them
 * will leave it. An "e.g. 1,200 sq ft" hint would put the defect this panel
 * removes back into the panel that removes it, wearing an example's clothes.
 */
const LABELS: Record<HomeField, { label: string; hint: string; long?: boolean }> = {
  name: { label: "What you call it", hint: "the name residents will see" },
  size: { label: "How big", hint: "your own words and your own units" },
  price: { label: "What it costs", hint: "your own words and your own currency" },
  description: { label: "Description", hint: "a sentence or two about this home", long: true },
  features: { label: "Features, one per line", hint: "one per line", long: true },
};

/**
 * The boxes, in the order `HOME_FIELDS` declares them, built from it rather
 * than written out again. A `Record` over `HomeField` will not compile while
 * a field is missing, so a sixth column added to the patch cannot reach the
 * server without a box here to type it into.
 */
const FIELDS = HOME_FIELDS.map((key) => ({ key, ...LABELS[key] }));

/** A key with no name yet still needs a heading a founder can recognise. */
const heading = (row: HomeTypeFounderRow): string => row.name || row.homeType;

export default function HousingTiersPanel({ password }: { password: string }) {
  const [rows, setRows] = useState<HomeTypeFounderRow[]>([]);
  const [phase, setPhase] = useState(INITIAL_PHASE);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  /**
   * Held for a moment after a save so a founder sees that what they typed was
   * written. A save against a warm connection finishes faster than a person
   * can look at it. Cleared on unmount, so it cannot set state on a component
   * that has gone.
   */
  const [saved, setSaved] = useState("");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  /*
   * Both paths spelled out in full, and that is load-bearing rather than a
   * style choice. scripts/check-auth-fetch.mjs resolves a plain string URL
   * and does not resolve a template built from a base-path constant, so a
   * dropped token behind one of those is invisible to the guard. See the same
   * paragraph in HousingAdminPanel.tsx, where it was measured both ways.
   */
  const auth = { Authorization: `Bearer ${password}` };

  const load = async () => {
    setPhase(loadStarted);
    try {
      const res = await fetch("/api/housing/home-types", { headers: auth });
      if (res.ok) setRows((await res.json()).rows ?? []);
    } finally {
      setPhase(loadSettled);
    }
  };

  useEffect(() => {
    void load();
  }, [password]);

  const save = async (homeType: string, patch: HomeTypePatchBody) => {
    setBusy(homeType);
    setError("");
    try {
      const res = await fetch(`/api/housing/home-types/${encodeURIComponent(homeType)}`, {
        method: "PUT",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`${homeType}: ${data?.error || "That did not save."}`);
        return;
      }
      setSaved(homeType);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(""), 2500);
      await load();
    } finally {
      setBusy("");
    }
  };

  /** Build the patch, and stay silent when nothing changed. */
  const edit = (row: HomeTypeFounderRow, field: HomeField, raw: string) => {
    const patch = homePatch(field, raw);
    if (isHomeNoOp(row, patch)) return;
    void save(row.homeType, patch);
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-stone-800">The homes you offer</h2>
        <p className="text-sm text-stone-500 mt-1">
          What you call each home, how big it is and what it costs. Every box is your own
          words: write the units and the currency you use, and the site prints them exactly
          as you typed them. A home appears on the housing page once it has a name and
          either a size or a price. Empty a box to clear it.
        </p>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {showsPlaceholder(phase) ? (
        <p className="text-sm text-stone-500">Loading.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.homeType} className="p-4 border border-stone-200 rounded-xl">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div>
                  <span className="font-medium text-stone-800">{heading(r)}</span>
                  <span className="ml-2 text-xs text-stone-400">{r.homeType}</span>
                </div>
                {/* The server decides what published means, once, in
                    publicHomeTypes, and carries the answer on the row. Read
                    it. The hamlet list beside this one records what
                    re-deriving cost: a founder was shown a green badge on a
                    row every visitor was being told was an example. */}
                <span
                  className={`text-xs px-2 py-1 rounded shrink-0 max-w-full ${r.isPublished ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}
                >
                  {r.isPublished ? "On the housing page" : "Not shown yet"}
                </span>
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                {FIELDS.map((f) => (
                  <label key={f.key} className={`block ${f.long ? "sm:col-span-3" : ""}`}>
                    <span className="block text-xs text-stone-500 mb-1">{f.label}</span>
                    {f.long ? (
                      <textarea
                        defaultValue={homeFieldValue(r, f.key)}
                        onBlur={(e) => edit(r, f.key, e.target.value)}
                        placeholder={f.hint}
                        rows={f.key === "features" ? 4 : 3}
                        className={`${FIELD_CLASS} resize-y`}
                      />
                    ) : (
                      <input
                        defaultValue={homeFieldValue(r, f.key)}
                        onBlur={(e) => edit(r, f.key, e.target.value)}
                        placeholder={f.hint}
                        className={FIELD_CLASS}
                      />
                    )}
                  </label>
                ))}
              </div>
              <div className="mt-2 h-4 text-xs text-stone-500">
                {busy === r.homeType ? <span>Saving.</span> : null}
                {busy !== r.homeType && saved === r.homeType ? <span>Saved.</span> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
