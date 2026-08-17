# Sprint 8 Architecture.yaml Refactoring - Migration Guide

**Sprint**: 8
**Date**: August 11, 2026
**Impact**: Documentation references, architecture.yaml structure

## Overview

Sprint 8 refactored `architecture.yaml` to reduce verbosity and improve maintainability by extracting detailed documentation to dedicated files and applying the `{config, constraints, intent}` pattern from Sprint 4 to all major sections.

**Key Changes**:
- Reduced architecture.yaml from **1444 lines to 1093 lines** (24% reduction)
- Created **4 new comprehensive documentation files** (3,675 lines total)
- Applied **{config, constraints, intent}** pattern to refactored sections
- Removed **6 deprecated/redundant sections** (232 lines)

## What Changed

### Removed Sections

The following sections were **removed** from `architecture.yaml`:

| Section | Lines Removed | New Location |
|---------|---------------|--------------|
| `dataflow` | 41 | Migrated to `platform.orchestration` |
| `references` | 11 | Migrated to `llm_guidance.references` |
| `extension_points` | 53 | `documentation/guides/extending-bitbrat.md` |
| `cloudResources` | 104 | Deprecated (GCP-specific, replaced by provider-agnostic infrastructure) |
| `deploymentDefaults` | 12 | Deprecated (unused) |
| `networking` | 11 | Deprecated (GCP-specific) |
| **TOTAL** | **232** | |

### Refactored Sections

The following sections were **refactored** with the `{config, constraints, intent}` pattern:

| Section | Before | After | Change | Pattern Applied |
|---------|--------|-------|--------|-----------------|
| `messaging` | 202 lines | 101 lines | -50% | ✅ {config, constraints, intent} |
| `conventions` | 106 lines | 30 lines | -72% | ✅ {config, constraints, intent} |
| `llm_guidance` | 65 lines | 65 lines | Enhanced | ✅ {intent, references} |
| `platform.orchestration` | N/A | 38 lines | **NEW** | ✅ {config, stages, constraints, intent} |

### New Documentation Files

Four comprehensive documentation files were created:

| File | Lines | Description |
|------|-------|-------------|
| `documentation/reference/topic-catalog.md` | 745 | Complete message bus topic reference (extracted from `messaging` section) |
| `documentation/reference/secrets-catalog.md` | 713 | Platform secrets reference (extracted from `conventions.secrets.catalog`) |
| `documentation/reference/environment-variables.md` | 924 | Environment variable resolution and configuration |
| `documentation/guides/extending-bitbrat.md` | 1,293 | Comprehensive platform extension guide (replaces `extension_points`) |
| **TOTAL** | **3,675** | |

## Migration Actions

### For Developers

#### 1. Update Code References to `cloudResources`

**Breaking Change**: Tests or code that referenced `cloudResources.resources.main-load-balancer` will fail.

**Before (Sprint 7 and earlier)**:
```typescript
const arch = Bit.loadArchitectureYaml();
const domain = arch?.cloudResources?.resources?.['main-load-balancer']?.routing?.default_domain;
```

**After (Sprint 8+)**:
```typescript
const arch = Bit.loadArchitectureYaml();
const orchestration = arch?.platform?.orchestration;
// Or use provider-specific configuration:
// const gcpLb = arch?.infrastructure?.gcp?.loadBalancer;
```

**Action**: Search your codebase for `cloudResources` and update to use `platform.orchestration` or provider-specific infrastructure configuration.

#### 2. Update Documentation References

**Breaking Change**: Links to removed sections in architecture.yaml will be broken.

**Old References → New Locations**:

| Old Reference | New Reference |
|---------------|---------------|
| `architecture.yaml#extension_points` | `documentation/guides/extending-bitbrat.md` |
| `architecture.yaml#dataflow` | `architecture.yaml#platform.orchestration` |
| `architecture.yaml#references` | `architecture.yaml#llm_guidance.references` |
| `architecture.yaml#conventions.secrets` | `documentation/reference/secrets-catalog.md` |
| `architecture.yaml#messaging.topics` | `documentation/reference/topic-catalog.md` |
| `architecture.yaml#conventions.env_vars` | `documentation/reference/environment-variables.md` |

**Action**: Search your documentation for links to removed sections and update to new locations.

#### 3. Update Test Expectations

**Breaking Change**: Tests that validate architecture.yaml structure may fail.

**Examples of Required Test Updates**:

```typescript
// BEFORE: Checking removed cloudResources section
it('should find the load balancer default domain', () => {
  const arch = Bit.loadArchitectureYaml();
  const domain = arch?.cloudResources?.resources?.['main-load-balancer']?.routing?.default_domain;
  expect(domain).toBeDefined();
});

// AFTER: Check new platform.orchestration section
it('should find platform orchestration configuration', () => {
  const arch = Bit.loadArchitectureYaml();
  const orchestration = arch?.platform?.orchestration;
  expect(orchestration).toBeDefined();
  expect(orchestration?.config?.model).toBe('event-driven');
  expect(orchestration?.stages?.length).toBeGreaterThan(0);
});
```

**Action**: Run your test suite and update any tests that reference removed sections.

### For Documentation Authors

#### 1. Use New Documentation Files

When documenting features, reference the new comprehensive guides:

