import { Bit } from "../../src/common/base-server";
import {
  applyProfiles,
  collectProfiles,
  enforceProfileContract,
  PROFILE_REQUIREMENTS,
  EventingProfile,
  ResourcesProfile,
  LlmProfile,
  BitProfile,
} from "../../src/common/profiles";

// Mock SSEServerTransport so /sse does not hang the test runner (same pattern as bit-conformance).
jest.mock("@modelcontextprotocol/sdk/server/sse.js", () => ({
  SSEServerTransport: jest.fn().mockImplementation((_path, res) => {
    res.end();
    return {
      sessionId: "profiles-session",
      onclose: jest.fn(),
      handlePostMessage: jest.fn().mockResolvedValue(undefined),
    };
  }),
}));

/**
 * Bit model (sprint-324, Phase 2) — capability composition (ADR-002) unit tests.
 * Covers the applyProfiles mechanism, the profile: -> mixin contract enforcement, and the
 * Eventing / Resources / Llm profiles (including the bit.llm.* admin tools).
 */
describe("Bit composition mechanism", () => {
  const A: BitProfile = { name: "alpha", install: jest.fn() };
  const B: BitProfile = { name: "beta", install: jest.fn() };

  it("applyProfiles attaches profiles and is de-duplicated by name", () => {
    class C1 extends Bit {}
    applyProfiles(C1, [A, B]);
    applyProfiles(C1, [A]); // duplicate by name -> ignored
    expect(collectProfiles(C1).map((p) => p.name)).toEqual(["alpha", "beta"]);
  });

  it("collectProfiles inherits profiles from ancestor classes", () => {
    class Base extends Bit {}
    class Derived extends Base {}
    applyProfiles(Base, [A]);
    applyProfiles(Derived, [B]);
    expect(collectProfiles(Derived).map((p) => p.name).sort()).toEqual(["alpha", "beta"]);
    // The base class keeps only its own profile.
    expect(collectProfiles(Base).map((p) => p.name)).toEqual(["alpha"]);
  });

  it("applyProfiles rejects invalid profiles", () => {
    class C2 extends Bit {}
    expect(() => applyProfiles(C2, [{} as any])).toThrow(/invalid profile/);
  });
});

describe("profile: -> mixin contract", () => {
  it("declares core requires nothing", () => {
    expect(PROFILE_REQUIREMENTS.core).toEqual([]);
    expect(() => enforceProfileContract("core", [], "svc")).not.toThrow();
  });

  it("llm requires the LlmProfile capability", () => {
    expect(() => enforceProfileContract("llm", [], "svc")).toThrow(/missing required capability/);
    expect(() => enforceProfileContract("llm", [LlmProfile], "svc")).not.toThrow();
  });

  it("an unknown profile value fails fast", () => {
    expect(() => enforceProfileContract("bogus", [], "svc")).toThrow(/Unknown Bit profile 'bogus'/);
  });
});

describe("Bit bootstrap enforcement", () => {
  it("fails fast when a Bit declares profile llm without LlmProfile", () => {
    class BadLlmBit extends Bit {
      protected resolveProfile(): string {
        return "llm";
      }
    }
    expect(() => new BadLlmBit({ serviceName: "bad-llm", mcpExposure: "platform-only" })).toThrow(
      /missing required capability/
    );
  });

  it("fails fast on an unknown declared profile", () => {
    class WeirdBit extends Bit {
      protected resolveProfile(): string {
        return "bogus";
      }
    }
    expect(() => new WeirdBit({ serviceName: "weird-bit" })).toThrow(/Unknown Bit profile/);
  });
});

describe("Eventing & Resources marker profiles", () => {
  let bit: any;
  afterEach(async () => {
    if (bit) {
      await bit.close("test-teardown");
      bit = undefined;
    }
  });

  it("expose convenience accessors without changing behavior", () => {
    class MarkerBit extends Bit {}
    applyProfiles(MarkerBit, [EventingProfile, ResourcesProfile]);
    bit = new MarkerBit({ serviceName: "marker-bit", mcpExposure: "platform-only" });
    expect(typeof bit.publishEvent).toBe("function");
    expect(typeof bit.getFirestore).toBe("function");
    expect(typeof bit.getPublisher).toBe("function");
    expect(typeof bit.getStorage).toBe("function");
  });
});

describe("LlmProfile (the LlmBit capability)", () => {
  let bit: any;

  class LlmFixture extends Bit {
    protected resolveProfile(): string {
      return "llm";
    }
  }
  applyProfiles(LlmFixture, [LlmProfile]);

  afterEach(async () => {
    if (bit) {
      await bit.close("test-teardown");
      bit = undefined;
    }
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_MODEL;
  });

  it("registers the bit.llm.* admin tools when MCP is enabled", () => {
    bit = new LlmFixture({ serviceName: "llm-fixture", mcpExposure: "platform-only" });
    const tools = bit.registeredTools as Map<string, any>;
    expect(tools.has("bit.llm.model")).toBe(true);
    expect(tools.has("bit.llm.promptPreview")).toBe(true);
    expect(tools.has("bit.llm.toolFilter")).toBe(true);
    // RBAC scopes: mutating tools elevated, preview read-only.
    expect(tools.get("bit.llm.model").scopes).toEqual(["bit:operate"]);
    expect(tools.get("bit.llm.toolFilter").scopes).toEqual(["bit:operate"]);
    expect(tools.get("bit.llm.promptPreview").scopes).toEqual(["bit:read"]);
  });

  it("does NOT register bit.llm.* tools on an MCP-off Bit, but still attaches the capability", () => {
    bit = new LlmFixture({ serviceName: "llm-fixture-off" });
    const tools = bit.registeredTools as Map<string, any>;
    expect(tools.has("bit.llm.model")).toBe(false);
    expect(typeof bit.llm.getModel).toBe("function");
  });

  it("bit.llm.model reads and sets the active provider+model", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_MODEL = "gpt-4o";
    bit = new LlmFixture({ serviceName: "llm-fixture", mcpExposure: "platform-only" });

    const read = JSON.parse((await bit.executeTool("bit.llm.model", {})).content[0].text);
    expect(read).toEqual({ provider: "openai", model: "gpt-4o" });

    const set = JSON.parse(
      (await bit.executeTool("bit.llm.model", { model: "gpt-4o-mini" })).content[0].text
    );
    expect(set.model).toBe("gpt-4o-mini");
  });

  it("bit.llm.promptPreview renders an assembled prompt with redaction applied", async () => {
    bit = new LlmFixture({ serviceName: "llm-fixture", mcpExposure: "platform-only" });
    const res = await bit.executeTool("bit.llm.promptPreview", { input: "reach me at secret@example.com" });
    const body = JSON.parse(res.content[0].text);
    expect(typeof body.prompt).toBe("string");
    expect(body.prompt).not.toContain("secret@example.com");
    expect(body.prompt).toContain("[REDACTED_EMAIL]");
  });

  it("bit.llm.toolFilter inspects and adjusts the exposed-tool filter", async () => {
    bit = new LlmFixture({ serviceName: "llm-fixture", mcpExposure: "platform-only" });
    const set = JSON.parse(
      (await bit.executeTool("bit.llm.toolFilter", { mode: "allow", list: ["x", "y"] })).content[0].text
    );
    expect(set.filter).toEqual({ mode: "allow", list: ["x", "y"] });
    expect(Array.isArray(set.available)).toBe(true);
  });
});
