/**
 * WORDS, in the Comms section of Admin (the comms build spec 6).
 *
 * A placeholder from the foundation lane, so the rail, the tab key and the
 * render line are in place; the words lane (B3) builds the screen in this file.
 * Light-only, like every admin surface: fixed grays on fixed white.
 */
export default function CommsWords(_props: { password: string }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900">Words</h2>
      <p className="text-sm text-gray-500 mt-1">
        Every email's words will be editable here, with the platform's own version shown beside the village's.
      </p>
    </div>
  );
}
