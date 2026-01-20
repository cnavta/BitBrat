## What worked
- Diagnostic logging immediately confirmed that `getDriver()` was sensitive to spaces.
- Improving the Firestore and Pub/Sub drivers to support standard emulator environment variables ensures better alignment with the `docker-compose` environment.

## What didn't
- The `pubsub.ensure_topic_failed` error messages were cryptic because they didn't include the endpoint being used. Added that to the logs now.

## Lessons
- Always trim environment variables used for logic switches.
- Explicitly log the endpoint/host being used for cloud services in local/emulator modes.