**Secrets**: Link to `documentation/reference/secrets-catalog.md`
**Environment Variables**: Link to `documentation/reference/environment-variables.md`
**Message Bus Topics**: Link to `documentation/reference/topic-catalog.md`
**Extending BitBrat**: Link to `documentation/guides/extending-bitbrat.md`

#### 2. Follow {config, constraints, intent} Pattern

When adding new sections to architecture.yaml, follow the established pattern:

```yaml
newSection:
  intent: >
    Clear statement of purpose and principles.
  config:
    key1: value1
    key2: value2
  constraints:
    - constraint1
    - constraint2
  references:
    guide: documentation/guides/new-section-guide.md
```

#### 3. Extract Verbose Content

If a section in architecture.yaml exceeds ~50 lines, consider:
1. Creating a dedicated documentation file
2. Reducing the architecture.yaml section to config + constraints + intent
3. Adding a reference to the comprehensive guide

### For Tool Developers

#### 1. Update Load Balancer Configuration

**Breaking Change**: Load balancer configuration is now **provider-specific**.

**Before (Sprint 7 and earlier)**:
```yaml
cloudResources:
  resources:
    main-load-balancer:
      type: load-balancer
      routing:
        default_domain: bitbrat.ai
```

**After (Sprint 8+)**:
```yaml
infrastructure:
  gcp:
    loadBalancer:
      name: bitbrat-lb
      defaultBackend: tool-gateway
      routing:
        # Provider-specific configuration
```

**Action**: Update tools that parse load balancer configuration to use provider-specific paths.

#### 2. Topic Catalog Access

**Enhancement**: Topic catalog is now in a dedicated markdown file with structured tables.

**Before**: Parse YAML from `architecture.yaml#messaging.topics`
**After**: Parse markdown tables from `documentation/reference/topic-catalog.md`

**Action**: Update tools that generate topic documentation or visualizations.

## Validation

### Automated Validation

Run these commands to validate your migration:

```bash
# 1. Validate architecture.yaml schema
npm run brat -- config validate

# 2. Run test suite
npm test

# 3. Check for broken documentation links (if you have a link checker)
# Example: markdown-link-check documentation/**/*.md

# 4. Verify services metadata is accessible
npm run brat -- config show
```

### Manual Validation Checklist

- [ ] All tests pass (`npm test`)
- [ ] Architecture.yaml validates (`npm run brat -- config validate`)
- [ ] No references to removed sections in your code
- [ ] No broken links in your documentation
- [ ] All sprint artifacts updated (if applicable)

## Rollback Procedure

If you encounter critical issues after migrating:

### Option 1: Revert to Sprint 7 Architecture

```bash
# Switch to main branch or Sprint 7 tag
git checkout <sprint-7-commit-hash>

# Or use architecture.yaml from Sprint 7
git show <sprint-7-commit-hash>:architecture.yaml > architecture.yaml
```

### Option 2: Reference Old Structure

If you need to reference the old structure for comparison:

```bash
# View removed sections from git history
git show <sprint-7-commit-hash>:architecture.yaml | grep -A 50 "cloudResources:"
git show <sprint-7-commit-hash>:architecture.yaml | grep -A 30 "extension_points:"
```

## Benefits

### For Developers

- **Faster navigation**: Less scrolling through architecture.yaml
- **Better search**: Dedicated files for topics, secrets, environment variables
- **Clear patterns**: Consistent {config, constraints, intent} structure
- **Better diffs**: Changes to different concerns (config vs documentation) now in separate files

### For LLM Evaluators

- **Information density**: Critical info in first 100 words of each documentation file
- **Scannable structure**: Tables and lists instead of prose
- **Precise cross-references**: Exact file paths and section names
- **Platform-agnostic language**: Clear baseline (Docker + PostgreSQL) with cloud as examples

### For Documentation

- **Single responsibility**: Each file has one purpose
- **Comprehensive coverage**: 3,675 lines of detailed documentation
- **Easier maintenance**: Update documentation without touching architecture.yaml
- **Better discoverability**: Search engines and LLMs can find specific documentation files

## Timeline

- **Sprint 8 Start**: August 11, 2026
- **Migration Guide Created**: August 11, 2026
- **Deprecation Period**: N/A (Sprint 8 is breaking change)
- **Removal Complete**: Sprint 8 (sections already removed)

## Support

If you encounter issues during migration:

1. **Check this guide** for common migration patterns
2. **Review Sprint 8 artifacts** in `planning/sprint-8-uhh8fj/`
3. **Search git history** for old architecture.yaml structure: `git log --all --full-history -- architecture.yaml`
4. **File an issue** if you discover missing migration steps

## See Also

- [Extending BitBrat Guide](./extending-bitbrat.md) - Replaces `extension_points` section
- [Topic Catalog](../reference/topic-catalog.md) - Complete message bus topic reference
- [Secrets Catalog](../reference/secrets-catalog.md) - Platform secrets reference
- [Environment Variables Reference](../reference/environment-variables.md) - Environment variable resolution
- [Sprint 8 Implementation Plan](../../planning/sprint-8-uhh8fj/implementation-plan.md) - Detailed refactoring plan
- [Sprint 8 Verification Report](../../planning/sprint-8-uhh8fj/verification-report.md) - Validation results
