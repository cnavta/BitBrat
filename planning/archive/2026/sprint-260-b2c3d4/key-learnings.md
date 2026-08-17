# Key Learnings – sprint-260-b2c3d4

- The `firebase-tools` CLI natively supports service account authentication via the `GOOGLE_APPLICATION_CREDENTIALS` environment variable, eliminating the need for `gcloud auth activate-service-account` in simple emulator environments.
- In modern Debian Bookworm images, `/etc/apt/sources.list.d/debian.sources` is the default source file using the DEB822 format. Manually adding entries to `/etc/apt/sources.list` will cause conflicts unless `debian.sources` is removed or modified.
- Using `node:24-bookworm-slim` can save nearly 1.5 GB compared to the standard `node:24-bookworm` image, which is critical when building on hosts with tight Docker disk allocation.
- When builds fail with 'At least one invalid signature was encountered' in 2026, it's often more robust to use `[trusted=yes]` for the repository in a development Dockerfile than to try to fix keys or use various `apt` flags.
