/**
 * The village that publishes itself.
 *
 * Three documents at predictable URLs, unauthenticated, cacheable:
 *
 *   /.well-known/village.json   discovery: who this is, what it supports, where
 *   /api/public/org.json        the org chart as data
 *   /org/**.md                  the same chart as linked Markdown
 *
 * Peerdom's OKF export is the idea, and the reason it is worth building before
 * any second village exists is that it pays off with one: a founder points an
 * agent at a URL and gets the whole organisation with no integration, and a
 * funder or a partner reads the same thing. `server/lib/network.ts` already
 * made the right bet once ("the same posture as RSS") and then hardcoded
 * discovery to `/api/platform/info` and refused any platform string that was
 * not `custom-game-foundation`, so only forks of this exact repo could ever
 * federate. Links here are data, so a Peerdom organisation, a bioregional
 * council or a hand-written static file can participate.
 *
 * ── THE PRIVACY RULE, WHICH HAS NO EXCEPTIONS ────────────────────────────
 *
 * NO NAMES. Not full ones, not first ones, not documented holders' names, not
 * user ids, not focus strings or holder notes. `/api/org` tiers those behind
 * `map.viewPeople` because it has a session to check. These documents have no
 * session by construction, and once a document is fetched it can be cached,
 * relayed, indexed and handed to an agent forever. So the export publishes the
 * ANONYMOUS tier and nothing else: circle names, seat names, aims, domains,
 * accountabilities, seat counts, and how many of them are filled.
 *
 * Vacancy is the point rather than a leak. "2 of 3 seats filled, 1 open call"
 * is what makes the chart useful to a partner and a recruit, and it names
 * nobody.
 *
 * ── WHAT IS DELIBERATELY EXCLUDED ────────────────────────────────────────
 *
 * Standing examples are dropped, not flagged. `/api/org` carries `isExample`
 * so a signed-in member's UI can badge them, which works because that UI knows
 * what the flag means. A crawler does not, and a demo seat presented as real
 * governance is worse than no export.
 *
 * Retired seats (`active = 0`) are dropped. Dormant and forming circles are
 * KEPT with their status, because "we ran this and paused it" is real
 * information about how a village works, and hiding it would make the chart
 * read as though the village had never tried.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as edSign, verify as edVerify } from "crypto";
import type { Pool } from "mysql2/promise";
import { seatState, type OrgAssignment, type OrgRole } from "./orgChart";
import { keyFromEnv, openWith, sealWith, type Sealed } from "./sealedBox";
import { VILLAGE_SECRETS_ENV } from "./secrets";
import { DECIDES_BY, DOMAINS, SHAPES } from "../../shared/power";
import { circlesOnCycles } from "../../shared/circleView";

/*
 * 0083 vocabulary, published as IDS ONLY and sanitised against the closed
 * sets. The columns under these were validated at write time, but this
 * document goes to the open internet, so a hand-edited row must degrade to
 * null here rather than publish whatever text it holds: free text can hold a
 * name, and the privacy rule above has no exceptions.
 */
const SHAPE_IDS = new Set<string>(SHAPES.map((s) => s.id));
const DECIDES_BY_IDS = new Set<string>(DECIDES_BY.map((d) => d.id));
const DOMAIN_IDS = new Set<string>(DOMAINS.map((d) => d.id));

function exportableShape(v: unknown): string | null {
  return typeof v === "string" && SHAPE_IDS.has(v) ? v : null;
}

function exportableDecidesBy(v: unknown): string | null {
  return typeof v === "string" && DECIDES_BY_IDS.has(v) ? v : null;
}

/** {money: {method, gloss?}, ...} -> {money: "consent", ...}, ids only. */
function exportableDomains(v: unknown): Record<string, string> | null {
  const raw = typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [domain, entry] of Object.entries(raw as Record<string, any>)) {
    if (!DOMAIN_IDS.has(domain)) continue;
    const method = exportableDecidesBy(entry?.method);
    if (method) out[domain] = method;
  }
  return Object.keys(out).length ? out : null;
}

export const EXPORT_PROTOCOL = "village/1";

