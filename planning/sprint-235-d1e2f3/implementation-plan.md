# Implementation Plan - Dynamic Chat Port Discovery (sprint-235-d1e2f3)

## Objective
Improve the robustness of the platform setup and chat experience by resolving port collisions and enabling dynamic port discovery for the `brat chat` command.

## Deliverables
1. **Dynamic Port Discovery**: Update `brat chat` to query Docker for the `api-gateway` port if not explicitly set.
2. **Setup Resilience**: Update `brat setup` to handle port assignments more gracefully, avoiding hardcoded collisions.
3. **Validation Script**: `validate_deliverable.sh` to verify the new behavior.

## Acceptance Criteria
- `brat setup` completes without port collision errors when default ports are occupied.
- `brat chat` successfully connects to the `api-gateway` even if it's running on a non-default port (e.g., 3002).
- Unit tests for port discovery logic.

## Testing Strategy
- Mock Docker CLI responses to test the discovery logic in `brat chat`.
- Manual E2E test: Occupy port 3001, run `brat setup`, then run `brat chat`.
