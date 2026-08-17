# Retro – sprint-290-a1b2c3

## What Worked
- The existing `ProxyInvoker` architecture made it easy to inject overrides into the `wrapCall` method.
- `RegistryWatcher` already spreads all Firestore data into `McpServerConfig`, so adding new fields there automatically enabled them for consumption.
- `validate_deliverable.sh` with scope filtering allowed for fast verification of relevant components.

## What Didn't Work
- Initial test run failed due to incorrect relative path for `ProxyInvoker` import; fixed by adding more `../`.

## Key Learnings
- Decoupling the `ProxyInvoker` settings from its internal state allowed for clean per-call overrides without race conditions on the shared invoker instance.
