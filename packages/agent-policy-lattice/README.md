# Agent policy lattice

This package provides the provider-neutral, monotonic policy boundary required by ADR-0024. It combines permission ordering and configuration provenance without replacing ADR-0022 authority, approvals, or dispatch.

The source order is `enterprise > managed > user > project > installed plugin > synced plugin > runtime default`. Denies are monotonic, approval requests cannot be converted into allows by a weaker layer or provider callback, and child authority can only narrow. Restrictive configuration uses explicit merge kinds rather than an implicit last-writer-wins rule.

The package is inactive until an assembly injects its result into the existing governed execution boundary. It performs no I/O, reads no provider configuration, and grants no approval.
