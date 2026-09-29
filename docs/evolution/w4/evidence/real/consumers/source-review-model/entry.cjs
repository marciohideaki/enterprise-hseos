'use strict';

const source = 'module.exports = (n) => n + 1;\n';

function respond(input) {
  if (!Array.isArray(input?.messages) || !Array.isArray(input?.tools)) throw new Error('model request is invalid');
  const hasAuditTool = input.tools.some((tool) => tool.name === 'source.audit');
  if (!hasAuditTool) throw new Error('source audit tool is required');
  const toolMessages = input.messages.filter((message) => message.role === 'tool');
  if (toolMessages.length === 0) {
    return {
      text: '',
      tool_calls: [{ tool_call_id: 'call:source-audit', name: 'source.audit', input: { text: source } }],
    };
  }
  const latest = toolMessages.at(-1);
  if (!latest.content.includes('sha256')) throw new Error('source audit result is missing');
  return { text: 'Source review completed after governed audit.', tool_calls: [] };
}

function execute({ method, input }) {
  if (method === 'conformance') {
    const proposed = respond({ messages: [{ role: 'user', content: 'audit source' }], tools: [{ name: 'source.audit' }] });
    const completed = respond({ messages: [{ role: 'tool', content: '{"sha256":"sample"}' }], tools: [{ name: 'source.audit' }] });
    return { passed: proposed.tool_calls.length === 1 && completed.tool_calls.length === 0 };
  }
  return respond(input);
}

module.exports = execute;
