/**
 * A REFERENCE self-hosted Base governance listener (R58a's self-hosted half,
 * shipped rather than only documented).
 *
 * WHY THIS EXISTS. `listener.ts` in this directory says plainly that a
 * self-hosted village "watches Base itself" and that "nothing here starts a
 * listener for you" - standing one up was left as the village's own
 * operational work. That is honest about what the module reads and reports,
 * but it leaves a real gap: writing a Base log listener from scratch (a
 * pinned RPC dialer, reorg-safe polling, idempotent delivery, retry and
 * dead-letter handling) is a development project, not something a
 * non-technical steward can do in an afternoon. This file is that
 * infrastructure, built once and shared, so the self-hosted posture is a
 * DEPLOY CHOICE instead.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: decide which on-chain EVENT means
 * "passed" for YOUR Hypha space. That mapping is operator-supplied config
 * (`passedTopic0` / `failedTopic0` / `agreementIdTopicIndex`), not hardcoded
 * here, because there is no trustworthy ABI to hardcode against. Checked
 * before writing this: `hypha-dao/ethereum-contracts` (the org's own public
 * EVM contract repo) ships exactly one governance contract,
 * `contracts/DAO.sol`, and its own header reads "POC - these functions are
 * just stubs for the real methods they are not real implementations of a
 * DAO." Shipping a listener that silently watches for events from a
 * contract Hypha itself labels a stub would be worse than admitting the
 * gap: it would look configured and deliver nothing, which is exactly the
 * silent failure this whole module exists to avoid. A steward who CAN read
 * their own DHO's contract on Basescan (open the transaction from an
 * already-executed proposal, read its Logs tab) can fill in three config
 * values; writing the dialer, the checkpointing and the retry logic from
 * nothing is the part this file removes.
 *
 * WHAT IT DOES HANDLE: polling a dedicated Base RPC for logs from one
 * contract address, filtered at the RPC by up to two configured topic0
 * hashes; waiting for a confirmation depth before treating a block as
 * final (a bounded, practical reorg guard - not a subscription); decoding
 * an agreement id from a configured indexed topic AND/OR scanning topics
 * and data for a `[gm:<id>]` marker, matching this platform's own
 * strong-key/fallback rule in `outcomes.ts`; delivering through
 * `guardedFetchJson`, the SAME pinned, SSRF-guarded, per-hop-revalidating
 * dialer every other admin-typed outbound call in this codebase uses (see
 * `../toolcheck.ts`); a local, restart-safe checkpoint (block pointer plus
 * a bounded set of already-delivered log keys, so a delivery already
 * accepted by the webhook is never replayed and a delivery that failed IS
 * retried); and a bounded dead-letter path so one permanently-failing
 * delivery cannot wedge every log behind it forever.
 *
 * WHAT IT DOES NOT HANDLE, said out loud rather than discovered later:
 *
 *   - It does not discover the right contract address, topic hashes or
 *     agreement-id topic index. An operator supplies them (see
 *     `loadConfigFromEnv` below for the env vars and where to find each
 *     value).
 *   - It is not a websocket subscription. It polls on an interval and
 *     accepts the latency that implies; for a village's own governance
 *     outcomes, which are not time-critical the way a trade is, that is
 *     the right trade rather than a limitation to route around.
 *   - It holds no wallet key and sends no transaction. It only reads logs
 *     and only ever calls this village's OWN webhook - it cannot act on
 *     Hypha or on Base.
 *   - Reorg handling is "wait N confirmations," not a rollback. A reorg
 *     deeper than the configured confirmation depth is not detected. Base
 *     is an OP-Stack L2 with fast, shallow reorgs in ordinary operation;
 *     the default of 5 blocks is conservative for that, not a proof.
 *   - It is one process, one contract, one village. It is not the hub's
 *     multi-tenant listener and was never meant to become it.
 *
 * HOW TO RUN IT: `npx tsx server/lib/hypha/selfHostedListener.ts`, as its
 * own long-running process (a second Railway service, a systemd unit, a
 * screen session - whatever the operator already knows how to keep alive;
 * this file does not choose that for them). Configuration is environment
 * variables only, listed in `loadConfigFromEnv`, so the process needs
 * nothing from this village's database or its game-variables store to
 * start. State lives at `DATA_DIR/hypha-listener-checkpoint.json` by
 * default (same `DATA_DIR` convention `server/index.ts` uses; override
 * with `HYPHA_LISTENER_DATA_DIR`), and a permanently-failed delivery is
 * appended to `DATA_DIR/hypha-listener-deadletter.jsonl` for a steward to
 * read and resolve by hand through the existing orphan tools
 * (`POST /api/admin/hypha/outcomes/:id/resolve`) once it is fixed.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createPublicClient, http, toHex } from "viem";
import { base } from "viem/chains";
import { guardedFetchJson, guardOutboundUrl } from "../toolcheck";
import { extractMechanicsMarker } from "../hypha-bridge";

// ── Config ────────────────────────────────────────────────────────────────

export interface ListenerConfig {
  /** A DEDICATED Base RPC endpoint (Alchemy, etc). A listener holds effectively
   *  continuous polling open; a shared public node is not built for that, the
   *  same reasoning `listener.ts`'s `isDedicatedRpc` already encodes. */
  rpcUrl: string;
  /** The contract this village's Hypha space's governance outcomes are read
   *  from. Find it on the DHO's own agreements/proposals page, or from the
   *  `to` address of an already-executed proposal's transaction. */
  contractAddress: `0x${string}`;
  /** topic0 (keccak256 of the event signature) of the event this steward has
   *  confirmed means "this proposal passed and applied." Find it on
   *  Basescan: open an already-executed proposal's transaction, its Logs
   *  tab, the log this platform's proposal corresponds to, "Topics[0]." At
   *  least one of `passedTopic0` / `failedTopic0` is required or the
   *  listener has nothing to watch for and says so at start. */
  passedTopic0?: string;
  /** Same idea, for a proposal that was voted down / did not apply. */
  failedTopic0?: string;
  /** Which topics[] index (0 is the event signature itself, so a real
   *  indexed argument starts at 1) carries the agreement id as an indexed
   *  uint256 or bytes32. Omit if this event does not index one; the
   *  `[gm:<id>]` marker scan still runs either way. */
  agreementIdTopicIndex?: number;
  /** This village's OWN webhook receiver, normally
   *  `https://<this-deployment>/api/webhooks/mechanics-governance`. */
  webhookUrl: string;
  /** The SAME value saved under Admin, Integrations, "Governance hub
   *  deliveries" - self-chosen for a self-hosted village, not issued by
   *  anybody, since nothing about `/api/webhooks/mechanics-governance`
   *  requires the secret to have come from the hub. It only has to be the
   *  value this village's own webhook checks against. */
  webhookSecret: string;
  /** This village's `hypha.space_id`, when set, so the webhook's own
   *  space-provenance check (`checkSpace`) has something to compare. */
  spaceId?: string;
  /** Blocks to wait behind the chain head before treating a log as final.
   *  Default 5: conservative for an OP-Stack L2's ordinary reorg depth,
   *  not a guarantee. */
  confirmations?: number;
  /** Default 15s. */
  pollIntervalMs?: number;
  /** Default `${DATA_DIR}/hypha-listener-checkpoint.json`. */
  checkpointPath?: string;
  /** Default `${DATA_DIR}/hypha-listener-deadletter.jsonl`. */
  deadLetterPath?: string;
  /** Consecutive failed attempts before a delivery is dead-lettered instead
   *  of retried forever. Default 20 (roughly 5 minutes at the default poll
   *  interval). */
  maxAttempts?: number;
}

