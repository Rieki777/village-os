/**
 * Live Sessions, before the call: what members bring for a circle's next
 * session, and how a session takes it up.
 *
 * ONE FILE IS THE CONTRACT for the agenda library, the way shared/sessions.ts
 * is for the room and shared/sessionTasks.ts is for the tasks. The store
 * (server/repos/sessionLibrary.ts), the logic (server/lib/sessionLibrary.ts),
 * the list on /sessions, the start card and the room's agenda stage read their
 * shapes, rules and words from here. The schema is
 * drizzle/0264_a_circle_keeps_an_agenda_library.sql.
 *
 * WHERE IT COMES FROM. The founder, on /sessions: a place for members to add
 * agenda items for an upcoming session, and a library of them to choose from
 * when a session starts. The code calls it the library. A member never reads
 * that word, because the village already has a Library (the shared material
 * library) and a Module Library: on the page it is "Waiting for a circle".
 *
 * THE LIFE OF AN ITEM. A member brings it, for one circle or for no circle in
 * particular, and it waits. The person opening a session ticks the ones it will
 * take up, and anyone in an open room can bring one more onto the agenda from
 * the agenda stage. Either way it becomes an ordinary agenda item, with the
 * note as its first note, and it is on that session's agenda. When the session
 * closes, an item the room finished is taken up, and one it did not reach comes
 * back to wait for next time, on its own: both closes (the facilitator's and a
 * quiet room's) run the same code, a quiet room has nobody to ask, and a thing
 * somebody brought stays with the circle until the circle has taken it up.
 *
 * TWO DECISIONS LIVE IN PURE FUNCTIONS, so a ruling changes one line:
 *   `canSeeBrought`  who may read an item at all.
 *   `broughtRights`  who may change its words, its circle, withdraw it, or
 *                    bring it again.
 * `mayTakeInto` adds the one rule of the room: an item fits a session of its
 * own circle, and an item for no circle fits any session.
 *
 * THE STANDING RULE is the task layer's (shared/sessionTasks.ts
 * `hostsOpenRoomInCircle`) one step tighter: a member has standing in a circle
 * when they were in its last closed session that at least two people were in,
 * or sit in one of its seats now. A session somebody opened and closed alone
 * neither gives them a circle's waiting items nor takes them from the people
 * of its last real meeting. The server measures it; the functions here read
 * the set.
 *
 * THE PRIVACY LINE. A circle's waiting items are read by the people with
 * standing in it, by whoever brought each one, and by admins. An item for no
 * circle in particular is read by every member. A card carries names, never a
 * member's id, number or email. The title of a closed session reaches only the
 * people the record opens to (the people who were in it, and admins). ONCE A
 * SESSION TAKES AN ITEM UP, anyone who looks into that open room reads it and
 * its note, the way they read the rest of the agenda, and the form says so: the
 * circle line is a filter for the waiting list, and the room's own line takes
 * over from there.
 *
 * COPY RULES. Platform code carries no village's name. No em-dashes, and every
 * string a member reads lives in this file so the voice gate reads it.
 */
import {
  ITEM_AIMS,
  ROOM_COPY,
  SESSION_COPY,
  SESSION_LIMITS,
  SESSION_REFUSALS,
  SESSIONS_API,
  cleanLine,
  cleanText,
  isItemAim,
  type ItemAim,
} from "./sessions";
import { circleWords } from "./sessionTasks";

// ── Doors ────────────────────────────────────────────────────────────────────

/**
 * Every door, so the pages and the routes agree. A refusal is `{ error: <a
 * sentence> }` with a 4xx status.
 *
 *   GET    /api/sessions                      gains `library: LibraryPayload`
 *   POST   /api/sessions                      gains `libraryIds?: number[]`, in agenda order
 *   POST   /api/sessions/library              LibraryInput -> { item: LibraryCard }
 *   PATCH  /api/sessions/library/:itemId      Partial<LibraryInput> -> { item: LibraryCard }
 *   DELETE /api/sessions/library/:itemId      { ok }, withdraw it
 *   POST   /api/sessions/library/:itemId/again  {} -> { item: LibraryCard }, bring a taken-up item again
 *   GET    /api/sessions/:id/library          { items: LibraryCard[] }, what this viewer may bring into this open room
 *   POST   /api/sessions/:id/library          { ids: number[] } -> { ids: number[] }, onto this room's agenda
 *
 * The list is not a door of its own: `GET /api/sessions/library` would be
 * read as the room numbered "library" by `GET /api/sessions/:id`, and the
 * page asks for the list every half minute anyway.
 */