/**
 * Ids double as URL slugs. `createOrgRole` slugifies a name into the id, so
 * they already look like `visionary-lead`, but an id can also arrive from a
 * seed file or a direct write, and these ids build filesystem-shaped paths.
 * Anything that is not a plain slug is refused rather than escaped: there is
 * no legitimate seat called `../../etc/passwd`, so there is nothing to save.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isSlug(v: unknown): boolean {
  return typeof v === "string" && SLUG.test(v);
}

// ── Signing ─────────────────────────────────────────────────────────────────
//
// Minted at first boot with the same INSERT IGNORE read-or-mint that already
// mints `instanceId` (server/lib/identity.ts), so concurrent boots settle on
// one key instead of racing to overwrite each other.
//
// Built before anybody consumes these documents ON PURPOSE. It is the one
// piece that is genuinely painful to retrofit: once other villages have
// learned to trust unsigned payloads, adding signatures either breaks them or
// gets ignored forever. Without it every downstream capability is
// authenticated only by TLS to the origin, which evaporates the moment a
// document is cached, relayed or handed to an agent.

/*
 * ── THE PRIVATE HALF AT REST (2026-08-31) ────────────────────────────────
 *
 * This key used to sit in `app_config` as plaintext JSON. It therefore rode,
 * in the clear, in every one of the daily database dumps that were uploaded
 * as GitHub Actions artifacts, downloadable by anyone with repository read
 * access for a 30-day window. It is the key every peer village pins. Whoever
 * held a copy of that dump can sign documents as this village, and no peer
 * could tell.
 *
 * The integration secrets next door were sealed with AES-256-GCM in the same
 * round and this one was left, for a stated reason: it is MINTED AT FIRST
 * BOOT. `secrets.ts` can throw when `VILLAGE_SECRETS_KEY` is absent because
 * somebody is typing a Stripe key into a form and can be told to come back;
 * this runs inside `startServer`, before anything serves, and the same
 * fail-closed rule would refuse to boot a fresh village whose operator had not
 * set the variable yet. A backup that costs a village its ability to start is
 * not a security improvement.
 *
 * ── WHAT WAS CHOSEN, AND WHY ─────────────────────────────────────────────
 *
 * Seal when a key is available, keep working when it is not, and NEVER refuse
 * to boot for this. Four states, all of them reachable, none of them silent:
 *
 *   key set, no document yet     mint and store SEALED. The normal path for
 *                                any village provisioned from now on.
 *   key set, plaintext document  open it, RE-SEAL IT IN PLACE, carry on. An
 *                                existing village stops leaking on its next
 *                                boot with no operator action beyond setting
 *                                the variable. Same upgrade-on-read shape the
 *                                password hashes already use.
 *   no key, no document yet      mint and store PLAINTEXT, and say so loudly
 *                                on every boot. First boot works. The village
 *                                is exactly as exposed as it was yesterday,
 *                                which is the honest floor: this change is not
 *                                allowed to make a fresh install worse, and
 *                                pretending is not one of the options.
 *   sealed document, no key      the public half still loads, the private half
 *                                is unavailable, THE SIGNED DOCUMENTS REFUSE
 *                                with a 503 naming the variable. Boot
 *                                continues, and so does everything that does
 *                                not carry a proof block (the /org/**.md
 *                                mirror included). This is an operator who
 *                                removed a variable, and the answer to "I
 *                                cannot prove who I am" is to stop claiming,
 *                                not to publish documents peers would learn to
 *                                accept unsigned.
 *
 * `VILLAGE_SECRETS_KEY` rather than a third variable on purpose. It already
 * seals every other village-scope credential, the same process reads both, and
 * a separate variable would buy no isolation while adding one more thing 13
 * founder instances have to be provisioned with before they can boot cleanly.
 */

export interface SigningKey {
  kid: string;
  publicKeyPem: string;
  /**
   * Null when this deployment holds the public half and cannot open the
   * private one. `signDocument` refuses on null rather than signing with
   * something it guessed.
   */
  privateKeyPem: string | null;
  createdAt: string;
}

/** How the private half is stored. Both shapes are read; only one is written. */
interface SigningKeyDoc {
  publicKeyPem: string;
  /** Pre-2026-08-31, and any village with no VILLAGE_SECRETS_KEY set. */
  privateKeyPem?: string;
  /** AES-256-GCM under VILLAGE_SECRETS_KEY. */
  privateKeySealed?: Sealed;
  createdAt: string;
}

/** How the private half of the loaded key is being held. Reported, never guessed. */
export type SigningKeyAtRest = "sealed" | "plaintext" | "unreadable";

let cachedKey: SigningKey | null = null;
let cachedAtRest: SigningKeyAtRest | null = null;

export const NO_SIGNING_KEY_SENTENCE =
  "this village cannot sign published documents: its signing key is sealed and " +
  `${VILLAGE_SECRETS_ENV} is unset or does not match`;

/** Whether this deployment can sign. False is a refusal, never an unsigned doc. */
export function canSign(): boolean {
  return typeof cachedKey?.privateKeyPem === "string";
}

