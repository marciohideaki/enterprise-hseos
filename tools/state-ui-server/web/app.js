/* global document, requestAnimationFrame, EventSource */
/* HSEOS Kanban — vanilla JS, SSE-driven. */

(function () {
  const conn = document.querySelector('#conn');
  const metaText = document.querySelector('#meta-text');
  const lastUpdate = document.querySelector('#last-update');
  const dbMeta = document.querySelector('#db-meta');
  const colCards = {
    pending: document.querySelector('[data-col="pending"] .cards'),
    running: document.querySelector('[data-col="running"] .cards'),
    completed: document.querySelector('[data-col="completed"] .cards'),
    aborted: document.querySelector('[data-col="aborted"] .cards'),
    orphaned: document.querySelector('[data-col="orphaned"] .cards'),
  };
  const colCounts = {
    pending: document.querySelector('[data-count="pending"]'),
    running: document.querySelector('[data-count="running"]'),
    completed: document.querySelector('[data-count="completed"]'),
    aborted: document.querySelector('[data-count="aborted"]'),
    orphaned: document.querySelector('[data-count="orphaned"]'),
  };

  let pendingFrame = null;
  let lastState = null;

  function setConn(state) {
    conn.classList.remove('dot-connected', 'dot-disconnected', 'dot-stale');
    if (state === 'connected') {
      conn.classList.add('dot-connected');
      metaText.textContent = 'live';
    } else if (state === 'stale') {
      conn.classList.add('dot-stale');
      metaText.textContent = 'reconnecting…';
    } else {
      conn.classList.add('dot-disconnected');
      metaText.textContent = 'offline';
    }
  }

  function ageSeconds(iso) {
    if (!iso) return null;
    const then = new Date(iso.replace(' ', 'T') + 'Z').getTime();
    if (!Number.isFinite(then)) return null;
    return Math.round((Date.now() - then) / 1000);
  }

  function fmtAge(seconds) {
    if (seconds == null) return '—';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h`;
  }

  function classifyAgentRun(ar, orphanSet) {
    if (orphanSet.has(ar.id)) return 'orphaned';
    if (ar.status === 'running') return 'running';
    if (ar.status === 'completed') return 'completed';
    if (ar.status === 'aborted' || ar.status === 'killed') return 'aborted';
    return null;
  }

  function classifyTask(t) {
    if (t.status === 'PENDING_G2' || t.status === 'PENDING_EXECUTION') return 'pending';
    if (t.status === 'IN_PROGRESS') return null; // already represented via agent_run
    if (t.status === 'OK') return null;
    if (t.status === 'BLOCKED' || t.status === 'FAILED') return 'aborted';
    return null;
  }

  function makeCard(kind, item, projectsMeta) {
    const el = document.createElement('div');
    el.className = `card card-${kind}`;
    const meta = projectsMeta && item.project_id ? projectsMeta.find((p) => p.id === item.project_id) : null;
    if (meta?.color) el.style.borderLeftColor = meta.color;
    const projectBadge = meta
      ? `<span class="card-project" style="color:${meta.color}">${escapeHtml(meta.label || meta.id)}</span>`
      : '';
    if (kind === 'pending' || kind === 'aborted') {
      // task card
      el.innerHTML = `
        <div class="card-head">
          <span class="card-id">${escapeHtml(item.id)}</span>
          <span class="card-tier">${escapeHtml(item.model_tier || '-')}</span>
        </div>
        <div class="card-meta">${projectBadge}wave=${item.wave ?? '?'} · ${escapeHtml(item.run_id)}</div>
        ${item.goal ? `<div class="card-goal">${escapeHtml(item.goal)}</div>` : ''}
      `;
      return el;
    }
    // agent_run card
    const age = ageSeconds(item.last_heartbeat_at);
    const ageClass = age == null ? 'age-none' : age < 60 ? 'age-fresh' : age < 300 ? 'age-warm' : 'age-stale';
    el.innerHTML = `
      <div class="card-head">
        <span class="card-id">#${item.id} ${escapeHtml(item.agent_name)}</span>
        <span class="card-hb ${ageClass}">${age == null ? '—' : '♥ ' + fmtAge(age)}</span>
      </div>
      <div class="card-meta">${projectBadge}${escapeHtml(item.task_id || '-')} · ${escapeHtml(item.run_id)}</div>
      ${item.exit_reason ? `<div class="card-goal">${escapeHtml(item.exit_reason)}</div>` : ''}
    `;
    return el;
  }

  function escapeHtml(s) {
    return String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  }

  // localStorage-persisted project filter
  const STORAGE_KEY_PROJECT = 'hseos_kanban_filter_project';
  const persistedProject = (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY_PROJECT)) || '';

  function applyProjectFilter(state) {
    const selectedProject = persistedProject;
    if (!selectedProject) return state;
    return {
      ...state,
      tasks: (state.tasks || []).filter((t) => !t.project_id || t.project_id === selectedProject),
      agentRuns: (state.agentRuns || []).filter((a) => !a.project_id || a.project_id === selectedProject),
      events: (state.events || []).filter((e) => !e.project_id || e.project_id === selectedProject),
      orphans: (state.orphans || []).map((o) => (typeof o === 'object' ? o.agent_run_id : o)),
    };
  }

  function render(rawState) {
    const state = applyProjectFilter(rawState);
    const orphanSet = new Set(
      (rawState.orphans || []).map((o) => (typeof o === 'object' ? o.agent_run_id : o))
    );
    const projectsMeta = rawState.projects_meta || null;
    const buckets = { pending: [], running: [], completed: [], aborted: [], orphaned: [] };

    for (const t of state.tasks || []) {
      const k = classifyTask(t);
      if (k) buckets[k].push(t);
    }
    for (const ar of state.agentRuns || []) {
      const k = classifyAgentRun(ar, orphanSet);
      if (k) buckets[k].push(ar);
    }

    for (const k of Object.keys(buckets)) {
      const frag = document.createDocumentFragment();
      for (const item of buckets[k]) frag.append(makeCard(k, item, projectsMeta));
      colCards[k].replaceChildren(frag);
      colCounts[k].textContent = state.counts?.[k] ?? buckets[k].length;
    }

    lastUpdate.textContent = new Date(state.ts).toLocaleTimeString();
    const projInfo = projectsMeta
      ? ` · ${projectsMeta.length} project(s)`
      : '';
    dbMeta.textContent = `${state.runs?.length || 0} runs · ${state.events?.length || 0} events · stale>${state.stale_minutes}m${projInfo}`;

    // Render project filter dropdown if multi-project mode
    if (projectsMeta && projectsMeta.length > 0) {
      ensureProjectFilterUI(projectsMeta);
    }
  }

  function ensureProjectFilterUI(projectsMeta) {
    let select = document.querySelector('#project-filter');
    if (!select) {
      const meta = document.querySelector('.meta');
      if (!meta) return;
      select = document.createElement('select');
      select.id = 'project-filter';
      select.style.cssText = 'background:#11161f;color:#c5d3e6;border:1px solid #1f2a38;border-radius:4px;padding:0.25rem 0.5rem;margin-right:0.5rem;font-family:ui-monospace,monospace;font-size:0.78rem;';
      meta.prepend(select);
      select.addEventListener('change', () => {
        const v = select.value;
        if (typeof localStorage !== 'undefined') {
          if (v) localStorage.setItem(STORAGE_KEY_PROJECT, v);
          else localStorage.removeItem(STORAGE_KEY_PROJECT);
        }
        // Force re-render with last state
        if (lastState) render(lastState);
      });
    }
    const current = select.value;
    const desired = (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY_PROJECT)) || '';
    const opts = ['<option value="">all projects</option>'];
    for (const p of projectsMeta) {
      const sel = p.id === desired ? ' selected' : '';
      opts.push(`<option value="${escapeHtml(p.id)}"${sel}>${escapeHtml(p.label || p.id)}</option>`);
    }
    if (select.innerHTML !== opts.join('')) {
      select.innerHTML = opts.join('');
      if (current) select.value = current;
    }
  }

  function scheduleRender(state) {
    lastState = state;
    if (pendingFrame) return;
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      render(lastState);
    });
  }

  // eslint-disable-next-line n/no-unsupported-features/node-builtins -- runs in the browser
  const es = new EventSource('/events');
  es.addEventListener('open', () => setConn('connected'));
  es.addEventListener('error', () => setConn('stale'));
  es.addEventListener('message', (ev) => {
    try {
      const state = JSON.parse(ev.data);
      scheduleRender(state);
    } catch (error) {
      console.error('[kanban] bad SSE payload', error);
    }
  });
  es.addEventListener('bye', () => {
    setConn('disconnected');
    es.close();
  });
})();
