import request from "supertest";
import { McpServer } from "../../src/common/mcp-server";
import { z } from "zod";

// Mock SSEServerTransport to avoid hanging SSE streams
jest.mock("@modelcontextprotocol/sdk/server/sse.js", () => ({
  SSEServerTransport: jest.fn().mockImplementation((_path, res) => {
    // Immediately end the response to avoid hanging supertest
    res.end();
    return {
      sessionId: "test-session",
      onclose: jest.fn(),
      handlePostMessage: jest.fn().mockResolvedValue(undefined),
    };
  }),
}));

describe("McpServer", () => {
  let server: McpServer;

  beforeEach(() => {
    server = new McpServer({ serviceName: "test-mcp-server" });
    // Mock the SDK Server connect to avoid actual SSE transport logic in some tests
    (server as any).mcpServer.connect = jest.fn().mockResolvedValue(undefined);
    (server as any).mcpServer.setRequestHandler = jest.fn();
  });

  afterEach(async () => {
    await server.close();
  });

  describe("Endpoints Registration", () => {
    it("should register /sse and /message endpoints", async () => {
      const responseSse = await request(server.getApp()).get("/sse");
      expect(responseSse.status).not.toBe(404);

      const responseMessage = await request(server.getApp()).post("/message");
      expect(responseMessage.status).not.toBe(404);
    });
  });

  describe("Security", () => {
    it("should allow access if MCP_AUTH_TOKEN is not set", async () => {
      const response = await request(server.getApp()).get("/sse");
      expect(response.status).not.toBe(401);
    });

    it("should return 401 if MCP_AUTH_TOKEN is set and token is missing", async () => {
      process.env.MCP_AUTH_TOKEN = "secret-token";
      const response = await request(server.getApp()).get("/sse");
      expect(response.status).toBe(401);
      delete process.env.MCP_AUTH_TOKEN;
    });

    it("should return 401 if MCP_AUTH_TOKEN is set and token is incorrect", async () => {
      process.env.MCP_AUTH_TOKEN = "secret-token";
      const response = await request(server.getApp())
        .get("/sse")
        .set("x-mcp-token", "wrong-token");
      expect(response.status).toBe(401);
      delete process.env.MCP_AUTH_TOKEN;
    });

    it("should allow access if correct token is provided in header", async () => {
      process.env.MCP_AUTH_TOKEN = "secret-token";
      const response = await request(server.getApp())
        .get("/sse")
        .set("x-mcp-token", "secret-token");
      expect(response.status).not.toBe(401);
      delete process.env.MCP_AUTH_TOKEN;
    });

    it("should allow access if correct token is provided in query", async () => {
      process.env.MCP_AUTH_TOKEN = "secret-token";
      const response = await request(server.getApp())
        .get("/sse?token=secret-token");
      expect(response.status).not.toBe(401);
      delete process.env.MCP_AUTH_TOKEN;
    });
  });

  describe("Registration Helpers", () => {
    it("should register a tool correctly", async () => {
      const spy = (server as any).mcpServer.setRequestHandler;
      const handler = jest.fn();
      
      server.registerTool("test_tool", "A test tool", z.object({ arg: z.string() }), handler);

      expect(spy).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Function)
      );
    });

    it("should register a resource correctly", async () => {
      const spy = (server as any).mcpServer.setRequestHandler;
      const handler = jest.fn();
      
      server.registerResource("file://test", "test_resource", "A test resource", handler);

      expect(spy).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Function)
      );
    });

    it("should register a prompt correctly", async () => {
      const spy = (server as any).mcpServer.setRequestHandler;
      const handler = jest.fn();
      
      server.registerPrompt("test_prompt", "A test prompt", [{ name: "arg" }], handler);

      expect(spy).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Function)
      );
    });
  });
});
