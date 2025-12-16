import { assemble } from "../../src/common/prompt-assembly/assemble";
import type { PromptSpec, AssemblerConfig } from "../../src/common/prompt-assembly/types";

describe("assemble() – canonical rendering", () => {
  const baseSpec: PromptSpec = {
    task: [
      { id: "t2", priority: 2, instruction: "Second" },
      { id: "t1", priority: 1, instruction: "First" },
    ],
    input: { userQuery: "Hello" },
  };

  const cfg: AssemblerConfig = { headingLevel: 2, showEmptySections: true };

  it("renders sections in canonical order with headings", () => {
    const { text } = assemble(baseSpec, cfg);
    const order = [
      "## [System Prompt]",
      "## [Identity]",
      "## [Requesting User]",
      "## [Conversation State / History]",
      "## [Constraints]",
      "## [Task]",
      "## [Input]",
    ];
    let lastIdx = -1;
    for (const marker of order) {
      const idx = text.indexOf(marker);
      expect(idx).toBeGreaterThan(-1);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  it("sorts tasks by ascending priority", () => {
    const { sections } = assemble(baseSpec, cfg);
    const taskLines = sections.task.split("\n").filter((l) => l.startsWith("- ("));
    expect(taskLines[0]).toContain("(1)");
    expect(taskLines[0]).toContain("First");
    expect(taskLines[1]).toContain("(2)");
    expect(taskLines[1]).toContain("Second");
  });

  it("renders placeholders for empty optional sections when enabled", () => {
    const { sections } = assemble(baseSpec, cfg);
    expect(sections.systemPrompt).toContain("None provided");
    expect(sections.identity).toContain("None provided");
    expect(sections.requestingUser).toContain("None provided");
    expect(sections.conversationState).toContain("None provided");
    expect(sections.constraints).toContain("None provided");
  });

  it("fences multi-line input", () => {
    const spec: PromptSpec = {
      ...baseSpec,
      input: { userQuery: "line1\nline2" },
    };
    const { sections } = assemble(spec, cfg);
    expect(sections.input).toContain("~~~text\nline1\nline2\n~~~");
  });
});
