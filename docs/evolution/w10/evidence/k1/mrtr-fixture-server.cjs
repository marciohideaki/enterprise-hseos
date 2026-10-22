'use strict';

// Minimal stdio MCP server built on the production 2026-07-28 adapter with ONE tool that requires approval,
// so a real client can be observed against the MRTR (input_required) round trip. The governance/swarm/project-state
// servers expose no approval-required tool in fixture mode, which is why this fixture exists.
const path = require('node:path');

const root = path.resolve(__dirname, '../../../../..');
const { Mcp2026Adapter, createMcpApprovalStateCodec, startMcp2026Stdio } = require(path.join(root, 'tools/lib/mcp-2026-adapter'));
const { deterministicOperationId } = require(path.join(root, 'tools/lib/governed-execution/runtime'));

const POLICY = 'k1-policy-v1';
const approvedOperations = new Set();

const adapter = new Mcp2026Adapter({
  serverInfo: { name: 'k1-mrtr-fixture', version: '1.0.0' },
  tools: [
    {
      name: 'approval_echo',
      description: 'Echo a string after an explicit human approval (MRTR fixture)',
      inputSchema: {
        type: 'object',
        properties: { value: { type: 'string', maxLength: 40 } },
        required: ['value'],
        additionalProperties: false,
      },
    },
  ],
  execute: async (request) => {
    const operationId = deterministicOperationId(request.tool, request.idempotency_key);
    if (!request.approval_context) {
      return {
        schema_version: 1,
        ok: false,
        data: null,
        error: { code: 'EXECUTION_APPROVAL_REQUIRED', message: 'approval required', operation_id: operationId, retryable: false },
        evidence: [],
        warnings: [],
      };
    }
    approvedOperations.add(operationId);
    return {
      schema_version: 1,
      ok: true,
      data: { operation_id: operationId, result: { echoed: request.input.value }, replayed: false },
      error: null,
      evidence: [],
      warnings: [],
    };
  },
  resolveActor: async () => ({ id: 'k1-actor', type: 'human' }),
  resolveResourceScope: async ({ tool }) => ({ project: 'k1', tool }),
  approvalStateCodec: createMcpApprovalStateCodec({ key: '0123456789abcdef0123456789abcdef' }),
  approvalFlow: {
    async begin({ outcome }) {
      return {
        state: { operation_id: outcome.error.operation_id, policy_version: POLICY },
        inputRequests: {
          confirm: {
            method: 'elicitation/create',
            params: {
              mode: 'form',
              message: `Approve governed execution ${outcome.error.operation_id}?`,
              requestedSchema: {
                type: 'object',
                properties: { approved: { type: 'boolean' } },
                required: ['approved'],
                additionalProperties: false,
              },
            },
          },
        },
      };
    },
    async resolve({ inputResponses }) {
      const confirmation = inputResponses && inputResponses.confirm;
      if (!confirmation || confirmation.action !== 'accept' || !confirmation.content || confirmation.content.approved !== true) {
        const error = new Error('Governed execution was not explicitly approved');
        error.code = 'EXECUTION_APPROVAL_DENIED';
        throw error;
      }
      return { approval_id: 'k1-approval', policy_version: POLICY };
    },
  },
});

startMcp2026Stdio(adapter);
