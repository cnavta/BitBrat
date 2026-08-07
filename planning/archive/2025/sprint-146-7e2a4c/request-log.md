# Request Log – sprint-146-7e2a4c

## 2025-12-18T17:40:00Z
- **Prompt**: Investigate and fix Discord responses being sent via Twitch.
- **Interpretation**: The ingress-egress service is misidentifying the source of some Discord-originated events, causing them to fall back to Twitch.
- **Actions**:
    - Identified that `command-processor` was overwriting `evt.source`.
    - Identified that `ingress-egress` routing check could be more robust.
    - Modified `src/apps/command-processor-service.ts` to preserve source.
    - Modified `src/apps/ingress-egress-service.ts` to improve detection logic.
    - Updated `src/apps/__tests__/ingress-egress-routing.test.ts`.
- **Files**:
    - `src/apps/command-processor-service.ts`
    - `src/apps/ingress-egress-service.ts`
    - `src/apps/__tests__/ingress-egress-routing.test.ts`
