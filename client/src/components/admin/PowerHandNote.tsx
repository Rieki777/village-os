/**
 * A RAISED HAND FOR A POWER, IN THE SUBMISSIONS INBOX.
 *
 * `POST /api/powers/:key/raise-hand` stores `capability`, `powerLabel` and
 * `suits` in the row's data (server/routes/powerHands.ts). The inbox's generic
 * table would print them as three raw rows, one of them an array, so this says
 * them as one sentence.
 *
 * It also says what saying yes does, right beside the status select where a
 * founder picks "Accepted": nothing yet. A power reaches a member through a
 * role that carries it, so the note names both screens that takes. Game Roles
 * seats a member on a role. The Handover is the one screen that gives a role a
 * power (`PUT /api/admin/roles/:id/capabilities`); Game Roles only shows a
 * role's powers.
 *
 * Light-only, like the rest of the admin panel.
 */
import { POWER_HAND_KEYS, powerHandSentence } from "@shared/powerHands";

/** The data keys this note says, which the generic table leaves out. */
export { POWER_HAND_KEYS };

export function PowerHandNote({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="mb-4 rounded-lg border border-gray-200 bg-white px-3 py-2" data-power-hand>
      <p className="text-xs font-medium text-gray-500">What they ask for</p>
      <p className="text-sm text-gray-800">{powerHandSentence(data)}</p>
      <p className="mt-1 text-sm text-gray-600">
        Saying yes here gives them nothing yet. To hand them the power, seat them on a role that carries it under Game
        Roles. If no role carries it yet, give the power to a role under The Handover first.
      </p>
    </div>
  );
}
