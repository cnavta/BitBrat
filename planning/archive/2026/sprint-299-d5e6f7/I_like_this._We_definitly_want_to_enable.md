### Updated Architecture Brief: BitBrat Collaborative CYOA Stories

Assume the role of AI Architect. This expanded brief details the design for enabling on-demand, interactive, and **collaborative** Choose Your Own Adventure (CYOA) stories, specifically integrating Twitch Channel Point redeems and collective voting.

---

### 1. Vision & Core Objectives
The system allows streamers and their communities to co-create dynamic narratives.
- **Collaborative Decision Making:** Move from single-player to "Chat-driven" adventures.
- **Twitch Integration:** Use Channel Point redeems to influence the story (weighted voting or direct overrides).
- **State-Awareness:** Persistent world-state and historical choice tracking.

---

### 2. Expanded System Architecture

#### A. The Story Engine (`story-engine-mcp`)
The MCP server is expanded to manage the lifecycle of collective choices:
- `start_story(theme, setting)`: Initializes the session.
- `start_poll(choices, duration_ms)`: Opens a voting window in the `persistence` layer.
- `process_vote(userId, choiceId, weight)`: Records a vote with an associated weight (e.g., chat = 1, points = 50).
- `resolve_poll()`: Aggregates weights and returns the winning action.

#### B. The Ingress-Egress Layer
- **`ingress-egress`** listens for Twitch `EventSub` notifications, specifically `channel.channel_points_custom_reward_redemption.add`.
- These events are normalized and sent to the `event-router`.

#### C. The Orchestrator (`llm-bot`)
- The bot manages the "Wait Period" for voting.
- It announces the start of a vote and the final result before narrating the next scene.

---

### 3. Execution Flow (The "Collaborative Loop")

1.  **Trigger:** User types `!adventure` or redeems a "Start Adventure" reward.
2.  **Narration & Choices:** `llm-bot` generates the scene and 3 numbered choices.
3.  **Poll Opening:** `llm-bot` calls `story-engine-mcp:start_poll`. The bot posts: *"VOTING OPEN: Type 1, 2, or 3 in chat, or use Point Redeems to boost a choice! (60s remaining)"*.
4.  **Collection Phase:**
    - **Chat Votes:** Users type "1" in chat. `ingress-egress` captures IRC and routes as a standard vote (Weight: 1).
    - **Point Redeems:** A user redeems "Adventure Boost". The payload includes the user's text (e.g., "2"). `ingress-egress` routes this as a weighted vote (Weight: 50).
5.  **Resolution:** After 60s, `llm-bot` calls `story-engine-mcp:resolve_poll`.
6.  **Next Scene:** `llm-bot` receives the winning choice and generates the narrative consequence.

---

### 4. Key Architectural Considerations

#### Weighted Voting & Influence
The `state-engine` stores the configuration for "Vote Weights". This allows the streamer to tune the economy:
- **Standard Chat:** 1 Vote.
- **Subscribers:** 2 Votes (via user metadata).
- **Point Redeems:** High-impact influence (e.g., 100 Votes).
- **"God Mode" Redeem:** A high-cost redeem that instantly resolves the poll for a specific choice, bypassing the timer.

#### Handling Reward Redemptions
To keep the logic clean, the platform uses **Dynamic Reward Mapping**:
- Any reward with a specific tag or prefix (e.g., `[CYOA]`) is automatically interpreted by the `event-router` as an adventure input.
- The `user_input` field in the redemption is used to identify the choice ID.

---

### 5. Implementation Strategy (Phased)

- **Phase 1 (MVP):** Single-user command-driven logic (as previously defined).
- **Phase 2 (Collaborative Core):** Implement the `start_poll` logic and chat-based (IRC) voting.
- **Phase 3 (Twitch Integration):** Connect `ingress-egress` EventSub hooks for Channel Points to the `process_vote` tool.
- **Phase 4 (Advanced Mechanics):** Add "Chaos Events" where a Point Redeem can force a random event (using `random-mcp`) regardless of the current poll.

---

### 6. Updated Definition of Done
- [ ] `story-engine-mcp` supports `start_poll` and `resolve_poll` tools.
- [ ] `event-router` correctly maps Channel Point redeems to `process_vote` events.
- [ ] `llm-bot` successfully handles the asynchronous wait period for votes.
- [ ] Voting results are persisted in `stories/{storyId}/snapshots` for auditability.
- [ ] Weights for different user types (Subscriber, Moderator) are configurable in `state-engine`.