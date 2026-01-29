# Technical Architecture: Brat Chat CLI

## 1. Overview
The `brat chat` tool is an interactive command-line interface designed to allow direct communication with the BitBrat Platform. It leverages the `api-gateway` service to send and receive chat messages, enabling real-time interaction for testing, debugging, and administrative purposes.

## 2. Architecture Goals
- Provide a simple, interactive terminal interface for chatting with the platform.
- Use the existing `api-gateway` WebSocket protocol for communication.
- Support environment-aware connection settings (local, dev, prod).
- Ensure secure communication via API tokens.
- Maintain consistency with the existing `brat` orchestration tool.

## 3. System Components

### 3.1. Brat CLI Extension
The `brat` CLI (located in `tools/brat/src/cli/index.ts`) will be extended with a new `chat` command. This command will act as the entry point for the interactive session.

### 3.2. Chat Controller (`tools/brat/src/cli/chat.ts`)
A new module will be created to manage the interactive session:
- **Connection Manager**: Handles WebSocket lifecycle (connect, authenticate, heartbeat, reconnect).
- **Protocol Handler**: Maps CLI inputs to `api-gateway` WebSocket frames and vice versa.
- **Terminal UI**: Manages user input (via `readline`) and formatted output in the terminal.

### 3.3. API Gateway Service
The `api-gateway` service (in `src/apps/api-gateway.ts`) will be the primary backend for the CLI tool. It will handle the WebSocket connection, validate the API token, and route messages to/from the platform's internal message bus.

## 4. Interaction Design

### 4.1. WebSocket Protocol
- **Endpoint**: `ws://<host>:<port>/ws/v1` (or `wss://` for remote)
- **Authentication**: Bearer token in the `Authorization` header during the WebSocket upgrade request.
- **Inbound Frames (Client -> Gateway)**:
  ```json
  {
    "type": "chat.message.send",
    "payload": {
      "text": "Hello platform!"
    },
    "metadata": {
      "id": "<uuid>"
    }
  }
  ```
- **Outbound Frames (Gateway -> Client)**:
  ```json
  {
    "type": "chat.message.received",
    "payload": {
      "text": "Hello user!",
      "source": "llm-bot"
    },
    "metadata": {
      "id": "<uuid>",
      "timestamp": "2026-01-29T12:00:00Z"
    }
  }
  ```

### 4.2. CLI Interactive Mode
Upon running `npm run brat -- chat`, the tool will:
1. Load environment configuration (defaults to `local` if not specified).
2. Look for an API token in `BITBRAT_API_TOKEN` environment variable or a local `.bitbrat.json` file.
3. Establish a WebSocket connection.
4. Display a "Connected" message and a prompt (e.g., `brat> `).
5. Enter a REPL loop:
   - Accept user input.
   - Send input to the platform.
   - Asynchronously print incoming messages from the platform.
   - Handle special commands (e.g., `/exit`, `/help`).

## 5. Deployment & Configuration

### 5.1. Load Balancer Integration
To enable remote access to the `api-gateway`, the `architecture.yaml` will be updated to include routing rules for the service:
```yaml
    main-load-balancer:
      # ...
      routing:
        rules:
          # ...
          - path_prefix: /ws/v1
            service: api-gateway
```

### 5.2. Environment Discovery
The tool will resolve the gateway URL based on the `--env` flag:
- `local`: `ws://localhost:3001/ws/v1`
- `non-local`: `wss://api.<env>.bitbrat.ai/ws/v1`
  - If `<env>` is `prod`, the URL is `wss://api.bitbrat.ai/ws/v1`.

## 6. Implementation Plan Highlights
1.  **Expose API Gateway**: Update `architecture.yaml` and re-deploy load balancer configuration.
2.  **CLI Command**: Add `brat chat` to `tools/brat/src/cli/index.ts`.
3.  **Chat Logic**: Implement `tools/brat/src/cli/chat.ts` using the `ws` library.
4.  **Security**: Ensure `auth` service can generate and validate tokens for the CLI tool.
5.  **Validation**: Create a mock gateway to test the CLI tool's behavior in various network conditions.
