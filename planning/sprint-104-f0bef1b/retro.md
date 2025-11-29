# Sprint Retro – sprint-104-f0bef1b

## What worked
- Clear objective and scope enabled quick implementation of the router default-topic change.
- Tests were already well-isolated; adding a new default input topic and env override was straightforward and covered by unit + integration tests.
- Planning artifacts and validation script pattern from prior sprints made this sprint reproducible and traceable.

## What didn’t
- The Auth enrichment runtime was deferred by scope; some ambiguity existed initially around envelope.user vs legacy userId fields, resolved in TA.
- Firestore multi-db configuration required clarifying notes (added to TA under Environment Variables and Deployment).

## Improvements
- For the Auth implementation sprint, add a Firestore Emulator recipe and a minimal seed dataset to accelerate local integration tests.
- Consider centralizing subject constants in a thin SDK package to avoid duplication across services.

## Follow-ups
- Implement Auth service enrichment runtime per approved TA (next sprint candidate).
- Provision Firestore and topics via IaC and add them to validate_deliverable.sh when ready.
