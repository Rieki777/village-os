/**
 * WHAT A MODULE'S PAGE OFFERS ABOUT TURNING IT ON, decided in one place.
 *
 * This replaced the advisory ask door (`askDoor.ts`, `ModuleAskDoor.tsx`,
 * `ModuleAsk.tsx`), which opened an ADVISORY vote whose own document said
 * closing it changed nothing, because in 2026-09 no vote in this repository
 * touched a module's lifecycle. Rye's ruling of 2026-10-09 changed that fact:
 * after launch, turning a module on is a holder's act or a binding village
 * vote (a `module_lifecycle` change set). A door that asks the village a
 * question with no effect, beside a door that asks it the same question with
 * one, would split the village's answer. So the advisory door is gone and the
 * binding one took its place. What it kept:
 *
 *   THE DEDUPE. A second ask about one switch spends the village's attention
 *   twice and splits the answer, so a proposal still open for this module is
 *   shown INSTEAD of a new one ("A vote to turn this on closes Friday"). The
 *   server refuses the duplicate as well (`openModuleProposal` in
 *   server/lib/mechanics.ts), so a stale page cannot open a second one.
 *
 *   THE QUIET CASES. A core module, one already on, a withdrawn one and a
 *   signed-out reader offer nothing, and a page still loading offers nothing
 *   rather than guessing.
 *
 * Before launch a member is told, once, that the people who run the village
 * are choosing what it starts with: the plan's table for that row is "browse,
 * plus the state pill", and the founders decide directly.
 *
 * The old `/propose?module=<id>` address still arrives somewhere useful:
 * `askedModuleId` reads it and the Propose page sends the reader here.
 */
import type { LibraryViewer } from "@shared/moduleSwitch";
import type { OpenProposal } from "./catalog";

export interface DoorModule {
  id: string;
  core: boolean;
  on?: boolean;
  lifecycle?: string;
  withdrawn: { since: string } | null;
}

export type SwitchDoor =
  | { kind: "quiet"; why: "core" | "already-on" | "withdrawn" | "signed-out" | "loading" }
  /** Before launch, a member: the founders are choosing. */
  | { kind: "founders-choose" }
  /** Somebody already asked, and it is still running. */
  | { kind: "running"; proposal: OpenProposal }
  /** Turn it on directly, or propose it: `TurnOnAction` decides which from the viewer. */
  | { kind: "turn-on" };

const isOn = (m: DoorModule) => !!m.on || (!!m.lifecycle && m.lifecycle !== "off" && m.lifecycle !== "preview");

export function switchDoor(input: {
  module: DoorModule;
  viewer: LibraryViewer | null;
  /** Null while the history read is in flight; undefined proposal means none. */
  openProposal: OpenProposal | null | undefined;
}): SwitchDoor {
  const { module: m, viewer, openProposal } = input;
  if (m.core) return { kind: "quiet", why: "core" };
  if (!viewer) return { kind: "quiet", why: "loading" };
  if (viewer.mode === "visitor") return { kind: "quiet", why: "signed-out" };
  if (isOn(m)) return { kind: "quiet", why: "already-on" };
  if (m.withdrawn && (m.lifecycle ?? "off") === "off") return { kind: "quiet", why: "withdrawn" };
  if (viewer.canSwitch) return { kind: "turn-on" };
  if (!viewer.launched) return { kind: "founders-choose" };
  if (openProposal === null) return { kind: "quiet", why: "loading" };
  if (openProposal) return { kind: "running", proposal: openProposal };
  return { kind: "turn-on" };
}

/**
 * The one line a running proposal shows: when its vote closes, or that it is
 * still gathering support before it goes to a vote.
 */
export function runningLine(p: OpenProposal, now: Date = new Date()): string {
  if (p.closesAt && p.status === "onsite_vote") {
    const closes = new Date(p.closesAt);
    const days = (closes.getTime() - now.getTime()) / 86_400_000;
    const when =
      days >= 0 && days < 6
        ? closes.toLocaleDateString("en", { weekday: "long" })
        : closes.toLocaleDateString("en", { month: "long", day: "numeric" });
    return `A vote to turn this on closes ${when}.`;
  }
  if (p.status === "draft") return "Somebody proposed turning this on, and it is waiting for a sponsor.";
  if (p.status === "open") return "Somebody proposed turning this on, and it is gathering support before the vote.";
  return "The village voted to turn this on, and it comes on when the vote lands.";
}

/**
 * The module id an old `/propose?module=<id>` link asks about, or null.
 * Kept from the advisory door so links already sent still land.
 */
export function askedModuleId(search: string): string | null {
  const id = new URLSearchParams(search).get("module");
  return id && id.trim() ? id.trim() : null;
}
