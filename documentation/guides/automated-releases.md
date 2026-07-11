# Automated GitHub Releases

This guide explains the automated release workflow that creates GitHub Releases with LLM-enhanced release notes when version bumps are merged to `main`.

## Overview

The BitBrat Platform uses a GitHub Actions workflow (`.github/workflows/auto-release.yml`) that automatically detects version changes and creates professional GitHub Releases with AI-generated release notes.

### Key Features

- **Automatic version detection** from `architecture.yaml`
- **LLM-enhanced release notes** using GPT-4o-mini
- **Intelligent categorization** (Highlights, Features, Fixes, Breaking Changes)
- **Graceful fallback** when LLM or CHANGELOG unavailable
- **Duplicate prevention** (skips if tag/release already exists)
- **Zero manual intervention** required

## Workflow Trigger

The workflow triggers automatically on **push to `main` branch**. Common scenarios:

1. **PR merged** with version bump → Release created ✅
2. **Direct push** to main with version bump → Release created ✅
3. **PR merged** without version change → Skipped gracefully ℹ️
4. **Push to other branch** → Not triggered ℹ️

## Setup

### 1. Configure OpenAI API Key (Required for LLM enhancement)

1. Go to your repository on GitHub
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `OPENAI_API_KEY`
5. Value: Your OpenAI API key (get from https://platform.openai.com/api-keys)
6. Click **Add secret**

**Note**: If `OPENAI_API_KEY` is not configured, releases will be created using CHANGELOG.md content only.

### 2. Ensure Workflow is Enabled

The workflow file `.github/workflows/auto-release.yml` must exist and workflows must be enabled in your repository settings.

## How It Works

### Step-by-Step Flow

```
PR with version bump merged to main
  ↓
1. Detect version change (architecture.yaml)
  ↓ (version changed)
2. Extract CHANGELOG.md content (if available)
  ↓
3. Parse git commits since last version
  ↓
4. Generate LLM-enhanced release notes
   ├─ Highlights (AI-generated summary)
   ├─ Features (auto-categorized)
   ├─ Fixes (auto-categorized)
   └─ Breaking Changes (auto-detected)
  ↓
5. Create git tag (v<version>)
  ↓
6. Create GitHub Release with enhanced notes
  ↓
Done! ✅
```

### Version Detection

The workflow compares `project.version` in `architecture.yaml` between HEAD and HEAD~1:

```yaml
# architecture.yaml
project:
  name: BitBrat Platform
  version: 0.10.0  # ← This value is monitored
```

If changed: `0.9.0` → `0.10.0`, the release workflow proceeds.

### LLM Enhancement

The workflow uses GPT-4o-mini to generate professional release notes:

**Input:**
- CHANGELOG.md content for the version (if available)
- Git commits between versions
- Conventional commit parsing (feat/fix/breaking)

**Output:**
```markdown
## Highlights
[AI-generated 2-3 sentence summary of the release]

## What's New

### Features
- Feature 1 description
- Feature 2 description

### Fixes
- Bug fix 1
- Bug fix 2

### Breaking Changes
- Breaking change description (if any)
```

### Fallback Strategy

The workflow is resilient and uses intelligent fallbacks:

| Scenario | Behavior |
|----------|----------|
| ✅ CHANGELOG exists + LLM available | LLM-enhanced notes with CHANGELOG context |
| ⚠️ CHANGELOG exists + LLM fails | Use CHANGELOG content only |
| ⚠️ CHANGELOG missing + LLM available | Generate notes from git commits |
| ⚠️ CHANGELOG missing + LLM fails | Generic release message |

## Release Notes Format

### Example LLM-Enhanced Release

```markdown
## Highlights
This release introduces centralized observability with Loki integration and
significantly improves fleet administration capabilities through enhanced
MCP tooling. Performance optimizations reduce log query times by 90%.

## What's New

### Features
- Add Loki + Promtail centralized logging stack
- Implement fleet.trace with single-query performance optimization
- Add automatic fallback to Docker logs when Loki unavailable
- Expose 9 read-only MCP tools for platform inspection

### Fixes
- Fix Loki schema config date for staging environment
- Resolve WAL directory permissions issues
- Correct network name references in docker-compose

### Breaking Changes
None
```

## Troubleshooting

### Release Not Created

**Symptom**: PR merged but no release appeared

**Possible causes**:
1. Version not changed in `architecture.yaml`
   - Check: Compare `project.version` with previous commit
2. Workflow disabled
   - Check: Settings → Actions → General → Allow all actions
3. Tag already exists
   - Check workflow logs for "Tag vX.Y.Z already exists"

### LLM Enhancement Failed

**Symptom**: Release created but notes are basic (no Highlights section)

**Possible causes**:
1. `OPENAI_API_KEY` not configured
   - Fix: Add secret as described in Setup section
2. OpenAI API error (rate limit, network issue)
   - Workflow automatically falls back to CHANGELOG content
   - Check workflow logs for error details

### Duplicate Releases

The workflow automatically detects and skips if:
- Git tag `v<version>` already exists
- GitHub Release for `v<version>` already exists

No manual intervention needed.

## Manual Intervention

### Manually Trigger Workflow (if needed)

While the workflow is automatic, you can manually trigger it:

1. Go to **Actions** tab in your repository
2. Select **Automated Release** workflow
3. Click **Run workflow**
4. Select branch (should be `main`)
5. Click **Run workflow**

Note: The workflow will still only create a release if version changed.

### Edit Release After Creation

GitHub Releases can be edited after creation:

1. Go to **Releases** in your repository
2. Find the release
3. Click **Edit**
4. Modify title or notes
5. Click **Update release**

## Best Practices

### 1. Use Semantic Versioning

Follow SemVer guidelines:
- **Patch** (0.9.0 → 0.9.1): Bug fixes, no breaking changes
- **Minor** (0.9.0 → 0.10.0): New features, backward compatible
- **Major** (0.9.0 → 1.0.0): Breaking changes

### 2. Maintain CHANGELOG.md

Even with LLM enhancement, keep CHANGELOG.md updated:
- Provides structure for LLM to enhance
- Serves as fallback if LLM unavailable
- Maintains human-readable history in repository

### 3. Use Conventional Commits

For better LLM categorization, use conventional commit format:
```
feat(auth): add JWT token refresh
fix(db): resolve connection pool leak
docs: update API reference
BREAKING CHANGE: remove deprecated endpoints
```

### 4. Review Generated Notes

After release creation:
1. Check the GitHub Release
2. Verify accuracy of generated notes
3. Edit if needed (though LLM is usually accurate)

## Cost Considerations

### OpenAI API Usage

- **Model**: GPT-4o-mini (~$0.15 per 1M input tokens)
- **Typical release**: ~500-2000 tokens
- **Cost per release**: ~$0.001 - $0.005 (less than 1¢)
- **Monthly estimate** (10 releases): < $0.10

Very cost-effective for professional release notes!

## Advanced Configuration

### Customizing Release Notes Format

Edit `scripts/llm-release-notes.js` prompt to change the format:

```javascript
const prompt = `You are generating release notes for version ${version}...

Generate professional GitHub release notes in this EXACT format:
[Your custom format here]
`;
```

### Changing LLM Model

Edit `scripts/llm-release-notes.js`:

```javascript
const MODEL = 'gpt-4o-mini';  // Change to gpt-4, gpt-3.5-turbo, etc.
```

Note: GPT-4o-mini is recommended for cost/quality balance.

### Disabling LLM Enhancement

If you prefer basic CHANGELOG-only releases:

1. Don't configure `OPENAI_API_KEY` secret
2. Workflow will automatically use CHANGELOG content only

## Reference

### Workflow File
`.github/workflows/auto-release.yml`

### Helper Scripts
- `scripts/detect-version-change.sh` - Version detection
- `scripts/extract-changelog.sh` - CHANGELOG parsing
- `scripts/llm-release-notes.js` - LLM integration

### Dependencies
- `openai` npm package (installed via `package.json`)

## Support

For issues or questions:
- Check workflow logs in Actions tab
- Review this documentation
- Create an issue in the repository

## Examples

### Successful Release Log

```
✅ Version changed: 0.9.0 → 0.10.0
✅ CHANGELOG content extracted for v0.10.0
🤖 Generating LLM-enhanced release notes...
✅ LLM release notes generated successfully
✅ Created and pushed tag: v0.10.0
✅ GitHub Release created: v0.10.0
```

### Fallback Release Log

```
✅ Version changed: 0.9.0 → 0.10.0
ℹ️  No CHANGELOG entry found, will use LLM to generate from commits
⚠️  OPENAI_API_KEY not configured, using CHANGELOG only
✅ Created and pushed tag: v0.10.0
✅ GitHub Release created: v0.10.0
```

---

**Last updated**: Sprint 337 - Automated Release Workflow Implementation
