'use strict';

/**
 * Kanban web client (tools/state-ui-server/web/app.js) HTML-escaping tests.
 *
 * Runs the real browser script inside a node:vm sandbox with a minimal fake DOM
 * (no browser, no network, no SQLite) and inspects the HTML strings it assigns.
 * Evidence is string-level: the markup is tokenised and checked for injected
 * tags/attributes; a real browser remains the final judge of XSS.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const APP_PATH = path.join(__dirname, '..', 'tools', 'state-ui-server', 'web', 'app.js');
const APP_SOURCE = fs.readFileSync(APP_PATH, 'utf8');
const COLUMNS = ['pending', 'running', 'completed', 'aborted', 'orphaned'];

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.className = '';
    this.id = '';
    this.value = '';
    this.innerHTML = '';
    this.textContent = '';
    this.children = [];
    this.style = {};
    this.listeners = {};
    const classes = new Set();
    this.classList = {
      add: (...names) => {
        for (const name of names) classes.add(name);
      },
      remove: (...names) => {
        for (const name of names) classes.delete(name);
      },
    };
  }

  // Only what app.js asks for: the project badge it colours through the CSSOM (no inline style attribute).
  querySelector(selector) {
    if (selector !== '.card-project' || !/<span class="card-project"/.test(this.innerHTML)) return null;
    this.badge ??= new FakeElement('span');
    return this.badge;
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = nodes.flatMap((node) => (node.tagName === '#fragment' ? node.children : [node]));
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }
}

function createSandbox({ storedProject = '' } = {}) {
  const registry = new Map();
  const frames = [];
  const sources = [];
  const lookup = (selector) => {
    if (selector === '#project-filter' && !registry.has(selector)) return null;
    if (!registry.has(selector)) registry.set(selector, new FakeElement('div'));
    return registry.get(selector);
  };
  const meta = lookup('.meta');
  meta.prepend = (node) => registry.set(`#${node.id}`, node);
  const document = {
    querySelector: lookup,
    createElement: (tag) => new FakeElement(tag),
    createDocumentFragment: () => new FakeElement('#fragment'),
  };
  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.listeners = {};
      sources.push(this);
    }
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    }
    close() {}
  }
  const context = {
    document,
    EventSource: FakeEventSource,
    requestAnimationFrame: (callback) => frames.push(callback),
    localStorage: { getItem: () => storedProject, setItem() {}, removeItem() {} },
    console,
    Date,
    Set,
    Number,
    String,
    JSON,
    Math,
  };
  vm.runInNewContext(APP_SOURCE, context, { filename: APP_PATH });
  return {
    registry,
    render(state) {
      sources[0].listeners.message({ data: JSON.stringify(state) });
      while (frames.length > 0) frames.shift()();
      return {
        cards: Object.fromEntries(COLUMNS.map((column) => [column, lookup(`[data-col="${column}"] .cards`).children])),
        counts: Object.fromEntries(COLUMNS.map((column) => [column, lookup(`[data-count="${column}"]`).textContent])),
        select: registry.get('#project-filter') || null,
      };
    },
  };
}

function baseState(overrides = {}) {
  return {
    ts: '2026-01-01T00:00:00.000Z',
    stale_minutes: 5,
    runs: [],
    events: [],
    orphans: [],
    tasks: [],
    agentRuns: [],
    ...overrides,
  };
}

const ATTRIBUTE = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const TAG = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

/** Minimal HTML tokeniser: returns opening tags with their attribute names/values. */
function tokenize(html) {
  const tags = [];
  for (const match of html.matchAll(TAG)) {
    if (match[1] === '/') continue;
    const attributes = [];
    for (const attribute of match[3].matchAll(ATTRIBUTE)) {
      attributes.push({ name: attribute[1], value: attribute[2] ?? attribute[3] ?? attribute[4] ?? null });
    }
    tags.push({ tag: match[2].toLowerCase(), attributes });
  }
  return tags;
}

