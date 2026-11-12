/**
 * MY MOON, on the profile's Roles tab under the player card (spec section 8,
 * with decisions 16 revised to 22 and addendum A1, A2, A4, A5, A7, B1).
 *
 * Phone first, one column, top to bottom:
 *   header           the moon on a golden spiral with its four chapters
 *                    (sow, tend, full moon, harvest) and the one next act
 *                    (MoonSpiral, Phase C lane C2), then the moon picker,
 *                    dates, walkthrough day, send-by day, the status line
 *                    naming the role it waits on, the moon load, the Room
 *                    view switch and the guide link when set
 *   gather           bring in my tasks, Ask Sera, Import from Claude, add by hand
 *   keep and tag     one card per item
 *   the score        the garden bed with its readings, member only
 *   role cards       one garden bed per role, season goals, Outside my roles
 *   role audit, who helped, moon goals, in my own words, Send my recap
 *   invoice          only when a role's terms carry money
 *
 * It loads as its own chunk (`MyMoonMount`). `MyMoonView` takes the payload
 * and draws it, so a test can render any moon without a server.
 */
import { useCallback, useEffect, useState } from "react";
import {
  GUIDE_WORDS,
  MOON_WORDS,
  MY_MOON_WORDS,
  dayWords,
  recapEditable,
  sendByLine,
  type ItemFields,
  type RoleAudit,
  type SeraState,
  type ThanksEntry,
} from "@shared/moonRecap";
import { guideSheetLink } from "@shared/moonRhythm";
import * as api from "./moonApi";
import type { MyMoonData } from "./moonApi";
import ItemCard from "./ItemCard";
import GatherPanel from "./GatherPanel";
import InvoicePanel from "./InvoicePanel";
import { RoleCardsBlock, ScoreBlock } from "./CoverageAndScore";
import MoonSpiral from "./MoonSpiral";
import { localToday } from "./moonGarden";
import { GoalsPanel, RoleAuditPanel, ThanksPanel } from "./RecapParts";
import { ERROR, H2, INPUT, KICKER, LABEL, LINK, MemberOnly, MUTED, PANEL, RoomViewContext, Section, SMALL_BTN, SMALL_BTN_ON } from "./moonUi";
import VoiceArea from "@/components/voice/VoiceArea";

export interface MyMoonViewProps {
  data: MyMoonData;
  villageRoles: ReadonlyArray<{ id: string; name: string }>;
  onCycle: (cycleId: string) => void;
  /** Read the moon again; resolves to the recap's Sera state. */
  reload: () => Promise<SeraState | null>;
  /** Room view to start in, for a test. */
  initialRoomView?: boolean;
  /** The member's civil date, for a test; the browser's own date otherwise. */
  today?: string;
}

