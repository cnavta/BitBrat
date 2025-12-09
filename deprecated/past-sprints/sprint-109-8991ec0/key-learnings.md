# Key Learnings - sprint-109-8991ec0

- Reuse Pub/Sub publishers to avoid DNS/channel warm-up per message.
- Add bounded timeouts around network ops to surface faster failures.
- Introduce a narrow shim when migrating event versions, then sweep tests.
- Keep CI in strict no-I/O message bus mode for reliability and speed.
- Migrate fixtures when removing legacy adapters to prevent late failures.