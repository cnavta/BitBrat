import { assemble } from "../../src/common/prompt-assembly/assemble";
import type { PromptSpec, AssemblerConfig } from "../../src/common/prompt-assembly/types";

describe("assemble() – Conversation State / History rendering", () => {
  const cfg: AssemblerConfig = { headingLevel: 2, showEmptySections: true };

  it("renders summary-only as bullets without transcript fence", () => {
    const spec: PromptSpec = {
      conversationState: { summary: "S1\nS2", renderMode: "summary" },
      task: [{ priority: 1, instruction: "Do it" }],
      input: { userQuery: "Hello" },
    };
    const { sections } = assemble(spec, cfg);
    expect(sections.conversationState).toContain("## [Conversation State / History]");
    expect(sections.conversationState).toContain("- S1");
    expect(sections.conversationState).toContain("- S2");
    expect(sections.conversationState).not.toContain("~~~text");
  });

  it("renders transcript-only as fenced with role prefixes", () => {
    const spec: PromptSpec = {
      conversationState: {
        renderMode: "transcript",
        transcript: [
          { role: "user", content: "u1" },
          { role: "assistant", content: "a1" },
          { role: "tool", content: "t1" },
        ],
      },
      task: [{ priority: 1, instruction: "Act" }],
      input: { userQuery: "Hi" },
    };
    const { sections } = assemble(spec, cfg);
    const cs = sections.conversationState;
    expect(cs).toContain("## [Conversation State / History]");
    expect(cs).toContain("~~~text");
    expect(cs).toContain("U: u1");
    expect(cs).toContain("A: a1");
    expect(cs).toContain("T: t1");
  });

  it("renders both: summary bullets first, then fenced transcript", () => {
    const spec: PromptSpec = {
      conversationState: {
        summary: "S1\nS2",
        renderMode: "both",
        transcript: [
          { role: "user", content: "u1" },
          { role: "assistant", content: "a1" },
        ],
      },
      task: [{ priority: 1, instruction: "Go" }],
      input: { userQuery: "Run" },
    };
    const { sections } = assemble(spec, cfg);
    const cs = sections.conversationState;
    const idxSummary = cs.indexOf("- S1");
    const idxFence = cs.indexOf("~~~text");
    expect(idxSummary).toBeGreaterThan(-1);
    expect(idxFence).toBeGreaterThan(idxSummary);
    expect(cs).toContain("U: u1");
    expect(cs).toContain("A: a1");
  });
});
