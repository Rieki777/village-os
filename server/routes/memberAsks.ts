/**
 * ASKS: one member asks another (shared/memberAsks.ts holds the rules, 0299
 * the table).
 *
 *   POST /api/asks                 ask someone
 *   GET  /api/asks                 what waits on the reader, and the reader's own asks
 *   GET  /api/asks/people?q=       current members to ask, by name
 *   POST /api/asks/:id/done        the asked member did it
 *   POST /api/asks/:id/not-mine    the asked member hands it back
 *   POST /api/asks/:id/withdraw    the asker takes it back
 *
 * WHO SEES AN ASK: only its two members. Every read is keyed on the reader's
 * own id, and every write first reads the row and refuses anyone who is not
 * the member the door belongs to, with the same 404 a missing ask gets, so a
 * third member cannot even learn that an id exists.
 *
 * BOTH MEMBERS ARE CURRENT MEMBERS. A former member or an erased account is
 * never asked, and somebody the village has not let in cannot ask.
 */
import type { Express } from "express";

import type { AppDeps } from "../lib/appDeps";
import { isAdmitted } from "../lib/admission";
import { leftTheVillage } from "../lib/formerMember";
import { isTombstone } from "../lib/oauthAccounts";
import { villageDate } from "../lib/sessionTasks";
import { GAME_CONFIG } from "../../shared/gameConfig";
import { sortMembersByName } from "../../shared/memberOrder";
import {
  ASKS_URL,
  NOTE_MAX,
  cleanDueOn,
  cleanLink,
  rankAsks,
  refuseAskInput,
  refuseBlockingCap,
  refuseHandedBackAgain,
  tierOf,
  type AskView,
  type AsksPayload,
} from "../../shared/memberAsks";
import {
  asksBy,
  closeAsk,
  handedBackBefore,
  insertAsk,
  openAsksFor,
  openBlockingCount,
  readAsk,
  type StoredAsk,
} from "../repos/memberAsks";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "members" | "notify" | "overLimit" | "firstName">;

/** New asks one member may send in an hour. Generous for a person, a wall for a script. */
const ASKS_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;

