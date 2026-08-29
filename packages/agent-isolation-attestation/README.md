# Agent isolation attestation

This package runs a local provider-neutral conformance journey in a supervisor-owned `bwrap` boundary. Each required execution role is launched in a fresh PID, mount, user, IPC, UTS, cgroup, and network namespace with an empty environment, a single read-write `/workspace`, read-only system executables, and no main-checkout mount.

The runner issues a fresh challenge and accepts output only from the processes it launched. Root, child-agent, workflow-worker, tool-provider, and hosted-runtime roles must prove PID lineage, the exact worktree, a persisted worktree write, denial of a main-checkout marker, denied external TCP, and the exact cleared environment. The result is conformance evidence, not a claim that arbitrary provider processes are isolated unless their assembly runs the same journey.
