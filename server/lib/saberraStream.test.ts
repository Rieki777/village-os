/**
 * Read against REAL captured replies from their connector on 2026-09-23, not
 * against a stream invented to match the parser.
 */
import { describe, expect, it } from "vitest";
import { readEventStream } from "./saberraStream";

describe("reading a framed reply", () => {
  it("reads the ordinary reply shape their connector sends", () => {
    const body = 'event: message\ndata: {"result":{"ok":true},"jsonrpc":"2.0","id":21}\n\n';
    const r = readEventStream(body);
    expect(r.messages).toEqual([{ result: { ok: true }, jsonrpc: "2.0", id: 21 }]);
    expect(r.unparsed).toEqual([]);
    expect(r.comments).toBe(0);
  });

  it("SURVIVES THE KEEPALIVES A SLOW ANSWER ARRIVES BEHIND", () => {
    // Verbatim shape from the collapse-pattern query, which took long enough
    // that their server sent two before answering. A reader that parses
    // everything after the first colon turns each of these into a failure, or
    // into an empty message that reads as an empty answer.
    const body =
      ": keepalive\n\n: keepalive\n\nevent: message\ndata: {\"result\":{\"text\":\"seven patterns\"},\"id\":40}\n\n";
    const r = readEventStream(body);
    expect(r.comments).toBe(2);
    expect(r.messages).toEqual([{ result: { text: "seven patterns" }, id: 40 }]);
    expect(r.unparsed).toEqual([]);
  });

  it("keeps several replies in the order they arrived", () => {
    const body =
      'event: message\ndata: {"id":1}\n\nevent: message\ndata: {"id":2}\n\nevent: message\ndata: {"id":3}\n\n';
    const r = readEventStream(body);
    expect(r.messages).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it("joins a payload split across several data lines, which is how a long answer arrives", () => {
    const body = 'event: message\ndata: {"result":\ndata: {"text":"a long answer"}}\n\n';
    const r = readEventStream(body);
    expect(r.messages).toEqual([{ result: { text: "a long answer" } }]);
  });

  it("reads a reply that ends with no trailing blank line", () => {
    // A truncated read or a body trimmed on the way here loses the final
    // separator, and the last message is the one the caller wanted.
    const r = readEventStream('event: message\ndata: {"id":7}');
    expect(r.messages).toEqual([{ id: 7 }]);
  });

  it("reads CRLF, which is what the wire actually sends", () => {
    // TWO messages on purpose. With one, a reader that split on \n alone still
    // passes: the stray \r lands at the end of the payload and JSON.parse
    // tolerates trailing whitespace. It is the SEPARATOR that a naive split
    // gets wrong, and a separator only matters when something follows it.
    const r = readEventStream(
      'event: message\r\ndata: {"id":9}\r\n\r\nevent: message\r\ndata: {"id":10}\r\n\r\n',
    );
    expect(r.messages).toEqual([{ id: 9 }, { id: 10 }]);
    expect(r.unparsed).toEqual([]);
  });

  it("KEEPS WHAT IT COULD NOT READ instead of dropping it", () => {
    // A vendor sending something unreadable is a thing to see. Silence here
    // would look exactly like a successful empty answer.
    const r = readEventStream("event: message\ndata: not json at all\n\n");
    expect(r.messages).toEqual([]);
    expect(r.unparsed).toEqual(["not json at all"]);
  });

  it("tells an empty stream apart from one whose content was unreadable", () => {
    const empty = readEventStream("");
    expect(empty.messages).toEqual([]);
    expect(empty.unparsed).toEqual([]);

    const onlyKeepalives = readEventStream(": keepalive\n\n: keepalive\n\n");
    expect(onlyKeepalives.messages).toEqual([]);
    expect(onlyKeepalives.unparsed).toEqual([]);
    expect(onlyKeepalives.comments).toBe(2);
  });

  it("does not turn a blank data line into an empty message", () => {
    const r = readEventStream("event: message\ndata: \n\n");
    expect(r.messages).toEqual([]);
    expect(r.unparsed).toEqual([]);
  });

  it("strips exactly one space after the field colon and no more", () => {
    // Read through `unparsed`, because JSON.parse eats leading whitespace and
    // would hide the difference between stripping one space and stripping all
    // of them. Two spaces in, one space survives.
    const r = readEventStream("data:  two spaces went in\n\n");
    expect(r.unparsed).toEqual([" two spaces went in"]);

    const one = readEventStream("data: one space went in\n\n");
    expect(one.unparsed).toEqual(["one space went in"]);
  });

  it("ignores the fields it has no use for without letting them become data", () => {
    const body = 'id: 42\nretry: 3000\nevent: message\ndata: {"id":42}\n\n';
    const r = readEventStream(body);
    expect(r.messages).toEqual([{ id: 42 }]);
    expect(r.unparsed).toEqual([]);
  });
});
