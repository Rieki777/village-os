import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { announceThemeChange } from "@/lib/liveTheme";
import { Image } from "@/components/Image";
import { prepareImageForUpload } from "@/lib/imagePrep";

/**
 * Admin → Make This Yours → Identity pack: the village's visual identity as
 * DATA, a description of what they are and aren't, plus reference files, so
 * that when the design agency lands, generation has something to be
 * consistent WITH beyond the three Look decisions.
 *
 * The rights acknowledgment gates the SAVE, not just the UI, by the same
 * reasoning as the font licence: a logo from a designer often isn't the
 * village's to feed a model (Rye, 2026-08-01: villages hold rights to their
 * images, and regenerate base art only with their own API key). Recording
 * who confirmed, and when, is what makes that policy real later.
 *
 * ── REFERENCE FILES, NOT REFERENCE IMAGES ─────────────────────────────────
 *
 * Rye, 2026-09-02: "The identity pack should be able to handle all sorts of
 * file types. In this case I'm trying to upload an HTML that shows the whole
 * style guide." A designer hands over a style guide as a web page far more
 * often than as a picture of one, so the door takes HTML, CSS, SVG, PDF and
 * markdown alongside photographs. The label moved with the capability: a
 * control called "Reference images" that accepts an HTML file is a control
 * that lies about itself, and the rights line under it was making the same
 * claim about the same files.
 *
 * ── THE PICKER IS A BUTTON ────────────────────────────────────────────────
 *
 * Rye, same day: "this 'choose file' needs to be a much more obvious button!
 * The 'add reference' shouldn't appear until I choose a file." This was a
 * bare `<input type="file">`, which every browser draws differently and every
 * phone draws small, sitting next to an Add reference button that was live
 * before there was anything to add. So the input is `sr-only` behind a
 * styled label (still focusable, still announced, so the keyboard and the
 * screen reader lose nothing), the chosen filename is shown once there is
 * one, and Add reference exists only when pressing it would do something.
 */

/** The file kinds the brand door stores. Mirrors server/routes/brandUploads.ts. */
const ACCEPT =
  "image/jpeg,image/png,image/webp,image/avif,image/gif,image/svg+xml,text/html,text/css," +
  "application/pdf,text/plain,text/markdown,.jpg,.jpeg,.png,.webp,.avif,.gif,.svg,.html,.htm,.css,.pdf,.txt,.md,.markdown";

type Reference = {
  url: string;
  thumbUrl?: string | null;
  /** The uploader's own filename, so a later reader can tell a style guide from a swatch. */
  name?: string;
  mimeType?: string;
  kind?: "image" | "file";
};

/**
 * True when this reference is a picture the grid can render.
 *
 * A reference saved before the door widened carries no `kind` at all, and
 * every one of those IS a picture, because nothing else could get in. So a
 * missing `kind` reads as an image rather than as an unknown.
 */
const isPicture = (r: Reference) => (r.kind ?? "image") === "image";

/** The bit after the last dot, upper-cased, for the tile a non-picture gets. */
function extLabel(r: Reference): string {
  const from = r.name || r.url || "";
  const dot = from.lastIndexOf(".");
  const ext = dot > -1 ? from.slice(dot + 1) : "";
  return (ext || "file").slice(0, 8).toUpperCase();
}

/**
 * One reference in the grid.
 *
 * Declared HERE, at module scope, and never inside IdentityPackPanel. A
 * component declared inside another component is a new type on every render,
 * so React unmounts and remounts the whole subtree on each keystroke: this
 * repo has already paid for that once in SetupWizard, in lost focus on a
 * phone and 45 extra network requests per five keystrokes.
 */
function ReferenceTile({ reference, onRemove }: { reference: Reference; onRemove: () => void }) {
  return (
    <div className="relative">
      {isPicture(reference) ? (
        <Image src={reference.thumbUrl || reference.url} alt="" ratio={1} className="rounded-lg" />
      ) : (
        <a
          href={reference.url}
          className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-2 text-center"
        >
          <span className="text-xs font-semibold text-teal-deep">{extLabel(reference)}</span>
          <span className="line-clamp-2 break-all text-[10px] text-muted-foreground">
            {reference.name || "Reference file"}
          </span>
        </a>
      )}
      <button
        type="button"
        aria-label="Remove reference"
        onClick={onRemove}
        className="absolute top-1 right-1 bg-white/90 rounded-full w-5 h-5 text-xs leading-5 text-gray-600"
      >
        ×
      </button>
    </div>
  );
}

