/**
 * The soft 404. It renders wherever an unknown route lands, no redirect, no
 * server 404, and every module-off route lands here too.
 *
 * Since Phase B (lane B3) it stands in the night world: a root that frays off
 * the trail, stepping stones, and one lit door home, the scene in
 * components/quiet/OffTheTrail. This file stays small because the app shell
 * imports it: it draws the main landmark and the language bar at once, and
 * the scene (with the nature kit's fireflies) arrives in its own chunk, so the
 * kit never reaches the first page. The words are the copy pass R5 wrote:
 * plainly first, the land second, and a short way home.
 */
import { lazy, Suspense } from "react";
import { useLingui } from "@lingui/react/macro";
import { WORLD } from "@/components/journey/look";
import QuietLoading from "@/components/natural/QuietLoading";
import { PageLanguageBar } from "@/i18n/PageLanguageBar";

const OffTheTrail = lazy(() => import("@/components/quiet/OffTheTrail"));

export default function NotFound() {
  const { t } = useLingui();
  // <main>, because this page renders without the shell: it was the one page
  // with no main landmark at all.
  return (
    <main className={`${WORLD} flex w-full flex-col px-4 pb-10`}>
      {/* The language selector (spec i18n US2): this page renders without the shell. */}
      <PageLanguageBar tone="onSheet" className="pt-3" />
      <div className="flex flex-1 items-center justify-center py-4 sm:py-10">
        <Suspense fallback={<QuietLoading label={t({ message: "Gathering your page", context: "loading: a page is on its way" })} shape={false} className="min-h-[50vh]" />}>
          <OffTheTrail />
        </Suspense>
      </div>
    </main>
  );
}
