/**
 * THE ADDRESS BOOK'S ROUTES: what a person can do from a link in an email,
 * what a member can do from their account, and the People screen in Admin
 * (the comms build spec 5.3, 5.4 and 6).
 *
 * ── THE PUBLIC HALF, `registerPublic`, under `/api/comms` ──────────────────
 *
 *   GET  /api/comms/unsubscribe?t=   what the link would stop. Never acts.
 *   POST /api/comms/unsubscribe?t=   the stop. The RFC 8058 one-click POST a
 *                                    mail app sends from the List-Unsubscribe
 *                                    header, and the press on the page.
 *   GET  /api/comms/preferences?t=   every choice for one address.
 *   POST /api/comms/preferences?t=   one change.
 *   GET  /api/comms/action?t=        what a one-click answer would do.
 *   POST /api/comms/action?t=        the answer (server/lib/comms/actions.ts).
 *   GET  /api/comms/me               a signed-in member's own choices.
 *   PUT  /api/comms/me               one change, from their account.
 *
 * Registered from server/routes/commsPublic.ts, after `express.json()` and
 * with NO module gate, ever: a person must be able to stop email whatever the
 * village's comms module is set to (5.16).
 *
 * NO GET ACTS. Link scanners open every link in an email, so a GET shows what
 * a press would do and only a POST does it. The unsubscribe link's POST takes
 * its token from the address alone, because the one-click POST a mail app
 * sends carries the form field `List-Unsubscribe=One-Click` and nothing else.
 *
 * NO SIGN-IN, AND NOTHING PERSON-SHAPED OUT. These answer to a signed link,
 * which is forwarded and kept for years, so they hand back what the link can
 * change and nothing about who it belongs to: an address hint, never the
 * address, and never a name (ARCHITECTURE invariant 16).
 *
 * BOUNDED PER IP (5.4). The pages share the bucket the foundation set. The
 * one-click POST has its own, ten times wider, because it arrives from a mail
 * provider's servers: one of them unsubscribes many people from one address,
 * and refusing those is refusing a person's "stop".
 *
 * ── THE ADMIN HALF, `registerAdmin`, under `/api/admin/comms/people` ───────
 *
 * Search, a person's page, a manual suppress and its restore (a complaint's
 * restore asks why), stopping one journey, and the CSV. Registered from
 * server/routes/comms.ts, so behind the admin gates like every admin route.
 * Every route asks the one capability gate for `comms.manage`: a change
 * through `guardCapability`, a look through `mayStillSee`. Not behind the
 * module gate, for the reason comms.ts gives: People has to work while the
 * module is off, because stopping email to somebody is never an automation.
 */
import type { Express, Request, Response } from "express";
import type { OutgoingEmail } from "../../shared/comms/contracts";
import type { PermissionKind } from "../../shared/comms/kinds";
import { PERMISSION_KINDS } from "../../shared/comms/kinds";
import { KIND_WORDS, preferencesChangeOf, type UnsubscribeView } from "../../shared/comms/preferences";
import type { AppDeps } from "../lib/appDeps";
import {
  contactIdOf,
  lettersConfirmAction,
  preferencesAction,
  registerAction,
  resolveActionLink,
  type ActionContext,
} from "../lib/comms/actions";
import { ensureContact } from "../lib/comms/contacts";
import { verifyLink } from "../lib/comms/links";
import {
  answersFor,
  memberOf,
  stopEverything,
  stopJourneysOf,
  suppressionsPortFor,
  unsubscribe,
  type PeopleDeps,
} from "../lib/comms/permissions";
import { post } from "../lib/comms/postOffice";
import { applyPreferencesChange, preferencesToken, preferencesView, type PreferencesDeps } from "../lib/comms/preferences";
import { stop as stopJourney } from "../lib/comms/journeys";
import { recordEvent } from "../lib/events";
import { contactById } from "../repos/commsContacts";
import { enrollmentById } from "../repos/commsJourneys";
import {
  enrollmentsForContact,
  messagesForContact,
  peopleForCsv,
  personContact,
  searchPeople,
  suppressionOf,
} from "../repos/commsPeople";

export type PublicDeps = Pick<
  AppDeps,
  "overLimit" | "clientIp" | "authedUser" | "getPool" | "members" | "commsPostOffice" | "deploymentOrigin" | "projectName"
>;

export type AdminDeps = Pick<AppDeps, "authedUser" | "guardCapability" | "mayStillSee" | "getPool" | "members" | "adminActor">;

