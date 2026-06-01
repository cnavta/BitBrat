# Key Learnings – sprint-314-a9b8c7

- **Auto-Discovery Patterns:** Event-driven registration is superior to manual configuration for dynamic cloud environments like Cloud Run.
- **Contract-First Development:** Defining the registration event in `src/types/events.ts` early simplified the implementation of both the producer and consumer.
- **Environment Awareness:** Services should be designed to know their own `EXTERNAL_URL` to facilitate discovery in multi-cloud or hybrid environments.
- **Testing Real-Time Snapshots:** Mocking Firestore's `onSnapshot` is tricky; for discovery, verifying the `set()` call on the document is often a sufficient integration proxy.
