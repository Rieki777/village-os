/**
 * THE END-OF-MOON REVIEW, the member's doors (module moon-review, lane B).
 *
 *   GET   /api/me/moon?cycle=                 my moon: recap, items, coverage, the invoice draft
 *   POST  /api/me/moon/:cycle/gather          bring in my tasks: the board first, then the rooms
 *   POST  /api/me/moon/:cycle/ask-sera        the Sera draft, in-process; poll GET /api/me/moon
 *   POST  /api/me/moon/:cycle/send-invoice    the draft invoice, with the member's own invoice number
 *   POST  /api/me/moon/:cycle/import          a moon pack: preview, then confirm with its hash (A2)
 *   POST  /api/me/moon/:cycle/items           add an item by hand
 *   PATCH /api/me/moon/items/:id              edit one of my items
 *   POST  /api/me/moon/:cycle/send-recap      send my recap; needs no pay route
 *   POST  /api/me/moon/:cycle/take-back       back to Draft, both approvals cleared
 *   GET   /api/me/pay-route                   my pay route and who can read it
 *   PUT   /api/me/pay-route                   set it; a change clears its confirmation
 *   GET   /api/members/:handle/moon?cycle=    another member's sent recap, as `memberView` reads it
 *
 * `:cycle` is a cycle id from the village clock, or `open` for the moon
 * running now. A moon that has not begun is no moon.
 *
 * EVERY PREFIX IS MOUNTED BEHIND `requireModule("moon-review")` FIRST, the way
 * server/routes/badges.ts does it: Express applies middleware in registration
 * order, so a `use` after the routes guards nothing. The module ships off, so
 * every door here is a 404 until a village turns it on. The members' door is
 * under `/api/members`, which belongs to nobody else's module, so it takes its
 * own `use` on its own path.
 *
 * NO CAPABILITY HERE. Every door is the member's own (or, for the members'
 * view, any signed-in member's). The approver doors are in
 * server/routes/moonReview.ts, registered from here behind the same gates.
 *
 * Every sentence a member reads comes from shared/moonRecap.ts. An error that
 * has no sentence there answers a machine code.
 */
import type { Express, Request, Response } from "express";
import type { AppDeps } from "../lib/appDeps";
import { MOON_API_PREFIXES, MOON_REVIEW_MODULE, MOON_ROUTES, type GatherResponse } from "../../shared/moonRecap";
import { civilDateKey } from "../../shared/lunar";
import { requireModule, effectiveLifecycle } from "../lib/modules";
import { preflight } from "../lib/saberraSync";
import { askSera } from "../lib/moonRecapSera";
import { importPack, sendInvoice, type KeyHolders } from "../lib/moonReview";
import { registerReviewDoors } from "./moonReview";
import { activeClock } from "../lib/gratitude-cycles";
import { recordEvent } from "../lib/events";
import { accomplishmentsOf } from "../lib/sessionTasks";
import { userIdForHandle } from "../lib/profile";
import {
  addItem, editItem, gatherMoon, invoiceViewOf, loadFrame, memberMoon, myMoon, payRouteResponse, payersDoc, putPayRoute,
  resolveMoon, defaultCycleId, rhythmDoc, sendRecap, settingsDoc, takeBack, type Moon,
} from "../lib/moonRecap";
import * as store from "../repos/moonRecaps";
import { exportMoonReviews, forgetMoonReviews } from "../repos/moonRecaps";

/** The member's data export and the erasure sweep read these through this module. */
export { exportMoonReviews, forgetMoonReviews };

export type Deps = Pick<AppDeps, "authedUser" | "getPool" | "overLimit" | "seasonState" | "lapseContext" | "members" | "notify" | "mayAct"> & {
  /** Who holds `cash.pay` through a role or a badge, admins left out (`liveHoldersOf`, server/index.ts). */
  cashKeyHolders: () => Promise<string[]>;
  /** Who holds any key through a live seat, admins left out (`liveHoldersOf`, server/index.ts). */
  keyHolders: KeyHolders;
};

/** The members' door, which no prefix in MOON_API_PREFIXES covers. */
export const MEMBER_MOON_PATH = MOON_ROUTES.memberMoon;

