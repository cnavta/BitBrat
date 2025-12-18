import { assemble } from "../../../src/common/prompt-assembly/assemble";
import { openaiAdapter } from "../../../src/common/prompt-assembly/adapters/openai";
import { googleAdapter } from "../../../src/common/prompt-assembly/adapters/google";
import type { PromptSpec } from "../../../src/common/prompt-assembly/types";

describe("adapters – edge cases: tool role and timestamps", () => {
  const timestamp = new Date().toISOString();
  const spec: PromptSpec = {
    systemPrompt: { rules: ["Follow"], summary: "Sys" },
    identity: { summary: "Persona" },
    requestingUser: { handle: "@u" },
    conversationState: {
      summary: "Recent dialog.",
      renderMode: "both",
      transcript: [
        { role: "user", content: "User said hi", at: timestamp },
        { role: "tool", content: "Tool responded with data", at: timestamp },
        { role: "assistant", content: "Assistant replied", at: timestamp },
      ],
    },
    constraints: [{ priority: 1, text: "Be concise" }],
    task: [{ priority: 1, instruction: "Act" }],
    input: { userQuery: "Hello" },
  };

  it("canonical text uses T: marker for tool and excludes timestamps", () => {
    const assembled = assemble(spec, { headingLevel: 2, showEmptySections: true });
    const cs = assembled.sections.conversationState;
    expect(cs).toContain("T: Tool responded with data");
    expect(cs).toContain("U: User said hi");
    expect(cs).toContain("A: Assistant replied");
    expect(cs).not.toContain(timestamp);
  });

  it("openai adapter user content includes tool lines but no timestamps", () => {
    const assembled = assemble(spec, {});
    const payload = openaiAdapter(assembled);
    const sys = payload.messages[0].content;
    const user = payload.messages[1].content;
    // System should not include conversation state
    expect(sys).not.toContain("## [Conversation State / History]");
    // User should include the T: line and not include timestamps
    expect(user).toContain("T: Tool responded with data");
    expect(user).not.toContain(timestamp);
  });

  it("google adapter contents include tool lines but no timestamps", () => {
    const assembled = assemble(spec, {});
    const payload = googleAdapter(assembled);
    const text = (payload.contents?.[0]?.parts?.[0] as any)?.text || "";
    expect(text).toContain("T: Tool responded with data");
    expect(text).not.toContain(timestamp);
    const sysText = typeof payload.systemInstruction === "string" ? payload.systemInstruction : payload.systemInstruction.parts[0].text;
    expect(sysText).not.toContain("## [Conversation State / History]");
  });
});
