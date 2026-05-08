'use strict';

function slug(value) {
  return String(value)
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
}

module.exports = { slug };
