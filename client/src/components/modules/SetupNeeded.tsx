/**
 * WHAT THIS MODULE IS STILL WAITING FOR, and a link straight to it.
 *
 * Rye, 2026-09-21: "Yes - and whenever this happens have a link to direct
 * people to exactly what they need." Before this, a module that was not ready
 * said so in exactly one place, the library page, and only while the module
 * sat in preview. Everywhere else the product simply went quiet: the Go-live
 * card rendered nothing at all rather than saying why, and the Admin module
 * card never mentioned setup. A village whose calendar was already live, which
 * is most of them, could not have been told anything at all.
 *
 * So this renders wherever readiness is known and at every lifecycle, and it
 * always carries the address rather than a description of it.
 *
 * IT NEVER BLOCKS. `setup: "required"` gates the Go-live card and nothing
 * else: the lifecycle buttons on the module card still take a module public
 * with one press, and the server refuses no transition for readiness. That is
 * the house rule that warnings warn, so this is a sentence and a link, and the
 * founder decides.
 *
 * THEMING. This renders on the library page, which follows the village's
 * theme, as well as inside the fixed-light admin workspace, so it uses amber
 * on a light card rather than the admin gray scale, and no colour literal:
 * `client/src/components/modules/` is outside the admin light-surface zone
 * that scripts/check-tailwind-gray.mjs skips.
 */
import { setupAside, setupHref, setupLinkText } from "@shared/moduleSetupLink";
import type { ModuleReadiness } from "@shared/modules";

export default function SetupNeeded({
  moduleId,
  setup,
  ready,
  lifecycle,
  onOpen,
  className = "",
}: {
  moduleId: string;
  setup: "none" | "optional" | "required";
  /** The readiness answer as /api/admin/modules sends it. Null where setup is none. */
  ready: ModuleReadiness | null | undefined;
  /** What the module is being served as, so an off module gets an honest link. */
  lifecycle: string;
  /**
   * Same-page handler, where there is one. On the Modules tab the card is
   * already on screen, so opening its settings in place beats a reload; the
   * href stays real for a middle click, for copying, and for every other
   * surface, which has nowhere to open in place.
   */
  onOpen?: (target: { moduleId: string; settingKey: string | null }) => void;
  className?: string;
}) {
  if (setup === "none" || !ready || ready.ready) return null;

  const on = lifecycle !== "off";
  const href = setupHref(moduleId, ready.target, { on });
  const aside = setupAside(ready.target, { on });
  const settingKey =
    ready.target?.kind === "setting" ? ready.target.key : ready.target?.kind === "config" ? "config" : null;
  const sameCard = !!onOpen && (ready.target?.kind !== "tab" || !on);

  return (
    <p className={`text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 ${className}`}>
      {/* The hint is a step ("Say which hemisphere this village is in first"),
          so it reads as a sentence with the link after it rather than as a
          label on a button. */}
      {ready.hint}.{" "}
      <a
        href={href}
        className="underline font-medium"
        onClick={
          sameCard
            ? (e) => {
                e.preventDefault();
                onOpen?.({ moduleId, settingKey });
              }
            : undefined
        }
      >
        {setupLinkText(ready.target, { on })}
      </a>
      {aside ? ` ${aside}` : ""}
      {setup === "optional" ? " It can go live without this." : ""}
    </p>
  );
}
