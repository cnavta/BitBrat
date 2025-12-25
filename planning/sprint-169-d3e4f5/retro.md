# Retro – sprint-169-d3e4f5

## What worked
- Quick reproduction of failures by merging the relevant feature branch.
- Full test run helped confirm that the fix didn't break other areas.

## What didn't work
- Initial confusion about the state of `main` branch vs the user's reported errors. It's important to remember that PRs from previous sprints might not be merged yet.

## Key Learnings
- Always use a consistent naming convention for Terraform resource IDs and their references. Replacing hyphens with underscores is a safe bet for Terraform compatibility.