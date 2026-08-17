# Retro – sprint-183-lb-https

## What worked
- Extending the `brat` tool's synth logic was straightforward due to the modular design.
- Using `passthrough()` in the Zod schema allowed adding new fields to `architecture.yaml` without breaking validation.
- The unit tests confirmed the Terraform generation logic before any deployment.

## What didn't work
- Initial attempt to use `resources.push` in `cdktf-synth.ts` had a syntax error in the template literal, which was quickly corrected.

## Improvements for next time
- Consider adding explicit schema support for `https_redirect` and `cert` in `LoadBalancerSchema` for better IDE discovery and validation messages.