const DATA_DIR = process.env.HYPHA_LISTENER_DATA_DIR
  ? path.resolve(process.env.HYPHA_LISTENER_DATA_DIR)
  : path.resolve(process.env.DATA_DIR ? process.env.DATA_DIR : "./data");

/** Reads the whole config from environment variables. Throws with a specific,
 *  actionable message on the first thing missing or malformed, rather than
 *  starting a process that will fail confusingly on its first poll. */
export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ListenerConfig {
  const contractAddress = envOrThrow(env, "HYPHA_LISTENER_CONTRACT_ADDRESS");
  if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
    throw new Error(`HYPHA_LISTENER_CONTRACT_ADDRESS is not a 20-byte hex address: ${contractAddress}`);
  }
  const passedTopic0 = env.HYPHA_LISTENER_PASSED_TOPIC0?.trim() || undefined;
  const failedTopic0 = env.HYPHA_LISTENER_FAILED_TOPIC0?.trim() || undefined;
  if (!passedTopic0 && !failedTopic0) {
    throw new Error(
      "Set at least one of HYPHA_LISTENER_PASSED_TOPIC0 / HYPHA_LISTENER_FAILED_TOPIC0. " +
        "With neither set this listener would poll forever and deliver nothing.",
    );
  }
  const agreementIdTopicIndexRaw = env.HYPHA_LISTENER_AGREEMENT_ID_TOPIC_INDEX?.trim();
  const agreementIdTopicIndex = agreementIdTopicIndexRaw ? Number(agreementIdTopicIndexRaw) : undefined;
  if (agreementIdTopicIndex !== undefined && (!Number.isInteger(agreementIdTopicIndex) || agreementIdTopicIndex < 0 || agreementIdTopicIndex > 3)) {
    throw new Error(`HYPHA_LISTENER_AGREEMENT_ID_TOPIC_INDEX must be an integer 0-3, got ${agreementIdTopicIndexRaw}`);
  }
  return {
    rpcUrl: envOrThrow(env, "HYPHA_LISTENER_RPC_URL"),
    contractAddress: contractAddress as `0x${string}`,
    passedTopic0,
    failedTopic0,
    agreementIdTopicIndex,
    webhookUrl: envOrThrow(env, "HYPHA_LISTENER_WEBHOOK_URL"),
    webhookSecret: envOrThrow(env, "HYPHA_LISTENER_WEBHOOK_SECRET"),
    spaceId: env.HYPHA_LISTENER_SPACE_ID?.trim() || undefined,
    confirmations: env.HYPHA_LISTENER_CONFIRMATIONS ? Number(env.HYPHA_LISTENER_CONFIRMATIONS) : undefined,
    pollIntervalMs: env.HYPHA_LISTENER_POLL_INTERVAL_MS ? Number(env.HYPHA_LISTENER_POLL_INTERVAL_MS) : undefined,
    checkpointPath: env.HYPHA_LISTENER_CHECKPOINT_PATH?.trim() || undefined,
    deadLetterPath: env.HYPHA_LISTENER_DEADLETTER_PATH?.trim() || undefined,
    maxAttempts: env.HYPHA_LISTENER_MAX_ATTEMPTS ? Number(env.HYPHA_LISTENER_MAX_ATTEMPTS) : undefined,
  };
}

