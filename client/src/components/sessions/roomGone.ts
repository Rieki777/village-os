/**
 * THE SENTENCE A GONE ROOM LEAVES FOR THE LIST. When a session is discarded or
 * its record deleted, everybody who had it on screen lands on /sessions, and
 * the list says why once: "This session was discarded." The room writes the
 * sentence here before it moves, and the list reads it as it opens.
 *
 * It lives in memory, never in storage: it is for the move from the room to
 * the list in this tab, and a reload of the list later has nothing to say.
 * The list reads it in its first render and clears it in an effect, so a
 * second render of the same page (React's strict mode runs an initializer
 * twice) still shows it, and the next visit to the list does not.
 */
let note: string | null = null;

export function leaveRoomGone(sentence: string): void {
  note = sentence;
}

export function peekRoomGone(): string | null {
  return note;
}

export function clearRoomGone(): void {
  note = null;
}
