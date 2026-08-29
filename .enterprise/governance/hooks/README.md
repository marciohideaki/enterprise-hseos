# Hook Registry Contract

`registry.yaml` is the canonical hook source. Schema v2 requires every entry to
declare its activation status explicitly:

- `active` is eligible for adapter emission;
- `inactive`, `pending`, and `deprecated` remain visible for governance and are
  not emitted.

The compiler validates the complete canonical registry before writing
`.agents/hooks/registry.yaml`. Schema v1 inputs remain supported only at the
compatibility boundary; an omitted legacy status is normalized to `active`
before adapters receive it.
