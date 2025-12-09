Sprint Retrospective — sprint-107-8ae3c1

What went well
- Introduced clear InternalEventV2 schema and routing model.
- Backward compatibility maintained with InternalEventV1.
- Egress selection logic implemented with deterministic tie-breakers.

What could be improved
- Better local automation to create PRs directly from CI/CD.
- Earlier validation of environment constraints for running full test/validation scripts.

Actions
- Add a GitHub Action to auto-open PRs from feature branches.
- Provide a lightweight local test harness for selection logic independent of full repo validation.
