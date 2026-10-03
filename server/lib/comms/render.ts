/**
 * RENDERING: a template key, a person's values and the village, made into the
 * subject, preheader, HTML and plain text the post office sends (the comms
 * build spec 5.5).
 *
 * PREVIEW EQUALS SEND. The Words screen's preview calls `renderTemplate`, and
 * so does every lane that sends a templated email, with the same three
 * inputs. Nothing about a render depends on who asked or when, beyond what
 * those inputs carry (the one clock it reads is the signing time of a reader's
 * preferences link, which `ctx.now` pins), so the same inputs give the same
 * email byte for byte: what a founder approves is what goes.
 *
 * WHAT A RENDER READS. The words (the village's live row, else the platform's),
 * and nothing else from the database: the village itself arrives in the
 * context, read once by `loadEmailVillage` for a whole batch of sends, so a
 * letter to five hundred people reads the brand once and not five hundred
 * times.
 *
 * WHERE THE VALUES COME FROM, lowest first:
 *   1. facts the template's key implies: a path email knows its path's name
 *      and page from the path list in `shared/gameConfig.ts`;
 *   2. what the caller passes;
 *   3. the village's own name, site and postal address, which nothing can
 *      override (`composeEmail` puts them last).
 * The reader's preferences link is signed here from their contact id when the
 * caller has one and did not pass a link of its own.
 */
import type { Pool } from "mysql2/promise";
import { composeEmail, type EmailVillage } from "../../../shared/comms/letterHtml";
import type { EmailKind } from "../../../shared/comms/kinds";
import { kindForTemplate, type MergeValues } from "../../../shared/comms/mergeFields";
import { GAME_CONFIG } from "../../../shared/gameConfig";
import { readConfigDocument } from "../../repos/appConfigDocs";
import { signLink } from "./links";
import { readLiveWords, type TemplateWords } from "./templates";

export type { EmailVillage } from "../../../shared/comms/letterHtml";

/** How long a preferences link in an email stays good: a year, because mail is read late. */
export const PREFERENCES_LINK_DAYS = 365;

export interface RenderContext {
  getPool(): Pool;
  /** The village, from `loadEmailVillage`. */
  village: EmailVillage;
  /** Words to render in place of the stored ones: the Words editor's unsaved draft. */
  words?: { subject: string; preheader: string | null; bodyMd: string } | null;
  /** The kind the email is posted as. Defaults to the template's own (`kindForTemplate`). */
  kind?: EmailKind;
  /** The reader's contact, for their own signed preferences link. */
  contactId?: string | null;
  /** Epoch milliseconds the preferences link is signed at. Tests pin it. */
  now?: number;
}

export interface RenderedEmail {
  templateKey: string;
  subject: string;
  preheader: string;
  html: string;
  text: string;
  /** The version rendered, for `comms_messages.template_version`. Null for a draft. */
  version: number | null;
  source: TemplateWords["source"];
  kind: EmailKind;
  /** Fields with no value that rendered their fallback. */
  missing: string[];
  /** Optional fields with no value, whose lines were left out. */
  omitted: string[];
  /** Tokens naming no field. */
  unknown: string[];
}

const nonBlank = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** A site origin with no trailing slash. */
const bareOrigin = (origin: string): string => String(origin ?? "").trim().replace(/\/+$/, "");

/**
 * The reader's own preferences page, signed for their contact. The payload is
 * the contact id alone (`c`), the same key the post office's unsubscribe link
 * uses, and never an address.
 */
export function preferencesLink(origin: string, contactId: string, now?: number): string {
  const token = signLink("preferences", { c: contactId }, PREFERENCES_LINK_DAYS, now === undefined ? {} : { now });
  return `${bareOrigin(origin)}/email/preferences?t=${encodeURIComponent(token)}`;
}

/** The path a template key belongs to, from the identity plane's path list. */
function pathOf(templateKey: string): { id: string; label: string; route: string } | null {
  const m = String(templateKey ?? "").match(/^path\.([a-z0-9-]+)\./);
  if (!m) return null;
  const path = GAME_CONFIG.paths.find((p) => p.id === m[1]);
  return path ? { id: path.id, label: path.label, route: path.route } : { id: m[1], label: "", route: "" };
}

