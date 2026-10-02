/**
 * OVERVIEW, in the Comms section of Admin (docs/comms/BUILD_SPEC.md 6).
 *
 * A placeholder from the foundation lane, so the rail, the tab key and the
 * render line are in place; the setup lane (B4) builds the screen in this file.
 * Light-only, like every admin surface: fixed grays on fixed white.
 */
export default function CommsOverview(_props: { password: string }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900">Overview</h2>
      <p className="text-sm text-gray-500 mt-1">
        This is where the village's email will be summed up: what went out this week, what is waiting, and anything that needs a person.
      </p>
    </div>
  );
}
