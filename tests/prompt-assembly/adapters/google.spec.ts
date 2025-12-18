import { assemble } from "../../../src/common/prompt-assembly/assemble";
import { googleAdapter } from "../../../src/common/prompt-assembly/adapters/google";
import type { PromptSpec, AssemblerConfig } from "../../../src/common/prompt-assembly/types";

describe("googleAdapter – v2 mapping", () => {
  const cfg: AssemblerConfig = { headingLevel: 2, showEmptySections: true };

  const spec: PromptSpec = {
    systemPrompt: { rules: ["Follow"], summary: "Immutable" },
    identity: { name: "Assistant" },
    requestingUser: { handle: "@user" },
    conversationState: { summary: "Recent context.", renderMode: "summary" },
    constraints: [{ priority: 1, text: "No secrets" }],
    task: [{ priority: 1, instruction: "Act" }],
    input: { userQuery: "Hello" },
  };

  it("maps systemInstruction to System+Identity and contents(user) to RU+CS+Constraints+Task+Input in order", () => {
    const assembled = assemble(spec, cfg);
    const payload = googleAdapter(assembled);

    const systemText = typeof payload.systemInstruction === "string"
      ? payload.systemInstruction
      : payload.systemInstruction.parts[0].text;

    expect(systemText).toContain("## [System Prompt]");
    expect(systemText).toContain("## [Assistant Identity]");
    expect(systemText).not.toContain("## [Requesting User]");
    expect(systemText).not.toContain("## [Conversation State / History]");
    expect(systemText).not.toContain("## [Constraints]");
    expect(systemText).not.toContain("## [Task]");
    expect(systemText).not.toContain("## [Input]");

    expect(payload.contents[0].role).toBe("user");
    const userText = payload.contents[0].parts[0].text;
    const order = [
      "## [Requesting User]",
      "## [Conversation State / History]",
      "## [Constraints]",
      "## [Task]",
      "## [Input]",
    ];
    let last = -1;
    for (const marker of order) {
      const idx = userText.indexOf(marker);
      expect(idx).toBeGreaterThan(-1);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }

    expect(userText).not.toContain("## [System Prompt]");
    expect(userText).not.toContain("## [Assistant Identity]");
  });
});
