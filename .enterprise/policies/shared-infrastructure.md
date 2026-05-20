# Policy: Shared Infrastructure (Global)

**Status:** canonical · enforced across all Hideaki workspace projects
**Scope:** local development AND Kubernetes (k3s/k8s) clusters
**Vigência:** 2026-05-20

## Rule

All projects in `/opt/hideakisolutions/*` **MUST** consume the shared infrastructure stack rather than provisioning project-local instances of stateful services (databases, caches, queues, object storage, policy engines, identity providers, observability backends).

If a required shared service does not exist (in `shared-*` containers locally or in the `shared-platform` k3s namespace), the agent **MUST stop and ask the user** how to proceed. **Do not** spin up a project-local replacement without explicit authorization.

## Motivation

- **Port/resource conflicts** — multi-project workspace (runtime-one, intent-os, cambio-lan, events, ai-agents-os, …) cannot afford each project booting its own postgres/redis/opa.
- **Memory & disk pressure** — a single host (or a dev k3s) shouldn't run N copies of pgvector, opensearch, redpanda.
- **Production fidelity** — production already uses shared data services (Vault/External Secrets); local must mirror.
- **Operational simplicity** — one place to back up, restore, observe, upgrade.

## Canonical mapping — Local (Docker)

Source containers (running on dev host as of 2026-05-20):

| Service | Container | Local endpoint | Notes |
|---|---|---|---|
| PostgreSQL (pgvector) | `shared-postgres` | `127.0.0.1:15432` | pg16, multi-database (each project has its own DB inside) |
| Redis | `shared-redis` | `127.0.0.1:16380` | redis 7-alpine |
| OPA | `shared-opa` | `127.0.0.1:18181` | v1.1.0 |
| MinIO (S3) | `shared-minio` | `127.0.0.1:19000` (API) / `19002` (console) | latest |
| OpenSearch | `shared-opensearch` | `127.0.0.1:19200` | v2.18.0 |
| Loki | `shared-loki` | `127.0.0.1:23100` | v3.1.1 |
| Qdrant | `shared-qdrant` | `127.0.0.1:6333-6334` | v1.12.4 |
| FalkorDB | `shared-falkordb` | `127.0.0.1:6379` | latest |
| Ollama | `shared-ollama` | `127.0.0.1:11434` | latest |
| Keycloak | `shared-keycloak` | `127.0.0.1:18081` | v24.0.5 |
| OpenFGA | `shared-openfga` | `127.0.0.1:18082` (HTTP) / `18083` (gRPC) | v1.5.3 |
| Redpanda (Kafka) | `shared-redpanda` | `127.0.0.1:39092` | v24.2.7 |
| MySQL | `shared-mysql` | `127.0.0.1:13306` | v8.0 |
| MariaDB | `shared-mariadb` | `127.0.0.1:13308` | v11 |
| OpenTelemetry Collector | `shared-otel-collector` | `127.0.0.1:14317` (gRPC) / `14318` (HTTP) | v0.110.0 |

## Canonical mapping — k3s / k8s

Source: namespace `shared-platform` in the dev/staging k3s cluster.

| Service | Service DNS (cluster-internal) | Notes |
|---|---|---|
| PostgreSQL | `postgres.shared-platform.svc.cluster.local:5432` | CloudNativePG cluster `shared-pg` |
| Redis | `redis.shared-platform.svc.cluster.local:6379` | Bitnami chart |
| OPA | `opa.shared-platform.svc.cluster.local:8181` | sidecar-mode optional via mesh |
| MinIO | `minio.shared-platform.svc.cluster.local:9000` | Tenant per project via Tenant CRD |
| OpenSearch | `opensearch.shared-platform.svc.cluster.local:9200` | |
| Loki | `loki-gateway.shared-platform.svc.cluster.local:3100` | |
| Qdrant | `qdrant.shared-platform.svc.cluster.local:6333` | StatefulSet |
| Keycloak | `keycloak.shared-platform.svc.cluster.local:8080` | realm per tenant |
| OpenFGA | `openfga.shared-platform.svc.cluster.local:8080` | |
| Redpanda (Kafka) | `redpanda.shared-platform.svc.cluster.local:9092` | topic prefix per project |
| OTel Collector | `otel-collector.shared-platform.svc.cluster.local:4317` | |

