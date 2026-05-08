'use strict';

const ADR_TRIGGERS = {
  architectural: { required: true, reason: 'Architectural changes mandate an ADR per §5.2' },
  breaking: { required: true, reason: 'Breaking changes (API, contract, event schema) mandate an ADR per §5.2' },
  security: { required: true, reason: 'Security posture changes mandate an ADR per §5.2' },
  performance: { required: true, reason: 'Performance-affecting changes mandate an ADR per §5.2' },
  governance: { required: true, reason: 'Governance/standards modifications mandate an ADR per §5.2' },
  exception: { required: true, reason: 'Exceptions to any standard mandate an ADR per §5.2' },
};

module.exports = [
  {
    name: 'validate_adr',
    description: 'Check whether a change kind requires an ADR per governance rules',
    inputSchema: {
      type: 'object',
      properties: {
        change_kind: {
          type: 'string',
          description: 'Type of change: architectural, breaking, security, performance, governance, exception, or other',
        },
      },
      required: ['change_kind'],
    },
    handler(_db, args) {
      const kind = (args.change_kind || '').toLowerCase();
      const match = ADR_TRIGGERS[kind];
      if (match) return { change_kind: kind, ...match };
      // Fuzzy: check if any trigger key is a substring
      for (const [key, val] of Object.entries(ADR_TRIGGERS)) {
        if (kind.includes(key)) return { change_kind: kind, ...val };
      }
      return {
        change_kind: kind,
        required: false,
        reason: `No ADR trigger matched for change_kind="${kind}". Review §5.2 manually if unsure.`,
      };
    },
  },
];
