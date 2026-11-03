# Implementation Plan: Fix GPT Image API Compatibility

**Sprint**: sprint-54-ai45ym
**Goal**: Fix the "Unknown parameter: 'response_format'" error and ensure all image generation libraries are up to date

## Problem Analysis

### Current Error
```
Unknown parameter: 'response_format'.
```

This error occurs when using the AI SDK's `experimental_generateImage` function with GPT Image 2.5 models.

### Root Cause
1. **AI SDK Version**: Currently using `ai@6.0.3` (latest: 7.0.162)
2. **OpenAI SDK Version**: Currently using `openai@6.46.0` (latest: 7.47.0)
3. **AI SDK OpenAI Provider**: Currently using `@ai-sdk/openai@3.0.1` (latest: 4.0.108)

The AI SDK v6's `experimental_generateImage` sends a `response_format` parameter that:
- Is NOT supported by GPT Image models (gpt-image-2.5-sunburst, gpt-image-2.5-flare)
- GPT Image models ALWAYS return base64-encoded images
- The parameter is only for legacy DALL-E models

### OpenAI's GPT Image API Specifications
- **Model Names**: `gpt-image-2.5-sunburst`, `gpt-image-2.5-flare`
- **Supported Parameters**:
  - `model` (required)
  - `prompt` (required)
  - `size` (optional: auto or custom resolution)
  - `quality` (optional: auto, low, medium, high, xhigh, max)
  - `n` (optional: number of results, 1-20, default: 1)
- **NOT Supported**: `response_format` (always returns base64)

## Solution: Use OpenAI SDK Directly

