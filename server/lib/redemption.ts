/**
 * REDEMPTION: a member turns tokens into something real.
 *
 * The founder's shape, in his words: "On platform all we need is a redemption
 * process that destroys currency that is redeemed. Then the off platform
 * redemption is governed by admins/stewards or a vote." And: "a member makes a
 * proposal to redeem X tokens for Y (services, cash, equity, etc something out
 * of the platform); when this redemption is confirmed by a steward or a vote
 * then at confirmation they are destroyed, but this confirmation is only meant
 * to happen after the redemption has occurred off platform."
 *
 * So the village pays first and this software destroys second. That ordering is
 * the requirement and this module keeps it: nothing is destroyed until somebody
 * with the key says the member has been paid.
 *
 * ── WHY PROPOSING HOLDS, WHICH IS THE ONE THING ADDED TO HIS SEQUENCE ──────
 *
 * His sequence leaves a member holding spendable tokens between the day they
 * are paid and the day a steward opens the panel. Wren redeems 500 credits for
 * a bicycle, takes the bicycle on Tuesday, sends 500 credits to Ash on
 * Wednesday, and the Thursday confirmation has two possible endings and both
 * are wrong: `postTransferOn` recomputes Wren's balance inside the transaction
 * and refuses with `insufficient credits: "mem:wren" holds 0 and cannot
 * overdraft`, so the village has bought a bicycle and destroyed nothing; or
 * somebody hands the burn an allow-negative proof, which is a fourth entry in
 * `ALLOW_NEGATIVE_SOURCES` and raises that member's lawful debt floor by the
 * redeemed amount forever, and a negative balance blocks exit resolve, so Wren
 * could then never leave.
 *
 * So proposing HOLDS. Nothing is destroyed before the village has paid, which
 * is his requirement, and nothing can be spent twice, which is the gap.
 *
 * ── THE HOLD IS AN ACCOUNT, NOT A RESERVATION ──────────────────────────────
 *
 * Value held while a decision is pending is moved to a non-faucet account in
 * this codebase three times out of three: `sys:event-escrow` for seats,
 * `sys:library-escrow` for loans, `sys:voice-bridge` for voice claims. Each
 * keeps a row for the claim's state and each carries its own reconciliation
 * function, and this module has all three of those things for the same reasons.
 *
 * The alternative was a reservation somebody reads before spending, and it is
 * refused on evidence. `token_balances` is a CACHE recomputed from
 * `token_ledger` inside every posting's transaction, so a reservation column
 * there is erased by the next recompute. A reservation read at each spend site
 * would have to be read at FOURTEEN of them, and the only optional hook for
 * doing that is `TransferGuard`, which exactly one non-test caller in the
 * repository passes. `server/lib/ledger.ts` already wrote the verdict on rules
 * of that shape: "a rule a call site can follow or skip is a rule with a door
 * next to it".
 *
 * An escrow account binds all fourteen with no edit to any of them, because the
 * tokens are not in the member's account to be found. It also means the exit
 * sweep cannot take them, since `sweepBalances` walks `balancesFor(mem:<user>)`
 * and they are not there.
 *
 * ── REMOVING THE HOLD IS THREE CALL SITES, BY CONSTRUCTION ─────────────────
 *
 * `redemption.holds_on_propose` is a dial, and the confirm path never asks it.
 * It asks the ROW. `held_account` is written at request time and the burn reads
 * its FROM account off that column, so a dial moved while a redemption is open
 * still settles the way it was opened. That is the `ballots` snapshot law
 * (0089 freezes thresholds, electorate and weights at open) applied to one more
 * thing, and it is what makes turning the hold off a change to three lines
 * rather than a rewrite.
 *
 * ── DESTROYING MEANS A SINK, NOT THE TOKEN'S FAUCET ────────────────────────
 *
 * A faucet's negative balance IS that token's issued supply. `spendSinkFor` in
 * server/lib/spending.ts already refuses a faucet burn for `credits` in
 * writing: it "would quietly redefine that faucet's negative balance from
 * released-to-date into outstanding, which several surfaces read". So the burn
 * lands on `sys:redeemed`, which is not a faucet, exactly like `sys:voice-decay`.
 *
 * The consequence, said plainly because a supply figure that hides it is a lie
 * by omission: ISSUED SUPPLY DOES NOT FALL. What falls is what is out there,
 * and the retired total is a balance anybody can read. See `retiredSupply`.
 *
 * ── UNITS ──────────────────────────────────────────────────────────────────
 *
 * MINOR units in the ledger and in `redemptions`.`amount`, human only at the
 * route boundary and in a sentence a person reads, converted once with
 * `fromLedgerUnits` / `toLedgerUnits` at that boundary and nowhere else. Every
 * field and parameter carrying minor units says `Units` in its name.
 *
 * ── NOTHING IN THIS FILE POSTS, AND NOTHING IN IT READS A ROW ──────────────
 *
 * It decides. `server/lib/spending.ts` opens with the same sentence for the
 * same reason: every function here is pure or reads a cached dial, so the state
 * machine and every refusal a member will ever meet can be driven by the suite
 * with no database at all. The rows, the two postings and the reconciliation
 * live in `server/lib/redemptionStore.ts`.
 */