Credentials/secrets are sourced via **External Secrets Operator** from Vault (`platform-secrets-dev` SecretStore). Per-project `ExternalSecret` resources project the shared credentials into the project namespace.

## Procedural rules

### Local — bringing up a project

1. **Verify shared services are healthy** before starting project code:
   ```bash
   docker ps --format '{{.Names}}\t{{.Status}}' | grep -E '^shared-'
   ```
2. **Configure project `.env` (or equivalent)** with the endpoints from the table above. Use `127.0.0.1` (not container name) for processes running on the host.
3. **First-time database setup**: create the project-specific database/schema inside `shared-postgres`:
   ```bash
   docker exec shared-postgres psql -U <admin-user> -d postgres -c "CREATE DATABASE <project_db>;"
   ```
4. **Do not** run `docker compose up` on a project's local compose file if it duplicates a shared service. Project compose files are reference-only or should be limited to project-specific containers (e.g., the app's own backend/frontend).
5. **Port collisions are a smell** — if a project boots and its port collides with shared, stop and review this policy.

### k3s — deploying a project

1. **Reference shared services via cluster DNS** (table above), never via NodePort or `localhost`.
2. **Connect via External Secrets** for credentials. Never hard-code or duplicate secrets per project.
3. **Schema/database creation** for postgres goes through CloudNativePG's `Database` CRD or a project bootstrap Job, **not** by booting a project-local postgres.
4. **Per-project topic/bucket/realm scoping**:
   - Kafka: prefix topic names with `<project>.`
   - MinIO: dedicated Tenant or bucket prefix.
   - Keycloak: dedicated realm.
   - Redis: dedicated logical DB (`SELECT <n>`) or key prefix.

### When a shared service does NOT exist

Two scenarios:

**A) Service exists in the table above but is not running locally / not deployed in k3s.**
→ **Ask the user.** Do not boot a replacement. Likely the shared service needs to be (re)started or deployed; that's the user's call.

**B) Project needs a service NOT in the table.**
→ **Ask the user.** Options to discuss:
  1. Add it to shared infrastructure (preferred — extend this policy).
  2. Run a project-local instance temporarily, scoped via env vars, with a TODO to migrate to shared.
  3. Use a managed cloud service.

Never silently introduce a new local data service without authorization.

## Exceptions

CI/CD test runs use ephemeral services (e.g., `docker compose -f docker-compose.test.yml` with throwaway containers). This is an authorized exception because tests must be hermetic.

Demos requiring full isolation are also authorized exceptions, but must be documented in `.enterprise/exceptions/` with rationale and TTL.

## Enforcement

- **Agent-side**: agents reading `.agents/instructions/PROJECT.md` should also read this file (`.enterprise/policies/shared-infrastructure.md`) when about to write infrastructure code, edit `.env`, or modify `docker-compose.yml`/k8s manifests.
- **CI**: pipelines may add a lint that fails if a project's `docker-compose.yml` introduces `postgres`/`redis`/`opa` services without listing this policy in an exception.
- **Pre-flight check**: the `pre-flight-checks.md` policy should include "Have you verified shared infra availability before booting project services?".

## Per-project documentation

Each project's `docs/dev/SHARED-INFRA.md` (or equivalent) should:
1. Reference this canonical policy.
2. List the specific subset of shared services the project consumes.
3. Document the project-specific database name / topic prefix / bucket prefix.
4. Show the exact env vars / k8s ConfigMap values pointing to shared.

The `ai-agents-os` project's `docs/dev/SHARED-INFRA.md` is the reference implementation of this pattern.

## Updating this policy

Changes require:
1. PR against `enterprise-hseos`.
2. Notification to all projects that consume shared services (impact assessment).
3. Update of per-project `docs/dev/SHARED-INFRA.md` files.

Mapping additions (new shared service) require additionally:
1. Coordination with the team operating the shared stack.
2. Update of the k3s `shared-platform` namespace charts.