function decode(text) {
  return text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&');
}

function attributeNames(tags, tagName) {
  return tags.filter((entry) => entry.tag === tagName).flatMap((entry) => entry.attributes.map((a) => a.name));
}

function onlyTags(html, allowed) {
  return [...new Set(tokenize(html).map((entry) => entry.tag))].filter((tag) => !allowed.includes(tag));
}

function stylePayload(card) {
  return [card.innerHTML, card.style.color, card.style.cssText, card.badge?.style.color, card.badge?.style.cssText]
    .filter(Boolean)
    .join('\n');
}

/**
 * Styles applied to the badge of a card: any style attribute in the markup (there must be none, the CSP forbids
 * inline styles) plus the colour set through the CSSOM, reported as `color:<value>`.
 */
function badgeStyles(card) {
  const inMarkup = tokenize(card.innerHTML)
    .filter((entry) => entry.tag === 'span' && entry.attributes.some((a) => a.name === 'class' && a.value === 'card-project'))
    .flatMap((entry) => entry.attributes.filter((a) => a.name === 'style').map((a) => a.value));
  assert.deepEqual(inMarkup, [], 'the badge markup carries no inline style attribute');
  return card.badge?.style.color ? [`color:${card.badge.style.color}`] : [];
}

const MALICIOUS_ID = 'x" onfocus="alert(1)" autofocus="';
const MALICIOUS_COLOR = 'red;background:url(x)';
const MALICIOUS_WAVE = '<img src=x onerror=1>';

function projectsMeta(overrides = {}) {
  return [{ id: 'p1', label: 'Project One', color: '#00d3ff', ...overrides }];
}

function taskState(taskOverrides = {}, meta = projectsMeta()) {
  return baseState({
    projects_meta: meta,
    tasks: [
      {
        id: 'T-1',
        run_id: 'run-1',
        status: 'PENDING_EXECUTION',
        model_tier: 'sonnet',
        wave: 2,
        goal: 'ship it',
        project_id: 'p1',
        ...taskOverrides,
      },
    ],
  });
}

test('harness tokeniser detects an injected attribute and an injected tag', () => {
  const injected = tokenize('<option value="x" onfocus="alert(1)" autofocus="">L</option>');
  assert.deepEqual(attributeNames(injected, 'option'), ['value', 'onfocus', 'autofocus']);
  assert.deepEqual(onlyTags('wave=<img src=x onerror=1> <b>1', ['div', 'span']), ['img', 'b']);
  assert.deepEqual(attributeNames(tokenize('<option value="x&quot; onfocus=&quot;y">L</option>'), 'option'), ['value']);
});

test('control: harness loads the real app.js and renders cards, counts and the filter', () => {
  const sandbox = createSandbox();
  const view = sandbox.render(taskState({}, projectsMeta()));
  assert.equal(view.cards.pending.length, 1);
  assert.equal(String(view.counts.pending), '1');
  assert.equal(view.cards.running.length, 0);
  assert.equal(view.select.tagName, 'select');
  assert.equal(view.select.innerHTML, '<option value="">all projects</option><option value="p1">Project One</option>');
});

test('control: benign task and agent cards render byte-identical markup', () => {
  const sandbox = createSandbox();
  const view = sandbox.render(
    baseState({
      tasks: [{ id: 'T-1', run_id: 'run-1', status: 'PENDING_EXECUTION', model_tier: 'sonnet', wave: 2, goal: 'a & b' }],
      agentRuns: [{ id: 12, agent_name: 'agent', run_id: 'run-1', task_id: 'T-1', status: 'running', last_heartbeat_at: null }],
    }),
  );
  assert.equal(
    view.cards.pending[0].innerHTML,
    '\n        <div class="card-head">\n          <span class="card-id">T-1</span>\n          <span class="card-tier">sonnet</span>\n        </div>\n        <div class="card-meta">wave=2 · run-1</div>\n        <div class="card-goal">a &amp; b</div>\n      ',
  );
  assert.equal(
    view.cards.running[0].innerHTML,
    '\n      <div class="card-head">\n        <span class="card-id">#12 agent</span>\n        <span class="card-hb age-none">—</span>\n      </div>\n      <div class="card-meta">T-1 · run-1</div>\n      \n    ',
  );
});

