/**
 * Public surface for the `brat release` module (sprint-326). Re-exports the pure compute helpers, the
 * version-file readers/writers/assertion, the CHANGELOG transformer, and the orchestrator so both the
 * CLI and tests can import from a single entrypoint.
 */

export * from './semver';
export * from './version-files';
export * from './changelog';
export * from './release';
