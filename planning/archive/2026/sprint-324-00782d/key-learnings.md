# Key Learnings – sprint-324-00782d

1. **Fold capabilities into the base behind a gate, default-off.** Construct the capability object
   unconditionally (cheap, no observable side effects) but only *wire* its external surface (HTTP routes,
   event publishes) behind an explicit flag. This makes a base-class capability promotion fully
   behavior-preserving until each consumer opts in.

2. **Renames that must stay backward-compatible: rename the class, keep the old name as a thin subclass.**
   `export class Bit {}` + `export class BaseServer extends Bit {}` preserves `instanceof`, the prototype
   chain, type usage, and `jest.spyOn(BaseServer.prototype, …)`, while letting a one-time deprecation log
   fire. A bare `const` alias would have broken type positions and spies.

3. **Watch test coupling to internal prototype chains.** Several specs spy on `BaseServer.prototype`
   methods that actually live on the (now) base. Keeping the old class in the inheritance chain avoided a
   cascade of test edits. Plan the alias retirement (BL-401) around this.

4. **Mocks that replace a module must mirror that module's *current* exports.** Moving methods into a
   mocked module silently strips them; update the mock to provide the moved surface (don't weaken
   assertions).

5. **Ratify the canonical file first (AGENTS.md Law #2).** Additive Zod/JSON-schema fields + a
   `brat config validate` gate before any code change caught back-compat issues early and made the
   behavioral §6.3 change an explicit, recorded decision rather than an implementation side effect.

6. **Assert cross-target parity cheaply.** Running the same behavioral suite under both
   `MESSAGE_BUS_DRIVER=pubsub` and `=nats` is a low-cost, mock-friendly way to guard GCP/Docker parity
   without standing up live brokers.
