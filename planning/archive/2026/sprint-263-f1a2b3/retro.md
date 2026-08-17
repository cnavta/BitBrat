# Retro – sprint-263-f1a2b3

## What Worked
- Isolating the failure to the volume via direct 'docker run' comparison.
- Using 'Bad message' error to diagnose filesystem corruption.
- Moving cache out of the volume-shadowed directory.

## What Didn't
- Trying to repair the corrupted volume (too far gone).
- Eventarc emulator requires more complex setup (possibly Cloud Functions).
