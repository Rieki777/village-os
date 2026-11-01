/**
 * THE ONE HAND-OVER CONTROL: what the launch hands to the village, and every
 * hand-over after it (Rye, 2026-11-01).
 *
 *   GET  /api/governance/powers/hand-to-village   the checklist, for somebody who may act
 *   POST /api/governance/powers/hand-to-village   { capabilities, confirm: true }
 *
 * His words, in order: "stewards hold all powers after launch; launching just
 * starts the tokens and starts the game. How the powers transition is up to
 * the stewards, to slowly give the powers away as the community/game
 * matures." Then: "At launch the stewards select WHAT powers are being passed
 * over." The selection may be none, some or all, and one control sets it and
 * makes every later hand-over: same component, same API, same recorded act.
 *
 * TWO STAGES, ONE ACT.
 *
 *   before the Game starts   the checklist IS the launch selection, written
 *                            whole (`writeLaunchSelection`). An empty one is
 *                            a selection of nothing. The launch closer moves
 *                            exactly it (`seatCatalystsAsStewards`, step 3).
 *   after the Game starts    each power named crosses now, held by the
 *                            Steward role, which is the row the launch writes.
 *
 * Everything that reads `capability_holding` follows on its own: the gate
 * stops letting an administrator through on a power the village holds, and
 * adopting somebody into a role carrying `org.seat` becomes the village's vote.
 *
 * WHO. A live holder of a role carrying `steward.veto`, counted the way the
 * gate counts a seat with the admin short-circuit left out
 * (`liveHoldersOfCapability`). Before the Game starts nobody sits in that seat
 * yet, because the launch is what seats the stewards, so a FOUNDER chooses the
 * launch selection: the founders are the stewards-to-be (Rye, 2026-09-24). An
 * administrator who is neither is refused like anybody else.
 *
 * ONE WAY. Nothing here hands a power back; that stays a village vote
 * (`power_return`, `RETURN_NEEDS_A_VOTE`). A power the village already holds
 * is left exactly where it is and reported, never re-pointed: the upsert under
 * `moveCapabilityToVillage` would rewrite its holder and null the ballot that
 * moved it, which is the defect `MOVE_NEEDS_A_VOTE` names.
 *
 * RECORDED. A launch selection writes who chose it and when, and both stages
 * write a line on the village's record and an audit event; a crossing also
 * puts the steward's id on the row.
 */
import type { Express } from "express";
import { BREAK_GLASS_SEAT, HANDOVER_SET, type Capability } from "../../shared/capabilities";
import type { Pool } from "mysql2/promise";
import { LAUNCH_SUBJECT_REF, VILLAGE_LAUNCH } from "../../shared/ballotSubjects";
import type { AppDeps } from "../lib/appDeps";
import { openBallotFor } from "../lib/ballots";
import { capabilityHoldings, moveCapabilityToVillage, STEWARD_ROLE_ID } from "../lib/capabilityHolding";
import { recordEvent } from "../lib/events";
import { founderPowerStands } from "../lib/gameStart";
import { powerInPlainWords as plainWords, readLaunchSelection, writeLaunchSelection } from "../lib/launchHandover";

export const HAND_OVER_PATH = "/api/governance/powers/hand-to-village";

export const HAND_OVER_WORDS = {
  notSteward:
    "Only a steward hands a power to the village: somebody seated in a role that carries the steward's veto. Before the Game starts, a founder chooses what the launch hands over.",
  notAList: "Send the powers as a list, even an empty one.",
  nonePicked: "Name the powers to hand to the village.",
  notAPower: (capability: string) => `${capability} is not one of the powers the stewards hold.`,
  unconfirmed:
    "Confirm the hand-over. From then on the village holds each power you named, and only a village vote hands one back.",
  tooMany: "That is a lot of hand-overs at once. Wait a few minutes and try again.",
  frozen:
    "The launch vote is open, and this list is written into it. To change what the launch hands over, withdraw that vote and open a new one.",
  adminDoorClosed:
    "Since the Game started, the stewards decide which powers the village holds. A steward hands one over from the hand-over checklist on the Journey to Launch page.",
} as const;

/**
 * THE ADMIN DOOR AFTER LAUNCH (coordinator ruling on #769, 2026-11-01).
 *
 * `PUT /api/admin/capabilities/:capability/holding` hands a power to a role,
 * and before this change nobody could reach it after launch, because the
 * launch had already crossed every power. Now the launch crosses only the
 * selection, so the door would be a second way around Rye's ruling. After the
 * Game starts it is a steward's, exactly as the hand-over route is.
 *
 * WITH NOBODY IN THE STEWARD SEAT IT STAYS THE SCAFFOLDING'S, for the reason
 * the launch closer gives for an empty seat: a power nobody can act on belongs
 * to nobody, and a village with no steward must still be able to run its own
 * panel. Before the Game starts it is open, as it always was.
 */
export async function adminDoorRefusal(
  pool: Pool,
  actorId: string,
  liveHoldersOf: (capability: string) => Promise<string[]>,
): Promise<string | null> {
  if (await founderPowerStands(pool)) return null;
  const stewards = await liveHoldersOf(BREAK_GLASS_SEAT);
  if (stewards.length === 0 || stewards.includes(actorId)) return null;
  return HAND_OVER_WORDS.adminDoorClosed;
}