export const LIBRARY_API = `${SESSIONS_API}/library`;

export function libraryItemUrl(id: number): string {
  return `${LIBRARY_API}/${id}`;
}

export function libraryAgainUrl(id: number): string {
  return `${LIBRARY_API}/${id}/again`;
}

/** One open room's own list, and the door that brings items onto its agenda. */
export function roomLibraryUrl(sessionId: number): string {
  return `${SESSIONS_API}/${sessionId}/library`;
}

/** One card's anchor on /sessions is `brought-<id>`. */
export const BROUGHT_ANCHOR_PREFIX = "brought-";

export function broughtAnchor(id: number): string {
  return `${BROUGHT_ANCHOR_PREFIX}${id}`;
}

/**
 * The link every notice about an item carries: its own card on /sessions.
 * Never the session itself, because a closed record refuses anybody who was
 * not in it, and a notice never sends somebody to a page that would refuse them.
 */
export function broughtLink(id: number): string {
  return `/sessions#${broughtAnchor(id)}`;
}

/** The item a location hash names ("#brought-12" or "brought-12"), or null. */
export function broughtIdFromHash(hash: string | null | undefined): number | null {
  const m = /^#?brought-([1-9]\d{0,9})$/.exec(typeof hash === "string" ? hash.trim() : "");
  const id = m ? Number(m[1]) : Number.NaN;
  return Number.isSafeInteger(id) ? id : null;
}

// ── Statuses and limits ──────────────────────────────────────────────────────

/** waiting: brought, not on any agenda. on_agenda: on an open session's agenda. taken_up: a session finished it. */
export const LIBRARY_STATUSES = ["waiting", "on_agenda", "taken_up"] as const;
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];

export function isLibraryStatus(v: unknown): v is LibraryStatus {
  return typeof v === "string" && (LIBRARY_STATUSES as readonly string[]).includes(v);
}

/** How a take left its session: the room finished it, or it came back to wait. */
export const TAKE_OUTCOMES = ["taken_up", "back"] as const;
export type TakeOutcome = (typeof TAKE_OUTCOMES)[number];

export const LIBRARY_LIMITS = {
  title: SESSION_LIMITS.agendaTitle,
  note: SESSION_LIMITS.text,
  /** Items one member may have waiting at once. */
  waitingPerMember: 50,
  /** Items one member may bring in an hour. */
  addsPerHour: 60,
  /** Changes, withdrawals and items brought again by one member in an hour. */
  changesPerHour: 120,
  /** A taken-up item shows under "Taken up lately" for three moons. */
  takenUpDays: 89,
  /** And at most this many of them. */
  takenUpShown: 30,
} as const;

/** The minutes an item gets on the agenda, by its aim. The room changes them as it likes. */
export const LIBRARY_MINUTES: Record<ItemAim, number> = { report: 5, explore: 10, decide: 15 };

/** The aim an item takes onto the agenda: its own, or explore when the member was not sure. */
export function agendaAimFor(aim: ItemAim | null): ItemAim {
  return aim ?? "explore";
}

// ── Wire shapes ──────────────────────────────────────────────────────────────

