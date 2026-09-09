import request from "supertest";
import { Bit } from "../../src/common/base-server";

// Sprint 28: MCP SDK 2.0 - No need to mock SSEServerTransport (stateless per-request architecture)
// The v2.0 server doesn't use persistent SSE sessions, so these mocks are obsolete

/**
 * Bit model (sprint-324) — Platform Ring conformance suite.
 *
 * `HelloBit` is the canonical "Hello World" Bit: it composes no extra capability profile, yet by
 * virtue of being a Bit it gets the entire Platform Ring (the mandatory bit.* control plane) for
 * free. This suite asserts the universal contract every Bit must satisfy.
 */
class HelloBit extends Bit {}

const PLATFORM_TOOLS = [
  "bit.info",
  "bit.health",
  "bit.readiness",
  "bit.config.get",
  "bit.config.describe",
  "bit.flags.get",
  "bit.flags.set",
  "bit.log.level",
  "bit.drain",
  "bit.shutdown",
  "bit.restart",
];

describe("Bit Platform Ring conformance", () => {
  let bit: any;

  afterEach(async () => {
    if (bit) {
      await bit.close("test-teardown");
      bit = undefined;
    }
  });

  it("every MCP-enabled Bit exposes the full mandatory bit.* control plane", () => {
    bit = new HelloBit({ serviceName: "hello-bit", mcpExposure: "platform-only" });
    const tools = (bit as any).registeredTools as Map<string, any>;
    for (const t of PLATFORM_TOOLS) {
      expect(tools.has(t)).toBe(true);
    }
  });

  it("wires the MCP transport (POST /mcp) when enabled", async () => {
    bit = new HelloBit({ serviceName: "hello-bit", mcpExposure: "platform-only" });
    const mcp = await request(bit.getApp()).post("/mcp");
    expect(mcp.status).not.toBe(404);
  });

  it("bit.info reports identity and effective exposure", async () => {
    bit = new HelloBit({ serviceName: "hello-bit", mcpExposure: "platform-only" });
    const res = await bit.executeTool("bit.info", {});
    const info = JSON.parse(res.content[0].text);
    expect(info.name).toBe("hello-bit");
    expect(info.exposure).toBe("platform-only");
    expect(info.profile).toBeDefined();
  });

  it("bit.health returns a structured ok status", async () => {
    bit = new HelloBit({ serviceName: "hello-bit", mcpExposure: "platform-only" });
    const res = await bit.executeTool("bit.health", {});
    const body = JSON.parse(res.content[0].text);
    expect(body.status).toBe("ok");
    expect(body.service).toBe("hello-bit");
  });

  it("bit.config.* never leaks a raw secret", async () => {
    process.env.MCP_AUTH_TOKEN = "super-secret-token-value";
    bit = new HelloBit({ serviceName: "hello-bit", mcpExposure: "platform-only" });
    const res = await bit.executeTool("bit.config.get", {});
    expect(res.content[0].text).not.toContain("super-secret-token-value");
    delete process.env.MCP_AUTH_TOKEN;
  });

  it("applies RBAC scopes: elevated for operator tools, low for read-only", () => {
    bit = new HelloBit({ serviceName: "hello-bit", mcpExposure: "platform-only" });
    const tools = (bit as any).registeredTools as Map<string, any>;
    expect(tools.get("bit.shutdown").scopes).toEqual(["bit:operate"]);
    expect(tools.get("bit.drain").scopes).toEqual(["bit:operate"]);
    expect(tools.get("bit.restart").scopes).toEqual(["bit:operate"]);
    expect(tools.get("bit.flags.set").scopes).toEqual(["bit:operate"]);
    expect(tools.get("bit.log.level").scopes).toEqual(["bit:operate"]);
    expect(tools.get("bit.info").scopes).toEqual(["bit:read"]);
    expect(tools.get("bit.health").scopes).toEqual(["bit:read"]);
    expect(tools.get("bit.config.get").scopes).toEqual(["bit:read"]);
  });

  it("a platform-only Bit registers no domain tools (default-deny exposure)", () => {
    bit = new HelloBit({ serviceName: "hello-bit", mcpExposure: "platform-only" });
    const tools = (bit as any).registeredTools as Map<string, string[]>;
    for (const name of tools.keys()) {
      expect(name.startsWith("bit.")).toBe(true);
    }
  });

  it("an unlisted Bit with no exposure stays MCP-off (legacy behavior preserved)", async () => {
    bit = new HelloBit({ serviceName: "unlisted-fixture-bit-xyz" });
    const tools = (bit as any).registeredTools as Map<string, any>;
    expect(tools.size).toBe(0);
    const mcp = await request(bit.getApp()).post("/mcp");
    expect(mcp.status).toBe(404);
  });
});
