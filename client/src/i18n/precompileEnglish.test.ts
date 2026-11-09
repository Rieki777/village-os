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

  it("leaves code without macro descriptors untouched", () => {
    const code = `const message = "hello"; obj({ id: "toolong1", message: "nope" })`;
    expect(precompileMessages(code)).toBe(code);
  });

  it("refuses a message that does not compile, naming it", () => {
    expect(() => precompileMessages(`t({ id: "AbCdEf", message: "{count, plural, one {x}" })`)).toThrow(/AbCdEf/);
  });
});