function envOrThrow(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v || !v.trim()) {
    throw new Error(
      `${name} is required. See the doc comment at the top of ` +
        `server/lib/hypha/selfHostedListener.ts for what it needs to be and where to find it.`,
    );
  }
  return v.trim();
}

// ── Pure decoding (no network, no filesystem) ────────────────────────────

export interface RawLog {
  readonly topics: readonly string[];
  readonly data: string;
  readonly transactionHash: string;
  readonly logIndex: number;
  readonly blockNumber: bigint;
}

/** Which of the two configured outcomes this log's topic0 matches, or null
 *  when it matches neither (the RPC-level topic filter already excludes
 *  almost everything, so this is mostly a belt-and-suspenders check). */
export function decideOutcomeKind(
  log: Pick<RawLog, "topics">,
  cfg: Pick<ListenerConfig, "passedTopic0" | "failedTopic0">,
): "passed" | "failed" | null {
  const topic0 = (log.topics[0] ?? "").toLowerCase();
  if (cfg.passedTopic0 && topic0 === cfg.passedTopic0.toLowerCase()) return "passed";
  if (cfg.failedTopic0 && topic0 === cfg.failedTopic0.toLowerCase()) return "failed";
  return null;
}

/** A 32-byte indexed topic decoded as a plain decimal id string, the way an
 *  indexed `uint256`/`bytes32` argument reads. Null on anything unparseable,
 *  never a thrown error - a malformed topic is a reason to fall back to the
 *  marker scan, not a reason to drop the delivery. */
