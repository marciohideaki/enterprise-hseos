'use strict';

/**
 * Gate legível por máquina da prontidão do terminal (critérios T2 e T12).
 *
 * Falha se o documento declarar critério satisfeito sem evidência, contradisser o
 * `requirements.json`, ou se o W6-ENTRY.md perder uma seção obrigatória.
 *
 * T11 (reauditoria final) é NÃO DETERMINÍSTICO: pode ficar `ausente` em
 * TERMINAL_PRONTO_COM_GATES_DECLARADOS. Controle compensatório: revisão em duas passagens
 * (cega e confronto) e fatos conferidos pela saída da ferramenta.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const READINESS = 'docs/evolution/terminal-closeout/terminal-readiness.json';
const REQUIREMENTS = 'docs/evolution/requirements.json';

const VERDICTS = new Set(['TERMINAL_PRONTO', 'TERMINAL_PRONTO_COM_GATES_DECLARADOS', 'NAO_PRONTO']);
const RESULTS = new Set(['ok', 'parcial', 'ausente']);
const CLASSES = new Set(['FECHAVEL', 'OWNER_DECISAO', 'DEPENDENCIA_EXTERNA', 'GASTO_NECESSARIO', 'DESENHO_ABERTO', 'FORA_DO_TERMINAL']);
const CRITERIA_IDS = Array.from({ length: 12 }, (_, i) => `T${i + 1}`);
const MUST_BE_OK = ['T1', 'T2', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T12'];
const REQUIRED_SECTIONS = [
  '## Superfície estável',
  '## Versões',
  '## Cursor de eventos',
  '## Terminais',
  '## Aprovação',
  '## Riscos',
  '## Gates do owner',
  '## Fora de escopo',
];
const AXES = ['deterministic', 'real_consumers'];

const isVerified = (value) => typeof value === 'string' && value.startsWith('verified');

function resolvesInCheckout(rel) {
  if (typeof rel !== 'string' || rel === '' || path.isAbsolute(rel)) return false;
  const full = path.resolve(ROOT, rel);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return false;
  return fs.existsSync(full) && fs.statSync(full).isFile();
}

function validateReadiness(doc, { requirements, ownerGatesText, w6EntryText, exists = resolvesInCheckout }) {
  const problems = [];
  const add = (msg) => problems.push(msg);

  if (doc?.schema_version !== 1) add('schema_version deve ser 1');
  if (!VERDICTS.has(doc?.verdict)) add(`verdict fora do enum: ${doc?.verdict}`);
  if (!Array.isArray(doc?.criteria) || !Array.isArray(doc?.families)) {
    add('criteria e families devem ser listas');
    return problems;
  }

  const byId = new Map();
  for (const c of doc.criteria) {
    if (byId.has(c.id)) add(`critério duplicado: ${c.id}`);
    byId.set(c.id, c);
  }
  for (const id of CRITERIA_IDS) if (!byId.has(id)) add(`critério ausente: ${id}`);
  for (const id of byId.keys()) if (!CRITERIA_IDS.includes(id)) add(`critério desconhecido: ${id}`);

  for (const c of doc.criteria) {
    if (!RESULTS.has(c.result)) add(`${c.id}: result inválido: ${c.result}`);
    if (c.result === 'ok') {
      if (!Array.isArray(c.evidence) || c.evidence.length === 0) add(`${c.id}: result ok sem evidência`);
      if (typeof c.result_source !== 'string' || c.result_source.trim() === '') add(`${c.id}: result ok sem result_source`);
    }
    for (const e of Array.isArray(c.evidence) ? c.evidence : []) {
      if (!exists(e)) add(`${c.id}: evidência não resolve para arquivo no checkout: ${e}`);
    }
  }

  const reqFamilies = new Map((requirements?.families ?? []).filter((f) => f.wave <= 5).map((f) => [f.id, f]));
  const seen = new Set();
  for (const f of doc.families) {
    if (seen.has(f.id)) add(`família duplicada: ${f.id}`);
    seen.add(f.id);
    const req = reqFamilies.get(f.id);
    if (!req) {
      add(`família fora de W0-W5 ou desconhecida: ${f.id}`);
      continue;
    }
    if (f.wave !== req.wave) add(`${f.id}: wave diverge do requirements.json`);
    for (const axis of AXES) {
      if (f[axis] !== req.status[axis]) add(`${f.id}: ${axis} diverge do requirements.json`);
      if (!isVerified(req.status[axis]) && !CLASSES.has(f.class?.[axis])) add(`${f.id}: eixo ${axis} não verificado sem class válida`);
    }
    const unverified = AXES.some((axis) => !isVerified(req.status[axis]));
    const gates = Array.isArray(f.owner_gates) ? f.owner_gates : [];
    if (unverified && gates.length === 0) add(`${f.id}: eixo não verificado sem owner_gates`);
    for (const g of gates) {
      if (!new RegExp(`\\b${g}\\b`).test(ownerGatesText ?? '')) add(`${f.id}: ${g} não aparece no OWNER-GATES.md`);
    }
  }
  for (const id of reqFamilies.keys()) if (!seen.has(id)) add(`família de W0-W5 faltando: ${id}`);

  const result = (id) => byId.get(id)?.result;
  if (doc.verdict !== 'NAO_PRONTO' && MUST_BE_OK.some((id) => result(id) !== 'ok')) {
    add('verdict diferente de NAO_PRONTO com critério obrigatório diferente de ok');
  }
  if (doc.verdict === 'TERMINAL_PRONTO' && CRITERIA_IDS.some((id) => result(id) !== 'ok')) {
    add('TERMINAL_PRONTO exige T1 a T12 todos ok');
  }
  if (doc.verdict === 'TERMINAL_PRONTO' && doc.families.some((f) => f.real_consumers === 'not_verified')) {
    add('TERMINAL_PRONTO com família em real_consumers not_verified');
  }

  for (const section of REQUIRED_SECTIONS) {
    if (!new RegExp(`^${section}\\s*$`, 'm').test(w6EntryText ?? '')) add(`W6-ENTRY.md sem a seção ${section}`);
  }
  return problems;
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const realDoc = () => JSON.parse(read(READINESS));
const realContext = () => {
  const doc = realDoc();
  return {
    requirements: JSON.parse(read(REQUIREMENTS)),
    ownerGatesText: read(doc.owner_gates_file),
    w6EntryText: read(doc.w6_entry_file),
  };
};

test('o documento real de prontidão não tem problemas', () => {
  assert.deepEqual(validateReadiness(realDoc(), realContext()), []);
});

const NEGATIVE = [
  ['T faltando', (d) => (d.criteria = d.criteria.filter((c) => c.id !== 'T3')), /critério ausente: T3/],
  ['T duplicado', (d) => d.criteria.push({ ...d.criteria[0] }), /critério duplicado: T1/],
  ['ok sem evidência', (d) => (d.criteria[0].evidence = []), /T1: result ok sem evidência/],
  ['evidência inexistente', (d) => (d.criteria[0].evidence = ['nao/existe.md']), /não resolve para arquivo/],
  ['evidência fora do checkout', (d) => (d.criteria[0].evidence = ['../outro/arquivo']), /não resolve para arquivo/],
  ['família faltando', (d) => (d.families = d.families.filter((f) => f.id !== 'F02')), /família de W0-W5 faltando: F02/],
  ['família sobrando', (d) => d.families.push({ id: 'F24', wave: 7, class: {}, owner_gates: [] }), /fora de W0-W5/],
  ['status divergente', (d) => (d.families.find((f) => f.id === 'F01').real_consumers = 'not_verified'), /F01: real_consumers diverge/],
  ['eixo sem class', (d) => (d.families.find((f) => f.id === 'F02').class = {}), /F02: eixo real_consumers não verificado sem class/],
  ['class inválida', (d) => (d.families.find((f) => f.id === 'F02').class = { real_consumers: 'QUALQUER' }), /sem class válida/],
  ['eixo sem owner_gates', (d) => (d.families.find((f) => f.id === 'F02').owner_gates = []), /F02: eixo não verificado sem owner_gates/],
  ['owner_gate inexistente', (d) => (d.families.find((f) => f.id === 'F02').owner_gates = ['OG-99']), /OG-99 não aparece/],
  ['verdict fora do enum', (d) => (d.verdict = 'PRONTO'), /verdict fora do enum/],
  ['TERMINAL_PRONTO com real_consumers not_verified', (d) => (d.verdict = 'TERMINAL_PRONTO'), /TERMINAL_PRONTO com família/],
  [
    'TERMINAL_PRONTO com T11 ausente',
    (d) => {
      d.verdict = 'TERMINAL_PRONTO';
      Object.assign(
        d.criteria.find((c) => c.id === 'T11'),
        { result: 'ausente', evidence: [] },
      );
    },
    /TERMINAL_PRONTO exige T1 a T12 todos ok/,
  ],
  [
    'verdict com critério obrigatório não ok',
    (d) => (d.criteria.find((c) => c.id === 'T6').result = 'parcial'),
    /critério obrigatório diferente de ok/,
  ],
];

for (const [name, mutate, expected] of NEGATIVE) {
  test(`caso negativo: ${name}`, () => {
    const doc = realDoc();
    mutate(doc);
    const problems = validateReadiness(doc, realContext());
    assert.ok(
      problems.some((p) => expected.test(p)),
      `esperava ${expected}, obtive: ${JSON.stringify(problems)}`,
    );
  });
}

for (const section of REQUIRED_SECTIONS) {
  test(`caso negativo: W6-ENTRY.md sem ${section}`, () => {
    const ctx = realContext();
    ctx.w6EntryText = ctx.w6EntryText.replace(new RegExp(`^${section}$`, 'm'), '## Outro');
    const problems = validateReadiness(realDoc(), ctx);
    assert.ok(problems.some((p) => p.includes(`sem a seção ${section}`)));
  });
}

test('T11 ausente é aceito em TERMINAL_PRONTO_COM_GATES_DECLARADOS', () => {
  const doc = realDoc();
  Object.assign(
    doc.criteria.find((c) => c.id === 'T11'),
    { result: 'ausente', evidence: [] },
  );
  assert.equal(doc.verdict, 'TERMINAL_PRONTO_COM_GATES_DECLARADOS');
  assert.deepEqual(validateReadiness(doc, realContext()), []);
});

module.exports = { validateReadiness };
