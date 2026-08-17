# Key Learnings – sprint-206-a1b2c3

- **Interpolation Context**: When adding new interpolated variables to `architecture.yaml`, they MUST be added to the `brat` tool's `InterpolationContext` in `loader.ts` to avoid breaking commands that load the configuration.
- **Path Handling**: When generating files based on configuration paths, always check if the path is already absolute or includes expected subdirectories to avoid doubling them up.
- **Strict Validation**: Critical paths like `default_domain` are validated for interpolation completeness in the `brat` tool to prevent broken infrastructure deployments.