const newId = (): string => `ask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const NOT_FOUND = { error: "There is no ask here for you." };
const MEMBERS_ONLY = { error: "Asking opens once the village has let you in." };

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, members, notify, overLimit, firstName } = deps;

  /** A person the village has let in, who has not left and is not an erased account. */
  const isCurrentMember = async (person: any): Promise<boolean> =>
    !!person &&
    !isTombstone({ email: String(person.email ?? "") }) &&
    isAdmitted(person, GAME_CONFIG.stages) &&
    !(await leftTheVillage(getPool(), person));

  const nameOf = async (id: string): Promise<string> => {
    const m = await members.byId(id);
    return m?.name ? firstName(String(m.name)) : "A member";
  };

  const view = async (a: StoredAsk, otherId: string, today: string): Promise<AskView> => ({
    id: a.id,
    link: a.link,
    why: a.why,
    dueOn: a.dueOn,
    blocking: a.blocking,
    status: a.status,
    otherName: await nameOf(otherId),
    askedOn: villageDate(a.createdAt),
    handBackNote: a.handBackNote,
    tier: tierOf(a, today),
  });

  app.post(ASKS_URL, async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (!(await isCurrentMember(user))) return res.status(403).json(MEMBERS_ONLY);
    const body = req.body ?? {};
    const refused = refuseAskInput(String(user.id), body);
    if (refused) return res.status(refused.status).json({ error: refused.error });
    if (await overLimit(`member-ask:${user.id}`, ASKS_PER_HOUR, HOUR_MS)) {
      return res.status(429).json({ error: "That is a lot of asks in one hour. Try again a little later." });
    }

    const askedUserId = String(body.askedUserId).trim();
    const asked = await members.byId(askedUserId);
    // A former member and an erased account answer the same as nobody at all.
    if (!asked || !(await isCurrentMember(asked))) {
      return res.status(404).json({ error: "There is no current member by that name to ask." });
    }

    const pool = getPool();
    const link = cleanLink(body.link) as string;
    const blocking = body.blocking === true;
    const capped = refuseBlockingCap(blocking ? await openBlockingCount(pool, String(user.id)) : 0, blocking);
    if (capped) return res.status(capped.status).json({ error: capped.error });
    const loop = refuseHandedBackAgain(await handedBackBefore(pool, String(user.id), askedUserId, link));
    if (loop) return res.status(loop.status).json({ error: loop.error });

    const id = newId();
    await insertAsk(pool, {
      id,
      askerUserId: String(user.id),
      askedUserId,
      link,
      why: String(body.why).trim(),
      dueOn: cleanDueOn(body.dueOn) ?? null,
      blocking,
    });
    await notify({
      userId: askedUserId,
      type: "ask",
      title: blocking ? `${firstName(String(user.name ?? ""))} is stuck until you do something` : `${firstName(String(user.name ?? ""))} asked you something`,
      body: String(body.why).trim(),
      link: "/profile#waiting",
      actorUserId: String(user.id),
      dedupeKey: `ask:${id}:asked:${askedUserId}`,
    });
    const stored = await readAsk(pool, id);
    return res.status(201).json({ ask: stored ? await view(stored, askedUserId, villageDate(new Date())) : null });
  });

  app.get(ASKS_URL, async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const pool = getPool();
    const today = villageDate(new Date());
    const waiting = await openAsksFor(pool, String(user.id));
    const mine = await asksBy(pool, String(user.id));
    const payload: AsksPayload = {
      waitingOnYou: rankAsks(await Promise.all(waiting.map((a) => view(a, a.askerUserId, today)))),
      yourAsks: await Promise.all(mine.map((a) => view(a, a.askedUserId, today))),
    };
    return res.json(payload);
  });

  /**
   * Current members to ask, by name. A search, the way the message composer
   * finds a person, so no signed-in account is handed the whole roster.
   */
  app.get(`${ASKS_URL}/people`, async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const q = String(req.query.q ?? "").trim().toLowerCase();
    if (q.length < 2) return res.json([]);
    const named = (await members.all()).filter(
      (u: any) =>
        String(u.id) !== String(user.id) &&
        (String(u.name ?? "").toLowerCase().includes(q) || String(u.handle ?? "").toLowerCase().includes(q)),
    );
    const current: any[] = [];
    for (const u of sortMembersByName(named)) {
      if (current.length >= 10) break;
      if (await isCurrentMember(u)) current.push(u);
    }
    return res.json(current.map((u) => ({ userId: String(u.id), name: firstName(String(u.name ?? "Member")), handle: u.handle ?? null })));
  });

  /** Read the ask for the member this door belongs to, or answer 404 for everyone else. */
  const askFor = async (req: any, res: any, side: "asked" | "asker"): Promise<{ user: any; ask: StoredAsk } | null> => {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required" });
      return null;
    }
    const ask = await readAsk(getPool(), String(req.params.id ?? ""));
    const mine = ask && (side === "asked" ? ask.askedUserId : ask.askerUserId) === String(user.id);
    if (!ask || !mine) {
      res.status(404).json(NOT_FOUND);
      return null;
    }
    if (ask.status !== "open") {
      res.status(409).json({ error: "This ask is already closed." });
      return null;
    }
    return { user, ask };
  };

  app.post(`${ASKS_URL}/:id/done`, async (req, res) => {
    const found = await askFor(req, res, "asked");
    if (!found) return;
    const { user, ask } = found;
    if (!(await closeAsk(getPool(), ask.id, "done"))) return res.status(409).json({ error: "This ask is already closed." });
    await notify({
      userId: ask.askerUserId,
      type: "ask",
      title: `${firstName(String(user.name ?? ""))} did what you asked`,
      body: ask.why,
      link: "/profile#your-asks",
      actorUserId: String(user.id),
      dedupeKey: `ask:${ask.id}:done:${ask.askerUserId}`,
    });
    return res.json({ ok: true });
  });

  app.post(`${ASKS_URL}/:id/not-mine`, async (req, res) => {
    const found = await askFor(req, res, "asked");
    if (!found) return;
    const { user, ask } = found;
    const note = String(req.body?.note ?? "").trim().slice(0, NOTE_MAX) || null;
    if (!(await closeAsk(getPool(), ask.id, "handed_back", note))) {
      return res.status(409).json({ error: "This ask is already closed." });
    }
    await notify({
      userId: ask.askerUserId,
      type: "ask",
      title: `${firstName(String(user.name ?? ""))} says this one is not theirs`,
      body: note ?? ask.why,
      link: "/profile#your-asks",
      actorUserId: String(user.id),
      dedupeKey: `ask:${ask.id}:handed-back:${ask.askerUserId}`,
    });
    return res.json({ ok: true });
  });

  app.post(`${ASKS_URL}/:id/withdraw`, async (req, res) => {
    const found = await askFor(req, res, "asker");
    if (!found) return;
    if (!(await closeAsk(getPool(), found.ask.id, "withdrawn"))) {
      return res.status(409).json({ error: "This ask is already closed." });
    }
    return res.json({ ok: true });
  });
}
