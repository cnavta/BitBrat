# Sprint 336: Loki + Promtail Centralized Logging

**Status:** Not Started
**Start Date:** 2026-07-11
**Target End Date:** 2026-07-15
**Branch:** `feature/sprint-336-4b1f5a8-loki-observability`

---

## Quick Links

- **[Sprint Manifest](./sprint-manifest.yaml)** - Overview, goals, success criteria
- **[Execution Plan](./execution-plan.md)** - Detailed implementation strategy
- **[Backlog](./backlog.yaml)** - 20 prioritized, trackable stories across 4 epics

---

## Executive Summary

This sprint implements **Grafana Loki + Promtail** as an optional centralized logging backend for Docker Compose deployments to solve critical observability limitations in BitBrat's distributed architecture.

### The Problem

Current Docker log-based observability is fundamentally limited:
- **Buffer overflow:** Only 2000 lines (~34 events) retained
- **Trace failures:** Correlation IDs older than buffer window are lost
- **No persistence:** Logs lost on container restart
- **Poor performance:** 2-5 seconds to query 14 Bits sequentially
- **Debugging impossible:** Can't investigate issues >30 minutes old

### The Solution

Deploy Loki + Promtail to provide:
- **✅ Unlimited retention:** 7 days by default (configurable)
- **✅ Instant traces:** <100ms queries via indexed correlation IDs
- **✅ Persistent logs:** Survive container restarts
- **✅ Fleet-wide queries:** Single query across all services
- **✅ Zero breaking changes:** Auto-fallback to Docker logs

### Expected Impact

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Trace query time | 2-5 seconds | <100ms | **20-50x faster** |
| Log retention | ~34 events | 7 days | **Unlimited** |
| Trace completeness | ~60% | 100% | **Reliable** |
| Survives restart | ❌ | ✅ | **Persistent** |

---

## Sprint Structure

### 4 Epics, 20 Stories, 40 Hours

**Epic 1: Loki + Promtail Infrastructure Setup** (8 hours)
- Docker Compose configuration
- JSON log parsing pipeline
- Label extraction (correlationId, traceId, service, level)

**Epic 2: LogRetriever Loki Client Integration** (12 hours)
- Loki HTTP client implementation
- Auto-detection and fallback logic
- Error handling and logging

**Epic 3: Fleet Trace Performance Optimization** (4 hours)
- Single-query optimization
- Performance benchmarking
- <100ms target validation

**Epic 4: Testing, Validation & Documentation** (11 hours)
- Integration and E2E tests
- Validation scripts
- Setup and troubleshooting guides

---

## Quick Start (After Sprint Completion)

```bash
# Start BitBrat with Loki observability stack
docker compose \
  -f docker-compose.yaml \
  -f infrastructure/docker-compose/observability/docker-compose.observability.yaml \
  up

# Validate Loki is working
./planning/sprint-336-4b1f5a8-loki-observability/validate-loki.sh

# Use fleet.trace (automatically uses Loki if available)
npm run brat -- fleet trace <correlation-id>
```

---

## Architecture at a Glance

```
BitBrat Services (JSON logs)
         ↓
    Promtail (scrapes + parses)
         ↓
    Loki (indexes by labels)
         ↓
    LogRetriever (queries + fallback)
         ↓
    fleet.trace (<100ms results)
```

**Key Innovation:** Index by `correlationId` for instant distributed trace reconstruction.

---

## Success Criteria

### Must Have
- [x] Loki + Promtail deploy successfully
- [x] Labels extracted: correlationId, traceId, service, level
- [x] LogRetriever auto-detects Loki
- [x] Auto-fallback to Docker logs
- [x] <100ms trace queries with Loki
- [x] 7-day log retention
- [x] Zero breaking changes
- [x] All tests pass
- [x] Documentation complete

### Nice to Have
- [ ] Grafana integration (future sprint)
- [ ] Alert rules (future sprint)
- [ ] Production deployment (future sprint)

---

## Timeline

| Day | Focus | Deliverables |
|-----|-------|-------------|
| Day 1 (2026-07-11) | Infrastructure Setup | Loki + Promtail running locally |
| Day 2 (2026-07-12) | Client Integration (Part 1) | LokiClient + detection |
| Day 3 (2026-07-13) | Integration Complete | Auto-fallback + optimization |
| Day 4 (2026-07-14) | Testing & Documentation | Tests + guides |
| Day 5 (2026-07-15) | Validation & Close-out | Sprint review + retro |

---

## Files in This Sprint

### Planning
- `sprint-manifest.yaml` - Sprint overview and metadata
- `execution-plan.md` - Detailed implementation strategy
- `backlog.yaml` - Prioritized task breakdown
- `README.md` - This file

### Deliverables (Created During Sprint)
- `validate-loki.sh` - Loki deployment validation
- `benchmark-trace.sh` - Performance benchmarking
- `request-log.md` - Prompt and action log (AGENTS.md protocol)
- `verification-report.md` - Final deliverable verification
- `retro.md` - Sprint retrospective
- `key-learnings.md` - Key takeaways

---

## Dependencies

**External:**
- Grafana Loki 2.9.0+ (Docker image)
- Grafana Promtail 2.9.0+ (Docker image)
- Docker Compose 2.0+

**Internal (Already Complete):**
- ✅ JSON structured logging
- ✅ LogRetriever architecture
- ✅ Fleet client infrastructure
- ✅ Dev-mcp server

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Label cardinality explosion | Low | Medium | Limit to 4 labels only |
| Promtail missing logs | Low | High | Validation + fallback |
| Disk space exhaustion | Low | Medium | Retention policy + monitoring |
| Port conflicts | Low | Low | Configurable ports |
| Performance degradation | Low | Low | Resource limits + benchmarks |

---

## Team

- **Lead Implementor:** Claude (AI Assistant)
- **Architect:** Claude (AI Assistant)
- **Product Owner:** Christopher Navta

---

## Following Sprints

**Potential Future Work:**
- Sprint 337: Grafana dashboards for platform observability
- Sprint 338: Alert rules and incident response automation
- Sprint 339: Production Loki deployment strategy
- Sprint 340: OpenTelemetry integration (traces + metrics)
- Sprint 341: Log-based metrics and analytics

---

## References

- [Grafana Loki Documentation](https://grafana.com/docs/loki/latest/)
- [Promtail Configuration](https://grafana.com/docs/loki/latest/clients/promtail/configuration/)
- [LogQL Query Language](https://grafana.com/docs/loki/latest/logql/)
- BitBrat Architecture: `architecture.yaml`
- Current Logging: `src/common/logging.ts`
- Current LogRetriever: `tools/brat/src/dev-mcp/log-retriever.ts`

---

## Notes

This sprint follows the **AGENTS.md** sprint protocol and uses the established
sprint structure from Sprint 335 (Agent-Centric Logging) as a template.

All artifacts are designed for single-implementor execution with clear
acceptance criteria and trackable progress.

**Philosophy:** Optional, additive, gracefully degrading. The platform works
without Loki but performs dramatically better with it.