import { tokenDef, type TokenDef } from "./ledger";
import { fromLedgerUnits } from "./economy";
import { MODULE_VOUCHERS, isPriceableToken } from "./spending";
import { stringVar } from "./variables";

/**
 * Tokens held against an open redemption. NOT a faucet, and for 0072's stated
 * reason, which transfers exactly: tokens held against an open request have to
 * have come from somebody, and a faucet here would let a redemption create the
 * tokens it redeems. Seeded by 0183.
 */
export const REDEMPTION_HOLD = "sys:redemption-hold";

/**
 * Where a redeemed token ends. NOT a faucet, and this one is the same argument
 * `sys:voice-decay` carries: a faucet flag here would let the account go
 * negative, and a negative balance would say the retiring account had ISSUED
 * the token. This account only ever receives. Its balance is everything this
 * village has retired to date. Seeded by 0183.
 */
export const REDEEMED = "sys:redeemed";

export const HOLD_SOURCE = "redemption_hold";
export const BURN_SOURCE = "redemption_burn";

/**
 * MODULE VOUCHERS A VILLAGE MAY STILL REDEEM.
 *
 * Rye, 2026-09-04: "Redeeming a stay token also destroys it, have this be the
 * same structure as redeeming currency tokens." So a stay credit joins the
 * currency path, and nothing about that path changes to carry it.
 *
 * A SECOND SET AND NOT AN EDIT TO `MODULE_VOUCHERS`, and the difference is the
 * whole of the care here. That Set is asked three questions in
 * server/lib/spending.ts and this file asks the fourth:
 *
 *   sendRefusal            may a member hand this to another member
 *   mayToggleTransferable  may an admin open that by flipping a row
 *   spendSinkFor           where does a spent one land
 *   redeemableToken        may the village buy this one back and destroy it
 *
 * Only the fourth is ruled on. Taking `stay-credit` OUT of `MODULE_VOUCHERS`
 * would answer all four at once: stay credits would become sendable between
 * members and an admin could flip `transferable`, which is refused at the
 * variables route in writing with a legal reason (e-money). So the voucher
 * firewall stands and this names the one hole the founder opened in it.
 *
 * `library-credit` is deliberately absent. A library credit is a DEPOSIT
 * against a specific shelf, it is locked while an item is out and it comes
 * back when the item does, and no ruling exists on destroying one. Absent, not
 * forgotten.
 *
 * ── CONSUMED IS NOT DESTROYED, AND A STAY CREDIT NOW DOES BOTH ─────────────
 *
 * This is the fact the surfaces must not blur, because it is the one place in
 * the platform where the same token has two endings.
 *
 *   CONSUMED  a night. `postNightsForStay` posts to `spendSinkFor("stay-credit")`,
 *             which IS `sys:mint`, the faucet that issued it. The faucet's
 *             negative balance shrinks, the village may issue that credit
 *             again, and `readCycleIssuance` subtracts the return from the
 *             cycle's issuance for exactly that reason. Nothing is destroyed.
 *   DESTROYED a redemption. `postBurn` posts to `sys:redeemed`, which is not a
 *             faucet and only ever receives. The faucet is untouched, so
 *             issued supply does not fall, and that credit can never be
 *             presented for a night by anybody again.
 *
 * The two are told apart in the ledger by BOTH halves of the posting, so a
 * reader needs neither a convention nor a comment: `stay_night` to `sys:mint`
 * against `redemption_burn` to `sys:redeemed`.
 *
 * WHAT THIS COSTS, NAMED WHERE IT LANDS. server/lib/stays.ts opens by saying
 * "Outstanding credit supply = -balanceOf(sys:mint, 'stay-credit'), for free".
 * That reading is now one term short: a redeemed stay credit has left the
 * member and never reached the faucet, so the faucet still counts it as out
 * there. The honest figure is that minus `retiredSupply`, and
 * `GET /api/admin/tokens` already prints the two side by side and refuses to
 * net them. Any surface that prints outstanding stay credits from the faucet
 * alone overstates by whatever this village has retired.
 */
