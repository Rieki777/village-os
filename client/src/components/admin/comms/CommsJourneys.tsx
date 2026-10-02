/**
 * JOURNEYS, in the Comms section of Admin (the comms build spec 6).
 *
 * A placeholder from the foundation lane, so the rail, the tab key and the
 * render line are in place; the journeys lane (C1) builds the screen in this file.
 * Light-only, like every admin surface: fixed grays on fixed white.
 */
export default function CommsJourneys(_props: { password: string }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900">Journeys</h2>
      <p className="text-sm text-gray-500 mt-1">
        The emails a village can switch on, step by step, will be listed here, and every one of them starts switched off.
      </p>
    </div>
  );
}
