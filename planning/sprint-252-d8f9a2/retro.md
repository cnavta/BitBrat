# Retrospective – sprint-252-d8f9a2

## What Worked
- **Centralization**: The LLM provider factory effectively eliminated duplicate instantiation logic.
- **Vercel AI SDK**: Leveraging the standard `baseURL` in the OpenAI provider allowed for seamless vLLM support.
- **Rapid Response**: Build and environment issues (Docker GPG, ENV collisions) were identified and resolved quickly within the sprint.
- **Protocol Adherence**: The structured sprint process made tracking progress and identifying regressions straightforward.

## What Didn't Work
- **Global Environment Namespace**: The flattening of service-specific YAMLs into a single `.env.local` led to unexpected variable collisions.
- **Base Image Aging**: Relying on Debian Bullseye led to a sudden build failure due to expired signatures.
- **Mock Regressions**: Minor test failures occurred because existing mocks weren't updated to match the new `createOpenAI` factory call.

## Process Improvements
- **Namespacing by Default**: Consider namespacing all service-specific configuration in overlays from the start.
- **Base Image Policy**: Keep Docker base images updated to the latest stable Debian release (Bookworm) to avoid EOL/signature issues.
- **Mocking Strategy**: Ensure that shared utilities (like the factory) have very robust mocks that are easy to update globally.
