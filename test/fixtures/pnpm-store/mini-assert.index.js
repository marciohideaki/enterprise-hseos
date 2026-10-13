'use strict';
module.exports = {
  equal(actual, expected) {
    if (actual !== expected) throw new Error(`expected ${expected} but received ${actual}`);
  },
};