/** One item as any reader sees it. Names only: never a member's id, number or email. */
export interface LibraryCard {
  id: number;
  title: string;
  aim: ItemAim | null;
  note: string | null;
  circleId: string | null;
  circleName: string | null;
  /** The bringer's name, or SESSION_SOMEONE. */
  broughtBy: string;
  /** The viewer brought it. */
  mine: boolean;
  /** ISO instant. */
  broughtAt: string;
  status: LibraryStatus;
  /**
   * The session it is on, or was taken up in, only when the viewer may read
   * that session: an open room always, a closed record for the people who were
   * in it and admins. Null otherwise, and for a record that was deleted.
   */
  session: { id: number; title: string; open: boolean } | null;
  /** ISO instant it was taken up, or null. */
  settledAt: string | null;
  /** ISO instant it last came back to wait, or null. */
  backAt: string | null;
  /** Who last changed its words, when that was not the bringer. */
  changedBy: string | null;
  /** Change its title, aim and note (while it waits). */
  canEdit: boolean;
  /** Change which circle it is for (while it waits). The circle is the item's audience. */
  canMoveCircle: boolean;
  canWithdraw: boolean;
  canBringAgain: boolean;
}

export interface LibraryPayload {
  items: LibraryCard[];
  /** The circles the viewer has standing in, so their own come first. Their own, never anybody else's. */
  myCircleIds: string[];
}

/** What a member sends to bring an item, or to change one. */
export interface LibraryInput {
  title: string;
  aim?: ItemAim | null;
  note?: string | null;
  /** A live circle's id, or null for no circle in particular. */
  circleId?: string | null;
}

// ── The rules, as pure functions ─────────────────────────────────────────────

/** One row as the rules read it. People are numbers. */
export interface LibrarySubject {
  circleId: string | null;
  broughtByNo: number;
  status: LibraryStatus;
}

/**
 * Who is asking, as the server measured it.
 *
 *   standing  the circles they were in the last closed session of, or sit in
 *             a seat of now (the task layer's rule).
 *   hostsIn   the circles where they facilitate or keep notes for an open
 *             session AND have standing. A session with no circle never puts
 *             anybody here: any member can open one with a title, so hosting
 *             it says nothing about the items that wait.
 */
export interface LibraryViewer {
  no: number | null;
  admin: boolean;
  standing: ReadonlySet<string>;
  hostsIn: ReadonlySet<string>;
}

function brought(item: Pick<LibrarySubject, "broughtByNo">, viewer: LibraryViewer): boolean {
  return viewer.no != null && viewer.no > 0 && item.broughtByNo === viewer.no;
}

/**
 * Who may read an item at all: whoever brought it, admins, every member for an
 * item for no circle in particular, and the people with standing in its circle.
 * A member may bring something to a circle they are not in, the way a tension
 * is raised with the circle that holds it, and they always see their own.
 */
export function canSeeBrought(item: Pick<LibrarySubject, "circleId" | "broughtByNo">, viewer: LibraryViewer): boolean {
  return brought(item, viewer) || viewer.admin || item.circleId == null || viewer.standing.has(item.circleId);
}

export interface LibraryRights {
  /** Its title, aim and note. */
  words: boolean;
  /** Which circle it is for. */
  circle: boolean;
  withdraw: boolean;
  bringAgain: boolean;
}

/**
 * Who may do what to one item. Every right needs `canSeeBrought` first; the
 * server answers 404 to anybody who may not see it.
 *
 *   words       whoever brought it, admins, and the facilitator or secretary of
 *               an open session of its circle who has standing there (the
 *               room's own edit rights, carried one step out). Never a host for
 *               an item for no circle: nobody has standing in "no circle".
 *   circle      whoever brought it, and admins. The circle decides who reads it.
 *   withdraw    whoever brought it, and admins, at any time. On an agenda, the
 *               room keeps its agenda item as it stands.
 *   bringAgain  whoever brought it, and admins.
 *
 * Each right says WHO, never WHEN: the words and the circle change only while
 * the item waits, and an item is brought again only once a session took it up.
 * The server checks the status after the right, with its own sentence, and a
 * card offers a control only when both hold.
 */
export function broughtRights(item: Pick<LibrarySubject, "circleId" | "broughtByNo">, viewer: LibraryViewer): LibraryRights {
  const own = brought(item, viewer) || viewer.admin;
  const hosts = item.circleId != null && viewer.hostsIn.has(item.circleId);
  return {
    words: own || hosts,
    circle: own,
    withdraw: own,
    bringAgain: own,
  };
}

