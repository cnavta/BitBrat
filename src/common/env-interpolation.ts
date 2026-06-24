/**
 * Shared environment-variable interpolation utility.
 *
 * Reuses the platform's established `${VAR}` / `${VAR:-default}` syntax (previously duplicated in
 * `src/services/twitch-oauth.ts`, the OAuth provider adapters, and `tools/brat/src/config/loader.ts`).
 *
 * Semantics (matching the existing `interpolateEnv` helpers):
 *  - `${VAR}`            -> the value of `env.VAR`, or empty string if unset/empty (recorded as unresolved).
 *  - `${VAR:-default}`   -> the value of `env.VAR`, or `default` if unset/empty (NOT recorded as unresolved).
 *  - Literal strings with no `${...}` tokens are returned unchanged (identity transform).
 *
 * SECURITY: this module NEVER logs resolved values. Callers receive only the set of referenced variable
 * names (`refsUsed`) and the set of unresolved names (`unresolved`) so they can log safely (names only).
 */

// Mirrors the established regex used by interpolateEnv (twitch-oauth.ts): case-insensitive ${VAR} / ${VAR:-default}.
const ENV_REF_REGEX = /\$\{([A-Z0-9_]+)(?::-(.*?))?\}/gi;

export type EnvSource = Record<string, string | undefined>;

export interface InterpolationResult<T> {
  /** The interpolated value (same shape as the input). */
  value: T;
  /** Names of every `${VAR}` reference encountered in the input. */
  refsUsed: string[];
  /** Names of references that had no env value and no default (substituted with empty string). */
  unresolved: string[];
}

/**
 * Returns true if the given string contains at least one `${...}` reference.
 */
export function hasEnvRef(input: unknown): boolean {
  if (typeof input !== 'string') return false;
  ENV_REF_REGEX.lastIndex = 0;
  return ENV_REF_REGEX.test(input);
}

/**
 * Interpolate a single string, tracking referenced and unresolved names into the provided sets.
 */
function interpolateInto(
  input: string,
  env: EnvSource,
  refsUsed: Set<string>,
  unresolved: Set<string>
): string {
  if (!input) return input;
  return input.replace(ENV_REF_REGEX, (_m, varName: string, defVal?: string) => {
    const name = String(varName);
    refsUsed.add(name);
    const v = env[name];
    if (v == null || v === '') {
      if (defVal !== undefined) return defVal;
      unresolved.add(name);
      return '';
    }
    return String(v);
  });
}

/**
 * Interpolate a single string against the given env (defaults to process.env).
 */
export function interpolateEnvString(
  input: string,
  env: EnvSource = process.env
): InterpolationResult<string> {
  const refsUsed = new Set<string>();
  const unresolved = new Set<string>();
  const value = interpolateInto(input, env, refsUsed, unresolved);
  return { value, refsUsed: [...refsUsed], unresolved: [...unresolved] };
}

/**
 * Interpolate every element of a string array against the given env (defaults to process.env).
 */
export function interpolateEnvArray(
  input: string[],
  env: EnvSource = process.env
): InterpolationResult<string[]> {
  const refsUsed = new Set<string>();
  const unresolved = new Set<string>();
  const value = input.map((el) =>
    typeof el === 'string' ? interpolateInto(el, env, refsUsed, unresolved) : el
  );
  return { value, refsUsed: [...refsUsed], unresolved: [...unresolved] };
}

/**
 * Interpolate every value of a string record against the given env (defaults to process.env).
 * Keys are left unchanged; only values are interpolated.
 */
export function interpolateEnvRecord(
  input: Record<string, string>,
  env: EnvSource = process.env
): InterpolationResult<Record<string, string>> {
  const refsUsed = new Set<string>();
  const unresolved = new Set<string>();
  const value: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    value[k] = typeof v === 'string' ? interpolateInto(v, env, refsUsed, unresolved) : v;
  }
  return { value, refsUsed: [...refsUsed], unresolved: [...unresolved] };
}
