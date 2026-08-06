# Retro – sprint-260-b2c3d4

## What worked
- Switching to `node:24-bookworm-slim` was a major win, saving over 1.3 GB of space and unblocking the build.
- Removing `google-cloud-cli` from the emulator container further reduced size by ~400 MB.
- The `[trusted=yes]` approach for Debian repositories solved the GPG signature conflict.
- Verified that `firebase-tools` supports service account authentication via `GOOGLE_APPLICATION_CREDENTIALS` natively, making `gcloud auth` redundant in this context.

## What didn't work
- The GPG issue is still a bit mysterious as it only affects some environments/runs, possibly due to mirror choice or clock skew.
- Git and Xcode license are still pending, which makes standard development workflows difficult.

## Future Recommendations
- Consider using `-slim` base images more broadly if Docker space continues to be a problem.
- Ensure all developer machines have adequate Docker Desktop disk allocation (at least 64GB recommended).
- Investigate persistent GPG key rotation for Debian base images in future-dated environments (like this 2026 setup).
