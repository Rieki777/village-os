/**
 * THE FLOATING SAVE BAR: one Save for everything changed on a surface.
 *
 * The lead (2026-11-11): "A save button should pop up every time I make a
 * change ... It's something that pops up on the screen for both phone and
 * desktop so it's really obvious." So it is fixed to the bottom of the
 * viewport on every width, lifted above whichever bottom bar the page already
 * has (Admin's Sections bar, the member tab bar), and it says how many changes
 * are waiting.
 *
 * IT SAYS ONLY WHAT THE SERVER SAID (scripts/check-save-honesty.mjs). The
 * surface's `onSave` returns what each write answered, and the bar shows
 * "Saved" only for an answer that was ok. A partial save names what did not
 * land and stays up, holding those changes, so nothing failed looks done.
 *
 * Keyboard: both buttons are ordinary buttons in the tab order, and Ctrl+S or
 * Cmd+S saves while the bar is up. A polite live region says when changes
 * start waiting and when they are saved; a failure is announced as an alert.
 * Motion is a short slide and fade, only under `motion-safe`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg, plural } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import { dirtySurfaces, useSaveSurface, useUnsavedTotal } from "@/lib/unsavedChanges";

export type SaveFailure = { label: string; reason: string };
export type SaveResult = { ok: true } | { ok: false; reason?: string; failed?: SaveFailure[] };

type Status = "idle" | "saving" | "saved" | "failed";

const UNREACHABLE = msg`The save could not reach the server.`;

const BOTTOM_BARS = "[data-admin-bottom-bar], [data-mobile-tabbar]";

/** The height of whichever bottom bar is showing, so the save bar sits above it. */
function bottomBarHeight(): number {
  let h = 0;
  document.querySelectorAll<HTMLElement>(BOTTOM_BARS).forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.height > 0 && getComputedStyle(el).display !== "none") h = Math.max(h, r.height);
  });
  return h;
}