/** Facts a template's key implies: a path email knows its path's name and page. */
export function derivedValues(templateKey: string, villageUrl: string): MergeValues {
  const path = pathOf(templateKey);
  if (!path) return {};
  const site = bareOrigin(villageUrl);
  return {
    ...(path.label ? { "path.name": path.label } : {}),
    ...(path.route && site ? { "path.pageUrl": `${site}${path.route}` } : {}),
  };
}

/**
 * An address an email may load the logo from: https anywhere, or http only on
 * the village's own host (a development site). A path such as
 * `/api/uploads/brand-....webp` is made absolute against the village's site.
 */
function absoluteLogo(raw: string, site: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = site ? new URL(s, site) : new URL(s);
    if (u.protocol === "https:") return u.toString();
    if (u.protocol === "http:" && site && new URL(site).host === u.host) return u.toString();
    return null;
  } catch {
    return null;
  }
}

/**
 * The village as its emails show it, read fresh from the database: the brand
 * overlay for its name, logo and colours, and the comms settings document for
 * its postal address (5.18). A blank name inherits the platform's, the same
 * rule the site's merged config follows.
 *
 * Read once per batch of sends and pass the answer in each render's context.
 * A read that fails answers the platform defaults rather than throwing, so a
 * hiccup costs an email its colours, never the email.
 */
export async function loadEmailVillage(pool: Pool, origin: string): Promise<EmailVillage> {
  const read = async (key: string): Promise<Record<string, any> | null> => {
    try {
      return await readConfigDocument<Record<string, any>>(pool, key);
    } catch (err) {
      console.error(`[comms] could not read the ${key} document for an email; using the defaults`, err);
      return null;
    }
  };
  const [brand, settings] = await Promise.all([read("brand"), read("comms-settings")]);
  const site = bareOrigin(origin);
  return {
    name: nonBlank(brand?.project?.name) || GAME_CONFIG.project.name,
    url: site,
    logoUrl: absoluteLogo(nonBlank(brand?.images?.logo) || GAME_CONFIG.images.logo, site),
    seed: nonBlank(brand?.theme?.seed) || null,
    character: nonBlank(brand?.theme?.character) || null,
    postalAddress: nonBlank(settings?.postalAddress),
  };
}

/**
 * One email from a template: the village's live words for `templateKey` (or
 * the platform's, or `ctx.words` when the editor is previewing a draft), with
 * `vars` put in.
 *
 * Throws when the key has no words anywhere, because that is a caller's bug: a
 * journey that names a template nobody wrote must fail loudly, never send a
 * blank email.
 */
export async function renderTemplate(templateKey: string, vars: MergeValues, ctx: RenderContext): Promise<RenderedEmail> {
  const stored = ctx.words ? null : await readLiveWords(ctx.getPool(), templateKey);
  const words = ctx.words ?? stored;
  if (!words) throw new Error(`[comms] there are no words for the template "${templateKey}"`);
  const kind = ctx.kind ?? kindForTemplate(templateKey);
  const values: MergeValues = { ...derivedValues(templateKey, ctx.village.url), ...vars };
  if (!values["links.preferences"] && ctx.contactId && ctx.village.url) {
    values["links.preferences"] = preferencesLink(ctx.village.url, ctx.contactId, ctx.now);
  }
  const email = composeEmail({
    words: { subject: words.subject, preheader: words.preheader, bodyMd: words.bodyMd },
    values,
    village: ctx.village,
    kind,
    templateKey,
  });
  return {
    templateKey,
    ...email,
    version: stored ? stored.version : null,
    source: stored ? stored.source : "draft",
    kind,
  };
}

/**
 * One letter: its words set inside the village's `letter.layout` template,
 * posted as kind `letters` unless the context says otherwise. The letter's own
 * subject and preview line ride in `vars` as `letter.subject` and
 * `letter.preheader`.
 */
export function renderLetter(markdown: string, vars: MergeValues, ctx: RenderContext): Promise<RenderedEmail> {
  return renderTemplate("letter.layout", { ...vars, "letter.body": { markdown } }, { ...ctx, kind: ctx.kind ?? "letters" });
}
