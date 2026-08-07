# Key Learnings – sprint-322-ca67dd

For future sprints touching the canonical `architecture.yaml`:

1. **Treat the file as free-form-but-consumed.** There is no JSON-Schema/validator in the repo, but the
   build tooling derives `--build-args` from it (see `defaults.services.build`). Prefer **additive** blocks
   and never rename/remove fields consumed by deployment/build without explicit approval.

2. **Keep the topic catalog authoritative.** `messaging.topics` must remain a superset of every
   `publishes`/`consumes` entry. Per-instance topics use a `.{instanceId}` suffix that resolves to the base
   topic at runtime (`K_REVISION || EGRESS_INSTANCE_ID || SERVICE_INSTANCE_ID || HOSTNAME || generated`);
   document the base topic, not the variant.

3. **`active:` defaults to disabled.** A service runs only if it explicitly sets `active: true`
   (`defaults.services.active: false`). When adding a service, set the flag explicitly.

4. **Internal LB routing is host-based, not path-based.** Every `internal-load-balancer` rule uses
   `path_prefix: /` on purpose; the backend is selected by internal hostname under `routing.default_domain`.
   Do not "fix" the prefixes.

5. **Promote durable decisions into structured fields.** Sprint-tagged free-form comments become
   machine-readable blocks (`networking:`, `defaults.services.build`, `llm_guidance.invariants`). Keep the
   durable decision text; drop the transient changelog noise (retain origin via a short `origin:` note).

6. **Validation must be portable.** Local envs may lack `node` and `python3`'s `yaml`; ruby is reliably
   present. Keep inline interpreter scripts ASCII-only to avoid `-e` encoding errors.

7. **Ground every claim.** Cite real docs/schemas (`platform-flow.md`, `messaging-system.md`,
   `envelope.v1.json`, `routing-slip.v1.json`, `firestore.rules/indexes`). Where the file has no explicit
   publisher, attribute producers from documented routing behavior rather than guessing.
