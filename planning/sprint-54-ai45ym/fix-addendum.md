# Sprint 54 Fix Addendum

**Date**: 2026-11-03
**Issue**: Staging continued to show "Unknown parameter: 'response_format'" error after initial fix

## Problem

Despite replacing AI SDK with OpenAI SDK, the error persisted:
```
Unknown parameter: 'response_format'.
```

The initial fix still included:
```typescript
const genResult = await openai.images.generate({
  model,
  prompt,
  size: size as '1024x1024' | '1536x1024' | '1024x1536',
  n: 1,
  response_format: 'b64_json',  // ❌ Still sending this parameter
});
```

## Root Cause

GPT Image 2.5 models **completely reject** the `response_format` parameter. They:
- Always return base64-encoded images
- Do not accept the parameter in any form
- Throw an error if the parameter is present

The parameter is ONLY for legacy DALL-E models (now deprecated).

## Final Fix

**Removed the `response_format` parameter entirely**:

```typescript
// GPT Image 2.5 models do NOT accept response_format parameter and always return base64
const genResult = await openai.images.generate({
  model,
  prompt,
  size: size as '1024x1024' | '1536x1024' | '1024x1536',
  n: 1,
  // NO response_format parameter
});
```

**Added additional null safety**:
```typescript
// Validate response data exists
if (!genResult.data || genResult.data.length === 0) {
  throw new Error('No image data returned from generation');
}

const imageData = genResult.data[0];
if (!imageData || !imageData.b64_json) {
  throw new Error('No image data returned from generation');
}

const imageBuffer = Buffer.from(imageData.b64_json, 'base64');
```

## Verification

✅ TypeScript compiles successfully
✅ Enhanced null safety for response handling
✅ No `response_format` parameter sent to API

## Key Learning

**OpenAI's GPT Image API is strict**: The models don't just ignore unsupported parameters - they actively reject them with errors. This is different from many APIs that silently ignore unknown parameters.

**Always test with real API calls** in staging to catch parameter compatibility issues that might not be obvious from documentation alone.

## Files Changed

- `src/services/image-gen-mcp/index.ts`:
  - Removed `response_format: 'b64_json'` parameter (line 151)
  - Added comment explaining why parameter is omitted
  - Enhanced null checking for response data

## Status

✅ **CRITICAL FIX APPLIED** - Ready for staging deployment
