import { assemble } from "../../src/common/prompt-assembly/assemble";
import { openaiAdapter } from "../../src/common/prompt-assembly/adapters/openai";
import { googleAdapter } from "../../src/common/prompt-assembly/adapters/google";
import type { PromptSpec, AssemblerConfig } from "../../src/common/prompt-assembly/types";

describe("provider adapters", () => {
  const spec: PromptSpec = {
    systemPrompt: { rules: ["Rule A", "Rule B"], summary: "Immutable rules" },
    identity: { name: "Lead Implementor", tone: "professional" },
    requestingUser: { handle: "@tester", roles: ["qa"], locale: "en-US" },
    constraints: [
      { priority: 2, text: "Prefer Markdown" },
      { priority: 1, text: "Follow architecture.yaml" },
    ],
    task: [
      { priority: 2, instruction: "Second" },
      { priority: 1, instruction: "First" },
    ],
    input: { userQuery: "Run" },
  };
  const cfg: AssemblerConfig = {};

  it("maps to OpenAI system+user roles preserving partition", () => {
    const assembled = assemble(spec, cfg);
    const payload = openaiAdapter(assembled);
    expect(Array.isArray(payload.messages)).toBe(true);
    const sys = payload.messages.find((m: any) => m.role === "system");
    const user = payload.messages.find((m: any) => m.role === "user");
    expect(sys).toBeTruthy();
    expect(user).toBeTruthy();
    expect(sys!.content).toContain("[System Prompt]");
    expect(sys!.content).toContain("[Constraints]");
    expect(user!.content).toContain("[Task]");
    expect(user!.content).toContain("[Input]");
  });

  it("maps to Google systemInstruction + contents", () => {
    const assembled = assemble(spec, cfg);
    const payload = googleAdapter(assembled);
    expect(payload.systemInstruction).toContain("[System Prompt]");
    expect(payload.systemInstruction).toContain("[Constraints]");
    expect(Array.isArray(payload.contents)).toBe(true);
    const content = payload.contents[0];
    expect(content.role).toBe("user");
    expect(content.parts[0].text).toContain("[Task]");
    expect(content.parts[0].text).toContain("[Input]");
  });
});