export function register(app: Express, deps: Deps): void {
  for (const prefix of MOON_API_PREFIXES) app.use(prefix, requireModule(MOON_REVIEW_MODULE));
  app.use(MEMBER_MOON_PATH, requireModule(MOON_REVIEW_MODULE));

  const { authedUser, getPool, overLimit, members } = deps;
  const timeZone = () => deps.seasonState().timezone || "UTC";
  const frameDeps = () => ({ timeZone: timeZone(), seasons: deps.seasonState().seasons ?? [] });

  const member = async (req: Request, res: Response): Promise<string | null> => {
    const user = await authedUser(req);
    if (!user?.id) {
      res.status(401).json({ error: "auth_required" });
      return null;
    }
    return String(user.id);
  };

  /** A write: signed in, and bounded per member. */
  const writer = async (req: Request, res: Response): Promise<string | null> => {
    const uid = await member(req, res);
    if (!uid) return null;
    if (await overLimit(`moon-review:${uid}`, 240, 60 * 60 * 1000)) {
      res.status(429).json({ error: "rate_limited" });
      return null;
    }
    return uid;
  };

  const moonFor = async (raw: unknown, res: Response): Promise<Moon | null> => {
    const id = typeof raw === "string" && raw && raw !== "open" ? raw.slice(0, 32) : null;
    const rhythm = getPool() ? await rhythmDoc(getPool()).catch(() => undefined) : undefined;
    const moon = resolveMoon(activeClock(), id, timeZone(), new Date(), rhythm);
    if (!moon) res.status(404).json({ error: "unknown_moon" });
    return moon;
  };
  const nextCycleId = (moon: Moon) => activeClock().boundsFor(new Date(moon.bounds.endsAt.getTime() + 1000)).id;
  const nameOf = async (id: string) => String((await members.byId(String(id)).catch(() => null))?.name ?? "A member");

  const cashPayHolderNames = async (): Promise<string[]> => {
    const ids = await deps.cashKeyHolders().catch(() => [] as string[]);
    const names: string[] = [];
    for (const id of ids) {
      const m = await members.byId(String(id)).catch(() => null);
      if (m?.name) names.push(String(m.name));
    }
    return names;
  };

  const today = () => civilDateKey(new Date(), timeZone());

  const fail = (res: Response, out: { status: number; error: string }) => res.status(out.status).json({ error: out.error });

  app.get(MOON_ROUTES.myMoon, async (req, res) => {
    const uid = await member(req, res);
    if (!uid) return;
    const pool = getPool();
    const asked = (req.query as Record<string, unknown>)?.cycle;
    const cycle = typeof asked === "string" && asked ? asked : defaultCycleId(activeClock(), await store.recapsOf(pool, uid));
    const moon = await moonFor(cycle, res);
    if (!moon) return;
    res.json(await myMoon(pool, uid, moon, { ...frameDeps(), clock: activeClock(), cashPayHolderNames }));
  });

  app.post(MOON_ROUTES.gather, async (req, res) => {
    const uid = await writer(req, res);
    if (!uid) return;
    const moon = await moonFor(req.params.cycle, res);
    if (!moon) return;
    const pool = getPool();
    const frame = await loadFrame(pool, uid, moon, frameDeps());
    const { recap, added } = await gatherMoon(pool, uid, moon, frame, {
      ...frameDeps(),
      accomplishments: (ownerId) => accomplishmentsOf(pool, ownerId, { lapseContext: deps.lapseContext }),
    });
    const body: GatherResponse = { added, items: await store.itemsOf(pool, recap.id) };
    res.json(body);
  });

  // On (Rye, 3 November): one ask_sera call, its progress polled through GET /api/me/moon.
  app.post(MOON_ROUTES.askSera, async (req, res) => {
    const uid = await writer(req, res);
    if (!uid) return;
    const moon = await moonFor(req.params.cycle, res);
    if (!moon) return;
    const pool = getPool();
    const out = await askSera(pool, uid, moon, await loadFrame(pool, uid, moon, frameDeps()), {
      client: () => {
        const pre = preflight();
        return pre.ok ? pre.client : null;
      },
      nameOf,
    });
    if (!out.ok) return fail(res, out);
    res.json(out.value);
  });

  app.post(MOON_ROUTES.sendInvoice, async (req, res) => {
    const uid = await writer(req, res);
    if (!uid) return;
    const moon = await moonFor(req.params.cycle, res);
    if (!moon) return;
    const pool = getPool();
    const out = await sendInvoice(pool, uid, moon, await loadFrame(pool, uid, moon, frameDeps()), req.body, { notify: deps.notify, keyHolders: deps.keyHolders });
    if (!out.ok) return fail(res, out);
    res.json(out.value);
  });

  app.post(MOON_ROUTES.importPack, async (req, res) => {
    const uid = await writer(req, res);
    if (!uid) return;
    const moon = await moonFor(req.params.cycle, res);
    if (!moon) return;
    const pool = getPool();
    const out = await importPack(pool, uid, moon, await loadFrame(pool, uid, moon, frameDeps()), req.body, {
      nextCycleId: nextCycleId(moon),
      members: async () => (await members.all()).map((m: any) => ({ userId: String(m.id), name: String(m.name ?? "") })),
    });
    if (!out.ok) return fail(res, out);
    res.json(out.value);
  });

  app.post(MOON_ROUTES.addItem, async (req, res) => {
    const uid = await writer(req, res);
    if (!uid) return;
    const moon = await moonFor(req.params.cycle, res);
    if (!moon) return;
    const pool = getPool();
    const out = await addItem(pool, uid, moon, await loadFrame(pool, uid, moon, frameDeps()), req.body);
    if (!out.ok) return fail(res, out);
    res.status(201).json(out.value);
  });

  app.patch(MOON_ROUTES.editItem, async (req, res) => {
    const uid = await writer(req, res);
    if (!uid) return;
    const pool = getPool();
    const heldRoleIdsOf = async (cycleId: string) => {
      const moon = resolveMoon(activeClock(), cycleId, timeZone());
      return moon ? (await loadFrame(pool, uid, moon, frameDeps())).roles.map((r) => r.roleId) : [];
    };
    const out = await editItem(pool, uid, String(req.params.id ?? ""), req.body, heldRoleIdsOf);
    if (!out.ok) return fail(res, out);
    res.json(out.value);
  });

  const audit = (e: Parameters<typeof recordEvent>[1]) => recordEvent(getPool(), e);

  app.post(MOON_ROUTES.sendRecap, async (req, res) => {
    const uid = await writer(req, res);
    if (!uid) return;
    const moon = await moonFor(req.params.cycle, res);
    if (!moon) return;
    const pool = getPool();
    const out = await sendRecap(pool, uid, moon, await loadFrame(pool, uid, moon, frameDeps()), req.body, {
      recordEvent: audit,
      tensionDeps: { notify: deps.notify, timeZone, sessionsOn: () => effectiveLifecycle("sessions") !== "off" },
    });
    if (!out.ok) return fail(res, out);
    res.json(out.value);
  });

  app.post(MOON_ROUTES.takeBack, async (req, res) => {
    const uid = await writer(req, res);
    if (!uid) return;
    const moon = await moonFor(req.params.cycle, res);
    if (!moon) return;
    const pool = getPool();
    const frame = await loadFrame(pool, uid, moon, frameDeps());
    const route = await store.payRouteOf(pool, uid);
    const payers = await payersDoc(pool);
    const settings = await settingsDoc(pool);
    const out = await takeBack(pool, uid, moon, { recordEvent: audit }, (stored) => invoiceViewOf({ stored, terms: frame.terms, moon, route, payers, settings, today: today() }));
    if (!out.ok) return fail(res, out);
    res.json(out.value);
  });

  app.get(MOON_ROUTES.payRoute, async (req, res) => {
    const uid = await member(req, res);
    if (!uid) return;
    res.json(await payRouteResponse(getPool(), uid, await cashPayHolderNames()));
  });

  app.put(MOON_ROUTES.payRoute, async (req, res) => {
    const uid = await writer(req, res);
    if (!uid) return;
    const out = await putPayRoute(getPool(), uid, req.body);
    if (!out.ok) return fail(res, out);
    res.json(await payRouteResponse(getPool(), uid, await cashPayHolderNames()));
  });

  app.get(MOON_ROUTES.memberMoon, async (req, res) => {
    const reader = await member(req, res);
    if (!reader) return;
    const pool = getPool();
    const handle = String(req.params.handle ?? "").replace(/^@/, "").slice(0, 64);
    const ownerId = handle ? await userIdForHandle(pool, handle) : null;
    if (!ownerId) return res.status(404).json({ error: "not_found" });
    const moon = await moonFor((req.query as Record<string, unknown>)?.cycle ?? null, res);
    if (!moon) return;
    res.json(await memberMoon(pool, ownerId, moon, {
      ...frameDeps(),
      // `accomplishmentsOf` read AS the reader: only the room tasks `canSeeTask` lets them see.
      visibleRoomEntries: async () => {
        const moons = await accomplishmentsOf(pool, ownerId, { lapseContext: deps.lapseContext }, { viewer: { userId: reader, admin: false } });
        return new Set(moons.flatMap((m) => m.items.map((a) => a.entryId)));
      },
    }));
  });

  registerReviewDoors(app, { ...deps, moonFor, nextCycleId, nameOf, frameDeps });
}
