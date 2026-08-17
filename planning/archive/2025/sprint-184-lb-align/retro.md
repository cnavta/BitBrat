# Retro – sprint-184-lb-align

## What Worked
- Identification of hardcoded strings was straightforward once the `lb urlmap import` command was analyzed.
- Rebuilding the tool confirmed that the changes were effective in the runtime environment.
- Tests provided quick feedback on TypeScript interface changes.

## What Didn't
- Initial confusion about "2 Global External LBs" was due to the split between CDKTF (Forwarding Rule/Proxy) and CLI (URL Map content management). Aligning the names solves the management conflict.

## Key Learnings
- Management of resources outside of Terraform (using `gcloud import` and `ignore_changes` in Terraform) requires strict naming consistency across different parts of the toolchain.