export function MyMoonView({ data, villageRoles, onCycle, reload, initialRoomView = false, today = localToday() }: MyMoonViewProps) {
  const [room, setRoom] = useState(initialRoomView);
  const recap = data.recap;
  const cycleId = data.moon.cycleId;
  const editable = recap ? recapEditable(recap.status) : true;
  const [ownWords, setOwnWords] = useState(recap?.ownWords ?? "");
  const [audit, setAudit] = useState<RoleAudit>(recap?.roleAudit ?? { roles: [], newRoles: [] });
  const [thanks, setThanks] = useState<ThanksEntry[]>(data.thanks ?? []);
  const [error, setError] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Reset from the server only when the recap itself changes hands (a send, a
  // take back, a return), so a reload after an item save keeps what is typed.
  useEffect(() => {
    setOwnWords(recap?.ownWords ?? "");
    setAudit(recap?.roleAudit ?? { roles: [], newRoles: [] });
    setThanks(data.thanks ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recap?.id, recap?.status]);

  const saveItem = async (id: string, fields: ItemFields): Promise<string | null> => {
    const r = await api.editItem(id, fields);
    if (!r.ok) return r.error;
    await reload();
    return null;
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    setLine(null);
    const r = await api.sendRecap(cycleId, { ownWords: ownWords.trim() || null, roleAudit: audit, thanks });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setLine(MY_MOON_WORDS.sent);
    await reload();
  };
  const takeBack = async () => {
    setBusy(true);
    setError(null);
    const r = await api.takeBack(cycleId);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    await reload();
  };

  const guide = data.guideUrl ? guideSheetLink({ guideUrl: data.guideUrl }) : null;
  const items = [...data.items].sort((a, b) => a.position - b.position);
  const noRoles = data.roles.length === 0 && items.length === 0;

  return (
    <RoomViewContext.Provider value={room}>
      <div className={`${PANEL} flex flex-col gap-4 p-4 sm:p-6`} data-testid="my-moon">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className={KICKER}>{MOON_WORDS.thisMoon}</p>
              <h2 className={H2}>{MOON_WORDS.heading}</h2>
            </div>
            <button type="button" aria-pressed={room} onClick={() => setRoom((v) => !v)} className={room ? SMALL_BTN_ON : SMALL_BTN}>
              {MOON_WORDS.roomView}
            </button>
          </div>
          {room ? <p className={MUTED} aria-live="polite">{MY_MOON_WORDS.roomViewOn}. {MOON_WORDS.roomViewLine}</p> : null}
          <MoonSpiral moon={data.moon} today={today} editable={editable && !noRoles} />
          {data.moons.length > 1 ? (
            <label className={LABEL}>
              {MY_MOON_WORDS.whichMoon}
              <select value={cycleId} onChange={(e) => onCycle(e.target.value)} className={INPUT}>
                {data.moons.map((m) => <option key={m.cycleId} value={m.cycleId}>{m.periodWords}: {m.statusWords}</option>)}
              </select>
            </label>
          ) : null}
          <dl className="m-0 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div><dt className={LABEL}>{MOON_WORDS.period}</dt><dd className="m-0 text-foreground">{data.moon.periodWords}</dd></div>
            <div><dt className={LABEL}>{MY_MOON_WORDS.walkthrough}</dt><dd className="m-0 text-foreground">{dayWords(data.moon.endOfMoonFriday)}</dd></div>
            <div className="sm:col-span-2"><dt className={LABEL}>{MOON_WORDS.sendBy}</dt><dd className="m-0 text-foreground">{sendByLine(data.moon.sendBy)}</dd></div>
            <MemberOnly>
              {data.moonLoad !== null ? (
                <div data-testid="moon-load"><dt className={LABEL}>{MY_MOON_WORDS.moonLoad}</dt><dd className="m-0 text-foreground">{MY_MOON_WORDS.moonLoadOf(data.moonLoad)}</dd></div>
              ) : null}
            </MemberOnly>
          </dl>
          <p className="m-0 text-sm font-semibold text-foreground" data-testid="moon-status">{recap?.statusLine ?? MY_MOON_WORDS.notStarted}</p>
          {recap?.returnedNote ? <p className="m-0 whitespace-pre-line text-sm text-foreground">{recap.returnedNote}</p> : null}
          {guide ? <a href={guide} target="_blank" rel="noreferrer" className={`${LINK} text-sm`}>{GUIDE_WORDS.open}</a> : null}
        </header>

        {noRoles ? (
          <p className={MUTED}>{MOON_WORDS.noRecapRoles}</p>
        ) : (
          <>
            <div id="moon-gather" className="scroll-mt-28">
              <GatherPanel cycleId={cycleId} editable={editable} sera={recap?.sera ?? null} reload={reload} />
            </div>

            <Section title={MY_MOON_WORDS.keepAndTag}>
              {items.length === 0 ? <p className={MUTED}>{MY_MOON_WORDS.noItems}</p> : null}
              <div className="flex flex-col gap-3">
                {items.map((i) => (
                  <ItemCard key={i.id} item={i} roles={data.roles} seasonGoals={data.seasonGoals} ownGoals={data.ownGoals} villageRoles={villageRoles} editable={editable} onSave={(f) => saveItem(i.id, f)} />
                ))}
              </div>
            </Section>

            <ScoreBlock data={data} />
            <RoleCardsBlock coverage={data.coverage} items={data.items} outsideRoles={data.outsideRoles} />
            <RoleAuditPanel roles={data.roles} audit={audit} onChange={setAudit} outsideRoles={data.outsideRoles} villageRoles={villageRoles} editable={editable} />
            <ThanksPanel thanks={thanks} onChange={setThanks} editable={editable} />
            <GoalsPanel cycleId={cycleId} last={data.lastMoonGoals} goalScore={data.goalScore} next={data.nextMoonGoals} seasonGoals={data.seasonGoals} reload={reload} editable />

            <Section title={MOON_WORDS.ownWords} id="moon-own-words">
              <label className={LABEL}>
                {MY_MOON_WORDS.ownWordsHint}
                <VoiceArea value={ownWords} onValue={setOwnWords} disabled={!editable}>
                <textarea value={ownWords} rows={4} maxLength={2000} readOnly={!editable} onChange={(e) => setOwnWords(e.target.value)} className={INPUT} />
                </VoiceArea>
              </label>
              {editable ? (
                <>
                  <button type="button" className={`${SMALL_BTN_ON} self-start`} disabled={busy} onClick={send}>{MOON_WORDS.sendRecap}</button>
                  <p className={MUTED}>{MOON_WORDS.sendRecapLine}</p>
                </>
              ) : recap?.status === "waiting" ? (
                <>
                  <button type="button" className={`${SMALL_BTN} self-start`} disabled={busy} onClick={takeBack}>{MOON_WORDS.takeBack}</button>
                  <p className={MUTED}>{MOON_WORDS.takeBackLine}</p>
                </>
              ) : null}
              {line ? <p className={MUTED} aria-live="polite">{line}</p> : null}
              {error ? <p role="alert" className={ERROR}>{error}</p> : null}
            </Section>

            <InvoicePanel data={data} cycleId={cycleId} editable={editable} reload={reload} />
          </>
        )}
      </div>
    </RoomViewContext.Provider>
  );
}

/** The loader: reads `/api/me/moon`, and draws nothing at all while the module is off. */
export default function MyMoon() {
  const [cycle, setCycle] = useState<string | null>(null);
  const [data, setData] = useState<MyMoonData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "off" | "failed">("loading");
  const [error, setError] = useState<string | null>(null);
  const [villageRoles, setVillageRoles] = useState<Array<{ id: string; name: string }>>([]);

  const load = useCallback(async (): Promise<SeraState | null> => {
    const r = await api.fetchMyMoon(cycle);
    if (!r.ok) {
      // The module ships off, and an off module answers 404: then My moon is not here at all.
      if (r.status === 404 || r.status === 401) setState("off");
      else {
        setError(r.error);
        setState("failed");
      }
      return null;
    }
    setData(r.data);
    setState("ready");
    return r.data.recap?.sera ?? null;
  }, [cycle]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (state !== "ready") return;
    let live = true;
    void api.fetchVillageRoles().then((r) => live && setVillageRoles(r));
    return () => { live = false; };
  }, [state]);

  if (state === "off") return null;
  if (state === "loading" || !data) {
    return state === "failed" ? <p className={ERROR}>{error}</p> : <p className={MUTED}>{MY_MOON_WORDS.loading}</p>;
  }
  return <MyMoonView key={data.moon.cycleId} data={data} villageRoles={villageRoles} onCycle={setCycle} reload={load} />;
}
