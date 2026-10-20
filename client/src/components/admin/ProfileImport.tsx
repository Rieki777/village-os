/**
 * "Start from your ReGen Civics profile": the screen that reads a project's
 * file and shows a founder everything it would set before any of it is set.
 *
 * ── NOTHING GOES LIVE WITHOUT THE REVIEW ─────────────────────────────────
 *
 * Reading the file writes nothing. The preview lists every part in plain
 * words, each with its own tick, and only "Load what you kept" sends anything.
 * Even then the org chart changes only when the founder publishes the draft
 * this screen makes, from this screen, after reading it line by line; and a
 * published draft reverts whole. Identity, the purpose statement, the
 * covenant and the quests are never saved here at all: each goes into its own
 * editor, unsaved, for the founder to read and press that editor's Save.
 *
 * The rules for what each part becomes live in shared/regenImport.ts and the
 * calls in ./profileImportRun.ts. This file is the screen.
 *
 * ── EVERY COMPONENT IS AT MODULE SCOPE ───────────────────────────────────
 *
 * A component declared inside another's body is a new component type on every
 * render, and React rebuilds the subtree each keystroke (SetupSection.tsx has
 * the full account). The paste box is the input here that has to survive.
 *
 * Loaded lazily by ./ProfileImportDoor.tsx, so a founder who never opens it
 * never downloads it.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { readRegenFile, type DecisionStatus } from "@shared/regenFile";
import {
  decidesByLabel,
  defaultChoices,
  draftChangesFor,
  planImport,
  restableOldCircles,
  scopeBodyFor,
  statusOf,
  type IdentityPrefill,
  type ImportChoices,
  type ImportPlan,
  type OldCirclesChoice,
} from "@shared/regenImport";
import { keepFile, keptFileText, offerPrefill } from "@/lib/profilePrefill";
import {
  loadKept,
  openImportDrafts,
  previewOf,
  publishAndFinish,
  readLive,
  revertImportDraft,
  withdrawImportDraft,
  type DraftPreview,
  type StepResult,
} from "./profileImportRun";

const BOX = "rounded-xl border border-gray-200 bg-white p-4";
const PRIMARY =
  "px-4 py-2 rounded-lg text-sm font-medium bg-teal-deep text-white min-h-[44px] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-teal-deep";
const QUIET =
  "px-3 py-2 rounded-lg text-sm font-medium border border-gray-300 bg-white text-gray-800 min-h-[44px] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-teal-deep";
const HINT = "text-xs text-gray-600";

const STATUS_WORDS: Record<DecisionStatus, string> = {
  yours: "Your stewards' answer",
  suggested: "Suggested, not confirmed",
  default: "Village OS's default",
  open: "Not answered yet",
};

/* -------------------------------------------------------------------------- *
 * Module-scope pieces.
 * -------------------------------------------------------------------------- */

function StatusChip({ status }: { status: DecisionStatus | null }) {
  if (!status) return null;
  const tone = status === "yours" ? "border-emerald-300 text-emerald-800" : "border-amber-300 text-amber-800";
  return <span className={`text-[11px] font-medium rounded-full border px-2 py-0.5 ${tone}`}>{STATUS_WORDS[status]}</span>;
}

/** One part of the file: its tick, its title, and what it would set. */
function Part({
  id,
  title,
  status,
  checked,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  status?: DecisionStatus | null;
  checked?: boolean;
  onToggle?: (on: boolean) => void;
  children: ReactNode;
}) {
  return (
    <section className={`${BOX} mb-3`} aria-labelledby={`${id}-title`}>
      <div className="flex items-start justify-between gap-3">
        <label className="flex items-start gap-2 cursor-pointer">
          {onToggle ? (
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-teal-deep"
              checked={!!checked}
              onChange={(e) => onToggle(e.target.checked)}
              aria-describedby={`${id}-body`}
            />
          ) : null}
          <span id={`${id}-title`} className="font-semibold text-gray-900">{title}</span>
        </label>
        <StatusChip status={status ?? null} />
      </div>
      <div id={`${id}-body`} className={`mt-2 text-sm text-gray-800 ${onToggle && !checked ? "opacity-60" : ""}`}>
        {children}
      </div>
    </section>
  );
}