test('control: a valid #rrggbb project color stays applied to border and badge', () => {
  const view = createSandbox().render(taskState());
  const [card] = view.cards.pending;
  assert.equal(card.style.borderLeftColor, '#00d3ff');
  assert.deepEqual(badgeStyles(card), ['color:#00d3ff']);
  assert.match(card.innerHTML, /Project One/);
});

test('colour pattern: 3, 4 and 8 digit hexadecimal values, in either case, stay applied', () => {
  for (const color of ['#fff', '#FFF', '#abcd', '#ABCDEF12', '#00D3ff']) {
    const [card] = createSandbox().render(taskState({}, projectsMeta({ color }))).cards.pending;
    assert.equal(card.style.borderLeftColor, color, `border for ${color}`);
    assert.deepEqual(badgeStyles(card), [`color:${color}`], `badge for ${color}`);
  }
});

test('colour pattern: out-of-range, unanchored and padded values are dropped from border and badge', () => {
  const invalid = ['#ff', '#123456789', 'fff', 'x#fff', 'a#ffffff', ' #fff', '#fff ', '#fff\n', '#fff\r', '#ffg', '#', '', 'red', 42, null];
  for (const color of invalid) {
    const [card] = createSandbox().render(taskState({}, projectsMeta({ color }))).cards.pending;
    assert.ok(!card.style.borderLeftColor, `border kept for ${JSON.stringify(color)}`);
    assert.deepEqual(badgeStyles(card), [], `badge style kept for ${JSON.stringify(color)}`);
    assert.match(card.innerHTML, /Project One/, 'the badge keeps its label');
  }
});

test('control: project filter still narrows cards by stored project', () => {
  const state = baseState({
    projects_meta: projectsMeta(),
    tasks: [
      { id: 'T-1', run_id: 'r', status: 'PENDING_EXECUTION', project_id: 'p1' },
      { id: 'T-2', run_id: 'r', status: 'PENDING_EXECUTION', project_id: 'p2' },
    ],
  });
  assert.equal(createSandbox({ storedProject: 'p1' }).render(state).cards.pending.length, 1);
  assert.equal(createSandbox().render(state).cards.pending.length, 2);
});

test('control: null, numeric and empty values do not throw and are not echoed as markup', () => {
  const view = createSandbox().render(
    baseState({
      tasks: [{ id: '', run_id: null, status: 'BLOCKED', wave: null, goal: null, model_tier: null }],
      agentRuns: [{ id: 0, agent_name: null, run_id: 7, task_id: null, status: 'completed' }],
    }),
  );
  assert.match(view.cards.aborted[0].innerHTML, /wave=\?/);
  assert.equal(view.cards.completed.length, 1);
  assert.deepEqual(onlyTags(view.cards.aborted[0].innerHTML, ['div', 'span']), []);
});

test('P1: a quote-bearing project id cannot add attributes to the filter option', () => {
  const view = createSandbox().render(taskState({}, projectsMeta({ id: MALICIOUS_ID, label: 'L' })));
  const options = tokenize(view.select.innerHTML).filter((entry) => entry.tag === 'option');
  assert.equal(options.length, 2);
  for (const option of options) {
    const names = option.attributes.map((attribute) => attribute.name).filter((name) => name !== 'selected');
    assert.deepEqual(names, ['value'], `unexpected option attributes: ${view.select.innerHTML}`);
  }
  assert.equal(decode(options[1].attributes[0].value), MALICIOUS_ID, 'escaped value must round-trip');
});

