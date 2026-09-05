'use strict';

/* global document */
/* eslint-disable n/no-unsupported-features/node-builtins -- this file executes in the browser */

const state = { schemas: null, draftId: null, csrfToken: null };
const byId = (id) => document.querySelector(`#${id}`);
const STATE_CHANGING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

async function api(path, options = {}) {
  const token = byId('access-token')?.value;
  const method = (options.method || 'GET').toUpperCase();
  const headers = {
    ...(options.body ? { 'content-type': 'application/json' } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    // Only echoed on state-changing calls: a shared-network admin session's CSRF token is bound
    // to the admin bearer credential, and is only ever required where design.md's browser
    // boundary requires it. Nothing before the first authenticated response has a value to send.
    ...(STATE_CHANGING_METHODS.has(method) && state.csrfToken ? { 'x-hseos-csrf-token': state.csrfToken } : {}),
  };
  const response = await fetch(path, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  const csrfToken = response.headers.get('x-hseos-csrf-token');
  if (csrfToken) state.csrfToken = csrfToken;
  const envelope = await response.json();
  if (!response.ok || !envelope.ok) throw new Error(envelope.error?.message || 'Control-plane request failed');
  return envelope.data;
}

function text(node, value) {
  node.textContent = String(value ?? '—');
}

function showError(error) {
  const summary = byId('form-errors');
  summary.hidden = false;
  text(summary, error.message || 'The request could not be completed. Check the fields and try again.');
  summary.focus();
}

function renderFields(type) {
  const container = byId('schema-fields');
  container.replaceChildren();
  for (const field of state.schemas.authoring_types[type].fields) {
    const label = document.createElement('label');
    label.htmlFor = `field-${field.name}`;
    text(label, field.label);
    let control;
    if (field.type === 'select') {
      control = document.createElement('select');
      for (const value of field.options) {
        const option = document.createElement('option');
        option.value = value;
        text(option, value.replaceAll('_', ' '));
        control.append(option);
      }
    } else if (field.type === 'textarea') {
      control = document.createElement('textarea');
      control.rows = 5;
    } else {
      control = document.createElement('input');
      control.type = field.type;
    }
    control.id = `field-${field.name}`;
    control.name = field.name;
    control.required = Boolean(field.required);
    if (field.max_length) control.maxLength = field.max_length;
    if (field.min !== undefined) control.min = field.min;
    if (field.max !== undefined) control.max = field.max;
    container.append(label, control);
  }
}

async function loadSchemas() {
  const response = await fetch('/ui-schemas.json');
  state.schemas = await response.json();
  if (state.schemas.schema_version !== 1) throw new Error('Unsupported authoring schema');
  const selector = byId('authoring-type');
  for (const [value, schema] of Object.entries(state.schemas.authoring_types)) {
    const option = document.createElement('option');
    option.value = value;
    text(option, schema.label);
    selector.append(option);
  }
  renderFields(selector.value);
  selector.addEventListener('change', () => renderFields(selector.value));
}

async function loadHealth() {
  try {
    const health = await api('/health');
    text(byId('health-label'), health.ready ? 'Control plane ready' : 'Control plane needs configuration');
    text(byId('catalog-state'), health.migration?.state || 'Unknown');
    text(byId('projection-state'), health.projection?.state || 'Unknown');
    document.querySelector('.health-dot').style.background = health.ready ? 'var(--ok)' : 'var(--attention)';
  } catch (error) {
    text(byId('health-label'), error.message);
    document.querySelector('.health-dot').style.background = 'var(--danger)';
  }
}

async function loadArtifacts() {
  const status = byId('artifact-status');
  text(status, 'Loading artifacts…');
  try {
    const result = await api('/api/v1/artifacts?limit=50');
    const items = Array.isArray(result) ? result : result.items || [];
    const list = byId('artifact-list');
    list.replaceChildren();
    for (const item of items) {
      const article = document.createElement('article');
      article.className = 'artifact';
      const title = document.createElement('h3');
      const detail = document.createElement('small');
      text(title, item.title || item.slug || item.artifact_id);
      text(detail, `${item.artifact_type || 'artifact'} · ${item.lifecycle_status || 'current'}`);
      article.append(title, detail);
      list.append(article);
    }
    text(status, items.length > 0 ? `${items.length} artifacts loaded.` : 'No artifacts yet. Import the canonical catalog to begin.');
  } catch (error) {
    text(status, `${error.message}. Check sidecar readiness and refresh.`);
  }
}

byId('draft-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  byId('form-errors').hidden = true;
  if (!event.currentTarget.reportValidity()) return;
  const data = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const draft = await api('/api/v1/drafts', { method: 'POST', body: { artifact_type: data.artifact_type, content: data } });
    state.draftId = draft.draft_id || draft.id;
    byId('prepare-review').disabled = !state.draftId;
  } catch (error) {
    showError(error);
  }
});

byId('prepare-review').addEventListener('click', async () => {
  try {
    await api(`/api/v1/drafts/${encodeURIComponent(state.draftId)}/publication-request`, { method: 'POST', body: {} });
    text(byId('artifact-status'), 'Review package prepared. Publication still requires the governed Git workflow.');
  } catch (error) {
    showError(error);
  }
});

byId('run-simulation').addEventListener('click', async () => {
  try {
    const context = JSON.parse(byId('simulation-context').value);
    const decision = await api('/api/v1/policy/evaluate', { method: 'POST', body: context });
    text(byId('decision-label'), decision.decision || decision.effect || 'Decision returned');
    text(byId('decision-detail'), decision.explanation || 'See the selected policy evidence in the response.');
  } catch (error) {
    text(byId('decision-label'), 'Simulation failed');
    text(byId('decision-detail'), error.message);
  }
});

byId('load-audit').addEventListener('click', async () => {
  try {
    const result = await api('/api/v1/audit?limit=50');
    text(byId('audit-list'), JSON.stringify(result, null, 2));
  } catch (error) {
    text(byId('audit-list'), `${error.message}. Provide a valid session token.`);
  }
});

byId('refresh-artifacts').addEventListener('click', loadArtifacts);
Promise.all([loadSchemas(), loadHealth(), loadArtifacts()]).catch(showError);