export function readAgreementIdFromTopic(topic: string | undefined): string | null {
  if (!topic) return null;
  try {
    const n = BigInt(topic);
    return n.toString();
  } catch {
    return null;
  }
}

function hexToUtf8Lossy(hex: string): string {
  const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (!clean || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) return "";
  try {
    // eslint-disable-next-line no-control-regex
    return Buffer.from(clean, "hex").toString("utf8").replace(/\0/g, "");
  } catch {
    return "";
  }
}

/** Best-effort `[gm:<id>]` search across every topic and the data field,
 *  hex-decoded to text. This is the SAME marker `hypha-bridge.ts` puts in a
 *  Hypha proposal's title; it survives here only if the event a steward
 *  configured actually carries that title (or some string containing it) in
 *  an unindexed argument. When it does not, `agreementIdTopicIndex` is the
 *  path that still works - the two are deliberately independent fallbacks,
 *  matching `outcomes.ts`'s own strong-key/fallback shape. */
export function scanForMarker(log: Pick<RawLog, "topics" | "data">): string | null {
  for (const chunk of [...log.topics, log.data]) {
    const found = extractMechanicsMarker(hexToUtf8Lossy(chunk));
    if (found) return found;
  }
  return null;
}

export interface DecodedDelivery {
  outcome: "passed" | "failed";
  agreementId: string | null;
  marker: string | null;
  txHash: string;
  logIndex: number;
  blockNumber: string;
}

/** The whole decode step, pure. Returns null when the log does not match a
 *  configured outcome, or matches one but carries nothing this platform can
 *  key a proposal on - a log this listener has no business forwarding,
 *  either way, and the caller marks it seen without ever calling the
 *  webhook for it. */
export function decodeLog(
  log: RawLog,
  cfg: Pick<ListenerConfig, "passedTopic0" | "failedTopic0" | "agreementIdTopicIndex">,
): DecodedDelivery | null {
  const outcome = decideOutcomeKind(log, cfg);
  if (!outcome) return null;
  const agreementId =
    cfg.agreementIdTopicIndex !== undefined ? readAgreementIdFromTopic(log.topics[cfg.agreementIdTopicIndex]) : null;
  const marker = scanForMarker(log);
  if (!agreementId && !marker) return null;
  return {
    outcome,
    agreementId,
    marker,
    txHash: log.transactionHash,
    logIndex: log.logIndex,
    blockNumber: log.blockNumber.toString(),
  };
}

/** The exact body `/api/webhooks/mechanics-governance` expects
 *  (`readInboundOutcome` in `outcomes.ts` reads every one of these field
 *  names). `deliveryId` is set to a value stable across retries and unique
 *  per log, so a retried delivery repairs a partial write instead of
 *  duplicating one (the webhook's own `hypha_outcomes.delivery_key` unique
 *  index is the second half of that guarantee). */
export function buildDeliveryPayload(d: DecodedDelivery, spaceId?: string): Record<string, unknown> {
  return {
    outcome: d.outcome,
    agreementId: d.agreementId ?? undefined,
    marker: d.marker ? `[gm:${d.marker}]` : undefined,
    txHash: d.txHash,
    deliveryId: `${d.txHash}:${d.logIndex}`,
    spaceId: spaceId || undefined,
  };
}