export default function SaveBar({
  count: ownCount,
  onSave: ownSave,
  onDiscard: ownDiscard,
  what: ownWhat,
}: {
  /** How many changes are waiting. Zero hides the bar. */
  count: number;
  onSave: () => Promise<SaveResult>;
  onDiscard: () => void;
  /** Optional words for what is being saved, e.g. "the org chart". */
  what?: string;
}) {
  const { t } = useLingui();
  const [status, setStatus] = useState<Status>("idle");
  const [failure, setFailure] = useState<{ reason?: string; failed?: SaveFailure[] } | null>(null);
  const [lift, setLift] = useState(0);
  const [shown, setShown] = useState(false);
  const [said, setSaid] = useState("");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hadChanges = useRef(false);

  // One bar per screen: the first surface mounted draws it for every
  // surface holding changes (lib/unsavedChanges.ts); the rest only register.
  const { leader } = useSaveSurface({ count: ownCount, save: ownSave, discard: ownDiscard, what: ownWhat });
  const total = useUnsavedTotal();
  const count = leader ? total : 0;
  const dirtyNow = leader ? dirtySurfaces() : [];
  const what = dirtyNow.length > 1 ? undefined : dirtyNow[0]?.what ?? ownWhat;

  const onSave = async (): Promise<SaveResult> => {
    const dirty = dirtySurfaces();
    if (dirty.length === 1) return dirty[0].save();
    const failed: SaveFailure[] = [];
    for (const one of dirty) {
      let r: SaveResult;
      try { r = await one.save(); } catch { r = { ok: false, reason: i18n._(UNREACHABLE) }; }
      if (r.ok) continue;
      if (r.failed?.length) failed.push(...r.failed);
      else failed.push({ label: one.what ?? t({ message: "This section", context: "save bar, a part of the page that did not save" }), reason: r.reason ?? t`That did not save.` });
    }
    return failed.length ? { ok: false, failed } : { ok: true };
  };
  const onDiscard = () => dirtySurfaces().forEach((one) => one.discard());

  const visible = count > 0 || status === "saving" || status === "saved";

  // Sit above any bottom bar; measured again when the window changes size,
  // because Admin's bar only shows below the large breakpoint.
  useEffect(() => {
    if (!visible) return;
    const measure = () => setLift(bottomBarHeight());
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [visible]);

  // Enter on the next frame so the slide can run; with reduced motion the
  // classes below carry no transition and it simply appears.
  useEffect(() => {
    if (!visible) { setShown(false); return; }
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [visible]);

  // Announce the moment changes start waiting, once, and not every keystroke.
  useEffect(() => {
    if (count > 0 && !hadChanges.current) {
      hadChanges.current = true;
      if (status !== "failed") setSaid(t`You have changes waiting to be saved.`);
    }
    if (count === 0) hadChanges.current = false;
  }, [count, status, t]);

  // A new edit after a failure goes back to the plain prompt.
  useEffect(() => {
    if (status === "saved" && count > 0) setStatus("idle");
  }, [count, status]);

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const save = useCallback(async () => {
    if (status === "saving" || count === 0) return;
    setStatus("saving");
    setFailure(null);
    setSaid(t({ message: "Saving.", context: "save bar" }));
    let result: SaveResult;
    try {
      result = await onSave();
    } catch {
      result = { ok: false, reason: t`The save could not reach the server. Nothing was changed.` };
    }
    if (result.ok) {
      setStatus("saved");
      setSaid(t({ message: "Saved.", context: "save bar" }));
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 2500);
    } else {
      setStatus("failed");
      setFailure({ reason: result.reason, failed: result.failed });
      setSaid("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, status, t]);

  useEffect(() => {
    if (count === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, save]);

  const discard = () => {
    setStatus("idle");
    setFailure(null);
    setSaid(t({ message: "Changes discarded.", context: "save bar" }));
    onDiscard();
  };

  const countWords = plural(count, { one: "# change not saved yet", other: "# changes not saved yet" });
  const headline =
    status === "saving" ? t({ message: "Saving…", context: "save bar" })
      : status === "saved" && count === 0 ? t({ message: "Saved", context: "save bar" })
        : countWords;

  if (!leader) return null;
  return (
    <>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{said}</p>
      {visible && (
        <>
          {/* Room at the end of the page, so the bar never covers the last field. */}
          <div aria-hidden="true" className="h-28" />
          <div
            data-save-bar=""
            role="region"
            aria-label={t({ message: "Unsaved changes", context: "save bar region" })}
            style={{ bottom: lift }}
            className={`fixed inset-x-0 z-[55] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] motion-safe:transition-[transform,opacity] motion-safe:duration-300 motion-safe:ease-out ${shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100"}`}
          >
            <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card px-4 py-3 text-card-foreground shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-medium" data-save-bar-status={status}>
                  {headline}
                  {what && status !== "saved" && <span className="text-muted-foreground"> · {what}</span>}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={discard}
                    disabled={status === "saving" || count === 0}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <Trans context="save bar">Discard</Trans>
                  </button>
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={status === "saving" || count === 0}
                    aria-keyshortcuts="Control+S Meta+S"
                    className="inline-flex min-h-11 items-center justify-center rounded-xl bg-notice px-5 py-2 text-sm font-semibold text-background hover:bg-notice/90 active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
                  >
                    {status === "saving" ? <Trans context="save bar">Saving…</Trans> : <Trans context="save bar">Save</Trans>}
                  </button>
                </div>
              </div>
              {status === "failed" && failure && (
                <div role="alert" className="mt-2 rounded-lg border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {failure.failed && failure.failed.length > 0 ? (
                    <>
                      <p className="font-medium">
                        {plural(failure.failed.length, { one: "# change did not save. It is still here to try again.", other: "# changes did not save. They are still here to try again." })}
                      </p>
                      <ul className="mt-1 list-disc pl-5">
                        {failure.failed.map((f, i) => (
                          <li key={`${f.label}-${i}`}><span className="font-medium">{f.label}</span>: {f.reason}</li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p>{failure.reason || t`That did not save. Your changes are still here.`}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

/**
 * Run a list of saves one after another and gather what failed, for a
 * surface that saves several items through their own routes. Each item's
 * `run` resolves to null when it landed and to a reason when it did not.
 * The caller keeps the failed keys dirty and lets the rest go.
 */
export async function saveEach(items: { key: string; label: string; run: () => Promise<string | null> }[]): Promise<{ result: SaveResult; failedKeys: Set<string> }> {
  const failed: SaveFailure[] = [];
  const failedKeys = new Set<string>();
  for (const it of items) {
    let reason: string | null;
    try { reason = await it.run(); } catch { reason = i18n._(UNREACHABLE); }
    if (reason) { failed.push({ label: it.label, reason }); failedKeys.add(it.key); }
  }
  return { result: failed.length === 0 ? { ok: true } : { ok: false, failed }, failedKeys };
}
