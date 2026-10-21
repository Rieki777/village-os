import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FONT_CATALOG, offeringsFor, type FontRole } from "@shared/fontCatalog";

/**
 * Admin → Make This Yours → Typography.
 *
 * Two doors, honestly labelled:
 *
 *  1. THE CATALOGUE — every offering is OFL and self-hosted (bundled woff2,
 *     shared/fontCatalog.ts), so choosing one is always legally safe and
 *     always fast. Each option previews in its own face: a font picker whose
 *     names render in the default font is asking for a decision blind.
 *
 *  2. THE UPLOAD — for a village whose identity needs its own face. Behind a
 *     licence acknowledgment that gates the SERVER, not just this checkbox:
 *     "free to download" almost never includes web embedding, and the
 *     platform's own first heading font arrived from a free-fonts aggregator
 *     with no licence at all. The village that chooses a font carries its
 *     licence — the ack records who accepted that, and when.
 *
 * Self-contained on purpose: SetupWizard is a large component in a file
 * another workstream edits; this panel loads and saves the brand document
 * itself so the mount is one import and one JSX line.
 */

const ROLE_LABELS: Record<FontRole, { title: string; hint: string }> = {
  display: { title: "Headings", hint: "The village's voice at full volume." },
  body: { title: "Body text", hint: "Paragraphs, forms, the long middle of every page." },
  accent: { title: "Accent", hint: "Handwritten moments: quotes, celebrations." },
};

const ROLE_FIELDS: Record<FontRole, "fontDisplay" | "fontBody" | "fontAccent"> = {
  display: "fontDisplay",
  body: "fontBody",
  accent: "fontAccent",
};

interface ThemeFields {
  fontDisplay?: string;
  fontBody?: string;
  fontAccent?: string;
  fontFaceName?: string;
  fontFaceUrl?: string;
  fontLicenceAck?: { family: string; by: string; at: string };
}

