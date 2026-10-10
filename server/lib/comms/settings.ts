/**
 * READING AND WRITING THE COMMS SETTINGS DOCUMENT, and the mode the post
 * office sends under (the comms build spec 5.15, 5.16 and 5.18).
 *
 * The document's shape, its defaults and its rules are in
 * shared/comms/settings.ts, so the client and the server read one definition.
 * This file is the I/O around them:
 *
 *   readCommsSettings    the stored row with every default filled in on the
 *                        way out. It never writes: a document saved by an
 *                        older release reads complete and stays exactly as it
 *                        was stored.
 *   writeCommsSettings   a person's edit, checked by the shared rules, then
 *                        applied as one merge patch.
 *   recordCommsSettings  what the SERVER learned (a domain's status, a
 *                        webhook connected), written the same way.
 *   commsMode            what the post office asks before each send.
 *
 * INJECTED, NEVER IMPORTED: the module lifecycle and the admins' addresses
 * arrive as functions. server/lib/modules.ts imports this lane's readiness
 * reader, so importing the module framework back from here would be a cycle.
 *
 * No raw SQL: the statements are in server/repos/commsSettings.ts.
 */
import type { Pool } from "mysql2/promise";
import { addressOfSender, addressProblem, emailKeyOf } from "../../../shared/comms/address";
import {
  backfillCommsSettings,
  sanitizeDomainStatus,
  validateCommsSettingsPatch,
  type CommsSettings,
  type PersonSettingsField,
} from "../../../shared/comms/settings";
import type { ModuleLifecycle } from "../../../shared/modules";
import { mergeCommsSettings, readStoredCommsSettings } from "../../repos/commsSettings";
import { validEmailSender } from "./mailer";

/** The stored document, every missing field filled with its default. Never writes. */
export async function readCommsSettings(pool: Pool): Promise<CommsSettings> {
  return backfillCommsSettings(await readStoredCommsSettings(pool));
}

/**
 * Apply a person's edit. The rules are the shared ones, so a refusal here
 * says the same words the screen would.
 */
export async function writeCommsSettings(
  pool: Pool,
  input: unknown,
  ctx: { pathIds: readonly string[]; reviewer?: string | null; now?: Date },
): Promise<{ ok: true; settings: CommsSettings; changed: PersonSettingsField[] } | { ok: false; error: string }> {
  const checked = validateCommsSettingsPatch(input, ctx);
  if (!checked.ok) return checked;
  await mergeCommsSettings(pool, checked.patch);
  return { ok: true, settings: await readCommsSettings(pool), changed: checked.changed };
}

/** The fields only the server writes, from what it observed or was told by the provider. */
export interface SystemSettingsPatch {
  senderName?: string | null;
  domain?: string | null;
  domainId?: string | null;
  domainStatus?: string | null;
  domainCheckedAt?: string | null;
  domainConfirmedBy?: string | null;
  webhookConnectedAt?: string | null;
  webhookConnectedBy?: string | null;
  webhookId?: string | null;
}

/**
 * Record what the server learned. Each value is kept to its column's shape on
 * the way in, and `null` removes the field, the same merge rule a person's
 * edit follows.
 */
export async function recordCommsSettings(pool: Pool, patch: SystemSettingsPatch): Promise<CommsSettings> {
  const clean: Record<string, unknown> = {};
  const short = (v: string | null | undefined, max: number): string | null =>
    v == null || !String(v).trim() ? null : String(v).trim().slice(0, max);
  if ("senderName" in patch) clean.senderName = short(patch.senderName, 100);
  if ("domain" in patch) clean.domain = short(patch.domain, 253)?.toLowerCase() ?? null;
  if ("domainId" in patch) clean.domainId = short(patch.domainId, 128);
  if ("domainStatus" in patch) clean.domainStatus = patch.domainStatus == null ? null : sanitizeDomainStatus(patch.domainStatus);
  if ("domainCheckedAt" in patch) clean.domainCheckedAt = short(patch.domainCheckedAt, 40);
  if ("domainConfirmedBy" in patch) clean.domainConfirmedBy = short(patch.domainConfirmedBy, 255);
  if ("webhookConnectedAt" in patch) clean.webhookConnectedAt = short(patch.webhookConnectedAt, 40);
  if ("webhookConnectedBy" in patch) clean.webhookConnectedBy = short(patch.webhookConnectedBy, 255);
  if ("webhookId" in patch) clean.webhookId = short(patch.webhookId, 128);
  if (Object.keys(clean).length) await mergeCommsSettings(pool, clean);
  return readCommsSettings(pool);
}

