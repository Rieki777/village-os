/**
 * Your own face for a class: upload one, or forge one, and decide who sees it.
 *
 * ── THE CROP IS NOT IMPLEMENTED HERE, AND THAT IS DELIBERATE ────────────
 *
 * The stored picture is exactly 3:4 because `server/lib/characterPortraits.ts`
 * crops it with sharp on the way in. This file writes NO crop of its own. The
 * preview below is an `aspect-[3/4]` box with `object-cover object-top`, which
 * is the browser doing visually what sharp does to the bytes, from the same two
 * rules. So a member sees the real result before they send, and there is still
 * only one implementation of the crop for the two to drift apart from.
 *
 * The file itself is shrunk by `client/src/lib/imagePrep.ts`, the helper that
 * already exists for this, and no second one is written here. It preserves
 * aspect, so the server is still the only thing that decides shape. 1600 is
 * chosen so the short edge of an ordinary phone photo stays above the 900 the
 * crop needs and nothing is scaled up afterwards.
 *
 * ── WHY THE COUNTDOWN LOOKS LIKE THIS ───────────────────────────────────
 *
 * Rye asked for the remaining grants to be clear in a nice way. So they are
 * drawn as filled tokens and never as a bare number, and only the ones the
 * member HAS are drawn: a row of six slots with three filled reads as a quota
 * half spent, and three filled tokens on their own read as three gifts held.
 *
 * At zero there is no disabled button. The forge control is replaced by a
 * sentence saying when the next gift arrives and how many days that is, and the
 * upload and stock-art options stay exactly where they were, because both still
 * work and neither costs anything.
 */
import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Sparkles, Trash2, Upload } from "lucide-react";
import { prepareImageForUpload } from "@/lib/imagePrep";
import {
  BUDGET_TOKEN_SLOTS,
  grantsHeldSentence,
  nextGrantSentence,
  type ForgeBudget,
  type PortraitSource,
} from "@shared/characterPortraits";
import type { VillageMoon } from "@shared/villageMoon";

/** One row of `character_portraits`, as the studio payload carries it. */
export interface StudioPortrait {
  archetypeKey: string;
  url: string | null;
  candidateUrl: string | null;
  source: PortraitSource;
  publishedAt: string | null;
}

export interface StudioPayload {
  portraits: StudioPortrait[];
  budget: ForgeBudget;
  moon: VillageMoon;
  forgeAvailable: boolean;
}

/**
 * What each source is called on screen.
 *
 * Keyed by the union and not by `string`, so a third source added in
 * `shared/characterPortraits.ts` is a compile error here instead of an empty
 * span on somebody's card. `scripts/check-mirror-annotations.mjs` asks for
 * exactly this shape.
 */
const SOURCE_LABEL: Record<PortraitSource, string> = {
  forged: "Forged in the village",
  uploaded: "Your own picture",
};

/** The longest edge sent to the server. See the note at the top of this file. */
const UPLOAD_MAX_EDGE = 1600;

interface Props {
  archetypeKey: string;
  archetypeName: string;
  /**
   * The look selected on the stage. Forwarded to the forge so a generated
   * portrait honours the presentation and tone the member actually chose,
   * instead of the route's defaults. Nothing reads these on the upload path:
   * an uploaded picture is already a picture of somebody.
   */
  presentation: string;
  tone: string;
  /** The stock art for the look currently selected, shown when there is no portrait. */
  stockArt: string;
  studio: StudioPayload | null;
  onChanged: (next: StudioPayload) => void;
  authHeaders: () => Record<string, string>;
}