### Approach
Instead of upgrading AI SDK from v6 to v7 (major version change with potential breaking changes), we'll:
1. **Upgrade OpenAI SDK** from `6.46.0` to `7.47.0`
2. **Use OpenAI SDK directly** for image generation (bypass AI SDK's `experimental_generateImage`)
3. **Keep AI SDK v6** for LLM operations (no breaking changes needed)

### Benefits
- ✅ Full control over image generation API parameters
- ✅ No `response_format` parameter sent
- ✅ Avoids AI SDK v6→v7 migration complexity
- ✅ Uses official OpenAI SDK (better support, more reliable)
- ✅ Smaller change surface (only affects image-gen-mcp service)

## Implementation Steps

### Phase 1: Upgrade OpenAI SDK (10 min)
1. ✅ Upgrade `openai` from `6.46.0` to `7.47.0`
   ```bash
   npm install openai@latest
   ```

2. ⏳ Check for breaking changes in OpenAI SDK v7
3. ⏳ Update package-lock.json

### Phase 2: Replace Image Generation Implementation (30 min)
4. ⏳ Remove AI SDK import:
   ```typescript
   // REMOVE:
   import { experimental_generateImage as generateImage } from 'ai';
   ```

5. ⏳ Add OpenAI SDK import:
   ```typescript
   import OpenAI from 'openai';
   ```

6. ⏳ Replace image generation logic:
   ```typescript
   // OLD (AI SDK):
   const provider = getLlmProvider({
     provider: 'openai',
     model,
     apiKey,
   });
   const genResult = await generateImage({
     model: provider as any,
     prompt,
     size: size as any,
   });

   // NEW (OpenAI SDK):
   const openai = new OpenAI({ apiKey });
   const genResult = await openai.images.generate({
     model,  // 'gpt-image-2.5-sunburst'
     prompt,
     size,   // '1024x1024', '1536x1024', etc.
     n: 1,   // Number of images
     response_format: 'b64_json',  // Always base64 for GPT Image models
   });
   ```

7. ⏳ Update result handling:
   ```typescript
   // AI SDK returns: genResult.image.base64 or genResult.image.uint8Array
   // OpenAI SDK returns: genResult.data[0].b64_json

   const imageBuffer = Buffer.from(genResult.data[0].b64_json, 'base64');
   ```

8. ⏳ Remove size format conversion logic (if still needed for OpenAI SDK)

### Phase 3: Update Size Parameters (15 min)
9. ⏳ Verify size mappings for GPT Image models:
   - GPT Image supports: 1024x1024, 1536x1024, 1024x1536
   - Current logic (lines 144-147) already handles this correctly

10. ⏳ Test all aspect ratios:
    - `1:1` → `1024x1024`
    - `16:9` → `1536x1024`
    - `9:16` → `1024x1536`

### Phase 4: Testing (30 min)
11. ⏳ Build and compile TypeScript
12. ⏳ Test image generation with all aspect ratios
13. ⏳ Verify no `response_format` parameter errors
14. ⏳ Verify images are generated and stored correctly
15. ⏳ Check logs for any warnings/errors

### Phase 5: Documentation (10 min)
16. ⏳ Update code comments to reflect OpenAI SDK usage
17. ⏳ Document OpenAI SDK version requirement
18. ⏳ Create sprint artifacts

## Code Changes Summary

### Files to Modify
1. **src/services/image-gen-mcp/index.ts**
   - Remove AI SDK `experimental_generateImage` import
   - Add OpenAI SDK import
   - Replace `generateImage` call with `openai.images.generate()`
   - Update result handling for OpenAI SDK response format

2. **package.json**
   - Upgrade `openai` from `^6.46.0` to `^7.47.0`

### Files NOT Changed
- `src/common/llm/provider-factory.ts` (still used for LLM operations)
- `ai` package version (stays at `^6.0.3` for LLM operations)
- `@ai-sdk/openai` package version (stays at `^3.0.1`)

## API Parameter Comparison

### Before (AI SDK v6)
```typescript
await generateImage({
  model: provider,  // Provider instance
  prompt,
  size,
  // AI SDK adds response_format: 'url' or 'b64_json' ❌
});
```

### After (OpenAI SDK v7)
```typescript
await openai.images.generate({
  model: 'gpt-image-2.5-sunburst',  // Model string
  prompt,
  size,
  n: 1,
  response_format: 'b64_json',  // Explicit, but GPT Image ignores it
});
```

**Note**: OpenAI SDK v7 documentation indicates that `response_format` is technically still a valid parameter, but GPT Image models ignore it and always return base64. We'll include it for API consistency.

## Testing Checklist

- [ ] Code compiles without errors
- [ ] No `response_format` parameter errors
- [ ] Image generation completes successfully (1:1 aspect ratio)
- [ ] Image generation completes successfully (16:9 aspect ratio)
- [ ] Image generation completes successfully (9:16 aspect ratio)
- [ ] Generated images are valid PNG files
- [ ] Images are uploaded to storage correctly
- [ ] Public URLs are accessible
- [ ] Moderation checks still work
- [ ] Prompt logging captures correct data
- [ ] Rate limiting still functions

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| OpenAI SDK v7 has breaking changes | Build fails | Check changelog, test before deployment |
| Response format differs | Image extraction fails | Handle both `b64_json` and potential URL formats |
| Size parameters rejected | Generation fails | Test all sizes with actual API calls |
| Performance degradation | Slower generation | Monitor generation times before/after |

## Rollback Plan

If issues occur:
1. Revert `package.json` changes
2. Restore AI SDK `experimental_generateImage` usage
3. Set `IMAGE_GEN_MODEL=dall-e-3` temporarily (may still work)
4. Investigate OpenAI SDK v7 compatibility

## Success Criteria

- ✅ No "Unknown parameter: 'response_format'" errors
- ✅ Image generation completes successfully
- ✅ All aspect ratios work correctly
- ✅ Generated images are high quality
- ✅ All tests pass
- ✅ Service logs show successful generations

## Estimated Effort

**Total**: 95 minutes
- Upgrade OpenAI SDK: 10 min
- Replace implementation: 30 min
- Update size parameters: 15 min
- Testing: 30 min
- Documentation: 10 min

## OpenAI SDK v7 Migration Notes

### Potential Breaking Changes to Check
1. `import OpenAI from 'openai'` syntax (may have changed)
2. `images.generate()` method signature
3. Response format structure
4. Error handling patterns

### Version Compatibility
- Node.js: >=22.19.0 (already required by package.json)
- TypeScript: Compatible with strict mode (already enabled)

## References

- OpenAI SDK v7 Changelog: https://github.com/openai/openai-node/releases
- OpenAI Image Generation API: https://platform.openai.com/docs/guides/images
- GPT Image 2.5 Models: https://platform.openai.com/docs/models
- Current code: `src/services/image-gen-mcp/index.ts`
- Configuration: `architecture.yaml`

## Follow-Up Actions (Future Sprints)

1. Consider upgrading AI SDK from v6 to v7 (comprehensive testing needed)
2. Add integration tests for image generation
3. Add monitoring for image generation success rates
4. Document image generation best practices