/** Ten in ten minutes per person: a power crosses once, so a burst is a script. */
const ASKS = 10;
const WINDOW_MS = 10 * 60 * 1000;

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "overLimit"> & {
  /** Who holds a capability live, the way the gate counts it (`liveHoldersNow`). */
  liveHoldersOf(capability: string): Promise<string[]>;
};

export function register(app: Express, deps: Deps): void {
  /** May this person use the control, and which stage are we in. */
  async function standing(user: any): Promise<{ started: boolean; mayAct: boolean }> {
    const started = !(await founderPowerStands(deps.getPool()));
    const steward = (await deps.liveHoldersOf(BREAK_GLASS_SEAT)).includes(String(user.id));
    return { started, mayAct: steward || (!started && String(user.role ?? "") === "founder") };
  }

  app.get(HAND_OVER_PATH, async (req, res) => {
    const user = await deps.authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const { started, mayAct } = await standing(user);
    if (!mayAct) return res.json({ gameStarted: started, mayAct: false });
    const pool = deps.getPool();
    const held = new Set((await capabilityHoldings(pool)).map((h) => h.capability));
    const selected = started ? [] : (await readLaunchSelection(pool)).capabilities;
    const frozen = !started && !!(await openBallotFor(pool, VILLAGE_LAUNCH, LAUNCH_SUBJECT_REF));
    res.json({
      gameStarted: started,
      mayAct: true,
      selected,
      frozen,
      powers: HANDOVER_SET.map((capability) => ({ capability, ...plainWords(capability), held: held.has(capability) })),
    });
  });

  app.post(HAND_OVER_PATH, async (req, res) => {
    const user = await deps.authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const actorId = String(user.id);
    if (await deps.overLimit(`hand-to-village:${actorId}`, ASKS, WINDOW_MS)) {
      return res.status(429).json({ error: HAND_OVER_WORDS.tooMany });
    }
    // Who may act first, so somebody who may not learns nothing about the rest of the request.
    const { started, mayAct } = await standing(user);
    if (!mayAct) return res.status(403).json({ error: HAND_OVER_WORDS.notSteward });
    const asked = req.body?.capabilities;
    if (!Array.isArray(asked)) return res.status(400).json({ error: HAND_OVER_WORDS.notAList });
    const named = Array.from(new Set(asked.map(String)));
    // A launch selection may be empty; a hand-over after launch has to name something.
    if (started && named.length === 0) return res.status(400).json({ error: HAND_OVER_WORDS.nonePicked });
    const stray = named.find((c) => !(HANDOVER_SET as readonly string[]).includes(c));
    if (stray) return res.status(400).json({ error: HAND_OVER_WORDS.notAPower(stray) });
    if (req.body?.confirm !== true) return res.status(400).json({ error: HAND_OVER_WORDS.unconfirmed });
    const pool = deps.getPool();

    if (!started) {
      // Frozen while the launch vote is open: members are voting on the list its document carries.
      if (await openBallotFor(pool, VILLAGE_LAUNCH, LAUNCH_SUBJECT_REF)) {
        return res.status(409).json({ error: HAND_OVER_WORDS.frozen });
      }
      const selection = await writeLaunchSelection(pool, named, actorId);
      const titles = selection.capabilities.map((c) => plainWords(c).title);
      await recordEvent(pool, {
        kind: "governance",
        text:
          titles.length === 0
            ? "The launch will hand the village none of its powers. The stewards hand them over later, one at a time."
            : `When the Game starts, the village will hold: ${titles.join("; ")}.`,
        actorUserId: actorId,
        entityType: "launch-handover",
      });
      await recordEvent(pool, {
        kind: "audit",
        text: `capability:launch-selection:${selection.capabilities.join(",") || "none"}`,
        actorUserId: actorId,
        entityType: "launch-handover",
        audience: "admin",
      });
      return res.json({ stage: "launch", selected: selection.capabilities });
    }

    const held = new Set((await capabilityHoldings(pool)).map((h) => h.capability));
    const moved: string[] = [];
    const alreadyHeld: string[] = [];
    const refused: Array<{ capability: string; error: string }> = [];
    for (const capability of named) {
      if (held.has(capability)) {
        alreadyHeld.push(capability);
        continue;
      }
      const r = await moveCapabilityToVillage(pool, {
        capability,
        holderRoleId: STEWARD_ROLE_ID,
        movedByUserId: actorId,
        note: "Handed to the village by its stewards.",
      });
      if (!r.ok) {
        refused.push({ capability, error: r.error });
        continue;
      }
      moved.push(capability);
      await recordEvent(pool, {
        kind: "governance",
        text: `The stewards handed this to the village: whoever holds it can ${plainWords(capability).consequence}.`,
        actorUserId: actorId,
        entityType: "capability",
        entityRef: capability,
      });
      await recordEvent(pool, {
        kind: "audit",
        text: `capability:handed-to-village:${capability}`,
        actorUserId: actorId,
        entityType: "capability",
        entityRef: capability,
        audience: "admin",
      });
    }
    res.json({ stage: "now", moved, alreadyHeld, refused });
  });
}
