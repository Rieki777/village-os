/**
 * Every photograph in the village on one page, newest first.
 *
 * ── WHAT THIS PAGE IS FOR ────────────────────────────────────────────────
 *
 * Somebody who wants a picture of themselves taken down has to be able to
 * find it. They do not know which place it was filed under, and sending them
 * around the shelf guessing is the same failure as making them ask a curator
 * for help.
 *
 * The cheap way to solve that is to work out who is in every photograph and
 * let a person search for their own face. That finds the picture, and it also
 * leaves the village holding a permanent record of who appears in every
 * photograph of it, for everybody, forever, available to whoever runs the
 * place next. A page a person can scroll answers the same question and leaves
 * nothing behind that can be turned on anyone later. That is the whole reason
 * this is a list and not a search box.
 *
 * ── WHY IT LOADS THE WAY IT DOES ─────────────────────────────────────────
 *
 * Sixty at a time, then a button. The server hands back the exact row the
 * page ended on and the next press carries on from there, so a photograph
 * coming down between two presses cannot make the list skip one. Everything
 * below the fold waits for a scroll before it fetches any bytes.
 *
 * Acting on a picture reloads every page the reader has open, not just the
 * one the picture was on, because a takedown changes what is above it too.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import Layout from "@/components/Layout";
import ModuleGate from "@/components/modules/ModuleGate";
import { PAGE_GATE_LINES } from "@/components/modules/gateCopy";
import BreathingLoader from "@/components/natural/BreathingLoader";
import PhotoCard, { BTN, jsonHeaders } from "@/components/places/PhotoCard";
import { useModule, useModules } from "@/modules/ModuleProvider";
import type { PlacePhoto } from "@shared/placePhotos";

interface IndexPage {
  photos: PlacePhoto[];
  nextBefore: string | null;
  canCurate: boolean;
  viewerId: string | null;
  signedIn: boolean;
}

export default function Photographs() {
  const modules = useModules();
  const mapModule = useModule("map");
  if (modules.loaded && !mapModule) {
    return <ModuleGate moduleId="map" name="Photographs" behind={PAGE_GATE_LINES.places} />;
  }
  return <PhotographsPage />;
}

function PhotographsPage() {
  const [pages, setPages] = useState<IndexPage[] | null>(null);
  const [locked, setLocked] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [say, setSay] = useState("");

  /** One page of the index, or null when the read did not land. */
  const fetchPage = useCallback(async (before: string | null): Promise<IndexPage | null> => {
    const suffix = before ? `?before=${encodeURIComponent(before)}` : "";
    const res = await fetch(`/api/places/photos${suffix}`, { headers: jsonHeaders() });
    if (res.status === 401) {
      setLocked(true);
      return null;
    }
    if (!res.ok) {
      setFailed(true);
      return null;
    }
    return (await res.json()) as IndexPage;
  }, []);

  /**
   * The first page, then as many more as the reader already had open.
   *
   * Re-reading the whole run is what keeps a takedown honest: hiding a
   * photograph on the third page shifts what sits on the second, and a page
   * that refreshed only the row that changed would keep showing the old one.
   */
  const loadRun = useCallback(
    async (depth: number) => {
      const run: IndexPage[] = [];
      let before: string | null = null;
      for (let i = 0; i < Math.max(1, depth); i += 1) {
        const page: IndexPage | null = await fetchPage(before);
        if (!page) return;
        run.push(page);
        if (!page.nextBefore) break;
        before = page.nextBefore;
      }
      setPages(run);
      setFailed(false);
    },
    [fetchPage],
  );

  useEffect(() => {
    void loadRun(1);
  }, [loadRun]);

  const showOlder = async () => {
    const tail = pages?.[pages.length - 1];
    if (!tail?.nextBefore || busy) return;
    setBusy(true);
    try {
      const page = await fetchPage(tail.nextBefore);
      if (page) setPages([...(pages ?? []), page]);
    } finally {
      setBusy(false);
    }
  };

  if (locked) {
    return (
      <Layout>
        <div className="max-w-5xl mx-auto px-4 py-10 space-y-6">
          <h1 className="font-serif text-3xl">Every photograph</h1>
          <p className="rounded-xl border border-border bg-card p-6">
            This village keeps its pictures to members.{" "}
            <Link href={`/login?next=${encodeURIComponent("/photographs")}`} className="text-teal-deep underline">
              Sign in
            </Link>{" "}
            to read them.
          </p>
        </div>
      </Layout>
    );
  }

  const photos = (pages ?? []).flatMap((p) => p.photos);
  const head = pages?.[0];
  const tail = pages?.[pages.length - 1];

  return (
    <Layout>
      <div className="max-w-5xl mx-auto px-4 py-10 space-y-6">
        <header className="space-y-2">
          <h1 className="font-serif text-3xl">Every photograph</h1>
          <p className="text-muted-foreground">
            Every picture anybody has added to this village, newest first, whatever place it is filed under. Each one
            carries the name of whoever took it and the month it was taken.
          </p>
          <p className="text-muted-foreground">
            If one of these is a photograph of you and you want it down, find it here and press "This is a photograph of
            me". It goes dark straight away, the file stops answering, and the curators get your request.
          </p>
          <nav aria-label="Places">
            <Link href="/places" className="text-sm text-teal-deep underline inline-block py-1.5 min-h-[44px]">
              Browse by place instead
            </Link>
          </nav>
        </header>

        {/* A visitor sees the pictures and none of the controls, because
            asking for a photograph of you to come down needs an account. The
            page says so here rather than leaving somebody scrolling past
            their own face wondering where the button is. The sentence is the
            server's own refusal, so the two never say different things. */}
        {head && !head.signedIn && (
          <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            <Link href={`/login?next=${encodeURIComponent("/photographs")}`} className="text-teal-deep underline">
              Sign in
            </Link>{" "}
            to ask for a photograph of you to come down. A request needs an account, because one press from a signed
            out stranger would be enough to darken any picture here and leave nobody to talk to about it afterwards.
          </p>
        )}

        <p role="status" aria-live="polite" className="text-sm text-teal-deep min-h-[20px]">{say}</p>

        {failed ? (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            The photographs did not load. Reload the page to try again.
          </p>
        ) : !pages ? (
          <BreathingLoader label="Opening the village's photographs" />
        ) : photos.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
            No photographs yet.
          </p>
        ) : (
          <>
            <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 list-none p-0">
              {photos.map((photo) => (
                <PhotoCard
                  key={photo.id}
                  photo={photo}
                  canCurate={!!head?.canCurate}
                  signedIn={!!head?.signedIn}
                  mine={!!head?.viewerId && head.viewerId === photo.contributorId}
                  showPlace
                  onChanged={() => void loadRun(pages.length)}
                  onSay={setSay}
                />
              ))}
            </ul>
            {tail?.nextBefore ? (
              <button type="button" onClick={showOlder} disabled={busy} className={BTN}>
                {busy ? "Opening..." : "Show older"}
              </button>
            ) : (
              <p className="text-sm text-muted-foreground">That is the whole record, back to the first picture.</p>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
