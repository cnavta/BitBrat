# Retro – sprint-231-f1a2b3

## What Worked
- The interactive setup flow is much smoother than manual configuration.
- Reusing `deploy-local.sh` ensured consistency with the existing local environment setup.
- Firestore emulator data population worked reliably once `FIRESTORE_EMULATOR_HOST` was correctly set.

## What Didn't
- Initial placeholder replacement missed `%botUsername%` which was discovered during rule inspection.
- The `brat` CLI's `parseArgs` default for `projectId` made it tricky to force a prompt when no flag was provided (fixed by checking for explicit flags).

## Improvements for Future Sprints
- Consider adding more validation for the OpenAI API Key (e.g., checking prefix).
- Add more pre-defined rules to the reference directory for broader platform capabilities.
