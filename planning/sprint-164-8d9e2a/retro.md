# Retro – sprint-164-8d9e2a

## What Worked
- Rapid identification of the deployment error root cause (resource rename + `ignore_changes` + GCP dependencies).
- Restoring backward compatibility while keeping the new features (Internal LB).
- Adding a specific test case for resource sharing.

## What Didn't
- The initial refactoring in Sprint 163 was too aggressive with renaming, assuming that unique names are always better without considering existing state and Terraform's behavior with `ignore_changes`.

## Learnings
- Resource renames in Terraform are "destructive" (replace). When modifying shared infrastructure tools, always check if resource identities (both in TF and GCP) are preserved for existing deployments.
- Using `ignore_changes` on routing rules makes it impossible for Terraform to handle backend renames automatically.
