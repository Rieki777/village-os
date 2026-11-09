import { useGameConfig } from "@/lib/gameApi";
import { LanguagePicker, type PickerTone } from "./LanguagePicker";

/**
 * The language selector for a page that renders without the site header
 * (internal spec i18n, US2: "on every page"). The 404, the agent-consent page,
 * change requests and Admin's sign-in gate each draw their own screen, so the
 * header's selector never reached them.
 *
 * In the page's flow, not floating: a fixed corner control would sit over
 * whatever each page puts at its top at 390 px, while a row of its own at the
 * top cannot cover anything. `pickerCoverage.test.ts` checks every routed
 * page reaches a selector.
 */
export function PageLanguageBar({ tone = "onLight", className = "" }: { tone?: PickerTone; className?: string }) {
  const cfg = useGameConfig();
  return (
    <div className={`flex justify-end ${className}`}>
      <LanguagePicker tone={tone} villageDefault={cfg?.defaultLocale ?? null} />
    </div>
  );
}
