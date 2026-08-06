# Implementation Plan – sprint-289-7d8f9e

## Objective
The goal of this sprint is to add image generation capabilities to the BitBrat Platform by implementing a dedicated `image-gen-mcp` service. This service will allow the `llm-bot` to generate images on demand using OpenAI DALL-E 3 and persist them in Google Cloud Storage for delivery to Twitch, Discord, and OBS.

## Scope
### In-Scope:
-   Creation of `image-gen-mcp` microservice (Node.js/TypeScript).
-   Implementation of MCP `generate_image` tool.
-   Integration with OpenAI DALL-E 3 for image generation.
-   Integration with OpenAI Moderation API for prompt filtering.
-   Setup of GCS bucket `bitbrat-media-gen` and image persistence logic.
-   Rate limiting and role-based gating for tool usage.
-   Updating `architecture.yaml` and infrastructure configurations.

### Out-of-Scope:
-   Video generation.
-   Multi-provider image generation (limited to OpenAI DALL-E 3 for now).
-   Long-term archival of generated images (assets will expire).

## Deliverables
-   `src/services/image-gen-mcp`: The core service code.
-   `infrastructure/gcs-buckets.yaml`: New bucket configuration.
-   Updated `architecture.yaml` with the new service definition.
-   Updated `tool-gateway` configuration to include the new MCP server.
-   `validate_deliverable.sh`: Sprint validation script.

## Acceptance Criteria
-   `llm-bot` can successfully call the `generate_image` tool via `tool-gateway`.
-   Prompts are moderated before generation.
-   Generated images are uploaded to GCS, and a public URL is returned.
-   Rate limiting is enforced per user.
-   `validate_deliverable.sh` passes successfully.

## Testing Strategy
-   **Unit Tests**: Test MCP tool handlers, moderation logic, and GCS upload utilities using Jest.
-   **Integration Tests**: Mock OpenAI and GCS APIs to verify end-to-end flow from tool call to URL return.
-   **Manual Validation**: Use the `tool-gateway` CLI (if available) to call the tool and verify the image is created and uploaded.

## Deployment Approach
-   Deploy `image-gen-mcp` to Cloud Run.
-   Configure GCS bucket with lifecycle rules via Terraform or GCP console.
-   Update secret manager with `OPENAI_API_KEY` for the new service.

## Dependencies
-   OpenAI API (DALL-E 3, Moderation).
-   GCP (Cloud Run, Cloud Storage).
-   `tool-gateway` (must be able to register the new MCP service).

## Definition of Done
-   Code adheres to project-wide standards.
-   Tests pass with >80% coverage for the new service.
-   `validate_deliverable.sh` script created and passing.
-   Documentation updated.
-   Pull Request created.
