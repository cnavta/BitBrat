# Technical Architecture - Initial Platform Setup

This document outlines the architecture for the guided platform setup feature in the `brat` tool.

## 1. Overview
The goal is to provide a user-friendly, interactive CLI experience to initialize the BitBrat platform, specifically targeting a local development environment using Docker Compose and Firestore emulators.

## 2. Design Goals
- **Idempotency**: Setup can be run multiple times.
- **Safety**: Check for existing data and prompt for confirmation before destructive actions.
- **Guided Experience**: Use menus and clear prompts to gather configuration from the user.
- **Minimal Viable Platform**: Populate Firestore with enough data to enable a basic chat loop.

## 3. Core Components

### 3.1 CLI Interface (`brat setup`)
- Enhanced version of the existing `cmdSetup`.
- Uses an interactive menu loop (via `readline` or a dedicated library if added).
- Steps:
    1. **Pre-flight Checks**: Verify Docker Compose is running and Firestore emulator is accessible.
    2. **Environment Selection**: Default to `local`.
    3. **Existing Data Check**: Query Firestore collections (`personalities`, `mcp_servers`, `configs`). If data exists, offer to:
        - **Abort**: Exit without changes.
        - **Wipe & Re-init**: Delete existing collections and start fresh.
        - **Append/Merge**: Add missing data without deleting (Advanced, maybe out of scope for now).
    4. **Information Gathering**:
        - Bot Name.
        - Default Personality details (Instructions, Description).
        - Optional additional personalities (name, instructions).
    5. **Configuration Population**:
        - Write local config files (`global.yaml`, `.secure.local`).
        - Initialize Firestore collections.

### 3.2 Firestore Data Model

#### Collection: `personalities`
```json
{
  "name": "BotName",
  "description": "...",
  "instructions": "...",
  "status": "active",
  "createdAt": "ISO-TIMESTAMP"
}
```

#### Collection: `mcp_servers`
- **obs-mcp**: 
    - `transport`: `sse`
    - `url`: `http://obs-mcp:3000/sse` (Internal Docker network)
- **image-gen-mcp**:
    - `transport`: `stdio`
    - `command`: `node`
    - `args`: ["dist/services/image-gen-mcp/index.js"]
- **story-engine-mcp**:
    - `transport`: `stdio`
    - `command`: `node`
    - `args`: ["dist/apps/story-engine-mcp.js"]

#### Collection: `configs/routingRules/rules`
1. **Rule: `initial-analysis`**
    - `logic`: `{ "==": [ { "var": "routing.stage" }, "initial" ] }`
    - `routingSlip`:
        - `auth` -> `internal.auth.v1`
        - `query-analysis` -> `internal.query.analysis.v1`
        - `event-router` -> `internal.enriched.v1`
2. **Rule: `analysis-reaction-bot`**
    - `logic`: 
        ```json
        {
          "and": [
            { "==": [ { "var": "routing.stage" }, "analysis" ] },
            { "contains": [ { "var": "message.text" }, "%BOT_NAME%" ] }
          ]
        }
        ```
    - `routingSlip`:
        - `llm-bot` -> `internal.llmbot.v1`
3. **Rule: `analysis-reaction-adventure`**
    - `logic`:
        ```json
        {
          "and": [
            { "==": [ { "var": "routing.stage" }, "analysis" ] },
            { "startsWith": [ { "var": "message.text" }, "!adventure" ] }
          ]
        }
        ```
    - `routingSlip`:
        - `story-engine` -> `internal.story.enrich.v1`
        - `llm-bot` -> `internal.llmbot.v1`

## 4. Implementation Strategy
1. **Validation Script**: Create `validate_deliverable.sh` that checks if `brat setup` can be invoked.
2. **Interaction Loop**: Implement a helper for menus (e.g., `askMenu(title, options)`).
3. **Firestore Helper**: Add a utility to wipe collections safely in emulator mode.
4. **Templates**: Store default config templates either in code or as JSON files.

## 5. Security Considerations
- Ensure setup only runs against `localhost:8080` (emulator) by default unless explicitly overridden.
- Warn users before wiping any data.
- API keys (OpenAI) should be stored in `.secure.local` and not committed to git.