export default function TypographyPanel({ password }: { password: string }) {
  const [theme, setTheme] = useState<ThemeFields | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [family, setFamily] = useState("");
  const [ack, setAck] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/brand", { headers: { Authorization: `Bearer ${password}` } });
      const data = await res.json();
      setTheme(data.brand?.theme ?? {});
    } catch {
      toast.error("Could not load typography");
    }
  }, [password]);

  useEffect(() => { load(); }, [load]);

  // SENDS ONLY ITS OWN THREE FIELDS. The server merges `theme` key by key, and
  // this panel loads the whole theme once, when the page opens. Posting that
  // whole copy back wrote every field it held at load time over whatever the
  // Look panel beside it had saved since, so a founder who saved their colour
  // and then their fonts lost the colour without a word (found in production, 2026-10-14).
  // The Look panel already sends only its own fields; this one now does too.
  const save = async (next: ThemeFields) => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/brand", {
        method: "PUT",
        headers: { Authorization: `Bearer ${password}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          theme: { fontDisplay: next.fontDisplay ?? "", fontBody: next.fontBody ?? "", fontAccent: next.fontAccent ?? "" },
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setTheme(data.brand?.theme ?? next);
      toast.success("Typography saved. The site re-typesets on next load");
    } catch {
      toast.error("Save failed");
    }
    setSaving(false);
  };

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return toast.error("Choose a font file first (.woff2 is best)");
    if (!family.trim()) return toast.error("Name the font, using the family name from its licence");
    if (!ack) return toast.error("Please confirm the web-embedding licence first");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("family", family.trim());
      form.append("licenceAck", "true");
      const res = await fetch("/api/admin/brand/font", {
        method: "POST",
        headers: { Authorization: `Bearer ${password}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Upload failed");
      toast.success(`"${data.family}" uploaded and set as the heading face`);
      setFamily("");
      setAck(false);
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (e: any) {
      toast.error(e.message || "Upload failed");
    }
    setUploading(false);
  };

  if (!theme) return null;

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-6 mt-6">
      <h3 className="font-semibold text-gray-900 mb-1">Typography</h3>
      <p className="text-xs text-gray-500 mb-4">
        Every catalogue font is self-hosted and licensed for the web (SIL Open Font License), so
        choosing one is always safe. Changes apply live, no deploy.
      </p>

      <div className="grid md:grid-cols-3 gap-4 mb-6">
        {(Object.keys(ROLE_LABELS) as FontRole[]).map((role) => {
          const field = ROLE_FIELDS[role];
          const current = theme[field] || "";
          const options = offeringsFor(role);
          const matched = options.find((o) => o.stack === current);
          return (
            <div key={role}>
              <label className="block text-sm font-medium text-gray-900">{ROLE_LABELS[role].title}</label>
              <p className="text-xs text-gray-400 mb-1.5">{ROLE_LABELS[role].hint}</p>
              <select
                value={matched?.id ?? (current ? "__custom" : "__default")}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "__default") setTheme({ ...theme, [field]: "" });
                  else {
                    const chosen = options.find((o) => o.id === v);
                    if (chosen) setTheme({ ...theme, [field]: chosen.stack });
                  }
                }}
                className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 bg-white"
              >
                <option value="__default">Platform default</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>{o.family} · {o.hint}</option>
                ))}
                {/* An uploaded face or hand-edited stack that matches no offering. */}
                {current && !matched && <option value="__custom">Custom: {current.slice(0, 40)}</option>}
              </select>
              {/* Preview in the actual face — the fonts are bundled, so this renders truthfully. */}
              <p
                className="mt-1.5 text-base text-gray-700 truncate"
                style={{ fontFamily: current || undefined }}
                aria-hidden="true"
              >
                A village worth co-creating
              </p>
            </div>
          );
        })}
      </div>

      <button
        onClick={() => save(theme)}
        disabled={saving}
        className="px-4 py-2 bg-teal-deep text-white rounded-lg text-sm font-medium disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save typography"}
      </button>

      <div className="border-t border-gray-100 mt-6 pt-5">
        <h4 className="text-sm font-medium text-gray-900 mb-1">Bring your own font</h4>
        <p className="text-xs text-gray-500 mb-3">
          For a face that isn't in the catalogue. Upload the font file itself (.woff2 is smallest and best;
          .woff, .ttf and .otf also work). It's stored with your deployment and set as the heading face.
        </p>
        {theme.fontFaceName && theme.fontFaceUrl && (
          <p className="text-xs text-gray-600 mb-3 bg-gray-50 rounded-lg px-3 py-2">
            Active custom face: <span className="font-medium">{theme.fontFaceName}</span>
            {theme.fontLicenceAck && (
              <span className="text-gray-400"> · licence confirmed by {theme.fontLicenceAck.by} on {theme.fontLicenceAck.at.slice(0, 10)}</span>
            )}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <input
            value={family}
            onChange={(e) => setFamily(e.target.value)}
            placeholder='Font name, e.g. "Serenity"'
            className="text-sm border border-gray-200 rounded-lg px-2.5 py-2 w-48"
          />
          <input ref={fileRef} type="file" accept=".woff2,.woff,.ttf,.otf" className="text-xs text-gray-600" />
          <button
            onClick={upload}
            disabled={uploading}
            className="px-3 py-2 bg-white border border-gray-200 text-teal-deep rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "Upload & activate"}
          </button>
        </div>
        <label className="flex items-start gap-2 text-xs text-gray-600">
          {/* The confirmation is the name. What counts as a web licence is a
              description: useful, and too long to hear before every tick. */}
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5"
            aria-label="I confirm this project holds a licence to embed this font on the web."
            aria-describedby="font-licence-hint" />
          <span>
            I confirm this project holds a licence to embed this font on the web. <span id="font-licence-hint" className="text-gray-400">
            ("Free to download" usually covers desktop use only. Web embedding is a separate right.
            Fonts from Google Fonts / Fontsource are OFL and always fine.)</span>
          </span>
        </label>
      </div>
    </div>
  );
}
