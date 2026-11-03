/**
 * The one line the profile carries for Your list. The card itself is
 * lazy-loaded, so a member whose list is off downloads one small chunk and
 * nothing else on boot.
 */
import { Suspense, lazy } from "react";

const YourListCard = lazy(() => import("./YourListCard"));

export default function YourListMount() {
  return (
    <Suspense fallback={null}>
      <YourListCard />
    </Suspense>
  );
}
