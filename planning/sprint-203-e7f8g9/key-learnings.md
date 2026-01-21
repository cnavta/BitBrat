# Key Learnings – sprint-203-e7f8g9

## NATS JetStream Push Consumers
- Push consumers *always* require a `deliver_subject`. In `nats.js`, this is set via `deliverTo()`.
- Even if a `queue_group` (set via `queue()`) is used to enable competing consumers, the `deliver_subject` must still be provided.
- For shared durable push consumers in a queue group, all members should technically share the same `deliver_subject`. In our current implementation using `createInbox()`, each instance might be creating a unique deliver subject. However, `js.subscribe` often handles updating the consumer's `deliver_subject`.

## Testing Message Bus
- Mocks for `consumerOpts` should verify that mandatory fields like `deliver_subject` are set, even if they seem optional in some contexts.
