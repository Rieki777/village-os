/**
 * THE TWO QUESTIONS THE POWER GROUPS TAB ASKS BEFORE IT CHANGES WHO HOLDS WHAT.
 *
 * Rye, 2026-10-23. The founder removed himself from a power group with one
 * click on the ×, and could not appoint a member who had not reached the
 * group's stage floor, because the panel only ever said no. His words: "send a
 * sibling lane to build a 'are you sure you want to remove' prompt before
 * letting that happen", and for the floor, "instead of not letting me, we
 * should give a warning ... are you sure you want to promote? Or, help them
 * reach this stage first".
 *
 * `RemoveHolderDialog` is the only way the × removes anybody now. It says what
 * the person loses, says it louder when the person is you, and says when the
 * removal would leave a power the village has taken on with nobody holding it.
 * That last fact is the SERVER'S answer (`leftEmptyByRemoval` on
 * `GET /api/admin/capabilities/holding`), never a guess made here, and a
 * server that does not send it shows no warning: nothing is not "nobody".
 *
 * `BelowFloorDialog` opens when the holders route refuses an appointment for
 * the stage floor, so the server decides who is below it and this only asks
 * what to do about it. Promoting goes through the existing stage route and
 * appointing through the existing holders route; the floor itself never moves.
 *
 * The shared Radix dialog, for the reason HandoverTab's HandOverDialog gives:
 * it traps focus, closes on Escape and hands focus back, and nothing is sent
 * until a button inside it is pressed. Fixed light colours, by the admin
 * ruling. Every button is at least 44px tall for a phone.
 */
import { useEffect, useState } from "react";
import type { StageRule } from "@shared/gameConfig";
import type { GameStagePublic } from "@/lib/gameApi";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const CONTENT = "max-w-lg max-h-[90vh] overflow-y-auto bg-white text-gray-900 border-gray-200";
const QUIET = "min-h-11 text-sm rounded-lg px-4 py-2 border border-gray-300 text-gray-700 bg-white";
const LOUD = "min-h-11 text-sm rounded-lg px-4 py-2 font-medium text-white disabled:opacity-40";

/**
 * ARE YOU SURE YOU WANT TO REMOVE THEM.
 *
 * `powers` is the group's capabilities already in plain words. `leftEmpty` is
 * the titles of the village's own powers that this one removal would leave
 * with no holder, exactly as the server counted them.
 */
