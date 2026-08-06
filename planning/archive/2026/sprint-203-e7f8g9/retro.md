# Retro – sprint-203-e7f8g9

## What Worked
- **Rapid Identification:** The root cause was quickly identified as a regression from Sprint 201's durable subscription changes.
- **Testing Coverage:** Adding a specific test case for the `deliverTo` and `queue` interaction in `nats-driver.test.ts` ensured the fix was verified and won't regress again.
- **Minimal Impact:** The fix was localized to the `nats-driver.ts` and didn't require changes to business logic or other services.

## What Didn't Work
- **Initial Assumption:** The previous sprint assumed that `deliverTo` was only for non-queue subscriptions, which is a common misconception in some JetStream client versions but not the `nats` library used here.

## Process Improvements
- Ensure that any changes to core drivers (NATS, Firestore) include explicit unit tests covering all permutations of options (e.g., with/without queue groups, with/without durables).
