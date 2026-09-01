'use strict';

const schemas = require('./schemas');
const canonicalJson = require('./canonical-json');

module.exports = Object.freeze({
  ...schemas,
  ...canonicalJson,
});