/** May this viewer take this item into a session of `roomCircleId` (null: a session with no circle). */
export function mayTakeInto(item: LibrarySubject, viewer: LibraryViewer, roomCircleId: string | null): boolean {
  if (item.status !== "waiting" || !canSeeBrought(item, viewer)) return false;
  return item.circleId == null || item.circleId === roomCircleId;
}

/**
 * Which items a session may take, from the rows the server locked. All or
 * none: one id that is missing, hidden, for another circle or no longer
 * waiting refuses the whole batch with one sentence that names no id, so a
 * refusal never says an item exists. Ids already on this session's agenda
 * (`alreadyHere`) are a quiet yes and are left out. Keeps the order asked.
 */
export function planTakes<R extends LibrarySubject & { id: number }>(
  wanted: readonly number[],
  rows: readonly R[],
  viewer: LibraryViewer,
  roomCircleId: string | null,
  alreadyHere: ReadonlySet<number> = new Set(),
): { ok: true; take: R[] } | { ok: false } {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const take: R[] = [];
  for (const id of wanted) {
    if (alreadyHere.has(id)) continue;
    const row = byId.get(id);
    if (!row || !mayTakeInto(row, viewer, roomCircleId)) return { ok: false };
    take.push(row);
  }
  return { ok: true, take };
}

// ── Reading a body ───────────────────────────────────────────────────────────

type Clean<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const bodyOf = (raw: unknown): Record<string, unknown> =>
  raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
const has = (b: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(b, k) && b[k] !== undefined;

function readAim(v: unknown): Clean<ItemAim | null> {
  if (v == null || v === "") return { ok: true, value: null };
  return isItemAim(v) ? { ok: true, value: v } : { ok: false, status: 400, error: SESSION_REFUSALS.aimNeeded };
}

function readCircle(v: unknown, circleIds: ReadonlySet<string>): Clean<string | null> {
  if (v == null || v === "") return { ok: true, value: null };
  return typeof v === "string" && circleIds.has(v) ? { ok: true, value: v } : { ok: false, status: 400, error: SESSION_REFUSALS.circleUnknown };
}

/** A new item's fields, cleaned and clipped. The circle is checked against the village's live circles. */
export function cleanBrought(raw: unknown, circleIds: ReadonlySet<string>): Clean<{ title: string; aim: ItemAim | null; note: string | null; circleId: string | null }> {
  const b = bodyOf(raw);
  const title = cleanLine(b.title, LIBRARY_LIMITS.title);
  if (!title) return { ok: false, status: 400, error: SESSION_REFUSALS.itemTitleNeeded };
  const aim = readAim(b.aim);
  if (!aim.ok) return aim;
  const circle = readCircle(b.circleId, circleIds);
  if (!circle.ok) return circle;
  return { ok: true, value: { title, aim: aim.value, note: cleanText(b.note, LIBRARY_LIMITS.note), circleId: circle.value } };
}

/** The fields a change sends. A key left out is left alone; a note sent empty is cleared. */
export function cleanBroughtPatch(
  raw: unknown,
  circleIds: ReadonlySet<string>,
): Clean<{ title?: string; aim?: ItemAim | null; note?: string | null; circleId?: string | null }> {
  const b = bodyOf(raw);
  const out: { title?: string; aim?: ItemAim | null; note?: string | null; circleId?: string | null } = {};
  if (has(b, "title")) {
    const title = cleanLine(b.title, LIBRARY_LIMITS.title);
    if (!title) return { ok: false, status: 400, error: SESSION_REFUSALS.itemTitleNeeded };
    out.title = title;
  }
  if (has(b, "aim")) {
    const aim = readAim(b.aim);
    if (!aim.ok) return aim;
    out.aim = aim.value;
  }
  if (has(b, "note")) out.note = cleanText(b.note, LIBRARY_LIMITS.note);
  if (has(b, "circleId")) {
    const circle = readCircle(b.circleId, circleIds);
    if (!circle.ok) return circle;
    out.circleId = circle.value;
  }
  return { ok: true, value: out };
}

/**
 * A list of item ids, in the order sent, each once. Null when it is not a list
 * of whole numbers, or holds more than an agenda can.
 */
export function cleanIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length > SESSION_LIMITS.maxAgenda) return null;
  const out: number[] = [];
  for (const v of raw) {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v >= 2 ** 31) return null;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

