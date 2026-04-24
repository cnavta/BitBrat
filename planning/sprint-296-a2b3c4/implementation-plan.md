# Implementation Plan – sprint-296-a2b3c4

## Objective
Resolve the timeout issue in `image-gen-mcp` service by removing large, unused base64 image data from the tool response.

## Scope
- `src/services/image-gen-mcp/index.ts`: Modify the `generate_image` tool to stop returning the base64-encoded image.
- `tests/services/image-gen-mcp/`: (If exists/needed) Update tests to match the new response format.

## Deliverables
- Optimized `image-gen-mcp` service that only returns the GCS URL in the tool response.
- Verification that the tool still works as expected (returns the URL).

## Acceptance Criteria
- `image-gen-mcp` logs "Image persisted to GCS" and returns promptly.
- `llm-bot` receives the tool result (containing the URL) without timing out.
- No regression in image generation or persistence (verified by logs).

## Testing Strategy
- **Manual/Log Analysis:** Verify that the service logs the successful generation and that the returned JSON payload is small.
- **Unit Test:** Add or update a test in `src/services/image-gen-mcp/index.test.ts` to ensure the base64 part is removed and the URL is present.

## Deployment Approach
- Deploy updated `image-gen-mcp` to Cloud Run.

## Dependencies
- None.

## Definition of Done
- Code changes implemented and tested.
- `validate_deliverable.sh` passed (if applicable to this service).
- PR created.