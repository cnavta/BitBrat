### Architecture Brief: BitBrat On-Demand CYOA (Choose Your Own Adventure) Stories

Assume the role of AI Architect. This brief outlines the design and integration strategy for enabling on-demand, interactive CYOA stories within the BitBrat Platform.

---

### 1. Vision & Core Objectives
The objective is to allow viewers on Twitch/Kick to initiate and participate in dynamic, AI-driven stories. The system must:
- **Be State-Aware:** Maintain progress, inventory, and world-state across sessions.
- **Support Dynamic Branching:** Use LLMs to generate options and narrations based on current state and user intent.
- **Integrate Seamlessly:** Leverage existing BitBrat services (`llm-bot`, `state-engine`, `ingress-egress`).

---

### 2. High-Level System Architecture

The CYOA capability will be implemented as a distributed workflow across the existing microservices, potentially augmented by a specialized `story-engine-mcp` server.

#### A. The Story Engine (Logic Layer)
Instead of a monolithic story service, we utilize the **MCP (Model Context Protocol)** pattern.
- **`story-engine-mcp` (New Service):** A dedicated MCP server that provides tools for:
    - `start_story(theme, setting)`: Initializes a new story session.
    - `get_current_scene()`: Retrieves the current narrative and available choices.
    - `process_action(user_input)`: Validates user input against current options or uses the LLM to interpret "free-form" choices.
    - `update_world_state(mutation)`: Updates Firestore-backed variables (e.g., "health", "has_key").

#### B. The LLM Orchestrator (`llm-bot`)
The `llm-bot` acts as the narrator. 
- It consumes internal events from the `event-router`.
- It uses the `story-engine-mcp` tools to maintain consistency.
- It generates the narrative prose, ensuring the tone matches the chosen genre.

#### C. State Management (`state-engine` & Firestore)
- **`state-engine`** remains the source of truth for user-specific persistent variables.
- Story-specific schemas will be added to Firestore:
    - `stories/{storyId}`: Metadata about the active story.
    - `stories/{storyId}/snapshots`: Historical trail of choices and scenes (for "undo" or recap features).
    - `users/{userId}/active_story`: Pointer to the current active adventure.

---

### 3. Execution Flow (The "Game Loop")

1.  **Trigger:** A user types `!adventure space horror` in chat.
2.  **Ingress:** `ingress-egress` catches the message and publishes it to `internal.ingress.v1`.
3.  **Routing:** `event-router` identifies the command and routes it to `llm-bot` with a "Story Mode" routing slip.
4.  **Inception:** `llm-bot` calls `story-engine-mcp:start_story`. The tool creates a Firestore document and returns the first scene.
5.  **Narration:** `llm-bot` generates a descriptive response and lists 3–4 numbered options.
6.  **Egress:** `ingress-egress` sends the text back to Twitch chat.
7.  **Interaction:** User replies with "2" or "I try to open the airlock".
8.  **Contextual Loop:** `llm-bot` receives the input, calls `story-engine-mcp:process_action`, updates state, and generates the next scene.

---

### 4. Key Architectural Considerations

#### Modular Story Templates
Use a "Prompt-as-a-Service" model where specific genres (Fantasy, Sci-Fi, Noir) are defined as system prompts stored in the `persistence` layer, allowing the platform to expand without code changes.

#### Multi-User Participation (Optional Extension)
The architecture supports "Collective Choice" via the `disposition-service`. Instead of one user deciding, the bot can wait 30 seconds, aggregate chat votes via the `state-engine`, and execute the winning action.

#### Multimedia Integration
Leverage the `image-gen-mcp` to generate a scene illustration for every new "Chapter" or major plot point, posting the URL to chat or a companion web-view.

---

### 5. Implementation Strategy (Phased)

- **Phase 1 (MVP):** Deploy `story-engine-mcp` with basic state tracking and a single "Narrator" prompt for `llm-bot`.
- **Phase 2 (Persistence):** Enable story "save/load" functionality linked to Twitch IDs.
- **Phase 3 (Expansion):** Add inventory systems, dice-roll mechanics (via a `random-mcp` tool), and image generation.

---

### 6. Definition of Done for CYOA Feature
- [ ] `story-engine-mcp` tools are discoverable via `tool-gateway`.
- [ ] Story state persists in Firestore.
- [ ] LLM accurately interprets numbered choices and free-text actions.
- [ ] Narrative history is retrievable for context-aware continuation.