Deliverable Verification - sprint-124-f3a1c8

Completed:
- Enforced environment requirement in brat CLI for env-dependent commands (deploy services, deploy service, deploy <name>, infra plan/apply, lb urlmap render/import, apis enable)
- Updated CLI help text to indicate env is required (or BITBRAT_ENV)
- Added guardrails to exit with code 2 and a clear message when env is missing
- Built project and ran tests — all passing
- Feature branch pushed and PR created (https://github.com/cnavta/BitBrat/pull/26)
- Publication recorded in planning/sprint-124-f3a1c8/publication.yaml and sprint-manifest updated

Partial:
- Unit tests specifically for CLI env enforcement (deferred)

Deferred:
- CLI env enforcement unit tests

Alignment Notes:
- Requirement: either --env flag or BITBRAT_ENV environment variable satisfies the requirement. Implemented accordingly.
- No changes to VPC behavior; issue is mitigated by preventing ambiguous env.
