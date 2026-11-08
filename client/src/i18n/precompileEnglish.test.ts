import { compileMessage } from "@lingui/message-utils/compileMessage";
import { describe, expect, it } from "vitest";
import { precompileMessages } from "./precompileEnglish";

describe("precompileMessages: English compiled at build, so no compiler ships (spec §8 R5, R8)", () => {
  it("replaces each macro descriptor's message with Lingui's own compiled form", () => {
    const code = `i18n._({ id: "L2CVk3", message: "Skip to content" }); x({ id: "WcoXU2", message: "Your account, {firstName}", values: { firstName } })`;
    const out = precompileMessages(code);
    expect(out).toContain(`id: "L2CVk3", message: ${JSON.stringify(compileMessage("Skip to content"))}`);
    expect(out).toContain(`message: ${JSON.stringify(compileMessage("Your account, {firstName}"))}`);
    expect(out).not.toMatch(/message: "/);
  });

  it("compiles plurals, and keeps escapes and quotes intact", () => {
    const msg = `{count, plural, one {# vote} other {# votes}} for \\"Ana\\"`;
    const out = precompileMessages(`t({ id: "AbC-_9", message: "${msg}" })`);
    expect(out).toContain(JSON.stringify(compileMessage(`{count, plural, one {# vote} other {# votes}} for "Ana"`)));
  });

  /*
   * The JSX macro writes `values` (and `components`) BETWEEN the id and the
   * message, and single-quotes a message that holds a double quote. Both are
   * the real output of @lingui/vite-plugin 6.12 for `<Trans>` and `<Plural>`
   * (probed 2026-11-08). Missed, the message reached the browser as a string,
   * and with no compiler there every placeholder rendered raw: "{potName}".
   */
  it("compiles a JSX descriptor whose values come before its message", () => {
    const code = `<Trans_ {.../*i18n*/ {
        id: "Loql8J",
        values: {
            allowance: allowance
        },
        message: "Share {allowance} now",
        context: "funding rounds"
    }}/>`;
    const out = precompileMessages(code);
    expect(out).toContain(`message: ${JSON.stringify(compileMessage("Share {allowance} now"))}`);
    expect(out).not.toMatch(/message: "/);
  });

  it("compiles a single-quoted message and a plural with values first", () => {
    const code = `<T {...{ id: "Loql8J", values: { allowance: allowance }, message: 'Share {allowance} "now"' }}/><T {...{ id: "9VfSjV", values: { n: n }, message: "{n, plural, one {# idea} other {# ideas}}" }}/>`;
    const out = precompileMessages(code);
    expect(out).toContain(JSON.stringify(compileMessage(`Share {allowance} "now"`)));
    expect(out).toContain(JSON.stringify(compileMessage("{n, plural, one {# idea} other {# ideas}}")));
    expect(out).not.toMatch(/message: ['"]/);
  });

  it("compiles a descriptor with components between its id and message", () => {
    const code = `<T {...{ id: "AbCdE1", values: { a: a }, components: { 0: <Link href={x} className={y({ z: 1 })} /> }, message: "Read <0>{a}</0>" }}/>`;
    const out = precompileMessages(code);
    expect(out).toContain(JSON.stringify(compileMessage("Read <0>{a}</0>")));
  });

  it("leaves code without macro descriptors untouched", () => {
    const code = `const message = "hello"; obj({ id: "toolong1", message: "nope" })`;
    expect(precompileMessages(code)).toBe(code);
  });

  it("refuses a message that does not compile, naming it", () => {
    expect(() => precompileMessages(`t({ id: "AbCdEf", message: "{count, plural, one {x}" })`)).toThrow(/AbCdEf/);
  });
});
