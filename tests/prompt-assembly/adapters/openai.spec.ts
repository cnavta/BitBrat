import { assemble } from "../../../src/common/prompt-assembly/assemble";
import { openaiAdapter } from "../../../src/common/prompt-assembly/adapters/openai";
import type { PromptSpec, AssemblerConfig } from "../../../src/common/prompt-assembly/types";

describe("openaiAdapter – v2 mapping", () => {
  const cfg: AssemblerConfig = { headingLevel: 2, showEmptySections: true };

  const spec: PromptSpec = {
    systemPrompt: { summary: "Immutable rules", rules: ["Follow architecture.yaml"] },
    identity: { name: "Assistant", summary: "Helpful persona" },
    requestingUser: { handle: "@user", roles: ["tester"], locale: "en-US", timezone: "UTC" },
    conversationState: { summary: "Recent context relevant to current task.", renderMode: "summary" },
    constraints: [
      { priority: 1, text: "Do not leak secrets" },
      { priority: 2, text: "Prefer Markdown" },
    ],
    task: [
      { priority: 1, instruction: "Do the thing" },
    ],
    input: { userQuery: "Hello" },
  };

  it("places System+Identity in system and RU+CS+Constraints+Task+Input in user, preserving order", () => {
    const assembled = assemble(spec, cfg);
    const payload = openaiAdapter(assembled);

    expect(payload.messages[0].role).toBe("system");
    expect(payload.messages[1].role).toBe("user");

    const system = payload.messages[0].content;
    const user = payload.messages[1].content;

    // System should ONLY contain System Prompt and Assistant Identity
    expect(system).toContain("## [System Prompt]");
    expect(system).toContain("## [Assistant Identity]");
    expect(system).not.toContain("## [Requesting User]");
    expect(system).not.toContain("## [Conversation State / History]");
    expect(system).not.toContain("## [Constraints]");
    expect(system).not.toContain("## [Task]");
    expect(system).not.toContain("## [Input]");

    // User should contain the remaining sections in order
    const order = [
      "## [Requesting User]",
      "## [Conversation State / History]",
      "## [Constraints]",
      "## [Task]",
      "## [Input]",
    ];
    let last = -1;
    for (const marker of order) {
      const idx = user.indexOf(marker);
      expect(idx).toBeGreaterThan(-1);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }

    // User should not contain System Prompt or Assistant Identity
    expect(user).not.toContain("## [System Prompt]");
    expect(user).not.toContain("## [Assistant Identity]");
  });
});
