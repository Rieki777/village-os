/**
 * The profile's one line for the end-of-moon review: My moon, and under it
 * the Moon reviews queue for whoever the server lets read it. Both load as
 * their own chunks, so a member whose village has the module off pays for
 * this file and nothing else, and each draws nothing when its door says no.
 */
import { lazy, Suspense } from "react";
import { useModuleOn } from "@/modules/ModuleProvider";
/** `MOON_REVIEW_MODULE` in shared/moonRecap.ts, spelled here so the profile chunk does not carry that file. */
const MOON_REVIEW_MODULE = "moon-review";

const MyMoon = lazy(() => import("./MyMoon"));
const ReviewQueue = lazy(() => import("./ReviewQueue"));

export default function MyMoonMount() {
  const on = useModuleOn(MOON_REVIEW_MODULE);
  if (!on) return null;
  return (
    <Suspense fallback={null}>
      <div id="my-moon" className="flex scroll-mt-28 flex-col gap-6">
        <MyMoon />
        <ReviewQueue />
      </div>
    </Suspense>
  );
}
