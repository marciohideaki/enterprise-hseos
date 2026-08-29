# Repository identity contract v1

Every governed repository versions `repository-contract.yaml` at its root.
`repository_id` is the immutable primary identity. `identity.remotes` are
discovery and verification aliases only; local paths are never identity.

`capabilities.manifest` must reference an existing repository-owned HSEOS
manifest when one exists. A null value means unmanaged and produces
`unknown` capability evidence, never a verified capability claim.

Validate a checkout with:

```bash
node scripts/governance/validate-repository-contract.js /path/to/repository
```
