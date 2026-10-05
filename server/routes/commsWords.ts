/**
 * THE WORDS ROUTES, `/api/admin/comms/words/*`: every email's words, their
 * versions, a live preview, and a test sent to yourself (the comms build spec
 * 5.5 and 6). Registered from server/routes/comms.ts.
 *
 * ── THE GATES ───────────────────────────────────────────────────────────────
 *
 * Behind `requireModule("comms")`, one route at a time, the way the comms
 * module's own registry entry says its automation routes are gated: the Words
 * tab follows the module (client/src/lib/adminNav.ts), so its routes answer
 * the module's 404 while it is off, and an admin can prepare the village's
 * words while it rehearses in preview. Then the one capability gate for
 * `comms.manage`: a change through `guardCapability`, which carries the
 * break-glass and the public record, and a look through `mayStillSee`.
 *
 * The preview is a POST, because it carries the editor's unsaved words, and it
 * is a LOOK: it changes nothing, so it asks `mayStillSee` and never writes a
 * record of acting on a power.
 *
 * ── PREVIEW EQUALS SEND ─────────────────────────────────────────────────────
 *
 * The preview and "Send me a test" build their inputs in one function,
 * `renderForEditor`, and render through `renderTemplate`, the same call every
 * sending lane makes. Sample values greet whoever pressed the button, and
 * every link in them points at the village's own site. The test is posted as
 * `essential`, origin `comms.test`, to the signed-in admin's own address, so
 * what arrives in their inbox is byte for byte what the preview showed.
 */
import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import {
  DEFAULT_PATH_IDS,
  genericPathTemplate,
  defaultTemplate,
  templateGroups,
  templateLabel,
} from "../../shared/comms/defaults/templates";
import { fieldsForTemplate, kindForTemplate, MERGE_GROUP_LABELS, sampleValues } from "../../shared/comms/mergeFields";
import { voiceLintWords } from "../../shared/comms/voiceLint";
import { GAME_CONFIG } from "../../shared/gameConfig";
import type { AppDeps } from "../lib/appDeps";
import { post } from "../lib/comms/postOffice";
import { derivedValues, loadEmailVillage, renderTemplate, type RenderedEmail } from "../lib/comms/render";
import {
  adoptPlatformWords,
  listWords,
  readDraft,
  restoreWords,
  saveWords,
  WORDS_LIMITS,
  wordsDetail,
  type WordsDraft,
} from "../lib/comms/templates";
import { requireModule } from "../lib/modules";
import { liveTemplateRow } from "../repos/commsTemplates";

type Deps = Pick<AppDeps, "authedUser" | "guardCapability" | "mayStillSee" | "getPool" | "commsPostOffice">;

const REFUSAL = { status: 403, body: { error: "Editing the village's email is an appointment" } };

/**
 * The paths whose words are listed: the four every village is born with (their
 * journeys exist whatever the path list says), then any path a fork adds.
 */
function pathIds(): string[] {
  const shipped: readonly string[] = DEFAULT_PATH_IDS;
  return [...shipped, ...GAME_CONFIG.paths.map((p) => p.id).filter((id) => !shipped.includes(id))];
}

/** The groups the Words list shows, with each path titled by its own name. */
function groups() {
  return templateGroups(pathIds()).map((g) => {
    const path = g.id.startsWith("path.") ? GAME_CONFIG.paths.find((p) => `path.${p.id}` === g.id) : undefined;
    return { ...g, title: path ? `${path.label} path` : g.title };
  });
}

/**
 * Whether a key names words this village can edit: a platform default, a
 * path this village has, or words the village already holds.
 */
async function knownKey(deps: Deps, key: string): Promise<boolean> {
  if (defaultTemplate(key)) return true;
  const pathId = key.match(/^path\.([a-z0-9-]+)\./)?.[1];
  if (genericPathTemplate(key) && pathId && pathIds().includes(pathId)) return true;
  return (await liveTemplateRow(deps.getPool(), key)) !== null;
}

/** The first word of a name, for a greeting. */
const firstWord = (name: unknown): string => String(name ?? "").trim().split(/\s+/)[0] ?? "";