function Lines({ lines }: { lines: readonly string[] }) {
  if (!lines.length) return null;
  return (
    <ul className="list-disc pl-5 space-y-1">
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  );
}

function Steps({ steps }: { steps: readonly StepResult[] }) {
  if (!steps.length) return null;
  return (
    <ul className="space-y-1 text-sm" role="status">
      {steps.map((s, i) => (
        <li key={i} className={s.ok ? "text-gray-800" : "text-red-700"}>
          <span className="font-medium">{s.ok ? "Done" : "Refused"}: {s.label}.</span> {s.message}
        </li>
      ))}
    </ul>
  );
}

function PasteBox({
  text,
  busy,
  onText,
  onRead,
}: {
  text: string;
  busy: boolean;
  onText: (t: string) => void;
  onRead: (t: string) => void;
}) {
  return (
    <div className={BOX}>
      <label htmlFor="regen-file-text" className="block text-sm font-medium text-gray-900 mb-1">
        Paste the file from your ReGen Civics profile
      </label>
      <p className={`${HINT} mb-2`}>
        The Week 4 card from the board's "Copy for Village OS", or the Village OS 1.0 file from your
        profile. Reading it changes nothing here.
      </p>
      <textarea
        id="regen-file-text"
        value={text}
        onChange={(e) => onText(e.target.value)}
        rows={6}
        spellCheck={false}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-mono text-gray-900"
        placeholder='{ "schema": "regen-civics/village@1", ... }'
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" className={PRIMARY} disabled={busy || !text.trim()} onClick={() => onRead(text)}>
          {busy ? "Reading..." : "Read the file"}
        </button>
        <label className={`${QUIET} cursor-pointer inline-flex items-center`}>
          Or choose the file
          <input
            type="file"
            accept=".json,application/json,text/plain"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const body = await f.text();
              onText(body);
              onRead(body);
            }}
          />
        </label>
      </div>
    </div>
  );
}

function SeatRow({ seat, kept, onToggle }: { seat: ImportPlan["seats"][number]; kept: boolean; onToggle: (on: boolean) => void }) {
  if (seat.leftOut) return <li className="text-amber-800">{seat.leftOut}</li>;
  return (
    <li className="border-t border-gray-100 pt-2">
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-teal-deep" checked={kept} onChange={(e) => onToggle(e.target.checked)} />
        <span className="font-medium text-gray-900">{seat.name}</span>
      </label>
      <div className={`pl-6 ${kept ? "" : "opacity-60"}`}>
        <Lines lines={seat.lines} />
      </div>
    </li>
  );
}

function DecidesRow({
  circle,
  pick,
  onPick,
}: {
  circle: ImportPlan["circles"][number];
  pick: { by: string; gloss: string | null } | null;
  onPick: (p: { by: string; gloss: string | null } | null) => void;
}) {
  const options = circle.choices.length ? circle.choices : circle.decides ? [circle.decides] : [];
  if (!options.length) return null;
  const name = `decides-${circle.key}`;
  return (
    <fieldset className="border-t border-gray-100 pt-2">
      <legend className="text-sm font-medium text-gray-900">How {circle.name} decides</legend>
      {circle.choices.length ? <p className={HINT}>Your cards name more than one way. Pick the one this circle keeps.</p> : null}
      {circle.liveDecidesBy ? <p className={HINT}>It decides by {decidesByLabel(circle.liveDecidesBy, circle.liveDecidesByGloss)} today.</p> : null}
      <div className="mt-1 space-y-1">
        {options.map((o, i) => (
          <label key={i} className="flex items-center gap-2 text-sm">
            <input type="radio" name={name} checked={!!pick && pick.by === o.by && pick.gloss === o.gloss} onChange={() => onPick(o)} />
            {decidesByLabel(o.by, o.gloss)}
          </label>
        ))}
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name={name} checked={!pick} onChange={() => onPick(null)} />
          {circle.liveDecidesBy ? "Keep the way it decides today" : "Leave it to the village's way for now"}
        </label>
      </div>
    </fieldset>
  );
}