/** The pages' bucket, shared with server/routes/commsPublic.ts. */
export const PER_IP = 60;
export const WINDOW_MS = 10 * 60 * 1000;
/** The one-click POST's bucket: a mail provider's servers speak for many people. */
export const ONE_CLICK_PER_IP = 600;
/** A signed-in member's own changes, counted per member. */
const PER_MEMBER = 120;

const tooMany = (res: Response) =>
  res.status(429).set("Retry-After", "600").json({ error: "Too many requests. Try again in a few minutes." });

/** The sentence for a link that is forged, altered, expired, or for something else. */
export const BAD_LINK = "This link does not work any more. Open the newest email from the village and use the link in it.";
const GONE = "We no longer hold this address, so there is nothing to change.";

const tokenOf = (req: Request): string => (typeof req.query.t === "string" ? req.query.t : "");
const isKind = (v: unknown): v is PermissionKind => (PERMISSION_KINDS as readonly unknown[]).includes(v);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The address book's dependencies, built from a route module's. */
function peopleDepsOf(d: Pick<AppDeps, "getPool" | "members">): PeopleDeps {
  return { getPool: d.getPool, members: d.members, suppressions: suppressionsPortFor(d.getPool) };
}

function preferencesDepsOf(d: PublicDeps): PreferencesDeps {
  return {
    ...peopleDepsOf(d),
    projectName: d.projectName,
    letters: {
      post: (email: OutgoingEmail) => post(d.commsPostOffice, email),
      origin: d.deploymentOrigin,
      projectName: d.projectName,
    },
  };
}

const villageOf = (d: { projectName(): string }) => String(d.projectName() ?? "").trim() || "the village";

// ── The public half ─────────────────────────────────────────────────────────