/**
 * Words from a request body for a preview, kept as typed. A preview shows a
 * half-written draft as it is; only saving refuses one, so the problems ride
 * along as warnings.
 */
function previewDraft(key: string, body: unknown): { draft: WordsDraft | null; problems: string[] } {
  const d = body && typeof body === "object" ? (body as Record<string, unknown>).draft : undefined;
  if (!d || typeof d !== "object") return { draft: null, problems: [] };
  const raw = d as Record<string, unknown>;
  const draft: WordsDraft = {
    subject: typeof raw.subject === "string" ? raw.subject.slice(0, WORDS_LIMITS.subject) : "",
    preheader: typeof raw.preheader === "string" && raw.preheader.trim() ? raw.preheader.slice(0, WORDS_LIMITS.preheader) : null,
    bodyMd: typeof raw.bodyMd === "string" ? raw.bodyMd.slice(0, WORDS_LIMITS.bodyMd) : "",
  };
  const read = readDraft(key, raw);
  return { draft, problems: "problems" in read ? read.problems : [] };
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, guardCapability, mayStillSee, getPool, commsPostOffice } = deps;
  const moduleGate = requireModule("comms");

  /** A look: signed in, and holding the power or an admin. */
  async function mayLook(req: Request, res: Response): Promise<boolean> {
    if (!(await authedUser(req))) {
      res.status(401).json({ error: "Sign in to see the village's email" });
      return false;
    }
    if (!(await mayStillSee(req, "comms.manage"))) {
      res.status(REFUSAL.status).json(REFUSAL.body);
      return false;
    }
    return true;
  }

  /** A key from the path, refused with a 404 when it names no words. */
  async function keyFrom(req: Request, res: Response): Promise<string | null> {
    const key = String(req.params.key ?? "");
    if (!/^[a-z][a-z0-9_.-]{0,99}$/.test(key) || !(await knownKey(deps, key))) {
      res.status(404).json({ error: `There are no words called "${key.slice(0, 100)}".` });
      return null;
    }
    return key;
  }

  /** Everything the editor needs for one key. */
  async function detailFor(key: string) {
    const detail = await wordsDetail(getPool(), key);
    return {
      ...detail,
      label: templateLabel(key),
      kind: kindForTemplate(key),
      fields: fieldsForTemplate(key).map((f) => ({
        key: f.key,
        group: f.group,
        groupLabel: MERGE_GROUP_LABELS[f.group],
        type: f.type,
        label: f.label,
        hint: f.hint,
        optional: f.optional === true,
      })),
    };
  }

  /**
   * THE ONE RENDER the preview and the test share. Same key, same draft, same
   * person asking: same email.
   */
  async function renderForEditor(req: Request, key: string, draft: WordsDraft | null): Promise<RenderedEmail> {
    const user = await authedUser(req);
    const village = await loadEmailVillage(getPool(), commsPostOffice.origin());
    const derived = derivedValues(key, village.url);
    const vars = sampleValues({
      villageUrl: village.url,
      firstName: firstWord(user?.name),
      fullName: String(user?.name ?? ""),
      pathUrl: typeof derived["path.pageUrl"] === "string" ? derived["path.pageUrl"] : null,
    });
    return renderTemplate(key, vars, { getPool, village, words: draft });
  }

  /** Every email's words, grouped the way the screen lists them. */
  app.get("/api/admin/comms/words", moduleGate, async (req, res) => {
    if (!(await mayLook(req, res))) return;
    const shown = groups();
    const summaries = new Map((await listWords(getPool(), shown.flatMap((g) => g.keys))).map((s) => [s.key, s]));
    const village = await loadEmailVillage(getPool(), commsPostOffice.origin());
    res.json({
      groups: shown.map((g) => ({
        id: g.id,
        title: g.title,
        journeyKey: g.journeyKey,
        items: g.keys
          .map((key) => summaries.get(key))
          .filter((s): s is NonNullable<typeof s> => Boolean(s))
          .map((s) => ({ ...s, label: templateLabel(s.key), kind: kindForTemplate(s.key) })),
      })),
      // The footer prints it, and Comms Settings is where it is written.
      postalAddressSet: village.postalAddress !== "",
    });
  });

  /** One email's words: live, the platform's, every version, and the fields it may use. */
  app.get("/api/admin/comms/words/:key", moduleGate, async (req, res) => {
    if (!(await mayLook(req, res))) return;
    const key = await keyFrom(req, res);
    if (!key) return;
    res.json(await detailFor(key));
  });

  /** The email as it would arrive, from the saved words or the editor's draft, with sample values. */
  app.post("/api/admin/comms/words/:key/preview", moduleGate, async (req, res) => {
    if (!(await mayLook(req, res))) return;
    const key = await keyFrom(req, res);
    if (!key) return;
    const { draft, problems } = previewDraft(key, req.body);
    const email = await renderForEditor(req, key, draft);
    const words = draft ?? (await wordsDetail(getPool(), key))?.live ?? null;
    res.json({
      subject: email.subject,
      preheader: email.preheader,
      html: email.html,
      text: email.text,
      version: email.version,
      source: email.source,
      kind: email.kind,
      missing: email.missing,
      omitted: email.omitted,
      unknown: email.unknown,
      problems,
      voice: words ? voiceLintWords(words) : [],
    });
  });

  /** The same email, sent to the signed-in admin's own address. */
  app.post("/api/admin/comms/words/:key/test", moduleGate, async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", REFUSAL))) return;
    const key = await keyFrom(req, res);
    if (!key) return;
    const user = await authedUser(req);
    const to = String(user?.email ?? "").trim();
    if (!to) return res.status(400).json({ error: "Your account has no email address to send a test to." });
    const { draft } = previewDraft(key, req.body);
    const email = await renderForEditor(req, key, draft);
    const result = await post(commsPostOffice, {
      idempotencyKey: `comms.test:${randomUUID()}`,
      kind: "essential",
      origin: "comms.test",
      to: { email: to, name: user?.name ?? null, userId: user?.id ?? null },
      subject: email.subject,
      html: email.html,
      text: email.text,
      preheader: email.preheader,
      source: { templateKey: key, ...(email.version !== null ? { templateVersion: email.version } : {}) },
      urgent: true,
    });
    res.json({ status: result.status, reason: result.reason ?? null, messageId: result.messageId, sentTo: to });
  });

  /** Save the editor's words as a new live version. */
  app.put("/api/admin/comms/words/:key", moduleGate, async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", REFUSAL))) return;
    const key = await keyFrom(req, res);
    if (!key) return;
    const read = readDraft(key, req.body);
    if ("problems" in read) return res.status(400).json({ error: read.problems[0], problems: read.problems });
    const user = await authedUser(req);
    const version = await saveWords(getPool(), key, read.draft, user?.id ?? null);
    if (version === null) return res.status(404).json({ error: "These words could not be found to save over." });
    res.json({ saved: version, detail: await detailFor(key) });
  });

  /** Make an old version live again. */
  app.post("/api/admin/comms/words/:key/restore", moduleGate, async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", REFUSAL))) return;
    const key = await keyFrom(req, res);
    if (!key) return;
    const version = Number(req.body?.version);
    if (!Number.isSafeInteger(version) || version < 1) return res.status(400).json({ error: "Name the version to bring back." });
    if (!(await restoreWords(getPool(), key, version))) {
      return res.status(404).json({ error: `There is no version ${version} of these words.` });
    }
    res.json({ restored: version, detail: await detailFor(key) });
  });

  /** Take the platform's current words as a new live version. Every old version stays. */
  app.post("/api/admin/comms/words/:key/adopt", moduleGate, async (req, res) => {
    if (!(await guardCapability(req, res, "comms.manage", REFUSAL))) return;
    const key = await keyFrom(req, res);
    if (!key) return;
    const user = await authedUser(req);
    const version = await adoptPlatformWords(getPool(), key, user?.id ?? null);
    if (version === null) return res.status(404).json({ error: "The platform has no words of its own for this email." });
    res.json({ adopted: version, detail: await detailFor(key) });
  });
}
