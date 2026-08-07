# Sprint 374: Shared Storage Volume Implementation

## Summary

Implemented shared persistent storage for Docker environments to support filesystem-based storage across services.

## Problem

After switching from GCS to filesystem storage for image-gen-mcp in staging (due to credential mounting limitations with generated docker-compose files), the service needed a persistent volume for storing generated images.

## Solution

Created a shared Docker volume named `bitbrat-storage` that can be mounted by any service requiring persistent file storage.

## Implementation Details

### 1. Volume Definition

Added `bitbrat-storage` volume to both local and staging compose files:

**docker-compose.local.yaml**:
```yaml
volumes:
  nats-data:
    driver: local
  postgres-data:
    driver: local
  firebase-data-v2:
    driver: local
  # Sprint 374: Shared storage volume for services that need persistent file storage
  bitbrat-storage:
    driver: local
```

**docker-compose.staging.yaml**:
```yaml
volumes:
  postgres-data: {}
  nats-data: {}
  # Sprint 374: Shared storage volume for services that need persistent file storage
  # Mounted at /var/bitbrat/storage in containers that require it (e.g., image-gen-mcp)
  bitbrat-storage: {}
```

### 2. Service Mount

Updated `image-gen-mcp.compose.yaml` to mount the shared volume:

```yaml
volumes:
  # Sprint 374: Mount shared storage volume for persistent file storage
  # This volume is shared across all services that need persistent storage
  - bitbrat-storage:/var/bitbrat/storage
```

### 3. Configuration

Set filesystem storage driver in `env/staging/image-gen-mcp.yaml`:

```yaml
# Storage Configuration (Sprint 373+)
# Sprint 374: Use filesystem driver for staging because:
# - Generated docker-compose.staging.yaml doesn't support volume mounts for credentials
# - Container doesn't have access to host's ADC credentials
# - GCS requires either mounted credentials file or ADC from metadata server
STORAGE_DRIVER: filesystem
STORAGE_FILESYSTEM_PATH: "/var/bitbrat/storage"
STORAGE_FILESYSTEM_PUBLIC_URL_BASE: "http://api-gateway:3100/storage"
```

## Deployment Verification

Deployed to staging and verified volume creation:

```bash
$ ssh root@bitbrat.lan 'docker inspect bitbrat-staging-image-gen-mcp-1 --format "{{json .Mounts}}"' | jq
[
  {
    "Type": "volume",
    "Name": "bitbrat-staging_bitbrat-storage",
    "Source": "/var/lib/docker/volumes/bitbrat-staging_bitbrat-storage/_data",
    "Destination": "/var/bitbrat/storage",
    "Driver": "local",
    "Mode": "rw",
    "RW": true,
    "Propagation": ""
  }
]
```

Directory exists in container:
```bash
$ ssh root@bitbrat.lan 'docker exec bitbrat-staging-image-gen-mcp-1 ls -la /var/bitbrat/storage'
total 8
drwxr-xr-x 2 root root 4096 Jul 30 02:17 .
drwxr-xr-x 3 root root 4096 Jul 30 02:17 ..
```

## Usage

To add shared storage to another service:

1. Add volume mount to the service's compose file:
   ```yaml
   volumes:
     - bitbrat-storage:/var/bitbrat/storage
   ```

2. Configure environment variables for the service:
   ```yaml
   STORAGE_DRIVER: filesystem
   STORAGE_FILESYSTEM_PATH: "/var/bitbrat/storage"
   STORAGE_FILESYSTEM_PUBLIC_URL_BASE: "http://api-gateway:3100/storage"
   ```

## Future Work

The API Gateway static file serving at `/storage` endpoint was planned in Sprint 373 but not yet implemented. This would allow external access to files stored in the shared volume.

**Planned implementation**:
```typescript
// src/apps/api-gateway.ts
app.use('/storage', express.static('/var/bitbrat/storage'));
```

This would require mounting the shared volume into the API Gateway service as well.

## Files Modified

- `infrastructure/docker-compose/docker-compose.local.yaml`
- `infrastructure/docker-compose/docker-compose.staging.yaml`
- `infrastructure/docker-compose/services/image-gen-mcp.compose.yaml`
- `env/staging/image-gen-mcp.yaml`

## Related Documentation

- [Sprint 373 Storage Abstraction](../sprint-373-storage-abstraction/technical-architecture.md)
- [Storage Factory](../../src/common/storage/factory.ts)
