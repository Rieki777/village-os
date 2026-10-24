/**
 * "Let AI help me with this" on the words and season steps (role proposals
 * PR C, wired by the role guide).
 *
 * It hosts the role guide's panel (./RoleGuidePanel.tsx), which draws only
 * when a guide can answer, says which one is answering, and offers the other
 * when both can. Every suggestion waits for the member's own "Use this", which
 * puts the words in the field exactly as typing does, so the step's autosave
 * keeps them. The guide never saves or submits.
 *
 * WHICH ROLE. The words step shows one role at a time and draws this button
 * inside that role's section (`data-words-role`), so the panel offers only that
 * role's suggestions. The season step's handler takes the aim, so that is the
 * one season field the panel offers there.
 */
import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import { useVillageName } from "@/hooks/useVillageName";
import type { GuideSuggestion } from "@shared/roleGuide";
import { onBroughtIn, type AiHelpStep } from "./aiHelp";
import RoleGuidePanel from "./RoleGuidePanel";

export default function AiHelpButton({
  step,
  onAccept,
}: {
  step: AiHelpStep;
  /** The words written on this step so far, by field. The guide reads the saved draft, so these are not sent. */
  words?: Record<string, string>;
  /** The member accepted one suggestion: put it in its field. */
  onAccept: (field: string, words: string) => void;
}) {
  const { id = "" } = useParams<{ id: string }>();
  const villageName = useVillageName();
  const here = useRef<HTMLDivElement>(null);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [document, setDocument] = useState<string | null>(null);

  useEffect(() => onBroughtIn(step, setDocument), [step]);
  useEffect(() => {
    setRoleId(here.current?.closest("[data-words-role]")?.getAttribute("data-words-role") ?? null);
  });

  if (!id) return null;
  const accepts = (s: GuideSuggestion) => (step === "season" ? s.field === "aim" : s.roleId === roleId);
  return (
    <div ref={here} data-ai-help={step}>
      <RoleGuidePanel
        proposalId={id}
        step={step}
        villageName={villageName}
        document={document}
        accepts={accepts}
        onAccept={(s) => onAccept(s.field, Array.isArray(s.words) ? s.words.join("\n") : s.words)}
      />
    </div>
  );
}
