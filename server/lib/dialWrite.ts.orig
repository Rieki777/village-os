/**
 * THE DIAL WRITE, as one callable function (moved out of server/index.ts by
 * the canvas-frames-server lane, 2026-09-28).
 *
 *   PUT  /api/admin/variables/:key          server/index.ts calls `writeDial`
 *   POST /api/canvas/proposals/:id/adopt    server/routes/canvasFrames.ts calls
 *                                           `writeDial` for a dial door, before
 *                                           the Birthing
 *
 * ── WHY IT MOVED, AND WHY NOTHING IN IT CHANGED ────────────────────────────
 *
 * Plan 2.3 ("Make it real") has adopting a canvas answer before the Birthing
 * write the setting it names by calling that setting's OWN logic, so the
 * setting keeps its own guard. The dial write's guard is not one line: it is
 * `dial.set` asked of the one gate, the ring floor, the override hatch, the
 * two unenforced stays dials, the Hypha secret precondition and the weight
 * keys a started Game keeps for itself. A canvas route that re-spelled any of
 * it would be a second dial write with a different set of refusals, which is
 * the twin every one of those comments exists to prevent.
 *
 * So the handler body moved here verbatim, its comments with it, and both
 * doors call it with the request in hand: the gate sees the same person
 * whichever door they came through. It answers a status and a body instead of
 * writing to a response, because the canvas door has to read the answer
 * before it records anything.
 *
 * The collaborators it needs are handed in, the way `AppDeps` hands them to
 * every extracted route module: `mayAct` and `overrideRefusal` close over the
 * gate's caches in server/index.ts, and `checkVoiceSecret` is passed so this
 * file does not import the voice-claim module and its chain reader.
 */
import type express from "express";
import type { Pool } from "mysql2/promise";
import type { Capability } from "../../shared/capabilities";
import { ringOf, VARIABLES_BY_KEY } from "../../shared/gameVariables";
import type { CapabilityVerdict } from "./appDeps";
import { readGameStart } from "./gameStart";
import { setVariable } from "./variables";

/** The two dials a started Game answers for itself, through a governance_mode ballot. */
export const WEIGHT_KEYS_AFTER_START = new Set(["governance.weight_mode", "governance.weight_token"]);

export const FOUNDER_RING_HELD =
  "This dial is not one the village governs, and the village holds the power to turn dials, " +
  "so nobody can change this one here while it does. An override does not reach it.";

export interface DialWriteDeps {
  mayAct(req: express.Request, cap: Capability): Promise<CapabilityVerdict>;
  overrideRefusal(cap: Capability, verdict: CapabilityVerdict): Record<string, unknown> | null;
  authedUser(req: express.Request): Promise<any | null>;
  adminActor(req: express.Request): { id: string; name?: string } | null;
  getPool(): Pool;
  recordMechanicsChange(
    key: string,
    result: { value?: string; previous?: string | null },
    actorUserId: string | null,
    source: "admin" | "governance" | "platform",
  ): Promise<void>;
  addActivity(
    kind: string,
    text: string,
    extra?: { actorUserId?: string | null; entityType?: string | null; entityRef?: string | null },
  ): Promise<unknown>;
  checkVoiceSecret(): { ok: boolean; fatal?: boolean; error?: string };
}

/** What the write answered: the status and body the route sends. */
export interface DialWriteAnswer {
  status: number;
  body: Record<string, unknown>;
}