// ── Checkpoint (local file; DATA_DIR-relative, already gitignored, matching
//    server/index.ts's own runtime-state convention) ─────────────────────

export interface Checkpoint {
  /** Stringified bigint: the highest block fully processed. */
  lastScannedBlock: string;
  /** Bounded ring of `${txHash}:${logIndex}` already delivered OR decided
   *  not to matter, so neither is repeated. */
  delivered: string[];
  /** Consecutive failed attempts per pending delivery key, so a permanently
   *  failing one can be dead-lettered instead of blocking every block after
   *  it forever. */
  attempts: Record<string, number>;
}

const DELIVERED_CAP = 2000;

export function emptyCheckpoint(): Checkpoint {
  return { lastScannedBlock: "0", delivered: [], attempts: {} };
}

export function loadCheckpoint(filePath: string): Checkpoint {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.lastScannedBlock === "string" && Array.isArray(parsed?.delivered)) {
      return { lastScannedBlock: parsed.lastScannedBlock, delivered: parsed.delivered, attempts: parsed.attempts ?? {} };
    }
  } catch {
    // First run, or a checkpoint file this version cannot read: start clean.
    // Starting clean re-scans from block 0 forward on a truly first run
    // only; `pollOnce` always resumes from a saved block number otherwise,
    // so this branch does not silently skip history - see `runListener`,
    // which requires an explicit start block on a first run.
  }
  return emptyCheckpoint();
}

export function saveCheckpoint(filePath: string, cp: Checkpoint): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const bounded: Checkpoint = { ...cp, delivered: cp.delivered.slice(-DELIVERED_CAP) };
  fs.writeFileSync(filePath, JSON.stringify(bounded, null, 2));
}

