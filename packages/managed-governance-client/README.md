# Managed Governance Client

Optional project-scoped client for comparing local HSEOS governance with a managed control plane.
The only active managed mode is `managed-shadow`: the local result always remains authoritative.

The client requires an explicit binding, repository identity, endpoint and snapshot path. It has no
home-directory or machine-global defaults. Snapshot files contain no bearer credentials or database
configuration. Offline reads may use a digest-verified last-known-good snapshot within the binding's
age bound and are always marked degraded.

The reserved enforcement mode parses for forward compatibility but returns
`enforcement_unavailable`; it performs no network request and cannot activate enforcement.
