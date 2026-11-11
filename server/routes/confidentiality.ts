/**
 * THE CONFIDENTIALITY AGREEMENT, AND THE AGREEMENTS BEFORE A ROLE STARTS (role journey L7).
 *
 *   GET  /api/confidentiality           the village's agreement now: title, words, version,
 *                                       and for a signed-in member whether they hold it
 *   POST /api/profile/confidentiality   align with it {version}: one click, identity re-confirmed
 *
 * The words are the village's own, written in Admin as the `confidentiality`
 * content section (shared/confidentiality.ts). Reading them is public, like the
 * membership letter: the agreement carries the village's words and nothing about
 * any member. Aligning is a member's own act from their account, and asks the
 * village's identity re-confirm when the last one is older than fifteen
 * minutes, the confirmation the alignments door already serves
 * (`POST /api/profile/alignments/confirm`), so the page reuses its panel.
 *
 * This module also installs, at boot:
 *   - the role start gate the seating path asks (server/lib/roleStartAgreements.ts);
 * and serves `holdsConfidentiality`, which the capability context reads for
 * `records.confidential` (shared/capabilities.ts).
 *
 * REGISTERED from server/index.ts with one line. No `recordEvent`: the
 * alignment row is the record.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Express, Request } from "express";
import multer from "multer";
import { ALIGN_WORDS, RECONFIRM_FRESH_MS } from "../../shared/alignments";
import {
  AGREEMENT_DOCUMENT_HREF,
  AGREEMENT_DOCUMENT_MAX_BYTES,
  CONFIDENTIALITY_SECTION,
  CONFIDENTIALITY_WORDS,
  documentOf,
  type ServedAgreement,
} from "../../shared/confidentiality";
import { dbDocument } from "../repos/store-db";
import { storedFileProblem } from "../lib/villageDocuments";
import type { AppDeps } from "../lib/appDeps";
import { alignConfidentiality, currentAgreement, holdsCurrentAgreement } from "../lib/confidentiality";
import { confirmedUntil, confirmWithFor } from "../lib/identityConfirm";
import { installRoleStartGate, makeRoleStartGate, roleStartDials, stepHref, stepsBeforeStart, type StartStep } from "../lib/roleStartAgreements";
import { seatNamesFor } from "../lib/alignmentSubjects";
import { seasonSaved } from "../lib/seasonTurn";
import { applicationsOfCandidates, inApplicationTransaction, seatingsEverHolding } from "../repos/seatApplications";
import { firstDayOf } from "../lib/seatApplicationCloser";
import type { SeatCalendar } from "../../shared/seatTerms";
import { providePathFacts } from "../lib/pathFacts";
import { civilDayOf, type ApplicationFacts } from "../../shared/yourPath";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "overLimit" | "members" | "guardCapability"> & {
  /**
   * Where the attached document's bytes live: a folder OUTSIDE the uploads
   * volume, because `/api/uploads/:filename` answers anybody. Nothing serves
   * this folder but the members-only read below.
   */
  documentDir: string;
  /** The village's content document now (`contentRepo.get()`). */
  content: () => Record<string, unknown> | null | undefined;
  boolVar: (key: string) => boolean;
  googleAvailable(): boolean;
  authSecret: string;
  /** Tests hand in a fixed instant. */
  now?: () => Date;
  /** The season calendar, so the path can say the day a role starts (server/lib/pathFacts.ts). */
  calendar?: () => SeatCalendar;
};

const ASKS = 10;
const WINDOW_MS = 10 * 60 * 1000;
/** How long the capability context trusts one answer about a member holding the agreement. */
const HOLDS_FRESH_MS = 60 * 1000;

const holds = new Map<string, { version: string; yes: boolean; at: number }>();

let readHolds: ((userId: string) => Promise<boolean>) | null = null;

/**
 * Whether a member holds the village's confidentiality agreement as it reads
 * now, for the capability context (`records.confidential`). False before this
 * module is registered, and false when the village has written none.
 */
export async function holdsConfidentiality(userId: string): Promise<boolean> {
  return readHolds ? readHolds(userId) : false;
}

