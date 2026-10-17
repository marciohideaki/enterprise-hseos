'use strict';

const { IdentifierSchema, ReferenceSchema, TimestampSchema, boundedString, deepFreeze, strictObject, z } = require('./common');
const { ModelRequestSchema } = require('./agent-contracts');

const CONTEXT_ASSEMBLY_CONTRACT_V2 = 'hseos.context/v2';
const CONTEXT_SOURCE_CONTRACT_V2 = 'hseos.context-source/v2';
const MEDIA_SOURCE_CONTRACT_V1 = 'hseos.media-source/v1';

const AUTHORITY_LEVELS = deepFreeze(['directive', 'operator', 'data']);
// Order is lowest to highest; a transformation can only keep or lower the rank (never arithmetic, never "higher wins").
const AUTHORITY_RANK = deepFreeze({ data: 0, operator: 1, directive: 2 });
const SOURCE_ORIGINS = deepFreeze([
  'config',
  'operator',
  'memory',
  'tool',
  'plugin',
  'lsp',
  'dap',
  'browser',
  'display',
  'mcp',
  'campaign',
]);
const DIRECTIVE_ORIGINS = deepFreeze(['config', 'operator']);
const UNTRUSTED_ORIGINS = deepFreeze(['tool', 'plugin', 'lsp', 'dap', 'browser', 'display', 'mcp']);
const MEDIA_TYPES = deepFreeze(['image/png', 'image/jpeg', 'image/webp']);

const MAX_MEDIA_ITEM_BYTES = 5_242_880;
const MAX_MEDIA_ASSEMBLY_BYTES = 16_777_216;
const MAX_MEDIA_ITEMS = 8;
const MAX_MEDIA_DIMENSION = 16_384;

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const AuthoritySchema = z.enum(AUTHORITY_LEVELS);
const SourceOriginSchema = z.enum(SOURCE_ORIGINS);
const TrustSchema = z.enum(['trusted', 'untrusted']);
const TransformSchema = strictObject({
  id: IdentifierSchema,
  version: z.string().min(1).max(64),
  input_digest: Sha256Schema,
});
const ProvenanceSchema = strictObject({
  origin: SourceOriginSchema,
  source_ref: ReferenceSchema,
  digest: Sha256Schema,
  retrieved_at: TimestampSchema,
  trust: TrustSchema,
  transform: z.array(TransformSchema).max(16),
});

const ArtifactRefSchema = z.string().regex(/^artifact:\/\/sha256\/[0-9a-f]{64}$/u);
const MediaTypeSchema = z.enum(MEDIA_TYPES);
const MediaDimensionSchema = z.number().int().positive().max(MAX_MEDIA_DIMENSION);

const MediaDescriptorShape = {
  source_ref: ReferenceSchema,
  media_type: MediaTypeSchema,
  digest: Sha256Schema,
  bytes: z.number().int().positive(),
  width: MediaDimensionSchema,
  height: MediaDimensionSchema,
  origin: SourceOriginSchema,
  authority: z.literal('data'),
  trust: z.literal('untrusted'),
  transform: z.array(TransformSchema).max(16),
  priority: z.number().int().min(0).max(100),
  artifact_ref: ArtifactRefSchema,
};
const MediaSourceSchema = strictObject(MediaDescriptorShape).superRefine((media, context) => {
  if (media.artifact_ref !== `artifact://sha256/${media.digest}`) {
    context.addIssue({ code: 'custom', path: ['artifact_ref'], message: 'artifact reference must be derived from the digest' });
  }
});

const TextPartSchema = strictObject({ type: z.literal('text'), text: boundedString(1_048_576) });
const ImagePartSchema = strictObject({
  type: z.literal('image'),
  source_ref: ReferenceSchema,
  media_type: MediaTypeSchema,
  digest: Sha256Schema,
  bytes: z.number().int().positive().max(MAX_MEDIA_ITEM_BYTES),
  artifact_ref: ArtifactRefSchema,
});
const ContentPartSchema = z.discriminatedUnion('type', [TextPartSchema, ImagePartSchema]);

const ContextSourceRecordSchema = strictObject({
  source_ref: ReferenceSchema,
  authority: AuthoritySchema,
  origin: SourceOriginSchema,
  digest: Sha256Schema,
  trust: TrustSchema,
  media_type: MediaTypeSchema.optional(),
  bytes: z.number().int().positive().optional(),
  artifact_ref: ArtifactRefSchema.optional(),
});

// v1 requests stay valid byte for byte: `parts` is aditive and absent unless media is attached.
const ModelRequestV2Schema = ModelRequestSchema.extend({
  parts: z.array(ContentPartSchema).min(1).max(MAX_MEDIA_ITEMS).optional(),
});

function minAuthority(authorities) {
  if (!Array.isArray(authorities) || authorities.length === 0) return 'data';
  return authorities.reduce((lowest, current) => (AUTHORITY_RANK[current] < AUTHORITY_RANK[lowest] ? current : lowest));
}

module.exports = {
  AUTHORITY_LEVELS,
  AUTHORITY_RANK,
  ArtifactRefSchema,
  AuthoritySchema,
  CONTEXT_ASSEMBLY_CONTRACT_V2,
  CONTEXT_SOURCE_CONTRACT_V2,
  ContentPartSchema,
  ContextSourceRecordSchema,
  DIRECTIVE_ORIGINS,
  ImagePartSchema,
  MAX_MEDIA_ASSEMBLY_BYTES,
  MAX_MEDIA_DIMENSION,
  MAX_MEDIA_ITEMS,
  MAX_MEDIA_ITEM_BYTES,
  MEDIA_SOURCE_CONTRACT_V1,
  MEDIA_TYPES,
  MediaSourceSchema,
  ModelRequestV2Schema,
  ProvenanceSchema,
  SOURCE_ORIGINS,
  Sha256Schema,
  TextPartSchema,
  TransformSchema,
  TrustSchema,
  UNTRUSTED_ORIGINS,
  minAuthority,
};
