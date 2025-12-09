Retro – sprint-117-47b27d

What worked:
- Established clear backlog and plan for Cloud Trace/Logging integration
- Implemented env-gated OpenTelemetry tracing with Cloud Logging correlation
- Added child spans across services for granular visibility
- Proactively validated and documented deploy-time issues (e.g., billing flag)

What didn’t:
- Initial attempt to enforce instance-based billing used unsupported gcloud flag; corrected quickly
- One infra test outside tracing scope remains flaky due to environment/template expectations

Improvements:
- Include examples of log correlation fields early in docs (done)
- Add a quick-reference for supported gcloud flags in deployment scripts
- Schedule a runtime validation window to complete TRACE-2 after deployment
