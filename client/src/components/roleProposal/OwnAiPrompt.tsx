/**
 * "DESIGN MY ROLE WITH MY OWN AI" (Rye, 2026-10-24): the copy-and-paste
 * prompt (shared/roleCardPrompt.ts) with a copy button. It names this
 * village, its circles, next season's goals and the member's card as it
 * stands, so the outside AI starts from what the village knows. Its last
 * reply is a role card, which the member pastes into "Bring in a description
 * of your role".
 */
import { useState } from "react";
import { Copy } from "lucide-react";
import { useVillageName } from "@/hooks/useVillageName";
import { roleCardPrompt } from "@shared/roleCardPrompt";
import { write } from "@shared/roleCardText";
import type { ProposalOut } from "./proposalApi";
import type { OrgView } from "./StepRoles";
import { RC_WORDS } from "./roleCardWords";
import { FOCUS, LEDE, PANEL, SECONDARY } from "./parts";

/** The draft as a card, or null when it holds nothing to start from yet. */
export function knownCardOf(proposal: ProposalOut, village: string): string | null {
  const s = proposal.season;
  const holds = proposal.roles.length + proposal.newRoles.length > 0 || !!s?.aim || (s?.seasonalGoals.length ?? 0) > 0;
  return holds ? write(proposal, { village }) : null;
}

/** The prompt, word for word, for this draft in this village. */
export function promptFor(proposal: ProposalOut, org: OrgView | null | "failed", village: string): string {
  const circles = org && org !== "failed" ? org.circles.filter((c) => !c.isExample && c.status !== "retired").map((c) => c.name) : [];
  return roleCardPrompt({ village, circles, orgGoals: proposal.orgGoals, knownCard: knownCardOf(proposal, village), maxRoles: proposal.limits.maxRoles });
}

/** Copy text to the clipboard, or false when the browser will not. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function OwnAiPrompt({ proposal, org }: { proposal: ProposalOut; org: OrgView | null | "failed" }) {
  const village = useVillageName("This village");
  const [said, setSaid] = useState<string | null>(null);
  const prompt = promptFor(proposal, org, village);
  const copy = async () => setSaid((await copyText(prompt)) ? RC_WORDS.copied : RC_WORDS.copyFailed);
  return (
    <details className={`${PANEL} grid gap-3`} data-own-ai="">
      <summary className={`flex min-h-[44px] cursor-pointer items-center font-display text-lg font-bold text-stone-900 ${FOCUS}`}>{RC_WORDS.ownAi}</summary>
      <div className="mt-2 grid gap-3">
        <p className={LEDE}>{RC_WORDS.ownAiLede}</p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void copy()} className={SECONDARY} data-copy-prompt="">
            <Copy className="h-4 w-4" aria-hidden="true" />
            {RC_WORDS.copyPrompt}
          </button>
          <span role="status" aria-live="polite" className="text-sm text-stone-700">
            {said}
          </span>
        </div>
        <details>
          <summary className={`inline-flex min-h-[44px] cursor-pointer items-center text-sm font-medium text-stone-700 ${FOCUS}`}>{RC_WORDS.readPrompt}</summary>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-800" data-prompt-text="">
            {prompt}
          </pre>
        </details>
      </div>
    </details>
  );
}