/** How the loaded key is held at rest, or null before boot loaded one. */
export function signingKeyAtRest(): SigningKeyAtRest | null {
  return cachedAtRest;
}

/** Test-only. Module-level caches a suite cannot clear are a flaky suite. */
export function resetSigningKeyForTests(): void {
  cachedKey = null;
  cachedAtRest = null;
}

/** Raw 32-byte ed25519 public key, base64url. */
function rawPublicKeyB64(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  // SPKI for ed25519 is a fixed 12-byte header followed by the 32-byte key.
  return Buffer.from(der.subarray(der.length - 32)).toString("base64url");
}

/** The fixed SPKI prefix for an ed25519 public key: 12 bytes, then the key. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * The inverse of `rawPublicKeyB64`: rebuild a PEM from the 32 raw bytes.
 *
 * A peer's discovery document publishes both encodings, and a pinned key is
 * stored as the base64url alone. Verification always rebuilds the PEM from
 * those bytes and NEVER uses the PEM the document supplies: a peer publishing
 * the real village's `publicKeyBase64url` beside its own `publicKeyPem` would
 * otherwise match the pin and verify its own signature in the same breath.
 *
 * Returns null for anything that is not 32 decodable bytes, so a malformed or
 * hostile string fails as "cannot verify" instead of throwing mid-sweep.
 */
export function pemFromRawPublicKey(base64url: string): string | null {
  try {
    const raw = Buffer.from(String(base64url), "base64url");
    if (raw.length !== 32) return null;
    const der = Buffer.concat([ED25519_SPKI_PREFIX, raw]);
    return createPublicKey({ key: der, format: "der", type: "spki" })
      .export({ type: "spki", format: "pem" })
      .toString();
  } catch {
    return null;
  }
}

const SIGNING_KEY_ROW = "village-signing-key";

/** Build the stored document for a private half, sealed if a key is available. */
function storedDoc(publicKeyPem: string, privateKeyPem: string, key: Buffer | null, createdAt: string): SigningKeyDoc {
  return key
    ? { publicKeyPem, privateKeySealed: sealWith(key, privateKeyPem), createdAt }
    : { publicKeyPem, privateKeyPem, createdAt };
}

export async function ensureSigningKey(
  pool: Pool,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SigningKey> {
  if (cachedKey) return cachedKey;
  const key = keyFromEnv(VILLAGE_SECRETS_ENV, env);

  // Look before minting. `identity.ts` generates its candidate unconditionally
  // because a UUID is free; a keypair is not, and every boot after the first
  // would generate one only to throw it away. The INSERT IGNORE below still
  // does the real work of settling concurrent first boots on one key, so this
  // is a fast path and not the correctness mechanism.
  const [existing] = await pool.query<any[]>(
    `SELECT value FROM app_config WHERE config_key = '${SIGNING_KEY_ROW}'`,
  );
  if (!existing.length) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const fresh = storedDoc(
      publicKey.export({ type: "spki", format: "pem" }).toString(),
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      key,
      new Date().toISOString(),
    );
    await pool.query(
      `INSERT IGNORE INTO app_config (config_key, value) VALUES ('${SIGNING_KEY_ROW}', ?)`,
      [JSON.stringify(fresh)],
    );
  }
  const [[row]] = await pool.query<any[]>(
    `SELECT value FROM app_config WHERE config_key = '${SIGNING_KEY_ROW}'`,
  );
  const doc: SigningKeyDoc = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  // A document with no public half is corrupt, not a state to work around.
  // Everything below can degrade; this cannot, because a village with no
  // public key has no identity for a peer to have pinned in the first place.
  if (!doc?.publicKeyPem || (!doc.privateKeyPem && !doc.privateKeySealed)) {
    throw new Error("village-signing-key document exists but carries no keypair, refusing to guess");
  }

  const pub = String(doc.publicKeyPem);
  const createdAt = String(doc.createdAt ?? "");
  let priv: string | null = null;
  let atRest: SigningKeyAtRest;

  if (doc.privateKeySealed) {
    priv = key ? openWith(key, doc.privateKeySealed) : null;
    atRest = priv ? "sealed" : "unreadable";
    if (!priv) {
      // Never a throw. An operator who dropped the variable gets a village
      // that boots and serves everything except signed publication, which is
      // the only surface the missing half actually gates.
      console.error(
        `[identity] the signing key is sealed and this deployment cannot open it. ` +
          `Set ${VILLAGE_SECRETS_ENV} to the value used when it was sealed. ` +
          "The SIGNED documents (/.well-known/village.json, /api/public/org.json, /api/platform/module-usage) " +
          "will refuse until then; the /org/**.md mirror carries no proof block and keeps serving. " +
          "If that value is genuinely lost, the key must be re-minted and every peer village will have to accept the change by hand.",
      );
    }
  } else {
    priv = String(doc.privateKeyPem);
    atRest = "plaintext";
    if (key) {
      /*
       * UPGRADE ON READ. The plaintext row is what rides in a database dump,
       * so leaving it until somebody remembers to migrate is leaving it. The
       * re-seal is a plain UPDATE of the same row with the same keypair: the
       * kid does not change, no peer sees anything change, and a boot that
       * fails halfway leaves the old readable row in place.
       */
      const resealed = storedDoc(pub, priv, key, createdAt);
      try {
        await pool.query(
          `UPDATE app_config SET value = ? WHERE config_key = '${SIGNING_KEY_ROW}'`,
          [JSON.stringify(resealed)],
        );
        atRest = "sealed";
        console.log("[identity] signing key re-sealed at rest; the plaintext copy is gone from app_config");
      } catch (e) {
        // Still usable, still exposed, and now said out loud rather than
        // assumed to have worked.
        console.error("[identity] could not re-seal the signing key; it stays plaintext in app_config", e);
      }
    } else {
      // The honest floor. A fresh village with no key set boots and publishes
      // exactly as it did yesterday, and every boot says what that costs.
      console.warn(
        `[identity] the signing key is stored in PLAINTEXT because ${VILLAGE_SECRETS_ENV} is not set. ` +
          "It travels in every database dump. Set it (openssl rand -hex 32) and restart; " +
          "this boot will seal the existing key in place, with no change visible to peers.",
      );
    }
  }

  cachedKey = {
    kid: createHash("sha256").update(rawPublicKeyB64(pub)).digest("hex").slice(0, 16),
    publicKeyPem: pub,
    privateKeyPem: priv,
    createdAt,
  };
  cachedAtRest = atRest;
  return cachedKey;
}

