'use strict';

const notes = Object.freeze({
  recovery:
    'After an uncertain effect, retain its reservation and reconcile the original command before any retry. Record the owner fence and evidence cursor.',
  cancellation:
    'Stop new dispatches, request cancellation of active descendants, and confirm the terminal result only after every process and plugin has drained.',
  budget:
    'Use the existing campaign authorization and original workflow limits. A late child cannot create a second financial balance or extend its parent deadline.',
});

function execute({ method, input }) {
  if (method === 'conformance') return { passed: Object.keys(notes).length === 3 && notes.recovery.includes('reconcile') };
  if (typeof input?.topic !== 'string' || !Object.hasOwn(notes, input.topic)) throw new Error('unknown runbook topic');
  return { items: [{ id: `runbook-${input.topic}`, content: notes[input.topic] }] };
}

module.exports = execute;
