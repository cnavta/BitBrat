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
      "## [Assistant Identity]",
      "## [Requesting User]",
      "## [Conversation State / History]",
      "## [Contexts]",
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
    expect(sections.contexts).toContain("None provided");
    expect(sections.constraints).toContain("None provided");
  });

  describe("Named Contexts (v3)", () => {
    it("renders multiple named contexts with headings and content", () => {
      const spec: PromptSpec = {
        ...baseSpec,
        contexts: [
          { name: "World State", content: "The world is on fire." },
          { name: "Character Lore", content: "Bob is a brave warrior." },
        ],
      };
      const { sections } = assemble(spec, cfg);
      expect(sections.contexts).toContain("## World State");
      expect(sections.contexts).toContain("The world is on fire.");
      expect(sections.contexts).toContain("## Character Lore");
      expect(sections.contexts).toContain("Bob is a brave warrior.");
    });

    it("renders object content as JSON block", () => {
      const spec: PromptSpec = {
        ...baseSpec,
        contexts: [
          { name: "Stats", content: { health: 100, mana: 50 } },
        ],
      };
      const { sections } = assemble(spec, cfg);
      expect(sections.contexts).toContain("## Stats");
      expect(sections.contexts).toContain("~~~text");
      expect(sections.contexts).toContain('"health": 100');
      expect(sections.contexts).toContain('"mana": 50');
      expect(sections.contexts).toContain("~~~");
    });

    it("sorts contexts by priority", () => {
      const spec: PromptSpec = {
        ...baseSpec,
        contexts: [
          { name: "Low", content: "Low priority", priority: 5 },
          { name: "High", content: "High priority", priority: 1 },
        ],
      };
      const { sections } = assemble(spec, cfg);
      const lowIdx = sections.contexts.indexOf("## Low");
      const highIdx = sections.contexts.indexOf("## High");
      expect(highIdx).toBeLessThan(lowIdx);
    });

    it("renders subheaders for contexts if provided", () => {
      const spec: PromptSpec = {
        ...baseSpec,
        contexts: [
          { name: "Info", content: "Some info", subheader: "Detailed information:" },
        ],
      };
      const { sections } = assemble(spec, cfg);
      expect(sections.contexts).toContain("Detailed information:");
      expect(sections.contexts).toContain("## Info");
    });
  });

  it("renders requesting user display fields when provided", () => {
    const spec: PromptSpec = {
      ...baseSpec,
      requestingUser: {
        handle: "@tester",
        displayName: "Test User",
        roles: ["qa"],
      },
    };

    const { sections } = assemble(spec, cfg);
    expect(sections.requestingUser).toContain("- Handle: @tester");
    expect(sections.requestingUser).toContain("- Display Name: Test User");
    expect(sections.requestingUser).toContain("- Roles: [qa]");
  });

  it("should render userId (Fix for BL-306)", () => {
    const spec: PromptSpec = {
      ...baseSpec,
      requestingUser: {
        userId: "user-123",
        handle: "@tester",
      },
    };

    const { sections } = assemble(spec, cfg);
    expect(sections.requestingUser).toContain("- User ID: user-123");
  });

  it("fences multi-line input", () => {
    const spec: PromptSpec = {
      ...baseSpec,
      input: { userQuery: "line1\nline2" },
    };
    const { sections } = assemble(spec, cfg);
    expect(sections.input).toContain("~~~text\nline1\nline2\n~~~");
  });

  describe("Subheader Support (v2.5)", () => {
    it("renders subheaders in Requesting User, Constraints, Task, and Conversation State when provided in spec", () => {
      const spec: PromptSpec = {
        ...baseSpec,
        requestingUser: {
          handle: "@tester",
          subheader: "User details follow:",
        },
        conversationState: {
          summary: "Previous talk",
          subheader: "History context:",
        },
        constraintsSubheader: "Rules of engagement:",
        constraints: [{ priority: 1, text: "Be polite" }],
        taskSubheader: "Current objective:",
      };

      const { sections } = assemble(spec, cfg);

      expect(sections.requestingUser).toContain("## [Requesting User]\nUser details follow:\n\n- Handle: @tester");
      expect(sections.conversationState).toContain("## [Conversation State / History]\nHistory context:\n\n- Previous talk");
      expect(sections.constraints).toContain("## [Constraints]\nRules of engagement:\n\n- (1) Be polite");
      expect(sections.task).toContain("## [Task]\nCurrent objective:\n\n- (1) First\n- (2) Second");
    });

    it("renders default subheaders from AssemblerConfig when spec lacks them", () => {
      const spec: PromptSpec = {
        ...baseSpec,
        requestingUser: { handle: "@tester" },
        conversationState: { summary: "Previous talk" },
      };
      const customCfg: AssemblerConfig = {
        ...cfg,
        defaultSubheaders: {
          requestingUser: "Default User Subheader",
          constraints: "Default Constraints Subheader",
          task: "Default Task Subheader",
          conversationState: "Default History Subheader",
        },
      };

      const { sections } = assemble(spec, customCfg);

      expect(sections.requestingUser).toContain("Default User Subheader");
      expect(sections.constraints).toContain("Default Constraints Subheader");
      expect(sections.task).toContain("Default Task Subheader");
      expect(sections.conversationState).toContain("Default History Subheader");
    });

    it("renders conversationState subheader even if conversationState was undefined in spec but provided in default", () => {
      const customCfg: AssemblerConfig = {
        ...cfg,
        defaultSubheaders: {
          conversationState: "Default History Subheader",
        },
      };

      const { sections } = assemble(baseSpec, customCfg);

      expect(sections.conversationState).toContain("## [Conversation State / History]\nDefault History Subheader\n\n- None provided.");
    });

    it("prioritizes spec subheaders over default subheaders", () => {
      const spec: PromptSpec = {
        ...baseSpec,
        requestingUser: {
          handle: "@tester",
          subheader: "Spec User Subheader",
        },
        constraintsSubheader: "Spec Constraints Subheader",
        taskSubheader: "Spec Task Subheader",
      };
      const customCfg: AssemblerConfig = {
        ...cfg,
        defaultSubheaders: {
          requestingUser: "Default User Subheader",
          constraints: "Default Constraints Subheader",
          task: "Default Task Subheader",
        },
      };

      const { sections } = assemble(spec, customCfg);

      expect(sections.requestingUser).toContain("Spec User Subheader");
      expect(sections.requestingUser).not.toContain("Default User Subheader");
      expect(sections.constraints).toContain("Spec Constraints Subheader");
      expect(sections.constraints).not.toContain("Default Constraints Subheader");
      expect(sections.task).toContain("Spec Task Subheader");
      expect(sections.task).not.toContain("Default Task Subheader");
    });

    it("renders subheaders from environment variables as last resort", () => {
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        PROMPT_SUBHEADER_REQUESTING_USER: "Env User Subheader",
        PROMPT_SUBHEADER_CONSTRAINTS: "Env Constraints Subheader",
        PROMPT_SUBHEADER_TASK: "Env Task Subheader",
      };

      try {
        const spec: PromptSpec = {
          ...baseSpec,
          requestingUser: { handle: "@tester" },
        };
        const { sections } = assemble(spec, cfg);

        expect(sections.requestingUser).toContain("Env User Subheader");
        expect(sections.constraints).toContain("Env Constraints Subheader");
        expect(sections.task).toContain("Env Task Subheader");
      } finally {
        process.env = originalEnv;
      }
    });

    it("does not render subheader if neither spec nor default/env provides it", () => {
      const { sections } = assemble(baseSpec, cfg);
      expect(sections.requestingUser).not.toContain("\n\n-"); // No extra newline + bullet
      expect(sections.constraints).not.toContain("\n\n-");
      expect(sections.task).not.toContain("\n\n-");
    });
  });
});
