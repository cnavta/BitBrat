# Key Learnings – sprint-155-a8c2d4

- **Interface Consistency**: When refactoring shared types used by multiple services (like `EnvelopeV1`), ensure all implementing interfaces (like `EnvelopeBuilder`) are updated simultaneously to prevent breakage in consumer services.
- **Persistence Schema vs Event Schema**: Property names that make sense in a transient event (like `egress` for routing intent) might collide with persistence-layer metadata (like `egress` for delivery record). Using distinct names like `delivery` for records avoids shadowing issues when the persistence model extends the event model.
