/**
 * A ROLE HOLDER'S SEAL, for any surface that shows who holds a role (the map's
 * seat card and phone sheet first; the map lane mounts it, this lane owns the
 * data and the privacy rule).
 *
 * Give it the holder's user id and the name the surface already shows. It draws
 * the Gene Keys seal ("3/5"): hover or focus says the two line words, a tap
 * opens the lines card with the link to genekeys.com. It draws NOTHING while
 * the module is off, or when the person skipped Gene Keys or hides their lines:
 * the server filters on that (`GET /api/gene-keys/people`), and absent reads
 * the same as never done, so nothing hints at a hidden result.
 *
 * Every holder on a page joins one batched read (shownLines.ts).
 */
import { useEffect, useState } from "react";
import type { GeneKeysView } from "@shared/geneKeys";
import { useModuleOn } from "@/modules/ModuleProvider";
import GeneKeysSeal from "./GeneKeysSeal";
import { shownLinesOf } from "./shownLines";

export default function HolderGeneKeys({ userId, name, size = 32 }: { userId: string | null | undefined; name: string; size?: number }) {
  const on = useModuleOn("gene-keys");
  const [view, setView] = useState<GeneKeysView | null>(null);

  useEffect(() => {
    if (!on || !userId) return;
    let live = true;
    shownLinesOf([userId]).then((got) => live && setView(got[userId] ?? null));
    return () => {
      live = false;
    };
  }, [on, userId]);

  if (!on || !view) return null;
  const firstName = name.trim().split(/\s+/)[0] || name;
  return (
    <span className="relative inline-block shrink-0 align-middle" style={{ width: size, height: size }}>
      <GeneKeysSeal view={view} whose={firstName} className="absolute inset-0" />
    </span>
  );
}
