import { assemble } from "../../src/common/prompt-assembly/assemble";
import { openaiAdapter } from "../../src/common/prompt-assembly/adapters/openai";
import type { PromptSpec, AssemblerConfig } from "../../src/common/prompt-assembly/types";

describe("openaiAdapter – maps canonical sections to system/user", () => {
  it("produces [system, user] messages with expected section headers", () => {
    const spec: PromptSpec = {
      systemPrompt: { summary: "Rules", rules: ["R1"], sources: ["architecture.yaml"] },
      identity: { summary: "Persona summary" },
      requestingUser: { handle: "@tester" },
      constraints: [{ text: "Always be concise", priority: 2 }],
      task: [{ instruction: "Do it", priority: 1 }],
      input: { userQuery: "Hello" },
    };
    const cfg: AssemblerConfig = { headingLevel: 2, showEmptySections: true };
    const assembled = assemble(spec, cfg);
    const payload = openaiAdapter(assembled);
    expect(Array.isArray(payload.messages)).toBe(true);
    expect(payload.messages.length).toBe(2);
    expect(payload.messages[0].role).toBe("system");
    expect(payload.messages[1].role).toBe("user");
    const sys = payload.messages[0].content;
    const usr = payload.messages[1].content;
    expect(sys).toContain("## [System Prompt]");
    expect(sys).toContain("## [Identity]");
    expect(sys).toContain("## [Requesting User]");
    expect(sys).toContain("## [Constraints]");
    expect(usr).toContain("## [Task]");
    expect(usr).toContain("## [Input]");
  });
});
