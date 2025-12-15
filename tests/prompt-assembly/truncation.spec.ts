import { assemble } from "../../src/common/prompt-assembly/assemble";
import type { PromptSpec, AssemblerConfig } from "../../src/common/prompt-assembly/types";

describe("assemble() – truncation and caps", () => {
  it("trims Input.context before other elements for section cap", () => {
    const spec: PromptSpec = {
      task: [{ priority: 1, instruction: "Do it" }],
      input: { userQuery: "Q", context: "C".repeat(200) },
    };
    const { sections, meta } = assemble(spec, { sectionCaps: { input: 80 } });
    // Input heading + userQuery + fenced/line breaks should fit; context should be truncated or removed
    expect(sections.input.length).toBeLessThanOrEqual(80);
    expect(meta?.truncated).toBe(true);
    expect(meta?.truncationNotes.join("\n")).toMatch(/Input\.context truncated|Removed Input\.context/);
  });

  it("drops lowest-priority tasks to satisfy caps", () => {
    const spec: PromptSpec = {
      task: [
        { id: "a", priority: 1, instruction: "High" },
        { id: "b", priority: 5, instruction: "Low" },
      ],
      input: { userQuery: "Hello" },
    };
    const { sections, meta } = assemble(spec, { sectionCaps: { task: 40 } });
    expect(sections.task).toContain("High");
    // Either trimmed down or the low-priority entry removed
    expect(meta?.truncated).toBe(true);
    expect(meta?.truncationNotes.some((n) => n.includes("Dropped task"))).toBe(true);
  });

  it("applies maxTotalChars and eventually trims Input.userQuery tail as last resort", () => {
    const long = "X".repeat(2000);
    const spec: PromptSpec = {
      systemPrompt: { rules: ["Follow"], summary: "Immutable" },
      identity: { name: "Bot" },
      constraints: [
        { priority: 1, text: "Hard rule" },
        { priority: 5, text: "Soft rule" },
      ],
      task: [
        { priority: 1, instruction: "Act" },
        { priority: 5, instruction: "Optional" },
      ],
      input: { userQuery: long, context: long },
    };
    const { text, meta } = assemble(spec, { maxTotalChars: 500 });
    expect(text.length).toBeLessThanOrEqual(500);
    // Should report truncation and include note about userQuery as last resort
    expect(meta?.truncated).toBe(true);
    const notes = meta?.truncationNotes.join("\n") ?? "";
    expect(notes).toMatch(/Removed Input\.context/);
    expect(notes).toMatch(/Dropped (lowest-priority constraint|task\(id|constraint)/);
    expect(notes).toMatch(/Input\.userQuery truncated/);
  });
});