function Preview({
  plan,
  choices,
  onChoices,
}: {
  plan: ImportPlan;
  choices: ImportChoices;
  onChoices: (c: ImportChoices) => void;
}) {
  const set = (patch: Partial<ImportChoices>) => onChoices({ ...choices, ...patch });
  const p = plan.profile;
  const createsCircles = plan.circles.some((c) => !c.reused);
  const restable = restableOldCircles(plan);
  return (
    <div>
      <div className={`${BOX} mb-3`}>
        <p className="text-sm text-gray-900">
          <span className="font-semibold">{p.from.project ?? "A project"}</span>
          {p.kind === "village" ? ", its Village OS 1.0 file" : ", its Week 4 card"}
          {p.from.weeks.length ? `, from weeks ${p.from.weeks.join(", ")}` : ""}.
        </p>
        <p className={`${HINT} mt-1`}>
          Read every part. Untick what you do not want. Nothing is set until you press Load at the bottom, and
          your org chart changes only when you publish the draft it makes.
        </p>
        {plan.leftOut.length ? (
          <div className="mt-2">
            <p className="text-sm font-medium text-amber-800">Left out of this file, and why</p>
            <Lines lines={plan.leftOut} />
          </div>
        ) : null}
      </div>

      {plan.needs.length ? (
        <Part id="rc-needs" title="The human needs your village is here to meet" status={statusOf(p, "needs.scope")} checked={choices.needs} onToggle={(on) => set({ needs: on })}>
          <Lines lines={plan.needs.map((n) => n.line)} />
          <p className={`${HINT} mt-2`}>Saved on What this village is for. Nothing you have already taken on is taken off.</p>
        </Part>
      ) : null}

      {plan.ownNeeds.length ? (
        <Part id="rc-own" title="Needs you named in Week 3 and have not taken on">
          <ul className="space-y-1">
            {plan.ownNeeds.map((n) => (
              <li key={n.needKey}>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-teal-deep"
                    checked={choices.ownNeeds.includes(n.needKey)}
                    onChange={(e) =>
                      set({ ownNeeds: e.target.checked ? [...choices.ownNeeds, n.needKey] : choices.ownNeeds.filter((k) => k !== n.needKey) })
                    }
                  />
                  {n.line}
                </label>
              </li>
            ))}
          </ul>
          <p className={`${HINT} mt-2`}>Each one waits for your own tick.</p>
        </Part>
      ) : null}

      {plan.totality ? (
        <Part id="rc-whole" title="How much of its people's needs your village means to meet" checked={choices.totality} onToggle={(on) => set({ totality: on })}>
          <p>{plan.totality.line}</p>
        </Part>
      ) : null}

      {plan.circles.length || plan.seats.length ? (
        <Part
          id="rc-structure"
          title="Your circles and seats, as one draft"
          status={statusOf(p, "seats.cards") ?? statusOf(p, "circles.list")}
          checked={choices.structure}
          onToggle={(on) => set({ structure: on })}
        >
          <p className="font-medium text-gray-900">Circles</p>
          <Lines lines={plan.circles.map((c) => (c.reused ? `${c.name}: your village has this circle already, and its seats go into it.` : `${c.name}: a new circle.`))} />
          <p className="font-medium text-gray-900 mt-3">Seats</p>
          <ul className="space-y-2 mt-1">
            {plan.seats.map((s) => (
              <SeatRow
                key={s.key}
                seat={s}
                kept={choices.seats.includes(s.key)}
                onToggle={(on) => set({ seats: on ? [...choices.seats, s.key] : choices.seats.filter((k) => k !== s.key) })}
              />
            ))}
          </ul>
          <div className="mt-3 space-y-2">
            {plan.circles.map((c) => (
              <DecidesRow key={c.key} circle={c} pick={choices.decides[c.key] ?? null} onPick={(pick) => set({ decides: { ...choices.decides, [c.key]: pick } })} />
            ))}
          </div>
          {plan.unseatedLinks.length ? (
            <div className="mt-3">
              <p className="font-medium text-gray-900">Circles that meet a need no seat carries yet</p>
              <Lines lines={plan.unseatedLinks} />
            </div>
          ) : null}
          <p className={`${HINT} mt-2`}>
            How each circle decides is declared once the circle exists: after the draft is published, or straight away for a circle you have already.
          </p>
        </Part>
      ) : null}

      {plan.seats.some((s) => s.holder && !s.holderAlready) ? (
        <Part id="rc-holders" title="Who holds the seats" checked={choices.holders && !plan.holdersWait} onToggle={plan.holdersWait ? undefined : (on) => set({ holders: on })}>
          {plan.holdersWait ? <p className="text-amber-800">{plan.holdersWait}</p> : null}
          <Lines lines={plan.seats.filter((s) => s.holder && !s.holderAlready).map((s) => `${s.holder} in ${s.name}`)} />
          <p className={`${HINT} mt-2`}>
            Each is written down as a name. When that person has an account, they claim the seat from their profile.
          </p>
        </Part>
      ) : null}

      {choices.structure && createsCircles && plan.oldCircles.length ? (
        <Part id="rc-old" title="The circles this village started with">
          <p>A village built from your file starts with your circles. These are the ones it has now that your file does not name.</p>
          <Lines lines={plan.oldCircles.map((c) => (c.seats ? `${c.name}: ${c.seats} seat${c.seats === 1 ? " sits" : "s sit"} in it, so it can only be marked forming.` : c.name))} />
          <fieldset className="mt-2 space-y-1">
            <legend className="sr-only">What happens to them</legend>
            {(
              [
                ["rest", `Rest them, as part of the draft${restable.length < plan.oldCircles.length ? " (the ones nobody sits in)" : ""}. Reverting the draft brings them back.`],
                ["forming", "Mark them forming, once the draft is published."],
                ["keep", "Keep them as they are."],
              ] as [OldCirclesChoice, string][]
            ).map(([value, words]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input type="radio" name="rc-old" checked={choices.oldCircles === value} onChange={() => set({ oldCircles: value })} />
                {words}
              </label>
            ))}
          </fieldset>
        </Part>
      ) : null}

      {plan.seats.some((s) => s.needLinks.length) ? (
        <Part id="rc-links" title="Which human needs each seat meets" checked={choices.links} onToggle={(on) => set({ links: on })}>
          <p>Each seat is tagged with its own needs once the seat exists, and only with needs your village has taken on.</p>
        </Part>
      ) : null}

    </div>
  );
}

