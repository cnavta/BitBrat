# Key Learnings – sprint-329-bf2d2b

1. **Mirror the canonical type, don't reinvent it.** When a tool's input must produce an
   `InternalEventV2`, derive the Zod authoring schema field-for-field from `src/types/events.ts` and reuse
   shared enums (`ConnectorType`). This guarantees Law #2 lockstep and avoids invented connectors/topics.

2. **Author vs server field ownership must be explicit.** Widening an authoring surface is safe only with a
   clear whitelist: author-settable (`type, egress, payload, message, annotations, identity, candidates,
   qos, externalEvent, metadata` + ingress connector/channel) vs server-owned (`v, correlationId, traceId,
   ingress.ingressAt+source, routing`). Encode the split in code, not just docs.

3. **Topic = publisher subject.** `createMessagePublisher(subject)`'s argument IS the publish topic, so
   per-schedule topic selection is just "create/cache a publisher per topic" and is directly assertable by
   capturing the mock's argument.

4. **Governance is a code+config pair.** Letting the scheduler emit on a new topic requires BOTH a
   validated input allow-list AND an additive `architecture.yaml` `topics.publishes`/`producers` update,
   re-validated with `brat config validate` — neither alone is sufficient (Law #2).

5. **A "no back-compat" override is a feature, not a shortcut — but must be recorded.** G4 removed an entire
   dual-path branch and its test; capture it as a BREAKING entry in `CHANGELOG.md [Unreleased]` and in the
   request log so the deletion-of-existing-data assumption is traceable.

6. **`brat` runs from `dist/`.** Always `npm run build` before `brat config validate` / `release:dry` in a
   validation script or fresh environment.