export async function writeDial(
  deps: DialWriteDeps,
  req: express.Request,
  key: string,
  raw: unknown,
): Promise<DialWriteAnswer> {
  const { mayAct, overrideRefusal, authedUser, adminActor, getPool, recordMechanicsChange, addActivity, checkVoiceSecret } = deps;
  /*
   * 0098: `dial.set`, and THE RING BECOMES A FLOOR AS WELL AS A CEILING.
   *
   * `ringOf(def)` says who may govern a dial. The proposal path has always
   * enforced it (server/lib/mechanics.ts, and the mechanics route's "This
   * dial is no longer community-governable"), and this route enforced it
   * nowhere. So the ring was a ceiling on the VILLAGE and never a floor
   * under it: the village could not propose a founder-ring change, and
   * anybody who reached this route could make one silently. That asymmetry
   * is the handover problem written in one function.
   *
   * Now: an actor whose path here is the capability, and not the admin
   * short-circuit, is refused a founder-ring key exactly the way the
   * proposal path refuses it. An admin acting AS an admin keeps the
   * founder ring, because a fork's operator has to be able to set an RPC
   * url and a session length. Once the village holds `dial.set`, an admin
   * falls through and is judged as anybody else, and a founder-ring key is
   * refused to every path here, the break-glass included (measured
   * 2026-09-21); handing `dial.set` back to the panel is what reopens it.
   */
  const verdict = await mayAct(req, "dial.set");
  const def = VARIABLES_BY_KEY[key];
  if (!verdict.ok) {
    // 0103: through `overrideRefusal`, so this route and the eleven the
    // same commit converted write ONE 409 body between them. It used to
    // build its own off `message !== "auth_required"`, which is a copy edit
    // away from being a different permission answer.
    const hatch = overrideRefusal("dial.set", verdict);
    // The ring check below refuses a founder-ring dial to an override too,
    // so no question is offered that would refuse after it was answered.
    if (hatch && def && ringOf(def) !== "open") {
      return { status: 409, body: { ...hatch, overrideAvailable: false, error: FOUNDER_RING_HELD } };
    }
    if (hatch) return { status: 409, body: hatch };
    return { status: 401, body: { error: "auth_required" } };
  }
  if (verdict.source !== "admin") {
    if (def && ringOf(def) !== "open") {
      return {
        status: 403,
        body: {
          error:
            "This dial is not one the village governs. It belongs to whoever runs the deployment, " +
            "and it stays with them.",
        },
      };
    }
  }
  if (raw === undefined || raw === null) return { status: 400, body: { error: "A value is required" } };
  // After the Birthing, what a vote MEANS is the village's, and the one door
  // to it is a governance_mode ballot. This route is how a village is set up,
  // not how it is governed (dispatcher lane).
  if (WEIGHT_KEYS_AFTER_START.has(key) && (await readGameStart(getPool())).started) {
    return { status: 409, body: { error: "The village started its Game, so how a vote is weighed is the village's to decide. Raise it as a proposal." } };
  }
  /*
   * A KNOB THAT CANNOT ACT MUST NOT ACCEPT A VALUE.
   *
   * Two stays variables are shipped policy with no enforcement behind them
   * (V2_PLAN ranks 66, S1+S2) and both are deliberately legal-blocked: the
   * plan says in terms not to write the expiry sweep before Gate F blesses
   * it, because "the default of 0 is what keeps the platform out of
   * escheatment, and building the mechanism creates pressure to use it".
   *
   * That reasoning holds. What does not hold is the form silently accepting
   * "365 days" and leaving an admin believing credits expire when nothing
   * will ever sweep them — a belief they might pass on to members. Until
   * the mechanism exists, the honest answer is to refuse the change and say
   * why, rather than to store a number nobody reads.
   */
  const unenforced: Record<string, string> = {
    "stay.credit_expiry_days":
      "Credits cannot expire yet. Nothing sweeps them, so any value here would be a promise the platform does not keep. " +
      "Expiring member-held value is a legal question (gift-certificate and escheatment rules) that has to be answered before the sweep is written, not after. Leave it at 0.",
    "stay.credits_transferable":
      "Credit transfers between members are not built, and turning this on would not enable them. " +
      "Freely transferable credits also drift toward regulated e-money, which is a decision to take with counsel before the surface exists.",
  };
  const blocked = unenforced[key];
  if (blocked) {
    const v = String(raw).trim().toLowerCase();
    const isOff = v === "0" || v === "false" || v === "";
    if (!isOff) return { status: 409, body: { error: blocked } };
  }

  /*
   * NAMING A HYPHA SPACE IS A PRECONDITION CHECK, NOT JUST A VALUE.
   *
   * `economy.hypha_space` lives in the database and the secret that guards its
   * receiver lives in the process environment, so this one field is the only
   * place where an admin edit can put the deployment into a state its own boot
   * check refuses. Before this branch existed, typing a slug here with a
   * short or borrowed secret meant the next restart threw and kept throwing,
   * with the panel that could undo it served by the process that would not
   * start. The refusal belongs in front of the person who can act on it.
   *
   * An EMPTY secret is not refused here and is not fatal at boot: the receiver
   * answers 503 without one, so the village is unreachable rather than
   * exposed, and a founder should be able to save the slug the moment they
   * have it. The panel says what is still missing.
   */
  if (key === "economy.hypha_space" && String(raw).trim()) {
    const secret = checkVoiceSecret();
    if (!secret.ok && secret.fatal) {
      return { status: 409, body: { error: `${secret.error} Fix the secret on the deployment before naming a space, or the server will refuse to start.` } };
    }
    const slug = String(raw).trim();
    // varchar(120) in `voice_claims`.`hypha_space` (0072). The registry's text
    // validator allows 255, so without this a slug between the two saves
    // cleanly here and then fails the claim INSERT under strict mode, which
    // is a refusal the member meets and the admin never sees.
    if (slug.length > 120) return { status: 400, body: { error: "A Hypha space slug cannot be longer than 120 characters." } };
  }

  const result = await setVariable(getPool(), key, String(raw));
  if (!result.ok) return { status: 400, body: { error: result.error } };
  if (result.previous !== result.value) {
    const actor = (await authedUser(req))?.id ?? adminActor(req)?.id ?? null;
    await recordMechanicsChange(key, result, actor, "admin");
    /*
     * THE VALUE DOES NOT GO IN THE PUBLIC LINE. This used to read
     * `${key} is now ${result.value}`, and `/api/game/pulse` is
     * UNAUTHENTICATED and renders on the home page, so every game variable's
     * value was narrated to visitors. QA found the homepage publishing
     *
     *     tokens.base_rpc_url is now https://base-mainnet.g.alchemy.com/v2/<key>
     *
     * to signed-out readers. A variable's value is admin state; a variable
     * CHANGING is village news. Those are different audiences and this line
     * only ever needed the second.
     *
     * Nothing is lost from the record: recordMechanicsChange above keeps the
     * before and after for the audit trail, behind auth, which is where a
     * value belongs. Redacting by pattern was the other option and it is the
     * weaker one, because it needs a list of what looks secret and a URL with
     * a key in the path defeats most such lists.
     */
    await addActivity("settings", `A game rule changed: ${key}`, { actorUserId: actor, entityType: "variable", entityRef: key });
  }
  return { status: 200, body: result as unknown as Record<string, unknown> };
}
