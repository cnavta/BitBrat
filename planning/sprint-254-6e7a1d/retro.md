# Sprint Retro – sprint-254-6e7a1d

## What Worked
- The Graph + Mutation Event model is a very natural fit for the existing BitBrat event-driven architecture.
- Firestore and NATS provide all the necessary primitives (persistence, TTL, pub/sub, versioning) without needing new infrastructure.

## What Didn't
- Initial plan was simple, but realizing the scope of `state-engine` (validation + rules) shows it will be a significant new component.

## Future Pick-ups
- The next step should be defining the exact TypeScript types for Mutations and State to ensure consistency across services.
