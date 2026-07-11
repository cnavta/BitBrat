# Sprint 337 - LLM-Enhanced Automated GitHub Releases

## Executive Summary

This sprint replaces the flawed `--github-release` flag approach with an intelligent, LLM-enhanced GitHub Actions workflow that automatically creates professional releases when PRs are merged to `main`.

## Key Enhancement: LLM Integration

Based on user feedback, we've integrated **GPT-4o-mini** to dramatically improve release note quality:

### What the LLM Does

1. **Highlights Generation** (always)
   - Creates engaging 2-3 sentence summary of the release
   - Helps users quickly understand what's new

2. **Intelligent Categorization** (always)
   - Automatically sorts changes into:
     - ✨ Features
     - 🐛 Fixes
     - ⚠️ Breaking Changes

3. **Smart Fallback** (when CHANGELOG missing)
   - Parses git commit history
   - Generates complete release notes from scratch
   - Understands conventional commit format

4. **Professional Polish**
   - Consistent, readable markdown formatting
   - GitHub-optimized presentation
   - Context-aware descriptions

### Example Output

```markdown
## Highlights
This release introduces centralized observability with Loki integration and significantly
improves fleet administration capabilities through enhanced MCP tooling. Performance
optimizations reduce log query times by 90% for distributed traces.

## What's New

### Features
- Add Loki + Promtail centralized logging stack
- Implement fleet.trace with single-query performance optimization
- Add automatic fallback to Docker logs when Loki unavailable

### Fixes
- Fix Loki schema config date for staging environment
- Resolve WAL directory permissions issues
- Correct network name references in docker-compose

### Breaking Changes
None
```

## Technical Approach

### Architecture
```
PR Merged → main
    ↓
Detect version change (architecture.yaml)
    ↓
Parse git log since last version
    ↓
┌─────────────────────────────────┐
│  LLM Enhancement (GPT-4o-mini)  │
│  ├─ Extract CHANGELOG content   │
│  ├─ Analyze git commits         │
│  ├─ Generate Highlights         │
│  ├─ Categorize changes          │
│  └─ Format as markdown          │
└─────────────────────────────────┘
    ↓
Create git tag v${VERSION}
    ↓
Create GitHub Release with LLM notes
    ↓
Done ✓
```

### Cost Efficiency

- **Model**: GPT-4o-mini (~$0.15 per 1M input tokens)
- **Typical cost per release**: < $0.01
- **Speed**: ~2-3 seconds per release
- **Fallback**: Gracefully degrades if API unavailable

## Implementation Breakdown

### 20 Tasks Across 6 Phases (~6 hours)

**Phase 1: Core Infrastructure** (90min)
- Version detection script
- Basic CHANGELOG extraction
- GitHub Actions workflow scaffold

**Phase 2: LLM Integration** (135min) ⭐ NEW
- OpenAI API integration (GPT-4o-mini)
- Git log parser with conventional commit support
- Release notes generator with categorization
- Workflow integration with fallback strategy

**Phase 3: Release Creation** (45min)
- Error handling and edge cases
- Security and permissions
- Duplicate release prevention

**Phase 4: Documentation** (60min)
- Update CLAUDE.md (remove `--github-release`)
- Update README.md (add LLM features)
- Create automated-releases.md guide

**Phase 5: Testing** (95min)
- Unit tests for all scripts
- LLM integration tests with mocked API
- Workflow validation

**Phase 6: Cleanup** (15min)
- Remove `--github-release` remnants

## Key Deliverables

### New Scripts
- `scripts/detect-version-change.sh` - Version bump detection
- `scripts/extract-changelog.sh` - Basic CHANGELOG parsing
- `scripts/llm-release-notes.js` - LLM-powered release notes generator ⭐
- `scripts/parse-git-log.js` - Intelligent commit parsing ⭐

### GitHub Actions
- `.github/workflows/auto-release.yml` - Automated release workflow

### Documentation
- `documentation/guides/automated-releases.md` - Usage guide
- Updated CLAUDE.md and README.md

## Configuration Required

### GitHub Secrets (one-time setup)
```bash
# Repository Settings → Secrets and variables → Actions
OPENAI_API_KEY = <your-openai-api-key>
```

That's it! `GITHUB_TOKEN` is automatically provided.

## Benefits Over Original Plan

| Aspect | Original Plan | With LLM Enhancement |
|--------|--------------|---------------------|
| Release notes | Basic CHANGELOG extraction | AI-generated highlights + categorization |
| Missing CHANGELOG | Generic fallback message | Intelligent generation from commits |
| Presentation | Raw markdown | Polished, professional formatting |
| User experience | Manual categorization | Automatic categorization |
| Time investment | ~4 hours | ~6 hours (+50%) |
| Cost | $0 | ~$0.01 per release |
| Value | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

## Success Criteria

✅ When PR merged with version bump:
- GitHub Release automatically created
- LLM-generated Highlights section
- Changes categorized by type
- Professional markdown formatting
- < 5 second total workflow time

✅ Reliability:
- Works even if CHANGELOG missing
- Works even if LLM API fails (graceful degradation)
- No manual intervention required

✅ Quality:
- Release notes consistently professional
- Accessible to non-technical users
- GitHub-optimized presentation

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| OpenAI API outage | Fallback to basic CHANGELOG extraction |
| API rate limits | Efficient prompting, minimal token usage |
| Cost concerns | GPT-4o-mini is extremely cheap (~$0.01/release) |
| Inconsistent output | Structured prompts with clear formatting rules |

## Ready to Proceed?

This enhanced plan delivers:
- ✅ Solves the original `--github-release` sequencing problem
- ✅ Adds significant value with LLM enhancement
- ✅ Maintains reliability with smart fallbacks
- ✅ Minimal cost (~$0.01 per release)
- ✅ Professional, consistent release notes
- ✅ Fully automated workflow

**Awaiting approval to begin Phase 1 implementation.**