export function registerPublic(app: Express, deps: PublicDeps): void {
  const { overLimit, clientIp, authedUser } = deps;
  const people = preferencesDepsOf(deps);
  const ctx = (): ActionContext => ({ village: villageOf(deps) });
  const limited = async (req: Request, res: Response): Promise<boolean> => {
    if (await overLimit(`comms-public:${clientIp(req)}`, PER_IP, WINDOW_MS)) {
      tooMany(res);
      return true;
    }
    return false;
  };

  registerAction(lettersConfirmAction(people));
  registerAction(preferencesAction(people));

  /** The contact and the kind an unsubscribe link names, or null. */
  const unsubscribeLink = (req: Request): { contactId: string; kind: PermissionKind | "all" } | null => {
    const payload = verifyLink("unsubscribe", tokenOf(req));
    const contactId = payload ? contactIdOf(payload) : null;
    if (!payload || !contactId) return null;
    // A link that names no kind, or one nothing can stop, asks to stop everything:
    // under-honouring an unsubscribe is the one way this may never be wrong.
    return { contactId, kind: isKind(payload.k) ? payload.k : "all" };
  };

  app.get("/api/comms/unsubscribe", async (req, res) => {
    if (await limited(req, res)) return;
    const link = unsubscribeLink(req);
    if (!link) return res.status(400).json({ error: BAD_LINK });
    const contact = await contactById(deps.getPool(), link.contactId);
    if (!contact) return res.status(404).json({ error: GONE });
    const held = await suppressionOf(deps.getPool(), contact.emailKey);
    let done = held !== null;
    if (!done && link.kind !== "all") {
      const answers = await answersFor(people, contact);
      done = answers[link.kind].state === "no";
    }
    const view: UnsubscribeView = {
      village: villageOf(deps),
      kind: link.kind,
      label: link.kind === "all" ? "Every email" : KIND_WORDS[link.kind].label,
      done,
      preferencesToken: preferencesToken(contact.id),
    };
    res.json({ view });
  });

  app.post("/api/comms/unsubscribe", async (req, res) => {
    if (await overLimit(`comms-unsubscribe:${clientIp(req)}`, ONE_CLICK_PER_IP, WINDOW_MS)) return tooMany(res);
    const link = unsubscribeLink(req);
    if (!link) return res.status(400).json({ error: BAD_LINK });
    const contact = await contactById(deps.getPool(), link.contactId);
    // Nothing is held for this address, so nothing will be sent to it: the
    // stop the person asked for is already true.
    if (!contact) return res.json({ ok: true, kind: link.kind, sentence: "Done. We hold nothing for this address." });
    const result =
      link.kind === "all"
        ? await stopEverything(people, { contactId: contact.id })
        : await unsubscribe(people, { contactId: contact.id, kind: link.kind, basis: "asked", source: "unsubscribe" });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    const what = link.kind === "all" ? "any email except the kind you ask for" : lower(KIND_WORDS[link.kind].label);
    res.json({
      ok: true,
      kind: link.kind,
      sentence: `Done. You will not get ${what} from ${villageOf(deps)}.`,
      preferencesToken: preferencesToken(contact.id),
    });
  });

  app.get("/api/comms/preferences", async (req, res) => {
    if (await limited(req, res)) return;
    const payload = verifyLink("preferences", tokenOf(req));
    const contactId = payload ? contactIdOf(payload) : null;
    if (!contactId) return res.status(400).json({ error: BAD_LINK });
    const view = await preferencesView(people, contactId);
    if (!view) return res.status(404).json({ error: GONE });
    res.json({ view });
  });

  app.post("/api/comms/preferences", async (req, res) => {
    if (await limited(req, res)) return;
    const payload = verifyLink("preferences", tokenOf(req));
    const contactId = payload ? contactIdOf(payload) : null;
    if (!contactId) return res.status(400).json({ error: BAD_LINK });
    const change = preferencesChangeOf(req.body);
    if (!change) return res.status(400).json({ error: "That is not a change this page can make." });
    const outcome = await applyPreferencesChange(people, contactId, change, "link");
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    res.json({ view: outcome.view, notice: outcome.notice });
  });

  app.get("/api/comms/action", async (req, res) => {
    if (await limited(req, res)) return;
    const found = resolveActionLink(tokenOf(req));
    if (!found) return res.status(400).json({ error: BAD_LINK });
    const description = await found.handler.describe(found.payload, ctx());
    if (!description) return res.status(404).json({ error: "What this link was about is not here any more." });
    res.json({ purpose: found.purpose, description });
  });

  app.post("/api/comms/action", async (req, res) => {
    if (await limited(req, res)) return;
    const found = resolveActionLink(tokenOf(req));
    if (!found) return res.status(400).json({ error: BAD_LINK });
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {};
    const result = await found.handler.act(found.payload, body, ctx());
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ purpose: found.purpose, outcome: result.outcome });
  });

  /** The signed-in member's own contact, made when it is missing. */
  const myContact = async (req: Request, res: Response): Promise<string | null> => {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "Sign in to choose your email" });
      return null;
    }
    if (await overLimit(`comms-me:${user.id}`, PER_MEMBER, WINDOW_MS)) {
      tooMany(res);
      return null;
    }
    const contact = await ensureContact(people, { email: String(user.email ?? ""), name: user.name ?? null, userId: user.id, source: "account" });
    if (!contact) {
      res.status(409).json({ error: "Your account's address cannot receive email. Change it in your profile first." });
      return null;
    }
    return contact.id;
  };

  app.get("/api/comms/me", async (req, res) => {
    const contactId = await myContact(req, res);
    if (!contactId) return;
    const view = await preferencesView(people, contactId);
    if (!view) return res.status(404).json({ error: GONE });
    res.json({ view, preferencesToken: preferencesToken(contactId) });
  });

  app.put("/api/comms/me", async (req, res) => {
    const contactId = await myContact(req, res);
    if (!contactId) return;
    const change = preferencesChangeOf(req.body);
    if (!change) return res.status(400).json({ error: "That is not a change this page can make." });
    const outcome = await applyPreferencesChange(people, contactId, change, "account");
    if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error });
    res.json({ view: outcome.view, notice: outcome.notice });
  });
}

// ── The admin half ──────────────────────────────────────────────────────────

const APPOINTMENT = { error: "Running the village's email is an appointment" };

/** One CSV cell: quoted when it must be, and never read as a formula by a spreadsheet. */
export function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const isoDay = (epochSeconds: number) => new Date(epochSeconds * 1000).toISOString().slice(0, 10);

