# Technical Architecture: Adventure Context Enrichment & Persistence Flow

## 1. Overview
This document outlines the architectural changes to transition the Adventure system from a standalone MCP toolset to an integrated enrichment step within the BitBrat event flow. This shift enables robust state management, deliberate context injection, and addresses critical gaps identified in Phase 1.

## 2. Adventure Context Detection & Routing
Adventure messages will be explicitly detected by the `event-router` and processed through a specialized routing slip.

### 2.1 Detection Rule
A new routing rule will be added to the `event-router` configuration:
- **Rule ID**: `adventure-command-v1`
- **Logic**: Matches if `evt.message.text` starts with `!adventure` or if the user has an active adventure session (tracked via `identity.metadata`).
- **Priority**: High (e.g., 50)

### 2.2 Routing Slip
When matched, the routing slip will be:
1. `internal.story.enrich.v1` (Story Engine Enrichment)
2. `internal.bot.requests.v1` (LLM Bot Processing)

## 3. Story Enrichment Phase (`internal.story.enrich.v1`)
The `story-engine-mcp` will be expanded to consume the `internal.story.enrich.v1` topic.

### 3.1 Enrichment Logic
Upon receiving an event on this topic, the `StoryEngineMcpServer` will:
1. Extract `userId` from the event identity.
2. Retrieve the active `storyId` from the `users` collection.
3. Fetch the `worldState` and recent `history` from the `stories` collection.
4. **Context Injection**: Add a new annotation of kind `instruction` to the event:
   - **Label**: `adventure_context`
   - **Value**: A condensed summary of the current scene, world state, and pending user action.
5. **Slip Advancement**: Call `this.next(event, 'OK')` to move the event to the next stage (`llm-bot`).

## 4. Addressing Phase 1 Gaps

### 4.1 Persistence Feedback Loop (`commit_scene`)
A new MCP tool will be added to allow the LLM to persist its narrations:
- **Tool Name**: `commit_scene`
- **Arguments**: `userId`, `scene` (text), `choices` (string array), `worldStateMutation` (optional object).
- **Behavior**: Appends a `narrative_scene` entry to the story history and updates the `worldState`.

### 4.2 Stability of `get_current_scene`
The `get_current_scene` tool will be updated to:
1. Filter the story history for the most recent entry of type `narrative_scene`.
2. Ignore `user_action` entries when calculating the "current scene" to display to the user.

### 4.3 Session Resumption
By making Story Enrichment a required step in the routing slip, the `llm-bot` no longer needs to maintain long-term in-process memory. Every adventure-related message will arrive at the bot already enriched with the latest story state, enabling seamless resumption across bot restarts.

### 4.4 `start_story` Optimization
`start_story` will be updated to automatically trigger the first scene narration by:
1. Initializing the story record.
2. Returning a response that instructs the `llm-bot` to "Begin the narration for [theme]".

## 5. Auditability & Snapshots
The `story-engine-mcp` will leverage the existing `PersistenceSnapshot` pattern. Every time a scene is committed or an action is recorded, a snapshot of the full story state will be published to `internal.persistence.snapshot.v1` for historical auditability and potential rollback.

## 6. Implementation Checklist
- [ ] Add `INTERNAL_STORY_ENRICH_V1` constant to `src/types/events.ts`.
- [ ] Implement Pub/Sub consumer for `internal.story.enrich.v1` in `StoryEngineMcpServer`.
- [ ] Update `StoryEngineMcpServer` with `commit_scene` tool.
- [ ] Fix `get_current_scene` logic in `StoryEngineMcpServer`.
- [ ] Add `adventure-command-v1` rule to Firestore `configs/routingRules/rules`.
