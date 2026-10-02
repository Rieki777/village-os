/**
 * A ROLE WITH POWERS, AS A CARD: the face the proposal wizard previews.
 *
 * A permission role (`/api/roles`) is the kind a vote seats somebody into. It
 * has no aim and no domain; what it has is real, and this face prints only
 * that: what it does, its places and who sits in them, the powers it carries
 * (named by `CAPABILITY_LABELS`, never by their keys), and the rung it asks
 * for, which the vote enforces when it opens and again when it closes. Every
 * word comes from `permissionSheet()` in shared/permissionSheet.ts.
 *
 * Single-sided at every width: the same foil and night ground as the seat
 * card, no turn and no columns, because a wizard rail is 22rem and a reader
 * there wants the whole role at once. The figures are two by two under a
 * 420px container (four up overflowed a 288px rail by 6px) and four up above.
 *
 * The host reads the village's stages and its word for a role and passes them
 * in, so this file, like the seat card, imports nothing from `@/lib/gameApi`.
 */
import { useId } from "react";
import { KeyRound } from "lucide-react";
import { SHEET_WORDS } from "@shared/roleSheet";
import { permissionSheet, type RoleInput } from "@shared/permissionSheet";
import { ExampleChip } from "@/components/ExamplesBanner";
import Figure from "@/components/sheet/Figure";
import LadderChip from "@/components/sheet/LadderChip";
import SeatRoster, { SHEET_HEADING } from "./SeatRoster";

export default function PermissionRoleCard({
  input,
  ctx,
  className = "",
}: {
  input: RoleInput;
  ctx: { stages: Array<{ id: string; name: string }> | null; roleWord: string; now: Date };
  className?: string;
}) {
  const view = permissionSheet(input, ctx);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const nameId = `${uid}-name`;

  return (
    // The container is the wrapper, so a 420px host measures 420 and not the
    // 416 left inside the foil.
    <div className="@container w-full">
      <article
        aria-labelledby={nameId}
        className={`sheet-night seat-card-foil relative w-full rounded-[20px] p-[2px] text-card-foreground ${className}`}
      >
        <div className="relative flex flex-col gap-3.5 rounded-[18px] bg-[radial-gradient(130%_55%_at_50%_0%,var(--muted)_0%,var(--card)_62%)] p-2.5 after:pointer-events-none after:absolute after:inset-[5px] after:rounded-[14px] after:border after:border-notice/25">
          <div className="relative z-[1] flex items-center gap-3 px-1 pt-1">
            <span
              aria-hidden="true"
              className="grid size-14 shrink-0 place-items-center rounded-full bg-muted ring-1 ring-notice/60"
            >
              <KeyRound className="size-6 text-notice" />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">{view.eyebrow}</p>
              <h3 id={nameId} className="break-words font-display text-[24px] leading-tight text-foreground">
                {view.name}
                {view.isExample && <ExampleChip tone="night" className="ml-2 align-middle" />}
              </h3>
            </div>
          </div>

          <div className="relative z-[1] flex flex-col gap-1.5 px-1">
            <h4 className={SHEET_HEADING}>{SHEET_WORDS.whatItDoes}</h4>
            <p className={view.whatItDoesWritten ? "text-[13.5px] leading-relaxed text-foreground" : "text-[13px] text-muted-foreground"}>
              {view.whatItDoes}
            </p>
          </div>

          <dl
            aria-label={SHEET_WORDS.figuresName}
            className="relative z-[1] grid grid-cols-2 gap-y-3 border-y border-border/55 py-2.5 [&>div:nth-child(3)]:border-l-0 [&>div:nth-child(3)]:pl-1 @min-[420px]:grid-cols-4 @min-[420px]:[&>div:nth-child(3)]:border-l @min-[420px]:[&>div:nth-child(3)]:pl-2"
          >
            {/* Two by two, the third figure starts a row and draws no divider. */}
          {view.figures.map((f) => (
              <Figure key={f.key} layout="seat" face="body" value={String(f.value)} label={f.label} tone={f.tone} />
            ))}
          </dl>

          <div className="relative z-[1]">
            <SeatRoster spots={view.spots} moreOpenLine={view.moreOpenLine} rosterNote={view.rosterNote} />
          </div>

          {view.powers.length > 0 && (
            <div className="relative z-[1] flex flex-col gap-1.5 px-1">
              <h4 className={SHEET_HEADING}>{SHEET_WORDS.powersHeading}</h4>
              <ul className="grid gap-1.5">
                {view.powers.map((p, i) => (
                  <li
                    key={`${i}-${p}`}
                    className="flex items-start gap-2.5 rounded-xl border border-border bg-muted px-3 py-2 text-[13px] leading-snug text-foreground"
                  >
                    <KeyRound className="mt-0.5 size-4 shrink-0 text-notice" aria-hidden="true" />
                    <span className="min-w-0">{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="relative z-[1] flex flex-col gap-1.5 px-1 pb-1">
            <h4 className={SHEET_HEADING}>{SHEET_WORDS.rungHeading}</h4>
            {view.rungs && (
              <ol className="mt-0.5 flex flex-wrap gap-1.5">
                {view.rungs.map((r) => (
                  <li key={r.id}>
                    <LadderChip look={r.look} label={r.name} srWords={r.srWords} current={r.current} />
                  </li>
                ))}
              </ol>
            )}
            <p className="text-[12.5px] text-muted-foreground">{view.rungLine}</p>
          </div>
        </div>
      </article>
    </div>
  );
}
