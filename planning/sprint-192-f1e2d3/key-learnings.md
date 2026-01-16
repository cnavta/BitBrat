# Key Learnings – sprint-192-f1e2d3

- **ESLint 9 Migration**: Flat config (`eslint.config.js/mjs`) is mandatory and significantly different from `.eslintrc`.
- **TypeScript-ESLint v8**: Use the `typescript-eslint` package to simplify flat config setup.
- **CI Readiness**: Always include linting in the local validation script (`validate_deliverable.sh`) to catch configuration issues before pushing to CI.
