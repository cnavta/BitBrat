# Key Learnings – sprint-154-e4f5g6

- **DLQ Standardization**: The `buildDlqEvent` utility provides a consistent payload that simplifies consumption by the persistence service.
- **Firestore Idempotency**: Using `docRef.set(data, { merge: true })` is an effective way to handle partial updates and stubs when events might arrive out of order or multiple times (DLQ retries).
- **Service Decoupling**: Having the persistence service listen to terminal failure topics (DLQs) allows other services to remain stateless regarding terminal error recording.
