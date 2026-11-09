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

  it("compiles a <Trans> or <Plural> with values, which the macro emits as id, values, message", () => {
    // The shape a built chunk actually carries (TreasurySync, 2026-11-08):
    // `values` sits between `id` and `message`, and the message was left a
    // raw string, so the page printed "Paid {paidOn}" with the braces in.
    const code = `e.jsx(t,{id:"224D8v",values:{paidOn:o},message:"Paid {paidOn}",context:"treasury sync"}); e.jsx(t,{id:"Zz9_-a",values:{0:d.review.consents},message:"{0, plural, one {# person} other {# people}}"})`;
    const out = precompileMessages(code);
    expect(out).toContain(`message:${JSON.stringify(compileMessage("Paid {paidOn}"))}`);
    expect(out).toContain(JSON.stringify(compileMessage("{0, plural, one {# person} other {# people}}")));
    expect(out).not.toMatch(/message:"/);
  });

  it("compiles a descriptor whose values hold a nested object or a call", () => {
    const out = precompileMessages(`x({id:"Ab12Cd",values:{a:f({b:1}),c:g(h)},message:"{a} and {c}"})`);
    expect(out).toContain(JSON.stringify(compileMessage("{a} and {c}")));
  });

  /*
   * The macro single-quotes a message that holds a double quote, and pretty-
   * prints a JSX descriptor across lines (@lingui/vite-plugin 6.12, probed
   * 2026-11-08 on the Funding rounds page). A single-quoted message left as a
   * string renders its placeholders raw, the same defect as the values case.
   */
  it("compiles a single-quoted message, with values first", () => {
    const code = `<T {...{ id: "Loql8J", values: { allowance: allowance }, message: 'Share {allowance} "now"' }}/>`;
    const out = precompileMessages(code);
    expect(out).toContain(JSON.stringify(compileMessage(`Share {allowance} "now"`)));
    expect(out).not.toMatch(/message: ['"]/);
  });

  it("compiles a pretty-printed JSX descriptor across lines", () => {
    const code = `<Trans_ {.../*i18n*/ {
        id: "Loql8J",
        values: {
            allowance: allowance
        },
        message: "Share {allowance} now",
        context: "funding rounds"
    }}/>`;
    expect(precompileMessages(code)).toContain(`message: ${JSON.stringify(compileMessage("Share {allowance} now"))}`);
  });

  it("compiles a descriptor with JSX components between its id and message", () => {
    const code = `<T {...{ id: "AbCdE1", values: { a: a }, components: { 0: <Link href={x} className={y({ z: 1 })} /> }, message: "Read <0>{a}</0>" }}/>`;
    expect(precompileMessages(code)).toContain(JSON.stringify(compileMessage("Read <0>{a}</0>")));
  });

  it("leaves code without macro descriptors untouched", () => {
    const code = `const message = "hello"; obj({ id: "toolong1", message: "nope" })`;
    expect(precompileMessages(code)).toBe(code);
  });

  it("refuses a message that does not compile, naming it", () => {
    expect(() => precompileMessages(`t({ id: "AbCdEf", message: "{count, plural, one {x}" })`)).toThrow(/AbCdEf/);
  });
});
