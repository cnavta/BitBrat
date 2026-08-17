# Sprint 5 Key Learnings

**Sprint**: sprint-5-anrn33
**Focus**: InfrastructureRegistry with architecture.yaml v2 schema
**Date**: 2026-08-10

## Technical Learnings 🔧

### 1. Jest Mocking Best Practices

**Context**: Needed to mock InfrastructureRegistry in multiple test files

**Challenge**: Circular dependencies when importing types in Jest mocks

**Solution**:
```typescript
jest.mock('../infrastructure/registry', () => {
  // Use type import() syntax to avoid circular dependencies
  type InfrastructureSpec = import('../infrastructure/types').InfrastructureSpec;

  const createMockSpecs = (): InfrastructureSpec[] => [
    // Mock data
  ];

  return {
    InfrastructureRegistry: {
      getAllInfrastructureSpecs: jest.fn(() => createMockSpecs()),
      // ... other methods
    },
  };
});
```

**Key Insight**: TypeScript `import()` type syntax enables safe type imports in Jest mocks without circular dependencies

**Applicability**: Any Jest test that mocks modules with shared types

---

### 2. Test Fixture Factories for Consistency

**Context**: Multiple test files needed similar InfrastructureSpec mock data

**Challenge**: Copy-pasted mock data led to inconsistencies

**Solution**:
```typescript
// Factory pattern for mock specs
const createMockSpecs = (): InfrastructureSpec[] => [
  {
    serviceName: 'nats',
    capability: 'messaging',
    provider: 'docker',
    image: 'nats:2.10-alpine',
    ports: { client: '4222', monitoring: '8222' },
    config: {},
    volumes: [{ name: 'nats-data', mount: '/data' }],
    healthCheck: {
      test: ['CMD', 'nats', 'server', 'check'],
      interval: '5s',
      timeout: '3s',
      retries: 10,
    },
  },
  // ... more specs
];
```

**Key Insight**: Factory functions for test fixtures ensure consistency and reduce duplication

**Applicability**: Any test suite with shared mock data

---

### 3. Architecture.yaml v2 Migration Pattern

**Context**: Migrating from hardcoded infrastructure lists to declarative architecture.yaml

**Old Pattern** (Hardcoded):
```typescript
const infrastructure: string[] = [];
infrastructure.push('nats');
infrastructure.push('redis');
if (metadata.envKeys.includes('PERSISTENCE_DRIVER')) {
  infrastructure.push('postgres');
}
```

**New Pattern** (Declarative):
```yaml
# architecture.yaml
services:
  llm-bot:
    dependencies:
      infrastructure: [messaging, caching, persistence]
```

```typescript
// parse-dependencies.ts
const specs = InfrastructureRegistry.getRequiredInfrastructure(
  repoRoot,
  context,
  activeServices
);
const infrastructure = new Set(specs.map(s => s.serviceName));
```

**Key Insight**: Declarative configuration in YAML makes infrastructure requirements explicit and prevents "magic" hardcoded lists

**Applicability**: Any platform configuration that needs multi-environment support

---

### 4. Caching Strategy for Repeated File Reads

**Context**: InfrastructureRegistry reads architecture.yaml on every method call

**Challenge**: Performance degradation with repeated I/O

**Solution**:
```typescript
const architectureCache = new Map<string, ArchitectureYaml>();

static loadArchitecture(repoRoot: string): ArchitectureYaml {
  // Check cache first
  if (architectureCache.has(repoRoot)) {
    return architectureCache.get(repoRoot)!;
  }

  // Load and cache
  const architecture = yaml.parse(fs.readFileSync(archPath, 'utf-8'));
  architectureCache.set(repoRoot, architecture);
  return architecture;
}

// For testing
static clearCache(): void {
  architectureCache.clear();
}
```

**Key Insight**: Module-level caching for file reads improves performance without sacrificing testability (via clearCache())

**Applicability**: Any service that reads configuration files repeatedly

---

### 5. Health Check Integration Pattern

**Context**: Need to wait for infrastructure to be ready before starting services

**Implementation**:
```typescript
// InfrastructureSpec includes health check config
interface InfrastructureSpec {
  healthCheck?: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
  };
}

// HealthGate waits for all infrastructure
await HealthGate.waitForInfrastructure(infrastructureSpecs, {
  timeout: 60000,
  parallel: true
});
```

**Key Insight**: Declarative health checks in configuration enable uniform wait-for-ready behavior across all infrastructure

**Applicability**: Any deployment system that needs to wait for dependencies

---

## Architectural Learnings 🏗️

### 1. Single Source of Truth Principle

**Before Sprint 5**:
- Infrastructure lists hardcoded in 3+ files
- Different files had different hardcoded lists
- Changes required updating multiple locations

**After Sprint 5**:
- architecture.yaml is the single source of truth
- InfrastructureRegistry provides uniform access
- Changes require updating only architecture.yaml

**Key Insight**: Centralized configuration eliminates inconsistencies and reduces maintenance burden

---

### 2. Provider-Agnostic Abstraction Layer

**Design**:
```
Platform Requirements (generic capabilities)
  ↓
InfrastructureRegistry (resolution layer)
  ↓
Provider Implementations (docker, gcp, aws, azure)
```

**Benefits**:
- Services declare generic capabilities (messaging, caching, persistence)
- InfrastructureRegistry resolves to provider-specific implementations
- Adding new providers doesn't require changing service code

**Key Insight**: Abstraction layers enable platform portability and multi-cloud support

---

### 3. Explicit vs Implicit Dependencies

**Decision**: Require explicit `services.*.dependencies.infrastructure` declarations

**Rationale**:
- Makes infrastructure requirements visible in architecture.yaml
- Eliminates "magic" behavior (e.g., "always includes redis")
- Enables validation of unsatisfied dependencies