/** Synchronous read for hot paths; boot must have called `ensureSigningKey`. */
export function signingKey(): SigningKey {
  if (!cachedKey) throw new Error("signing key read before boot established it");
  return cachedKey;
}

/** What the discovery doc publishes about the key. */
export function publicKeyBlock(k: SigningKey) {
  return {
    alg: "ed25519",
    kid: k.kid,
    // base64url of the raw 32 bytes, plus the PEM. Deliberately NOT multibase:
    // base58btc would have to be hand-rolled here, and a hand-rolled base58
    // that is subtly wrong publishes a key nobody can use, which is worse than
    // publishing a boring encoding everyone already has a decoder for.
    publicKeyBase64url: rawPublicKeyB64(k.publicKeyPem),
    publicKeyPem: k.publicKeyPem,
  };
}

/**
 * Deterministic JSON. Signing is worthless if the bytes a verifier
 * reconstructs differ from the bytes that were signed, and object key order in
 * JS follows insertion order, which follows whatever the code happened to do
 * that day. Keys are sorted recursively; arrays keep their order because their
 * order is meaning.
 */
export function canonicalJson(value: unknown): string {
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const out: Record<string, any> = {};
      for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

export interface Proof {
  alg: "ed25519";
  kid: string;
  signedAt: string;
  /** Signature over `canonicalJson(document-without-proof)`, base64url. */
  signature: string;
}

/**
 * Sign a document and return it with a `proof` block attached.
 *
 * Throws when the private half is unavailable rather than returning the
 * document unsigned. An unsigned copy of a document peers expect a proof on is
 * the one outcome worse than no document: it teaches every reader that this
 * village's payloads are sometimes fine without one.
 */
export function signDocument<T extends Record<string, any>>(doc: T, k: SigningKey, signedAt: string): T & { proof: Proof } {
  if (!k.privateKeyPem) throw new Error(NO_SIGNING_KEY_SENTENCE);
  const body = canonicalJson({ ...doc, signedAt });
  const signature = edSign(null, Buffer.from(body, "utf8"), createPrivateKey(k.privateKeyPem));
  return { ...doc, proof: { alg: "ed25519", kid: k.kid, signedAt, signature: signature.toString("base64url") } };
}

/**
 * Verify a document that carries a proof block. Exported so the round trip is
 * testable and so a peer implementation has a reference: a signature nobody
 * can check is ceremony.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT.
 *
 * It proves the bytes were not altered after the holder of that private key
 * signed them, which is the point: a copy that was cached, relayed or handed
 * to an agent still verifies, where TLS to the origin would have evaporated.
 *
 * It does NOT prove WHO the village is, and it cannot, because the key it is
 * checked against is whichever key the caller passed in. Hand it the key the
 * document itself published and an impostor passes every time: mint a keypair,
 * publish your own `publicKey` block, sign a document claiming somebody else's
 * `instanceId`, and this returns true.
 *
 * Identity is bound one layer up, by the caller choosing the key. `network.ts`
 * pins a peer's key on first contact (0057) and verifies every later sweep
 * against the PINNED key, which is a signature an impostor cannot produce. A
 * caller that verifies against the document's own key is asking about
 * integrity, and that is a real question with a real answer; it is just not
 * the question "is this who they say they are".
 */
export function verifyDocument(signed: Record<string, any>, publicKeyPem: string): boolean {
  const { proof, ...doc } = signed;
  if (!proof?.signature || !proof?.signedAt) return false;
  const body = canonicalJson({ ...doc, signedAt: proof.signedAt });
  try {
    return edVerify(
      null,
      Buffer.from(body, "utf8"),
      createPublicKey(publicKeyPem),
      Buffer.from(String(proof.signature), "base64url"),
    );
  } catch {
    return false;
  }
}

// ── The org export ──────────────────────────────────────────────────────────

export interface ExportCircle {
  id: string;
  name: string;
  purpose: string | null;
  status: string;
  parentCircleId: string | null;
  /** The fractal: this circle grew out of a seat that outgrew itself. */
  grownFromOrgRoleId: string | null;
  /**
   * How this circle decides (0083): the ID from shared/power.ts, never the
   * gloss. A gloss is the village's own free text and free text can hold a
   * name, which is the one thing these documents never carry. A village
   * telling the network "we decide by consent" is village-content and safe;
   * its sentence about what that means stays on the authenticated map.
   */
  decidesBy: string | null;
  /** Per-domain override IDS only: {money?: "consent", ...}. Same rule. */
  decidesByDomains: Record<string, string> | null;
}

export interface ExportSeat {
  id: string;
  circleId: string | null;
  name: string;
  aim: string | null;
  domain: string | null;
  accountabilities: string[];
  whyItMatters: string | null;
  seats: number;
  filled: number;
  /** open | filled | partial | forming | expired. Derived, never stored. */
  state: string;
  /**
   * Where `state` came from, because the two sources can disagree and a
   * document that disagrees with itself is worse than one that admits it.
   *
   * `records` means the state was worked out from the seatings in this
   * document, so `filled` and `seats` explain it. `declared` means a village
   * set a time-boxed `statusOverride` and it is still in force, so the state
   * is the village's own claim and the counts are what is written down. On the
   * live Amora chart that is not hypothetical: `land-steward` carries a 60-day
   * override of "filled" with no holder recorded, which published as
   * `{ seats: 1, filled: 0, state: "filled" }` and read as "Held. 0 of 1 held."
   */
  stateSource: "records" | "declared";
  criticality: string;
  recruiting: boolean;
}

export interface ExportRelation {
  typeId: string;
  label: string;
  inverseLabel: string;
  fromKind: string;
  fromId: string;
  toKind: string;
  toId: string;
}

export interface OrgExport {
  protocol: string;
  instanceId: string;
  name: string;
  updatedAt: string;
  /**
   * The village's declared shape (0083): the ID from shared/power.ts SHAPES,
   * or null while the village has not said. Ids only, same rule as
   * `decidesBy` below: the gloss is free text and stays home.
   */
  shape: string | null;
  circles: ExportCircle[];
  seats: ExportSeat[];
  /**
   * Links between nodes (0054). Safe to publish BY CONSTRUCTION rather than by
   * filtering: an endpoint can only be a seat or a circle, so there is no
   * person here to leave out. That is the reason the schema has no `user` node
   * kind, and the reason this list needed no privacy review of its own.
   */
  relations: ExportRelation[];
  /** Says out loud what this document does not carry, so nobody infers. */
  omits: string[];
}

export interface OrgExportInput {
  instanceId: string;
  villageName: string;
  roles: OrgRole[];
  assignments: OrgAssignment[];
  circles: any[];
  updatedAt: string;
  /** The village's declared shape id, from the map module's power config. */
  shape?: string | null;
  /** 0054 links, with their type already resolved. Omitted means none. */
  relations?: Array<{
    typeId: string; label: string; inverseLabel: string;
    fromKind: string; fromId: string; toKind: string; toId: string;
    isExample?: boolean;
  }>;
}

export function buildOrgExport(input: OrgExportInput): OrgExport {
  const held = new Map<string, OrgAssignment[]>();
  for (const a of input.assignments) {
    if (a.endedAt) continue;
    // An example seating must not count toward a real seat's holders. These
    // are seeded by the `progression` module, which is CORE, so a brand-new
    // fork has them before a human enables anything, and `claimSeating` does
    // not filter examples, so a real member can end up on one.
    if (a.isExample) continue;
    held.set(a.orgRoleId, [...(held.get(a.orgRoleId) ?? []), a]);
  }

  const circles: ExportCircle[] = input.circles
    .filter((c: any) => !c.isExample && isSlug(c.id))
    .sort((a: any, b: any) => Number(a.order ?? a.sortOrder ?? 0) - Number(b.order ?? b.sortOrder ?? 0))
    .map((c: any) => ({
      id: String(c.id),
      name: String(c.name),
      purpose: c.purpose ?? null,
      status: String(c.status ?? "active"),
      parentCircleId: c.parentCircleId ?? null,
      grownFromOrgRoleId: c.grownFromOrgRoleId ?? null,
      decidesBy: exportableDecidesBy(c.decidesBy),
      decidesByDomains: exportableDomains(c.decidesByDomains),
    }));

  // Cross-references are resolved AFTER both lists are known, so nothing
  // published points at something that was not. `parentCircleId` can name a
  // dropped example circle and `grownFromOrgRoleId` can name a seat that has
  // since been retired; either one sends an agent that follows links to a 404.
  const circleIds = new Set(circles.map((c) => c.id));

  const publishable = input.roles.filter((r) => r.active && !r.isExample && isSlug(r.id));
  const publishedSeatIds = new Set(publishable.map((r) => r.id));

  const seats: ExportSeat[] = publishable
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((r) => {
      const holders = held.get(r.id) ?? [];
      const override =
        r.statusOverride &&
        (!r.statusOverrideExpiresAt || r.statusOverrideExpiresAt.getTime() > Date.now());
      return {
        id: r.id,
        // A seat whose circle was dropped (example, or a bad id) must not
        // publish a dangling link an agent would then try to follow.
        circleId: r.circleId && circleIds.has(r.circleId) ? r.circleId : null,
        name: r.name,
        aim: r.aim,
        domain: r.domain,
        accountabilities: r.accountabilities ?? [],
        whyItMatters: r.whyItMatters,
        seats: r.seats,
        // AGENTS COUNT HERE, and that is the decision rather than an oversight
        // (0142). This is a DISPLAY read: it says how many hold each seat, and
        // a seat an agent sits in is held. The coverage question, "is somebody
        // carrying this", is asked elsewhere with `peopleOnly`, and it is a
        // different question with a different answer.
        //
        // Nothing about the agent leaves the village either way. This document
        // carries counts and never people, so there is no agent name to reveal
        // and the shape is unchanged by any of this.
        filled: holders.length,
        state: seatState(r, holders),
        stateSource: override ? "declared" : "records",
        criticality: r.criticality,
        recruiting: r.recruiting,
      };
    });

  for (const c of circles) {
    if (c.parentCircleId && !circleIds.has(c.parentCircleId)) c.parentCircleId = null;
    if (c.grownFromOrgRoleId && !publishedSeatIds.has(c.grownFromOrgRoleId)) c.grownFromOrgRoleId = null;
  }
  // A loop in `parentCircleId` has no top, so anything that draws this
  // document from it draws nothing at all. The writers refuse a loop now
  // (shared/circleView.ts) and the layout degrades instead of blanking, but
  // this document leaves the village and is read by software we do not own,
  // so it states a tree or it states no parent.
  const looped = new Set(circlesOnCycles(circles));
  for (const c of circles) if (looped.has(c.id)) c.parentCircleId = null;

  // Only links whose BOTH ends published. A relation pointing at a dropped
  // example seat is a link an agent follows into nothing, and the same rule
  // already guards circleId and grownFromOrgRoleId above.
  const published = (kind: string, id: string) =>
    kind === "circle" ? circleIds.has(id) : kind === "org_role" ? publishedSeatIds.has(id) : false;
  const relations: ExportRelation[] = (input.relations ?? [])
    .filter((r) => !r.isExample && published(r.fromKind, r.fromId) && published(r.toKind, r.toId))
    .map((r) => ({
      typeId: r.typeId, label: r.label, inverseLabel: r.inverseLabel,
      fromKind: r.fromKind, fromId: r.fromId, toKind: r.toKind, toId: r.toId,
    }));

  return {
    protocol: EXPORT_PROTOCOL,
    instanceId: input.instanceId,
    name: input.villageName,
    updatedAt: input.updatedAt,
    shape: exportableShape(input.shape),
    circles,
    seats,
    relations,
    omits: [
      "Who holds a seat. This document is unauthenticated, so it carries counts and never people.",
      "Standing example rows. They are demo data, so this document drops them instead of flagging them.",
      "Retired seats.",
      "The village's own glosses on its shape and ways of deciding. Ids only here; the words stay on the map.",
    ],
  };
}

// ── The Markdown mirror ─────────────────────────────────────────────────────
//
// Frontmatter carries a stable id, type and updatedAt; the body carries
// relative links, so the folder is walkable by a human, a crawler and an agent
// without any of them knowing the API exists.

/** YAML scalars, quoted so a colon or a `#` in a village's own words cannot break the block. */
function yaml(v: string | number | boolean | null): string {
  if (v === null) return "null";
  if (typeof v !== "string") return String(v);
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
}

/**
 * Link text. A village that names a seat "Water (springs)" or "Steward [land]"
 * would otherwise break every link that mentions it, because `[` and `]` close
 * the label and `(` opens the target. These documents are built to be handed
 * to agents, so a malformed link is not cosmetic.
 */
function linkText(v: string): string {
  return String(v).replace(/([[\]()])/g, "\\$1").replace(/\s+/g, " ").trim();
}

/**
 * Free text in a document body.
 *
 * A village's own words go here verbatim by design, and that is right: this is
 * their aim and their domain, in their voice. What is NOT right is a line of
 * it starting with `#` or `---` and silently becoming a heading or a
 * frontmatter fence in somebody else's parser, so leading structural markers
 * are escaped and the words are untouched.
 */
function prose(v: string): string {
  return String(v)
    .split(/\r\n?|\n/)
    .map((line) => line.replace(/^(\s*)(#{1,6}\s|-{3,}\s*$|={3,}\s*$|>\s)/, "$1\\$2"))
    .join("\n");
}

function frontmatter(fields: Record<string, string | number | boolean | null>): string {
  return ["---", ...Object.entries(fields).map(([k, v]) => `${k}: ${yaml(v)}`), "---"].join("\n");
}

const STATE_WORD: Record<string, string> = {
  open: "Nobody holds this yet",
  filled: "Held",
  partial: "Partly held",
  forming: "Forming",
  expired: "Held, and the term has run out",
};

/**
 * One sentence about a seat that stays true when the two sources disagree.
 *
 * A time-boxed `statusOverride` is the village saying it knows better than the
 * count, usually because somebody is holding a seat the records have not
 * caught up with. Printing the village's word and the count in one breath
 * produced "Held. 0 of 1 seat(s) held.", which is a document arguing with
 * itself. So when the state is declared and the count does not back it up, say
 * both as the separate facts they are.
 */
function seatSentence(s: ExportSeat): string {
  const word = STATE_WORD[s.state] ?? s.state;
  const counted = `${s.filled} of ${s.seats} seat(s) held`;
  const backed = s.state === "open" ? s.filled === 0 : s.filled > 0;
  if (s.stateSource === "declared" && !backed) {
    return `The village records this seat as: ${word.toLowerCase()}. No holder for it is written down here (${counted}).`;
  }
  return `${word}. ${counted}.`;
}

export function orgIndexMarkdown(doc: OrgExport): string {
  const byCircle = new Map<string, ExportSeat[]>();
  for (const s of doc.seats) byCircle.set(s.circleId ?? "", [...(byCircle.get(s.circleId ?? "") ?? []), s]);

  const lines: string[] = [
    frontmatter({ id: "index", type: "organization", name: doc.name, instanceId: doc.instanceId, updatedAt: doc.updatedAt }),
    "",
    `# ${doc.name}`,
    "",
    "The circles this village organises itself into and the seats inside them.",
    "This document carries no names: it says how many hold each seat, never who.",
    "",
  ];

  for (const c of doc.circles) {
    lines.push(`## [${linkText(c.name)}](circles/${c.id}.md)`);
    if (c.status !== "active") lines.push("", `Status: ${c.status}.`);
    if (c.purpose) lines.push("", prose(c.purpose));
    const seats = byCircle.get(c.id) ?? [];
    if (seats.length) {
      lines.push("");
      for (const s of seats) lines.push(`- [${linkText(s.name)}](roles/${s.id}.md): ${s.filled} of ${s.seats} held`);
    }
    lines.push("");
  }

  const loose = byCircle.get("") ?? [];
  if (loose.length) {
    lines.push("## Seats outside any circle", "");
    for (const s of loose) lines.push(`- [${linkText(s.name)}](roles/${s.id}.md): ${s.filled} of ${s.seats} held`);
    lines.push("");
  }

  lines.push("## What this leaves out", "");
  for (const o of doc.omits) lines.push(`- ${o}`);
  return lines.join("\n") + "\n";
}

export function circleMarkdown(doc: OrgExport, circle: ExportCircle): string {
  const seats = doc.seats.filter((s) => s.circleId === circle.id);
  const parent = circle.parentCircleId ? doc.circles.find((c) => c.id === circle.parentCircleId) : null;
  const grown = circle.grownFromOrgRoleId ? doc.seats.find((s) => s.id === circle.grownFromOrgRoleId) : null;

  const lines: string[] = [
    frontmatter({ id: circle.id, type: "circle", name: circle.name, status: circle.status, updatedAt: doc.updatedAt }),
    "",
    `# ${circle.name}`,
    "",
    `Part of [${linkText(doc.name)}](../index.md).`,
  ];
  if (parent) lines.push("", `Inside [${linkText(parent.name)}](${parent.id}.md).`);
  if (grown) lines.push("", `Grew out of the [${linkText(grown.name)}](../roles/${grown.id}.md) seat as it outgrew one person.`);
  if (circle.status !== "active") lines.push("", `Status: ${circle.status}.`);
  // 0083: the platform LABEL for the id, never the village's gloss. The label
  // is our vocabulary; the gloss is their free text and stays home.
  if (circle.decidesBy) {
    const label = DECIDES_BY.find((d) => d.id === circle.decidesBy)?.label ?? circle.decidesBy;
    lines.push("", `Decides by: ${label.toLowerCase()}.`);
  }
  if (circle.purpose) lines.push("", "## Purpose", "", prose(circle.purpose));

  if (seats.length) {
    lines.push("", "## Seats", "");
    for (const s of seats) {
      lines.push(`- [${linkText(s.name)}](../roles/${s.id}.md): ${seatSentence(s)}`);
    }
  }
  return lines.join("\n") + "\n";
}

export function seatMarkdown(doc: OrgExport, seat: ExportSeat): string {
  const circle = seat.circleId ? doc.circles.find((c) => c.id === seat.circleId) : null;
  const lines: string[] = [
    frontmatter({
      id: seat.id, type: "role", name: seat.name, circle: circle ? circle.id : null,
      seats: seat.seats, filled: seat.filled, state: seat.state,
      recruiting: seat.recruiting, updatedAt: doc.updatedAt,
    }),
    "",
    `# ${seat.name}`,
    "",
    circle ? `A seat in [${linkText(circle.name)}](../circles/${circle.id}.md).` : `A seat in [${linkText(doc.name)}](../index.md).`,
    "",
    seatSentence(seat),
  ];
  if (seat.recruiting) lines.push("", "This seat is open to anyone who wants to take it up.");
  if (seat.aim) lines.push("", "## Aim", "", prose(seat.aim));
  if (seat.domain) lines.push("", "## Domain", "", prose(seat.domain));
  if (seat.accountabilities.length) {
    lines.push("", "## Accountabilities", "");
    // One accountability is one bullet, so a newline inside it would split the
    // list rather than wrap the line.
    for (const a of seat.accountabilities) lines.push(`- ${prose(a).replace(/\s+/g, " ").trim()}`);
  }
  if (seat.whyItMatters) lines.push("", "## Why it matters", "", prose(seat.whyItMatters));

  // Links, phrased from THIS seat's side, so the page reads as a sentence
  // whichever end of the stored row it happens to be.
  const links = doc.relations
    .filter((r) => r.fromKind === "org_role" && r.fromId === seat.id)
    .map((r) => ({ words: r.label, kind: r.toKind, id: r.toId }))
    .concat(
      doc.relations
        .filter((r) => r.toKind === "org_role" && r.toId === seat.id)
        .map((r) => ({ words: r.inverseLabel, kind: r.fromKind, id: r.fromId })),
    );
  if (links.length) {
    lines.push("", "## Connected to", "");
    for (const l of links) {
      const to = l.kind === "circle"
        ? doc.circles.find((c) => c.id === l.id)
        : doc.seats.find((x) => x.id === l.id);
      if (!to) continue;
      const path = l.kind === "circle" ? `../circles/${l.id}.md` : `${l.id}.md`;
      lines.push(`- ${l.words} [${linkText(to.name)}](${path})`);
    }
  }
  return lines.join("\n") + "\n";
}
