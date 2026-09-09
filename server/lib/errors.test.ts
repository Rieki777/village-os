/**
 * WHAT THE ALARM DID, ASSERTED.
 *
 * `reportError` used to return `void`, and a caller could not tell a delivered
 * alert from an alert that reached nobody. That distinction is the whole point
 * on the boot path: a village whose database has just died cannot reach its own
 * admin table, so the webhook is the only sink left, and on a fresh instance
 * `ERROR_WEBHOOK_URL` is unset, which means the honest answer is "nobody was
 * told" and the process should say so rather than exit implying otherwise.
 *
 * The webhook is mocked here rather than dialled. The real dialler
 * (`guardedFetchJson`) pins the resolved IP and refuses private ranges, so
 * there is no loopback collector a test could stand up; asserting against the
 * seam is the only way to prove the POST fires without asking a stranger's
 * server whether it arrived.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const guardedFetchJson = vi.fn();
vi.mock("./toolcheck", () => ({ guardedFetchJson: (...a: any[]) => guardedFetchJson(...a) }));

const { reachedSomebody, reportError, reportErrorWithin, respondToTerminalError, terminalAnswerFor, wireErrorReporting } =
  await import("./errors");
// The REAL error class, so the duck-typed matcher is tested against the thing
// it has to recognise rather than against a look-alike built to satisfy it.
const { StaleSnapshotError } = await import("../repos/store-db");

const WEBHOOK = "https://collector.example/hook";

describe("error delivery is reported, not assumed", () => {
  let priorWebhook: string | undefined;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    priorWebhook = process.env.ERROR_WEBHOOK_URL;
    guardedFetchJson.mockReset();
    guardedFetchJson.mockResolvedValue({});
    // The reporter logs every report; the log is the point, not the noise.
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (priorWebhook === undefined) delete process.env.ERROR_WEBHOOK_URL;
    else process.env.ERROR_WEBHOOK_URL = priorWebhook;
    errSpy.mockRestore();
    wireErrorReporting({ notifyAdmins: async () => {}, instanceLabel: "village" });
  });

  it("says nobody was told when there is no webhook and the admin sink is dead", async () => {
    delete process.env.ERROR_WEBHOOK_URL;
    wireErrorReporting({
      notifyAdmins: async () => { throw new Error("ECONNREFUSED"); },
      instanceLabel: "a village",
    });
    const d = await reportError(new Error("no database at boot"), { where: "the village's boot" });
    expect(d.admins).toBe("failed");
    expect(d.webhook).toBe("not configured");
    expect(reachedSomebody(d)).toBe(false);
    expect(guardedFetchJson).not.toHaveBeenCalled();
  });

  it("still reaches the webhook when the admin sink needs a database that is gone", async () => {
    process.env.ERROR_WEBHOOK_URL = WEBHOOK;
    wireErrorReporting({
      notifyAdmins: async () => { throw new Error("ECONNREFUSED"); },
      instanceLabel: "a village",
    });
    const d = await reportError(new Error("migrations could not apply"), { where: "the village's boot" });
    expect(d.admins).toBe("failed");
    expect(d.webhook).toBe("sent");
    expect(reachedSomebody(d)).toBe(true);
    const [url, timeout, opts] = guardedFetchJson.mock.calls[0];
    expect(url).toBe(WEBHOOK);
    expect(timeout).toBeLessThanOrEqual(5000);
    expect(opts.method).toBe("POST");
    expect(String(opts.body.text)).toContain("migrations could not apply");
    expect(opts.body.where).toBe("the village's boot");
  });

  it("reports a refused webhook as failed rather than as sent", async () => {
    process.env.ERROR_WEBHOOK_URL = WEBHOOK;
    guardedFetchJson.mockRejectedValue(new Error("405"));
    wireErrorReporting({ notifyAdmins: async () => {}, instanceLabel: "a village" });
    const d = await reportError(new Error("a distinct failure for the webhook case"), { where: "the boot" });
    expect(d.admins).toBe("sent");
    expect(d.webhook).toBe("failed");
  });

  it("gives a dying process a deadline instead of a hang", async () => {
    process.env.ERROR_WEBHOOK_URL = WEBHOOK;
    // The failure that most needs reporting is the one where the admin sink is
    // a write to a database that will never answer. Without a deadline the
    // process waits on it and the restart policy eats the outage silently.
    wireErrorReporting({
      notifyAdmins: () => new Promise<void>(() => {}),
      instanceLabel: "a village",
    });
    const started = Date.now();
    const out = await reportErrorWithin(150, new Error("a hang nobody should wait on"), { where: "the boot" });
    expect(out).toBe("timed out");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("does not treat a suppressed repeat as a delivery", async () => {
    process.env.ERROR_WEBHOOK_URL = WEBHOOK;
    wireErrorReporting({ notifyAdmins: async () => {}, instanceLabel: "a village" });
    const err = new Error("the same failure twice inside the window");
    const first = await reportError(err, { where: "the boot" });
    expect(first.webhook).toBe("sent");
    const second = await reportError(err, { where: "the boot" });
    expect(second.suppressed).toBe(true);
    expect(reachedSomebody(second)).toBe(false);
    expect(guardedFetchJson).toHaveBeenCalledTimes(1);
  });
});

describe("what the terminal handler answers", () => {
  /**
   * A LOST RACE IS A 409 AND NOT A 500, and it was neither until now:
   * `StaleSnapshotError` was caught NOWHERE in the codebase, so it reached the
   * terminal handler and answered "Internal server error" to somebody whose
   * request had done exactly the right thing.
   */
  it("answers a real StaleSnapshotError with 409 and a sentence that names no table", () => {
    // THE REAL CLASS, constructed the way store-db constructs it. A hand-made
    // `{ code: "stale_snapshot" }` would prove only that the matcher matches
    // itself, and the matcher is duck-typed precisely so it can be wrong about
    // the real thing without anybody noticing.
    const real = new StaleSnapshotError("org_roles", 3, 11);
    const answer = terminalAnswerFor(real);

    expect(answer.status).toBe(409);
    expect(answer.body.code).toBe("stale_snapshot");
    expect(answer.level, "a lost race is not a fault, and the log should not shout").toBe("warn");
    expect(answer.body.error).toContain("Somebody else changed this");
    expect(answer.body.error).toContain("Nothing was saved");
    // The schema stays in the log. A member is not told our table names or our
    // version numbers, and the full detail is still carried for whoever reads
    // the console.
    expect(answer.body.error).not.toContain("org_roles");
    expect(answer.body.error).not.toContain("11");
    expect(answer.detail).toContain("org_roles");
  });

  it("still answers everything else with 500, which is the control", () => {
    // Without this, a matcher that returned 409 for every error would pass the
    // case above and break the whole surface.
    for (const other of [new Error("something broke"), new TypeError("nope"), "a string", null]) {
      const answer = terminalAnswerFor(other);
      expect(answer.status, String(other)).toBe(500);
      expect(answer.body.error).toBe("Internal server error");
      expect(answer.level).toBe("error");
    }
  });

  it("responds through the res it is handed, on the right console channel", () => {
    const sent: Array<{ status: number; body: unknown }> = [];
    const res = { status: (code: number) => ({ json: (body: unknown) => sent.push({ status: code, body }) }) };
    respondToTerminalError(new StaleSnapshotError("app_config", 1, 9), res);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.status).toBe(409);
  });
});
