# Retro - sprint-150-f1e2d3

## What worked
- Quick reproduction of the error using a mocked Firestore that simulates strict undefined checking.
- Global fix in `firebase.ts` ensures this class of error is prevented across the entire platform.
- Defensive filtering in the repository adds an extra layer of safety.

## What didn't
- Discrepancy between initial context and branch state for `user-repo.ts` caused brief confusion, but was resolved by following the actual file content on the branch.
