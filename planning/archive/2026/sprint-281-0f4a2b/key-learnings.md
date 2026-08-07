# Key Learnings – sprint-281-0f4a2b

## Technical Learnings
- **Variable Resolution Logic**: Using a robust library like `lodash/get` for object property resolution is essential for handling complex event shapes without fragile manual logic.
- **Formatter Extensibility**: A registry-based pattern for formatters allows new integration types (Slack, Teams) to be added with zero impact on the core delivery logic.
- **Secret Management**: Resolving secrets only at the service edge (API Gateway) is a critical security pattern for platform-wide egress to avoid leaking sensitive data on the internal bus.

## Protocol & Process Learnings
- **Mid-Sprint Adjustments**: The Sprint Protocol (v2.5) successfully handled scope refinements (candidate selection in formatters) by updating the implementation plan and backlog mid-flight.
- **Validation Scripts**: Having a self-contained `validate_deliverable.sh` that builds and tests the specific components is the single most important factor for confidence before PR creation.

## System Behavior
- **Candidate Selection**: In V2 platform events, the `candidates` array is the authoritative source for responses; falling back to legacy fields should only happen when explicitly specified or when candidates are absent.
