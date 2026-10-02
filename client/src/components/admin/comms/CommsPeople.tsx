/**
 * PEOPLE, in the Comms section of Admin (docs/comms/BUILD_SPEC.md 6).
 *
 * A placeholder from the foundation lane, so the rail, the tab key and the
 * render line are in place; the people lane (B2) builds the screen in this file.
 * Light-only, like every admin surface: fixed grays on fixed white.
 */
export default function CommsPeople(_props: { password: string }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900">People</h2>
      <p className="text-sm text-gray-500 mt-1">
        Everybody the village writes to will be listed here, with what each person agreed to receive.
      </p>
    </div>
  );
}
