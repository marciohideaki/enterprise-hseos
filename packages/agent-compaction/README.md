# HSEOS Agent Compaction

**Artifact type:** Agent Kernel provider package  
**Scope:** Lineage-preserving context compaction and immutable checkpoint storage  
**Governing documents:** Enterprise Constitution; ADR-0001; ADR-0002; ADR-0003; ADR-0024

`@hseos/agent-compaction` supplies substitutable, versioned compaction and checkpoint ports. The deterministic provider is keyless and intended for conformance. It can summarize bounded history or prune settled tool-result bodies while retaining tool identity, status, evidence, warnings and a digest of the original result.

The relational `compaction.completed` session event embeds the exact replacement and complete source lineage. Checkpoints are immutable evidence copies, not canonical authority; deleting or losing a checkpoint cannot make the recorded model request unreconstructable. Original session and governed-operation events are never updated or deleted.

The runtime reads an existing checkpoint before invoking a provider, so a crash between checkpoint persistence and relational append resumes byte-for-byte without asking a potentially nondeterministic provider again. Checkpoint payloads are core-built validated results and reject credential-bearing keys recursively. Registry snapshots bind provider methods at registration time, and every record carries the exact provider manifest plus checkpoint-provider identity.

A7 uses canonical UTF-8 bytes as its conservative provider-neutral token upper-bound counter. Both runtime and replay recompute message counts, bytes and this counter, enforce manifest input/output caps, and reject false accounting or provenance. Model-specific tokenizers can be introduced only through a later versioned adapter contract.
