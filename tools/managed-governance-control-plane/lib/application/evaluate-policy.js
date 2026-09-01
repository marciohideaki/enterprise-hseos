'use strict';

const { resolveGovernancePolicy } = require('../domain/policy-resolver');

function evaluatePolicy(input) {
  return resolveGovernancePolicy(input);
}

module.exports = { evaluatePolicy };