export const REDEEMABLE_VOUCHERS: ReadonlySet<string> = new Set(["stay-credit"]);

/**
 * CAN THIS BUILD CARRY A REDEMPTION TO A VILLAGE VOTE?
 *
 * `false` until the ballot subject type and its closer ship. A constant and not
 * a dial, because it describes what this BUILD can do and no village should be
 * able to turn it on by typing in an admin panel. `BRIDGE_DISPATCH_BUILT` in
 * server/lib/voiceClaim.ts is the same constant for the same reason, and the
 * reason is the one that matters here too: a village whose dial says "vote"
 * would otherwise take the hold, tell nobody, and leave the member's balance
 * reading short with no event coming to release it.
 *
 * So a village on the vote setting is refused at the door, BEFORE anything is
 * held, with a sentence that says which dial did it. That is a village state
 * and not a fault, and the sentence does not dead end.
 *
 * WHEN THE VOTE PATH SHIPS: flip this to true in the same commit and not
 * before. What it needs is a `redemption` subject type in the ballot engine and
 * a `SUBJECT_CLOSERS` entry, and `ballotBinds` is `hasOwnProperty` on that
 * table, so a redemption ballot without the closer holds a real vote and
 * executes nothing. It also needs the founder's answer on question 5 of the
 * design: a ballot is served to anyone with the link, so the vote path makes
 * every redemption public, permanently, including after a refusal.
 */
export const VOTE_PATH_BUILT = false;

export type RedemptionState = "requested" | "confirmed" | "refused" | "withdrawn" | "expired";

/**
 * Every ending is terminal. Nothing reopens a settled redemption.
 *
 * `canSettleClaim`'s first branch is the one that costs real value and it
 * transfers word for word: a refusal arriving after a confirmation would hand
 * back tokens the member has also already been paid for, off platform, in cash.
 */
const TERMINAL: ReadonlySet<RedemptionState> = new Set<RedemptionState>([
  "confirmed",
  "refused",
  "withdrawn",
  "expired",
]);

/** The four legal moves out of `requested`, and nothing else. Pure. */
export function canSettleRedemption(
  from: RedemptionState,
  to: RedemptionState,
): { ok: boolean; error?: string } {
  if (from === "confirmed") {
    return { ok: false, error: "this redemption is confirmed and the tokens are gone" };
  }
  if (TERMINAL.has(from)) {
    return { ok: false, error: `this redemption is already ${from}` };
  }
  if (to === "requested") {
    return { ok: false, error: "a redemption cannot go back to waiting" };
  }
  if (!TERMINAL.has(to)) {
    return { ok: false, error: `${to} is not somewhere a redemption ends` };
  }
  return { ok: true };
}

