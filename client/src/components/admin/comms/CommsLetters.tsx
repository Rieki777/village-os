/**
 * LETTERS, in the Comms section of Admin (docs/comms/BUILD_SPEC.md 6).
 *
 * A placeholder from the foundation lane, so the rail, the tab key and the
 * render line are in place; the letters lane (D2) builds the screen in this file.
 * Light-only, like every admin surface: fixed grays on fixed white.
 */
export default function CommsLetters(_props: { password: string }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900">Letters</h2>
      <p className="text-sm text-gray-500 mt-1">
        Letters to the people who asked for them will be written, tested and sent from here.
      </p>
    </div>
  );
}
