'use strict';

class ControlClient {
  constructor({ url, credential, fetchImpl = fetch }) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'http:' ||
      parsed.hostname !== '127.0.0.1' ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    )
      throw new Error('Control SDK requires a loopback endpoint');
    if (typeof credential !== 'string' || credential.length < 32) throw new Error('Control SDK requires a credential');
    this.url = parsed.origin;
    // Private closure prevents credential inclusion in object serialization.
    this.request = async (route, body) => {
      const response = await fetchImpl(this.url + route, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const value = await response.json();
      if (!response.ok) {
        const error = new Error(value.error || 'CONTROL_REQUEST_FAILED');
        error.code = value.error;
        throw error;
      }
      return value;
    };
  }
  terminal(command) {
    return this.request('/v1/terminals/commands', command);
  }
  terminalQuery(resourceId) {
    if (!/^[a-f0-9-]{36}$/.test(resourceId)) throw new Error('Invalid terminal query');
    return this.request(`/v1/terminals/${resourceId}`);
  }
  terminalEvents(resourceId, { after = 0, limit = 100 } = {}) {
    if (
      !/^[a-f0-9-]{36}$/.test(resourceId) ||
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 1000
    )
      throw new Error('Invalid terminal cursor');
    return this.request(`/v1/terminals/${resourceId}/events?after=${after}&limit=${limit}`);
  }
  prepare(contract) {
    return this.request('/v1/prepare', contract);
  }
  execute(command) {
    return this.request('/v1/commands', command);
  }
  query(resourceId, view = 'status') {
    if (!/^[a-f0-9-]{36}$/.test(resourceId) || !['status', 'evidence', 'review', 'session'].includes(view))
      throw new Error('Invalid control query');
    return this.request(`/v1/tasks/${resourceId}${view === 'status' ? '' : '/' + view}`);
  }
  events(resourceId, { after = 0, limit = 100 } = {}) {
    if (
      !/^[a-f0-9-]{36}$/.test(resourceId) ||
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 1000
    )
      throw new Error('Invalid event cursor');
    return this.request(`/v1/tasks/${resourceId}/events?after=${after}&limit=${limit}`);
  }
}

module.exports = { ControlClient };
