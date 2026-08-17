# Sprint 343: PostgreSQL Migration - Simplified Approach

## Summary

The PostgreSQL migration plan has been **significantly simplified** based on user feedback:

### Key Changes

1. **Duration Reduced**: 6 weeks → **3-4 weeks**
2. **Approach Simplified**: Docker-first → Migrate → Deploy → GCP (optional future)
3. **Tasks Reduced**: 79 tasks → **58 tasks**
4. **Effort Reduced**: 289 hours → **180 hours**

## What Was Removed

### ❌ Dual-Write Complexity
- Removed FirestoreAdapter wrapper
- Removed DualWriteStore implementation
- Removed dual-write testing and validation
- **Savings**: ~20 hours, eliminated significant code complexity

**New Approach**: Simple factory pattern - if `PERSISTENCE_DRIVER === 'postgres'` use PostgreSQL, else use Firestore.

### ❌ Gradual Production Rollout
- Removed 1% → 10% → 50% → 100% canary deployment
- Removed 48-hour soak testing
- Removed production monitoring dashboards
- **Savings**: ~30 hours

**Rationale**: No sensitive production data yet. We can do a simple switch.

### ❌ GCP Cloud SQL (Moved to Optional Phase 3)
- Removed Terraform modules from critical path
- Removed Cloud SQL provisioning (staging/prod)
- Removed Secret Manager integration
- Removed Cloud Run socket mounting
- Removed VPC peering configuration
- **Savings**: ~50 hours

**New Approach**: Docker PostgreSQL is primary target. GCP Cloud SQL deferred to future work when production deployment is needed.

## New Structure

### Phase 0: Foundation (Week 1) - 16 tasks, 60 hours
**Goal**: Get Docker working with PostgreSQL

- Create persistence abstractions (IDocumentStore, IKVStore)
- Implement PostgresDocumentStore
- Simple factory for driver selection (no dual-write)
- Docker Compose PostgreSQL service
- Migration tooling (migrate, backup, restore, validate)
- Test locally with 10k events

**Deliverable**: Local Docker stack running PostgreSQL with validated migration tooling

### Phase 1: Full Migration (Weeks 2-3) - 35 tasks, 105 hours
**Goal**: Migrate everything, deploy to remote Docker

- Create all 13 PostgreSQL schemas
- Refactor all services to use IDocumentStore
- Migrate all data using `npm run brat -- migrate all`
- Deploy to remote Docker (bitbrat.lan staging)
- Set PERSISTENCE_DRIVER=postgres
- Verify zero Firestore reads

**Deliverable**: All services running on PostgreSQL in remote Docker staging environment

### Phase 2: Cleanup (Week 4) - 7 tasks, 15 hours
**Goal**: Remove Firestore dependencies

- Verify zero Firestore operations for 48 hours
- Remove firebase-admin from package.json
- Delete src/common/firebase.ts
- Remove Firestore emulator from docker-compose
- Update documentation (README, CLAUDE.md)
- Archive deprecated code

**Deliverable**: Firestore completely removed from codebase

### Phase 3: GCP Cloud SQL (Optional Future Work) - ~12 tasks, ~40 hours
**Goal**: Cloud SQL for future production (deferred)

- Terraform modules for Cloud SQL
- Cloud SQL instance provisioning
- Secret Manager integration
- Cloud Run deployment updates
- Migration from Docker PostgreSQL to Cloud SQL

**Status**: Deferred - not needed for initial deployment

## Migration Flow

```bash
# Week 1: Foundation
npm run brat -- docker up --target local      # PostgreSQL in Docker
npm run brat -- migrate all --dry-run         # Test migration
npm run brat -- migrate all                   # Migrate test data
PERSISTENCE_DRIVER=postgres docker-compose up # Test with PostgreSQL

# Weeks 2-3: Full Migration
npm run brat -- docker up --target staging    # Deploy to remote Docker
npm run brat -- migrate all --target staging  # Migrate staging data
# Update env: PERSISTENCE_DRIVER=postgres
docker-compose restart                        # All services now use PostgreSQL

# Week 4: Cleanup
npm uninstall firebase-admin                  # Remove Firestore
rm src/common/firebase.ts                     # Delete Firestore code
# Update docs

# Future (Optional): GCP
terraform apply                               # Cloud SQL (when needed)
```

## Rollback Strategy

**Simple and Fast** (no dual-write overhead):

1. Set `PERSISTENCE_DRIVER=firestore` in environment
2. Restart services: `docker-compose restart`
3. Firestore still has all original data (migration is read-only)
4. **Recovery time**: < 2 minutes

## Benefits of Simplified Approach

1. **Faster Delivery**: 3-4 weeks instead of 6 weeks
2. **Less Complexity**: No dual-write, no gradual rollout
3. **Lower Risk**: Firestore data untouched (read-only migration)
4. **Docker-First**: Aligns with primary deployment target
5. **Cost Savings**: $0/month (Docker PostgreSQL) vs $95/month (Firestore)
6. **Future-Ready**: GCP Cloud SQL can be added later when needed

## Task Breakdown

| Phase | Tasks | Hours | Goal |
|-------|-------|-------|------|
| Foundation | 16 | 60 | Docker + Migration Tooling |
| Full Migration | 35 | 105 | All Collections Migrated |
| Cleanup | 7 | 15 | Remove Firestore |
| **Total** | **58** | **180** | **4-5 weeks** |
| GCP (Optional) | ~12 | ~40 | Cloud SQL (future) |

## Decision Gates

**Gate 1: Foundation Complete (End of Week 1)**
- Local Docker stack works with PostgreSQL ✓
- Migration tooling validated ✓
- Performance within 20% of Firestore ✓

**Gate 2: Migration Complete (End of Week 3)**
- All 13 collections migrated ✓
- All services deployed to remote Docker ✓
- Zero Firestore reads ✓
- Integration tests passing ✓

## Files Updated

- `backlog.yaml`: Completely rewritten (1509 → 1116 lines)
- `sprint-manifest.yaml`: Updated all sections (273 → 214 lines)
- `EXECUTION_PLAN.md`: Needs update to match simplified approach

## Next Steps

1. Review this simplified approach
2. Get approval to proceed
3. Allocate Lead Implementor for 3-4 weeks
4. Begin FND-001: Create persistence abstractions