/**
 * Does this ending give the tokens back?
 *
 * Releases go through `reverse`, so they inherit every guard the hold passed,
 * carry their own mirror key, refuse to reverse a reversal, and refuse a
 * posting already reversed. A release that posted fresh would inherit none of
 * that and would be a way to make the token it claims to return.
 */
export function redemptionReleases(state: RedemptionState): boolean {
  return state === "refused" || state === "withdrawn" || state === "expired";
}

// ── Which tokens may be redeemed ───────────────────────────────────────────

/**
 * The narrowing dial, as a set. Empty means every token the firewall allows.
 *
 * Read at CALL TIME and never at boot. `loadVariables` runs inside
 * `initStores()`, so anything reading a game variable above that line silently
 * gets the platform default.
 */
export function redemptionTokenAllowlist(): ReadonlySet<string> {
  const raw = String(stringVar("redemption.tokens") ?? "").trim();
  if (!raw) return new Set<string>();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * May this token be redeemed at all?
 *
 * TWO TESTS, AND THE DIAL CAN ONLY EVER NARROW. The firewall is
 * `isPriceableToken` (platform governed, active, not a standing example, kind
 * `credit`) minus `MODULE_VOUCHERS` plus `REDEEMABLE_VOUCHERS`, and no value
 * on `redemption.tokens` can reach past it.
 *
 * That is deliberate and it is the whole answer to two open questions. Equity
 * and voice are governed on Base and mirrored read only here, and
 * `checkLedgerInvariants` refuses BOOT if one ledger row exists for a
 * hypha-governed token, so a redemption row for one of them could never post
 * anyway; the firewall means a village cannot even ask. And the standing ruling
 * that all tokens are buyable, including Voice, collides with
 * `governanceWeights`, which already refuses a purchasable token as the vote
 * weight. Redemption is that guard's mirror image, so shipping Voice
 * redemption would settle that collision as a side effect. It stays out until
 * it is ruled on directly.
 *
 * It is `isPriceableToken` and not `sendRefusal`'s test, and the difference is
 * one flag: a village's choice about member-to-member SENDING is a different
 * question from whether the village will buy tokens back, and conflating them
 * would let a village that locked sending lock redemption without meaning to.
 */
export function redeemableToken(slug: string): boolean {
  if (!isPriceableToken(slug)) return false;
  if (MODULE_VOUCHERS.has(slug) && !REDEEMABLE_VOUCHERS.has(slug)) return false;
  const allow = redemptionTokenAllowlist();
  return allow.size === 0 || allow.has(slug.toLowerCase());
}

/** Every token a member may ask to redeem right now, by slug. */
export function redeemableTokens(all: TokenDef[]): TokenDef[] {
  return all.filter((t) => redeemableToken(t.slug));
}

// ── The refusals, in the member's own words ────────────────────────────────

/**
 * What the member is asking, as facts gathered at the route boundary.
 *
 * Every unit-bearing field says so in its name. `balanceUnits` is what is in
 * their account NOW, which already excludes anything held against an open
 * redemption, because the hold moved it out.
 */
export interface RedeemAsk {
  slug: string;
  amountUnits: number;
  balanceUnits: number;
  heldUnits: number;
  openedThisCycle: number;
  perCycle: number;
  askedFor: string;
  /** The `redemption.confirmed_by` dial, as it stands right now. */
  confirmedBy: string;
  /** Whether this build can carry a redemption to a village vote. */
  votePathBuilt: boolean;
  /** True when this member already has a departure open. */
  exitOpen: boolean;
}

/**
 * Why this member cannot ask for this redemption, in words they read, or null.
 *
 * ORDERED SO THEY HEAR THE NEAREST TRUE THING, which `claimReadiness` states as
 * a rule in its own comment: being told the token cannot be redeemed at all is
 * more useful than being told the amount is wrong, when no amount would have
 * worked. The token firewall comes first, then what the village has decided,
 * then their own numbers.
 *
 * The first four conditions are `sendRefusal`'s own conditions in `sendRefusal`'s
 * own order, deliberately. Registered, platform governed, active, not an
 * example is the firewall every token surface in this codebase asks, and a
 * fifth spelling of it would be a fifth place to get it wrong.
 *
 * A TOP-LEVEL FUNCTION DECLARATION RETURNING LITERALS ONLY. `refusalsFrom` in
 * scripts/generate-economics-doc.mjs finds it by
 * `ts.isFunctionDeclaration(n) && n.name?.text === name` and quotes every
 * `return`, so an arrow constant would make the gate exit 2 (could not check)
 * and a returned variable would make it throw. Sentences carry no trailing
 * period: they are fragments the surface frames.
 */
export function redemptionRefusal(ask: RedeemAsk): string | null {
  const def = tokenDef(ask.slug);
  if (!def) return `"${ask.slug}" is not a token this village issues`;
  if (def.governance !== "platform") {
    return `${def.name} lives on Base and is only read here. What it is worth is settled where it is governed`;
  }
  if (!def.active) return `${def.name} is not in circulation right now`;
  if (def.isExample) return `${def.name} is a standing example. Create your own token first`;
  if (def.kind !== "credit") {
    return def.kind === "recognition"
      ? `${def.name} is recognition, and recognition is a record of what happened. There is nothing in it to redeem`
      : `${def.name} is a record of standing in this village, and standing is not value to be cashed`;
  }
  if (MODULE_VOUCHERS.has(def.slug) && !REDEEMABLE_VOUCHERS.has(def.slug)) {
    return `${def.name} buys one thing from the village, and that thing is what it is worth`;
  }
  if (!redeemableToken(def.slug)) {
    return `${def.name} is not one of the tokens this village redeems. A steward can change that in the village's dials`;
  }
  if (ask.perCycle <= 0) {
    return "This village is not taking redemptions just now. A steward can open them in the village's dials";
  }
  if (ask.confirmedBy === "vote" && !ask.votePathBuilt) {
    return "This village has chosen that redemptions go to a village vote, and that path is still being finished. A steward can move it back to a steward confirming in the village's dials";
  }
  if (ask.exitOpen) {
    return "You have a departure open, and what happens to your balance is being settled there";
  }
  if (ask.openedThisCycle >= ask.perCycle) {
    return `You have opened ${ask.openedThisCycle} redemptions this moon, which is what this village allows. The count starts again at the new moon`;
  }
  if (!Number.isInteger(ask.amountUnits) || ask.amountUnits <= 0) {
    return `Ask for ${def.name} in whole positive amounts`;
  }
  if (ask.amountUnits > ask.balanceUnits) {
    /*
     * HUMAN, and this is the one place in this file that converts.
     *
     * Everything above is minor units, and these two numbers go into a sentence
     * a person reads. Interpolating `ask.balanceUnits` here is invisible at 0
     * decimals and tells a member they hold ten thousand times what they hold
     * the day a village moves to 4, which is the same fork hazard the wallet
     * shipped once already (docs/ECONOMICS.md 10.3).
     */
    const free = fromLedgerUnits(ask.slug, ask.balanceUnits);
    const held = fromLedgerUnits(ask.slug, ask.heldUnits);
    return ask.heldUnits > 0
      ? `You hold ${free} ${def.name} that is free, and ${held} more is already held against a redemption you have open`
      : `You hold ${free} ${def.name}, and that is what there is to redeem`;
  }
  if (!ask.askedFor.trim()) {
    return "Say what you would like these turned into. A steward has to be able to agree to something";
  }
  return null;
}

/**
 * What a confirmer is asking, as facts read off the row and the registry.
 *
 * NO STATE AND NO DESTINATION, and that is deliberate rather than an omission.
 * Whether the ROW may move is `canSettleRedemption`'s question and it is asked
 * first, by the caller; this answers whether this PERSON may decide it and
 * whether they said why. Folding the two together would put a second spelling
 * of every state-machine sentence in this function, and it would also make the
 * sentences unquotable: the economics document's reader resolves literals only,
 * so `return verdict.error ?? "..."` throws there rather than printing.
 */
export interface ConfirmAsk {
  /** The member whose redemption this is. */
  memberUserId: string;
  /** Whoever is pressing the button. */
  actorUserId: string;
  /** False when the token has been retired from the registry since it was asked for. */
  tokenStillReal: boolean;
  /** False when the member has left the village since they asked. */
  memberStillHere: boolean;
  /** The token's display name, for the sentence. */
  tokenName: string;
  /** The reason the confirmer typed. */
  note: string;
}

/**
 * Why this confirmation or refusal cannot happen, in words, or null.
 *
 * EVERY GUARD FROM THE ASK IS RE-RUN HERE, which is 0106's rule and its stated
 * reason: a token can be retired, a member can leave, and a village can change
 * its mind between somebody asking and somebody agreeing.
 *
 * A SELF-CONFIRMATION IS REFUSED FLAT, at any amount, with no dial. Two
 * precedents exist and they differ, so this is a deliberate pick: `canConfirm`
 * refuses a quest self-consent and points at another steward, and the mint
 * co-sign refuses a self-grant flat and re-checks it at the approve door. A
 * redemption is a self-grant in the direction that matters, since a steward
 * confirming their own is destroying their own tokens in exchange for village
 * value they have already taken, so it follows the mint.
 *
 * Same function-declaration and literals-only contract as `redemptionRefusal`.
 * The caller asks `canSettleRedemption` before this, so a row that cannot move
 * is refused with the state machine's own sentence and never with "say why".
 */
export function confirmRefusal(ask: ConfirmAsk): string | null {
  if (ask.actorUserId === ask.memberUserId) {
    return "This is your own redemption. Someone else confirms it";
  }
  if (!ask.tokenStillReal) {
    return `${ask.tokenName} has been retired from the registry since this was asked for`;
  }
  if (!ask.memberStillHere) {
    return "The member who asked for this has left the village";
  }
  if (!ask.note.trim()) {
    return "Say why, in a sentence. A decision with no stated reason is not a record";
  }
  return null;
}

// ── Warnings, which ride and never block ───────────────────────────────────

export interface RedemptionWarning {
  key: string;
  message: string;
}

/**
 * What the confirmer should know before they agree, and none of it stops them.
 *
 * The shape is `exitLeverFindings`', and the reason is `exitLeverProblem`'s:
 * warnings never come back through the refusal, they belong to the person
 * looking. `reciprocalConfirms` is the other precedent and it says why in one
 * line, that two people who genuinely worked together will confirm each other.
 *
 * The first of these is the same finding as the exit levers' withdrawal-window
 * warning, met on a different door, and it is worded so a reader recognises the
 * pair.
 */
export function redemptionWarnings(input: {
  tokenName: string;
  listedForTrade: boolean;
  amountUnits: number;
  totalHeldUnits: number;
  redemptionsThisMoon: number;
}): RedemptionWarning[] {
  const out: RedemptionWarning[] = [];
  if (input.listedForTrade) {
    out.push({
      key: "buy-and-redeem",
      message:
        `${input.tokenName} can be bought with money today. Confirming this turns a purchase into a ` +
        "payout, which is a withdrawal window wearing a redemption. A village may mean exactly this.",
    });
  }
  const share = input.totalHeldUnits > 0 ? Math.round((input.amountUnits / input.totalHeldUnits) * 100) : 0;
  if (share >= 50) {
    out.push({ key: "size", message: `This is ${share}% of everything this member holds.` });
  }
  if (input.redemptionsThisMoon > 1) {
    out.push({
      key: "frequency",
      message: `This member has opened ${input.redemptionsThisMoon} redemptions this moon.`,
    });
  }
  return out;
}
