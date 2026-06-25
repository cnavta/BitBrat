# Security Policy

> [!IMPORTANT]
> **Early Development Notice**: BitBrat Platform is currently in **early development**. While we take security seriously, the codebase has not yet undergone a formal security audit. Users should exercise caution and avoid using sensitive production data during this phase.

## Supported Versions

Currently, only the latest version of BitBrat Platform is supported for security updates.
## Reporting a Vulnerability

We take the security of BitBrat Platform seriously. If you believe you have found a security vulnerability, please report it to us as follows:

1. **Do not open a public issue.**
2. Send an email to security@bitbrat.ai with a description of the vulnerability.
3. Include as much information as possible, such as:
    - Steps to reproduce.
    - Potential impact.
    - Any proposed fixes.

We will acknowledge receipt of your report within 48 hours and provide a timeline for addressing the issue. We request that you follow responsible disclosure practices and give us reasonable time to fix the vulnerability before making any information public.

## Dependency Scanning & Remediation Cadence

BitBrat depends on a large npm dependency tree, so supply-chain hygiene is part of our regular workflow:

- **Continuous (every PR/CI):** `npm audit` runs as part of validation (see `validate_deliverable.sh`). New
  **critical** or **high** advisories should block merge until fixed or explicitly accepted.
- **Automated updates:** [Dependabot](https://docs.github.com/en/code-security/dependabot) is the recommended
  mechanism for automated dependency-update PRs (security and version updates). Enable it via
  `.github/dependabot.yml` for the `npm` ecosystem.
- **Weekly triage:** run `npm audit` locally and apply non-breaking fixes with `npm audit fix`. Review the
  output of `npm audit fix --force` carefully — it may introduce breaking changes and must not be applied
  blindly.
- **Remediation priority:** **critical → high → moderate → low.** Critical/high advisories are remediated
  promptly; moderate/low advisories that require breaking upgrades or upstream fixes are tracked and
  deferred with a documented rationale (see the relevant sprint's `verification-report.md`).
- **No secrets in the repo:** never commit real credentials. Local credential stubs (e.g. a fake
  `GOOGLE_APPLICATION_CREDENTIALS` file) are git-ignored (`*-creds.json`) and must stay out of version control.

Because the project is **pre-1.0 / experimental**, some transitive advisories may remain open pending
upstream releases; these are documented rather than force-upgraded when a fix would break the build.
