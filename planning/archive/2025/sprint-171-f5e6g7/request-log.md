# Request Log – sprint-171-f5e6g7

- 2025-12-25T12:35:00Z: Initial investigation of Terraform 400/409 errors.
- Interpretation: Resource address mismatch between code (underscores) and existing state (hyphens).
- Action: Revert underscore normalization in `cdktf-synth.ts`.
- Files modified: `tools/brat/src/providers/cdktf-synth.ts`, related tests.