// ── Grouping, for the page ───────────────────────────────────────────────────

export interface LibraryGroup {
  /** A circle's id, or null for no circle in particular. */
  circleId: string | null;
  heading: string;
  items: LibraryCard[];
}

/**
 * The waiting list as a circle reads it: one group per circle, the viewer's own
 * circles first, then the others by name, then no circle in particular. Inside
 * a group, oldest first, so whatever has waited longest is read first.
 */
export function groupByCircle(items: readonly LibraryCard[], myCircleIds: readonly string[]): LibraryGroup[] {
  const groups = new Map<string, LibraryGroup>();
  for (const item of items) {
    const key = item.circleId ?? "";
    let g = groups.get(key);
    if (!g) {
      g = { circleId: item.circleId, heading: item.circleId ? circleWords(item.circleName ?? item.circleId) : SESSION_COPY.noCircle, items: [] };
      groups.set(key, g);
    }
    g.items.push(item);
  }
  const mine = new Set(myCircleIds);
  const rank = (g: LibraryGroup) => (g.circleId == null ? 2 : mine.has(g.circleId) ? 0 : 1);
  const out = Array.from(groups.values()).sort((a, b) => rank(a) - rank(b) || a.heading.localeCompare(b.heading));
  for (const g of out) g.items.sort((a, b) => Date.parse(a.broughtAt) - Date.parse(b.broughtAt) || a.id - b.id);
  return out;
}

/**
 * What the start card offers for the circle chosen there: that circle's
 * waiting items, then the ones for no circle in particular, each oldest first.
 * A session for no circle is offered only those for no circle.
 */
export function offeredFor(items: readonly LibraryCard[], circleId: string | null): LibraryCard[] {
  const waiting = items.filter((i) => i.status === "waiting");
  const byAge = (a: LibraryCard, b: LibraryCard) => Date.parse(a.broughtAt) - Date.parse(b.broughtAt) || a.id - b.id;
  const own = circleId ? waiting.filter((i) => i.circleId === circleId).sort(byAge) : [];
  return [...own, ...waiting.filter((i) => i.circleId == null).sort(byAge)];
}

// ── Words ────────────────────────────────────────────────────────────────────

/** "Brought for the Garden circle", or "Brought for any circle" for a session with no circle. */
export function broughtFor(circleName: string | null): string {
  return circleName ? `Brought for the ${circleWords(circleName)}` : "Brought for any circle";
}

