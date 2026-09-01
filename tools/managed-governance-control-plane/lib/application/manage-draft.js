'use strict';

function createDraftManager(draftStore) {
  for (const method of ['create', 'update', 'submit', 'review']) {
    if (typeof draftStore?.[method] !== 'function') throw new TypeError(`draft store requires ${method}()`);
  }
  return Object.freeze({
    create(input, context) {
      return draftStore.create(input, context);
    },
    update(input, context) {
      return draftStore.update(input, context);
    },
    submit(input, context) {
      return draftStore.submit(input, context);
    },
    review(input, context) {
      return draftStore.review(input, context);
    },
  });
}

module.exports = { createDraftManager };