/** The `app_config` key the attached document's record lives under: its title, fingerprint and size. Never public. */
export const AGREEMENT_DOCUMENT_KEY = "confidentiality-document";

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, overLimit, members, guardCapability } = deps;
  const now = () => (deps.now ? deps.now() : new Date());
  /*
   * THE ATTACHED DOCUMENT'S RECORD, read once and kept. A record that failed to
   * read is read again next time, so a slow first query never hides a document
   * for the life of the process.
   */
  const attached = dbDocument(getPool(), AGREEMENT_DOCUMENT_KEY, {} as Record<string, unknown>);
  let loading: Promise<void> | null = null;
  const ready = () =>
    (loading ??= attached.load().catch((e) => {
      loading = null;
      throw e;
    }));
  let written = false;
  const agreement = async (): Promise<ServedAgreement | null> => {
    await ready();
    const out = currentAgreement((deps.content() ?? {})[CONFIDENTIALITY_SECTION], attached.get());
    written = out !== null;
    return out;
  };
  const fileOf = (sha256: string) => path.join(deps.documentDir, `${sha256}.pdf`);

  installRoleStartGate(
    makeRoleStartGate({
      dials: () => roleStartDials(deps.boolVar),
      agreement,
      membershipGranted: async (id) => !!((await members.byId(id)) as any)?.membershipGranted,
    }),
    () => written,
  );

  readHolds = async (userId) => {
    const current = await agreement();
    if (!current) return false;
    const seen = holds.get(userId);
    const t = now().getTime();
    if (seen && seen.version === current.version && t - seen.at < HOLDS_FRESH_MS) return seen.yes;
    const yes = await holdsCurrentAgreement(getPool(), userId, current, now());
    holds.set(userId, { version: current.version, yes, at: t });
    return yes;
  };


  /*
   * THE AGREEMENT, FOR SOMEBODY SIGNED IN. A visitor learns only whether there
   * is one: the words name the attached document, and the document's title is
   * for the people aligning with it, never a page a visitor can reach.
   */
  app.get("/api/confidentiality", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const current = await agreement();
    const user = await authedUser(req);
    if (!user) {
      return res.json({ agreement: null, exists: current !== null, you: null, message: current ? CONFIDENTIALITY_WORDS.signInToRead : CONFIDENTIALITY_WORDS.none });
    }
    const you = current ? { holds: await holdsCurrentAgreement(getPool(), String(user.id), current, now()) } : null;
    const served = current
      ? { ...current, document: current.document ? { title: current.document.title, size: current.document.size, href: AGREEMENT_DOCUMENT_HREF } : null }
      : null;
    res.json({ agreement: served, exists: current !== null, you, message: current ? null : CONFIDENTIALITY_WORDS.none });
  });

  /*
   * THE DOCUMENT ITSELF, to a signed-in member at the step where they align,
   * and to nobody else. Read from the folder outside the uploads volume, kept
   * out of every cache and every index, and opened in the browser. A visitor is
   * answered 401 and learns nothing about it.
   */
  app.get(AGREEMENT_DOCUMENT_HREF, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: CONFIDENTIALITY_WORDS.signInToRead });
    if (await overLimit(`confidentiality-document:${String(user.id)}`, 60, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "too_many_asks", message: "That is a lot of reading in an hour. Try again in a little while." });
    }
    await ready();
    const doc = documentOf(attached.get());
    if (!doc) return res.status(404).json({ error: "no_document", message: "The village has not attached a document to its agreement." });
    let bytes: Buffer;
    try {
      bytes = await fs.promises.readFile(fileOf(doc.sha256));
    } catch {
      return res.status(404).json({ error: "no_document", message: "The agreement's document could not be found. Tell the village's admins." });
    }
    // The file on disk is the file that was fingerprinted, or it is not served.
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== doc.sha256) {
      return res.status(409).json({ error: "document_changed", message: "The agreement's document does not match the one the village attached. Tell the village's admins." });
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="agreement-${doc.sha256.slice(0, 12)}.pdf"`);
    res.send(bytes);
  });

  // ── Admin: attach the document (story.tell, the hand that writes the words) ──
  const upload = multer({ storage: multer.memoryStorage(), defParamCharset: "utf8", limits: { fileSize: AGREEMENT_DOCUMENT_MAX_BYTES, files: 1, fields: 2 } });

  app.get("/api/admin/confidentiality/document", async (req, res) => {
    if (!(await guardCapability(req, res, "story.tell"))) return;
    await ready();
    res.setHeader("Cache-Control", "no-store");
    res.json({ document: documentOf(attached.get()) });
  });

  app.post("/api/admin/confidentiality/document", async (req, res) => {
    if (!(await guardCapability(req, res, "story.tell"))) return;
    upload.single("file")(req, res, (err: any) => {
      void store(err).catch((e) => {
        console.error("[confidentiality] the document was not attached", e);
        if (!res.headersSent) res.status(500).json({ error: "The document could not be attached. Nothing was changed." });
      });
    });
    async function store(err: any) {
      if (err) {
        const tooBig = err?.code === "LIMIT_FILE_SIZE";
        return res.status(tooBig ? 413 : 400).json({ error: tooBig ? "That file is larger than 10 MB." : "That file could not be read." });
      }
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) return res.status(400).json({ error: "Pick the agreement's PDF to attach." });
      if (!/\.pdf$/i.test(file.originalname) || storedFileProblem("pdf", file.buffer)) return res.status(400).json({ error: "Attach the agreement as a PDF." });
      // The title the admin typed, else the file's own name: the village's words, never the platform's.
      const typed = String((req.body as Record<string, unknown> | undefined)?.title ?? "").replace(/\s+/g, " ").trim();
      const title = (typed || file.originalname.replace(/\.pdf$/i, "").replace(/\s+/g, " ").trim()).slice(0, 200);
      if (!title) return res.status(400).json({ error: "Give the document a title." });
      const sha256 = crypto.createHash("sha256").update(file.buffer).digest("hex");
      await fs.promises.mkdir(deps.documentDir, { recursive: true });
      const target = fileOf(sha256);
      const temp = `${target}.${crypto.randomBytes(4).toString("hex")}.part`;
      await fs.promises.writeFile(temp, file.buffer);
      await fs.promises.rename(temp, target);
      await ready();
      const doc = { title, sha256, size: file.buffer.length, attachedAt: now().toISOString() };
      await attached.put(doc);
      // A new document is new words: every holder is asked again, and no cached yes outlives it.
      holds.clear();
      res.json({ success: true, document: documentOf(doc) });
    }
  });

  app.delete("/api/admin/confidentiality/document", async (req, res) => {
    if (!(await guardCapability(req, res, "story.tell"))) return;
    await ready();
    await attached.put({});
    holds.clear();
    res.json({ success: true, document: null });
  });

  /*
   * THE STEPS BEFORE YOUR ROLE STARTS, ON YOUR OWN PROFILE (role journey L7).
   * Every role of yours that was adopted and has not started, with the
   * agreements it still waits on, the same answer the seating path gives. A
   * new holder lands on their profile after sign-up, so this is where they are
   * asked; the notice in the bell says the same thing. Yours alone: nobody
   * reads another member's steps.
   */
  /** Every role of the member's that was adopted and has not started, with the agreements it still waits on. */
  async function waitingStarts(userId: string) {
    const pool = getPool();
    const waiting = (await applicationsOfCandidates(pool, [userId])).filter((a) => a.status === "adopted" || a.status === "held-full");
    const out: Array<{ applicationId: string; roles: string[]; steps: Array<{ step: StartStep; href: string }>; waitsForSeat: boolean; firstDay: string | null }> = [];
    // A village that has written no agreement has no door to draw for that step, so the holder is not
    // asked for it (audit M18). The admins are told by the closer (seatApplicationCloser.ts).
    const hasAgreement = waiting.length > 0 && (await agreement()) !== null;
    if (waiting.length) {
      const conn = await pool.getConnection();
      try {
        for (const app of waiting) {
          if ((await seatingsEverHolding(conn, app.id)) > 0) continue;
          const steps = (await stepsBeforeStart(conn, app, now())).filter((s) => s !== "confidentiality" || hasAgreement);
          // Held because every seat is taken: shown even with no step left, so the card says the role starts when a seat opens (audit B3).
          const waitsForSeat = app.status === "held-full";
          const calendar = deps.calendar?.();
          const first = calendar ? firstDayOf(app, calendar) : (app.startsAt ?? null);
          // A start that has come is "now": only a day still ahead is worth saying (STATE_MAP C2).
          const firstDay = first && first.getTime() > now().getTime() ? civilDayOf(first, calendar?.timezone || "UTC") : null;
          out.push({ applicationId: app.id, roles: await seatNamesFor(conn, app.seatIds), steps: steps.map((step) => ({ step, href: stepHref(step, app) })), waitsForSeat, firstDay });
        }
      } finally {
        conn.release();
      }
    }
    return out;
  }

  // The path conductor reads the same answer the card does, so the two cannot disagree (server/lib/pathFacts.ts).
  providePathFacts("applications", async (userId) => ({
    applications: (await waitingStarts(userId)).map((w): ApplicationFacts => ({ id: w.applicationId, roles: w.roles, status: w.waitsForSeat ? "held-full" : "adopted", steps: w.steps, firstDay: w.firstDay })),
  }));

  app.get("/api/profile/role-start-steps", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    // The card draws a role that still waits on a step, or on a place; one that only waits for its day is the path's to say.
    res.json({ waiting: (await waitingStarts(String(user.id))).filter((w) => w.steps.length > 0 || w.waitsForSeat) });
  });

  app.post("/api/profile/confidentiality", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in to align." });
    const userId = String(user.id);
    if (await overLimit(`align-confidentiality:${userId}`, ASKS, WINDOW_MS)) {
      return res.status(429).json({ error: "too_many_asks", message: "That is a lot of aligning in a few minutes. Wait a little and try again." });
    }
    const current = await agreement();
    if (!current) return res.status(409).json({ error: "no_agreement", message: CONFIDENTIALITY_WORDS.none });
    if (req.body?.version !== current.version) return res.status(409).json({ error: "words_changed", message: CONFIDENTIALITY_WORDS.changed, agreement: current });
    // One click, identity re-confirmed: the agreement binds a person, so a stale confirmation asks again.
    const until = confirmedUntil(user, RECONFIRM_FRESH_MS);
    if (until === null || now().getTime() > until) {
      return res.status(403).json({ error: "reconfirm_required", message: ALIGN_WORDS.reconfirmAgreementLine, confirmWith: confirmWithFor(user, deps.authSecret, deps.googleAvailable()) });
    }
    const out = await inApplicationTransaction(getPool(), (conn) => alignConfidentiality(conn, { agreement: current, userId, now: now() }));
    holds.delete(userId);
    // A role waiting on this alignment starts now rather than at the next hour.
    void seasonSaved();
    res.json({ success: true, textId: out.textId, already: out.already, alignedAt: now().toISOString() });
  });
}
