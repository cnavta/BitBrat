import { redactText } from "../../src/common/prompt-assembly/redaction";

describe("redactText()", () => {
  it("redacts emails", () => {
    const out = redactText("contact me at a.b+c@example.com now");
    expect(out).not.toContain("@example.com");
    expect(out).toContain("[REDACTED_EMAIL]");
  });

  it("redacts OpenAI and AWS style keys", () => {
    const out1 = redactText("key sk-abcDEF1234567890zz");
    expect(out1).toContain("[REDACTED_KEY]");
    const out2 = redactText("AKIA1234567890ABCD12 is here");
    expect(out2).toContain("[REDACTED_KEY]");
  });

  it("redacts bearer tokens and long tokens", () => {
    const out1 = redactText("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789");
    expect(out1).toContain("Bearer [REDACTED_TOKEN]");
    const long = "x".repeat(40);
    const out2 = redactText(`token=${long}`);
    expect(out2).toContain("[REDACTED_TOKEN]");
  });

  it("redacts 16-digit card-like numbers", () => {
    const out = redactText("card 4242424242424242 end");
    expect(out).toContain("[REDACTED_NUMBER]");
  });
});
