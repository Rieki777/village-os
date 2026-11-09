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

  it("compiles a JSX Trans with values, whose descriptor puts values between the id and the message", () => {
    // The shape the macro emits for <Trans>To decide {nDecide}</Trans>, read off a built chunk: unmatched,
    // the message shipped as a string and the browser, which has no compiler, showed "To decide {nDecide}".
    const code = 'e.jsx(a,{id:"ZLIyy3",values:{nDecide:se},message:"To decide {nDecide}",context:"sera changes"})';
    const out = precompileMessages(code);
    expect(out).toContain('message:["To decide ",["nDecide"]]');
    // And with components holding a nested element, as a Trans around a link emits.
    const linked = 'e.jsx(a,{id:"Qw3rT9",values:{n:x},components:{0:e.jsx("a",{href:"#x"})},message:"See <0>{n}</0>"})';
    expect(precompileMessages(linked)).toContain('message:["See ",');
  });

  it("leaves code without macro descriptors untouched", () => {
    const code = `const message = "hello"; obj({ id: "toolong1", message: "nope" })`;
    expect(precompileMessages(code)).toBe(code);
  });

  it("refuses a message that does not compile, naming it", () => {
    expect(() => precompileMessages(`t({ id: "AbCdEf", message: "{count, plural, one {x}" })`)).toThrow(/AbCdEf/);
  });
});
