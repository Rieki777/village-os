/**
 * The editor for a village's own written sections, moved out of
 * client/src/pages/Admin.tsx.
 *
 * It moved because Admin.tsx sits at its monolith-ratchet baseline with zero
 * headroom (scripts/check-file-lines.mjs, scripts/file-lines-baseline.json),
 * so the guard's own failure message prescribes this destination for an admin
 * tab. The body is the same code, carried across unchanged.
 *
 * What this component has to get right is in its load() and save(): the body
 * of a failed read is not content, and a section this village has never saved
 * is EMPTY rather than an error. See the comments there.
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, RefreshCw, Save } from "lucide-react";
import { API_BASE, authHeaders, refusal } from "./adminApi";
import { emptyContentFor } from "./contentSections";
import {
  SECTION_FIELDS,
  readGroup,
  readPath,
  writeGroup,
  writePath,
  type DocField,
} from "./contentFields";

export default function ContentEditorTab({ password, sectionKey, sectionLabel }: {
  password: string;
  sectionKey: string;
  sectionLabel: string;
}) {
  const [raw, setRaw] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [parseError, setParseError] = useState("");
  /**
   * The save's own answer, beside the save button.
   *
   * `parseError` renders inside the advanced JSON block, which is collapsed
   * on the card editor, so a refusal reported there is a refusal nobody sees.
   */
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  /**
   * Set when the LOAD could not establish what this section currently holds.
   *
   * It is not the same as "this section is empty", and the difference is the
   * whole point: an empty section is safe to save over, a section whose
   * contents are unknown is not. While this is set, saving is refused.
   */
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`${API_BASE}/content/${sectionKey}`);
      /*
       * THE BODY OF A FAILED RESPONSE IS NOT CONTENT.
       *
       * This read `const data = await res.json()` with no status check, so
       * GET /api/content/:section answering 404 {"error":"Section not found"}
       * (server/index.ts, the expected answer for a section this village has
       * never saved) put that object in the editor as if it were the
       * village's own words. Every founder opening Legal & Jurisdiction
       * Notices or Love Letter Covenant on a fresh instance saw it, because
       * a fresh instance has saved none of them.
       *
       * The damage was not the display. `save()` PUTs whatever is in this
       * box, and the PUT route assigns `content[section] = req.body`
       * unvalidated, so pressing Save Changes wrote {"error":"Section not
       * found"} into the village as REAL content. The section then answered
       * 200 with that object forever after, which is strictly worse than the
       * 404: useVillageContent reads a 404 as `isPlaceholder` and renders a
       * neutral placeholder, and a 200 defeats that fallback. The public
       * Love Letter would have gone on serving a covenant with no opening
       * and no governance paragraph, with no way back through this screen.
       *
       * A never-saved section is EMPTY. That is what the public reader
       * already believes (see client/src/hooks/useVillageContent.ts) and
       * this editor now agrees with it.
       */
      if (res.status === 404) {
        setRaw(JSON.stringify(emptyContentFor(sectionKey), null, 2));
        setLoading(false);
        return;
      }
      if (!res.ok) {
        // Any OTHER failure is genuinely unknown ground. Do not offer an
        // empty document to save over content that may well exist.
        setLoadError(
          `This section could not be read (${res.status}), so what it holds right now is unknown. ` +
          `Saving is blocked until a read succeeds, because saving from here could overwrite real content with a blank.`,
        );
        setRaw("");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setRaw(JSON.stringify(data, null, 2));
    } catch {
      setLoadError(
        "This section could not be read: the request did not reach the server. " +
        "Saving is blocked until a read succeeds.",
      );
      setRaw("");
    }
    setLoading(false);
  }, [sectionKey]);

  // `saveError` clears with the rest: a refusal is about the section that was
  // on screen when it happened, and carrying it onto the next one would make
  // this panel lie in the other direction.
  useEffect(() => { load(); setSaved(false); setSaveError(""); }, [load]);

  const save = async () => {
    setParseError("");
    /*
     * A save is only ever safe on top of a KNOWN current state. If the read
     * failed we do not have one, so this refuses rather than writing a blank
     * over content that may exist. The 404 case is not this case: a 404 is a
     * successful read establishing that the section is empty.
     */
    if (loadError) {
      setSaveError("This section has not been read successfully yet, so there is nothing safe to save over. Press refresh first.");
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e: any) {
      setParseError("Invalid JSON: " + e.message);
      return;
    }
    /*
     * The last line of defence, and it is deliberately narrow: a document
     * whose ONLY key is `error` is an error envelope that reached this box by
     * some route, never a village's own content. It is checked here as well
     * as at load because this box is editable and pasteable, and because the
     * PUT route stores req.body unvalidated: whatever passes here becomes
     * what the public pages serve.
     */
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed);
      if (keys.length === 1 && keys[0] === "error") {
        setSaveError(`This looks like an error message ("${String((parsed as any).error)}"), not content. Saving it would publish it. Clear the box to start this section from scratch.`);
        return;
      }
    }
    // Blank list entries are trimmed HERE, not while typing — see the
    // "one per line" textarea's comment. Typing must never rewrite what
    // you just typed.
    if (Array.isArray(parsed)) {
      for (const card of parsed) {
        if (card && typeof card === "object") {
          for (const [k, v] of Object.entries(card)) {
            if (Array.isArray(v)) card[k] = v.filter((x) => String(x ?? "").trim() !== "");
          }
        }
      }
    }
    setSaving(true);
    setSaveError("");
    /*
     * THE SAVE ASKS. It did not, and the button said "Saved!" whatever came
     * back, which is the one thing an editor must never do.
     *
     * `fetch` resolves on a 403 and on a 500 the same way it resolves on a
     * 200, so the old `catch` only ever caught a dead network. This route is
     * behind `story.tell`, and a village that holds that power answers with a
     * 409 the break-glass turns into a question. An operator who reads that
     * question and chooses "Leave it" gets the 409 back, so a save that skips
     * the status check prints "Saved!" over a change the operator just
     * declined to make.
     */
    try {
      const res = await fetch(`${API_BASE}/admin/content/${sectionKey}`, {
        method: "PUT",
        headers: authHeaders(password, { "Content-Type": "application/json" }),
        body: JSON.stringify(parsed),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        const body = await res.json().catch(() => null);
        setSaveError(refusal(body, `The server refused this save (${res.status}). The live page is unchanged.`));
      }
    } catch {
      setSaveError("This save did not reach the server. The live page is unchanged.");
    }
    setSaving(false);
  };

  // Team gets a card editor: plain fields, the raw JSON demoted to "advanced".
  // Editing mutates the PARSED array in place and re-serializes, so keys the
  // form doesn't know about survive untouched — the JSON stays the ground
  // truth. These cards feed the public /team page directly.
  const isCards = sectionKey === "team";
  const cardsData: any[] | null = isCards && raw ? (() => {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : null; } catch { return null; }
  })() : null;
  const mutateCards = (fn: (arr: any[]) => void) => {
    const arr = JSON.parse(raw);
    fn(arr);
    setRaw(JSON.stringify(arr, null, 2));
  };

  /*
   * The field editor for the sections that are documents rather than cards.
   *
   * Same architecture as the cards above and for the same reason: it parses
   * the raw JSON, edits the PARSED document and re-serializes, so a key no
   * spec describes survives an edit untouched and the JSON below stays the
   * ground truth. A field editor that rebuilt the document from its own spec
   * would silently drop whatever it had not been taught about.
   *
   * `spec` is null for a section with no field spec, which falls through to
   * the raw editor exactly as before.
   */
  const spec = SECTION_FIELDS[sectionKey] ?? null;
  const docData: any = spec && raw ? (() => {
    try { const p = JSON.parse(raw); return p && typeof p === "object" && !Array.isArray(p) ? p : null; } catch { return null; }
  })() : null;
  const setDocField = (path: string[], value: string) =>
    setRaw(JSON.stringify(writePath(JSON.parse(raw), path, value), null, 2));
  const setDocGroup = (path: string[], rows: any[]) =>
    setRaw(JSON.stringify(writeGroup(JSON.parse(raw), path, rows), null, 2));

  /*
   * `htmlFor` and a matching id, which the card editor above still lacks.
   * A label that is only next to its box is a label a screen reader does
   * not read out with it, and it is also what makes clicking the words
   * focus the box. The id carries a prefix because a repeat group's rows
   * all share the same field paths.
   */
  const fieldControl = (f: DocField, value: string, onChange: (v: string) => void, idPrefix = "content") => {
    const id = `${idPrefix}-${f.path.join("-")}`;
    return (
    <div key={f.path.join(".")} className={f.kind === "long" ? "sm:col-span-2" : ""}>
      <label htmlFor={id} className="text-xs font-medium text-foreground block mb-1">
        {f.label}
        {f.claim && (
          <span className="ml-2 text-[11px] font-normal rounded px-1.5 py-0.5 border border-amber-300 bg-amber-50 text-amber-800">
            a claim about your jurisdiction
          </span>
        )}
      </label>
      {f.kind === "long" ? (
        <textarea
          id={id}
          rows={f.rows ?? 3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep/40 resize-y"
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep/40"
        />
      )}
      <p className="text-[11px] text-muted-foreground mt-0.5">{f.help}</p>
    </div>
    );
  };
  // field spec: [key, label, kind, options?]
  const CARD_FIELDS: Array<[string, string, "text" | "long" | "lines" | "select", string[]?]> = [
    ["name", "Name", "text"],
    ["role", "Role title", "text"],
    ["circle", "Circle (shown under the title)", "text"],
    ["photo", "Photo URL", "text"],
    ["bio", "Bio", "long"],
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Edit: {sectionLabel}</h2>
          <p className="text-sm text-gray-500 mt-1">
            Changes save to the server and go live immediately.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={load}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium hover:bg-teal-deep/90 disabled:opacity-50 transition-colors"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving..." : saved ? "Saved!" : "Save Changes"}
          </button>
        </div>
      </div>

      {loadError && (
        <p role="alert" className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {loadError}
        </p>
      )}

      {saveError && (
        <p role="alert" className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {saveError}
        </p>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : (
        <>
          {/*
            A SYNTAX ERROR IN THE BOX BELOW USED TO DELETE THIS SECTION FROM
            THE PAGE. `docData` is null whenever the raw JSON does not parse,
            and the field editor is gated on it, so backspacing over one brace
            in the advanced box made the intro, every labelled field and the
            whole repeat group vanish in a single frame with nothing said.
            `parseError` exists for this and is only ever set by save(), so it
            was blank at the moment it was needed.
          */}
          {spec && !docData && raw.trim() !== "" && (
            <p role="alert" className="mb-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              The JSON below has a syntax error, so the fields are hidden until it parses again.
              Nothing is lost: fix the JSON, or press refresh to reload what the server holds.
            </p>
          )}

          {/* Field editor for document sections. No JSON in sight. */}
          {spec && docData && (
            <div className="mb-6 space-y-5">
              <p className="text-sm text-muted-foreground max-w-2xl">{spec.intro}</p>

              <div className="grid sm:grid-cols-2 gap-4">
                {spec.fields.map((f) =>
                  fieldControl(f, readPath(docData, f.path), (v) => setDocField(f.path, v)),
                )}
              </div>

              {(spec.groups ?? []).map((g) => {
                const rows = readGroup(docData, g.path);
                const write = (next: any[]) => setDocGroup(g.path, next);
                return (
                  <div key={g.path.join(".")}>
                    <p className="text-xs font-medium text-foreground">{g.label}</p>
                    <p className="text-[11px] text-muted-foreground mb-2 max-w-2xl">{g.help}</p>
                    <div className="space-y-3">
                      {rows.map((row: any, i: number) => (
                        <div key={i} className="border border-gray-200 rounded-xl p-4 bg-gray-50">
                          <div className="flex items-center justify-between mb-2">
                            <p className="font-semibold text-foreground text-sm">
                              {String(row?.[g.titlePath[0]] ?? "").trim() || `#${i + 1}`}
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                title="Move up"
                                disabled={i === 0}
                                onClick={() => { const n = [...rows]; const [c] = n.splice(i, 1); n.splice(i - 1, 0, c); write(n); }}
                                className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                              >
                                <ArrowUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Move down"
                                disabled={i === rows.length - 1}
                                onClick={() => { const n = [...rows]; const [c] = n.splice(i, 1); n.splice(i + 1, 0, c); write(n); }}
                                className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                              >
                                <ArrowDown className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const name = String(row?.[g.titlePath[0]] ?? "").trim() || "this one";
                                  if (window.confirm(`Remove "${name}"?`)) write(rows.filter((_, j) => j !== i));
                                }}
                                className="text-xs text-muted-foreground hover:text-red-600"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                          <div className="grid sm:grid-cols-2 gap-3">
                            {g.fields.map((f) =>
                              fieldControl(f, String(row?.[f.path[0]] ?? ""), (v) => {
                                const n = rows.map((r, j) => (j === i ? { ...r, [f.path[0]]: v } : r));
                                write(n);
                              }, `${g.path.join("-")}-${i}`),
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => write([...rows, Object.fromEntries(g.fields.map((f) => [f.path[0], ""]))])}
                      className="mt-2 text-sm text-teal-deep font-medium hover:underline"
                    >
                      + {g.addLabel}
                    </button>
                  </div>
                );
              })}

              <p className="text-xs text-muted-foreground">
                Remember to hit Save Changes above. Edits here go live only after saving.
              </p>
            </div>
          )}

          {/* Card editor — plain fields, no JSON in sight */}
          {isCards && cardsData && (
            <div className="mb-6 space-y-4">
              {cardsData.map((card: any, idx: number) => (
                <div key={idx} className="border border-gray-200 rounded-xl p-5 bg-gray-50">
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-semibold text-gray-800 text-sm">{card.name || `#${idx + 1}`}</p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => mutateCards((a) => { if (idx > 0) { const [c] = a.splice(idx, 1); a.splice(idx - 1, 0, c); } })}
                        disabled={idx === 0}
                        title="Move up"
                        className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => mutateCards((a) => { if (idx < a.length - 1) { const [c] = a.splice(idx, 1); a.splice(idx + 1, 0, c); } })}
                        disabled={idx === cardsData.length - 1}
                        title="Move down"
                        className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => { if (window.confirm(`Remove "${card.name || "this entry"}"?`)) mutateCards((a) => a.splice(idx, 1)); }}
                        className="text-xs text-gray-400 hover:text-red-600"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {CARD_FIELDS.map(([key, label, kind, options]) => (
                      <div key={key} className={kind === "text" ? "" : "sm:col-span-2"}>
                        <label className="text-xs font-medium text-gray-500 block mb-1">{label}</label>
                        {kind === "lines" ? (
                          <textarea
                            rows={Math.max(3, (Array.isArray(card[key]) ? card[key].length : 3))}
                            value={Array.isArray(card[key]) ? card[key].join("\n") : String(card[key] ?? "")}
                            // NO .filter(Boolean): dropping empty lines means
                            // the moment you press Enter to start a new item,
                            // the trailing blank vanishes, the value
                            // re-serializes identically, and the cursor jumps
                            // to the end — you can never actually add a line.
                            // Blanks are trimmed once, on save, not on keypress.
                            onChange={(e) => mutateCards((a) => { a[idx][key] = e.target.value.split("\n"); })}
                            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep/40 resize-none"
                          />
                        ) : kind === "select" ? (
                          <select
                            value={String(card[key] ?? (options?.[0] ?? ""))}
                            onChange={(e) => mutateCards((a) => { a[idx][key] = e.target.value; })}
                            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep/40 bg-white"
                          >
                            {(options ?? []).map((o) => (
                              <option key={o} value={o}>
                                {o === "open" ? "Open Seat" : o === "filled" ? "Filled" : o === "partial" ? "Partially Filled" : o === "forming" ? "Forming" : o}
                              </option>
                            ))}
                          </select>
                        ) : kind === "long" ? (
                          <textarea
                            rows={2}
                            value={String(card[key] ?? "")}
                            onChange={(e) => mutateCards((a) => { a[idx][key] = e.target.value; })}
                            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep/40 resize-none"
                          />
                        ) : (
                          <input
                            type="text"
                            value={String(card[key] ?? "")}
                            onChange={(e) => mutateCards((a) => { a[idx][key] = e.target.value; })}
                            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-deep/40"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <button
                onClick={() => mutateCards((a) => a.push(
                  { name: "New team member", role: "", circle: "", photo: "", bio: "" },
                ))}
                className="text-sm text-teal-deep font-medium hover:underline"
              >
                + Add a team member
              </button>
              <p className="text-xs text-gray-400">
                Remember to hit Save Changes above. Edits here go live only after saving.
              </p>
            </div>
          )}

          {/* Raw JSON editor, always shown, acts as ground truth */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="content-raw-json" className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                {isCards || spec ? "Raw JSON (advanced edits)" : "Edit JSON"}
              </label>
              {parseError && (
                <span role="alert" className="text-xs text-red-500">{parseError}</span>
              )}
            </div>
            <textarea
              id="content-raw-json"
              value={raw}
              onChange={(e) => { setRaw(e.target.value); setParseError(""); }}
              rows={isCards || spec ? 12 : 28}
              spellCheck={false}
              className="w-full px-4 py-3 text-xs font-mono border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-deep/40 bg-gray-900 text-green-300 resize-none"
            />
          </div>
        </>
      )}
    </div>
  );
}
