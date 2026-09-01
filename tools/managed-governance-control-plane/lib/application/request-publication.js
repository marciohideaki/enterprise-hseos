'use strict';

function createPublicationRequester(publicationStore) {
  if (typeof publicationStore?.request !== 'function') throw new TypeError('publication store requires request()');
  return Object.freeze({
    request(input, context) {
      return publicationStore.request(input, context);
    },
  });
}

module.exports = { createPublicationRequester };
