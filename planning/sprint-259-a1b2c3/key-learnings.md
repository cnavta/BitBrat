# Key Learnings – sprint-259-a1b2c3

- When builds fail with 'At least one invalid signature was encountered' in Debian-based Docker images, it is often due to the current date on the host being much later than the key's validity period in the image.
- Bypassing `Valid-Until` checks using `Acquire::Check-Valid-Until=false` is a critical workaround when building in environments with future dates or expired keys.
- Combining `apt` steps into a single layer and using `DEBIAN_FRONTEND=noninteractive` with `--no-install-recommends` improves build speed and reliability in complex Dockerfiles.
- Git and other system tools may be blocked by license agreements (like Xcode) in new or partially-configured macOS environments, which can disrupt standard agent workflows.