/**
 * What this screen never writes: words for their own editors, the modules to
 * turn on by hand, and everything else the file says. Shown before the load
 * and after it, because a founder reaches for the Identity boxes or the
 * purpose box once the draft is published as often as before.
 */
function Handover({
  plan,
  onOpenTab,
  onIdentity,
}: {
  plan: ImportPlan;
  onOpenTab: (tab: string) => void;
  onIdentity?: (p: IdentityPrefill) => void;
}) {
  const [handed, setHanded] = useState<Record<string, boolean>>({});
  // The checklist's ticks: for the founder while they work, saved nowhere.
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const p = plan.profile;
  const prefill = plan.prefill;
  const hand = (key: string, fn: () => void) => {
    fn();
    setHanded((h) => ({ ...h, [key]: true }));
  };
  return (
    <div>
      {prefill.identity || prefill.purpose || prefill.covenant || prefill.tokenName || prefill.exitPolicy || prefill.quests.length ? (
        <Part id="rc-prefill" title="Words to put in their own editors">
          <p className="mb-2">Each button puts the words in the editor that saves them. Nothing is saved until you press Save there.</p>
          <div className="space-y-3">
            {plan.prefill.identity ? (
              <div>
                <p className="font-medium text-gray-900">Identity <StatusChip status={statusOf(p, "identity.name")} /></p>
                <Lines lines={identityLines(plan.prefill.identity)} />
                {onIdentity ? (
                  <button type="button" className={`${QUIET} mt-1`} onClick={() => hand("identity", () => onIdentity(plan.prefill.identity!))}>
                    {handed.identity ? "In the Identity boxes now" : "Put these in the Identity boxes"}
                  </button>
                ) : (
                  <p className={HINT}>Open Make This Site Yours to put these in the Identity boxes.</p>
                )}
              </div>
            ) : null}
            {plan.prefill.purpose ? (
              <div>
                <p className="font-medium text-gray-900">
                  {plan.prefill.purpose.fromFirstLine ? "Your first line, to start your purpose statement" : "Your purpose statement"}{" "}
                  <StatusChip status={statusOf(p, "purpose.statement")} />
                </p>
                <p className="whitespace-pre-line">{plan.prefill.purpose.text}</p>
                <button type="button" className={`${QUIET} mt-1`} onClick={() => hand("purpose", () => offerPrefill("purpose", plan.prefill.purpose!))}>
                  {handed.purpose ? "In the purpose box now" : "Put it in the purpose box"}
                </button>
              </div>
            ) : null}
            {plan.prefill.covenant ? (
              <div>
                <p className="font-medium text-gray-900">What a member signs <StatusChip status={statusOf(p, "membership.covenant")} /></p>
                <p className="whitespace-pre-line">{plan.prefill.covenant}</p>
                <button
                  type="button"
                  className={`${QUIET} mt-1`}
                  onClick={() =>
                    hand("covenant", () => {
                      offerPrefill("covenant", plan.prefill.covenant!);
                      onOpenTab("covenant");
                    })
                  }
                >
                  Open the covenant editor with it
                </button>
              </div>
            ) : null}
            {prefill.tokenName ? (
              <div>
                <p className="font-medium text-gray-900">Your recognition token's name <StatusChip status={statusOf(p, "quests.tokenName")} /></p>
                <p>{prefill.tokenName}</p>
                <button
                  type="button"
                  className={`${QUIET} mt-1`}
                  onClick={() =>
                    hand("tokenName", () => {
                      offerPrefill("tokenName", prefill.tokenName!);
                      onOpenTab("tokens");
                    })
                  }
                >
                  Open Tokens with it
                </button>
              </div>
            ) : null}
            {prefill.exitPolicy ? (
              <div>
                <p className="font-medium text-gray-900">What happens when someone leaves <StatusChip status={statusOf(p, "legal.exitPolicy")} /></p>
                <p className="whitespace-pre-line">{prefill.exitPolicy}</p>
                <button
                  type="button"
                  className={`${QUIET} mt-1`}
                  onClick={() =>
                    hand("exitPolicy", () => {
                      offerPrefill("exitPolicy", prefill.exitPolicy!);
                      onOpenTab("exits-admin");
                    })
                  }
                >
                  Open the exit policy with it
                </button>
              </div>
            ) : null}
            {plan.prefill.quests.length ? (
              <div>
                <p className="font-medium text-gray-900">Your first quests</p>
                <ul className="space-y-1">
                  {plan.prefill.quests.map((q, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2">
                      <span>
                        {q.quest}
                        {q.needLabel ? ` (it grows ${q.needLabel})` : ""}
                      </span>
                      <button
                        type="button"
                        className={QUIET}
                        onClick={() =>
                          hand(`quest-${i}`, () => {
                            offerPrefill("quest", { title: q.quest, needLabel: q.needLabel });
                            onOpenTab("quests-admin");
                          })
                        }
                      >
                        Open Quests with this one
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Part>
      ) : null}

      {plan.modules ? (
        <Part id="rc-modules" title="What your village runs" status={statusOf(p, "modules.on")}>
          {plan.modules.on.length ? (
            <p>
              Your stewards chose {plan.modules.on.map((m) => m.name).join(", ")}. Turn each one on yourself under
              Modules, in this order.
            </p>
          ) : (
            <p>Your stewards have not chosen any modules yet.</p>
          )}
          <Lines lines={plan.modules.order} />
          {plan.modules.unknown.length ? <p className={HINT}>Not a module Village OS has: {plan.modules.unknown.join(", ")}.</p> : null}
          <p className="mt-1">
            {plan.modules.moneyLeftOff.join(", ")} stay off. This file never turns on a module that moves or raises money.
          </p>
        </Part>
      ) : null}

      {plan.notes.length ? (
        <Part id="rc-notes" title="For you to set by hand">
          <p className="mb-2">
            Your stewards' words for what Village OS asks you to set yourself. This screen sets none of them. Tick each
            as you go; the ticks are for you and are saved nowhere.
          </p>
          <ul className="space-y-2">
            {plan.notes.map((n) => (
              <li key={n.key}>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-teal-deep"
                    checked={!!ticked[n.key]}
                    onChange={(e) => setTicked((t) => ({ ...t, [n.key]: e.target.checked }))}
                  />
                  <span>
                    <span className="font-medium text-gray-900">{n.label}</span> <span className={HINT}>({n.where})</span>
                    <span className="block whitespace-pre-line">{n.text}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </Part>
      ) : null}
    </div>
  );
}

function identityLines(p: IdentityPrefill): string[] {
  const out: string[] = [];
  if (p.name) out.push(`Name: ${p.name}`);
  if (p.tagline) out.push(`Tagline: ${p.tagline}`);
  if (p.location) out.push(`Location: ${p.location}`);
  if (p.memberName) out.push(`What a member is called: ${p.memberName}`);
  if (p.fiatCurrency) out.push(`The currency your prices are in: ${p.fiatCurrency}`);
  return out;
}

function DraftBox({
  preview,
  busy,
  published,
  onPublish,
  onWithdraw,
  onRevert,
}: {
  preview: DraftPreview | null;
  busy: boolean;
  published: boolean;
  onPublish: () => void;
  onWithdraw: () => void;
  onRevert: () => void;
}) {
  return (
    <section className={`${BOX} mb-3`} aria-labelledby="rc-draft-title">
      <h4 id="rc-draft-title" className="font-semibold text-gray-900">
        {published ? "Your published draft" : "Your draft, line by line"}
      </h4>
      {preview ? (
        <ul className="mt-2 space-y-1 text-sm">
          {preview.lines.map((l, i) => (
            <li key={i} className={l.blocked ? "text-red-700" : "text-gray-800"}>
              {l.reads}
              {l.blocked ? `: ${l.blocked}` : ""}
            </li>
          ))}
        </ul>
      ) : (
        <p className={HINT}>The draft's lines could not be read back. Publishing still checks every one first.</p>
      )}
      <div className="mt-3 flex flex-wrap gap-3">
        {published ? (
          <button type="button" className={QUIET} disabled={busy} onClick={onRevert}>
            Revert the draft
          </button>
        ) : (
          <>
            <button type="button" className={PRIMARY} disabled={busy || (preview?.blocked ?? 0) > 0} onClick={onPublish}>
              {busy ? "Working..." : "Publish this draft"}
            </button>
            <button type="button" className={QUIET} disabled={busy} onClick={onWithdraw}>
              Withdraw it
            </button>
          </>
        )}
      </div>
      {!published && (preview?.blocked ?? 0) > 0 ? (
        <p className="text-sm text-red-700 mt-2">A line above cannot be applied, so the draft cannot be published. Withdraw it, fix that part, and load the file again.</p>
      ) : null}
      {!published ? (
        <p className={`${HINT} mt-2`}>Publishing applies every line at once. Reverting later puts back what was there.</p>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- *
 * The screen.
 * -------------------------------------------------------------------------- */

export default function ProfileImport({
  password,
  onOpenTab,
  onIdentity,
}: {
  password: string;
  onOpenTab: (tab: string) => void;
  onIdentity?: (p: IdentityPrefill) => void;
}) {
  const [text, setText] = useState(keptFileText);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [choices, setChoices] = useState<ImportChoices | null>(null);
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [preview, setPreview] = useState<DraftPreview | null>(null);
  const [published, setPublished] = useState(false);
  /** The draft on screen came from this load, so publishing it runs the steps that wait for its seats. */
  const [draftHasPlan, setDraftHasPlan] = useState(false);
  const [earlier, setEarlier] = useState<{ id: string; title: string; changes: number }[]>([]);

  const refreshEarlier = useCallback(() => {
    openImportDrafts(password).then(setEarlier).catch(() => setEarlier([]));
  }, [password]);
  useEffect(() => { refreshEarlier(); }, [refreshEarlier]);
  // Back from another editor with a file already read: read it again against the village as it is now.
  useEffect(() => {
    if (keptFileText()) void read(keptFileText());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const read = async (body: string) => {
    setError("");
    setSteps([]);
    setDraftId(null);
    setPreview(null);
    setPublished(false);
    const r = readRegenFile(body);
    if (!r.ok) {
      setPlan(null);
      setError(r.error);
      return;
    }
    setBusy(true);
    const live = await readLive(password);
    setBusy(false);
    if (!live.ok) {
      setPlan(null);
      setError(live.error);
      return;
    }
    const next = planImport(r.profile, live.live, { tag: Date.now().toString(36).slice(-4) });
    keepFile(body);
    setPlan(next);
    setChoices(defaultChoices(next));
  };

  const willSend = useMemo(() => {
    if (!plan || !choices) return "";
    const parts: string[] = [];
    const scope = scopeBodyFor(plan, choices);
    if (scope) parts.push(`${scope.needs.length} human need${scope.needs.length === 1 ? "" : "s"}`);
    if (choices.totality && plan.totality) parts.push("the whole-village figure");
    const lines = draftChangesFor(plan, choices).length;
    if (lines) parts.push(`a draft of ${lines} line${lines === 1 ? "" : "s"} for you to publish`);
    return parts.length ? `This sends ${parts.join(", ")}.` : "Nothing is ticked, so this would send nothing.";
  }, [plan, choices]);

  const load = async () => {
    if (!plan || !choices) return;
    setBusy(true);
    const r = await loadKept(password, plan, choices);
    setBusy(false);
    setSteps(r.steps);
    setDraftId(r.draftId);
    setPreview(r.preview);
    setDraftHasPlan(!!r.draftId);
    refreshEarlier();
  };

  /** An earlier load's draft, read line by line before anything can publish it. */
  const readEarlier = async (id: string) => {
    setBusy(true);
    const p = await previewOf(password, id);
    setBusy(false);
    setDraftId(id);
    setPreview(p);
    setPublished(false);
    setDraftHasPlan(false);
  };

  const publish = async (id: string) => {
    setBusy(true);
    const r = await publishAndFinish(password, draftHasPlan ? plan : null, draftHasPlan ? choices : null, id);
    setBusy(false);
    setSteps((s) => [...s, ...r]);
    // The lines stay as they were read. Previewed again now, every seat it made would read as one that already exists.
    if (r[0]?.ok) setPublished(true);
    refreshEarlier();
  };

  const withdraw = async (id: string) => {
    setBusy(true);
    const r = await withdrawImportDraft(password, id);
    setBusy(false);
    setSteps((s) => [...s, r]);
    if (r.ok && id === draftId) {
      setDraftId(null);
      setPreview(null);
    }
    refreshEarlier();
  };

  const revert = async (id: string) => {
    setBusy(true);
    const r = await revertImportDraft(password, id);
    setBusy(false);
    setSteps((s) => [...s, r]);
    if (r.ok) {
      // A reverted draft is a record, and the village it was read against has moved. Read the file again to start over.
      setDraftId(null);
      setPreview(null);
      setPublished(false);
      setPlan(null);
    }
  };

  const others = earlier.filter((d) => d.id !== draftId);
  return (
    <div className="space-y-3">
      {others.length ? (
        <div className={BOX}>
          <p className="font-semibold text-gray-900">A draft from an earlier load, not published yet</p>
          <ul className="mt-2 space-y-2">
            {others.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 text-sm">
                <span>
                  {d.title}, {d.changes} line{d.changes === 1 ? "" : "s"}
                </span>
                <button type="button" className={QUIET} disabled={busy} onClick={() => readEarlier(d.id)}>
                  Read it
                </button>
                <button type="button" className={QUIET} disabled={busy} onClick={() => withdraw(d.id)}>
                  Withdraw it
                </button>
              </li>
            ))}
          </ul>
          <p className={`${HINT} mt-2`}>
            Read it before you publish it. Published, it makes the circles and seats; load the same file again
            afterwards to tag each seat with its needs and say how each circle decides.
          </p>
        </div>
      ) : null}

      {!draftId ? <PasteBox text={text} busy={busy} onText={setText} onRead={read} /> : null}

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {plan && choices && !draftId ? (
        <>
          <Preview plan={plan} choices={choices} onChoices={setChoices} />
          <Handover plan={plan} onOpenTab={onOpenTab} onIdentity={onIdentity} />
          <div className={BOX}>
            <p className="text-sm text-gray-900">{willSend}</p>
            <button type="button" className={`${PRIMARY} mt-2`} disabled={busy || willSend.startsWith("Nothing")} onClick={load}>
              {busy ? "Loading..." : "Load what you kept"}
            </button>
          </div>
        </>
      ) : null}

      {draftId ? (
        <DraftBox
          preview={preview}
          busy={busy}
          published={published}
          onPublish={() => publish(draftId)}
          onWithdraw={() => withdraw(draftId)}
          onRevert={() => revert(draftId)}
        />
      ) : null}

      {plan && draftId ? <Handover plan={plan} onOpenTab={onOpenTab} onIdentity={onIdentity} /> : null}

      <Steps steps={steps} />
    </div>
  );
}