export function appendDeadLetter(filePath: string, entry: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`);
}

// ── Delivery: the SAME pinned, SSRF-guarded dialer every other admin-typed
//    outbound call in this codebase goes through - see toolcheck.ts's own
//    header on why a second bare fetch is exactly how that guard has
//    silently been bypassed before. ─────────────────────────────────────

export async function deliverOutcome(webhookUrl: string, webhookSecret: string, payload: Record<string, unknown>): Promise<void> {
  await guardedFetchJson(webhookUrl, 10_000, {
    method: "POST",
    headers: { "x-governance-hub-secret": webhookSecret },
    body: payload,
  });
}

// ── The poll step, pure with respect to its inputs (reader and deliver are
//    injected), so it is testable with zero network and zero filesystem. ──

export interface ChainReader {
  latestBlock(): Promise<bigint>;
  /** Inclusive range. Implementations are expected to filter at the RPC by
   *  address and topic0 already; this function does not re-filter, it only
   *  decodes what it is handed. */
  logsInRange(fromBlock: bigint, toBlock: bigint): Promise<readonly RawLog[]>;
}

export type Deliver = (payload: Record<string, unknown>) => Promise<void>;

export async function pollOnce(
  cfg: Pick<ListenerConfig, "passedTopic0" | "failedTopic0" | "agreementIdTopicIndex" | "spaceId" | "confirmations" | "maxAttempts">,
  reader: ChainReader,
  deliver: Deliver,
  cp: Checkpoint,
  onEvent: (msg: string) => void = () => {},
  onDeadLetter: (key: string, payload: Record<string, unknown>, error: string) => void = () => {},
): Promise<Checkpoint> {
  const confirmations = BigInt(cfg.confirmations ?? 5);
  const maxAttempts = cfg.maxAttempts ?? 20;
  const latest = await reader.latestBlock();
  if (latest <= confirmations) return cp; // chain younger than the confirmation depth; nothing is final yet
  const safeHead = latest - confirmations;
  const from = BigInt(cp.lastScannedBlock) + BigInt(1);
  if (from > safeHead) return cp; // already caught up to the safe head

  const logs = await reader.logsInRange(from, safeHead);
  const delivered = new Set(cp.delivered);
  const attempts = { ...cp.attempts };
  let allSettled = true;

  for (const log of logs) {
    const key = `${log.transactionHash}:${log.logIndex}`;
    if (delivered.has(key)) continue;
    const decoded = decodeLog(log, cfg);
    if (!decoded) {
      delivered.add(key); // not a match; never worth decoding again
      continue;
    }
    const payload = buildDeliveryPayload(decoded, cfg.spaceId);
    try {
      await deliver(payload);
      delivered.add(key);
      delete attempts[key];
      onEvent(
        `delivered ${decoded.outcome} for ${decoded.agreementId ? `agreement ${decoded.agreementId}` : `marker gm:${decoded.marker}`} (${key})`,
      );
    } catch (e) {
      const n = (attempts[key] ?? 0) + 1;
      attempts[key] = n;
      const message = (e as Error)?.message ?? String(e);
      if (n >= maxAttempts) {
        // Give up on THIS delivery specifically, loudly, without wedging
        // everything after it - a dead letter is a steward's problem, an
        // infinite retry that never advances the checkpoint is everybody's.
        delivered.add(key);
        delete attempts[key];
        onDeadLetter(key, payload, message);
        onEvent(`DEAD-LETTERED after ${n} attempts: ${key}: ${message}`);
      } else {
        allSettled = false;
        onEvent(`delivery failed (attempt ${n}/${maxAttempts}), will retry next poll: ${key}: ${message}`);
      }
    }
  }

  return {
    // Advance only once nothing in this range is still waiting on a retry -
    // blocks are scanned once, so holding the pointer back is the only way
    // a failed delivery gets asked for again.
    lastScannedBlock: allSettled ? safeHead.toString() : cp.lastScannedBlock,
    // Array.from, not a spread: tsconfig.json leaves `pnpm check` at the ES5
    // default (see tsconfig.tests.json's own note on this), and spreading a
    // Set needs --downlevelIteration or an ES2015+ target. Array.from needs
    // neither.
    delivered: Array.from(delivered),
    attempts,
  };
}

// ── The real chain reader (viem) and the real run loop. Not imported by the
//    test file above this line; everything above is exercised with fakes. ──

export function makeViemChainReader(cfg: Pick<ListenerConfig, "rpcUrl" | "contractAddress" | "passedTopic0" | "failedTopic0">): ChainReader {
  const client = createPublicClient({ chain: base, transport: http(cfg.rpcUrl, { timeout: 15_000 }) });
  const topic0Filter = [cfg.passedTopic0, cfg.failedTopic0].filter((t): t is string => !!t);
  return {
    async latestBlock() {
      return client.getBlockNumber();
    },
    async logsInRange(fromBlock, toBlock) {
      // Raw `eth_getLogs`, not viem's typed `getLogs` action: that action's
      // `topics` filter is only reachable through its ABI-event overloads
      // (`event`/`events`/`args`), and this reader deliberately decodes no
      // ABI - see the module header on why there is no trustworthy Hypha
      // ABI to write one against. A raw JSON-RPC call is what "any log at
      // this address whose topic0 is one of these two hashes" actually is.
      const raw = (await client.request({
        method: "eth_getLogs",
        params: [
          {
            address: cfg.contractAddress,
            fromBlock: toHex(fromBlock),
            toBlock: toHex(toBlock),
            // A single-position OR: any log whose topic0 is one of the ones
            // we watch for.
            topics: topic0Filter.length ? [topic0Filter] : [],
          },
        ],
        // eth_getLogs is a standard JSON-RPC method viem's public-client
        // schema does not itself enumerate; the client still dials it,
        // typing it loosely here is honest rather than fighting the SDK's
        // ABI-shaped surface for a call that is deliberately ABI-free.
      } as never)) as RawEthLog[];
      return raw.map((l) => ({
        topics: l.topics,
        data: l.data,
        transactionHash: l.transactionHash,
        logIndex: Number(l.logIndex),
        blockNumber: BigInt(l.blockNumber),
      }));
    },
  };
}

/** The shape a standard Base/Ethereum JSON-RPC node returns from
 *  `eth_getLogs`: every numeric field as a hex string, exactly as it comes
 *  over the wire. */
interface RawEthLog {
  topics: readonly string[];
  data: string;
  transactionHash: string;
  logIndex: string;
  blockNumber: string;
}

function resolvedCheckpointPath(cfg: ListenerConfig): string {
  return cfg.checkpointPath || path.join(DATA_DIR, "hypha-listener-checkpoint.json");
}
function resolvedDeadLetterPath(cfg: ListenerConfig): string {
  return cfg.deadLetterPath || path.join(DATA_DIR, "hypha-listener-deadletter.jsonl");
}

/**
 * The long-running process. Validates the webhook URL up front with the
 * SAME guard `deliverOutcome` dials through (fail loud at start, not on the
 * first silently-swallowed poll), then loops on `pollOnce` until the
 * process receives SIGINT/SIGTERM.
 */
export async function runListener(cfg: ListenerConfig): Promise<void> {
  const webhookGuard = await guardOutboundUrl(cfg.webhookUrl);
  if (!webhookGuard.ok) {
    throw new Error(`HYPHA_LISTENER_WEBHOOK_URL refused: ${webhookGuard.refused}. It must be https and a public address.`);
  }
  const checkpointPath = resolvedCheckpointPath(cfg);
  const deadLetterPath = resolvedDeadLetterPath(cfg);
  let cp = loadCheckpoint(checkpointPath);
  if (cp.lastScannedBlock === "0" && process.env.HYPHA_LISTENER_START_BLOCK) {
    // A genuinely first run: start from a named block rather than from
    // genesis, which `logsInRange` would otherwise happily attempt and
    // which no Base RPC serves cheaply.
    cp = { ...cp, lastScannedBlock: (BigInt(process.env.HYPHA_LISTENER_START_BLOCK) - BigInt(1)).toString() };
  } else if (cp.lastScannedBlock === "0") {
    throw new Error(
      "No checkpoint on disk and HYPHA_LISTENER_START_BLOCK is not set. " +
        "Set it once, to the block your Hypha space started using this contract " +
        "(or the current head, to only watch outcomes from now on); after the " +
        "first successful poll the checkpoint file takes over.",
    );
  }

  const reader = makeViemChainReader(cfg);
  const deliver: Deliver = (payload) => deliverOutcome(cfg.webhookUrl, cfg.webhookSecret, payload);
  const intervalMs = cfg.pollIntervalMs ?? 15_000;

  console.log(
    `[hypha-listener] watching ${cfg.contractAddress} on Base, from block ${cp.lastScannedBlock}, ` +
      `every ${intervalMs}ms. passed=${cfg.passedTopic0 ?? "(not watched)"} failed=${cfg.failedTopic0 ?? "(not watched)"}`,
  );

  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  while (!stopped) {
    try {
      cp = await pollOnce(
        cfg,
        reader,
        deliver,
        cp,
        (msg) => console.log(`[hypha-listener] ${msg}`),
        (key, payload, error) => appendDeadLetter(deadLetterPath, { key, payload, error }),
      );
      saveCheckpoint(checkpointPath, cp);
    } catch (e) {
      // A poll-level failure (RPC down, etc): logged, not fatal. The next
      // interval tries again from the same unchanged checkpoint.
      console.error(`[hypha-listener] poll failed, will retry: ${(e as Error)?.message ?? e}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  console.log("[hypha-listener] stopping (signal received)");
}

// ── CLI entry point: `npx tsx server/lib/hypha/selfHostedListener.ts` ────

const isMain = (() => {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isMain) {
  runListener(loadConfigFromEnv()).catch((e) => {
    console.error(`[hypha-listener] fatal: ${(e as Error)?.message ?? e}`);
    process.exit(1);
  });
}