// ── The From line ───────────────────────────────────────────────────────────

/**
 * The From line every email leaves under, resolved the way the mailer
 * resolves it (`resolvedEmailSender` in ./mailer.ts): the address typed in
 * Admin when it is sendable, else `EMAIL_FROM` when that is, else nothing.
 *
 * A SECOND SPELLING OF ONE RULE, kept on purpose and held to the first by a
 * test (server/lib/comms/setup.test.ts compares the two over every case).
 * The mailer reads a boot-loaded cache through a closure and this reads the
 * stored document off the pool, because the readiness reader and the launch
 * checks run where that closure cannot reach.
 */
export function effectiveSender(typed: unknown, envFrom: unknown): { line: string; source: "admin" | "env" | "none" } {
  const t = String(typed ?? "").trim();
  if (t && validEmailSender(t)) return { line: t, source: "admin" };
  const e = String(envFrom ?? "").trim();
  if (e && validEmailSender(e)) return { line: e, source: "env" };
  return { line: "", source: "none" };
}

/** The name and the address inside a From line. `Name <a@b.c>` and `a@b.c` both read. */
export function senderParts(line: string): { name: string; address: string } {
  const s = String(line ?? "").trim();
  const address = addressOfSender(s);
  const angle = s.lastIndexOf("<");
  const name = angle > 0 ? s.slice(0, angle).trim().replace(/^"(.*)"$/, "$1").trim() : "";
  return { name, address };
}

// ── The mode the post office sends under ────────────────────────────────────

export interface CommsMode {
  lifecycle: ModuleLifecycle;
  paused: boolean;
  rehearsalTo: string[];
}

export interface CommsModeDeps {
  getPool(): Pool;
  /** `effectiveLifecycle("comms")`, injected so this file never imports the module framework. */
  lifecycle(): ModuleLifecycle;
  /** Every present admin's and founder's address: the rehearsal inbox when the village named none. */
  adminEmails(): Promise<string[]> | string[];
}

/** Sendable addresses, one per person, in the order given. */
function uniqueAddresses(list: ReadonlyArray<unknown>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const email = String(raw ?? "").trim();
    if (addressProblem(email) !== null || seen.has(emailKeyOf(email))) continue;
    seen.add(emailKeyOf(email));
    out.push(email);
  }
  return out;
}

/** The addresses of the present admins and founders, one per person. */
export function adminAddresses(members: ReadonlyArray<any>, isPresent: (m: any) => boolean): string[] {
  return uniqueAddresses(
    members.filter((m) => m && (m.role === "admin" || m.role === "founder") && isPresent(m)).map((m) => m.email),
  );
}

/**
 * What the post office asks before each send (5.16): where the comms module
 * stands, whether Pause all is pressed, and who receives rehearsals.
 *
 * The post office lane takes this through its injected `mode()`, wired at
 * merge as `mode: () => commsMode({ getPool, lifecycle, adminEmails })`.
 *
 * FAILS TOWARD HOLDING. If the document cannot be read, the answer is
 * `paused: true`: pause holds only the kinds that can wait (essential mail and
 * member notices go through regardless, 5.16), so a database fault delays a
 * reminder and never sends one the village had stopped. It says so in the log.
 */
export async function commsMode(deps: CommsModeDeps): Promise<CommsMode> {
  const lifecycle = deps.lifecycle();
  let paused = true;
  let named: string[] = [];
  try {
    const settings = await readCommsSettings(deps.getPool());
    paused = settings.paused;
    named = settings.rehearsalTo;
  } catch (err) {
    console.error("[comms] the comms settings could not be read, so automated email is held until they can", err);
  }
  let rehearsalTo = named;
  if (!rehearsalTo.length) {
    try {
      rehearsalTo = uniqueAddresses(await deps.adminEmails());
    } catch (err) {
      console.error("[comms] the admins' addresses could not be read for the rehearsal inbox", err);
    }
  }
  return { lifecycle, paused, rehearsalTo };
}
