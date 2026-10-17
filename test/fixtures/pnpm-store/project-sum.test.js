'use strict';
const sum = require('../src/sum.js');

module.exports = {
  'adds two numbers': (assert) => assert.equal(sum(2, 3), 5),
  'keeps zero': (assert) => assert.equal(sum(0, 0), 0),
};
