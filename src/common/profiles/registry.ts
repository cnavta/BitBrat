import { BitProfile } from './types';

/**
 * Bit model (sprint-324, Phase 2): the composition mechanism (ADR-002).
 *
 * `applyProfiles(Class, [...])` attaches capability profiles to a Bit subclass *as a class-level
 * decoration* (no new inheritance depth). At construction, `Bit` collects the applied profiles
 * (including those declared on ancestor classes), enforces the architecture.yaml `profile:` -> mixin
 * contract, and installs each profile onto the instance.
 */

/** Non-enumerable, class-own storage key for applied profiles. */
const PROFILES_KEY = '__bitProfiles__';

/**
 * The canonical `profile:` (architecture.yaml) -> required capability-mixin map. Declared intent must
 * not diverge from runtime capability: a Bit declaring `profile: llm` MUST have the LlmProfile applied.
 * Profiles that are layered on for convenience (eventing/resources/mcp-client) are not *required* by
 * the map, so they can be added freely without tripping the contract.
 */
export const PROFILE_REQUIREMENTS: Record<string, string[]> = {
  core: [],
  llm: ['llm'],
  'mcp-domain': [],
  gateway: [],
};

/**
 * Attach capability profiles to a Bit subclass. Idempotent per (class, profile.name): re-applying the
 * same-named profile to the same class is ignored. Profiles applied to a base class are inherited by
 * subclasses (see {@link collectProfiles}).
 */
export function applyProfiles(target: Function, profiles: BitProfile[]): void {
  const own: BitProfile[] = Object.prototype.hasOwnProperty.call(target, PROFILES_KEY)
    ? ((target as any)[PROFILES_KEY] as BitProfile[])
    : [];
  const merged = [...own];
  for (const p of profiles) {
    if (!p || typeof p.install !== 'function' || typeof p.name !== 'string') {
      throw new Error(`applyProfiles: invalid profile supplied to ${(target as any)?.name || 'class'}`);
    }
    if (!merged.some((e) => e.name === p.name)) {
      merged.push(p);
    }
  }
  Object.defineProperty(target, PROFILES_KEY, {
    value: merged,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

/**
 * Collect the profiles applied to a class and all of its ancestors, de-duplicated by name (a subclass
 * declaration wins over an ancestor with the same name). Order: most-derived first.
 */
export function collectProfiles(ctor: Function): BitProfile[] {
  const out: BitProfile[] = [];
  let c: any = ctor;
  while (c && c !== Function.prototype && c !== Object.prototype) {
    if (Object.prototype.hasOwnProperty.call(c, PROFILES_KEY)) {
      for (const p of (c[PROFILES_KEY] as BitProfile[])) {
        if (!out.some((e) => e.name === p.name)) out.push(p);
      }
    }
    c = Object.getPrototypeOf(c);
  }
  return out;
}

/**
 * Enforce the declared `profile:` -> mixin contract. Throws (fail fast at Bit bootstrap) when:
 *  - the declared profile value is unknown, or
 *  - a required capability mixin for the declared profile is not applied.
 */
export function enforceProfileContract(declared: string, applied: BitProfile[], serviceName: string): void {
  if (!Object.prototype.hasOwnProperty.call(PROFILE_REQUIREMENTS, declared)) {
    const valid = Object.keys(PROFILE_REQUIREMENTS).join(', ');
    throw new Error(`[${serviceName}] Unknown Bit profile '${declared}'. Valid profiles: ${valid}.`);
  }
  const have = new Set(applied.map((p) => p.name));
  const missing = PROFILE_REQUIREMENTS[declared].filter((req) => !have.has(req));
  if (missing.length > 0) {
    throw new Error(
      `[${serviceName}] Bit declares profile '${declared}' but is missing required capability mixin(s): ` +
      `${missing.join(', ')}. Apply them with applyProfiles(<Class>, [...]).`
    );
  }
}
