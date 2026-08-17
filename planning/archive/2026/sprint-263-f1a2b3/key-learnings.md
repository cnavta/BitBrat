# Key Learnings – sprint-263-f1a2b3

- Named volumes can become corrupted with 'EBADMSG' errors on macOS Docker Desktop.
- Build-time 'pre-downloads' in a Dockerfile must not be placed in directories that will be covered by volumes at runtime.
- Firebase CLI's '--only' flag can be sensitive to emulators that fail to initialize correctly.
