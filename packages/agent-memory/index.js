'use strict';

const policy = require('./policy');
const store = require('./store');

module.exports = { ...policy, ...store };
