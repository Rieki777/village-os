/**
 * SENT MAIL, in the Comms section of Admin (docs/comms/BUILD_SPEC.md 6).
 *
 * A placeholder from the foundation lane, so the rail, the tab key and the
 * render line are in place; the post office lane (B1) builds the screen in this file.
 * Light-only, like every admin surface: fixed grays on fixed white.
 */
export default function CommsSentMail(_props: { password: string }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900">Sent mail</h2>
      <p className="text-sm text-gray-500 mt-1">
        Every email the village sends is already being recorded, and the list of them will appear here.
      </p>
    </div>
  );
}
