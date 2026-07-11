/**
 * `brat release` CLI group (sprint-326, BL-326-300; sprint-337 GitHub Release) — a thin shell over
 * the release module (tools/brat/src/release). Orchestrates: compute next SemVer -> write
 * architecture.yaml (only project.version) + package.json -> sync package-lock.json -> assert 3-file
 * consistency -> roll the CHANGELOG `[Unreleased]` block -> (optional) local git tag -> (optional)
 * GitHub Release via gh CLI.
 *
 * architecture.yaml `project.version` is the single source of truth (AGENTS.md §0; runtime source via
 * base-server). The bump type is always an explicit argument (never guessed). Idempotent + `--dry-run`
 * (CI-safe inside validate_deliverable.sh).
 *
 * Usage:
 *   brat release <patch|minor|major|x.y.z> [--dry-run] [--tag] [--github-release] [--yes]
 */

import { createLogger, Logger } from '../orchestration/logger';
import { ConfigurationError } from '../orchestration/errors';
import { runRelease } from '../release';

/** Flags threaded from the flat router (only the subset this command consumes). */
export interface ReleaseCliFlags {
  dryRun?: boolean;
  json?: boolean;
}

/** Parse the residual `--flag` / `--k=v` tokens (already normalised to `--k=v` by parseArgs). */
function parseFlagMap(rest: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rest) {
    if (!r.startsWith('-')) continue;
    const [k, v] = r.split('=');
    const key = k.replace(/^--?/, '');
    out[key] = v !== undefined ? v : 'true';
  }
  return out;
}

const HELP = `brat release — cut a platform version (single source of truth: architecture.yaml project.version)

Usage:
  brat release <patch|minor|major|x.y.z> [--dry-run] [--tag] [--github-release] [--yes]

Arguments:
  patch|minor|major   Bump the current version (pre-1.0 SemVer; major is an explicit 0.x -> 1.0.0).
  x.y.z               Set an explicit version verbatim.

Flags:
  --dry-run          Compute and report the planned changes; write NOTHING (CI-safe).
  --tag              Also create a local 'git tag v<version>' (never pushes). Off by default.
  --github-release   Create a GitHub Release via gh CLI (requires --tag). Off by default.
                     Release notes are auto-extracted from CHANGELOG.md.
                     Requires: GitHub CLI (gh) installed and authenticated.
  --yes              Skip the interactive confirmation prompt (non-interactive / CI use).

Effects (non-dry-run):
  - architecture.yaml project.version  (ONLY that field; re-validated — Law #2)
  - package.json "version"
  - package-lock.json "version"        (npm install --package-lock-only)
  - CHANGELOG.md: roll '## [Unreleased]' -> '## [<version>] - <date>' + fresh empty Unreleased
  - (optional) Local git tag v<version> (with --tag)
  - (optional) GitHub Release (with --github-release --tag)
`;

/**
 * Entrypoint for `brat release`. `cmd` is the full command path (cmd[0]==='release', cmd[1]===bump);
 * `rest` carries the residual flags; `flags` carries the global flags (incl. dryRun, json).
 */
export async function cmdRelease(cmd: string[], rest: string[], flags: ReleaseCliFlags, logger?: Logger): Promise<void> {
  const log = logger || createLogger({ base: { component: 'brat', group: 'release' } });
  const m = parseFlagMap(rest);

  if (rest.includes('--help') || rest.includes('-h') || m['help'] === 'true') {
    console.log(HELP);
    return;
  }

  const bump = cmd[1];
  if (!bump) {
    console.error('Usage: brat release <patch|minor|major|x.y.z> [--dry-run] [--tag] [--github-release] [--yes]');
    throw new ConfigurationError('Missing bump argument. Provide one of: patch | minor | major | <explicit x.y.z>.');
  }

  const dryRun = !!flags.dryRun || m['dry-run'] === 'true';
  const tag = m['tag'] === 'true';
  const githubRelease = m['github-release'] === 'true';

  const result = await runRelease({
    rootDir: process.cwd(),
    bump,
    dryRun,
    tag,
    githubRelease,
    logger: log,
  });

  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const arrow = `${result.previousVersion} -> ${result.nextVersion}`;
  if (dryRun) {
    console.log(`[DRY-RUN] release ${arrow}`);
    console.log('  • architecture.yaml project.version (would update)');
    console.log('  • package.json + package-lock.json version (would update)');
    console.log(`  • CHANGELOG.md [Unreleased] -> [${result.nextVersion}] (${result.changelogRolled ? 'would roll' : 'already rolled — no-op'})`);
    if (tag) console.log(`  • git tag v${result.nextVersion} (would create, not push)`);
    if (githubRelease) console.log(`  • GitHub Release v${result.nextVersion} (would create)`);
    console.log('  Wrote nothing.');
    return;
  }
  console.log(`Released ${arrow}`);
  console.log(`  • architecture.yaml / package.json / package-lock.json -> ${result.nextVersion}`);
  console.log(`  • CHANGELOG.md ${result.changelogRolled ? `rolled -> [${result.nextVersion}]` : 'already rolled (no-op)'}`);
  if (result.tagged) console.log(`  • git tag v${result.nextVersion} created (not pushed)`);
  if (result.githubReleaseCreated) console.log(`  • GitHub Release v${result.nextVersion} created`);
}