export function RemoveHolderDialog({
  open,
  memberName,
  groupName,
  powers,
  isSelf,
  leftEmpty,
  busy,
  onKeep,
  onRemove,
}: {
  open: boolean;
  memberName: string;
  groupName: string;
  powers: readonly string[];
  isSelf: boolean;
  leftEmpty: readonly string[];
  busy: boolean;
  onKeep: () => void;
  onRemove: () => void;
}) {
  const one = leftEmpty.length === 1;
  const who = isSelf ? "you are" : `${memberName} is`;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onKeep(); }}>
      <DialogContent className={CONTENT}>
        <DialogHeader>
          <DialogTitle className="text-gray-900 leading-snug">
            Remove {memberName} from {groupName}?
          </DialogTitle>
          <DialogDescription className="text-gray-600">
            {powers.length > 0
              ? `${isSelf ? "You lose" : "They lose"} the power to:`
              : `${groupName} carries no powers, so what ${isSelf ? "you" : "they"} can do stays the same.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-gray-700">
          {powers.length > 0 && (
            <>
              <ul className="list-disc pl-5 space-y-1">
                {powers.map((p) => <li key={p}>{p}</li>)}
              </ul>
              <p>{isSelf ? "You stop" : "They stop"} being able to do it straight away.</p>
            </>
          )}
          {isSelf && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 font-medium">
              You are removing yourself. If nobody else in the village holds these powers, only an
              admin can give them back.
            </p>
          )}
          {leftEmpty.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 space-y-1">
              <p>Nobody else holds {one ? "this power" : "these powers"}, and the village has taken {one ? "it" : "them"} on:</p>
              <ul className="list-disc pl-5">
                {leftEmpty.map((t) => <li key={t}>{t}</li>)}
              </ul>
              <p>
                Once {who} out, nobody can use {one ? "it" : "them"} until someone is appointed to a
                group that carries {one ? "it" : "them"}.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <button type="button" onClick={onKeep} className={QUIET}>
            Keep them
          </button>
          <button type="button" disabled={busy} onClick={onRemove} className={`${LOUD} bg-red-600`}>
            Remove
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * HOW A STAGE IS REACHED, said to the admin about somebody else.
 *
 * Keyed by the union, so a new kind of rung in shared/gameConfig.ts fails the
 * build here instead of rendering an empty line. The member's own ladder
 * (MaturityLadder) says the same facts to the member, in the second person.
 */
type RuleWords = { [K in StageRule["type"]]: (rule: Extract<StageRule, { type: K }>) => string };

const RULE_WORDS: RuleWords = {
  default: () => "Everyone starts here.",
  account: () => "It opens when they create a profile.",
  "training-complete": () => "It opens when they finish the community training.",
  membership: () => "It opens when they sign the membership agreement.",
  quests: (rule) => `It opens at ${rule.min} consented quest${rule.min === 1 ? "" : "s"}.`,
  tokens: () => "It opens once the village has paid them for something they brought it.",
  role: () => "It opens while they hold a role on the org chart.",
  granted: () => "The village grants this one. An admin grants it on the Players tab when they are ready.",
};

export function stageNeeds(rule: StageRule | undefined): string {
  if (!rule) return "";
  return (RULE_WORDS[rule.type] as ((r: StageRule) => string) | undefined)?.(rule) ?? "";
}

/** Where a member goes to do what a rung asks, for the rungs that have a page. */
const RULE_PAGE: Partial<Record<StageRule["type"], { href: string; label: string }>> = {
  "training-complete": { href: "/training", label: "The community training" },
  quests: { href: "/quests", label: "The quest board" },
};

/**
 * THEY HAVE NOT REACHED THIS GROUP'S STAGE: PROMOTE THEM, OR HELP THEM GET THERE.
 *
 * `admits` is true when the floor is at or above the rung that lets somebody
 * into the village, because a stage granted there is an admission as well
 * (`climbLadder`, server/lib/admission.ts), and the admin should know that
 * before pressing the button.
 */
export function BelowFloorDialog({
  open,
  memberName,
  groupName,
  stage,
  stageName,
  currentStageName,
  admits,
  busy,
  onPromote,
  onClose,
}: {
  open: boolean;
  memberName: string;
  groupName: string;
  stage: GameStagePublic | null;
  stageName: string;
  currentStageName: string;
  admits: boolean;
  busy: boolean;
  onPromote: () => void;
  onClose: () => void;
}) {
  const [helping, setHelping] = useState(false);
  useEffect(() => { if (open) setHelping(false); }, [open]);
  const needs = stageNeeds(stage?.rule);
  const page = stage ? RULE_PAGE[stage.rule.type] : undefined;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className={CONTENT}>
        {!helping ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-gray-900 leading-snug">
                {memberName} has not reached the {stageName} stage
              </DialogTitle>
              <DialogDescription className="text-gray-600">
                {groupName} asks for {stageName} or above.
                {currentStageName ? ` ${memberName} is at ${currentStageName} today.` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm text-gray-700">
              <p>
                Are you sure you want to promote them? This raises {memberName} to {stageName} and
                then appoints them, and each step is recorded the way a stage grant and an
                appointment always are.
              </p>
              {admits && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                  A stage granted at {stageName} also lets them into the village as a member.
                </p>
              )}
              <p className="text-gray-500">Or help them reach {stageName} first, and appoint them after.</p>
            </div>
            <DialogFooter>
              <button type="button" onClick={() => setHelping(true)} className={QUIET}>
                Help them reach {stageName} first
              </button>
              <button type="button" disabled={busy} onClick={onPromote} className={`${LOUD} bg-teal-deep`}>
                Promote to {stageName} and appoint
              </button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-gray-900 leading-snug">What {stageName} needs</DialogTitle>
              <DialogDescription className="text-gray-600">
                {stage?.description ? `${stage.description} ` : ""}{needs}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-sm text-gray-700">
              {page && (
                <p>
                  <a href={page.href} className="text-teal-deep underline">{page.label}</a> is where they do it.
                </p>
              )}
              <p>
                {memberName} sees the same ladder, with what opens each stage, on their own profile.
                Their stage today shows on the{" "}
                <a href="/admin?tab=players" className="text-teal-deep underline">Players tab</a>, and
                nobody was appointed.
              </p>
            </div>
            <DialogFooter>
              <button type="button" onClick={() => setHelping(false)} className={QUIET}>
                Back
              </button>
              <button type="button" onClick={onClose} className={`${LOUD} bg-teal-deep`}>
                Done
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