**Impact**:
- Breaking change for existing tests
- Clearer architecture
- Better dependency validation

**Key Insight**: Explicit is better than implicit, even if it requires more configuration

---

## Process Learnings 📋

### 1. Phased Implementation Reduces Risk

**Approach**: Break Sprint 5 into I3.1-I3.10 phases

**Benefits**:
- Each phase is independently testable
- Progress is measurable
- Rollback is easier if issues arise

**Evidence**: Completed all 10 phases without rework

**Key Insight**: Incremental migration is safer than big-bang rewrites

---

### 2. Test-First Refactoring

**Approach**: Run tests after each small change

**Evidence**:
- Caught regressions immediately (e.g., missing mock methods)
- Fixed 25 test failures incrementally
- No "surprise" failures at end

**Key Insight**: Tight feedback loop between code changes and test runs prevents regressions

---

### 3. Documentation as Implementation Guide

**Approach**: Write API documentation in infrastructure-management.md before implementation

**Benefits**:
- Documentation forces clarity in API design
- Implementation follows documented interface
- No need to "retrofit" documentation later

**Evidence**: InfrastructureRegistry API matches documented interface exactly

**Key Insight**: Documentation-first design improves API clarity and reduces rework

---

## Migration Learnings 🔄

### 1. Backward Compatibility During Migration

**Challenge**: Existing services expect hardcoded infrastructure lists

**Solution**: Keep old behavior until all services migrated

**Implementation**: InfrastructureRegistry.getRequiredInfrastructure() replaces hardcoded lists one-by-one

**Key Insight**: Gradual migration prevents "big bang" deployment failures

---

### 2. Test Expectations Must Evolve

**Challenge**: Tests expected "always includes redis" behavior

**Solution**: Update test expectations to match new explicit dependency model

**Evidence**:
```typescript
// OLD expectation:
it('always includes redis in infrastructure set', () => {
  expect(infrastructure.has('redis')).toBe(true);
});

// NEW expectation:
it('returns empty set when no services provided', () => {
  expect(infrastructure.size).toBe(0);
});
```

**Key Insight**: Test assumptions may become obsolete during refactoring - update tests to match new behavior

---

## Debugging Learnings 🐛

### 1. Mock Method Discovery

**Challenge**: Test failed with "InfrastructureRegistry.getInfrastructureServices is not a function"

**Process**:
1. Read InfrastructureRegistry implementation
2. Identify all public static methods
3. Add missing methods to mock

**Key Insight**: When mocking, read the real implementation to ensure completeness

---

### 2. Type Mismatches in Mocks

**Challenge**: Mock used `ports: { client: 4222 }` (number) but implementation expects string

**Detection**: TypeScript compilation error

**Fix**: Use correct types in mock: `ports: { client: '4222' }`

**Key Insight**: TypeScript type checking prevents runtime errors even in test mocks

---

## Collaboration Learnings 🤝

### 1. Clear Status Updates

**Practice**: Update todo list after each phase completion

**Evidence**: User always knew current progress without asking

**Key Insight**: Proactive status updates reduce communication overhead

---

### 2. Error Message Contextualization

**Practice**: When reporting test failures, include:
- Failing test name
- Error message
- Relevant file paths

**Evidence**: User could quickly understand failures without needing to run tests locally

**Key Insight**: Rich context in error reports speeds up debugging

---

## Reusable Patterns 🔁

### 1. Registry Pattern for Configuration

**Pattern**:
```typescript
class ConfigRegistry {
  private static cache = new Map();

  static load(path: string) {
    if (cache.has(path)) return cache.get(path);
    const config = loadFromDisk(path);
    cache.set(path, config);
    return config;
  }

  static get(key: string) {
    return cache.get(key);
  }

  static clearCache() {
    cache.clear();
  }
}
```

**Applicability**: Any configuration system that needs caching and centralized access

---

### 2. Factory Pattern for Test Fixtures

**Pattern**:
```typescript
function createMockData(): DataType[] {
  return [
    { /* common structure */ },
    { /* common structure */ },
  ];
}

jest.mock('module', () => ({
  MyClass: {
    getData: jest.fn(() => createMockData()),
  },
}));
```

**Applicability**: Any test suite with shared mock data

---

### 3. Validation with Descriptive Errors

**Pattern**:
```typescript
function validate(config: Config): ValidationResult {
  const errors: string[] = [];

  if (!config.required) {
    errors.push(
      `Missing required field "required":\n` +
      `  File: ${config.path}\n` +
      `  Suggestion: Add 'required: true' to your configuration`
    );
  }

  return { valid: errors.length === 0, errors };
}
```

**Applicability**: Any validation logic that needs user-friendly error messages

---

## Future Improvements 🚀

### 1. Constraint Validation
**Opportunity**: Validate platform constraints (SSL, retention, durability) at deployment time
**Implementation**: Enhance InfrastructureRegistry.validateConstraints()

### 2. Multi-Provider Support
**Opportunity**: Add GCP, AWS, Azure providers
**Implementation**: Implement provider-specific InfrastructureSpec generation

### 3. Infrastructure-Only Deployment
**Opportunity**: Deploy infrastructure without services
**Implementation**: Add `brat deploy infrastructure` command

---

## Summary 📝

Sprint 5 demonstrated the value of:
1. **Declarative configuration** over hardcoded lists
2. **Comprehensive testing** for safe refactoring
3. **Incremental migration** to reduce risk
4. **Documentation-first** API design
5. **Type safety** in TypeScript for catching errors early

These learnings are applicable to any large-scale refactoring or architectural migration.

---

**Generated**: 2026-08-10
**Sprint**: sprint-5-anrn33
**Next Application**: Sprint 6 (Multi-Provider Support)
