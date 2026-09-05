/**
 * Seating a holder: a member of the village, or one of its software agents.
 *
 * ── WHY THIS IS A COMPONENT AND NOT SIXTEEN MORE LINES IN Admin.tsx ──────
 *
 * The server has been able to seat an agent since 0142, and nothing in the
 * product could ask it to. `seatHolder` takes `isAgent` and `agentSlug`, the
 * column exists, the refusal that keeps an agent off the member plane exists,
 * and `HolderCard` already renders "an agent" beside a holder who is one. The
 * only missing piece was a control, so the whole feature was reachable by curl
 * and by nothing else. A gate nobody can reach through the product is a gate
 * that does not exist.
 *
 * It lives here rather than inline because the monolith ratchet had two lines
 * of headroom across the four tracked files, and because a control that now
 * has two modes and its own state had outgrown being a fragment anyway.
 * Extracting it makes that ratchet better rather than worse.
 *
 * ── WHAT THE TWO MODES ACTUALLY DIFFER IN ────────────────────────────────
 *
 * A member seating sends a `userId` and nothing else. An agent seating sends
 * `isAgent` with a name and NEVER a `userId`, which is the combination
 * `seatHolder` refuses: an agent carrying a member account would pass the
 * settlement job's `holder_kind = 'member'` filter and could open the one
 * seat-plane permission door. The refusal lives at the write, so this control
 * cannot create that row even by mistake. Sending the right thing is courtesy;
 * the server is what makes it safe.
 */
import { useState } from "react";

const inputCls = "border border-gray-200 rounded-lg px-2 py-1.5 text-sm";

/** The sentinel the picker uses for "not a person". */
const AGENT = "__agent__";

export function SeatSomebody({
  roleId,
  members,
  call,
  onSeated,
  onFailed,
}: {
  roleId: string;
  members: Array<{ id: string; name?: string }>;
  call: (path: string, body?: any, method?: string) => Promise<any>;
  onSeated: (what: string) => void;
  onFailed?: (why: string) => void;
}) {
  const [who, setWho] = useState("");
  const [agentName, setAgentName] = useState("");
  const seatingAnAgent = who === AGENT;
  const ready = seatingAnAgent ? agentName.trim().length > 0 : who.length > 0;

  const seat = async () => {
    const body = seatingAnAgent
      ? { isAgent: true, displayName: agentName.trim(), agentSlug: agentName.trim() }
      : { userId: who };
    const ok = await call(`/admin/org/roles/${roleId}/holders`, body);
    // Held rather than assumed. The control says a seating landed only when the
    // response said so, which is the whole of what the save-honesty rule asks.
    if (!ok) {
      onFailed?.("That seat was not filled");
      return;
    }
    onSeated(seatingAnAgent ? "Agent seated" : "Seated");
    setWho("");
    setAgentName("");
  };

  return (
    <>
      <label className="text-xs text-muted-foreground">
        Seat someone
        <select className={`${inputCls} mt-1`} value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Choose a member...</option>
          {members.map((m: any) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
          <option value={AGENT}>An agent, not a person</option>
        </select>
      </label>
      {seatingAnAgent && (
        <label className="text-xs text-muted-foreground">
          What the agent is called
          <input
            className={`${inputCls} mt-1`}
            value={agentName}
            placeholder="Meeting Memory"
            onChange={(e) => setAgentName(e.target.value)}
          />
        </label>
      )}
      <button
        className="text-sm bg-teal-deep text-white rounded-lg px-3 py-2 font-medium disabled:opacity-40"
        disabled={!ready}
        onClick={() => void seat()}
      >
        Seat
      </button>
    </>
  );
}
