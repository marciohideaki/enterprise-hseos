# Policy

## Canonical mapping — k3s / k8s

| Service | Service DNS (cluster-internal) | Notes |
|---|---|---|
| Redis | `redis-shared.platform-shared-dev.svc.cluster.local:6379` | StatefulSet |
| NATS | `nats-shared.platform-shared-dev.svc.cluster.local:4222` (client) / `:8222` (mgmt) | **Scaled to 0 replicas** |
| Loki | `loki.monitoring.svc.cluster.local:3100` | other ns |

## Next
