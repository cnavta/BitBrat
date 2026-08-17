# Technical Architecture: Pre-defined Image Deployment

## Overview
Currently, the BitBrat Platform deployment pipeline (orchestrated by the `brat` tool) assumes that every service is built from source using a `Dockerfile.<service>` and a corresponding Cloud Build configuration (e.g., `cloudbuild.oauth-flow.yaml`). 

This document outlines the changes required to support services that use pre-defined images (like `obs-mcp`), skipping the build phase and deploying directly to Cloud Run.

## Architecture Changes

### 1. Configuration Schema (`architecture.yaml`)
The `ServiceSchema` and `DefaultsServicesSchema` in `tools/brat/src/config/schema.ts` will be updated to include an optional `image` field.

```yaml
services:
  obs-mcp:
    active: true
    image: us-central1-docker.pkg.dev/bitbrat-local/obs-mcp/obs-mcp:latest
    env: ...
```

### 2. Config Loader (`tools/brat/src/config/loader.ts`)
The `ResolvedServiceConfig` interface will be updated to include `image?: string`.
The `resolveServices` function will be updated to populate this field, allowing for a default `image` in `defaults.services` (though unlikely to be used, it maintains consistency).

### 3. Deployment Orchestration (`tools/brat/src/cli/index.ts`)
The `cmdDeployServices` function will be modified to handle two distinct paths:

#### Path A: Source-based Build (Default)
If `service.image` is NOT present:
- Continue with existing logic:
  - Infer `dockerfile` from service name.
  - Fail if Dockerfile is missing.
  - Submit Cloud Build using `cloudbuild.oauth-flow.yaml` (which includes build steps).

#### Path B: Image-based Deployment
If `service.image` IS present:
- Skip Dockerfile inference and existence check.
- Use a new, minimal Cloud Build configuration: `cloudbuild.deploy-only.yaml`.
- Pass the pre-defined image URL as a substitution.

### 4. New Cloud Build Configuration: `cloudbuild.deploy-only.yaml`
A new, reusable Cloud Build file will be created that ONLY contains the `gcloud run deploy` step. This avoids unnecessary "Install deps", "Build (tsc)", and "Docker build" steps.

```yaml
substitutions:
  _SERVICE_NAME: ''
  _REGION: 'us-central1'
  _IMAGE: ''
  # ... other standard substitutions (port, min/max instances, secrets, env)

steps:
  - id: 'Cloud Run deploy'
    name: 'gcr.io/google.com/cloudsdktool/cloud-sdk:478.0.0'
    entrypoint: 'bash'
    args:
      - -c
      - |
        # logic to execute gcloud run deploy using ${_IMAGE}
```

## Implementation Details

### Changes to `computeDeploySubstitutions`
Update `computeDeploySubstitutions` to accept an optional `image` parameter.
If `image` is provided, it will be used as the value for a new `_IMAGE` substitution.

### Changes to `cmdDeployServices`
```typescript
const isExternalImage = !!svc.image;

let cbConfigPath = path.join(root, 'cloudbuild.oauth-flow.yaml');
let imageToDeploy = ''; // calculated if source-based

if (isExternalImage) {
  cbConfigPath = path.join(root, 'cloudbuild.deploy-only.yaml');
  imageToDeploy = svc.image!;
} else {
  // existing Dockerfile inference logic
  // construct imageToDeploy based on repoName, svc.name, and tag
}

const substitutions = computeDeploySubstitutions({
  // ...
  image: imageToDeploy,
  // ...
});
```

## Verification Plan
1. Update `architecture.yaml` with the `obs-mcp` service using an external image (already done).
2. Run `brat deploy services obs-mcp --dry-run` and verify it uses `cloudbuild.deploy-only.yaml` and the correct image substitution.
3. Successfully deploy `obs-mcp` to a test environment.
