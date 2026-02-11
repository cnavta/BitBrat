# Key Learnings – sprint-252-d8f9a2

## Technical
- **vLLM Compatibility**: vLLM is perfectly compatible with the `@ai-sdk/openai` provider when the `baseURL` is pointed to the vLLM server's `/v1` endpoint.
- **Debian Release Management**: Debian Bookworm is now the preferred base for Node containers in this project to ensure package repository stability.
- **Environment Mapping**: Mapping namespaced host variables (e.g., `LLM_BOT_LLM_PROVIDER`) to standard internal variables (e.g., `LLM_PROVIDER`) in Docker Compose is an effective pattern for maintaining code simplicity while allowing environment isolation.

## Architectural
- **Centralized Factories**: Moving logic out of service-specific code and into `src/common` significantly reduces maintenance overhead for core capabilities like LLM interactions.
- **Fail-Safe Config**: Making optional parameters (like `baseURL`) truly optional in the configuration system prevents unnecessary service crashes.

## Operations
- **Local Deployment Health**: Running `npm run local` is a critical validation step, as unit tests cannot catch issues with Docker Compose mappings or environment file merging.