export function registerAdmin(app: Express, deps: AdminDeps): void {
  const { authedUser, guardCapability, mayStillSee, getPool, adminActor } = deps;
  const people = peopleDepsOf(deps);

  const mayLook = async (req: Request, res: Response): Promise<boolean> => {
    if (!(await authedUser(req))) {
      res.status(401).json({ error: "Sign in to see the village's email" });
      return false;
    }
    if (!(await mayStillSee(req, "comms.manage"))) {
      res.status(403).json(APPOINTMENT);
      return false;
    }
    return true;
  };
  const mayAct = (req: Request, res: Response) => guardCapability(req, res, "comms.manage", { status: 403, body: APPOINTMENT });
  const actorOf = async (req: Request) => (await authedUser(req))?.id ?? adminActor(req)?.id ?? "admin";

  app.get("/api/admin/comms/people", async (req, res) => {
    if (!(await mayLook(req, res))) return;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 200) : "";
    const { rows, total } = await searchPeople(getPool(), { q, limit, offset });
    res.json({ people: rows, total, limit, offset });
  });

  /** The whole address book as a spreadsheet. A look, and written down because it is every address at once. */
  app.get("/api/admin/comms/people-export", async (req, res) => {
    if (!(await mayLook(req, res))) return;
    const rows = await peopleForCsv(getPool());
    const answer = (r: (typeof rows)[number], kind: string) => r.answers.find((a) => a.kind === kind)?.state ?? "";
    const lines = [
      ["email", "name", "member", "first_source", "added", "events", "paths", "letters", "suppressed"].join(","),
      ...rows.map((r) =>
        [
          r.email,
          r.name ?? "",
          r.userId ? "yes" : "no",
          r.firstSource,
          isoDay(r.createdAt),
          answer(r, "events"),
          answer(r, "paths"),
          answer(r, "letters"),
          r.suppression ?? "",
        ]
          .map(csvCell)
          .join(","),
      ),
    ];
    await recordEvent(getPool(), {
      kind: "audit",
      text: `comms:people-exported:${rows.length}`,
      actorUserId: await actorOf(req),
      entityType: "comms",
      entityRef: "people",
      audience: "admin",
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="people.csv"');
    res.send(`${lines.join("\r\n")}\r\n`);
  });

  app.get("/api/admin/comms/people/:id", async (req, res) => {
    if (!(await mayLook(req, res))) return;
    const pool = getPool();
    const contact = await personContact(pool, String(req.params.id));
    if (!contact) return res.status(404).json({ error: "Nobody by that id is in the address book." });
    const asRow = { ...contact };
    const member = await memberOf(people, asRow);
    const answers = await answersFor(people, asRow, member);
    res.json({
      person: contact,
      member: member ? { id: String(member.id), name: String(member.name ?? "") } : null,
      answers: PERMISSION_KINDS.map((k) => ({
        ...answers[k],
        pausedUntil: answers[k].pausedUntil ? new Date(answers[k].pausedUntil as number).toISOString() : null,
      })),
      suppression: await suppressionOf(pool, contact.emailKey),
      emails: await messagesForContact(pool, contact.id),
      journeys: await enrollmentsForContact(pool, contact.id),
    });
  });

  app.post("/api/admin/comms/people/:id/suppress", async (req, res) => {
    if (!(await mayAct(req, res))) return;
    const contact = await personContact(getPool(), String(req.params.id));
    if (!contact) return res.status(404).json({ error: "Nobody by that id is in the address book." });
    const detail = typeof req.body?.detail === "string" ? req.body.detail.trim().slice(0, 500) : "";
    await people.suppressions.addSuppression(contact.emailKey, "manual", detail || null, await actorOf(req));
    const stopped = await stopJourneysOf(people, contact.id, "all", "suppressed");
    res.json({ ok: true, stopped, suppression: await suppressionOf(getPool(), contact.emailKey) });
  });

  /**
   * Lift a suppression. A complaint is a person having said "this is spam",
   * so lifting one asks for the reason, and the reason is written into the
   * village's admin record beside who lifted it.
   */
  app.post("/api/admin/comms/people/:id/restore", async (req, res) => {
    if (!(await mayAct(req, res))) return;
    const pool = getPool();
    const contact = await personContact(pool, String(req.params.id));
    if (!contact) return res.status(404).json({ error: "Nobody by that id is in the address book." });
    const held = await suppressionOf(pool, contact.emailKey);
    if (!held) return res.json({ ok: true, restored: false });
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 400) : "";
    if (held.reason === "complained" && !reason) {
      return res.status(400).json({
        error: "This address marked one of the village's emails as spam. Say why it is right to write to it again.",
      });
    }
    await people.suppressions.removeSuppression(contact.emailKey);
    await recordEvent(pool, {
      kind: "audit",
      text: `comms:suppression-lifted:${held.reason}${reason ? `: ${reason}` : ""}`,
      actorUserId: await actorOf(req),
      entityType: "comms_contact",
      entityRef: contact.id,
      audience: "admin",
    });
    res.json({ ok: true, restored: true, was: held.reason });
  });

  app.post("/api/admin/comms/people/:id/journeys/:enrollmentId/stop", async (req, res) => {
    if (!(await mayAct(req, res))) return;
    const pool = getPool();
    const enrollment = await enrollmentById(pool, String(req.params.enrollmentId));
    if (!enrollment || enrollment.contactId !== String(req.params.id)) {
      return res.status(404).json({ error: "That journey is not this person's." });
    }
    const stopped = await stopJourney(
      { getPool },
      { journeyKey: enrollment.journeyKey, contactId: enrollment.contactId, subjectRef: enrollment.subjectRef },
      "stopped_by_admin",
    );
    res.json({ ok: true, stopped });
  });
}