test('P1: single quotes and angle brackets in id/label never appear raw in the option markup', () => {
  const id = `it's <b>"&`;
  const view = createSandbox().render(taskState({}, projectsMeta({ id, label: `<i>${id}` })));
  const [, option] = tokenize(view.select.innerHTML).filter((entry) => entry.tag === 'option');
  assert.equal(option.attributes[0].value.includes("'"), false, 'raw single quote in attribute value');
  assert.equal(option.attributes[0].value.includes('"'), false, 'raw double quote in attribute value');
  assert.deepEqual(onlyTags(view.select.innerHTML, ['option']), []);
  assert.equal(decode(option.attributes[0].value), id);
});

test('P1: ampersands are escaped exactly once', () => {
  const view = createSandbox().render(taskState({}, projectsMeta({ id: 'a&amp;b', label: 'a&b' })));
  assert.match(view.select.innerHTML, /value="a&amp;amp;b"/);
  assert.match(view.select.innerHTML, />a&amp;b<\/option>/);
});

test('P2: a malicious project color is not interpolated into a style', () => {
  const [card] = createSandbox().render(taskState({}, projectsMeta({ color: MALICIOUS_COLOR }))).cards.pending;
  const payload = stylePayload(card);
  assert.equal(/url\(|background/.test(payload), false, `style injected: ${payload}`);
  assert.ok(!card.style.borderLeftColor, `border color kept: ${card.style.borderLeftColor}`);
  assert.deepEqual([...new Set(attributeNames(tokenize(card.innerHTML), 'span'))], ['class']);
});

test('P2: quote and semicolon payloads in color cannot break out of the style attribute', () => {
  for (const color of ['red" onmouseover="alert(1)', "red'; x:y", '#fff;position:fixed', 'expression(alert(1))', '']) {
    const [card] = createSandbox().render(taskState({}, projectsMeta({ color }))).cards.pending;
    const spanAttributes = attributeNames(tokenize(card.innerHTML), 'span');
    assert.equal(spanAttributes.includes('onmouseover'), false, `injected handler for ${color}`);
    assert.equal(/position:fixed|url\(|x:y|expression/.test(stylePayload(card)), false, `style injected for ${color}`);
    assert.ok(!card.style.borderLeftColor, `border color kept for ${color}`);
  }
});

test('P3: a markup-bearing wave is escaped, not emitted as a tag', () => {
  const [card] = createSandbox().render(taskState({ wave: MALICIOUS_WAVE })).cards.pending;
  assert.deepEqual(onlyTags(card.innerHTML, ['div', 'span']), []);
  assert.match(card.innerHTML, /wave=&lt;img src=x onerror=1&gt;/);
});

test('P3: a markup-bearing agent run id is escaped, not emitted as a tag', () => {
  const view = createSandbox().render(
    baseState({
      agentRuns: [{ id: '<b>1', agent_name: 'a', run_id: 'r', task_id: 't', status: 'running' }],
    }),
  );
  const html = view.cards.running[0].innerHTML;
  assert.deepEqual(onlyTags(html, ['div', 'span']), []);
  assert.match(html, /#&lt;b&gt;1 a/);
});

test('adversarial: every spec payload character is neutralised in wave, id and label', () => {
  const payload = `"'<>&url(;`;
  const view = createSandbox().render(
    baseState({
      projects_meta: projectsMeta({ label: payload }),
      tasks: [{ id: payload, run_id: payload, status: 'PENDING_G2', wave: payload, goal: payload, model_tier: payload, project_id: 'p1' }],
    }),
  );
  const html = view.cards.pending[0].innerHTML;
  assert.deepEqual(onlyTags(html, ['div', 'span']), []);
  assert.equal(/wave=["'<>]/.test(html), false);
  assert.match(html, /wave=&quot;&#39;&lt;&gt;&amp;url\(;/);
});
