# Key Learnings – sprint-203-e7f8g9

## Technical
- **NATS JetStream Push Consumers:** In the `nats` Node.js library, a push consumer (durable or ephemeral) **always** requires a `deliver_subject` (set via `deliverTo`), even when a `queue_group` is used. The delivery subject acts as the "inbox" that the server uses to push messages to the client.
- **Competing Consumers:** When a `queue_group` is provided alongside a `deliver_subject`, NATS JetStream automatically handles the distribution of messages among all subscribers using that same delivery subject and queue group name.

## Workflow
- **Regression Testing:** Core infrastructure code is sensitive. Any refactoring of the Message Bus driver must be accompanied by comprehensive unit tests that mock the underlying library calls to verify the generated options.
