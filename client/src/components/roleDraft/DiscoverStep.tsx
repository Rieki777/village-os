/**
 * THE BOARD'S FIRST STEP (role journey, lane L3): two doors side by side, the
 * R-Ikigai and the characters (the host passes its characters section in as
 * children, unchanged), then the optional Human Design or Gene Keys step. Every
 * optional part can be skipped; the board works without any of them.
 *
 * The R-Ikigai answers are kept in this browser under IKIGAI_KEY, beside the
 * draft, and re-read through `ikigaiFromStored` so a hand-edited value is
 * capped and cleaned. The Human Design step loads as its own chunk when opened.
 */
import { ChevronDown } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePageContent } from "@/hooks/usePageContent";
import { readStoredJson, writeStoredJson } from "@/lib/safeStorage";
import { CO_CREATORS_GUIDE_PAGE } from "@shared/pageContent/coCreatorsGuide";
import { DISCOVER_WORDS, IKIGAI_ASK_DEFAULTS, IKIGAI_IDS, IKIGAI_KEY, ikigaiFromStored, type IkigaiId, type IkigaiState } from "@shared/roleDiscover";
import type { DraftRole } from "@shared/roleDraft";
import IkigaiDoor from "./IkigaiDoor";
import { BTN_SECONDARY } from "@/components/journey/look";


// Its own chunk: the sky calculation is large and most visitors never open it.
const HumanDesignStep = lazy(() => import("./HumanDesignStep"));

export default function DiscoverStep({
  cast,
  chars,
  onToggleChar,
  roles,
  onDraft,
  children,
}: {
  cast: ReadonlyArray<{ key: string; name: string }>;
  chars: readonly string[];
  onToggleChar: (key: string) => void;
  roles: readonly DraftRole[];
  onDraft: (roleId: string) => void;
  /** The characters door. */
  children: ReactNode;
}) {
  const { t } = useLingui();
  const [state, setState] = useState<IkigaiState>(() => {
    const read = readStoredJson("local", IKIGAI_KEY);
    return ikigaiFromStored(read.status === "value" ? read.value : null);
  });
  const [blocked, setBlocked] = useState(false);
  const [opened, setOpened] = useState(false);
  const page = usePageContent(CO_CREATORS_GUIDE_PAGE);

  useEffect(() => {
    setBlocked(writeStoredJson("local", IKIGAI_KEY, state).status !== "saved");
  }, [state]);

  // The village's own questions when it wrote them, the neutral ones otherwise.
  const asks = useMemo(() => {
    const rows = page?.ikigai?.lists?.circles ?? [];
    return Object.fromEntries(
      IKIGAI_IDS.map((id, i) => {
        const own = typeof rows[i]?.ask === "string" ? rows[i].ask.trim() : "";
        return [id, own || IKIGAI_ASK_DEFAULTS[id]];
      }),
    ) as Record<IkigaiId, string>;
  }, [page]);

  return (
    <div className="mt-8">
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <IkigaiDoor asks={asks} state={state} onChange={setState} roles={roles} onDraft={onDraft} saveBlocked={blocked} />
        <div>{children}</div>
      </div>
      <div className="mt-6 rounded-2xl border border-dashed border-border p-4">
        <button
          type="button"
          aria-expanded={opened}
          onClick={() => setOpened((o) => !o)}
          className={BTN_SECONDARY}
        >
          {DISCOVER_WORDS.optionalDoor}
          <ChevronDown className={`size-4 transition-transform ${opened ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        <p className="text-sm text-muted-foreground">{t`Optional. You can skip it.`}</p>
        {opened && (
          <Suspense fallback={<p className="mt-3 text-sm text-muted-foreground">{t({ message: "Loading…", context: "role draft discover" })}</p>}>
            <HumanDesignStep cast={cast} chars={chars} onToggle={onToggleChar} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