export default function PortraitStudio({
  archetypeKey,
  archetypeName,
  presentation,
  tone,
  stockArt,
  studio,
  onChanged,
  authHeaders,
}: Props) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const mine = studio?.portraits?.find((p) => p.archetypeKey === archetypeKey) ?? null;
  const budget = studio?.budget ?? null;
  const held = budget?.total ?? 0;

  // An object URL is a live handle on the chosen file and leaks until it is
  // revoked. Revoked when it is replaced and when the panel goes.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => { setConfirming(false); setError(""); setNotice(""); }, [archetypeKey]);

  /**
   * Every write goes through here, and the panel only says a change landed
   * after the Response has been read. `scripts/check-save-honesty.mjs` asks for
   * that, and the reason is plainer than the guard: a control that reports
   * success on the click has told the member something nobody checked.
   */
  const send = async (path: string, init: RequestInit, label: string): Promise<StudioPayload | null> => {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      const res = await fetch(path, init);
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        setError(String(body?.message ?? body?.error ?? "That did not save. Try again."));
        // A refusal still carries the current studio, so the tokens correct
        // themselves even when the action failed.
        if (body?.budget) onChanged(body as StudioPayload);
        return null;
      }
      onChanged(body as StudioPayload);
      return body as StudioPayload;
    } catch {
      setError("That did not reach the village. Try again.");
      return null;
    } finally {
      setBusy("");
    }
  };

  const chooseFile = (file: File | null | undefined) => {
    if (!file) return;
    setError("");
    setNotice("");
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
  };

  const upload = async () => {
    const file = fileInput.current?.files?.[0];
    if (!file) return;
    setBusy("upload");
    setError("");
    // Shrunk in the browser first. The helper hands the original back whenever
    // it cannot do better, so this never makes an upload worse.
    const prepared = await prepareImageForUpload(file, { maxEdge: UPLOAD_MAX_EDGE });
    const form = new FormData();
    form.append("portrait", prepared.file, prepared.file.name);
    const headers = authHeaders();
    delete headers["Content-Type"]; // the browser writes the multipart boundary
    const done = await send(
      `/api/me/portraits/${encodeURIComponent(archetypeKey)}/upload`,
      { method: "POST", headers, body: form },
      "upload",
    );
    if (done) {
      setNotice("Saved. Only you can see it until you show it on your profile.");
      if (preview) URL.revokeObjectURL(preview);
      setPreview(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const forge = async () => {
    setConfirming(false);
    await send(
      `/api/me/portraits/${encodeURIComponent(archetypeKey)}/forge`,
      { method: "POST", headers: authHeaders(), body: JSON.stringify({ presentation, tone }) },
      "forge",
    );
  };

  /** Keep or discard the candidate. Neither carries a body the route reads. */
  const decide = (verb: "keep" | "discard") =>
    send(
      `/api/me/portraits/${encodeURIComponent(archetypeKey)}/${verb}`,
      { method: "POST", headers: authHeaders(), body: JSON.stringify({}) },
      verb,
    );

  /** One function for both directions, so the two can never disagree. */
  const setPublished = (published: boolean) =>
    send(
      `/api/me/portraits/${encodeURIComponent(archetypeKey)}/publish`,
      { method: "POST", headers: authHeaders(), body: JSON.stringify({ published }) },
      "publish",
    );

  const remove = () =>
    send(
      `/api/me/portraits/${encodeURIComponent(archetypeKey)}`,
      { method: "DELETE", headers: authHeaders() },
      "remove",
    );

  const shown = preview ?? mine?.url ?? stockArt;
  const published = !!mine?.publishedAt;

  return (
    <section className="mt-6 rounded-2xl bg-white p-5 shadow-lg">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-teal-deep">
        Your own face for {archetypeName}
      </h3>

      <div className="mt-4 flex flex-wrap gap-5">
        {/* The preview. `object-cover object-top` is the same crop the server
            applies to the bytes, so this box shows the real result. */}
        <div className="w-32 shrink-0 overflow-hidden rounded-xl border-2 border-sage/30 bg-sage-light">
          <div className="aspect-[3/4] w-full">
            <img src={shown} alt="" className="h-full w-full object-cover object-top" />
          </div>
        </div>

        <div className="min-w-[16rem] flex-1">
          {mine?.url ? (
            <p className="text-sm text-sage">
              {SOURCE_LABEL[mine.source]}.{" "}
              {published
                ? "It shows on your public sheet."
                : "Only you can see it. It stays that way until you show it."}
            </p>
          ) : preview ? (
            <p className="text-sm text-sage">This is how it will be cropped. Save it to keep it.</p>
          ) : (
            <p className="text-sm text-sage">
              You are using the village art for this path. Upload your own whenever you like.
            </p>
          )}

          {/* THE UPLOAD PATH. Always here, always free, and it never reads the
              budget, so nothing about the forge can take it away. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-sage/40 bg-white px-4 py-2 text-sm font-medium text-teal-deep">
              <Upload className="h-4 w-4" aria-hidden="true" />
              Choose a picture
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif,image/heic"
                className="sr-only"
                onChange={(e) => chooseFile(e.target.files?.[0])}
              />
            </label>
            {preview ? (
              <button
                type="button"
                onClick={upload}
                disabled={!!busy}
                className="min-h-11 rounded-xl bg-teal-deep px-5 py-2 text-sm font-semibold text-white shadow disabled:opacity-50"
              >
                {busy === "upload" ? "Saving." : "Save this picture"}
              </button>
            ) : null}
            {mine?.url ? (
              <>
                <button
                  type="button"
                  onClick={() => setPublished(!published)}
                  disabled={!!busy}
                  className="min-h-11 rounded-xl border border-sage/40 px-4 py-2 text-sm font-medium text-teal-deep disabled:opacity-50"
                >
                  {published ? "Keep it to myself" : "Show it on my profile"}
                </button>
                <button
                  type="button"
                  onClick={remove}
                  disabled={!!busy}
                  aria-label="Remove this portrait"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-coral/40 px-4 py-2 text-sm font-medium text-coral disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Remove
                </button>
              </>
            ) : null}
          </div>

          {/* Only an upload costs nothing, so only the upload half is above
              this line. Everything below spends a gift. */}
          {budget ? (
            <ForgePanel
              budget={budget}
              held={held}
              available={!!studio?.forgeAvailable}
              busy={busy}
              confirming={confirming}
              candidateUrl={mine?.candidateUrl ?? null}
              onConfirm={() => setConfirming(true)}
              onCancel={() => setConfirming(false)}
              onForge={forge}
              onKeep={() => decide("keep")}
              onDiscard={() => decide("discard")}
            />
          ) : null}

          {error ? <p role="alert" className="mt-3 text-sm text-coral">{error}</p> : null}
          {notice ? <p className="mt-3 text-sm text-sage">{notice}</p> : null}
        </div>
      </div>
    </section>
  );
}

interface ForgeProps {
  budget: ForgeBudget;
  held: number;
  available: boolean;
  busy: string;
  confirming: boolean;
  candidateUrl: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  onForge: () => void;
  onKeep: () => void;
  onDiscard: () => void;
}

function ForgePanel(p: ForgeProps) {
  return (
    <div className="mt-5 border-t border-sage/20 pt-4">
      <GrantTokens held={p.held} />
      {/*
        The countdown belongs to a village that can actually forge. With no
        provider the gifts still accrue and are still worth showing, because
        they are being KEPT, and a member who reads "one more arrives in nine
        days" beside "forging is not switched on" has been handed two sentences
        that argue with each other. So the accrual line is replaced by the one
        fact that matters in that state.
      */}
      {p.available ? (
        <p className="mt-1.5 text-sm text-sage">{nextGrantSentence(p.budget)}</p>
      ) : null}

      {!p.available ? (
        // No provider anywhere, which is every village today. Say so plainly
        // and point at the half that works, which is directly above this panel.
        <p className="mt-3 text-sm text-sage">
          Forging a picture is not switched on in this village yet. Your gifts are kept for when it
          is. Uploading your own picture always works.
        </p>
      ) : p.candidateUrl ? (
        <div className="mt-3">
          <p className="text-sm text-teal-deep">Here is what the forge made. Keep it, or let it go.</p>
          <div className="mt-2 w-28 overflow-hidden rounded-xl border-2 border-teal-deep">
            <div className="aspect-[3/4] w-full">
              <img src={p.candidateUrl} alt="" className="h-full w-full object-cover object-top" />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={p.onKeep}
              disabled={!!p.busy}
              className="min-h-11 rounded-xl bg-teal-deep px-5 py-2 text-sm font-semibold text-white shadow disabled:opacity-50"
            >
              {p.busy === "keep" ? "Keeping." : "Keep this one"}
            </button>
            <button
              type="button"
              onClick={p.onDiscard}
              disabled={!!p.busy}
              className="min-h-11 rounded-xl border border-sage/40 px-4 py-2 text-sm font-medium text-teal-deep disabled:opacity-50"
            >
              {p.busy === "discard" ? "Letting go." : "Let it go"}
            </button>
          </div>
          <p className="mt-2 text-sm text-sage">
            The gift for this one is already spent, whichever you choose.
          </p>
        </div>
      ) : p.held <= 0 ? (
        // ZERO, AND NO DEAD BUTTON. The sentence above already said when the
        // next gift lands and in how many days, and the upload sits above.
        <p className="mt-3 text-sm text-sage">
          There is nothing to spend on a forge today. Your own picture is always welcome.
        </p>
      ) : p.confirming ? (
        <div className="mt-3 rounded-xl border border-amber-ink/30 bg-amber-light p-3">
          <p className="text-sm font-medium text-amber-ink">
            This spends one of your {p.held} gifts. It is spent whether you keep the picture or let it go.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={p.onForge}
              disabled={!!p.busy}
              className="min-h-11 rounded-xl bg-teal-deep px-5 py-2 text-sm font-semibold text-white shadow disabled:opacity-50"
            >
              {p.busy === "forge" ? "Forging." : "Spend one and forge"}
            </button>
            <button
              type="button"
              onClick={p.onCancel}
              disabled={!!p.busy}
              className="min-h-11 rounded-xl border border-sage/40 px-4 py-2 text-sm font-medium text-teal-deep disabled:opacity-50"
            >
              Keep my gift
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={p.onConfirm}
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-teal-deep/40 px-4 py-2 text-sm font-semibold text-teal-deep"
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          Forge a picture
        </button>
      )}
    </div>
  );
}

/**
 * The gifts a member holds, drawn one token each.
 *
 * Only what they HAVE is drawn. Empty slots beside them would turn a count of
 * gifts into a gauge of what is missing, which is the reading this is built to
 * avoid. The sentence underneath carries the rest.
 */
function GrantTokens({ held }: { held: number }) {
  const label = grantsHeldSentence(held);
  if (held <= 0) {
    return (
      <p className="flex items-center gap-2 text-sm font-medium text-teal-deep">
        <ImageIcon className="h-4 w-4 text-sage" aria-hidden="true" />
        {label}
      </p>
    );
  }
  /*
   * The setup half banks with no ceiling, so `held` has no upper bound in the
   * schema and a hand-edited row could carry any number at all. The count in
   * words is the authority and is never capped; the DRAWING is, because a row
   * of four hundred dots is a rendering accident and not a gift. Six is the
   * most the rules can produce, so a member never sees the cap.
   */
  const drawn = Math.min(held, BUDGET_TOKEN_SLOTS);
  return (
    <p className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1" role="img" aria-label={label}>
        {Array.from({ length: drawn }, (_, i) => (
          <span
            key={i}
            className="inline-block h-4 w-4 rounded-full border-2 border-amber-ink bg-amber-ink"
          />
        ))}
      </span>
      <span className="text-sm font-medium text-teal-deep">{label}</span>
    </p>
  );
}
