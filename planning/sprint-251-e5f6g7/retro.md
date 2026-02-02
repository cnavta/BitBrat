status: complete
retrospective: |
  The failure was likely due to duplicate headers being sent in the MCP routes, which caused Parse Errors in the HTTP client (supertest/node). Adding res.headersSent checks ensures only one response is sent per request.