export default function IdentityPackPanel({ password }: { password: string }) {
  const [pack, setPack] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [rights, setRights] = useState(false);
  /** The file the picker holds. Held in state, because the button that acts on it only exists once it does. */
  const [chosen, setChosen] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/brand", { headers: { Authorization: `Bearer ${password}` } });
      const data = await res.json();
      setPack(data.brand?.identityPack ?? { description: "", never: "", references: [] });
    } catch { toast.error("Could not load the identity pack"); }
  }, [password]);
  useEffect(() => { load(); }, [load]);

  const clearChoice = () => {
    setChosen(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const save = async () => {
    if ((pack.references?.length ?? 0) > 0 && !pack.rightsAck && !rights) {
      return toast.error("Please confirm your project holds rights to the reference files first");
    }
    setSaving(true);
    try {
      const next = {
        ...pack,
        // Stamped once, kept thereafter. The record outlives the checkbox.
        rightsAck: pack.rightsAck ?? (rights ? { at: new Date().toISOString() } : undefined),
      };
      const res = await fetch("/api/admin/brand", {
        method: "PUT",
        headers: { Authorization: `Bearer ${password}`, "Content-Type": "application/json" },
        body: JSON.stringify({ identityPack: next }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setPack(data.brand?.identityPack ?? next);
      announceThemeChange();
      toast.success("Identity pack saved");
    } catch { toast.error("Save failed"); }
    setSaving(false);
  };

  const upload = async () => {
    const file = chosen;
    if (!file) return toast.error("Choose a file first");
    setUploading(true);
    try {
      // Shrink before the wire, not after. The server re-encodes photographs
      // to WebP at 2000px anyway, so matching that here costs nothing in
      // quality and turns an 8 MB phone photo into a few hundred KB of
      // upload. On a 50 KB/s link that is minutes. Anything that is not a
      // raster picture, a style guide included, comes back from this helper
      // untouched under its own `not-an-image` and `svg` rules, so the call
      // stays unconditional and there is no second place to keep in step.
      const prepared = await prepareImageForUpload(file, { maxEdge: 2000, quality: 82 });
      const form = new FormData();
      form.append("file", prepared.file);
      const res = await fetch("/api/admin/brand/image", {
        method: "POST",
        headers: { Authorization: `Bearer ${password}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Upload failed");
      // The filename and the mime type are stored beside the address so that
      // whatever reads this pack later can find the style guide among the
      // photographs. The stamped name on the volume says nothing about either.
      const reference: Reference = {
        url: data.url,
        thumbUrl: data.thumbUrl ?? null,
        name: data.originalName || file.name,
        mimeType: data.mimeType ?? file.type ?? "",
        kind: data.kind === "file" ? "file" : "image",
      };
      setPack({ ...pack, references: [...(pack.references ?? []), reference] });
      clearChoice();
      toast.success("Reference added. Remember to save");
    } catch (e: any) { toast.error(e.message || "Upload failed"); }
    setUploading(false);
  };

  if (!pack) return null;
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-6 mt-6">
      <h3 className="font-semibold text-gray-900 mb-1">Identity pack</h3>
      <p className="text-xs text-gray-500 mb-4">
        What your village looks and feels like, for the design agency to stay true to. Base art is
        generated once by the foundation; you regenerate it only with your own image API key.
      </p>
      <label className="block text-sm font-medium text-gray-900 mb-1">Who you are, visually</label>
      <textarea value={pack.description ?? ""} onChange={(e) => setPack({ ...pack, description: e.target.value.slice(0, 2000) })}
        rows={3} placeholder="e.g. hand-built timber and lime plaster, tropical understory, morning mist…"
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mb-3" />
      <label className="block text-sm font-medium text-gray-900 mb-1">What you are NOT (never show)</label>
      <textarea value={pack.never ?? ""} onChange={(e) => setPack({ ...pack, never: e.target.value.slice(0, 1000) })}
        rows={2} placeholder="e.g. no glass towers, no manicured lawns, no stock-photo smiles…"
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mb-4" />

      {/*
        A section heading, styled like its two siblings above and carrying no
        `htmlFor`. Pointing it at the picker as well would give that input two
        labels, and the accessible name a screen reader reads out would then
        depend on which one the browser picked. The Choose file label below is
        the input's one name.
      */}
      <label className="block text-sm font-medium text-gray-900 mb-1">Reference files</label>
      <p className="text-xs text-muted-foreground mb-1.5">
        Photographs, a logo, a colour swatch, or a whole style guide as HTML, CSS, SVG, PDF or markdown. Up to 25 MB each.
      </p>
      {(pack.references?.length ?? 0) > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-2">
          {pack.references.map((r: Reference, i: number) => (
            <ReferenceTile
              key={r.url}
              reference={r}
              onRemove={() => setPack({ ...pack, references: pack.references.filter((_: Reference, j: number) => j !== i) })}
            />
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {/*
          `sr-only` keeps the input in the tab order with its accessible name
          intact, so a keyboard opens the picker with Space on it and a screen
          reader still says what it is. `hidden` would take both away. `peer`
          carries that focus out to the label, which is the only part anyone
          can see.
        */}
        <input
          ref={fileRef}
          id="identity-pack-file"
          type="file"
          accept={ACCEPT}
          onChange={(e) => setChosen(e.target.files?.[0] ?? null)}
          className="peer sr-only"
        />
        <label
          htmlFor="identity-pack-file"
          className="cursor-pointer px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium hover:bg-teal-deep-dark peer-focus-visible:ring-2 peer-focus-visible:ring-teal-deep peer-focus-visible:ring-offset-2"
        >
          {chosen ? "Choose a different file" : "Choose file"}
        </label>
        {chosen && (
          <>
            <span className="text-xs text-muted-foreground break-all max-w-full">{chosen.name}</span>
            <button onClick={upload} disabled={uploading}
              className="px-3 py-1.5 bg-white border border-gray-200 text-teal-deep rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
              {uploading ? "Uploading…" : "Add reference"}
            </button>
          </>
        )}
      </div>
      {!pack.rightsAck && (
        <label className="flex items-start gap-2 text-xs text-gray-600 mb-3">
          <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5" />
          <span>Our project holds the rights to these reference files (a designer's logo, a
          photographer's photo or a style guide someone else wrote is often not yours to reuse, so
          check before you feed it forward).</span>
        </label>
      )}
      {pack.rightsAck?.at && (
        <p className="text-xs text-gray-400 mb-3">Rights confirmed {String(pack.rightsAck.at).slice(0, 10)}.</p>
      )}
      <button onClick={save} disabled={saving}
        className="px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium disabled:opacity-50">
        {saving ? "Saving…" : "Save identity pack"}
      </button>
    </div>
  );
}
