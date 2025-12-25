# Key Learnings – sprint-172-e4c1d2

- **Cloud Build Templates**: Creating minimal Cloud Build configs (like `cloudbuild.deploy-only.yaml`) is an effective way to optimize pipelines for different use cases while keeping the orchestration logic simple.
- **CI Environment Consistency**: Setting `CI=1` in validation scripts is important but can reveal assumptions in tests (like remote backend availability) that need to be explicitly handled or mocked.
- **Service Configuration Overlays**: The current pattern of using `architecture.yaml` for structural definition and environment overlays for secrets/values scales well for both source-based and image-based services.
