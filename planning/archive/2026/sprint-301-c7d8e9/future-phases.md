# Future Phases Breakdown: BitBrat CYOA

Building upon the Phase 1 (MVP) implementation, the following phases are suggested to reach full collaborative capability.

## Phase 2: Collaborative Core
- **Goal:** Enable chat-wide voting on story choices.
- **Tasks:**
    - Expand `story-engine-mcp` with `start_poll` and `resolve_poll`.
    - Implement asynchronous "Wait Period" in `llm-bot` for vote collection.
    - Track basic IRC votes (Weight: 1) in `persistence` layer.

## Phase 3: Twitch Deep Integration
- **Goal:** Leverage Twitch-specific features for weighted influence.
- **Tasks:**
    - Connect `ingress-egress` EventSub hooks to `process_vote`.
    - Implement Weighted Voting logic in `state-engine` (Subs, Moderators, Channel Points).
    - Add "God Mode" override (Direct Choice via High-Cost Redeem).

## Phase 4: Mechanics & Multimedia
- **Goal:** Enhance immersion and "gamify" the experience.
- **Tasks:**
    - Implement inventory management tools in `story-engine-mcp`.
    - Integrate `random-mcp` for skill checks and "dice rolls".
    - Integrate `image-gen-mcp` to generate scene illustrations for major plot points.
    - Implement "Chaos Events" (Random interruptions via redeems).

## Phase 5: UI & Accessibility
- **Goal:** Move beyond pure text chat for better UX.
- **Tasks:**
    - Develop a "Story Companion" web-view (read from Firestore).
    - Display live inventory, health bars, and character portraits.
    - Support for Kick.com chat integration.
