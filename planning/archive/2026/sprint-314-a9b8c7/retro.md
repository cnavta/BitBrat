# Sprint Retro – sprint-314-a9b8c7

## What Worked
- **Decoupled Discovery:** Using Pub/Sub registration events allows services to be truly "plug-and-play" without manual Firestore entry.
- **Leveraging Existing RegistryWatcher:** Reusing the Firestore-to-connection pipeline minimized changes in `tool-gateway`.
- **Bearer Token Support:** Adding standard Authorization header support makes the platform more interoperable.

## What Didn't
- **Node/npm Environment:** Initial environment discovery took a few steps due to non-standard PATH in the execution context.
- **Open Handles in Jest:** `BaseServer` currently doesn't store the HTTP server instance, making it hard to close completely in tests without leaks.

## Improvements
- Consider refactoring `BaseServer` to manage the HTTP server instance for cleaner shutdowns.
- Standardize all service authentication to use Bearer tokens across the platform.