export const LIBRARY_COPY = {
  sectionTitle: "Waiting for a circle",
  sectionLede:
    "Bring what needs a circle's time. When that circle next meets, it is offered for the agenda, and the room consents to the agenda together.",
  bringButton: "Bring an item",
  formTitle: "Bring an item",
  titleLabel: ROOM_COPY.itemTitleLabel,
  titlePlaceholder: ROOM_COPY.itemTitlePlaceholder,
  aimLabel: SESSION_COPY.agendaAimLabel,
  aimNotSure: "Not sure yet",
  aimNotSureHint: "The room chooses the aim when it takes it up.",
  noteLabel: "Anything the circle should know first?",
  notePlaceholder: "Optional",
  circleLabel: "Which circle is it for?",
  circleChoose: "Choose a circle",
  circleNeeded: `Choose a circle, or ${SESSION_COPY.noCircle}.`,
  noCircle: SESSION_COPY.noCircle,
  seenHint: "Once a session takes it up, anyone who looks into that session can read it.",
  addButton: ROOM_COPY.addItemButton,
  adding: "Adding...",
  cancel: ROOM_COPY.cancel,
  edit: ROOM_COPY.edit,
  save: ROOM_COPY.save,
  saving: "Saving...",
  saved: (circleName: string | null): string =>
    circleName ? `Thanks. It's waiting for the ${circleWords(circleName)}.` : "Thanks. It's waiting for any circle.",
  empty: "Nothing is waiting yet. Bring what needs a circle's time, and it is offered when that circle next meets.",
  broughtBy: (name: string, date: string): string => `Brought by ${name} · ${date}`,
  /** On the room's agenda row, where whoever brought it may not be in the room. */
  broughtByName: (name: string): string => `Brought by ${name}`,
  broughtByYou: (date: string): string => `Brought by you · ${date}`,
  changedBy: (name: string): string => `Words changed by ${name}`,
  takenUpLately: "Taken up lately",
  withdraw: "Withdraw it",
  withdrawConfirm: "Withdraw this item? The circle will no longer see it.",
  withdrawOnAgenda: "Withdraw this item? It stays on the agenda it is on, and the circle will no longer see it here.",
  keep: "Keep it",
  withdrawYes: "Withdraw",
  withdrawing: "Withdrawing...",
  bringAgain: "Bring it again",
  /** The start card. */
  startHint: "Choose what this session takes up. You can add more and reorder them in the room.",
  startWith: (n: number): string => (n === 1 ? "Open the room with 1 item" : `Open the room with ${n} items`),
  /** The room's card in the agenda stage. */
  roomNoCircle: SESSION_COPY.noCircle,
  addToAgenda: ROOM_COPY.addToAgenda,
  showAll: "Show all",
  showLess: "Show less",
  loadFailed: "The waiting items did not load. Try again in a moment.",
  failed: "That did not go through. Try again in a moment.",
} as const;

/**
 * The one line a card says about where it stands, keyed by the status union so
 * a status added there cannot leave a card with nothing to say. `date` is in
 * words already; `title` is the session's, only when the viewer may read it.
 */
export const LIBRARY_STATUS_LINE: Record<LibraryStatus, (s: { title: string | null; date: string | null }) => string | null> = {
  waiting: ({ date }) => (date ? `Back for next time, after a session on ${date}` : null),
  on_agenda: ({ title }) => (title ? `On the agenda of ${title}` : "On a session's agenda now"),
  taken_up: ({ title, date }) => (title && date ? `Taken up in ${title} on ${date}` : date ? `Taken up on ${date}` : "Taken up"),
};

/** The sentence each refusal carries in `{ error }`. */
export const LIBRARY_REFUSALS = {
  notFound: "That item isn't here.",
  /** Opening a room, or bringing items into one: one of them went elsewhere. Names no item. */
  moved: "One of those went onto another agenda or was withdrawn a moment ago. Here is the list as it stands now.",
  notWaiting: "It is on an agenda now, or taken up. Change it in the room.",
  wordsNotYours: "Only the person who brought it, an admin, or the facilitator or secretary of this circle's open session can change it.",
  circleNotYours: "Only the person who brought it, or an admin, can change which circle it is for.",
  withdrawNotYours: "Only the person who brought it, or an admin, can withdraw it.",
  againNotYours: "Only the person who brought it, or an admin, can bring it again.",
  notTakenUp: "Only an item a session took up can be brought again.",
  tooManyWaiting: `You have ${LIBRARY_LIMITS.waitingPerMember} items waiting. Withdraw one, or let a circle take some up first.`,
  idsNeeded: `Choose up to ${SESSION_LIMITS.maxAgenda} items.`,
  slowDown: SESSION_REFUSALS.slowDown,
} as const;

/** The words on the notices the person who brought an item receives. In the bell only. */
export const LIBRARY_NOTICES = {
  /** A session took it onto its agenda. An open room's title is read by every member. */
  taken: (sessionTitle: string): string => `Your item is on the agenda of "${sessionTitle}"`,
  /** The session closed with it finished. Never names the closed session, whose title is its people's. */
  takenUp: "An item you brought was taken up",
  /** The session closed before reaching it, and it waits again. */
  back: "An item you brought is waiting for next time",
} as const;

/** The aims a member can choose, in the room's order, for the form's select. */
export const LIBRARY_AIMS: readonly ItemAim[] = ITEM_AIMS;
